package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
)

const settingsVersion = 1

type Settings struct {
	Version             int    `json:"version"`
	ImageDir            string `json:"image_dir"`
	VideoDir            string `json:"video_dir"`
	OtherDir            string `json:"other_dir"`
	OpenFolderAfterSave bool   `json:"open_folder_after_save"`
}

type Store struct {
	Root string
}

func DefaultRoot() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "CreateLocal"), nil
}

func NewStore(root string) *Store {
	return &Store{Root: root}
}

func (s *Store) SettingsPath() string {
	return filepath.Join(s.Root, "settings.json")
}

func (s *Store) Load() (Settings, error) {
	settings, err := s.defaults()
	if err != nil {
		return Settings{}, err
	}
	data, err := os.ReadFile(s.SettingsPath())
	if errors.Is(err, os.ErrNotExist) {
		return settings, nil
	}
	if err != nil {
		return Settings{}, err
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return Settings{}, err
	}
	return s.Validate(settings)
}

func (s *Store) Save(settings Settings) (Settings, error) {
	validated, err := s.Validate(settings)
	if err != nil {
		return Settings{}, err
	}
	if err := os.MkdirAll(s.Root, 0o755); err != nil {
		return Settings{}, err
	}
	data, err := json.MarshalIndent(validated, "", "  ")
	if err != nil {
		return Settings{}, err
	}
	temporary := s.SettingsPath() + ".tmp"
	if err := os.WriteFile(temporary, append(data, '\n'), 0o644); err != nil {
		return Settings{}, err
	}
	if err := os.Rename(temporary, s.SettingsPath()); err != nil {
		return Settings{}, err
	}
	return validated, nil
}

func (s *Store) Validate(settings Settings) (Settings, error) {
	settings.Version = settingsVersion
	for name, value := range map[string]string{
		"image directory": settings.ImageDir,
		"video directory": settings.VideoDir,
		"other directory": settings.OtherDir,
	} {
		if value == "" {
			return Settings{}, errors.New(name + " cannot be empty")
		}
		if !filepath.IsAbs(value) {
			return Settings{}, errors.New(name + " must be absolute")
		}
	}
	return settings, nil
}

func (s *Store) defaults() (Settings, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Settings{}, err
	}
	pictures := filepath.Join(home, "Pictures")
	downloads := filepath.Join(home, "Downloads")
	if runtime.GOOS == "windows" {
		pictures = filepath.Join(home, "Pictures")
		downloads = filepath.Join(home, "Downloads")
	}
	return Settings{
		Version:  settingsVersion,
		ImageDir: filepath.Join(pictures, "Create", "Images"),
		VideoDir: filepath.Join(pictures, "Create", "Videos"),
		OtherDir: filepath.Join(downloads, "Create"),
	}, nil
}
