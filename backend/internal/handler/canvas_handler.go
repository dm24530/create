package handler

import (
	"bytes"
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
	"net/url"
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
	maxCanvasProjectBytes   = 12 << 20
	maxCanvasAssetBytes     = 128 << 20
	maxCanvasThumbBytes     = 4 << 20
	canvasProjectPageSize   = 50
	canvasProjectMaxPage    = 100
	canvasProjectQuota      = 100
	canvasAssetCountQuota   = 5000
	canvasAssetBytesQuota   = int64(2 << 30)
	canvasUploadIntentLimit = 32
	canvasUploadIntentTTL   = 20 * time.Minute
	canvasPublicAssetPrefix = "/api/v1/public/canvas-assets/"
)

var canvasIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
var (
	errCanvasUploadIntentLimit = errors.New("too many pending canvas uploads")
	errCanvasUploadStorageFull = errors.New("canvas storage quota exceeded")
)

type CanvasAssetStorage interface {
	SaveImageWithKey(ctx context.Context, key, contentType string, data []byte) (string, string, error)
	SaveImageWithFullKey(ctx context.Context, key, contentType string, data []byte) (string, string, error)
	DeleteObject(ctx context.Context, key string) error
	PresignImageObject(ctx context.Context, objectKey string) (string, error)
	PresignImageUpload(ctx context.Context, objectKey, contentType string) (service.ImageStorageUploadRequest, error)
	ImageObjectStat(ctx context.Context, objectKey string) (service.ImageObjectMetadata, error)
	ReadImageObjectPrefix(ctx context.Context, objectKey string, length int64) ([]byte, error)
	CopyImageObject(ctx context.Context, sourceKey, targetKey, contentType string) error
	FetchImageURL(ctx context.Context, rawURL string) ([]byte, string, error)
	OpenMediaURL(ctx context.Context, rawURL string) (io.ReadCloser, string, error)
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
	ID              string    `json:"id"`
	Title           string    `json:"title"`
	Version         int       `json:"version"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	NodeCount       int       `json:"node_count,omitempty"`
	ConnectionCount int       `json:"connection_count,omitempty"`
}

type CanvasProjectRecord struct {
	CanvasProjectSummary
	Graph  json.RawMessage `json:"graph"`
	Assets []CanvasAsset   `json:"assets"`
}

type CanvasAsset struct {
	ID              string    `json:"id"`
	ProjectID       string    `json:"project_id"`
	NodeID          string    `json:"node_id"`
	Kind            string    `json:"kind"`
	URL             string    `json:"url"`
	ThumbURL        string    `json:"thumb_url,omitempty"`
	Width           int       `json:"width"`
	Height          int       `json:"height"`
	Bytes           int64     `json:"bytes"`
	MimeType        string    `json:"mime_type"`
	SHA256          string    `json:"sha256,omitempty"`
	SourceObjectKey string    `json:"source_object_key,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	objectKey       string
	thumbKey        string
}

type putCanvasProjectRequest struct {
	Title   string          `json:"title"`
	Graph   json.RawMessage `json:"graph"`
	Version int             `json:"version"`
}

type presignCanvasAssetRequest struct {
	ProjectID            string `json:"project_id"`
	NodeID               string `json:"node_id"`
	Kind                 string `json:"kind"`
	Filename             string `json:"filename"`
	ContentType          string `json:"content_type"`
	Bytes                int64  `json:"bytes"`
	ThumbnailContentType string `json:"thumbnail_content_type"`
	ThumbnailBytes       int64  `json:"thumbnail_bytes"`
	SHA256               string `json:"sha256"`
}

type completeCanvasAssetRequest struct {
	AssetID              string `json:"asset_id"`
	ProjectID            string `json:"project_id"`
	NodeID               string `json:"node_id"`
	Kind                 string `json:"kind"`
	Filename             string `json:"filename"`
	ContentType          string `json:"content_type"`
	Bytes                int64  `json:"bytes"`
	ObjectKey            string `json:"object_key"`
	ThumbnailContentType string `json:"thumbnail_content_type"`
	ThumbnailBytes       int64  `json:"thumbnail_bytes"`
	ThumbObjectKey       string `json:"thumb_object_key"`
	Width                int    `json:"width"`
	Height               int    `json:"height"`
	SHA256               string `json:"sha256"`
}

type promoteCanvasAssetRequest struct {
	ProjectID       string `json:"project_id"`
	NodeID          string `json:"node_id"`
	Kind            string `json:"kind"`
	SourceObjectKey string `json:"source_object_key"`
	Width           int    `json:"width"`
	Height          int    `json:"height"`
}

type canvasUploadIntent struct {
	AssetID       string
	UserID        int64
	ProjectID     string
	NodeID        string
	Kind          string
	ObjectKey     string
	ThumbKey      string
	Bytes         int64
	ThumbBytes    int64
	MimeType      string
	ThumbMimeType string
	SHA256        string
	ExpiresAt     time.Time
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
	if !strings.HasPrefix(rawURL, service.LocalImageAssetURLPrefix) {
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

// PublicAssetContent serves a canvas asset through an opaque asset ID. The
// object-storage address is resolved and fetched server-side only.
func (h *CanvasHandler) PublicAssetContent(c *gin.Context) {
	assetID := strings.TrimSpace(c.Param("asset_id"))
	if !canvasIDPattern.MatchString(assetID) {
		response.NotFound(c, "画布资产不存在")
		return
	}
	variant := strings.ToLower(strings.TrimSpace(c.Param("variant")))
	if variant != "content" && variant != "thumb" {
		response.NotFound(c, "画布资产不存在")
		return
	}
	var objectKey, thumbKey, mimeType string
	err := h.db.QueryRowContext(c.Request.Context(), `
		SELECT object_key, thumb_object_key, mime_type
		FROM canvas_assets
		WHERE id = $1
	`, assetID).Scan(&objectKey, &thumbKey, &mimeType)
	if errors.Is(err, sql.ErrNoRows) {
		response.NotFound(c, "画布资产不存在")
		return
	}
	if err != nil {
		response.InternalError(c, "读取画布资产失败")
		return
	}
	if variant == "thumb" {
		objectKey = thumbKey
		mimeType = "image/jpeg"
	}
	if strings.TrimSpace(objectKey) == "" {
		response.NotFound(c, "画布资产不存在")
		return
	}
	target, err := h.storage.PresignImageObject(c.Request.Context(), objectKey)
	if err != nil || strings.TrimSpace(target) == "" {
		response.Error(c, http.StatusBadGateway, "画布资产暂时不可用")
		return
	}
	stream, contentType, err := h.storage.OpenMediaURL(c.Request.Context(), target)
	if err != nil {
		response.Error(c, http.StatusBadGateway, "画布资产暂时不可用")
		return
	}
	defer func() { _ = stream.Close() }()
	if strings.TrimSpace(contentType) == "" {
		contentType = mimeType
	}
	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", "inline")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, stream)
}

func (h *CanvasHandler) ListProjects(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	limit, offset := canvasPage(c, canvasProjectPageSize, canvasProjectMaxPage)
	rows, err := h.db.QueryContext(c.Request.Context(), `
		SELECT id, title, version, created_at, updated_at,
		       COALESCE(jsonb_array_length(graph->'nodes'), 0),
		       COALESCE(jsonb_array_length(graph->'connections'), 0)
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
		if err := rows.Scan(
			&item.ID,
			&item.Title,
			&item.Version,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.NodeCount,
			&item.ConnectionCount,
		); err != nil {
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
		item.Graph = sanitizeCanvasGraphURLs(item.Graph)
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
		item.URL = canvasPublicAssetURL(item.ID, "content")
		if thumbKey != "" {
			item.ThumbURL = canvasPublicAssetURL(item.ID, "thumb")
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
	request.Graph = sanitizeCanvasGraphURLs(request.Graph)
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

// PresignAsset creates browser-to-R2 upload URLs without moving file bytes
// through the application process.
func (h *CanvasHandler) PresignAsset(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
	var request presignCanvasAssetRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "画布资产上传参数无效")
		return
	}
	projectID := strings.TrimSpace(request.ProjectID)
	nodeID := truncateCanvasNodeID(request.NodeID)
	kind, contentType, err := normalizeCanvasAssetInput(request.Kind, request.ContentType)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if !canvasIDPattern.MatchString(projectID) {
		response.BadRequest(c, "画布项目 ID 无效")
		return
	}
	if request.Bytes <= 0 || request.Bytes > maxCanvasAssetBytes {
		response.BadRequest(c, "画布资产文件为空或过大")
		return
	}
	if !h.ownsProject(c.Request.Context(), userID, projectID) {
		response.NotFound(c, "画布项目不存在")
		return
	}
	digest := normalizeCanvasSHA256(request.SHA256)
	if digest != "" {
		if existing := h.findCanvasAssetByHash(c.Request.Context(), userID, projectID, nodeID, digest); existing != nil {
			response.Success(c, gin.H{"existing": *existing})
			return
		}
	}

	thumbType := ""
	pendingThumbKey := ""
	if strings.TrimSpace(request.ThumbnailContentType) != "" || request.ThumbnailBytes > 0 {
		if request.ThumbnailBytes <= 0 || request.ThumbnailBytes > maxCanvasThumbBytes {
			response.BadRequest(c, "画布缩略图为空或过大")
			return
		}
		thumbType, _, err = normalizeCanvasAssetContentType(request.ThumbnailContentType)
		if err != nil || !strings.HasPrefix(thumbType, "image/") {
			response.BadRequest(c, "画布缩略图类型无效")
			return
		}
	}

	storageKey, err := h.userStorageKey(c.Request.Context(), userID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	assetID := strings.ReplaceAll(uuid.NewString(), "-", "")
	extension := canvasContentTypeExtension(contentType)
	objectKey := canvasAssetPendingKey(storageKey, projectID, assetID, extension)
	if pendingThumbKey == "" && thumbType != "" {
		pendingThumbKey = canvasAssetPendingThumbKey(storageKey, projectID, assetID, canvasContentTypeExtension(thumbType))
	}
	intent := canvasUploadIntent{
		AssetID:       assetID,
		UserID:        userID,
		ProjectID:     projectID,
		NodeID:        nodeID,
		Kind:          kind,
		ObjectKey:     objectKey,
		ThumbKey:      pendingThumbKey,
		Bytes:         request.Bytes,
		ThumbBytes:    request.ThumbnailBytes,
		MimeType:      contentType,
		ThumbMimeType: thumbType,
		SHA256:        digest,
		ExpiresAt:     time.Now().UTC().Add(canvasUploadIntentTTL),
	}
	if err := h.reserveCanvasUploadIntent(c.Request.Context(), intent); err != nil {
		switch {
		case errors.Is(err, errCanvasUploadIntentLimit):
			response.Error(c, http.StatusTooManyRequests, "待完成上传任务过多，请稍后再试")
		case errors.Is(err, errCanvasUploadStorageFull):
			response.Error(c, http.StatusTooManyRequests, "画布存储空间即将达到上限")
		default:
			response.InternalError(c, "创建上传任务失败")
		}
		return
	}
	upload, err := h.storage.PresignImageUpload(c.Request.Context(), objectKey, contentType)
	if err != nil {
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		response.ErrorFrom(c, err)
		return
	}

	payload := gin.H{
		"asset_id":       assetID,
		"kind":           kind,
		"object_key":     objectKey,
		"upload_url":     upload.URL,
		"content_type":   contentType,
		"upload_headers": upload.Headers,
	}
	if thumbType != "" {
		thumbKey := pendingThumbKey
		thumbUpload, presignErr := h.storage.PresignImageUpload(c.Request.Context(), thumbKey, thumbType)
		if presignErr != nil {
			h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
			response.ErrorFrom(c, presignErr)
			return
		}
		payload["thumb_object_key"] = thumbKey
		payload["thumb_upload_url"] = thumbUpload.URL
		payload["thumbnail_content_type"] = thumbType
		payload["thumb_upload_headers"] = thumbUpload.Headers
	}
	response.Success(c, payload)
}

// CompleteAsset verifies directly uploaded objects and registers the canvas
// asset only after R2 confirms their size and content type.
func (h *CanvasHandler) CompleteAsset(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
	var request completeCanvasAssetRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "画布资产登记参数无效")
		return
	}
	projectID := strings.TrimSpace(request.ProjectID)
	nodeID := truncateCanvasNodeID(request.NodeID)
	assetID := strings.TrimSpace(request.AssetID)
	kind, contentType, err := normalizeCanvasAssetInput(request.Kind, request.ContentType)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if !canvasIDPattern.MatchString(projectID) || !canvasIDPattern.MatchString(assetID) {
		response.BadRequest(c, "画布项目或资产 ID 无效")
		return
	}
	if request.Bytes <= 0 || request.Bytes > maxCanvasAssetBytes {
		response.BadRequest(c, "画布资产文件为空或过大")
		return
	}
	if !h.ownsProject(c.Request.Context(), userID, projectID) {
		response.NotFound(c, "画布项目不存在")
		return
	}

	if existing := h.findCanvasAssetByID(c.Request.Context(), userID, assetID); existing != nil {
		if existing.ProjectID != projectID {
			response.BadRequest(c, "画布资产不属于当前项目")
			return
		}
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		h.populateCanvasAssetURLs(c.Request.Context(), existing)
		response.Success(c, *existing)
		return
	}

	intent := h.findCanvasUploadIntent(c.Request.Context(), userID, assetID)
	if intent == nil {
		response.BadRequest(c, "画布上传任务不存在或已过期")
		return
	}
	invalidIntent := intent.ProjectID != projectID ||
		intent.NodeID != nodeID ||
		intent.Kind != kind ||
		intent.Bytes != request.Bytes ||
		!canvasContentTypeEqual(intent.MimeType, contentType)
	if !invalidIntent {
		invalidIntent = intent.ThumbBytes != request.ThumbnailBytes
		if !invalidIntent && intent.ThumbBytes > 0 {
			invalidIntent = !canvasContentTypeEqual(intent.ThumbMimeType, request.ThumbnailContentType)
		}
	}
	if invalidIntent {
		h.deleteCanvasObjects(c.Request.Context(), intent.ObjectKey, intent.ThumbKey)
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		response.BadRequest(c, "画布上传任务与提交内容不匹配")
		return
	}

	storageKey, err := h.userStorageKey(c.Request.Context(), userID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	pendingObjectKey := canvasAssetPendingKey(
		storageKey,
		projectID,
		assetID,
		canvasContentTypeExtension(contentType),
	)
	objectKey := strings.TrimSpace(request.ObjectKey)
	if objectKey != pendingObjectKey || objectKey != intent.ObjectKey {
		h.deleteCanvasObjects(c.Request.Context(), intent.ObjectKey, intent.ThumbKey)
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		response.BadRequest(c, "画布资产对象路径无效")
		return
	}
	meta, err := h.storage.ImageObjectStat(c.Request.Context(), objectKey)
	if err != nil {
		response.BadRequest(c, "画布资产上传未完成")
		return
	}
	if meta.Bytes != request.Bytes || !canvasContentTypeEqual(meta.ContentType, contentType) {
		h.deleteCanvasObjects(c.Request.Context(), objectKey)
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		response.BadRequest(c, "画布资产大小或类型不匹配")
		return
	}
	prefix, err := h.storage.ReadImageObjectPrefix(c.Request.Context(), objectKey, 512)
	if err != nil || !validateCanvasObjectSignature(contentType, prefix) {
		h.deleteCanvasObjects(c.Request.Context(), objectKey)
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		response.BadRequest(c, "画布资产文件内容与类型不匹配")
		return
	}
	finalObjectKey := canvasAssetObjectKey(storageKey, projectID, assetID, canvasContentTypeExtension(contentType))
	if err := h.storage.CopyImageObject(c.Request.Context(), pendingObjectKey, finalObjectKey, contentType); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	finalMeta, err := h.storage.ImageObjectStat(c.Request.Context(), finalObjectKey)
	if err != nil || finalMeta.Bytes != request.Bytes || !canvasContentTypeEqual(finalMeta.ContentType, contentType) {
		h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, pendingObjectKey)
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		response.BadRequest(c, "画布资产复制校验失败")
		return
	}

	thumbType := ""
	pendingThumbKey := ""
	thumbKey := ""
	if strings.TrimSpace(request.ThumbnailContentType) != "" || request.ThumbnailBytes > 0 || strings.TrimSpace(request.ThumbObjectKey) != "" {
		if request.ThumbnailBytes <= 0 || request.ThumbnailBytes > maxCanvasThumbBytes {
			h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, pendingObjectKey)
			h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
			response.BadRequest(c, "画布缩略图为空或过大")
			return
		}
		thumbType, _, err = normalizeCanvasAssetContentType(request.ThumbnailContentType)
		if err != nil || !strings.HasPrefix(thumbType, "image/") {
			h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, pendingObjectKey)
			h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
			response.BadRequest(c, "画布缩略图类型无效")
			return
		}
		pendingThumbKey = canvasAssetPendingThumbKey(storageKey, projectID, assetID, canvasContentTypeExtension(thumbType))
		if strings.TrimSpace(request.ThumbObjectKey) != pendingThumbKey {
			h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, pendingObjectKey)
			h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
			response.BadRequest(c, "画布缩略图对象路径无效")
			return
		}
		thumbMeta, statErr := h.storage.ImageObjectStat(c.Request.Context(), pendingThumbKey)
		if statErr != nil || thumbMeta.Bytes != request.ThumbnailBytes || !canvasContentTypeEqual(thumbMeta.ContentType, thumbType) {
			h.deleteCanvasObjects(c.Request.Context(), pendingThumbKey, finalObjectKey, pendingObjectKey)
			h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
			response.BadRequest(c, "画布缩略图大小或类型不匹配")
			return
		}
		thumbPrefix, prefixErr := h.storage.ReadImageObjectPrefix(c.Request.Context(), pendingThumbKey, 512)
		if prefixErr != nil || !validateCanvasObjectSignature(thumbType, thumbPrefix) {
			h.deleteCanvasObjects(c.Request.Context(), pendingThumbKey, finalObjectKey, pendingObjectKey)
			h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
			response.BadRequest(c, "画布缩略图内容与类型不匹配")
			return
		}
		thumbKey = canvasAssetThumbKey(storageKey, projectID, assetID, canvasContentTypeExtension(thumbType))
		if err := h.storage.CopyImageObject(c.Request.Context(), pendingThumbKey, thumbKey, thumbType); err != nil {
			h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, pendingObjectKey)
			response.ErrorFrom(c, err)
			return
		}
		thumbFinalMeta, finalStatErr := h.storage.ImageObjectStat(c.Request.Context(), thumbKey)
		if finalStatErr != nil || thumbFinalMeta.Bytes != request.ThumbnailBytes || !canvasContentTypeEqual(thumbFinalMeta.ContentType, thumbType) {
			h.deleteCanvasObjects(c.Request.Context(), thumbKey, pendingThumbKey, finalObjectKey, pendingObjectKey)
			h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
			response.BadRequest(c, "画布缩略图复制校验失败")
			return
		}
	}
	h.deleteCanvasObjects(c.Request.Context(), pendingObjectKey, pendingThumbKey)

	digest := normalizeCanvasSHA256(request.SHA256)
	tx, err := h.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, thumbKey)
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		response.InternalError(c, "保存画布资产失败")
		return
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockCanvasQuota(c.Request.Context(), tx, "canvas-assets", userID); err != nil {
		h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, thumbKey)
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
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
		h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, thumbKey)
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		response.InternalError(c, "读取画布存储额度失败")
		return
	}
	if assetCount >= canvasAssetCountQuota || storedBytes+request.Bytes > canvasAssetBytesQuota {
		h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, thumbKey)
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		response.Error(c, http.StatusTooManyRequests, "画布存储空间已达上限")
		return
	}
	if digest != "" {
		if existing := findCanvasAssetByHashIn(c.Request.Context(), tx, h.storage, userID, projectID, nodeID, digest); existing != nil {
			h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, thumbKey)
			h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
			response.Success(c, *existing)
			return
		}
	}
	if _, err = tx.ExecContext(c.Request.Context(), `
		INSERT INTO canvas_assets (
			id, user_id, project_id, node_id, kind, object_key, thumb_object_key,
			width, height, bytes, mime_type, sha256
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
	`, assetID, userID, projectID, nodeID, kind, finalObjectKey, thumbKey,
		request.Width, request.Height, request.Bytes, contentType, digest); err != nil {
		h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, thumbKey)
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		response.InternalError(c, "保存画布资产失败")
		return
	}
	if err := tx.Commit(); err != nil {
		h.deleteCanvasObjects(c.Request.Context(), finalObjectKey, thumbKey)
		h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
		response.InternalError(c, "保存画布资产失败")
		return
	}
	h.deleteCanvasUploadIntent(c.Request.Context(), userID, assetID)
	asset := CanvasAsset{
		ID:        assetID,
		ProjectID: projectID,
		NodeID:    nodeID,
		Kind:      kind,
		Width:     request.Width,
		Height:    request.Height,
		Bytes:     request.Bytes,
		MimeType:  contentType,
		SHA256:    digest,
		CreatedAt: time.Now().UTC(),
		objectKey: finalObjectKey,
		thumbKey:  thumbKey,
	}
	h.populateCanvasAssetURLs(c.Request.Context(), &asset)
	response.Created(c, asset)
}

// PromoteAsset turns an existing generated-image object into a durable canvas
// asset with an S3-side copy. The browser never downloads and re-uploads the
// original.
func (h *CanvasHandler) PromoteAsset(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
	var request promoteCanvasAssetRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "画布资产提升参数无效")
		return
	}
	projectID := strings.TrimSpace(request.ProjectID)
	nodeID := truncateCanvasNodeID(request.NodeID)
	sourceKey := strings.TrimSpace(request.SourceObjectKey)
	if !canvasIDPattern.MatchString(projectID) || sourceKey == "" || len(sourceKey) > 1024 {
		response.BadRequest(c, "画布项目或源对象无效")
		return
	}
	if !h.ownsProject(c.Request.Context(), userID, projectID) {
		response.NotFound(c, "画布项目不存在")
		return
	}
	storageKey, err := h.userStorageKey(c.Request.Context(), userID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	if !canvasSourceBelongsToUser(sourceKey, storageKey) {
		response.BadRequest(c, "画布源对象不属于当前用户")
		return
	}
	if existing := h.findCanvasAssetBySourceObjectKey(c.Request.Context(), userID, projectID, sourceKey); existing != nil {
		h.populateCanvasAssetURLs(c.Request.Context(), existing)
		response.Success(c, *existing)
		return
	}
	sourceMeta, err := h.storage.ImageObjectStat(c.Request.Context(), sourceKey)
	if err != nil || sourceMeta.Bytes <= 0 || sourceMeta.Bytes > maxCanvasAssetBytes {
		response.BadRequest(c, "画布源对象不存在或过大")
		return
	}
	kind, contentType, err := normalizeCanvasAssetInput(request.Kind, sourceMeta.ContentType)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	sourcePrefix, err := h.storage.ReadImageObjectPrefix(c.Request.Context(), sourceKey, 512)
	if err != nil || !validateCanvasObjectSignature(contentType, sourcePrefix) {
		response.BadRequest(c, "画布源对象内容与类型不匹配")
		return
	}
	assetID := strings.ReplaceAll(uuid.NewString(), "-", "")
	objectKey := canvasAssetObjectKey(storageKey, projectID, assetID, canvasContentTypeExtension(contentType))
	if err := h.storage.CopyImageObject(c.Request.Context(), sourceKey, objectKey, contentType); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	targetMeta, err := h.storage.ImageObjectStat(c.Request.Context(), objectKey)
	if err != nil || targetMeta.Bytes != sourceMeta.Bytes || !canvasContentTypeEqual(targetMeta.ContentType, contentType) {
		h.deleteCanvasObjects(c.Request.Context(), objectKey)
		response.BadRequest(c, "画布资产复制校验失败")
		return
	}

	tx, err := h.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		h.deleteCanvasObjects(c.Request.Context(), objectKey)
		response.InternalError(c, "保存画布资产失败")
		return
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockCanvasQuota(c.Request.Context(), tx, "canvas-assets", userID); err != nil {
		h.deleteCanvasObjects(c.Request.Context(), objectKey)
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
		h.deleteCanvasObjects(c.Request.Context(), objectKey)
		response.InternalError(c, "读取画布存储额度失败")
		return
	}
	if assetCount >= canvasAssetCountQuota || storedBytes+sourceMeta.Bytes > canvasAssetBytesQuota {
		h.deleteCanvasObjects(c.Request.Context(), objectKey)
		response.Error(c, http.StatusTooManyRequests, "画布存储空间已达上限")
		return
	}
	if _, err = tx.ExecContext(c.Request.Context(), `
		INSERT INTO canvas_assets (
			id, user_id, project_id, node_id, kind, object_key, thumb_object_key,
			width, height, bytes, mime_type, sha256, source_object_key
		) VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,$9,$10,'',$11)
	`, assetID, userID, projectID, nodeID, kind, objectKey,
		request.Width, request.Height, sourceMeta.Bytes, contentType, sourceKey); err != nil {
		_ = tx.Rollback()
		if existing := h.findCanvasAssetBySourceObjectKey(c.Request.Context(), userID, projectID, sourceKey); existing != nil {
			h.deleteCanvasObjects(c.Request.Context(), objectKey)
			h.populateCanvasAssetURLs(c.Request.Context(), existing)
			response.Success(c, *existing)
			return
		}
		h.deleteCanvasObjects(c.Request.Context(), objectKey)
		response.InternalError(c, "保存画布资产失败")
		return
	}
	if err := tx.Commit(); err != nil {
		h.deleteCanvasObjects(c.Request.Context(), objectKey)
		response.InternalError(c, "保存画布资产失败")
		return
	}
	asset := CanvasAsset{
		ID:              assetID,
		ProjectID:       projectID,
		NodeID:          nodeID,
		Kind:            kind,
		Width:           request.Width,
		Height:          request.Height,
		Bytes:           sourceMeta.Bytes,
		MimeType:        contentType,
		SourceObjectKey: sourceKey,
		CreatedAt:       time.Now().UTC(),
		objectKey:       objectKey,
	}
	h.populateCanvasAssetURLs(c.Request.Context(), &asset)
	response.Created(c, asset)
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
		if !strings.HasPrefix(sourceURL, service.LocalImageAssetURLPrefix) {
			response.BadRequest(c, "画布资产来源必须是本站媒体地址")
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
	if !validateCanvasObjectSignature(contentType, data) {
		response.BadRequest(c, "画布资产文件内容与类型不匹配")
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
	_, storedKey, err := h.storage.SaveImageWithFullKey(c.Request.Context(), objectKey, contentType, data)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	storedThumbKey := ""
	if thumbFile, thumbHeader, thumbErr := c.Request.FormFile("thumbnail"); thumbErr == nil {
		thumbData, readErr := io.ReadAll(io.LimitReader(thumbFile, maxCanvasThumbBytes+1))
		_ = thumbFile.Close()
		if readErr == nil && len(thumbData) > 0 && len(thumbData) <= maxCanvasThumbBytes {
			thumbType := strings.TrimSpace(thumbHeader.Header.Get("Content-Type"))
			if !strings.HasPrefix(thumbType, "image/") {
				thumbType = http.DetectContentType(thumbData)
			}
			if !isCanvasMimeType(thumbType) || !validateCanvasObjectSignature(thumbType, thumbData) {
				response.BadRequest(c, "画布缩略图内容与类型不匹配")
				return
			}
			thumbExtension := canvasFileExtension("", thumbType)
			thumbKey := canvasAssetThumbKey(storageKey, projectID, assetID, thumbExtension)
			_, storedThumbKey, _ = h.storage.SaveImageWithFullKey(c.Request.Context(), thumbKey, thumbType, thumbData)
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
		URL:       canvasPublicAssetURL(assetID, "content"),
		ThumbURL:  canvasPublicAssetThumbURL(assetID, storedThumbKey),
		Width:     parseCanvasInt(c.PostForm("width")),
		Height:    parseCanvasInt(c.PostForm("height")),
		Bytes:     int64(len(data)),
		MimeType:  contentType,
		CreatedAt: time.Now().UTC(),
	})
}

func normalizeCanvasAssetInput(kind, contentType string) (string, string, error) {
	kind = strings.TrimSpace(kind)
	if kind == "" {
		kind = "image"
	}
	switch kind {
	case "image", "video", "audio":
	default:
		return "", "", errors.New("不支持的画布资产类型")
	}
	normalized, _, err := normalizeCanvasAssetContentType(contentType)
	if err != nil {
		return "", "", err
	}
	if !isCanvasMimeType(normalized) {
		return "", "", errors.New("不支持的画布资产类型")
	}
	if (kind == "image" && !strings.HasPrefix(normalized, "image/")) ||
		(kind == "video" && !strings.HasPrefix(normalized, "video/")) ||
		(kind == "audio" && !strings.HasPrefix(normalized, "audio/")) {
		return "", "", errors.New("画布资产类型与文件类型不匹配")
	}
	return kind, normalized, nil
}

func normalizeCanvasAssetContentType(value string) (string, string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", "", errors.New("画布资产类型不能为空")
	}
	mediaType, params, err := mime.ParseMediaType(value)
	if err != nil {
		return "", "", errors.New("画布资产类型无效")
	}
	return strings.ToLower(mediaType), params["charset"], nil
}

func canvasContentTypeEqual(actual, expected string) bool {
	actualValue, _, actualErr := normalizeCanvasAssetContentType(actual)
	expectedValue, _, expectedErr := normalizeCanvasAssetContentType(expected)
	return actualErr == nil && expectedErr == nil && actualValue == expectedValue
}

func truncateCanvasNodeID(value string) string {
	nodeID := strings.TrimSpace(value)
	if len(nodeID) > 128 {
		return nodeID[:128]
	}
	return nodeID
}

func normalizeCanvasSHA256(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) != 64 {
		return ""
	}
	if _, err := hex.DecodeString(value); err != nil {
		return ""
	}
	return value
}

func canvasSourceBelongsToUser(sourceKey, storageKey string) bool {
	sourceKey = strings.TrimLeft(strings.TrimSpace(sourceKey), "/")
	storageKey = strings.Trim(strings.TrimSpace(storageKey), "/")
	if sourceKey == "" || storageKey == "" || strings.Contains(sourceKey, "..") {
		return false
	}
	return strings.Contains("/"+sourceKey, "/"+storageKey+"/")
}

func (h *CanvasHandler) populateCanvasAssetURLs(ctx context.Context, asset *CanvasAsset) {
	if asset == nil {
		return
	}
	asset.URL = canvasPublicAssetURL(asset.ID, "content")
	asset.ThumbURL = canvasPublicAssetThumbURL(asset.ID, asset.thumbKey)
}

func canvasPublicAssetURL(assetID, variant string) string {
	return canvasPublicAssetPrefix + url.PathEscape(strings.TrimSpace(assetID)) + "/" + variant
}

func canvasPublicAssetThumbURL(assetID, thumbKey string) string {
	if strings.TrimSpace(thumbKey) == "" {
		return ""
	}
	return canvasPublicAssetURL(assetID, "thumb")
}

func sanitizeCanvasGraphURLs(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || !json.Valid(raw) {
		return raw
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		return raw
	}
	sanitized, err := json.Marshal(sanitizeCanvasGraphValue(value))
	if err != nil {
		return raw
	}
	return sanitized
}

func sanitizeCanvasGraphValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			typed[key] = sanitizeCanvasGraphValue(child)
		}
		return typed
	case []any:
		for index := range typed {
			typed[index] = sanitizeCanvasGraphValue(typed[index])
		}
		return typed
	case string:
		trimmed := strings.TrimSpace(typed)
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "http://") ||
			strings.HasPrefix(lower, "https://") ||
			strings.HasPrefix(lower, "blob:") {
			return ""
		}
		return typed
	default:
		return value
	}
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
		item.URL = canvasPublicAssetURL(item.ID, "content")
		if thumbKey != "" {
			item.ThumbURL = canvasPublicAssetURL(item.ID, "thumb")
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

func (h *CanvasHandler) reserveCanvasUploadIntent(ctx context.Context, intent canvasUploadIntent) error {
	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM canvas_upload_intents
		WHERE user_id = $1 AND expires_at <= NOW()
	`, intent.UserID); err != nil {
		return err
	}
	if err := lockCanvasQuota(ctx, tx, "canvas-uploads", intent.UserID); err != nil {
		return err
	}
	var intentCount int
	var reservedBytes int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(bytes + thumb_bytes), 0)
		FROM canvas_upload_intents
		WHERE user_id = $1 AND expires_at > NOW()
	`, intent.UserID).Scan(&intentCount, &reservedBytes); err != nil {
		return err
	}
	if intentCount >= canvasUploadIntentLimit {
		return errCanvasUploadIntentLimit
	}
	var assetCount int
	var storedBytes int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(bytes), 0)
		FROM canvas_assets
		WHERE user_id = $1
	`, intent.UserID).Scan(&assetCount, &storedBytes); err != nil {
		return err
	}
	incomingBytes := intent.Bytes + intent.ThumbBytes
	if assetCount+intentCount >= canvasAssetCountQuota || storedBytes+reservedBytes+incomingBytes > canvasAssetBytesQuota {
		return errCanvasUploadStorageFull
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO canvas_upload_intents (
			asset_id, user_id, project_id, node_id, kind, object_key, thumb_object_key,
			bytes, thumb_bytes, mime_type, thumb_mime_type, sha256, expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
	`, intent.AssetID, intent.UserID, intent.ProjectID, intent.NodeID, intent.Kind,
		intent.ObjectKey, intent.ThumbKey, intent.Bytes, intent.ThumbBytes,
		intent.MimeType, intent.ThumbMimeType, intent.SHA256, intent.ExpiresAt); err != nil {
		return err
	}
	return tx.Commit()
}

func (h *CanvasHandler) findCanvasUploadIntent(ctx context.Context, userID int64, assetID string) *canvasUploadIntent {
	var intent canvasUploadIntent
	err := h.db.QueryRowContext(ctx, `
		SELECT asset_id, user_id, project_id, node_id, kind, object_key, thumb_object_key,
		       bytes, thumb_bytes, mime_type, thumb_mime_type, sha256, expires_at
		FROM canvas_upload_intents
		WHERE asset_id = $1 AND user_id = $2 AND expires_at > NOW()
	`, assetID, userID).Scan(
		&intent.AssetID, &intent.UserID, &intent.ProjectID, &intent.NodeID, &intent.Kind,
		&intent.ObjectKey, &intent.ThumbKey, &intent.Bytes, &intent.ThumbBytes,
		&intent.MimeType, &intent.ThumbMimeType, &intent.SHA256, &intent.ExpiresAt,
	)
	if err != nil {
		return nil
	}
	return &intent
}

func (h *CanvasHandler) deleteCanvasUploadIntent(ctx context.Context, userID int64, assetID string) {
	_, _ = h.db.ExecContext(ctx, `
		DELETE FROM canvas_upload_intents WHERE asset_id = $1 AND user_id = $2
	`, assetID, userID)
}

func (h *CanvasHandler) findCanvasAssetBySourceObjectKey(
	ctx context.Context,
	userID int64,
	projectID string,
	sourceObjectKey string,
) *CanvasAsset {
	var item CanvasAsset
	var objectKey, thumbKey string
	err := h.db.QueryRowContext(ctx, `
		SELECT id, project_id, node_id, kind, object_key, thumb_object_key,
		       width, height, bytes, mime_type, sha256, source_object_key, created_at
		FROM canvas_assets
		WHERE user_id = $1 AND project_id = $2 AND source_object_key = $3
		LIMIT 1
	`, userID, projectID, sourceObjectKey).Scan(
		&item.ID, &item.ProjectID, &item.NodeID, &item.Kind, &objectKey, &thumbKey,
		&item.Width, &item.Height, &item.Bytes, &item.MimeType, &item.SHA256,
		&item.SourceObjectKey, &item.CreatedAt,
	)
	if err != nil {
		return nil
	}
	item.objectKey = objectKey
	item.thumbKey = thumbKey
	return &item
}

func (h *CanvasHandler) findCanvasAssetByID(ctx context.Context, userID int64, assetID string) *CanvasAsset {
	var item CanvasAsset
	var objectKey, thumbKey string
	err := h.db.QueryRowContext(ctx, `
		SELECT id, project_id, node_id, kind, object_key, thumb_object_key,
		       width, height, bytes, mime_type, sha256, created_at
		FROM canvas_assets
		WHERE id = $1 AND user_id = $2
	`, assetID, userID).Scan(
		&item.ID, &item.ProjectID, &item.NodeID, &item.Kind, &objectKey, &thumbKey,
		&item.Width, &item.Height, &item.Bytes, &item.MimeType, &item.SHA256, &item.CreatedAt,
	)
	if err != nil {
		return nil
	}
	item.objectKey = objectKey
	item.thumbKey = thumbKey
	return &item
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
	item.URL = canvasPublicAssetURL(item.ID, "content")
	if thumbKey != "" {
		item.ThumbURL = canvasPublicAssetURL(item.ID, "thumb")
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

func canvasContentTypeExtension(contentType string) string {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/avif":
		return ".avif"
	case "image/gif":
		return ".gif"
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	case "audio/mp4":
		return ".m4a"
	case "audio/mpeg":
		return ".mp3"
	case "audio/ogg":
		return ".ogg"
	case "audio/wav":
		return ".wav"
	default:
		return ".bin"
	}
}

func isCanvasMimeType(contentType string) bool {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif",
		"video/mp4", "video/webm",
		"audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4":
		return true
	default:
		return false
	}
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

func canvasAssetPendingKey(storageKey, projectID, assetID, extension string) string {
	return fmt.Sprintf("canvas-pending/%s/%s/%s%s", storageKey, projectID, assetID, extension)
}

func canvasAssetPendingThumbKey(storageKey, projectID, assetID, extension string) string {
	return fmt.Sprintf("canvas-pending/%s/%s/thumbs/%s%s", storageKey, projectID, assetID, extension)
}

func validateCanvasObjectSignature(contentType string, data []byte) bool {
	if len(data) == 0 {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/png":
		return bytes.HasPrefix(data, []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a})
	case "image/jpeg":
		return bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff})
	case "image/gif":
		return bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a"))
	case "image/webp":
		return len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP"))
	case "image/avif":
		if len(data) < 12 || !bytes.Equal(data[4:8], []byte("ftyp")) {
			return false
		}
		for offset := 8; offset+4 <= len(data) && offset < 64; offset += 4 {
			brand := data[offset : offset+4]
			if bytes.Equal(brand, []byte("avif")) || bytes.Equal(brand, []byte("avis")) {
				return true
			}
		}
		return false
	case "video/mp4", "audio/mp4":
		return len(data) >= 12 && bytes.Equal(data[4:8], []byte("ftyp"))
	case "video/webm":
		return bytes.HasPrefix(data, []byte{0x1a, 0x45, 0xdf, 0xa3})
	case "audio/mpeg":
		return bytes.HasPrefix(data, []byte("ID3")) ||
			(len(data) >= 2 && data[0] == 0xff && data[1]&0xe0 == 0xe0)
	case "audio/wav":
		return len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WAVE"))
	case "audio/ogg":
		return bytes.HasPrefix(data, []byte("OggS"))
	default:
		return false
	}
}
