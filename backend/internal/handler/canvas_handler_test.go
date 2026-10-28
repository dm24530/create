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
	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

type canvasStorageStub struct {
	savedKeys   []string
	deletedKeys []string
	deleteErr   error
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
