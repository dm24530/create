package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
)

const (
	VideoReferenceBillingModeOff        = "off"
	VideoReferenceBillingModeMaxSeconds = "max_seconds"
	VideoReferenceBillingModeSumSeconds = "sum_seconds"

	maxReferenceVideoProbeBytes = 64 * 1024 * 1024
	referenceVideoProbeTimeout  = 30 * time.Second
)

var probeReferenceVideoDuration = probeReferenceVideoDurationWithFFprobe

// ProbeReferenceVideoBillingSeconds measures reference videos server-side. The
// returned value is the model billing seconds (max or sum), never client input.
func ProbeReferenceVideoBillingSeconds(ctx context.Context, urls []string, mode string) (int, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "" || mode == VideoReferenceBillingModeOff || len(urls) == 0 {
		return 0, nil
	}
	if mode != VideoReferenceBillingModeMaxSeconds && mode != VideoReferenceBillingModeSumSeconds {
		return 0, fmt.Errorf("unsupported reference video billing mode: %s", mode)
	}

	normalizedURLs := make([]string, 0, len(urls))
	for _, rawURL := range urls {
		if rawURL = strings.TrimSpace(rawURL); rawURL != "" {
			normalizedURLs = append(normalizedURLs, rawURL)
		}
	}
	if len(normalizedURLs) == 0 {
		return 0, nil
	}

	probeCtx, cancel := context.WithTimeout(ctx, referenceVideoProbeTimeout)
	defer cancel()
	durations := make([]time.Duration, len(normalizedURLs))
	errCh := make(chan error, len(normalizedURLs))
	semaphore := make(chan struct{}, 3)
	var wg sync.WaitGroup
	for i, rawURL := range normalizedURLs {
		wg.Add(1)
		go func(index int, videoURL string) {
			defer wg.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-probeCtx.Done():
				errCh <- probeCtx.Err()
				return
			}
			duration, err := probeReferenceVideoDuration(probeCtx, videoURL)
			if err != nil {
				errCh <- fmt.Errorf("probe reference video duration: %w", err)
				return
			}
			durations[index] = duration
		}(i, rawURL)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			return 0, err
		}
	}

	total := 0
	maxSeconds := 0
	for _, duration := range durations {
		seconds := int(math.Ceil(duration.Seconds()))
		if seconds <= 0 {
			return 0, errors.New("reference video duration is zero or unavailable")
		}
		total += seconds
		if seconds > maxSeconds {
			maxSeconds = seconds
		}
	}
	if mode == VideoReferenceBillingModeMaxSeconds {
		return maxSeconds, nil
	}
	return total, nil
}

func probeReferenceVideoDurationWithFFprobe(ctx context.Context, rawURL string) (time.Duration, error) {
	if err := config.ValidateAbsoluteHTTPURL(rawURL); err != nil {
		return 0, err
	}
	parsed, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return 0, err
	}
	if private, err := isPrivateOrLoopbackHost(ctx, parsed.URL.Hostname()); err != nil {
		return 0, err
	} else if private {
		return 0, errors.New("reference video host is not public")
	}

	probeCtx, cancel := context.WithTimeout(ctx, referenceVideoProbeTimeout)
	defer cancel()
	client := newSSRFSafeHTTPClient(referenceVideoProbeTimeout)
	req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return 0, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("reference video download status %d", resp.StatusCode)
	}
	if resp.ContentLength > maxReferenceVideoProbeBytes {
		return 0, fmt.Errorf("reference video exceeds %d bytes", maxReferenceVideoProbeBytes)
	}

	tmp, err := os.CreateTemp("", "create-reference-video-*")
	if err != nil {
		return 0, err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}()
	written, err := io.Copy(tmp, io.LimitReader(resp.Body, maxReferenceVideoProbeBytes+1))
	if err != nil {
		return 0, err
	}
	if written > maxReferenceVideoProbeBytes {
		return 0, fmt.Errorf("reference video exceeds %d bytes", maxReferenceVideoProbeBytes)
	}
	if err := tmp.Sync(); err != nil {
		return 0, err
	}
	if err := tmp.Close(); err != nil {
		return 0, err
	}

	return probeVideoFileDurationWithFFprobe(probeCtx, tmpName)
}

func probeVideoFileDurationWithFFprobe(ctx context.Context, path string) (time.Duration, error) {
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path)
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe failed: %w", err)
	}
	seconds, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil || seconds <= 0 {
		return 0, fmt.Errorf("invalid video duration %q", strings.TrimSpace(string(out)))
	}
	return time.Duration(seconds * float64(time.Second)), nil
}
