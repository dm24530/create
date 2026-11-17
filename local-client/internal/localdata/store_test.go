package localdata

import (
	"encoding/base64"
	"testing"
)

func TestGalleryStoresMediaLocally(t *testing.T) {
	store := New(t.TempDir())
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("png"))
	entry, err := store.SaveGallery("image", map[string]any{
		"prompt":         "cat",
		"model":          "test",
		"size":           "1:1",
		"format":         "png",
		"image_data_url": dataURL,
		"saved":          false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if stringValue(entry["url"]) == "" {
		t.Fatal("local media URL missing")
	}
	entries, err := store.ListGallery("image", "temp")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected one local entry, got %d", len(entries))
	}
}

func TestCanvasProjectsAreStoredLocally(t *testing.T) {
	store := New(t.TempDir())
	project, err := store.PutCanvasProject("project-1", map[string]any{
		"title": "Local",
		"graph": map[string]any{
			"nodes":       []any{map[string]any{"id": "n1"}},
			"connections": []any{},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if project.Version != 1 || project.NodeCount != 1 {
		t.Fatalf("unexpected project: %+v", project)
	}
	loaded, err := store.GetCanvasProject("project-1")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Title != "Local" {
		t.Fatalf("unexpected title: %s", loaded.Title)
	}
}
