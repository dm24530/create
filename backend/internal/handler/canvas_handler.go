package handler

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"go.uber.org/zap"
)

const (
	maxCanvasProjectBytes = 12 << 20
	maxCanvasAssetBytes   = 128 << 20
	maxCanvasThumbBytes   = 4 << 20
	canvasProjectPageSize = 50
	canvasProjectMaxPage  = 100
	canvasProjectQuota    = 100
	canvasAssetCountQuota = 5000
	canvasAssetBytesQuota = int64(2 << 30)
)

var canvasIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type CanvasAssetStorage interface {
	SaveImageWithKey(ctx context.Context, key, contentType string, data []byte) (string, string, error)
	SaveImageWithFullKey(ctx context.Context, key, contentType string, data []byte) (string, string, error)
	DeleteObject(ctx context.Context, key string) error
	PresignImageObject(ctx context.Context, objectKey string) (string, error)
	FetchImageURL(ctx context.Context, rawURL string) ([]byte, string, error)
}

type canvasQueryRower interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type CanvasHandler struct {
	db         *sql.DB
	storage    CanvasAssetStorage
	identities service.UserStorageIdentityResolver
}

type CanvasProjectSummary struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type CanvasProjectRecord struct {
	CanvasProjectSummary
	Graph  json.RawMessage `json:"graph"`
	Assets []CanvasAsset   `json:"assets"`
}

type CanvasAsset struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"project_id"`
	NodeID    string    `json:"node_id"`
	Kind      string    `json:"kind"`
	URL       string    `json:"url"`
	ThumbURL  string    `json:"thumb_url,omitempty"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	Bytes     int64     `json:"bytes"`
	MimeType  string    `json:"mime_type"`
	SHA256    string    `json:"sha256,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	objectKey string
	thumbKey  string
}

type putCanvasProjectRequest struct {
	Title   string          `json:"title"`
	Graph   json.RawMessage `json:"graph"`
	Version int             `json:"version"`
}

func NewCanvasHandler(
	db *sql.DB,
	storage *service.ImageStorageSettingService,
	identities service.UserStorageIdentityResolver,
) *CanvasHandler {
	return &CanvasHandler{db: db, storage: storage, identities: identities}
}

// ProxyImage keeps canvas image references readable when an object store
// enables signed image rendering but does not allow browser-side cross-origin
// fetch. The authenticated endpoint returns the bytes from our own origin so
// reference images can be converted to request payloads reliably.
func (h *CanvasHandler) ProxyImage(c *gin.Context) {
	if _, ok := h.userID(c); !ok {
		return
	}
	rawURL := strings.TrimSpace(c.Query("url"))
	if rawURL == "" {
		response.BadRequest(c, "缺少图片地址")
		return
	}
	if !strings.HasPrefix(rawURL, "http://") &&
		!strings.HasPrefix(rawURL, "https://") &&
		!strings.HasPrefix(rawURL, service.LocalImageAssetURLPrefix) {
		response.BadRequest(c, "不支持的图片地址")
		return
	}
	data, contentType, err := h.storage.FetchImageURL(c.Request.Context(), rawURL)
	if err != nil || len(data) == 0 {
		logger.L().Warn("canvas.image_proxy_failed", zap.Error(err))
		response.Error(c, http.StatusBadGateway, "拉取图片失败")
		return
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = http.DetectContentType(data)
	}
	if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		response.Error(c, http.StatusBadGateway, "图片地址返回了非图片内容")
		return
	}
	c.Header("Cache-Control", "private, max-age=300")
	c.Data(http.StatusOK, contentType, data)
}

func (h *CanvasHandler) ListProjects(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	limit, offset := canvasPage(c, canvasProjectPageSize, canvasProjectMaxPage)
	rows, err := h.db.QueryContext(c.Request.Context(), `
		SELECT id, title, version, created_at, updated_at
		FROM canvas_projects
		WHERE user_id = $1
		ORDER BY updated_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		response.InternalError(c, "读取画布项目失败")
		return
	}
	defer func() { _ = rows.Close() }()
	items := make([]CanvasProjectSummary, 0)
	for rows.Next() {
		var item CanvasProjectSummary
		if err := rows.Scan(&item.ID, &item.Title, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			response.InternalError(c, "读取画布项目失败")
			return
		}
		items = append(items, item)
	}
	response.Success(c, items)
}

// ListProjectsFull returns complete project records and all referenced assets
// in a bounded page without requiring one request per project from the client.
func (h *CanvasHandler) ListProjectsFull(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	limit, offset := canvasPage(c, canvasProjectPageSize, canvasProjectMaxPage)
	rows, err := h.db.QueryContext(c.Request.Context(), `
		SELECT id, title, graph, version, created_at, updated_at
		FROM canvas_projects
		WHERE user_id = $1
		ORDER BY updated_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		response.InternalError(c, "读取画布项目失败")
		return
	}
	defer func() { _ = rows.Close() }()
	items := make([]*CanvasProjectRecord, 0, limit)
	byID := make(map[string]*CanvasProjectRecord, limit)
	for rows.Next() {
		item := &CanvasProjectRecord{Assets: []CanvasAsset{}}
		if err := rows.Scan(
			&item.ID,
			&item.Title,
			&item.Graph,
			&item.Version,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			response.InternalError(c, "读取画布项目失败")
			return
		}
		items = append(items, item)
		byID[item.ID] = item
	}
	if err := rows.Err(); err != nil {
		response.InternalError(c, "读取画布项目失败")
		return
	}
	if len(items) == 0 {
		response.Success(c, items)
		return
	}

	projectIDs := make([]string, 0, len(items))
	for _, item := range items {
		projectIDs = append(projectIDs, item.ID)
	}
	assetRows, err := h.db.QueryContext(c.Request.Context(), `
		SELECT id, project_id, node_id, kind, object_key, thumb_object_key,
		       width, height, bytes, mime_type, sha256, created_at
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = ANY($2)
		ORDER BY created_at ASC
	`, userID, pq.Array(projectIDs))
	if err != nil {
		response.InternalError(c, "读取画布资产失败")
		return
	}
	defer func() { _ = assetRows.Close() }()
	for assetRows.Next() {
		var item CanvasAsset
		var objectKey, thumbKey string
		if err := assetRows.Scan(
			&item.ID, &item.ProjectID, &item.NodeID, &item.Kind, &objectKey, &thumbKey,
			&item.Width, &item.Height, &item.Bytes, &item.MimeType, &item.SHA256, &item.CreatedAt,
		); err != nil {
			response.InternalError(c, "读取画布资产失败")
			return
		}
		project := byID[item.ProjectID]
		if project == nil {
			continue
		}
		if resolved, resolveErr := h.storage.PresignImageObject(c.Request.Context(), objectKey); resolveErr == nil {
			item.URL = resolved
		}
		if thumbKey != "" {
			if resolved, resolveErr := h.storage.PresignImageObject(c.Request.Context(), thumbKey); resolveErr == nil {
				item.ThumbURL = resolved
			}
		}
		project.Assets = append(project.Assets, item)
	}
	if err := assetRows.Err(); err != nil {
		response.InternalError(c, "读取画布资产失败")
		return
	}
	response.Success(c, items)
}

func (h *CanvasHandler) GetProject(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	projectID := strings.TrimSpace(c.Param("id"))
	if !canvasIDPattern.MatchString(projectID) {
		response.BadRequest(c, "画布项目 ID 无效")
		return
	}
	var project CanvasProjectRecord
	err := h.db.QueryRowContext(c.Request.Context(), `
		SELECT id, title, graph, version, created_at, updated_at
		FROM canvas_projects
		WHERE id = $1 AND user_id = $2
	`, projectID, userID).Scan(
		&project.ID,
		&project.Title,
		&project.Graph,
		&project.Version,
		&project.CreatedAt,
		&project.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		response.NotFound(c, "画布项目不存在")
		return
	}
	if err != nil {
		response.InternalError(c, "读取画布项目失败")
		return
	}
	assets, err := h.listProjectAssets(c.Request.Context(), userID, projectID)
	if err != nil {
		response.InternalError(c, "读取画布资产失败")
		return
	}
	project.Assets = assets
	response.Success(c, project)
}

func (h *CanvasHandler) PutProject(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	projectID := strings.TrimSpace(c.Param("id"))
	if !canvasIDPattern.MatchString(projectID) {
		response.BadRequest(c, "画布项目 ID 无效")
		return
	}
	var request putCanvasProjectRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "画布数据格式无效")
		return
	}
	if len(request.Graph) == 0 || len(request.Graph) > maxCanvasProjectBytes || !json.Valid(request.Graph) {
		response.BadRequest(c, "画布节点数据无效或过大")
		return
	}
	title := strings.TrimSpace(request.Title)
	title = truncateCanvasTitle(title, 200)
	ctx := c.Request.Context()
	if request.Version <= 0 {
		tx, err := h.db.BeginTx(ctx, nil)
		if err != nil {
			response.InternalError(c, "保存画布项目失败")
			return
		}
		defer func() { _ = tx.Rollback() }()
		if err := lockCanvasQuota(ctx, tx, "canvas-projects", userID); err != nil {
			response.InternalError(c, "读取画布项目额度失败")
			return
		}
		var projectCount int
		if err := tx.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM canvas_projects WHERE user_id = $1
		`, userID).Scan(&projectCount); err != nil {
			response.InternalError(c, "读取画布项目额度失败")
			return
		}
		if projectCount >= canvasProjectQuota {
			response.Error(c, http.StatusTooManyRequests, "画布项目数量已达上限")
			return
		}
		var version int
		err = tx.QueryRowContext(ctx, `
			INSERT INTO canvas_projects (id, user_id, title, graph, version)
			VALUES ($1, $2, $3, $4::jsonb, 1)
			ON CONFLICT (id) DO NOTHING
			RETURNING version
		`, projectID, userID, title, string(request.Graph)).Scan(&version)
		if errors.Is(err, sql.ErrNoRows) {
			response.Error(c, http.StatusConflict, "画布项目已在其他设备创建")
			return
		}
		if err != nil {
			response.InternalError(c, "保存画布项目失败")
			return
		}
		if err := tx.Commit(); err != nil {
			response.InternalError(c, "保存画布项目失败")
			return
		}
		h.scheduleUnreferencedAssetCleanup(c.Request.Context(), userID, projectID, request.Graph)
		response.Success(c, gin.H{"id": projectID, "version": version})
		return
	}
	var version int
	var updatedAt time.Time
	err := h.db.QueryRowContext(ctx, `
		UPDATE canvas_projects
		SET title = $3, graph = $4::jsonb, version = version + 1, updated_at = NOW()
		WHERE id = $1 AND user_id = $2 AND version = $5
		RETURNING version, updated_at
	`, projectID, userID, title, string(request.Graph), request.Version).Scan(&version, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		currentVersion := 0
		_ = h.db.QueryRowContext(ctx, `
			SELECT version FROM canvas_projects WHERE id = $1 AND user_id = $2
		`, projectID, userID).Scan(&currentVersion)
		logger.L().Warn("canvas.project_version_conflict",
			zap.Int64("user_id", userID),
			zap.String("project_id", projectID),
			zap.Int("client_version", request.Version),
			zap.Int("current_version", currentVersion))
		response.Error(c, http.StatusConflict, "画布版本已变化，请刷新后重试")
		return
	}
	if err != nil {
		response.InternalError(c, "保存画布项目失败")
		return
	}
	h.scheduleUnreferencedAssetCleanup(c.Request.Context(), userID, projectID, request.Graph)
	response.Success(c, gin.H{"id": projectID, "version": version, "updated_at": updatedAt})
}

func (h *CanvasHandler) DeleteProject(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	projectID := strings.TrimSpace(c.Param("id"))
	if !canvasIDPattern.MatchString(projectID) {
		response.BadRequest(c, "画布项目 ID 无效")
		return
	}
	keys, keysErr := h.projectObjectKeys(c.Request.Context(), userID, projectID)
	if keysErr != nil {
		response.InternalError(c, "读取画布资产失败")
		return
	}
	result, err := h.db.ExecContext(c.Request.Context(), `
		DELETE FROM canvas_projects WHERE id = $1 AND user_id = $2
	`, projectID, userID)
	if err != nil {
		response.InternalError(c, "删除画布项目失败")
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		response.NotFound(c, "画布项目不存在")
		return
	}
	for _, key := range keys {
		if err := h.storage.DeleteObject(c.Request.Context(), key); err != nil {
			logger.L().Warn("canvas.project_object_cleanup_failed",
				zap.Int64("user_id", userID),
				zap.String("project_id", projectID),
				zap.String("object_key", key),
				zap.Error(err))
		}
	}
	response.Success(c, gin.H{"deleted": true})
}

func (h *CanvasHandler) UploadAsset(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxCanvasAssetBytes+maxCanvasThumbBytes+(8<<20))
	if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
		response.BadRequest(c, "画布资产上传数据无效或过大")
		return
	}
	projectID := strings.TrimSpace(c.PostForm("project_id"))
	nodeID := strings.TrimSpace(c.PostForm("node_id"))
	kind := strings.TrimSpace(c.PostForm("kind"))
	if !canvasIDPattern.MatchString(projectID) {
		response.BadRequest(c, "画布项目 ID 无效")
		return
	}
	if len(nodeID) > 128 {
		nodeID = nodeID[:128]
	}
	if kind == "" {
		kind = "image"
	}
	if !h.ownsProject(c.Request.Context(), userID, projectID) {
		response.NotFound(c, "画布项目不存在")
		return
	}
	var data []byte
	var contentType string
	var filename string
	var err error
	file, header, fileErr := c.Request.FormFile("file")
	if fileErr == nil {
		defer func() { _ = file.Close() }()
		data, err = io.ReadAll(io.LimitReader(file, maxCanvasAssetBytes+1))
		if err != nil || len(data) == 0 || len(data) > maxCanvasAssetBytes {
			response.BadRequest(c, "画布资产文件为空或过大")
			return
		}
		filename = header.Filename
		contentType = strings.TrimSpace(header.Header.Get("Content-Type"))
	} else {
		sourceURL := strings.TrimSpace(c.PostForm("source_url"))
		if sourceURL == "" {
			response.BadRequest(c, "缺少画布资产文件")
			return
		}
		data, contentType, err = h.storage.FetchImageURL(c.Request.Context(), sourceURL)
		if err != nil || len(data) == 0 || len(data) > maxCanvasAssetBytes {
			response.BadRequest(c, "拉取画布资产失败或文件过大")
			return
		}
		filename = "remote-image"
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = http.DetectContentType(data)
	}
	if !isCanvasMimeType(contentType) {
		response.BadRequest(c, "不支持的画布资产类型")
		return
	}
	sum := sha256.Sum256(data)
	digest := hex.EncodeToString(sum[:])
	if existing := h.findCanvasAssetByHash(c.Request.Context(), userID, projectID, nodeID, digest); existing != nil {
		response.Success(c, *existing)
		return
	}

	assetID := strings.ReplaceAll(uuid.NewString(), "-", "")
	extension := canvasFileExtension(filename, contentType)
	storageKey, err := h.userStorageKey(c.Request.Context(), userID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	objectKey := canvasAssetObjectKey(storageKey, projectID, assetID, extension)
	url, storedKey, err := h.storage.SaveImageWithFullKey(c.Request.Context(), objectKey, contentType, data)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	thumbURL := ""
	storedThumbKey := ""
	if thumbFile, thumbHeader, thumbErr := c.Request.FormFile("thumbnail"); thumbErr == nil {
		thumbData, readErr := io.ReadAll(io.LimitReader(thumbFile, maxCanvasThumbBytes+1))
		_ = thumbFile.Close()
		if readErr == nil && len(thumbData) > 0 && len(thumbData) <= maxCanvasThumbBytes {
			thumbType := strings.TrimSpace(thumbHeader.Header.Get("Content-Type"))
			if !strings.HasPrefix(thumbType, "image/") {
				thumbType = http.DetectContentType(thumbData)
			}
			thumbExtension := canvasFileExtension("", thumbType)
			thumbKey := canvasAssetThumbKey(storageKey, projectID, assetID, thumbExtension)
			thumbURL, storedThumbKey, _ = h.storage.SaveImageWithFullKey(c.Request.Context(), thumbKey, thumbType, thumbData)
		}
	}
	tx, err := h.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		h.deleteCanvasObjects(c.Request.Context(), storedKey, storedThumbKey)
		response.InternalError(c, "保存画布资产失败")
		return
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockCanvasQuota(c.Request.Context(), tx, "canvas-assets", userID); err != nil {
		h.deleteCanvasObjects(c.Request.Context(), storedKey, storedThumbKey)
		response.InternalError(c, "读取画布存储额度失败")
		return
	}
	var assetCount int
	var storedBytes int64
	if err := tx.QueryRowContext(c.Request.Context(), `
		SELECT COUNT(*), COALESCE(SUM(bytes), 0)
		FROM canvas_assets
		WHERE user_id = $1
	`, userID).Scan(&assetCount, &storedBytes); err != nil {
		h.deleteCanvasObjects(c.Request.Context(), storedKey, storedThumbKey)
		response.InternalError(c, "读取画布存储额度失败")
		return
	}
	if assetCount >= canvasAssetCountQuota || storedBytes+int64(len(data)) > canvasAssetBytesQuota {
		h.deleteCanvasObjects(c.Request.Context(), storedKey, storedThumbKey)
		response.Error(c, http.StatusTooManyRequests, "画布存储空间已达上限")
		return
	}
	if existing := findCanvasAssetByHashIn(c.Request.Context(), tx, h.storage, userID, projectID, nodeID, digest); existing != nil {
		h.deleteCanvasObjects(c.Request.Context(), storedKey, storedThumbKey)
		response.Success(c, *existing)
		return
	}
	if _, err = tx.ExecContext(c.Request.Context(), `
		INSERT INTO canvas_assets (
			id, user_id, project_id, node_id, kind, object_key, thumb_object_key,
			width, height, bytes, mime_type, sha256
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
	`, assetID, userID, projectID, nodeID, kind, storedKey, storedThumbKey,
		parseCanvasInt(c.PostForm("width")), parseCanvasInt(c.PostForm("height")),
		len(data), contentType, digest); err != nil {
		h.deleteCanvasObjects(c.Request.Context(), storedKey, storedThumbKey)
		response.InternalError(c, "保存画布资产失败")
		return
	}
	if err := tx.Commit(); err != nil {
		h.deleteCanvasObjects(c.Request.Context(), storedKey, storedThumbKey)
		response.InternalError(c, "保存画布资产失败")
		return
	}
	response.Created(c, CanvasAsset{
		ID:        assetID,
		ProjectID: projectID,
		NodeID:    nodeID,
		Kind:      kind,
		URL:       url,
		ThumbURL:  thumbURL,
		Width:     parseCanvasInt(c.PostForm("width")),
		Height:    parseCanvasInt(c.PostForm("height")),
		Bytes:     int64(len(data)),
		MimeType:  contentType,
		CreatedAt: time.Now().UTC(),
	})
}

func (h *CanvasHandler) DeleteAsset(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	assetID := strings.TrimSpace(c.Param("id"))
	if !canvasIDPattern.MatchString(assetID) {
		response.BadRequest(c, "画布资产 ID 无效")
		return
	}
	var objectKey, thumbKey string
	err := h.db.QueryRowContext(c.Request.Context(), `
		SELECT object_key, thumb_object_key
		FROM canvas_assets
		WHERE id = $1 AND user_id = $2
	`, assetID, userID).Scan(&objectKey, &thumbKey)
	if errors.Is(err, sql.ErrNoRows) {
		response.NotFound(c, "画布资产不存在")
		return
	}
	if err != nil {
		response.InternalError(c, "读取画布资产失败")
		return
	}
	result, err := h.db.ExecContext(c.Request.Context(), `
		DELETE FROM canvas_assets WHERE id = $1 AND user_id = $2
	`, assetID, userID)
	if err != nil {
		response.InternalError(c, "删除画布资产失败")
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		response.NotFound(c, "画布资产不存在")
		return
	}
	h.deleteCanvasObjects(c.Request.Context(), objectKey, thumbKey)
	response.Success(c, gin.H{"deleted": true})
}

func (h *CanvasHandler) listProjectAssets(ctx context.Context, userID int64, projectID string) ([]CanvasAsset, error) {
	rows, err := h.db.QueryContext(ctx, `
		SELECT id, project_id, node_id, kind, object_key, thumb_object_key,
		       width, height, bytes, mime_type, sha256, created_at
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = $2
		ORDER BY created_at ASC
	`, userID, projectID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]CanvasAsset, 0)
	for rows.Next() {
		var item CanvasAsset
		var objectKey, thumbKey string
		if err := rows.Scan(
			&item.ID, &item.ProjectID, &item.NodeID, &item.Kind, &objectKey, &thumbKey,
			&item.Width, &item.Height, &item.Bytes, &item.MimeType, &item.SHA256, &item.CreatedAt,
		); err != nil {
			return nil, err
		}
		item.objectKey = objectKey
		item.thumbKey = thumbKey
		if resolved, resolveErr := h.storage.PresignImageObject(ctx, objectKey); resolveErr == nil {
			item.URL = resolved
		}
		if thumbKey != "" {
			if resolved, resolveErr := h.storage.PresignImageObject(ctx, thumbKey); resolveErr == nil {
				item.ThumbURL = resolved
			}
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (h *CanvasHandler) projectObjectKeys(ctx context.Context, userID int64, projectID string) ([]string, error) {
	rows, err := h.db.QueryContext(ctx, `
		SELECT object_key, thumb_object_key
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = $2
	`, userID, projectID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	keys := make([]string, 0)
	for rows.Next() {
		var objectKey, thumbKey string
		if err := rows.Scan(&objectKey, &thumbKey); err != nil {
			return nil, err
		}
		keys = append(keys, objectKey)
		if thumbKey != "" {
			keys = append(keys, thumbKey)
		}
	}
	return keys, rows.Err()
}

func (h *CanvasHandler) scheduleUnreferencedAssetCleanup(
	parent context.Context,
	userID int64,
	projectID string,
	graph json.RawMessage,
) {
	referenced := canvasCloudAssetReferences(graph)
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), 30*time.Second)
	go func() {
		defer cancel()
		if err := h.cleanupUnreferencedAssets(ctx, userID, projectID, referenced); err != nil {
			logger.L().Warn("canvas.asset_cleanup_failed",
				zap.Int64("user_id", userID),
				zap.String("project_id", projectID),
				zap.Error(err))
		}
	}()
}

func (h *CanvasHandler) cleanupUnreferencedAssets(
	ctx context.Context,
	userID int64,
	projectID string,
	referenced map[string]struct{},
) error {
	rows, err := h.db.QueryContext(ctx, `
		SELECT id, object_key, thumb_object_key
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = $2
		  AND created_at < NOW() - INTERVAL '1 hour'
	`, userID, projectID)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	type orphan struct {
		id        string
		object    string
		thumbnail string
	}
	orphans := make([]orphan, 0)
	for rows.Next() {
		var item orphan
		if err := rows.Scan(&item.id, &item.object, &item.thumbnail); err != nil {
			return err
		}
		if _, used := referenced[item.id]; used {
			continue
		}
		orphans = append(orphans, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range orphans {
		if err := h.storage.DeleteObject(ctx, item.object); err != nil {
			return err
		}
		if item.thumbnail != "" {
			if err := h.storage.DeleteObject(ctx, item.thumbnail); err != nil {
				return err
			}
		}
		if _, err := h.db.ExecContext(ctx, `
			DELETE FROM canvas_assets WHERE id = $1 AND user_id = $2
		`, item.id, userID); err != nil {
			return err
		}
	}
	return nil
}

func canvasCloudAssetReferences(graph json.RawMessage) map[string]struct{} {
	references := make(map[string]struct{})
	var value any
	if json.Unmarshal(graph, &value) != nil {
		return references
	}
	var walk func(any)
	walk = func(current any) {
		switch typed := current.(type) {
		case map[string]any:
			for key, child := range typed {
				if key == "cloudAssetId" {
					if id, ok := child.(string); ok && strings.TrimSpace(id) != "" {
						references[id] = struct{}{}
					}
					continue
				}
				walk(child)
			}
		case []any:
			for _, child := range typed {
				walk(child)
			}
		}
	}
	walk(value)
	return references
}

func (h *CanvasHandler) findCanvasAssetByHash(
	ctx context.Context,
	userID int64,
	projectID string,
	nodeID string,
	digest string,
) *CanvasAsset {
	return findCanvasAssetByHashIn(ctx, h.db, h.storage, userID, projectID, nodeID, digest)
}

func findCanvasAssetByHashIn(
	ctx context.Context,
	queryer canvasQueryRower,
	storage CanvasAssetStorage,
	userID int64,
	projectID string,
	nodeID string,
	digest string,
) *CanvasAsset {
	if digest == "" {
		return nil
	}
	var item CanvasAsset
	var objectKey, thumbKey string
	err := queryer.QueryRowContext(ctx, `
		SELECT id, project_id, node_id, kind, object_key, thumb_object_key,
		       width, height, bytes, mime_type, sha256, created_at
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = $2 AND node_id = $3 AND sha256 = $4
		ORDER BY created_at ASC
		LIMIT 1
	`, userID, projectID, nodeID, digest).Scan(
		&item.ID, &item.ProjectID, &item.NodeID, &item.Kind, &objectKey, &thumbKey,
		&item.Width, &item.Height, &item.Bytes, &item.MimeType, &item.SHA256, &item.CreatedAt,
	)
	if err != nil {
		return nil
	}
	if resolved, resolveErr := storage.PresignImageObject(ctx, objectKey); resolveErr == nil {
		item.URL = resolved
	}
	if thumbKey != "" {
		if resolved, resolveErr := storage.PresignImageObject(ctx, thumbKey); resolveErr == nil {
			item.ThumbURL = resolved
		}
	}
	return &item
}

func lockCanvasQuota(ctx context.Context, tx *sql.Tx, scope string, userID int64) error {
	_, err := tx.ExecContext(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		fmt.Sprintf("%s:%d", scope, userID),
	)
	return err
}

func (h *CanvasHandler) deleteCanvasObjects(ctx context.Context, keys ...string) {
	for _, key := range keys {
		if strings.TrimSpace(key) == "" {
			continue
		}
		if err := h.storage.DeleteObject(ctx, key); err != nil {
			logger.L().Warn("canvas.object_cleanup_failed",
				zap.String("object_key", key),
				zap.Error(err))
		}
	}
}

func (h *CanvasHandler) ownsProject(ctx context.Context, userID int64, projectID string) bool {
	var exists int
	return h.db.QueryRowContext(ctx, `
		SELECT 1 FROM canvas_projects WHERE id = $1 AND user_id = $2
	`, projectID, userID).Scan(&exists) == nil
}

func (h *CanvasHandler) userID(c *gin.Context) (int64, bool) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return 0, false
	}
	return subject.UserID, true
}

func (h *CanvasHandler) userStorageKey(ctx context.Context, userID int64) (string, error) {
	if h.identities != nil {
		return h.identities.StorageKey(ctx, userID)
	}
	// Tests and legacy callers that only construct the handler struct keep the
	// numeric fallback. Production wiring always supplies the resolver.
	return strconv.FormatInt(userID, 10), nil
}

func canvasFileExtension(filename, contentType string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext != "" && len(ext) <= 8 {
		return ext
	}
	if extensions, err := mime.ExtensionsByType(contentType); err == nil && len(extensions) > 0 {
		return extensions[0]
	}
	return ".bin"
}

func isCanvasMimeType(contentType string) bool {
	return strings.HasPrefix(contentType, "image/") ||
		strings.HasPrefix(contentType, "video/") ||
		strings.HasPrefix(contentType, "audio/")
}

func parseCanvasInt(value string) int {
	var number int
	_, _ = fmt.Sscan(strings.TrimSpace(value), &number)
	if number < 0 {
		return 0
	}
	return number
}

func truncateCanvasTitle(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func canvasPage(c *gin.Context, defaultLimit, maxLimit int) (int, int) {
	limit, _ := strconv.Atoi(strings.TrimSpace(c.Query("limit")))
	offset, _ := strconv.Atoi(strings.TrimSpace(c.Query("offset")))
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func canvasAssetObjectKey(storageKey, projectID, assetID, extension string) string {
	return fmt.Sprintf("canvas/%s/%s/assets/%s%s", storageKey, projectID, assetID, extension)
}

func canvasAssetThumbKey(storageKey, projectID, assetID, extension string) string {
	return fmt.Sprintf("canvas/%s/%s/thumbs/%s%s", storageKey, projectID, assetID, extension)
}
