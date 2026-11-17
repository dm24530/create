package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/diminglucky/create/local-client/internal/config"
	"github.com/diminglucky/create/local-client/internal/save"
)

func newTestServer(t *testing.T) *Server {
	t.Helper()
	root := t.TempDir()
	instance, err := New(
		"https://create.superai.sbs",
		config.NewStore(filepath.Join(root, "config")),
		save.New(filepath.Join(root, "data")),
	)
	if err != nil {
		t.Fatal(err)
	}
	return instance
}

func TestAdminRoutesAreBlocked(t *testing.T) {
	server := newTestServer(t)
	for _, requestPath := range []string{"/admin", "/admin/users", "/api/v1/admin/users"} {
		request := httptest.NewRequest(http.MethodGet, requestPath, nil)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s returned %d, want 403", requestPath, response.Code)
		}
	}
}

func TestLocalAPIRequiresToken(t *testing.T) {
	server := newTestServer(t)
	request := httptest.NewRequest(http.MethodGet, "/__local/settings", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("returned %d, want 403", response.Code)
	}

	request = httptest.NewRequest(http.MethodGet, "/__local/settings", nil)
	request.Header.Set(localTokenHeader, server.LocalToken())
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("returned %d, want 200", response.Code)
	}
}

func TestHealthEndpoint(t *testing.T) {
	server := newTestServer(t)
	request := httptest.NewRequest(http.MethodGet, "/__local/health", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("returned %d, want 200", response.Code)
	}
}
