package localdata

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const retentionSeconds = 7 * 24 * 60 * 60

type Store struct {
	root string
	mu   sync.Mutex
}

type CanvasProject struct {
	ID              string         `json:"id"`
	Title           string         `json:"title"`
	Version         int            `json:"version"`
	CreatedAt       string         `json:"created_at"`
	UpdatedAt       string         `json:"updated_at"`
	Graph           map[string]any `json:"graph"`
	Assets          []any          `json:"assets"`
	NodeCount       int            `json:"node_count,omitempty"`
	ConnectionCount int            `json:"connection_count,omitempty"`
}

func New(root string) *Store {
	return &Store{root: root}
}

func (s *Store) ListGallery(kind, scope string) ([]map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := s.readGallery(kind)
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	result := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		saved, _ := entry["saved"].(bool)
		expires, _ := number(entry["expires_at"])
		if scope == "saved" && !saved {
			continue
		}
		if scope == "temp" && saved {
			continue
		}
		if !saved && expires > 0 && int64(expires) <= now {
			continue
		}
		result = append(result, entry)
	}
	sort.SliceStable(result, func(i, j int) bool {
		left, _ := number(result[i]["created_at"])
		right, _ := number(result[j]["created_at"])
		return left > right
	})
	return result, nil
}

func (s *Store) SaveGallery(kind string, input map[string]any) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := s.readGallery(kind)
	if err != nil {
		return nil, err
	}
	id := randomID()
	entry := cloneMap(input)
	delete(entry, "image_data_url")
	delete(entry, "video_data_url")
	entry["id"] = id
	if _, ok := entry["created_at"]; !ok {
		entry["created_at"] = float64(time.Now().UnixMilli())
	}
	saved, _ := entry["saved"].(bool)
	entry["saved"] = saved
	if saved {
		entry["expires_at"] = float64(0)
	} else if _, ok := entry["expires_at"]; !ok {
		entry["expires_at"] = float64(time.Now().Unix() + retentionSeconds)
	}
	dataURL, _ := input["image_data_url"].(string)
	if kind == "video" {
		dataURL, _ = input["video_data_url"].(string)
	}
	if dataURL != "" {
		mediaURL, err := s.saveDataURL(id, dataURL)
		if err != nil {
			return nil, err
		}
		entry["url"] = mediaURL
		entry["thumb_url"] = mediaURL
	}
	if _, ok := entry["url"]; !ok {
		urlKey := "image_url"
		if kind == "video" {
			urlKey = "video_url"
		}
		if value, ok := input[urlKey].(string); ok {
			entry["url"] = value
		}
	}
	entries = append(entries, entry)
	if err := s.writeGallery(kind, entries); err != nil {
		return nil, err
	}
	return entry, nil
}

func (s *Store) DeleteGallery(kind, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := s.readGallery(kind)
	if err != nil {
		return err
	}
	filtered := entries[:0]
	found := false
	for _, entry := range entries {
		if stringValue(entry["id"]) == id {
			found = true
			continue
		}
		filtered = append(filtered, entry)
	}
	if !found {
		return os.ErrNotExist
	}
	return s.writeGallery(kind, filtered)
}

func (s *Store) SetGallerySaved(kind, id string, saved bool) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := s.readGallery(kind)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if stringValue(entry["id"]) != id {
			continue
		}
		entry["saved"] = saved
		if saved {
			entry["expires_at"] = float64(0)
		} else {
			entry["expires_at"] = float64(time.Now().Unix() + retentionSeconds)
		}
		if err := s.writeGallery(kind, entries); err != nil {
			return nil, err
		}
		return entry, nil
	}
	return nil, os.ErrNotExist
}

func (s *Store) GalleryQuota(kind string) (map[string]any, error) {
	entries, err := s.ListGallery(kind, "")
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"used":              len(entries),
		"limit":             10000,
		"retention_seconds": retentionSeconds,
	}, nil
}

func (s *Store) MediaPath(id string) (string, error) {
	matches, err := filepath.Glob(filepath.Join(s.root, "media", safeSegment(id)+".*"))
	if err != nil {
		return "", err
	}
	if len(matches) == 0 {
		return "", os.ErrNotExist
	}
	return matches[0], nil
}

func (s *Store) MediaURL(id string) (string, error) {
	target, err := s.MediaPath(id)
	if err != nil {
		return "", err
	}
	return "/__local/media/" + filepath.Base(target), nil
}

func (s *Store) ListCanvasProjects() ([]CanvasProject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	projects, err := s.readProjects()
	if err != nil {
		return nil, err
	}
	result := make([]CanvasProject, 0, len(projects))
	for _, project := range projects {
		result = append(result, project)
	}
	sort.SliceStable(result, func(i, j int) bool {
		return result[i].UpdatedAt > result[j].UpdatedAt
	})
	return result, nil
}

func (s *Store) GetCanvasProject(id string) (CanvasProject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	projects, err := s.readProjects()
	if err != nil {
		return CanvasProject{}, err
	}
	project, ok := projects[id]
	if !ok {
		return CanvasProject{}, os.ErrNotExist
	}
	return project, nil
}

func (s *Store) PutCanvasProject(id string, input map[string]any) (CanvasProject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	projects, err := s.readProjects()
	if err != nil {
		return CanvasProject{}, err
	}
	existing, exists := projects[id]
	now := time.Now().UTC().Format(time.RFC3339)
	graph, _ := input["graph"].(map[string]any)
	title, _ := input["title"].(string)
	version := 1
	createdAt := now
	if exists {
		version = existing.Version + 1
		createdAt = existing.CreatedAt
	}
	project := CanvasProject{
		ID:        id,
		Title:     title,
		Version:   version,
		CreatedAt: createdAt,
		UpdatedAt: now,
		Graph:     graph,
		Assets:    []any{},
	}
	refreshCanvasCounts(&project)
	projects[id] = project
	if err := s.writeProjects(projects); err != nil {
		return CanvasProject{}, err
	}
	return project, nil
}

func (s *Store) DeleteCanvasProject(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	projects, err := s.readProjects()
	if err != nil {
		return err
	}
	if _, ok := projects[id]; !ok {
		return os.ErrNotExist
	}
	delete(projects, id)
	return s.writeProjects(projects)
}

func (s *Store) readGallery(kind string) ([]map[string]any, error) {
	var entries []map[string]any
	if err := readJSON(s.galleryPath(kind), &entries); err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []map[string]any{}
	}
	return entries, nil
}

func (s *Store) writeGallery(kind string, entries []map[string]any) error {
	return writeJSON(s.galleryPath(kind), entries)
}

func (s *Store) galleryPath(kind string) string {
	return filepath.Join(s.root, "gallery-"+safeSegment(kind)+".json")
}

func (s *Store) readProjects() (map[string]CanvasProject, error) {
	projects := map[string]CanvasProject{}
	if err := readJSON(filepath.Join(s.root, "canvas-projects.json"), &projects); err != nil {
		return nil, err
	}
	if projects == nil {
		projects = map[string]CanvasProject{}
	}
	return projects, nil
}

func (s *Store) writeProjects(projects map[string]CanvasProject) error {
	return writeJSON(filepath.Join(s.root, "canvas-projects.json"), projects)
}

func (s *Store) saveDataURL(id, value string) (string, error) {
	comma := strings.Index(value, ",")
	if comma < 0 || !strings.HasPrefix(value[:comma], "data:") {
		return "", errors.New("invalid data URL")
	}
	header := value[:comma]
	payload := value[comma+1:]
	encoding := "base64"
	if semicolon := strings.Index(header, ";"); semicolon >= 0 {
		if strings.Contains(header[semicolon+1:], "base64") {
			encoding = "base64"
		}
	}
	if encoding != "base64" {
		return "", errors.New("only base64 data URLs are supported")
	}
	bytes, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", err
	}
	extension := extensionForMIME(strings.TrimPrefix(header, "data:"))
	mediaDir := filepath.Join(s.root, "media")
	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		return "", err
	}
	filename := safeSegment(id) + extension
	if err := os.WriteFile(filepath.Join(mediaDir, filename), bytes, 0o644); err != nil {
		return "", err
	}
	return "/__local/media/" + filename, nil
}

func refreshCanvasCounts(project *CanvasProject) {
	if nodes, ok := project.Graph["nodes"].([]any); ok {
		project.NodeCount = len(nodes)
	}
	if connections, ok := project.Graph["connections"].([]any); ok {
		project.ConnectionCount = len(connections)
	}
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func writeJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temp := path + ".tmp"
	if err := os.WriteFile(temp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(temp, path)
}

func cloneMap(value map[string]any) map[string]any {
	cloned := make(map[string]any, len(value))
	for key, item := range value {
		cloned[key] = item
	}
	return cloned
}

func randomID() string {
	bytes := make([]byte, 12)
	_, _ = rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func safeSegment(value string) string {
	value = filepath.Base(strings.TrimSpace(value))
	value = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, value)
	if value == "" || value == "." {
		return "item"
	}
	return value
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func number(value any) (float64, bool) {
	number, ok := value.(float64)
	return number, ok
}

func extensionForMIME(contentType string) string {
	switch strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0])) {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "video/webm":
		return ".webm"
	case "video/mp4":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav":
		return ".wav"
	case "audio/ogg":
		return ".ogg"
	default:
		return ".png"
	}
}
