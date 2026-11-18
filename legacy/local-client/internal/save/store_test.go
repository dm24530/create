package save

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClassify(t *testing.T) {
	if Classify("", "image/png") != KindImage {
		t.Fatal("image MIME not classified")
	}
	if Classify("clip.webm", "application/octet-stream") != KindVideo {
		t.Fatal("video extension not classified")
	}
	if Classify("archive.zip", "application/zip") != KindOther {
		t.Fatal("other file not classified")
	}
}

func TestSaveFileAvoidsTraversalAndCollision(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "images")
	store := New(root)
	first, err := store.SaveFile(directory, "../../photo.png", "image/png", strings.NewReader("first"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.SaveFile(directory, "photo.png", "image/png", strings.NewReader("second"))
	if err != nil {
		t.Fatal(err)
	}
	if first.Path == second.Path {
		t.Fatal("download collision was not resolved")
	}
	if filepath.Dir(first.Path) != directory {
		t.Fatalf("file escaped target directory: %s", first.Path)
	}
	if data, err := os.ReadFile(first.Path); err != nil || string(data) != "first" {
		t.Fatalf("unexpected first file: %q, %v", data, err)
	}
}
