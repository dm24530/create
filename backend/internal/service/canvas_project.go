package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/google/uuid"
)

const (
	CanvasProjectTitleMaxRunes = 200
	CanvasProjectGraphMaxBytes = 4 << 20
	CanvasProjectListLimit     = 200
)

var (
	ErrCanvasProjectNotFound = infraerrors.NotFound(
		"CANVAS_PROJECT_NOT_FOUND",
		"canvas project not found",
	)
	ErrCanvasProjectVersionConflict = infraerrors.New(
		http.StatusConflict,
		"CANVAS_PROJECT_VERSION_CONFLICT",
		"canvas project was updated by another session",
	)
)

var defaultCanvasGraph = json.RawMessage(
	`{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`,
)

type CanvasProjectSummary struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type CanvasProject struct {
	ID        string          `json:"id"`
	UserID    int64           `json:"-"`
	Title     string          `json:"title"`
	Graph     json.RawMessage `json:"graph"`
	Version   int             `json:"version"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type CanvasProjectStore interface {
	List(ctx context.Context, userID int64, limit int) ([]CanvasProjectSummary, error)
	Get(ctx context.Context, userID int64, id string) (*CanvasProject, error)
	Create(ctx context.Context, project *CanvasProject) error
	Update(ctx context.Context, userID int64, id, title string, graph json.RawMessage, expectedVersion int) (*CanvasProject, error)
	Delete(ctx context.Context, userID int64, id string) error
}

type CanvasProjectService struct {
	store CanvasProjectStore
}

func NewCanvasProjectService(store CanvasProjectStore) *CanvasProjectService {
	return &CanvasProjectService{store: store}
}

func (s *CanvasProjectService) List(ctx context.Context, userID int64) ([]CanvasProjectSummary, error) {
	if s == nil || s.store == nil {
		return []CanvasProjectSummary{}, nil
	}
	return s.store.List(ctx, userID, CanvasProjectListLimit)
}

func (s *CanvasProjectService) Get(ctx context.Context, userID int64, id string) (*CanvasProject, error) {
	if s == nil || s.store == nil {
		return nil, ErrCanvasProjectNotFound
	}
	return s.store.Get(ctx, userID, strings.TrimSpace(id))
}

func (s *CanvasProjectService) Create(ctx context.Context, userID int64, title string, graph json.RawMessage) (*CanvasProject, error) {
	normalizedGraph, err := normalizeCanvasGraph(graph)
	if err != nil {
		return nil, err
	}
	project := &CanvasProject{
		ID:      "canvas_" + uuid.NewString(),
		UserID:  userID,
		Title:   normalizeCanvasProjectTitle(title),
		Graph:   normalizedGraph,
		Version: 1,
	}
	if err := s.store.Create(ctx, project); err != nil {
		return nil, err
	}
	return project, nil
}

func (s *CanvasProjectService) Update(
	ctx context.Context,
	userID int64,
	id, title string,
	graph json.RawMessage,
	expectedVersion int,
) (*CanvasProject, error) {
	if expectedVersion <= 0 {
		return nil, ErrCanvasProjectVersionConflict
	}
	normalizedGraph, err := normalizeCanvasGraph(graph)
	if err != nil {
		return nil, err
	}
	return s.store.Update(
		ctx,
		userID,
		strings.TrimSpace(id),
		normalizeCanvasProjectTitle(title),
		normalizedGraph,
		expectedVersion,
	)
}

func (s *CanvasProjectService) Delete(ctx context.Context, userID int64, id string) error {
	if s == nil || s.store == nil {
		return ErrCanvasProjectNotFound
	}
	return s.store.Delete(ctx, userID, strings.TrimSpace(id))
}

func normalizeCanvasProjectTitle(value string) string {
	title := strings.TrimSpace(value)
	if title == "" {
		title = "未命名画布"
	}
	runes := []rune(title)
	if len(runes) > CanvasProjectTitleMaxRunes {
		title = string(runes[:CanvasProjectTitleMaxRunes])
	}
	return title
}

func normalizeCanvasGraph(raw json.RawMessage) (json.RawMessage, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return append(json.RawMessage(nil), defaultCanvasGraph...), nil
	}
	if len(raw) > CanvasProjectGraphMaxBytes {
		return nil, infraerrors.New(
			http.StatusRequestEntityTooLarge,
			"CANVAS_GRAPH_TOO_LARGE",
			"canvas graph is too large",
		)
	}
	if !json.Valid(raw) {
		return nil, infraerrors.New(
			http.StatusBadRequest,
			"CANVAS_GRAPH_INVALID",
			"canvas graph must be valid JSON",
		)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, infraerrors.New(
			http.StatusBadRequest,
			"CANVAS_GRAPH_INVALID",
			"canvas graph must be a JSON object",
		)
	}
	if _, ok := payload["nodes"]; !ok {
		return nil, infraerrors.New(
			http.StatusBadRequest,
			"CANVAS_GRAPH_INVALID",
			"canvas graph is missing nodes",
		)
	}
	if _, ok := payload["edges"]; !ok {
		return nil, infraerrors.New(
			http.StatusBadRequest,
			"CANVAS_GRAPH_INVALID",
			"canvas graph is missing edges",
		)
	}
	return append(json.RawMessage(nil), raw...), nil
}
