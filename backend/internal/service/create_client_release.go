package service

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// CreateClientReleaseDownloads contains direct object-storage URLs. The API
// server must never proxy installer bytes for these routes.
type CreateClientReleaseDownloads struct {
	WindowsX64   string `json:"windows_x64"`
	WindowsARM64 string `json:"windows_arm64"`
	MacOSARM64   string `json:"macos_arm64"`
	MacOSX64     string `json:"macos_x64"`
}

// CreateClientRelease is the public release manifest consumed by the download
// page and, later, by the desktop updater.
type CreateClientRelease struct {
	Enabled        bool                         `json:"enabled"`
	Version        string                       `json:"version"`
	PublishedAt    string                       `json:"published_at"`
	MinimumVersion string                       `json:"minimum_version"`
	Notes          string                       `json:"notes"`
	UpdateBaseURL  string                       `json:"update_base_url"`
	Downloads      CreateClientReleaseDownloads `json:"downloads"`
}

// NormalizeCreateClientReleaseURL accepts only absolute HTTP(S) URLs. Empty is
// valid so an operator can publish only some platforms initially.
func NormalizeCreateClientReleaseURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("must be an absolute http:// or https:// URL")
	}
	parsed.Fragment = ""
	return parsed.String(), nil
}

func sanitizeCreateClientReleaseURL(raw string) string {
	value, err := NormalizeCreateClientReleaseURL(raw)
	if err != nil {
		return ""
	}
	return value
}

// GetCreateClientRelease returns only public release metadata. Raw invalid
// values are removed from the response instead of being emitted as links.
func (s *SettingService) GetCreateClientRelease(ctx context.Context) (*CreateClientRelease, error) {
	keys := []string{
		SettingKeyCreateClientReleaseEnabled,
		SettingKeyCreateClientReleaseVersion,
		SettingKeyCreateClientReleaseWindowsURL,
		SettingKeyCreateClientReleaseWindowsARM64URL,
		SettingKeyCreateClientReleaseMacOSARM64URL,
		SettingKeyCreateClientReleaseMacOSX64URL,
		SettingKeyCreateClientReleaseNotes,
		SettingKeyCreateClientReleasePublishedAt,
		SettingKeyCreateClientReleaseMinVersion,
		SettingKeyCreateClientReleaseUpdateBaseURL,
	}
	values, err := s.settingRepo.GetMultiple(ctx, keys)
	if err != nil {
		return nil, fmt.Errorf("get create client release: %w", err)
	}
	version := strings.TrimSpace(values[SettingKeyCreateClientReleaseVersion])
	downloads := CreateClientReleaseDownloads{
		WindowsX64:   sanitizeCreateClientReleaseURL(values[SettingKeyCreateClientReleaseWindowsURL]),
		WindowsARM64: sanitizeCreateClientReleaseURL(values[SettingKeyCreateClientReleaseWindowsARM64URL]),
		MacOSARM64:   sanitizeCreateClientReleaseURL(values[SettingKeyCreateClientReleaseMacOSARM64URL]),
		MacOSX64:     sanitizeCreateClientReleaseURL(values[SettingKeyCreateClientReleaseMacOSX64URL]),
	}
	// `enabled` is the public availability contract, not merely the raw admin
	// switch. Never advertise a release that has no version or usable installer.
	enabled := values[SettingKeyCreateClientReleaseEnabled] == "true" &&
		version != "" &&
		(downloads.WindowsX64 != "" || downloads.WindowsARM64 != "" || downloads.MacOSARM64 != "" || downloads.MacOSX64 != "")
	return &CreateClientRelease{
		Enabled:        enabled,
		Version:        version,
		PublishedAt:    strings.TrimSpace(values[SettingKeyCreateClientReleasePublishedAt]),
		MinimumVersion: strings.TrimSpace(values[SettingKeyCreateClientReleaseMinVersion]),
		Notes:          strings.TrimSpace(values[SettingKeyCreateClientReleaseNotes]),
		UpdateBaseURL:  sanitizeCreateClientReleaseURL(values[SettingKeyCreateClientReleaseUpdateBaseURL]),
		Downloads:      downloads,
	}, nil
}
