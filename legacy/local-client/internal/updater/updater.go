package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const releasesAPI = "https://api.github.com/repos/diminglucky/create/releases?per_page=30"
const manifestURL = "https://create.superai.sbs/api/v1/public/local-client/latest.json"

type Status struct {
	Available bool   `json:"available"`
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Notes     string `json:"notes"`
	Applied   bool   `json:"applied"`
	Error     string `json:"error,omitempty"`
}

type Manager struct {
	current string
	exePath string
	dataDir string
	client  *http.Client
	mu      sync.RWMutex
	status  Status
	release *releaseInfo
}

type releaseInfo struct {
	version    string
	notes      string
	exeURL     string
	shaURL     string
	stagedPath string
}

type githubRelease struct {
	TagName    string        `json:"tag_name"`
	Body       string        `json:"body"`
	Draft      bool          `json:"draft"`
	Prerelease bool          `json:"prerelease"`
	Assets     []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

func New(currentVersion, dataDir string) (*Manager, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	executable, err = filepath.Abs(executable)
	if err != nil {
		return nil, err
	}
	return &Manager{
		current: normalizeVersion(currentVersion),
		exePath: executable,
		dataDir: dataDir,
		client:  &http.Client{Timeout: 45 * time.Second},
		status:  Status{Current: normalizeVersion(currentVersion)},
	}, nil
}

func (m *Manager) Status() Status {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.status
}

func (m *Manager) Check(ctx context.Context) error {
	found, err := m.checkManifest(ctx)
	if err == nil && found {
		return nil
	}
	if err != nil && !errors.Is(err, errManifestNotFound) {
		m.setError(err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, releasesAPI, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "Create-Local/"+m.current)
	request.Header.Set("Accept", "application/vnd.github+json")
	response, err := m.client.Do(request)
	if err != nil {
		m.setError(err)
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		m.mu.Lock()
		m.status = Status{Available: false, Current: m.current, Latest: m.current}
		m.release = nil
		m.mu.Unlock()
		return nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		err := fmt.Errorf("GitHub releases returned HTTP %d", response.StatusCode)
		m.setError(err)
		return err
	}
	var releases []githubRelease
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&releases); err != nil {
		m.setError(err)
		return err
	}
	for _, candidate := range releases {
		if candidate.Draft || candidate.Prerelease || !strings.HasPrefix(candidate.TagName, "local-v") {
			continue
		}
		version := normalizeVersion(strings.TrimPrefix(candidate.TagName, "local-v"))
		if compareVersion(version, m.current) <= 0 {
			break
		}
		var exeURL, shaURL string
		for _, asset := range candidate.Assets {
			switch asset.Name {
			case "create-local.exe":
				exeURL = asset.BrowserDownloadURL
			case "create-local.exe.sha256":
				shaURL = asset.BrowserDownloadURL
			}
		}
		if exeURL == "" || shaURL == "" {
			continue
		}
		m.mu.Lock()
		m.release = &releaseInfo{version: version, notes: candidate.Body, exeURL: exeURL, shaURL: shaURL}
		m.status = Status{Available: true, Current: m.current, Latest: version, Notes: candidate.Body}
		m.mu.Unlock()
		return nil
	}
	m.mu.Lock()
	m.status = Status{Available: false, Current: m.current, Latest: m.current}
	m.release = nil
	m.mu.Unlock()
	return nil
}

var errManifestNotFound = errors.New("update manifest not found")

type updateManifest struct {
	Version   string `json:"version"`
	Notes     string `json:"notes"`
	ExeURL    string `json:"exe_url"`
	SHA256URL string `json:"sha256_url"`
}

func (m *Manager) checkManifest(ctx context.Context) (bool, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return false, err
	}
	request.Header.Set("User-Agent", "Create-Local/"+m.current)
	response, err := m.client.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return false, errManifestNotFound
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return false, fmt.Errorf("update manifest returned HTTP %d", response.StatusCode)
	}
	var manifest updateManifest
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&manifest); err != nil {
		return false, err
	}
	version := normalizeVersion(manifest.Version)
	if compareVersion(version, m.current) <= 0 {
		m.mu.Lock()
		m.status = Status{Available: false, Current: m.current, Latest: m.current}
		m.release = nil
		m.mu.Unlock()
		return true, nil
	}
	exeURL, err := resolveAssetURL(manifest.ExeURL)
	if err != nil {
		return false, err
	}
	shaURL, err := resolveAssetURL(manifest.SHA256URL)
	if err != nil {
		return false, err
	}
	m.mu.Lock()
	m.release = &releaseInfo{version: version, notes: manifest.Notes, exeURL: exeURL, shaURL: shaURL}
	m.status = Status{Available: true, Current: m.current, Latest: version, Notes: manifest.Notes}
	m.mu.Unlock()
	return true, nil
}

func resolveAssetURL(value string) (string, error) {
	asset, err := url.Parse(strings.TrimSpace(value))
	if err != nil || asset.String() == "" {
		return "", errors.New("invalid update asset URL")
	}
	if asset.IsAbs() {
		if asset.Scheme != "https" {
			return "", errors.New("update asset must use HTTPS")
		}
		return asset.String(), nil
	}
	baseURL, err := url.Parse(manifestURL)
	if err != nil {
		return "", err
	}
	return baseURL.ResolveReference(asset).String(), nil
}

func (m *Manager) Apply(ctx context.Context) error {
	m.mu.RLock()
	release := m.release
	m.mu.RUnlock()
	if release == nil {
		return errors.New("no update available")
	}
	shaBody, err := m.download(ctx, release.shaURL, 1<<20)
	if err != nil {
		m.setError(err)
		return err
	}
	expected, err := parseChecksum(shaBody)
	if err != nil {
		m.setError(err)
		return err
	}
	executable, err := m.download(ctx, release.exeURL, 512<<20)
	if err != nil {
		m.setError(err)
		return err
	}
	actual := sha256.Sum256(executable)
	if !strings.EqualFold(hex.EncodeToString(actual[:]), expected) {
		err := errors.New("update checksum mismatch")
		m.setError(err)
		return err
	}
	updateDir := filepath.Join(m.dataDir, "update")
	if err := os.MkdirAll(updateDir, 0o755); err != nil {
		return err
	}
	staged := filepath.Join(updateDir, "create-local-next.exe")
	temp := staged + ".partial"
	if err := os.WriteFile(temp, executable, 0o755); err != nil {
		return err
	}
	if err := os.Rename(temp, staged); err != nil {
		return err
	}
	if err := m.scheduleReplacement(staged); err != nil {
		m.setError(err)
		return err
	}
	m.mu.Lock()
	m.status.Applied = true
	m.mu.Unlock()
	return nil
}

func (m *Manager) scheduleReplacement(staged string) error {
	if runtime.GOOS != "windows" {
		return errors.New("automatic local update replacement is currently implemented for Windows")
	}
	pid := os.Getpid()
	target := m.exePath
	script := fmt.Sprintf(
		`$pidToWait=%d; $source=%q; $target=%q; Start-Sleep -Seconds 2; `+
			`for($i=0;$i -lt 60;$i++){ if(-not (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue)){break}; Start-Sleep -Milliseconds 500 }; `+
			`Copy-Item -LiteralPath $source -Destination $target -Force; Start-Process -FilePath $target`,
		pid, staged, target,
	)
	command := exec.Command("powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-Command", script)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command.Start()
}

func (m *Manager) download(ctx context.Context, address string, limit int64) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "Create-Local/"+m.current)
	response, err := m.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("download returned HTTP %d", response.StatusCode)
	}
	return io.ReadAll(io.LimitReader(response.Body, limit))
}

func (m *Manager) setError(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.status.Error = err.Error()
}

func parseChecksum(body []byte) (string, error) {
	fields := strings.Fields(string(body))
	if len(fields) == 0 || len(fields[0]) != 64 {
		return "", errors.New("invalid update checksum file")
	}
	if _, err := hex.DecodeString(fields[0]); err != nil {
		return "", errors.New("invalid update checksum")
	}
	return strings.ToLower(fields[0]), nil
}

func normalizeVersion(value string) string {
	value = strings.TrimSpace(strings.TrimPrefix(value, "v"))
	if value == "" {
		return "0.0.0"
	}
	return value
}

func compareVersion(left, right string) int {
	leftParts := versionParts(left)
	rightParts := versionParts(right)
	length := len(leftParts)
	if len(rightParts) > length {
		length = len(rightParts)
	}
	for i := 0; i < length; i++ {
		var a, b int
		if i < len(leftParts) {
			a = leftParts[i]
		}
		if i < len(rightParts) {
			b = rightParts[i]
		}
		if a < b {
			return -1
		}
		if a > b {
			return 1
		}
	}
	return 0
}

func versionParts(value string) []int {
	value = strings.SplitN(value, "-", 2)[0]
	raw := strings.Split(value, ".")
	parts := make([]int, 0, len(raw))
	for _, item := range raw {
		number, _ := strconv.Atoi(item)
		parts = append(parts, number)
	}
	return parts
}
