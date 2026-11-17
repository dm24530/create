package save

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Kind string

const (
	KindImage Kind = "image"
	KindVideo Kind = "video"
	KindOther Kind = "other"
)

type Result struct {
	Path      string `json:"path"`
	Filename  string `json:"filename"`
	Kind      Kind   `json:"kind"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"created_at"`
}

type Store struct {
	Root string
}

func New(root string) *Store {
	return &Store{Root: root}
}

func Classify(filename, contentType string) Kind {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if strings.HasPrefix(contentType, "image/") {
		return KindImage
	}
	if strings.HasPrefix(contentType, "video/") {
		return KindVideo
	}
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp":
		return KindImage
	case ".mp4", ".webm", ".mov", ".mkv", ".m4v":
		return KindVideo
	default:
		return KindOther
	}
}

func (s *Store) SaveFile(directory, filename, contentType string, body io.Reader) (Result, error) {
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return Result{}, err
	}
	safeName := sanitizeFilename(filename)
	if safeName == "" {
		safeName = fallbackName(contentType)
	}
	target := uniquePath(directory, safeName)
	temporary := target + ".partial"
	file, err := os.Create(temporary)
	if err != nil {
		return Result{}, err
	}
	size, copyErr := io.Copy(file, body)
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(temporary)
		return Result{}, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(temporary)
		return Result{}, closeErr
	}
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Remove(temporary)
		return Result{}, err
	}
	result := Result{
		Path:      target,
		Filename:  filepath.Base(target),
		Kind:      Classify(target, contentType),
		Size:      size,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	_ = s.appendHistory(result)
	return result, nil
}

func sanitizeFilename(value string) string {
	value = filepath.Base(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		"<", "_", ">", "_", ":", "_", `"`, "_", "/", "_", `\`, "_", "|", "_", "?", "_", "*", "_",
	)
	value = strings.Map(func(r rune) rune {
		if r < 32 {
			return '_'
		}
		return r
	}, replacer.Replace(value))
	return strings.Trim(value, ". ")
}

func fallbackName(contentType string) string {
	extensions, _ := mime.ExtensionsByType(contentType)
	if len(extensions) > 0 {
		return "download" + extensions[0]
	}
	return "download.bin"
}

func uniquePath(directory, filename string) string {
	candidate := filepath.Join(directory, filename)
	if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
		return candidate
	}
	ext := filepath.Ext(filename)
	stem := strings.TrimSuffix(filename, ext)
	stamp := time.Now().Format("20060102-150405")
	for i := 1; i < 10000; i++ {
		candidate = filepath.Join(directory, stem+"-"+stamp+"-"+itoa(i)+ext)
		if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
			return candidate
		}
	}
	return filepath.Join(directory, stem+"-"+stamp+"-overflow"+ext)
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	var digits [20]byte
	index := len(digits)
	for value > 0 {
		index--
		digits[index] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[index:])
}

func (s *Store) appendHistory(result Result) error {
	if err := os.MkdirAll(s.Root, 0o755); err != nil {
		return err
	}
	line, err := json.Marshal(result)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(s.Root, "save-history.jsonl"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.Write(append(line, '\n'))
	return err
}
