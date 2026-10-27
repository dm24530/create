package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	_ "github.com/lib/pq"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/repository"
)

type s3Settings struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	Prefix          string
	PublicBaseURL   string
	ForcePathStyle  bool
}

type backupConfig struct {
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"access_key_id"`
	SecretAccessKey string `json:"secret_access_key"`
	Prefix          string `json:"prefix"`
	ForcePathStyle  bool   `json:"force_path_style"`
}

type imageConfig struct {
	ReuseBackupS3   bool   `json:"reuse_backup_s3"`
	Bucket          string `json:"bucket"`
	Prefix          string `json:"prefix"`
	PublicBaseURL   string `json:"public_base_url"`
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	AccessKeyID     string `json:"access_key_id"`
	SecretAccessKey string `json:"secret_access_key"`
	ForcePathStyle  bool   `json:"force_path_style"`
}

type migrator struct {
	db                        *sql.DB
	client                    *s3.Client
	bucket                    string
	prefix                    string
	publicBaseURL             string
	dryRun                    bool
	deleteOld                 bool
	pruneMissingTargetSources bool
	limit                     int
	userKeys                  map[int64]string
	migrated                  int
	skipped                   int
	failed                    int
}

func main() {
	var (
		dryRun                    = flag.Bool("dry-run", true, "only print the migration plan")
		deleteOld                 = flag.Bool("delete-old", false, "delete source objects after DB update commits")
		kind                      = flag.String("kind", "all", "studio, canvas, usage, or all")
		limit                     = flag.Int("limit", 0, "maximum rows per category; 0 means unlimited")
		pruneLog                  = flag.String("prune-log", "", "delete source objects listed in a completed dry-run log after verifying targets")
		pruneMissingTargetSources = flag.Bool(
			"prune-missing-target-sources",
			false,
			"delete legacy sources when the target is absent and no database row references it",
		)
	)
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Hour)
	defer cancel()

	db, err := openDB()
	must(err)
	defer func() { _ = db.Close() }()

	settings, err := loadS3Settings(ctx, db)
	must(err)
	client, err := newS3Client(ctx, settings)
	must(err)

	m := &migrator{
		db:                        db,
		client:                    client,
		bucket:                    settings.Bucket,
		prefix:                    normalizePrefix(settings.Prefix),
		publicBaseURL:             strings.TrimRight(strings.TrimSpace(settings.PublicBaseURL), "/"),
		dryRun:                    *dryRun,
		deleteOld:                 *deleteOld,
		pruneMissingTargetSources: *pruneMissingTargetSources,
		limit:                     *limit,
		userKeys:                  make(map[int64]string),
	}
	if strings.TrimSpace(*pruneLog) != "" {
		must(m.pruneFromLog(ctx, strings.TrimSpace(*pruneLog)))
		return
	}
	must(m.loadUserKeys(ctx))

	switch strings.ToLower(strings.TrimSpace(*kind)) {
	case "studio":
		must(m.migrateStudioWorks(ctx))
	case "canvas":
		must(m.migrateCanvasAssets(ctx))
	case "usage":
		must(m.migrateUsageLinks(ctx))
	case "all":
		must(m.migrateStudioWorks(ctx))
		must(m.migrateCanvasAssets(ctx))
		must(m.migrateUsageLinks(ctx))
	default:
		must(fmt.Errorf("unknown --kind %q", *kind))
	}

	fmt.Printf("SUMMARY dry_run=%t delete_old=%t migrated=%d skipped=%d failed=%d\n",
		m.dryRun, m.deleteOld, m.migrated, m.skipped, m.failed)
	if m.failed > 0 {
		os.Exit(1)
	}
}

func (m *migrator) pruneFromLog(ctx context.Context, logPath string) error {
	file, err := os.Open(logPath)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()

	scanner := bufio.NewScanner(file)
	seen := make(map[string]struct{})
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "STUDIO ") &&
			!strings.HasPrefix(line, "CANVAS ") &&
			!strings.HasPrefix(line, "USAGE ") &&
			!strings.HasPrefix(line, "PRUNE_FAIL ") {
			continue
		}
		parts := strings.SplitN(line, " -> ", 2)
		if len(parts) != 2 {
			continue
		}
		source := strings.TrimSpace(strings.Fields(parts[0])[len(strings.Fields(parts[0]))-1])
		target := strings.TrimSpace(parts[1])
		if source == "" || target == "" || source == target {
			continue
		}
		if _, ok := seen[source]; ok {
			continue
		}
		seen[source] = struct{}{}
		referenced, refErr := m.objectReferenced(ctx, source)
		if refErr != nil {
			fmt.Printf("PRUNE_REF_FAIL source=%s error=%v\n", source, refErr)
			m.failed++
			continue
		}
		if referenced {
			fmt.Printf("PRUNE_SKIP_REFERENCED source=%s\n", source)
			m.skipped++
			continue
		}
		fmt.Printf("PRUNE source=%s target=%s\n", source, target)
		if m.dryRun {
			m.migrated++
			continue
		}
		if _, err := m.client.HeadObject(ctx, &s3.HeadObjectInput{
			Bucket: aws.String(m.bucket),
			Key:    aws.String(target),
		}); err != nil {
			if m.pruneMissingTargetSources {
				referenced, refErr := m.objectReferenced(ctx, target)
				if refErr != nil {
					fmt.Printf("PRUNE_REF_FAIL source=%s target=%s error=%v\n", source, target, refErr)
					m.failed++
					continue
				}
				if !referenced {
					if deleteErr := m.deleteObject(ctx, source); deleteErr != nil {
						fmt.Printf("PRUNE_ORPHAN_DELETE_FAIL source=%s error=%v\n", source, deleteErr)
						m.failed++
						continue
					}
					fmt.Printf("PRUNE_ORPHAN source=%s target_missing=%s\n", source, target)
					m.migrated++
					continue
				}
			}
			fmt.Printf("PRUNE_FAIL source=%s target=%s error=%v\n", source, target, err)
			m.failed++
			continue
		}
		if err := m.deleteObject(ctx, source); err != nil {
			fmt.Printf("PRUNE_DELETE_FAIL source=%s error=%v\n", source, err)
			m.failed++
			continue
		}
		m.migrated++
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	fmt.Printf("SUMMARY dry_run=%t pruned=%d failed=%d\n", m.dryRun, m.migrated, m.failed)
	return nil
}

func (m *migrator) objectReferenced(ctx context.Context, key string) (bool, error) {
	var referenced bool
	err := m.db.QueryRowContext(ctx, `
		SELECT
			EXISTS(SELECT 1 FROM studio_works WHERE object_key = $1)
			OR EXISTS(SELECT 1 FROM canvas_assets WHERE object_key = $1 OR thumb_object_key = $1)
			OR EXISTS(SELECT 1 FROM usage_log_image_links WHERE object_key = $1)
	`, key).Scan(&referenced)
	return referenced, err
}

func (m *migrator) loadUserKeys(ctx context.Context) error {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, storage_key
		FROM users
		WHERE storage_key <> ''
	`)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var userID int64
		var key string
		if err := rows.Scan(&userID, &key); err != nil {
			return err
		}
		m.userKeys[userID] = key
	}
	return rows.Err()
}

func (m *migrator) migrateStudioWorks(ctx context.Context) error {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, user_id, kind, object_key, url, thumb_url
		FROM studio_works
		WHERE id <> ''
		ORDER BY created_at, id
	`)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()

	type row struct {
		id, kind, objectKey, publicURL, thumbURL string
		userID                                   int64
	}
	var records []row
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.id, &item.userID, &item.kind, &item.objectKey, &item.publicURL, &item.thumbURL); err != nil {
			return err
		}
		records = append(records, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, item := range records {
		if m.limit > 0 && m.migrated+m.skipped >= m.limit {
			break
		}
		storageKey, err := m.storageKey(item.userID)
		if err != nil {
			return err
		}
		newKey := studioMainKey(storageKey, item.kind, item.objectKey)
		if newKey == item.objectKey {
			m.skipped++
			continue
		}
		oldThumbKey := studioThumbKey(item.objectKey)
		newThumbKey := studioThumbKey(newKey)
		fmt.Printf("STUDIO id=%s user=%d %s -> %s\n", item.id, item.userID, item.objectKey, newKey)
		if m.dryRun {
			m.migrated++
			continue
		}
		if err := m.copyAndVerify(ctx, item.objectKey, newKey, ""); err != nil {
			fmt.Printf("STUDIO_FAIL id=%s error=%v\n", item.id, err)
			m.failed++
			continue
		}
		newThumbURL := ""
		copiedThumb := false
		if strings.TrimSpace(item.thumbURL) != "" {
			if err := m.copyAndVerify(ctx, oldThumbKey, newThumbKey, ""); err != nil {
				if !isMissingObject(err) {
					fmt.Printf("STUDIO_THUMB_FAIL id=%s error=%v\n", item.id, err)
					m.failed++
					continue
				}
			} else {
				copiedThumb = true
				newThumbURL = m.publicURL(newThumbKey)
			}
		}
		_, err = m.db.ExecContext(ctx, `
			UPDATE studio_works
			SET object_key = $2, url = $3, thumb_url = $4
			WHERE id = $1
		`, item.id, newKey, m.publicURL(newKey), newThumbURL)
		if err != nil {
			fmt.Printf("STUDIO_DB_FAIL id=%s error=%v\n", item.id, err)
			m.failed++
			continue
		}
		if m.deleteOld {
			if err := m.deleteObjectIfUnreferenced(ctx, item.objectKey); err != nil {
				fmt.Printf("STUDIO_DELETE_FAIL id=%s error=%v\n", item.id, err)
				m.failed++
			}
			if copiedThumb {
				if err := m.deleteObjectIfUnreferenced(ctx, oldThumbKey); err != nil {
					fmt.Printf("STUDIO_THUMB_DELETE_FAIL id=%s error=%v\n", item.id, err)
					m.failed++
				}
			}
		}
		m.migrated++
	}
	return nil
}

func (m *migrator) migrateCanvasAssets(ctx context.Context) error {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, user_id, project_id, object_key, thumb_object_key, sha256
		FROM canvas_assets
		ORDER BY created_at, id
	`)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()

	type row struct {
		id, projectID, objectKey, thumbKey, sha string
		userID                                  int64
	}
	var records []row
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.id, &item.userID, &item.projectID, &item.objectKey, &item.thumbKey, &item.sha); err != nil {
			return err
		}
		records = append(records, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, item := range records {
		if m.limit > 0 && m.migrated+m.skipped >= m.limit {
			break
		}
		storageKey, err := m.storageKey(item.userID)
		if err != nil {
			return err
		}
		sourceKey := canonicalLegacyObjectKey(item.objectKey)
		newKey := canvasKey(storageKey, item.projectID, sourceKey)
		newThumbKey := ""
		if strings.TrimSpace(item.thumbKey) != "" {
			newThumbKey = canvasKey(storageKey, item.projectID, canonicalLegacyObjectKey(item.thumbKey))
		}
		if newKey == sourceKey && newThumbKey == item.thumbKey {
			m.skipped++
			continue
		}
		fmt.Printf("CANVAS id=%s user=%d %s -> %s\n", item.id, item.userID, sourceKey, newKey)
		if m.dryRun {
			m.migrated++
			continue
		}
		if err := m.copyAndVerify(ctx, sourceKey, newKey, item.sha); err != nil {
			fmt.Printf("CANVAS_FAIL id=%s error=%v\n", item.id, err)
			m.failed++
			continue
		}
		if newThumbKey != "" {
			if err := m.copyAndVerify(ctx, canonicalLegacyObjectKey(item.thumbKey), newThumbKey, ""); err != nil {
				fmt.Printf("CANVAS_THUMB_FAIL id=%s error=%v\n", item.id, err)
				m.failed++
				continue
			}
		}
		_, err = m.db.ExecContext(ctx, `
			UPDATE canvas_assets
			SET object_key = $2, thumb_object_key = $3
			WHERE id = $1
		`, item.id, newKey, newThumbKey)
		if err != nil {
			fmt.Printf("CANVAS_DB_FAIL id=%s error=%v\n", item.id, err)
			m.failed++
			continue
		}
		if m.deleteOld {
			if err := m.deleteObjectIfUnreferenced(ctx, sourceKey); err != nil {
				fmt.Printf("CANVAS_DELETE_FAIL id=%s error=%v\n", item.id, err)
				m.failed++
			}
			if item.thumbKey != "" {
				if err := m.deleteObjectIfUnreferenced(ctx, item.thumbKey); err != nil {
					fmt.Printf("CANVAS_THUMB_DELETE_FAIL id=%s error=%v\n", item.id, err)
					m.failed++
				}
			}
		}
		m.migrated++
	}
	return nil
}

func (m *migrator) migrateUsageLinks(ctx context.Context) error {
	rows, err := m.db.QueryContext(ctx, `
		SELECT user_id, api_key_id, request_id, object_key, image_url
		FROM usage_log_image_links
		WHERE object_key IS NOT NULL AND object_key <> ''
		ORDER BY created_at
	`)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	type row struct {
		userID, apiKeyID         int64
		requestID, key, imageURL string
	}
	var records []row
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.userID, &item.apiKeyID, &item.requestID, &item.key, &item.imageURL); err != nil {
			return err
		}
		records = append(records, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range records {
		if m.limit > 0 && m.migrated+m.skipped >= m.limit {
			break
		}
		storageKey, err := m.storageKey(item.userID)
		if err != nil {
			return err
		}
		newKey := imageKey(storageKey, item.key)
		if newKey == item.key {
			m.skipped++
			continue
		}
		fmt.Printf("USAGE user=%d request=%s %s -> %s\n", item.userID, item.requestID, item.key, newKey)
		if m.dryRun {
			m.migrated++
			continue
		}
		if err := m.copyAndVerify(ctx, item.key, newKey, ""); err != nil {
			fmt.Printf("USAGE_FAIL user=%d request=%s error=%v\n", item.userID, item.requestID, err)
			m.failed++
			continue
		}
		_, err = m.db.ExecContext(ctx, `
			UPDATE usage_log_image_links
			SET object_key = $4, image_url = $5
			WHERE user_id = $1 AND api_key_id = $2 AND request_id = $3
		`, item.userID, item.apiKeyID, item.requestID, newKey, m.publicURL(newKey))
		if err != nil {
			fmt.Printf("USAGE_DB_FAIL user=%d request=%s error=%v\n", item.userID, item.requestID, err)
			m.failed++
			continue
		}
		if m.deleteOld {
			if err := m.deleteObjectIfUnreferenced(ctx, item.key); err != nil {
				fmt.Printf("USAGE_DELETE_FAIL user=%d request=%s error=%v\n", item.userID, item.requestID, err)
				m.failed++
			}
		}
		m.migrated++
	}
	return nil
}

func (m *migrator) storageKey(userID int64) (string, error) {
	key := strings.TrimSpace(m.userKeys[userID])
	if key == "" {
		return "", fmt.Errorf("user %d has no storage_key", userID)
	}
	return key, nil
}

func (m *migrator) publicURL(key string) string {
	if m.publicBaseURL == "" {
		return ""
	}
	return m.publicBaseURL + "/" + strings.TrimLeft(key, "/")
}

func (m *migrator) copyAndVerify(ctx context.Context, source, target, expectedSHA string) error {
	if source == target {
		return nil
	}
	sourceHead, err := m.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(m.bucket),
		Key:    aws.String(source),
	})
	if err != nil {
		return fmt.Errorf("head source %s: %w", source, err)
	}
	_, err = m.client.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:     aws.String(m.bucket),
		Key:        aws.String(target),
		CopySource: aws.String(url.PathEscape(m.bucket + "/" + source)),
	})
	if err != nil {
		return fmt.Errorf("copy %s -> %s: %w", source, target, err)
	}
	targetHead, err := m.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(m.bucket),
		Key:    aws.String(target),
	})
	if err != nil {
		return fmt.Errorf("head target %s: %w", target, err)
	}
	if sourceHead.ContentLength != nil && targetHead.ContentLength != nil &&
		*sourceHead.ContentLength != *targetHead.ContentLength {
		return fmt.Errorf("size mismatch: source=%d target=%d", *sourceHead.ContentLength, *targetHead.ContentLength)
	}
	if expectedSHA != "" {
		actual, err := m.sha256Object(ctx, target)
		if err != nil {
			return fmt.Errorf("hash target %s: %w", target, err)
		}
		if !strings.EqualFold(actual, expectedSHA) {
			return fmt.Errorf("sha256 mismatch: expected=%s actual=%s", expectedSHA, actual)
		}
	}
	return nil
}

func (m *migrator) sha256Object(ctx context.Context, key string) (string, error) {
	obj, err := m.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(m.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return "", err
	}
	defer func() { _ = obj.Body.Close() }()
	hash := sha256.New()
	if _, err := io.Copy(hash, obj.Body); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (m *migrator) deleteObject(ctx context.Context, key string) error {
	if strings.TrimSpace(key) == "" {
		return nil
	}
	_, err := m.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(m.bucket),
		Key:    aws.String(key),
	})
	return err
}

func (m *migrator) deleteObjectIfUnreferenced(ctx context.Context, key string) error {
	referenced, err := m.objectReferenced(ctx, key)
	if err != nil {
		return err
	}
	if referenced {
		fmt.Printf("DELETE_SKIP_REFERENCED object=%s\n", key)
		return nil
	}
	return m.deleteObject(ctx, key)
}

func studioMainKey(storageKey, kind, oldKey string) string {
	base := path.Base(strings.TrimSpace(oldKey))
	if strings.EqualFold(kind, "video") {
		return path.Join("videos", storageKey, base)
	}
	return path.Join("images", storageKey, base)
}

func studioThumbKey(mainKey string) string {
	mainKey = strings.TrimSpace(mainKey)
	if mainKey == "" {
		return ""
	}
	base := strings.TrimSuffix(path.Base(mainKey), path.Ext(mainKey))
	return path.Join(path.Dir(mainKey), "thumbs", base+".jpg")
}

func canvasKey(storageKey, projectID, oldKey string) string {
	base := path.Base(strings.TrimSpace(oldKey))
	section := "assets"
	if strings.Contains(oldKey, "/thumbs/") {
		section = "thumbs"
	}
	return path.Join("canvas", storageKey, projectID, section, base)
}

func imageKey(storageKey, oldKey string) string {
	return path.Join("images", storageKey, path.Base(strings.TrimSpace(oldKey)))
}

func canonicalLegacyObjectKey(key string) string {
	key = strings.TrimLeft(strings.TrimSpace(key), "/")
	if strings.HasPrefix(key, "canvas/users/") {
		return "images/" + key
	}
	return key
}

func normalizePrefix(prefix string) string {
	prefix = strings.Trim(strings.TrimSpace(prefix), "/")
	if prefix == "" {
		return "images"
	}
	return prefix
}

func isMissingObject(err error) bool {
	var apiErr smithy.APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	switch apiErr.ErrorCode() {
	case "NoSuchKey", "NotFound", "404":
		return true
	default:
		return false
	}
}

func openDB() (*sql.DB, error) {
	host := firstEnv("DATABASE_HOST", "DB_HOST")
	port := firstEnv("DATABASE_PORT", "DB_PORT")
	user := firstEnv("DATABASE_USER", "DB_USER")
	password := firstEnv("DATABASE_PASSWORD", "DB_PASSWORD")
	name := firstEnv("DATABASE_DBNAME", "DATABASE_NAME", "DB_NAME")
	sslmode := firstEnv("DATABASE_SSLMODE", "DB_SSLMODE")
	if host == "" || user == "" || name == "" {
		return nil, errors.New("database environment is incomplete")
	}
	if port == "" {
		port = "5432"
	}
	if sslmode == "" {
		sslmode = "disable"
	}
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		host, port, user, password, name, sslmode)
	return sql.Open("postgres", dsn)
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func loadS3Settings(ctx context.Context, db *sql.DB) (*s3Settings, error) {
	var backupRaw string
	if err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = 'backup_s3_config'`).Scan(&backupRaw); err != nil {
		return nil, fmt.Errorf("load backup S3 config: %w", err)
	}
	var backup backupConfig
	if err := json.Unmarshal([]byte(backupRaw), &backup); err != nil {
		return nil, err
	}
	encryptionKey := strings.TrimSpace(os.Getenv("TOTP_ENCRYPTION_KEY"))
	if encryptionKey == "" {
		err := db.QueryRowContext(ctx, `SELECT value FROM security_secrets WHERE key = 'totp_encryption_key'`).Scan(&encryptionKey)
		if err != nil {
			return nil, fmt.Errorf("load encryption key: %w", err)
		}
	}
	encryptor, err := repository.NewAESEncryptor(&config.Config{
		Totp: config.TotpConfig{EncryptionKey: encryptionKey},
	})
	if err != nil {
		return nil, err
	}
	backup.SecretAccessKey, err = encryptor.Decrypt(backup.SecretAccessKey)
	if err != nil {
		return nil, fmt.Errorf("decrypt backup secret: %w", err)
	}

	settings := &s3Settings{
		Endpoint:        backup.Endpoint,
		Region:          backup.Region,
		Bucket:          backup.Bucket,
		AccessKeyID:     backup.AccessKeyID,
		SecretAccessKey: backup.SecretAccessKey,
		Prefix:          "images/",
		ForcePathStyle:  backup.ForcePathStyle,
	}
	var imageRaw string
	if err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = 'image_storage_config'`).Scan(&imageRaw); err == nil && imageRaw != "" {
		var image imageConfig
		if err := json.Unmarshal([]byte(imageRaw), &image); err != nil {
			return nil, err
		}
		settings.Prefix = image.Prefix
		settings.PublicBaseURL = image.PublicBaseURL
		if !image.ReuseBackupS3 {
			settings.Endpoint = image.Endpoint
			settings.Region = image.Region
			settings.Bucket = image.Bucket
			settings.AccessKeyID = image.AccessKeyID
			settings.ForcePathStyle = image.ForcePathStyle
			settings.SecretAccessKey, err = encryptor.Decrypt(image.SecretAccessKey)
			if err != nil {
				return nil, fmt.Errorf("decrypt image secret: %w", err)
			}
		} else if strings.TrimSpace(image.Bucket) != "" {
			settings.Bucket = image.Bucket
		}
	}
	if settings.Region == "" {
		settings.Region = "auto"
	}
	if settings.Bucket == "" || settings.AccessKeyID == "" || settings.SecretAccessKey == "" {
		return nil, errors.New("S3 settings are incomplete")
	}
	return settings, nil
}

func newS3Client(ctx context.Context, settings *s3Settings) (*s3.Client, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(settings.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			settings.AccessKeyID,
			settings.SecretAccessKey,
			"",
		)),
	)
	if err != nil {
		return nil, err
	}
	return s3.NewFromConfig(cfg, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(settings.Endpoint)
		options.UsePathStyle = settings.ForcePathStyle
		options.APIOptions = append(options.APIOptions, v4.SwapComputePayloadSHA256ForUnsignedPayloadMiddleware)
		options.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
	}), nil
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}
}
