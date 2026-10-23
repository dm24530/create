package handler

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type canvasStorageStub struct {
	savedKeys []string
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

func (s *canvasStorageStub) DeleteObject(context.Context, string) error {
	return nil
}

func (s *canvasStorageStub) PresignImageObject(_ context.Context, objectKey string) (string, error) {
	return "https://r2.example.test/" + objectKey, nil
}

type canvasObjectKeyMatcher struct {
	prefix string
}

func (m canvasObjectKeyMatcher) Match(value driver.Value) bool {
	key, ok := value.(string)
	return ok && strings.HasPrefix(key, m.prefix)
}

func TestCanvasAssetObjectKeysAreUserIsolated(t *testing.T) {
	first := canvasAssetObjectKey(101, "project-a", "asset-a", ".png")
	second := canvasAssetObjectKey(202, "project-a", "asset-a", ".png")

	require.True(t, strings.HasPrefix(first, "canvas/users/101/projects/project-a/"))
	require.True(t, strings.HasPrefix(second, "canvas/users/202/projects/project-a/"))
	require.NotEqual(t, first, second)
	require.Equal(t,
		"canvas/users/101/projects/project-a/thumbs/asset-a.webp",
		canvasAssetThumbKey(101, "project-a", "asset-a", ".webp"),
	)
}

func TestCanvasUploadAssetUsesAuthenticatedUsersObjectPrefix(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	storage := &canvasStorageStub{}
	handler := &CanvasHandler{db: db, storage: storage}
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
			canvasObjectKeyMatcher{prefix: "canvas/users/101/projects/project-a/assets/"},
			"",
			640,
			480,
			len(canvasTestPNG),
			"image/png",
			sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))

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

	require.Equal(t, http.StatusCreated, w.Code)
	require.Len(t, storage.savedKeys, 1)
	require.True(t, strings.HasPrefix(
		storage.savedKeys[0],
		"canvas/users/101/projects/project-a/assets/",
	))
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

var canvasTestPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
}
