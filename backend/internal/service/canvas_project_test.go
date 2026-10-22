//go:build unit

package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

type canvasProjectStoreStub struct {
	items  []CanvasProjectSummary
	got    *CanvasProject
	create *CanvasProject
	update *CanvasProject
	err    error
}

func (s *canvasProjectStoreStub) List(context.Context, int64, int) ([]CanvasProjectSummary, error) {
	return s.items, s.err
}

func (s *canvasProjectStoreStub) Get(context.Context, int64, string) (*CanvasProject, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.got, nil
}

func (s *canvasProjectStoreStub) Create(_ context.Context, project *CanvasProject) error {
	s.create = project
	return s.err
}

func (s *canvasProjectStoreStub) Update(
	context.Context,
	int64,
	string,
	string,
	json.RawMessage,
	int,
) (*CanvasProject, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.update, nil
}

func (s *canvasProjectStoreStub) Delete(context.Context, int64, string) error {
	return s.err
}

func TestCanvasProjectServiceCreatesDefaultGraphAndTitle(t *testing.T) {
	store := &canvasProjectStoreStub{}
	svc := NewCanvasProjectService(store)

	project, err := svc.Create(context.Background(), 7, "   ", nil)
	require.NoError(t, err)
	require.Equal(t, "未命名画布", project.Title)
	require.Equal(t, 1, project.Version)
	require.JSONEq(t, string(defaultCanvasGraph), string(project.Graph))
	require.NotNil(t, store.create)
	require.NotEmpty(t, project.ID)
}

func TestCanvasProjectServiceRejectsInvalidGraph(t *testing.T) {
	svc := NewCanvasProjectService(&canvasProjectStoreStub{})

	_, err := svc.Create(context.Background(), 7, "test", json.RawMessage(`{"nodes":[]}`))
	require.Error(t, err)

	_, err = svc.Create(context.Background(), 7, "test", json.RawMessage(`not-json`))
	require.Error(t, err)
}

func TestCanvasProjectServiceRequiresExpectedVersion(t *testing.T) {
	svc := NewCanvasProjectService(&canvasProjectStoreStub{})

	_, err := svc.Update(
		context.Background(),
		7,
		"canvas_1",
		"test",
		json.RawMessage(`{"nodes":[],"edges":[]}`),
		0,
	)
	require.ErrorIs(t, err, ErrCanvasProjectVersionConflict)
}
