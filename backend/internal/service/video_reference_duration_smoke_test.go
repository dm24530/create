package service

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestFFprobeReferenceVideoDurationSmoke(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe is not installed")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "reference.mp4")
	cmd := exec.Command("ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10", "-t", "2", "-pix_fmt", "yuv420p", path)
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, string(out))

	duration, err := probeVideoFileDurationWithFFprobe(context.Background(), path)
	require.NoError(t, err)
	require.InDelta(t, 2*time.Second, duration, float64(250*time.Millisecond))
}
