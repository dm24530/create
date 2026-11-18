//go:build unit

package service

import (
	"context"
	"errors"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

func TestGetCreateClientRelease_SanitizesDirectURLs(t *testing.T) {
	repo := &settingPublicRepoStub{values: map[string]string{
		SettingKeyCreateClientReleaseEnabled:         "true",
		SettingKeyCreateClientReleaseVersion:         "0.2.0",
		SettingKeyCreateClientReleasePublishedAt:     "2026-11-17",
		SettingKeyCreateClientReleaseMinVersion:      "0.1.0",
		SettingKeyCreateClientReleaseNotes:           "Local rendering and persistence.",
		SettingKeyCreateClientReleaseWindowsURL:      "https://downloads.example.com/Create-Setup-0.2.0.exe",
		SettingKeyCreateClientReleaseWindowsARM64URL: "https://downloads.example.com/Create-Setup-0.2.0-arm64.exe",
		SettingKeyCreateClientReleaseMacOSARM64URL:   "https://downloads.example.com/Create-0.2.0-arm64.dmg",
		SettingKeyCreateClientReleaseMacOSX64URL:     "javascript:alert(1)",
		SettingKeyCreateClientReleaseUpdateBaseURL:   "https://downloads.example.com/create/",
	}}
	svc := NewSettingService(repo, &config.Config{})

	release, err := svc.GetCreateClientRelease(context.Background())
	require.NoError(t, err)
	require.True(t, release.Enabled)
	require.Equal(t, "0.2.0", release.Version)
	require.Equal(t, "2026-11-17", release.PublishedAt)
	require.Equal(t, "0.1.0", release.MinimumVersion)
	require.Equal(t, "https://downloads.example.com/Create-Setup-0.2.0.exe", release.Downloads.WindowsX64)
	require.Equal(t, "https://downloads.example.com/Create-Setup-0.2.0-arm64.exe", release.Downloads.WindowsARM64)
	require.Equal(t, "https://downloads.example.com/Create-0.2.0-arm64.dmg", release.Downloads.MacOSARM64)
	require.Empty(t, release.Downloads.MacOSX64)
	require.Equal(t, "https://downloads.example.com/create/", release.UpdateBaseURL)
}

func TestGetCreateClientRelease_DefaultsToUnavailable(t *testing.T) {
	svc := NewSettingService(&settingPublicRepoStub{values: map[string]string{}}, &config.Config{})

	release, err := svc.GetCreateClientRelease(context.Background())
	require.NoError(t, err)
	require.False(t, release.Enabled)
	require.Empty(t, release.Version)
	require.Empty(t, release.Downloads.WindowsX64)
}

func TestGetCreateClientRelease_PropagatesRepositoryError(t *testing.T) {
	svc := NewSettingService(&settingPublicRepoStub{err: errors.New("db unavailable")}, &config.Config{})

	_, err := svc.GetCreateClientRelease(context.Background())
	require.Error(t, err)
}

func TestNormalizeCreateClientReleaseURL(t *testing.T) {
	normalized, err := NormalizeCreateClientReleaseURL("  https://downloads.example.com/file.exe#fragment  ")
	require.NoError(t, err)
	require.Equal(t, "https://downloads.example.com/file.exe", normalized)

	for _, invalid := range []string{"ftp://example.com/file", "file:///tmp/file", "//example.com/file", "javascript:alert(1)", "https://"} {
		_, err := NormalizeCreateClientReleaseURL(invalid)
		require.Error(t, err, "value=%q", invalid)
	}
}

func TestUpdateSettings_PersistsCreateClientReleaseFields(t *testing.T) {
	repo := &settingUpdateRepoStub{}
	svc := NewSettingService(repo, &config.Config{})

	err := svc.UpdateSettings(context.Background(), &SystemSettings{
		CreateClientReleaseEnabled:         true,
		CreateClientReleaseVersion:         "0.2.0",
		CreateClientReleaseWindowsURL:      "https://downloads.example.com/Create-Setup-0.2.0.exe",
		CreateClientReleaseWindowsARM64URL: "https://downloads.example.com/Create-Setup-0.2.0-arm64.exe",
		CreateClientReleaseMacOSARM64URL:   "https://downloads.example.com/Create-0.2.0-arm64.dmg",
		CreateClientReleaseMacOSX64URL:     "https://downloads.example.com/Create-0.2.0-x64.dmg",
		CreateClientReleaseNotes:           "Local-first release",
		CreateClientReleasePublishedAt:     "2026-11-17",
		CreateClientReleaseMinVersion:      "0.1.0",
		CreateClientReleaseUpdateBaseURL:   "https://downloads.example.com/create/",
	})
	require.NoError(t, err)

	require.Equal(t, "true", repo.updates[SettingKeyCreateClientReleaseEnabled])
	require.Equal(t, "0.2.0", repo.updates[SettingKeyCreateClientReleaseVersion])
	require.Equal(t, "https://downloads.example.com/Create-Setup-0.2.0.exe", repo.updates[SettingKeyCreateClientReleaseWindowsURL])
	require.Equal(t, "https://downloads.example.com/Create-Setup-0.2.0-arm64.exe", repo.updates[SettingKeyCreateClientReleaseWindowsARM64URL])
	require.Equal(t, "https://downloads.example.com/Create-0.2.0-arm64.dmg", repo.updates[SettingKeyCreateClientReleaseMacOSARM64URL])
	require.Equal(t, "https://downloads.example.com/Create-0.2.0-x64.dmg", repo.updates[SettingKeyCreateClientReleaseMacOSX64URL])
	require.Equal(t, "Local-first release", repo.updates[SettingKeyCreateClientReleaseNotes])
	require.Equal(t, "2026-11-17", repo.updates[SettingKeyCreateClientReleasePublishedAt])
	require.Equal(t, "0.1.0", repo.updates[SettingKeyCreateClientReleaseMinVersion])
	require.Equal(t, "https://downloads.example.com/create/", repo.updates[SettingKeyCreateClientReleaseUpdateBaseURL])
}

func TestGetCreateClientRelease_DoesNotAdvertiseWithoutUsableInstaller(t *testing.T) {
	repo := &settingPublicRepoStub{values: map[string]string{
		SettingKeyCreateClientReleaseEnabled:         "true",
		SettingKeyCreateClientReleaseVersion:         "0.2.0",
		SettingKeyCreateClientReleaseWindowsURL:      "javascript:alert(1)",
		SettingKeyCreateClientReleaseWindowsARM64URL: "ftp://downloads.example.com/file.exe",
		SettingKeyCreateClientReleaseMacOSARM64URL:   "",
		SettingKeyCreateClientReleaseMacOSX64URL:     "ftp://downloads.example.com/file.dmg",
	}}
	svc := NewSettingService(repo, &config.Config{})

	release, err := svc.GetCreateClientRelease(context.Background())
	require.NoError(t, err)
	require.False(t, release.Enabled)
	require.Empty(t, release.Downloads.WindowsX64)
	require.Empty(t, release.Downloads.MacOSX64)
}
