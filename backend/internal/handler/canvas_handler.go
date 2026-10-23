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
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	maxCanvasProjectBytes = 12 << 20
	maxCanvasAssetBytes   = 128 << 20
	maxCanvasThumbBytes   = 4 << 20
)

var canvasIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type CanvasAssetStorage interface {
	SaveImageWithKey(ctx context.Context, key, contentType string, data []byte) (string, string, error)
	DeleteObject(ctx context.Context, key string) error
	PresignImageObject(ctx context.Context, objectKey string) (string, error)
}

type CanvasHandler struct {
	db      *sql.DB
	storage CanvasAssetStorage
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

func NewCanvasHandler(db *sql.DB, storage *service.ImageStorageSettingService) *CanvasHandler {
	return &CanvasHandler{db: db, storage: storage}
}

func (h *CanvasHandler) ListProjects(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	rows, err := h.db.QueryContext(c.Request.Context(), `
		SELECT id, title, version, created_at, updated_at
		FROM canvas_projects
		WHERE user_id = $1
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		response.InternalError(c, "读取画布项目失败")
		return
	}
	defer rows.Close()
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
		var version int
		err := h.db.QueryRowContext(ctx, `
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
		response.Error(c, http.StatusConflict, "画布已在其他设备更新，请刷新后重试")
		return
	}
	if err != nil {
		response.InternalError(c, "保存画布项目失败")
		return
	}
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
	keys, _ := h.projectObjectKeys(c.Request.Context(), userID, projectID)
	for _, key := range keys {
		if err := h.storage.DeleteObject(c.Request.Context(), key); err != nil {
			response.InternalError(c, "删除画布资产失败，项目记录已保留")
			return
		}
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
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.BadRequest(c, "缺少画布资产文件")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxCanvasAssetBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxCanvasAssetBytes {
		response.BadRequest(c, "画布资产文件为空或过大")
		return
	}
	contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if contentType == "" {
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
	extension := canvasFileExtension(header.Filename, contentType)
	objectKey := canvasAssetObjectKey(userID, projectID, assetID, extension)
	url, storedKey, err := h.storage.SaveImageWithKey(c.Request.Context(), objectKey, contentType, data)
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
			thumbKey := canvasAssetThumbKey(userID, projectID, assetID, thumbExtension)
			thumbURL, storedThumbKey, _ = h.storage.SaveImageWithKey(c.Request.Context(), thumbKey, thumbType, thumbData)
		}
	}
	_, err = h.db.ExecContext(c.Request.Context(), `
		INSERT INTO canvas_assets (
			id, user_id, project_id, node_id, kind, object_key, thumb_object_key,
			width, height, bytes, mime_type, sha256
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
	`, assetID, userID, projectID, nodeID, kind, storedKey, storedThumbKey,
		parseCanvasInt(c.PostForm("width")), parseCanvasInt(c.PostForm("height")),
		len(data), contentType, digest)
	if err != nil {
		_ = h.storage.DeleteObject(c.Request.Context(), storedKey)
		if storedThumbKey != "" {
			_ = h.storage.DeleteObject(c.Request.Context(), storedThumbKey)
		}
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
	if err := h.storage.DeleteObject(c.Request.Context(), objectKey); err != nil {
		response.InternalError(c, "删除画布资产失败")
		return
	}
	if thumbKey != "" {
		if err := h.storage.DeleteObject(c.Request.Context(), thumbKey); err != nil {
			response.InternalError(c, "删除画布缩略图失败")
			return
		}
	}
	_, err = h.db.ExecContext(c.Request.Context(), `
		DELETE FROM canvas_assets WHERE id = $1 AND user_id = $2
	`, assetID, userID)
	if err != nil {
		response.InternalError(c, "删除画布资产失败")
		return
	}
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
	defer rows.Close()
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
	defer rows.Close()
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

func (h *CanvasHandler) findCanvasAssetByHash(
	ctx context.Context,
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
	err := h.db.QueryRowContext(ctx, `
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
	if resolved, resolveErr := h.storage.PresignImageObject(ctx, objectKey); resolveErr == nil {
		item.URL = resolved
	}
	if thumbKey != "" {
		if resolved, resolveErr := h.storage.PresignImageObject(ctx, thumbKey); resolveErr == nil {
			item.ThumbURL = resolved
		}
	}
	return &item
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

func canvasAssetObjectKey(userID int64, projectID, assetID, extension string) string {
	return fmt.Sprintf("canvas/users/%d/projects/%s/assets/%s%s", userID, projectID, assetID, extension)
}

func canvasAssetThumbKey(userID int64, projectID, assetID, extension string) string {
	return fmt.Sprintf("canvas/users/%d/projects/%s/thumbs/%s%s", userID, projectID, assetID, extension)
}
