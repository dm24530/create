package config

import (
	"path/filepath"
	"testing"
)

func TestStoreSaveAndLoad(t *testing.T) {
	root := t.TempDir()
	store := NewStore(root)
	settings, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	settings.ImageDir = filepath.Join(root, "custom", "images")
	settings.VideoDir = filepath.Join(root, "custom", "videos")
	settings.OtherDir = filepath.Join(root, "custom", "other")
	settings.OpenFolderAfterSave = true
	saved, err := store.Save(settings)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if saved.ImageDir != loaded.ImageDir || !loaded.OpenFolderAfterSave {
		t.Fatalf("unexpected settings: %+v", loaded)
	}
}

func TestStoreRejectsRelativePath(t *testing.T) {
	store := NewStore(t.TempDir())
	settings, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	settings.ImageDir = "relative/images"
	if _, err := store.Validate(settings); err == nil {
		t.Fatal("expected relative path to fail")
	}
}
