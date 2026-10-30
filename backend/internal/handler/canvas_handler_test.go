package handler

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

type canvasStorageStub struct {
	savedKeys    []string
	presignedPut []string
	copied       [][2]string
	deletedKeys  []string
	deleteErr    error
	objectStats  map[string]service.ImageObjectMetadata
	objectPrefix map[string][]byte
}

type canvasIdentityStub struct {
	key string
	err error
}

func (s canvasIdentityStub) StorageKey(context.Context, int64) (string, error) {
	return s.key, s.err
}

func (s *canvasStorageStub) SaveImageWithKey(
	_ context.Context,
	key string,
	_ string,
	_ []byte,
) (string, string, error) {
	s.savedKeys = append(s.savedKeys, key)
	return "https://r2.example.test/" + key, key, nil
}

func (s *canvasStorageStub) SaveImageWithFullKey(
	ctx context.Context,
	key string,
	contentType string,
	data []byte,
) (string, string, error) {
	return s.SaveImageWithKey(ctx, key, contentType, data)
}

func (s *canvasStorageStub) DeleteObject(_ context.Context, key string) error {
	s.deletedKeys = append(s.deletedKeys, key)
	return s.deleteErr
}

func (s *canvasStorageStub) PresignImageObject(_ context.Context, objectKey string) (string, error) {
	return "https://r2.example.test/" + objectKey, nil
}

func (s *canvasStorageStub) PresignImageUpload(_ context.Context, objectKey, contentType string) (service.ImageStorageUploadRequest, error) {
	s.presignedPut = append(s.presignedPut, objectKey)
	return service.ImageStorageUploadRequest{
		URL:     "https://upload.r2.example.test/" + objectKey,
		Headers: map[string]string{"Content-Type": contentType},
	}, nil
}

func (s *canvasStorageStub) ImageObjectStat(_ context.Context, objectKey string) (service.ImageObjectMetadata, error) {
	if meta, ok := s.objectStats[objectKey]; ok {
		return meta, nil
	}
	return service.ImageObjectMetadata{}, context.DeadlineExceeded
}

func (s *canvasStorageStub) ReadImageObjectPrefix(_ context.Context, objectKey string, _ int64) ([]byte, error) {
	if data, ok := s.objectPrefix[objectKey]; ok {
		return data, nil
	}
	return nil, context.DeadlineExceeded
}

func (s *canvasStorageStub) CopyImageObject(_ context.Context, sourceKey, targetKey, contentType string) error {
	s.copied = append(s.copied, [2]string{sourceKey, targetKey})
	if s.objectStats == nil {
		s.objectStats = map[string]service.ImageObjectMetadata{}
	}
	source := s.objectStats[sourceKey]
	if source.ContentType == "" {
		source.ContentType = contentType
	}
	s.objectStats[targetKey] = source
	return nil
}

func (s *canvasStorageStub) FetchImageURL(_ context.Context, _ string) ([]byte, string, error) {
	return []byte("remote-image"), "image/png", nil
}

func TestCanvasProxyImageStreamsRemoteImage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := &CanvasHandler{storage: &canvasStorageStub{}}
	const userID int64 = 101

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/v1/canvas/image-proxy?url="+
			"https%3A%2F%2Fr2.example.test%2Fimage.png",
		nil,
	)
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: userID})

	handler.ProxyImage(c)

	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "image/png", w.Header().Get("Content-Type"))
	require.Equal(t, "remote-image", w.Body.String())
}

type canvasObjectKeyMatcher struct {
	prefix string
}

func (m canvasObjectKeyMatcher) Match(value driver.Value) bool {
	key, ok := value.(string)
	return ok && strings.HasPrefix(key, m.prefix)
}

func TestCanvasAssetObjectKeysAreUserIsolated(t *testing.T) {
	first := canvasAssetObjectKey("key101", "project-a", "asset-a", ".png")
	second := canvasAssetObjectKey("key202", "project-a", "asset-a", ".png")

	require.True(t, strings.HasPrefix(first, "canvas/key101/project-a/"))
	require.True(t, strings.HasPrefix(second, "canvas/key202/project-a/"))
	require.NotEqual(t, first, second)
	require.Equal(t,
		"canvas/key101/project-a/thumbs/asset-a.webp",
		canvasAssetThumbKey("key101", "project-a", "asset-a", ".webp"),
	)
}

func TestValidateCanvasObjectSignatureRejectsSpoofedContent(t *testing.T) {
	require.True(t, validateCanvasObjectSignature("image/png", canvasTestPNG))
	require.True(t, validateCanvasObjectSignature("image/webp", []byte("RIFF\x00\x00\x00\x00WEBP")))
	require.False(t, validateCanvasObjectSignature("image/png", []byte("<html>not an image</html>")))
	require.False(t, validateCanvasObjectSignature("image/svg+xml", []byte("<svg></svg>")))
}

func TestCanvasUploadAssetUsesAuthenticatedUsersObjectPrefix(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	storage := &canvasStorageStub{}
	handler := &CanvasHandler{
		db:         db,
		storage:    storage,
		identities: canvasIdentityStub{key: "key101"},
	}
	const userID int64 = 101
	const projectID = "project-a"
	const nodeID = "node-a"

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT 1 FROM canvas_projects WHERE id = $1 AND user_id = $2
	`)).
		WithArgs(projectID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, project_id, node_id, kind, object_key, thumb_object_key,
		       width, height, bytes, mime_type, sha256, created_at
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = $2 AND node_id = $3 AND sha256 = $4
		ORDER BY created_at ASC
		LIMIT 1
	`)).
		WithArgs(userID, projectID, nodeID, sqlmock.AnyArg()).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectBegin()
	mock.ExpectExec(`SELECT pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)`).
		WithArgs("canvas-assets:101").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT COUNT(*), COALESCE(SUM(bytes), 0)
		FROM canvas_assets
		WHERE user_id = $1
	`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count", "bytes"}).AddRow(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, project_id, node_id, kind, object_key, thumb_object_key,
		       width, height, bytes, mime_type, sha256, created_at
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = $2 AND node_id = $3 AND sha256 = $4
		ORDER BY created_at ASC
		LIMIT 1
	`)).
		WithArgs(userID, projectID, nodeID, sqlmock.AnyArg()).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO canvas_assets (
			id, user_id, project_id, node_id, kind, object_key, thumb_object_key,
			width, height, bytes, mime_type, sha256
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
	`)).
		WithArgs(
			sqlmock.AnyArg(),
			userID,
			projectID,
			nodeID,
			"image",
			canvasObjectKeyMatcher{prefix: "canvas/key101/project-a/assets/"},
			"",
			640,
			480,
			len(canvasTestPNG),
			"image/png",
			sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	body := &bytes.Buffer{}
	form := multipart.NewWriter(body)
	require.NoError(t, form.WriteField("project_id", projectID))
	require.NoError(t, form.WriteField("node_id", nodeID))
	require.NoError(t, form.WriteField("kind", "image"))
	require.NoError(t, form.WriteField("width", "640"))
	require.NoError(t, form.WriteField("height", "480"))
	part, err := form.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {`form-data; name="file"; filename="source.png"`},
		"Content-Type":        {"image/png"},
	})
	require.NoError(t, err)
	_, err = part.Write(canvasTestPNG)
	require.NoError(t, err)
	require.NoError(t, form.Close())

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/canvas/assets", body)
	c.Request.Header.Set("Content-Type", form.FormDataContentType())
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: userID})

	handler.UploadAsset(c)

	if w.Code != http.StatusCreated {
		require.Equal(t, http.StatusCreated, w.Code, "body=%s keys=%v", w.Body.String(), storage.savedKeys)
	}
	require.Len(t, storage.savedKeys, 1)
	require.True(t, strings.HasPrefix(
		storage.savedKeys[0],
		"canvas/key101/project-a/assets/",
	))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCanvasPresignAssetUsesAuthenticatedUsersObjectPrefix(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	storage := &canvasStorageStub{}
	handler := &CanvasHandler{
		db:         db,
		storage:    storage,
		identities: canvasIdentityStub{key: "key101"},
	}
	const userID int64 = 101
	const projectID = "project-a"

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT 1 FROM canvas_projects WHERE id = $1 AND user_id = $2
	`)).
		WithArgs(projectID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(1))
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`
		DELETE FROM canvas_upload_intents
		WHERE user_id = $1 AND expires_at <= NOW()
	`)).
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`SELECT pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)`).
		WithArgs("canvas-uploads:101").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT COUNT(*), COALESCE(SUM(bytes + thumb_bytes), 0)
		FROM canvas_upload_intents
		WHERE user_id = $1 AND expires_at > NOW()
	`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count", "bytes"}).AddRow(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT COUNT(*), COALESCE(SUM(bytes), 0)
		FROM canvas_assets
		WHERE user_id = $1
	`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count", "bytes"}).AddRow(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO canvas_upload_intents (
			asset_id, user_id, project_id, node_id, kind, object_key, thumb_object_key,
			bytes, thumb_bytes, mime_type, thumb_mime_type, sha256, expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
	`)).
		WithArgs(
			sqlmock.AnyArg(),
			userID,
			projectID,
			"node-a",
			"image",
			canvasObjectKeyMatcher{prefix: "canvas-pending/key101/project-a/"},
			canvasObjectKeyMatcher{prefix: "canvas-pending/key101/project-a/thumbs/"},
			int64(128),
			int64(32),
			"image/png",
			"image/webp",
			"",
			sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	body := strings.NewReader(`{
		"project_id":"project-a",
		"node_id":"node-a",
		"kind":"image",
		"filename":"source.png",
		"content_type":"image/png",
		"bytes":128,
		"thumbnail_content_type":"image/webp",
		"thumbnail_bytes":32
	}`)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/canvas/assets/presign", body)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: userID})

	handler.PresignAsset(c)

	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())
	require.Len(t, storage.presignedPut, 2)
	require.True(t, strings.HasPrefix(storage.presignedPut[0], "canvas-pending/key101/project-a/"))
	require.True(t, strings.HasPrefix(storage.presignedPut[1], "canvas-pending/key101/project-a/thumbs/"))
	require.Contains(t, w.Body.String(), `"upload_url":"https://upload.r2.example.test/`)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCanvasCompleteAssetVerifiesUploadedObjectAndRegisters(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	const userID int64 = 101
	const projectID = "project-a"
	const assetID = "asset-direct"
	objectKey := "canvas-pending/key101/project-a/asset-direct.png"
	thumbKey := "canvas-pending/key101/project-a/thumbs/asset-direct.webp"
	finalObjectKey := "canvas/key101/project-a/assets/asset-direct.png"
	finalThumbKey := "canvas/key101/project-a/thumbs/asset-direct.webp"
	storage := &canvasStorageStub{
		objectStats: map[string]service.ImageObjectMetadata{
			objectKey: {Bytes: 128, ContentType: "image/png"},
			thumbKey:  {Bytes: 32, ContentType: "image/webp"},
		},
		objectPrefix: map[string][]byte{
			objectKey: canvasTestPNG[:min(16, len(canvasTestPNG))],
			thumbKey:  []byte("RIFF\x00\x00\x00\x00WEBP"),
		},
	}
	handler := &CanvasHandler{
		db:         db,
		storage:    storage,
		identities: canvasIdentityStub{key: "key101"},
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT 1 FROM canvas_projects WHERE id = $1 AND user_id = $2
	`)).
		WithArgs(projectID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, project_id, node_id, kind, object_key, thumb_object_key,
		       width, height, bytes, mime_type, sha256, created_at
		FROM canvas_assets
		WHERE id = $1 AND user_id = $2
	`)).
		WithArgs(assetID, userID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT asset_id, user_id, project_id, node_id, kind, object_key, thumb_object_key,
		       bytes, thumb_bytes, mime_type, thumb_mime_type, sha256, expires_at
		FROM canvas_upload_intents
		WHERE asset_id = $1 AND user_id = $2 AND expires_at > NOW()
	`)).
		WithArgs(assetID, userID).
		WillReturnRows(sqlmock.NewRows([]string{
			"asset_id", "user_id", "project_id", "node_id", "kind", "object_key", "thumb_object_key",
			"bytes", "thumb_bytes", "mime_type", "thumb_mime_type", "sha256", "expires_at",
		}).AddRow(
			assetID, userID, projectID, "node-a", "image", objectKey, thumbKey,
			int64(128), int64(32), "image/png", "image/webp", "", time.Now().Add(time.Hour),
		))
	mock.ExpectBegin()
	mock.ExpectExec(`SELECT pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)`).
		WithArgs("canvas-assets:101").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT COUNT(*), COALESCE(SUM(bytes), 0)
		FROM canvas_assets
		WHERE user_id = $1
	`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count", "bytes"}).AddRow(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO canvas_assets (
			id, user_id, project_id, node_id, kind, object_key, thumb_object_key,
			width, height, bytes, mime_type, sha256
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
	`)).
		WithArgs(
			assetID,
			userID,
			projectID,
			"node-a",
			"image",
			finalObjectKey,
			finalThumbKey,
			640,
			480,
			int64(128),
			"image/png",
			"",
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	mock.ExpectExec(regexp.QuoteMeta(`
		DELETE FROM canvas_upload_intents WHERE asset_id = $1 AND user_id = $2
	`)).
		WithArgs(assetID, userID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	body := strings.NewReader(`{
		"asset_id":"asset-direct",
		"project_id":"project-a",
		"node_id":"node-a",
		"kind":"image",
		"filename":"source.png",
		"content_type":"image/png",
		"bytes":128,
		"object_key":"canvas-pending/key101/project-a/asset-direct.png",
		"thumbnail_content_type":"image/webp",
		"thumbnail_bytes":32,
		"thumb_object_key":"canvas-pending/key101/project-a/thumbs/asset-direct.webp",
		"width":640,
		"height":480
	}`)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/canvas/assets/complete", body)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: userID})

	handler.CompleteAsset(c)

	require.Equal(t, http.StatusCreated, w.Code, "body=%s", w.Body.String())
	require.Contains(t, w.Body.String(), `"id":"asset-direct"`)
	require.Contains(t, w.Body.String(), `"url":"https://r2.example.test/canvas/key101/project-a/assets/asset-direct.png"`)
	require.Contains(t, storage.deletedKeys, objectKey)
	require.Contains(t, storage.deletedKeys, thumbKey)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCanvasPromoteAssetCopiesOwnedTaskObjectWithoutBrowserUpload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	const userID int64 = 101
	const projectID = "project-a"
	sourceKey := "images/key101/task-1-0.png"
	storage := &canvasStorageStub{
		objectStats: map[string]service.ImageObjectMetadata{
			sourceKey: {Bytes: 4096, ContentType: "image/png"},
		},
		objectPrefix: map[string][]byte{
			sourceKey: canvasTestPNG[:min(16, len(canvasTestPNG))],
		},
	}
	handler := &CanvasHandler{
		db:         db,
		storage:    storage,
		identities: canvasIdentityStub{key: "key101"},
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT 1 FROM canvas_projects WHERE id = $1 AND user_id = $2
	`)).
		WithArgs(projectID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, project_id, node_id, kind, object_key, thumb_object_key,
		       width, height, bytes, mime_type, sha256, source_object_key, created_at
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = $2 AND source_object_key = $3
		LIMIT 1
	`)).
		WithArgs(userID, projectID, sourceKey).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectBegin()
	mock.ExpectExec(`SELECT pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)`).
		WithArgs("canvas-assets:101").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT COUNT(*), COALESCE(SUM(bytes), 0)
		FROM canvas_assets
		WHERE user_id = $1
	`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count", "bytes"}).AddRow(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO canvas_assets (
			id, user_id, project_id, node_id, kind, object_key, thumb_object_key,
			width, height, bytes, mime_type, sha256, source_object_key
		) VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,$9,$10,'',$11)
	`)).
		WithArgs(
			sqlmock.AnyArg(),
			userID,
			projectID,
			"node-a",
			"image",
			canvasObjectKeyMatcher{prefix: "canvas/key101/project-a/assets/"},
			640,
			480,
			int64(4096),
			"image/png",
			sourceKey,
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	body := strings.NewReader(`{
		"project_id":"project-a",
		"node_id":"node-a",
		"kind":"image",
		"source_object_key":"images/key101/task-1-0.png",
		"width":640,
		"height":480
	}`)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/canvas/assets/promote", body)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: userID})

	handler.PromoteAsset(c)

	require.Equal(t, http.StatusCreated, w.Code, "body=%s", w.Body.String())
	require.Len(t, storage.copied, 1)
	require.Equal(t, sourceKey, storage.copied[0][0])
	require.True(t, strings.HasPrefix(storage.copied[0][1], "canvas/key101/project-a/assets/"))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCanvasPromoteAssetReturnsExistingSourcePromotion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	const userID int64 = 101
	const projectID = "project-a"
	const sourceKey = "images/key101/task-1-0.png"
	storage := &canvasStorageStub{}
	handler := &CanvasHandler{
		db:         db,
		storage:    storage,
		identities: canvasIdentityStub{key: "key101"},
	}

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT 1 FROM canvas_projects WHERE id = $1 AND user_id = $2
	`)).
		WithArgs(projectID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, project_id, node_id, kind, object_key, thumb_object_key,
		       width, height, bytes, mime_type, sha256, source_object_key, created_at
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = $2 AND source_object_key = $3
		LIMIT 1
	`)).
		WithArgs(userID, projectID, sourceKey).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "project_id", "node_id", "kind", "object_key", "thumb_object_key",
			"width", "height", "bytes", "mime_type", "sha256", "source_object_key", "created_at",
		}).AddRow(
			"asset-existing", projectID, "node-a", "image",
			"canvas/key101/project-a/assets/asset-existing.png", "",
			640, 480, 4096, "image/png", "", sourceKey, time.Now(),
		))

	body := strings.NewReader(`{
		"project_id":"project-a",
		"node_id":"node-a",
		"kind":"image",
		"source_object_key":"images/key101/task-1-0.png",
		"width":640,
		"height":480
	}`)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/canvas/assets/promote", body)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: userID})

	handler.PromoteAsset(c)

	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())
	require.Contains(t, w.Body.String(), `"id":"asset-existing"`)
	require.Empty(t, storage.copied)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCanvasPutProjectCreatesNewProjectUnderPerUserQuotaLock(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	handler := &CanvasHandler{db: db, storage: &canvasStorageStub{}}
	const userID int64 = 101
	const projectID = "project-new"

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)`).
		WithArgs("canvas-projects:101").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(`
			SELECT COUNT(*) FROM canvas_projects WHERE user_id = $1
		`)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(regexp.QuoteMeta(`
			INSERT INTO canvas_projects (id, user_id, title, graph, version)
			VALUES ($1, $2, $3, $4::jsonb, 1)
			ON CONFLICT (id) DO NOTHING
			RETURNING version
		`)).
		WithArgs(projectID, userID, "画布", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow(1))
	mock.ExpectCommit()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/v1/canvas/projects/"+projectID,
		strings.NewReader(`{"title":"画布","graph":{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"k":1}},"version":0}`),
	)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{{Key: "id", Value: projectID}}
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: userID})

	handler.PutProject(c)

	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCanvasDeleteProjectDeletesRecordEvenWhenObjectCleanupFails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	storage := &canvasStorageStub{deleteErr: context.DeadlineExceeded}
	handler := &CanvasHandler{db: db, storage: storage}
	const userID int64 = 101
	const projectID = "project-delete"

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT object_key, thumb_object_key
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = $2
	`)).
		WithArgs(userID, projectID).
		WillReturnRows(sqlmock.NewRows([]string{"object_key", "thumb_object_key"}).
			AddRow("canvas/project.png", "canvas/project-thumb.webp"))
	mock.ExpectExec(regexp.QuoteMeta(`
		DELETE FROM canvas_projects WHERE id = $1 AND user_id = $2
	`)).
		WithArgs(projectID, userID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/v1/canvas/projects/"+projectID, nil)
	c.Params = gin.Params{{Key: "id", Value: projectID}}
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: userID})

	handler.DeleteProject(c)

	require.Equal(t, http.StatusOK, w.Code)
	require.ElementsMatch(t, []string{"canvas/project.png", "canvas/project-thumb.webp"}, storage.deletedKeys)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCanvasPutProjectReturnsConflictForStaleVersion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	handler := &CanvasHandler{db: db, storage: &canvasStorageStub{}}
	const userID int64 = 101
	const projectID = "project-a"

	mock.ExpectQuery(regexp.QuoteMeta(`
			UPDATE canvas_projects
			SET title = $3, graph = $4::jsonb, version = version + 1, updated_at = NOW()
			WHERE id = $1 AND user_id = $2 AND version = $5
			RETURNING version, updated_at
		`)).
		WithArgs(projectID, userID, "画布", sqlmock.AnyArg(), 3).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(`
			SELECT version FROM canvas_projects WHERE id = $1 AND user_id = $2
		`)).
		WithArgs(projectID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow(5))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/v1/canvas/projects/"+projectID,
		strings.NewReader(`{"title":"画布","graph":{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"k":1}},"version":3}`),
	)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{{Key: "id", Value: projectID}}
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: userID})

	handler.PutProject(c)

	require.Equal(t, http.StatusConflict, w.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTruncateCanvasTitleKeepsUTF8Valid(t *testing.T) {
	title := strings.Repeat("画", 205)
	truncated := truncateCanvasTitle(title, 200)

	require.Equal(t, strings.Repeat("画", 200), truncated)
	require.True(t, len([]rune(truncated)) == 200)
}

func TestCanvasCloudAssetReferences(t *testing.T) {
	graph := json.RawMessage(`{
		"nodes":[
			{"metadata":{"cloudAssetId":"asset-a","images":[
				{"cloudAssetId":"asset-b"},
				{"cloudAssetId":"asset-a"}
			]}},
			{"metadata":{"cloudAssetId":""}}
		]
	}`)

	references := canvasCloudAssetReferences(graph)

	require.Len(t, references, 2)
	require.Contains(t, references, "asset-a")
	require.Contains(t, references, "asset-b")
}

func TestCanvasPageClampsPagination(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/canvas/projects/full?limit=999&offset=-3", nil)

	limit, offset := canvasPage(c, canvasProjectPageSize, canvasProjectMaxPage)

	require.Equal(t, canvasProjectMaxPage, limit)
	require.Zero(t, offset)
}

func TestCanvasListProjectsFullQueriesAssetsOnlyForReturnedPage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	handler := &CanvasHandler{db: db, storage: &canvasStorageStub{}}
	const userID int64 = 101
	now := time.Now().UTC()

	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, title, graph, version, created_at, updated_at
		FROM canvas_projects
		WHERE user_id = $1
		ORDER BY updated_at DESC
		LIMIT $2 OFFSET $3
	`)).
		WithArgs(userID, canvasProjectPageSize, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "title", "graph", "version", "created_at", "updated_at",
		}).AddRow("project-a", "画布", []byte(`{"nodes":[]}`), 3, now, now))
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT id, project_id, node_id, kind, object_key, thumb_object_key,
		       width, height, bytes, mime_type, sha256, created_at
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = ANY($2)
		ORDER BY created_at ASC
	`)).
		WithArgs(userID, pq.Array([]string{"project-a"})).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "project_id", "node_id", "kind", "object_key", "thumb_object_key",
			"width", "height", "bytes", "mime_type", "sha256", "created_at",
		}))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/canvas/projects/full", nil)
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: userID})

	handler.ListProjectsFull(c)

	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

var canvasTestPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
}
