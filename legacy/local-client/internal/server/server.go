package server

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/diminglucky/create/local-client/internal/config"
	"github.com/diminglucky/create/local-client/internal/localdata"
	"github.com/diminglucky/create/local-client/internal/save"
	"github.com/diminglucky/create/local-client/internal/updater"
	"github.com/diminglucky/create/local-client/internal/webassets"
)

const localTokenHeader = "X-Create-Local-Token"

type Server struct {
	remoteURL    *url.URL
	remoteOrigin string
	settings     *config.Store
	saveStore    *save.Store
	token        string
	distFS       fs.FS
	proxy        *httputil.ReverseProxy
	settingsMu   sync.RWMutex
	updater      *updater.Manager
	dataStore    *localdata.Store
}

func (s *Server) SetUpdater(manager *updater.Manager) {
	s.updater = manager
}

func New(remoteURL string, settings *config.Store, saveStore *save.Store) (*Server, error) {
	parsed, err := url.Parse(remoteURL)
	if err != nil || parsed.Scheme != "https" {
		return nil, errors.New("remote URL must be HTTPS")
	}
	tokenBytes := make([]byte, 24)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, err
	}
	distFS, err := fs.Sub(webassets.FS, "dist")
	if err != nil {
		return nil, err
	}
	server := &Server{
		remoteURL:    parsed,
		remoteOrigin: parsed.Scheme + "://" + parsed.Host,
		settings:     settings,
		saveStore:    saveStore,
		token:        hex.EncodeToString(tokenBytes),
		distFS:       distFS,
		dataStore:    localdata.New(settings.Root),
	}
	server.proxy = server.newReverseProxy()
	return server, nil
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(s.serveHTTP)
}

func (s *Server) LocalToken() string {
	return s.token
}

func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/__local/health" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "remote": s.remoteOrigin})
		return
	}
	if r.URL.Path == "/__local/agent.js" {
		http.ServeFileFS(w, r, webassets.FS, "local/agent.js")
		return
	}
	if strings.HasPrefix(r.URL.Path, "/__local/media/") {
		s.serveLocalMedia(w, r)
		return
	}
	if r.URL.Path == "/__local/settings.js" {
		http.ServeFileFS(w, r, webassets.FS, "local/settings.js")
		return
	}
	if r.URL.Path == "/__local/" || r.URL.Path == "/__local" {
		s.serveSettingsPage(w)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/__local/") {
		if !s.requireLocalToken(w, r) {
			return
		}
		s.serveLocalAPI(w, r)
		return
	}

	if isAdminPath(r.URL.Path) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	if s.serveLocalDataAPI(w, r) {
		return
	}
	if isProxyPath(r.URL.Path) {
		s.proxy.ServeHTTP(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	s.serveFrontend(w, r)
}

func (s *Server) serveLocalMedia(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/__local/media/")
	if name == "" || strings.Contains(name, "/") || strings.Contains(name, "\\") {
		http.NotFound(w, r)
		return
	}
	target := filepath.Join(s.settings.Root, "media", filepath.Base(name))
	if _, err := os.Stat(target); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeFile(w, r, target)
}

func (s *Server) serveLocalDataAPI(w http.ResponseWriter, r *http.Request) bool {
	pathValue := r.URL.Path
	if strings.HasPrefix(pathValue, "/api/v1/image-studio/gallery") {
		s.handleGallery(w, r, "image")
		return true
	}
	if strings.HasPrefix(pathValue, "/api/v1/video-studio/gallery") {
		s.handleGallery(w, r, "video")
		return true
	}
	if pathValue == "/api/v1/image-studio/client-errors" || pathValue == "/api/v1/video-studio/client-errors" {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	if strings.HasPrefix(pathValue, "/api/v1/canvas/projects") {
		s.handleCanvasProjects(w, r)
		return true
	}
	if strings.HasPrefix(pathValue, "/api/v1/canvas/assets") {
		http.NotFound(w, r)
		return true
	}
	return false
}

func (s *Server) handleGallery(w http.ResponseWriter, r *http.Request, kind string) {
	pathValue := strings.TrimPrefix(r.URL.Path, "/api/v1/image-studio/gallery")
	if kind == "video" {
		pathValue = strings.TrimPrefix(r.URL.Path, "/api/v1/video-studio/gallery")
	}
	switch {
	case pathValue == "" && r.Method == http.MethodGet:
		entries, err := s.dataStore.ListGallery(kind, r.URL.Query().Get("scope"))
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeAPIData(w, entries)
	case pathValue == "" && r.Method == http.MethodPost:
		var input map[string]any
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(&input); err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid gallery payload")
			return
		}
		entry, err := s.dataStore.SaveGallery(kind, input)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeAPIData(w, entry)
	case pathValue == "/quota" && r.Method == http.MethodGet:
		quota, err := s.dataStore.GalleryQuota(kind)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeAPIData(w, quota)
	case strings.HasSuffix(pathValue, "/pin") && r.Method == http.MethodPost:
		id := strings.TrimSuffix(strings.TrimPrefix(pathValue, "/"), "/pin")
		entry, err := s.dataStore.SetGallerySaved(kind, id, true)
		if err != nil {
			writeAPIError(w, http.StatusNotFound, "gallery item not found")
			return
		}
		writeAPIData(w, entry)
	case strings.HasSuffix(pathValue, "/unpin") && r.Method == http.MethodPost:
		id := strings.TrimSuffix(strings.TrimPrefix(pathValue, "/"), "/unpin")
		entry, err := s.dataStore.SetGallerySaved(kind, id, false)
		if err != nil {
			writeAPIError(w, http.StatusNotFound, "gallery item not found")
			return
		}
		writeAPIData(w, map[string]any{"saved": false, "expires_at": entry["expires_at"]})
	case r.Method == http.MethodDelete:
		id := strings.TrimPrefix(pathValue, "/")
		if err := s.dataStore.DeleteGallery(kind, id); err != nil {
			writeAPIError(w, http.StatusNotFound, "gallery item not found")
			return
		}
		writeAPIData(w, map[string]any{"deleted": true})
	case strings.HasSuffix(pathValue, "/download") || strings.HasSuffix(pathValue, "/thumbnail"):
		id := strings.TrimPrefix(pathValue, "/")
		id = strings.TrimSuffix(strings.TrimSuffix(id, "/download"), "/thumbnail")
		mediaPath, err := s.dataStore.MediaPath(id)
		if err != nil {
			writeAPIError(w, http.StatusNotFound, "gallery media not found")
			return
		}
		http.ServeFile(w, r, mediaPath)
	case strings.HasSuffix(pathValue, "/download-url"):
		id := strings.TrimSuffix(strings.TrimPrefix(pathValue, "/"), "/download-url")
		mediaURL, err := s.dataStore.MediaURL(id)
		if err != nil {
			writeAPIError(w, http.StatusNotFound, "gallery media not found")
			return
		}
		writeAPIData(w, map[string]string{"url": mediaURL, "filename": filepath.Base(mediaURL)})
	default:
		writeAPIError(w, http.StatusNotFound, "gallery endpoint not found")
	}
}

func (s *Server) handleCanvasProjects(w http.ResponseWriter, r *http.Request) {
	pathValue := strings.TrimPrefix(r.URL.Path, "/api/v1/canvas/projects")
	switch {
	case pathValue == "" && r.Method == http.MethodGet:
		projects, err := s.dataStore.ListCanvasProjects()
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeAPIData(w, projects)
	case pathValue == "/full" && r.Method == http.MethodGet:
		projects, err := s.dataStore.ListCanvasProjects()
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeAPIData(w, projects)
	case strings.HasPrefix(pathValue, "/") && r.Method == http.MethodGet:
		id := strings.TrimPrefix(pathValue, "/")
		project, err := s.dataStore.GetCanvasProject(id)
		if err != nil {
			writeAPIError(w, http.StatusNotFound, "canvas project not found")
			return
		}
		writeAPIData(w, project)
	case strings.HasPrefix(pathValue, "/") && r.Method == http.MethodPut:
		id := strings.TrimPrefix(pathValue, "/")
		var input map[string]any
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(&input); err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid canvas payload")
			return
		}
		project, err := s.dataStore.PutCanvasProject(id, input)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeAPIData(w, map[string]any{"id": project.ID, "version": project.Version, "updated_at": project.UpdatedAt})
	case strings.HasPrefix(pathValue, "/") && r.Method == http.MethodDelete:
		id := strings.TrimPrefix(pathValue, "/")
		if err := s.dataStore.DeleteCanvasProject(id); err != nil {
			writeAPIError(w, http.StatusNotFound, "canvas project not found")
			return
		}
		writeAPIData(w, map[string]bool{"deleted": true})
	default:
		writeAPIError(w, http.StatusNotFound, "canvas endpoint not found")
	}
}

func writeAPIData(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, map[string]any{"code": 0, "message": "success", "data": data})
}

func writeAPIError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"code": status, "message": message})
}

func (s *Server) serveFrontend(w http.ResponseWriter, r *http.Request) {
	clean := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if clean == "" {
		s.serveIndex(w, r)
		return
	}
	info, err := fs.Stat(s.distFS, clean)
	if err == nil && !info.IsDir() {
		if strings.HasPrefix(clean, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.ServeFileFS(w, r, s.distFS, clean)
		return
	}
	if strings.HasPrefix(clean, "canvas-app/") || !strings.Contains(path.Base(clean), ".") {
		if clean == "canvas-app" || strings.HasPrefix(clean, "canvas-app/") {
			s.serveCanvasIndex(w)
			return
		}
		s.serveIndex(w, r)
		return
	}
	http.NotFound(w, r)
}

func (s *Server) serveCanvasIndex(w http.ResponseWriter) {
	data, err := fs.ReadFile(s.distFS, "canvas-app/index.html")
	if err != nil {
		http.Error(w, "Create assets are missing", http.StatusServiceUnavailable)
		return
	}
	injected := s.injectLocalAgent(data)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(injected)
}

func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	data, err := fs.ReadFile(s.distFS, "index.html")
	if err != nil {
		http.Error(w, "Create frontend assets are missing", http.StatusServiceUnavailable)
		return
	}
	injected := s.injectLocalAgent(data)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(injected)
}

func (s *Server) serveSettingsPage(w http.ResponseWriter) {
	data, err := fs.ReadFile(webassets.FS, "local/settings.html")
	if err != nil {
		http.Error(w, "settings page missing", http.StatusInternalServerError)
		return
	}
	data = bytes.ReplaceAll(data, []byte("{{TOKEN}}"), []byte(s.token))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

func (s *Server) injectLocalAgent(index []byte) []byte {
	tag := []byte(`<meta name="create-local-token" content="` + s.token + `">` +
		`<script src="/__local/agent.js"></script>`)
	if bytes.Contains(index, []byte(`name="create-local-token"`)) {
		return index
	}
	if bytes.Contains(index, []byte("</head>")) {
		return bytes.Replace(index, []byte("</head>"), append(tag, []byte("</head>")...), 1)
	}
	return append(index, tag...)
}

func (s *Server) serveLocalAPI(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/__local/settings":
		s.handleSettings(w, r)
	case "/__local/save":
		s.handleSave(w, r)
	case "/__local/choose-folder":
		s.handleChooseFolder(w, r)
	case "/__local/open-folder":
		s.handleOpenFolder(w, r)
	case "/__local/update-status":
		s.handleUpdateStatus(w, r)
	case "/__local/update":
		s.handleUpdateApply(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.updater == nil {
		writeJSON(w, http.StatusOK, updater.Status{Available: false, Current: "dev", Latest: "dev"})
		return
	}
	writeJSON(w, http.StatusOK, s.updater.Status())
}

func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.updater == nil {
		http.Error(w, "updater unavailable", http.StatusServiceUnavailable)
		return
	}
	if err := s.updater.Apply(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"applied": true})
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		settings, err := s.settings.Load()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, settings)
	case http.MethodPut:
		var candidate config.Settings
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&candidate); err != nil {
			http.Error(w, "invalid settings", http.StatusBadRequest)
			return
		}
		s.settingsMu.Lock()
		settings, err := s.settings.Save(candidate)
		s.settingsMu.Unlock()
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, settings)
	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	s.settingsMu.RLock()
	settings, err := s.settings.Load()
	s.settingsMu.RUnlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	kind := save.Kind(strings.TrimSpace(r.URL.Query().Get("kind")))
	filename := strings.TrimSpace(r.URL.Query().Get("filename"))
	if filename == "" {
		filename = "download.bin"
	}
	contentType := r.Header.Get("Content-Type")
	if kind == "" {
		kind = save.Classify(filename, contentType)
	}
	directory := settings.OtherDir
	switch kind {
	case save.KindImage:
		directory = settings.ImageDir
	case save.KindVideo:
		directory = settings.VideoDir
	}
	result, err := s.saveStore.SaveFile(directory, filename, contentType, io.LimitReader(r.Body, 2<<30))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if settings.OpenFolderAfterSave {
		_ = openDirectory(filepath.Dir(result.Path))
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleChooseFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	directory, err := chooseDirectory()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": directory})
}

func (s *Server) handleOpenFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	settings, err := s.settings.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	directory := settings.OtherDir
	switch r.URL.Query().Get("kind") {
	case "image":
		directory = settings.ImageDir
	case "video":
		directory = settings.VideoDir
	}
	if err := os.MkdirAll(directory, 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := openDirectory(directory); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) requireLocalToken(w http.ResponseWriter, r *http.Request) bool {
	if r.Header.Get(localTokenHeader) != s.token {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		originURL, err := url.Parse(origin)
		if err != nil || originURL.Hostname() != "127.0.0.1" && originURL.Hostname() != "localhost" {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return false
		}
	}
	return true
}

func (s *Server) newReverseProxy() *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(s.remoteURL)
	originalDirector := proxy.Director
	proxy.Director = func(request *http.Request) {
		originalDirector(request)
		request.Host = s.remoteURL.Host
		request.Header.Del("Accept-Encoding")
		request.Header.Set("X-Create-Local-Client", "1")
	}
	proxy.ModifyResponse = func(response *http.Response) error {
		if location := response.Header.Get("Location"); strings.HasPrefix(location, s.remoteOrigin) {
			response.Header.Set("Location", strings.TrimPrefix(location, s.remoteOrigin))
		}
		cookies := response.Header.Values("Set-Cookie")
		if len(cookies) > 0 {
			response.Header.Del("Set-Cookie")
			for _, cookie := range cookies {
				cookie = stripCookieDomain(cookie)
				response.Header.Add("Set-Cookie", cookie)
			}
		}
		if response.Request.URL.Path == "/api/v1/settings/public" {
			return rewritePublicSettings(response)
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		http.Error(w, "Create remote server unavailable: "+err.Error(), http.StatusBadGateway)
	}
	return proxy
}

func stripCookieDomain(cookie string) string {
	parts := strings.Split(cookie, ";")
	filtered := parts[:0]
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if strings.HasPrefix(strings.ToLower(trimmed), "domain=") {
			continue
		}
		filtered = append(filtered, part)
	}
	return strings.Join(filtered, ";")
}

func rewritePublicSettings(response *http.Response) error {
	body, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return err
	}
	_ = response.Body.Close()
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err == nil {
		if data, ok := payload["data"].(map[string]any); ok {
			data["api_base_url"] = "/v1"
		}
		if encoded, marshalErr := json.Marshal(payload); marshalErr == nil {
			body = encoded
		}
	}
	response.Body = io.NopCloser(bytes.NewReader(body))
	response.ContentLength = int64(len(body))
	response.Header.Set("Content-Length", strconvItoa(len(body)))
	response.Header.Set("Content-Type", "application/json; charset=utf-8")
	return nil
}

func isAdminPath(value string) bool {
	return value == "/admin" ||
		strings.HasPrefix(value, "/admin/") ||
		value == "/api/v1/admin" ||
		strings.HasPrefix(value, "/api/v1/admin/")
}

func isProxyPath(value string) bool {
	return strings.HasPrefix(value, "/api/") ||
		value == "/v1" ||
		strings.HasPrefix(value, "/v1/") ||
		value == "/setup" ||
		strings.HasPrefix(value, "/setup/") ||
		value == "/backend-api" ||
		strings.HasPrefix(value, "/backend-api/")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func chooseDirectory() (string, error) {
	if runtime.GOOS != "windows" {
		return "", errors.New("folder picker is currently available on Windows only")
	}
	script := `Add-Type -AssemblyName System.Windows.Forms; ` +
		`$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; ` +
		`$dialog.Description = '选择 Create 保存目录'; ` +
		`if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }`
	command := exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", script)
	output, err := command.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

func openDirectory(directory string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer.exe", directory).Start()
	case "darwin":
		return exec.Command("open", directory).Start()
	default:
		return exec.Command("xdg-open", directory).Start()
	}
}

func strconvItoa(value int) string {
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
