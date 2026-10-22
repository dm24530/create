package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

type canvasProjectStore struct {
	db *sql.DB
}

func NewCanvasProjectStore(db *sql.DB) service.CanvasProjectStore {
	return &canvasProjectStore{db: db}
}

func (s *canvasProjectStore) List(
	ctx context.Context,
	userID int64,
	limit int,
) ([]service.CanvasProjectSummary, error) {
	if limit <= 0 || limit > service.CanvasProjectListLimit {
		limit = service.CanvasProjectListLimit
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, version, created_at, updated_at
		FROM canvas_projects
		WHERE user_id = $1
		ORDER BY updated_at DESC
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list canvas projects: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items := make([]service.CanvasProjectSummary, 0, limit)
	for rows.Next() {
		var item service.CanvasProjectSummary
		if err := rows.Scan(&item.ID, &item.Title, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan canvas project: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate canvas projects: %w", err)
	}
	return items, nil
}

func (s *canvasProjectStore) Get(
	ctx context.Context,
	userID int64,
	id string,
) (*service.CanvasProject, error) {
	var project service.CanvasProject
	var graph []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, title, graph, version, created_at, updated_at
		FROM canvas_projects
		WHERE user_id = $1 AND id = $2`, userID, id).
		Scan(
			&project.ID,
			&project.UserID,
			&project.Title,
			&graph,
			&project.Version,
			&project.CreatedAt,
			&project.UpdatedAt,
		)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, service.ErrCanvasProjectNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get canvas project: %w", err)
	}
	project.Graph = append(json.RawMessage(nil), graph...)
	return &project, nil
}

func (s *canvasProjectStore) Create(ctx context.Context, project *service.CanvasProject) error {
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO canvas_projects (id, user_id, title, graph, version)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING created_at, updated_at`,
		project.ID,
		project.UserID,
		project.Title,
		[]byte(project.Graph),
		project.Version,
	).Scan(&project.CreatedAt, &project.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create canvas project: %w", err)
	}
	return nil
}

func (s *canvasProjectStore) Update(
	ctx context.Context,
	userID int64,
	id, title string,
	graph json.RawMessage,
	expectedVersion int,
) (*service.CanvasProject, error) {
	var project service.CanvasProject
	var storedGraph []byte
	err := s.db.QueryRowContext(ctx, `
		UPDATE canvas_projects
		SET title = $3, graph = $4, version = version + 1, updated_at = NOW()
		WHERE user_id = $1 AND id = $2 AND version = $5
		RETURNING id, user_id, title, graph, version, created_at, updated_at`,
		userID,
		id,
		title,
		[]byte(graph),
		expectedVersion,
	).Scan(
		&project.ID,
		&project.UserID,
		&project.Title,
		&storedGraph,
		&project.Version,
		&project.CreatedAt,
		&project.UpdatedAt,
	)
	if err == nil {
		project.Graph = append(json.RawMessage(nil), storedGraph...)
		return &project, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("update canvas project: %w", err)
	}

	var exists bool
	if checkErr := s.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM canvas_projects WHERE user_id = $1 AND id = $2)`,
		userID,
		id,
	).Scan(&exists); checkErr != nil {
		return nil, fmt.Errorf("check canvas project existence: %w", checkErr)
	}
	if !exists {
		return nil, service.ErrCanvasProjectNotFound
	}
	return nil, service.ErrCanvasProjectVersionConflict
}

func (s *canvasProjectStore) Delete(ctx context.Context, userID int64, id string) error {
	result, err := s.db.ExecContext(ctx,
		`DELETE FROM canvas_projects WHERE user_id = $1 AND id = $2`,
		userID,
		id,
	)
	if err != nil {
		return fmt.Errorf("delete canvas project: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("canvas project delete rows affected: %w", err)
	}
	if affected == 0 {
		return service.ErrCanvasProjectNotFound
	}
	return nil
}
