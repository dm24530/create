package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// pngBytes is a minimal payload whose signature makes http.DetectContentType
// report image/png.
var pngBytes = []byte("\x89PNG\r\n\x1a\nfake-png-payload")

type savedImage struct {
	key         string
	contentType string
	data        []byte
}

type fakeImageStorage struct {
	saved       []savedImage
	url         string
	err         error
	saveStarted chan struct{}
	release     chan struct{}
}

type fixedUserStorageIdentityResolver struct {
	key string
	err error
}

func (r fixedUserStorageIdentityResolver) StorageKey(context.Context, int64) (string, error) {
	return r.key, r.err
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func (f *fakeImageStorage) Save(_ context.Context, key, contentType string, data []byte) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	if f.saveStarted != nil {
		close(f.saveStarted)
	}
	if f.release != nil {
		<-f.release
	}
	f.saved = append(f.saved, savedImage{key: key, contentType: contentType, data: append([]byte(nil), data...)})
	if f.url != "" {
		return f.url, nil
	}
	return "https://cdn.test/" + key, nil
}

func TestImageResultUploaderRewritesB64JSON(t *testing.T) {
	storage := &fakeImageStorage{}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)

	b64 := base64.StdEncoding.EncodeToString(pngBytes)
	result := json.RawMessage(`{"created":1,"data":[{"b64_json":"` + b64 + `","revised_prompt":"a cat"}]}`)

	out, err := uploader.Rewrite(context.Background(), 42, "imgtask_abc", result)
	require.NoError(t, err)

	require.Len(t, storage.saved, 1)
	require.Equal(t, "images/users/42/imgtask_abc-0.png", storage.saved[0].key)
	require.Equal(t, "image/png", storage.saved[0].contentType)
	require.Equal(t, pngBytes, storage.saved[0].data)

	var parsed struct {
		Data []map[string]json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(out, &parsed))
	require.Len(t, parsed.Data, 1)
	require.JSONEq(t, `"https://cdn.test/images/users/42/imgtask_abc-0.png"`, string(parsed.Data[0]["url"]))
	_, hasB64 := parsed.Data[0]["b64_json"]
	require.False(t, hasB64, "b64_json must be stripped after offload")
	require.JSONEq(t, `"a cat"`, string(parsed.Data[0]["revised_prompt"]), "unrelated fields preserved")
}

func TestImageResultUploaderTranscodesOutputFormatBeforeUpload(t *testing.T) {
	storage := &fakeImageStorage{}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	validPNG, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	result := json.RawMessage(`{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString(validPNG) + `"}]}`)

	out, err := uploader.RewriteWithPreview(
		context.Background(),
		42,
		"imgtask_jpeg",
		result,
		nil,
		ImageRewriteOptions{OutputFormat: "jpeg"},
	)
	require.NoError(t, err)
	require.Len(t, storage.saved, 1)
	require.Equal(t, "images/users/42/imgtask_jpeg-0.jpg", storage.saved[0].key)
	require.Equal(t, "image/jpeg", storage.saved[0].contentType)
	_, format, err := image.Decode(bytes.NewReader(storage.saved[0].data))
	require.NoError(t, err)
	require.Equal(t, "jpeg", format)

	var parsed struct {
		Data []struct {
			MIMEType string `json:"mime_type"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(out, &parsed))
	require.Equal(t, "image/jpeg", parsed.Data[0].MIMEType)
}

func TestBuildImagePreviewKeepsAnimatedGIF(t *testing.T) {
	palette := color.Palette{color.Black, color.White}
	first := image.NewPaletted(image.Rect(0, 0, 2, 2), palette)
	second := image.NewPaletted(image.Rect(0, 0, 2, 2), palette)
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			first.SetColorIndex(x, y, uint8((x+y)%2))
			second.SetColorIndex(x, y, uint8((x+y+1)%2))
		}
	}
	var source bytes.Buffer
	require.NoError(t, gif.EncodeAll(&source, &gif.GIF{
		Image:     []*image.Paletted{first, second},
		Delay:     []int{10, 10},
		LoopCount: 0,
	}))

	preview, contentType, err := buildImagePreview(source.Bytes(), 1)
	require.NoError(t, err)
	require.Equal(t, "image/gif", contentType)
	decoded, err := gif.DecodeAll(bytes.NewReader(preview))
	require.NoError(t, err)
	require.Len(t, decoded.Image, 2)
	require.Equal(t, 1, decoded.Image[0].Bounds().Dx())
	require.Equal(t, 1, decoded.Image[0].Bounds().Dy())
	require.Equal(t, []int{10, 10}, decoded.Delay)
}

func TestBuildImagePreviewPreservesTransparency(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			source.SetNRGBA(x, y, color.NRGBA{R: 255, A: 128})
		}
	}
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, source))

	preview, contentType, err := buildImagePreview(encoded.Bytes(), 1)
	require.NoError(t, err)
	require.Equal(t, "image/png", contentType)
	decoded, err := png.Decode(bytes.NewReader(preview))
	require.NoError(t, err)
	_, _, _, alpha := decoded.At(0, 0).RGBA()
	require.Less(t, alpha, uint32(0xffff))
}

func TestTranscodeImageOutputUsesActualBytesInsteadOfDeclaredContentType(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 2, 2))
	source.Set(0, 0, color.RGBA{R: 255, A: 128})
	source.Set(1, 0, color.RGBA{G: 255, A: 255})
	var pngData bytes.Buffer
	require.NoError(t, png.Encode(&pngData, source))

	data, contentType, err := TranscodeImageOutput(pngData.Bytes(), "image/jpeg", "jpeg")
	require.NoError(t, err)
	require.Equal(t, "image/jpeg", contentType)
	_, format, err := image.Decode(bytes.NewReader(data))
	require.NoError(t, err)
	require.Equal(t, "jpeg", format)

	var jpegData bytes.Buffer
	require.NoError(t, jpeg.Encode(&jpegData, source, &jpeg.Options{Quality: 90}))
	data, contentType, err = TranscodeImageOutput(jpegData.Bytes(), "image/png", "jpeg")
	require.NoError(t, err)
	require.Equal(t, "image/jpeg", contentType)
	require.Equal(t, jpegData.Bytes(), data)
}

func TestTranscodeImageOutputFlattensTransparencyToWhiteForJPEG(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	var pngData bytes.Buffer
	require.NoError(t, png.Encode(&pngData, source))

	data, contentType, err := TranscodeImageOutput(pngData.Bytes(), "image/png", "jpeg")
	require.NoError(t, err)
	require.Equal(t, "image/jpeg", contentType)
	decoded, _, err := image.Decode(bytes.NewReader(data))
	require.NoError(t, err)
	red, green, blue, _ := decoded.At(16, 16).RGBA()
	require.Greater(t, red>>8, uint32(240))
	require.Greater(t, green>>8, uint32(240))
	require.Greater(t, blue>>8, uint32(240))
}

func TestTranscodeImageOutputPreservesGIF(t *testing.T) {
	source := image.NewPaletted(image.Rect(0, 0, 2, 2), color.Palette{
		color.RGBA{R: 255, A: 255},
		color.RGBA{G: 255, A: 255},
	})
	var gifData bytes.Buffer
	require.NoError(t, gif.Encode(&gifData, source, nil))

	data, contentType, err := TranscodeImageOutput(
		gifData.Bytes(),
		"application/octet-stream",
		"gif",
	)
	require.NoError(t, err)
	require.Equal(t, "image/gif", contentType)
	require.Equal(t, gifData.Bytes(), data)
	require.Equal(t, "gif", NormalizeImageOutputFormat("gif"))
	require.Equal(t, "gif", ImageOutputFormatFromObjectKey("generated.gif"))
}

func TestImageResultUploaderUsesOpaqueUserStorageKey(t *testing.T) {
	storage := &fakeImageStorage{}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	uploader.SetUserStorageIdentityResolver(fixedUserStorageIdentityResolver{
		key: "0123456789abcdef0123456789abcdef",
	})

	b64 := base64.StdEncoding.EncodeToString(pngBytes)
	result := json.RawMessage(`{"data":[{"b64_json":"` + b64 + `"}]}`)

	_, err := uploader.Rewrite(context.Background(), 42, "imgtask_abc", result)
	require.NoError(t, err)
	require.Len(t, storage.saved, 1)
	require.Equal(t,
		"images/0123456789abcdef0123456789abcdef/imgtask_abc-0.png",
		storage.saved[0].key,
	)
}

func TestImageResultUploaderDoesNotGenerateThumbnailBeforeRemoteUpload(t *testing.T) {
	storage := &fakeImageStorage{}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	validPNG, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	result := json.RawMessage(`{"data":[{"b64_json":"` +
		base64.StdEncoding.EncodeToString(validPNG) + `","mime_type":"image/png"}]}`)

	out, err := uploader.RewriteWithPreview(context.Background(), 42, "imgtask_preview", result, func(value json.RawMessage) error {
		t.Fatalf("unexpected generated preview: %s", value)
		return nil
	})
	require.NoError(t, err)
	require.Len(t, storage.saved, 1)
	require.Equal(t, "images/users/42/imgtask_preview-0.png", storage.saved[0].key)

	var parsedFinal struct {
		Data []struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(out, &parsedFinal))
	require.Len(t, parsedFinal.Data, 1)
	require.Equal(t, "https://cdn.test/images/users/42/imgtask_preview-0.png", parsedFinal.Data[0].URL)
	require.NotContains(t, string(out), "preview_data_url")
}

func TestImageResultUploaderStagesOriginalLocallyBeforeRemoteUpload(t *testing.T) {
	validPNG, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	storage := &fakeImageStorage{}
	local := NewLocalImageAssetStore(t.TempDir())
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	uploader.SetLocalAssets(local)
	result := json.RawMessage(`{"data":[{"b64_json":"` +
		base64.StdEncoding.EncodeToString(validPNG) + `","mime_type":"image/png"}]}`)

	out, err := uploader.Rewrite(context.Background(), 42, "imgtask_local", result)
	require.NoError(t, err)
	require.Empty(t, storage.saved, "the task must complete without waiting for the remote upload")

	var parsed struct {
		Data []struct {
			URL          string `json:"url"`
			LocalAssetID string `json:"local_asset_id"`
			ObjectKey    string `json:"object_key"`
			MIMEType     string `json:"mime_type"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(out, &parsed))
	require.Len(t, parsed.Data, 1)
	require.Equal(t, LocalImageAssetURLPrefix+parsed.Data[0].LocalAssetID, parsed.Data[0].URL)
	require.Equal(t, "images/users/42/imgtask_local-0.png", parsed.Data[0].ObjectKey)
	require.Equal(t, "image/png", parsed.Data[0].MIMEType)
	require.NotContains(t, string(out), "preview_data_url")

	meta, data, err := local.Read(parsed.Data[0].LocalAssetID)
	require.NoError(t, err)
	require.Equal(t, int64(42), meta.UserID)
	require.Equal(t, validPNG, data)
}

func TestImageResultUploaderPublishesSafeLocalOriginalPreview(t *testing.T) {
	validPNG, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	storage := &fakeImageStorage{}
	local := NewLocalImageAssetStore(t.TempDir())
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	uploader.SetLocalAssets(local)
	result := json.RawMessage(`{"data":[{"b64_json":"` +
		base64.StdEncoding.EncodeToString(validPNG) +
		`","mime_type":"image/png","display_url":"http://127.0.0.1/private"}]}`)

	var preview json.RawMessage
	_, err = uploader.RewriteWithPreview(
		context.Background(),
		42,
		"imgtask_local_preview",
		result,
		func(value json.RawMessage) error {
			preview = append(json.RawMessage(nil), value...)
			return nil
		},
	)
	require.NoError(t, err)
	require.NotEmpty(t, preview)
	require.Contains(t, string(preview), `/api/v1/public/image-assets/`)
	require.NotContains(t, string(preview), "127.0.0.1")
	require.NotContains(t, string(preview), "local_asset_id")
	require.NotContains(t, string(preview), "object_key")
	require.NotContains(t, string(preview), "b64_json")
}

func TestImageResultUploaderUsesLocalOriginalWithoutGeneratedThumbnail(t *testing.T) {
	validPNG, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	storage := &fakeImageStorage{}
	local := NewLocalImageAssetStore(t.TempDir())
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	uploader.SetLocalAssets(local)
	result := json.RawMessage(`{"data":[{"b64_json":"` +
		base64.StdEncoding.EncodeToString(validPNG) + `","mime_type":"image/png"}]}`)

	var previews []json.RawMessage
	out, err := uploader.RewriteWithPreview(
		context.Background(),
		42,
		"imgtask_original_only",
		result,
		func(value json.RawMessage) error {
			previews = append(previews, append(json.RawMessage(nil), value...))
			return nil
		},
	)
	require.NoError(t, err)
	require.Len(t, previews, 1)
	require.Contains(t, string(previews[0]), `"preview_url":"/api/v1/public/image-assets/`)
	require.NotContains(t, string(out), "preview_data_url")

	var parsed struct {
		Data []struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(out, &parsed))
	require.Len(t, parsed.Data, 1)
	require.Contains(t, parsed.Data[0].URL, "/api/v1/public/image-assets/")
}

func TestUpstreamPreviewItemsUsesOnlySafePublicURLs(t *testing.T) {
	items := []map[string]json.RawMessage{
		{
			"url":         encodedJSON("https://cdn.example.test/image.png"),
			"object_key":  encodedJSON("private/object.png"),
			"display_url": encodedJSON("http://127.0.0.1/private.png"),
		},
		{
			"url": encodedJSON("http://127.0.0.1/private.png"),
		},
		{
			"url": encodedJSON("data:image/png;base64,cG5n"),
		},
	}

	previews := upstreamPreviewItems(items)

	require.Len(t, previews, 1)
	require.JSONEq(t, `"https://cdn.example.test/image.png"`, string(previews[0]["url"]))
	require.JSONEq(t, `"https://cdn.example.test/image.png"`, string(previews[0]["preview_data_url"]))
	_, hasObjectKey := previews[0]["object_key"]
	require.False(t, hasObjectKey)
	_, hasDisplayURL := previews[0]["display_url"]
	require.False(t, hasDisplayURL)
}

func TestImageResultUploaderPublishesUpstreamURLBeforeDownloadCompletes(t *testing.T) {
	validPNG, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	storage := &fakeImageStorage{}
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "cdn.example.test", req.URL.Hostname())
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"image/png"}},
			Body:       io.NopCloser(bytes.NewReader(validPNG)),
			Request:    req,
		}, nil
	})}
	uploader := NewImageResultUploader(storage, "images/", 0, client)
	result := json.RawMessage(`{"data":[{"url":"https://cdn.example.test/image.png"}]}`)

	var previews []json.RawMessage
	_, err = uploader.RewriteWithPreview(
		context.Background(),
		42,
		"imgtask_upstream_preview",
		result,
		func(value json.RawMessage) error {
			previews = append(previews, append(json.RawMessage(nil), value...))
			return nil
		},
	)
	require.NoError(t, err)
	require.Len(t, previews, 1)
	require.Contains(t, string(previews[0]), `"url":"https://cdn.example.test/image.png"`)
	require.NotContains(t, string(previews[0]), "b64_json")
	require.Len(t, storage.saved, 1)
}

func TestImageResultUploaderFallsBackToRemoteWhenLocalStageFails(t *testing.T) {
	rootAsFile := filepath.Join(t.TempDir(), "not-a-directory")
	require.NoError(t, os.WriteFile(rootAsFile, []byte("file"), 0o600))
	local := NewLocalImageAssetStore(rootAsFile)
	storage := &fakeImageStorage{}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	uploader.SetLocalAssets(local)
	result := json.RawMessage(`{"data":[{"b64_json":"` +
		base64.StdEncoding.EncodeToString(pngBytes) + `","mime_type":"image/png"}]}`)

	out, err := uploader.Rewrite(context.Background(), 42, "imgtask_fallback", result)
	require.NoError(t, err)
	require.Len(t, storage.saved, 1)
	require.Equal(t, "images/users/42/imgtask_fallback-0.png", storage.saved[0].key)

	var parsed struct {
		Data []map[string]json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(out, &parsed))
	require.JSONEq(
		t,
		`"https://cdn.test/images/users/42/imgtask_fallback-0.png"`,
		string(parsed.Data[0]["url"]),
	)
	_, hasLocalAsset := parsed.Data[0]["local_asset_id"]
	require.False(t, hasLocalAsset)
}

func TestImageResultUploaderRewritesURL(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(pngBytes)
	}))
	defer upstream.Close()

	storage := &fakeImageStorage{}
	uploader := NewImageResultUploader(storage, "images/", 0, upstream.Client())

	result := json.RawMessage(`{"created":1,"data":[{"url":"` + upstream.URL + `/pic.png"}]}`)
	out, err := uploader.Rewrite(context.Background(), 42, "imgtask_xyz", result)
	require.NoError(t, err)

	require.Len(t, storage.saved, 1)
	require.Equal(t, pngBytes, storage.saved[0].data)
	require.Equal(t, "image/png", storage.saved[0].contentType)

	var parsed struct {
		Data []map[string]json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(out, &parsed))
	require.JSONEq(t, `"https://cdn.test/images/users/42/imgtask_xyz-0.png"`, string(parsed.Data[0]["url"]))
}

func TestImageResultUploaderDefaultClientRejectsPrivateNetworkURLs(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(pngBytes)
	}))
	defer upstream.Close()

	uploader := NewImageResultUploader(&fakeImageStorage{}, "images/", 0, nil)
	_, _, err := uploader.download(context.Background(), upstream.URL+"/private.png")
	require.Error(t, err)
	require.ErrorContains(t, err, "blocked by SSRF policy")
}

func TestImageResultUploaderRewritesImageDataURLWithoutHTTP(t *testing.T) {
	httpCalls := 0
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		httpCalls++
		return nil, errors.New("HTTP must not be called for data URLs")
	})}
	storage := &fakeImageStorage{}
	uploader := NewImageResultUploader(storage, "images/", 0, client)
	b64 := base64.StdEncoding.EncodeToString(pngBytes)
	result := json.RawMessage(`{"data":[{"url":"DATA:image/jpeg;name=photo.jpg;BaSe64,` + b64 + `","revised_prompt":"kept"}]}`)

	out, err := uploader.Rewrite(context.Background(), 42, "imgtask_data", result)
	require.NoError(t, err)
	require.Zero(t, httpCalls)
	require.Len(t, storage.saved, 1)
	require.Equal(t, pngBytes, storage.saved[0].data)
	require.Equal(t, "image/png", storage.saved[0].contentType, "detected bytes take precedence over a conflicting declaration")
	require.Equal(t, "images/users/42/imgtask_data-0.png", storage.saved[0].key)

	var parsed struct {
		Data []map[string]json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(out, &parsed))
	require.JSONEq(t, `"https://cdn.test/images/users/42/imgtask_data-0.png"`, string(parsed.Data[0]["url"]))
	require.JSONEq(t, `"kept"`, string(parsed.Data[0]["revised_prompt"]))
}

func TestImageResultUploaderDataURLValidation(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr string
	}{
		{name: "missing comma", url: "data:image/png;base64", wantErr: "missing comma"},
		{name: "non image", url: "data:text/plain;base64,aGVsbG8=", wantErr: "is not an image"},
		{name: "non base64", url: "data:image/png,raw", wantErr: "not base64"},
		{name: "invalid base64", url: "data:image/png;base64,%%%", wantErr: "base64 payload"},
		{name: "invalid media type", url: "data:image/png;bad parameter;base64,aGVsbG8=", wantErr: "invalid media type"},
		{name: "parameter after base64", url: "data:image/png;base64;name=photo.png,aGVsbG8=", wantErr: "base64 marker must be the final header token"},
		{name: "duplicate base64 marker", url: "data:image/png;base64;base64,aGVsbG8=", wantErr: "duplicate base64 marker"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			httpCalls := 0
			client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				httpCalls++
				return nil, errors.New("HTTP must not be called for data URLs")
			})}
			uploader := NewImageResultUploader(&fakeImageStorage{}, "images/", 0, client)
			result, err := json.Marshal(map[string]any{"data": []map[string]string{{"url": tt.url}}})
			require.NoError(t, err)

			_, err = uploader.Rewrite(context.Background(), 42, "imgtask_bad", result)
			require.ErrorContains(t, err, tt.wantErr)
			require.Zero(t, httpCalls)
		})
	}
}

func TestImageResultUploaderRejectsOversizedImageDataURL(t *testing.T) {
	storage := &fakeImageStorage{}
	uploader := NewImageResultUploader(storage, "images/", 3, nil)
	payload := base64.StdEncoding.EncodeToString([]byte("four"))
	result := json.RawMessage(`{"data":[{"url":"data:image/png;base64,` + payload + `"}]}`)

	_, err := uploader.Rewrite(context.Background(), 42, "imgtask_large", result)
	require.ErrorContains(t, err, "decoded image data URL exceeds 3 bytes")
	require.Empty(t, storage.saved)
}

func TestImageResultUploaderB64JSONTakesPrecedenceOverDataURL(t *testing.T) {
	storage := &fakeImageStorage{}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	b64 := base64.StdEncoding.EncodeToString(pngBytes)
	result := json.RawMessage(`{"data":[{"b64_json":"` + b64 + `","url":"data:text/plain,not-an-image"}]}`)

	_, err := uploader.Rewrite(context.Background(), 42, "imgtask_precedence", result)
	require.NoError(t, err)
	require.Len(t, storage.saved, 1)
	require.Equal(t, pngBytes, storage.saved[0].data)
}

func TestImageResultUploaderPropagatesStorageError(t *testing.T) {
	storage := &fakeImageStorage{err: errors.New("bucket unreachable")}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)

	b64 := base64.StdEncoding.EncodeToString(pngBytes)
	result := json.RawMessage(`{"data":[{"b64_json":"` + b64 + `"}]}`)

	_, err := uploader.Rewrite(context.Background(), 42, "imgtask_err", result)
	require.Error(t, err)
	require.Contains(t, err.Error(), "bucket unreachable")
}

func TestImageResultUploaderNilStoragePassthrough(t *testing.T) {
	var uploader *ImageResultUploader
	result := json.RawMessage(`{"data":[{"url":"https://example.test/x.png"}]}`)
	out, err := uploader.Rewrite(context.Background(), 42, "imgtask_nil", result)
	require.NoError(t, err)
	require.JSONEq(t, string(result), string(out))
}

func TestImageTaskServiceCompleteOffloadsToStorage(t *testing.T) {
	store := &imageTaskMemoryStore{}
	storage := &fakeImageStorage{}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	svc := NewImageTaskServiceWithUploader(store, uploader, time.Hour, time.Minute)
	require.True(t, svc.Enabled())

	owner := ImageTaskOwner{UserID: 1, APIKeyID: 2}
	created, err := svc.Create(context.Background(), owner)
	require.NoError(t, err)

	b64 := base64.StdEncoding.EncodeToString(pngBytes)
	result := json.RawMessage(`{"created":1,"data":[{"b64_json":"` + b64 + `"}]}`)
	require.NoError(t, svc.Complete(context.Background(), created.ID, http.StatusOK, result))

	got, err := svc.Get(context.Background(), owner, created.ID)
	require.NoError(t, err)
	require.Equal(t, ImageTaskStatusCompleted, got.Status)
	require.Equal(t, "https://cdn.test/images/users/1/"+created.ID+"-0.png", got.ImageURL)
	require.NotContains(t, string(got.Result), "b64_json", "large base64 must not be persisted to Redis")
	require.Len(t, storage.saved, 1)
}

func TestImageTaskServiceFinalizesPreviewWithoutReRunningUpstream(t *testing.T) {
	store := &imageTaskMemoryStore{}
	storage := &fakeImageStorage{}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	svc := NewImageTaskServiceWithUploader(store, uploader, time.Hour, time.Minute)
	result := json.RawMessage(`{"data":[{"url":"data:image/png;base64,` +
		base64.StdEncoding.EncodeToString(pngBytes) + `","mime_type":"image/png"}]}`)
	require.NoError(t, store.Save(context.Background(), &ImageTaskRecord{
		ID:         "imgtask_preview_recovery",
		UserID:     1,
		APIKeyID:   2,
		Status:     ImageTaskStatusPreviewReady,
		HTTPStatus: http.StatusOK,
		Result:     result,
	}, time.Hour))

	finalized, err := svc.FinalizePreview(context.Background(), "imgtask_preview_recovery")
	require.NoError(t, err)
	require.True(t, finalized)

	got, err := store.Get(context.Background(), "imgtask_preview_recovery")
	require.NoError(t, err)
	require.Equal(t, ImageTaskStatusCompleted, got.Status)
	require.Contains(t, string(got.Result), `"object_key"`)
	require.Contains(t, string(got.Result), `"preview_fallback":true`)
	require.Len(t, storage.saved, 1)
}

func TestImageTaskServiceCompletesWithLocalOriginalBeforeRemoteUpload(t *testing.T) {
	store := &imageTaskMemoryStore{}
	remote := &fakeImageStorage{}
	local := NewLocalImageAssetStore(t.TempDir())
	uploader := NewImageResultUploader(remote, "images/", 0, nil)
	uploader.SetLocalAssets(local)
	svc := NewImageTaskServiceWithUploader(store, uploader, time.Hour, time.Minute)

	owner := ImageTaskOwner{UserID: 1, APIKeyID: 2}
	created, err := svc.Create(context.Background(), owner)
	require.NoError(t, err)
	validPNG, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	result := json.RawMessage(`{"data":[{"b64_json":"` +
		base64.StdEncoding.EncodeToString(validPNG) + `","mime_type":"image/png"}]}`)

	require.NoError(t, svc.Complete(context.Background(), created.ID, http.StatusOK, result))
	require.Empty(t, remote.saved, "the generated task must not wait for the R2 upload")

	got, err := svc.Get(context.Background(), owner, created.ID)
	require.NoError(t, err)
	require.Equal(t, ImageTaskStatusReady, got.Status)
	require.Contains(t, got.ImageURL, LocalImageAssetURLPrefix)
	require.Contains(t, string(got.Result), `"original_ready":true`)
	require.NotContains(t, string(got.Result), "preview_data_url")
	require.NotContains(t, string(got.Result), "b64_json")
	require.NotContains(t, string(got.Result), `"local_asset_id"`)
}

func TestImageTaskServiceExposesLocalOriginalURLWhileRemoteUploadPending(t *testing.T) {
	store := &imageTaskMemoryStore{}
	remote := &fakeImageStorage{}
	local := NewLocalImageAssetStore(t.TempDir())
	uploader := NewImageResultUploader(remote, "images/", 0, nil)
	uploader.SetLocalAssets(local)
	svc := NewImageTaskServiceWithUploader(store, uploader, time.Hour, time.Minute)

	owner := ImageTaskOwner{UserID: 1, APIKeyID: 2}
	created, err := svc.Create(context.Background(), owner)
	require.NoError(t, err)
	validPNG, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	require.NoError(t, err)
	result := json.RawMessage(`{"data":[{"b64_json":"` +
		base64.StdEncoding.EncodeToString(validPNG) + `","mime_type":"image/png"}]}`)
	require.NoError(t, svc.Complete(context.Background(), created.ID, http.StatusOK, result))

	pending, err := svc.Get(context.Background(), owner, created.ID)
	require.NoError(t, err)
	require.Equal(t, ImageTaskStatusReady, pending.Status)
	var pendingResult struct {
		Data []map[string]json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(pending.Result, &pendingResult))
	require.Len(t, pendingResult.Data, 1)
	require.Contains(t, string(pendingResult.Data[0]["url"]), LocalImageAssetURLPrefix)
	require.Contains(t, string(pendingResult.Data[0]["display_url"]), LocalImageAssetURLPrefix)
	_, hasLocalAssetID := pendingResult.Data[0]["local_asset_id"]
	require.False(t, hasLocalAssetID, "local asset identifiers must not be exposed")
	require.JSONEq(t, `"pending"`, string(pendingResult.Data[0]["upload_status"]))
	require.JSONEq(t, `true`, string(pendingResult.Data[0]["original_ready"]))
	_, hasPreviewDataURL := pendingResult.Data[0]["preview_data_url"]
	require.False(t, hasPreviewDataURL)
	require.Contains(t, pending.ImageURL, LocalImageAssetURLPrefix)

	pendingAssets, err := local.ListPending(10)
	require.NoError(t, err)
	require.Len(t, pendingAssets, 1)
	assetID := pendingAssets[0].ID
	meta, original, err := svc.OpenLocalAssetContent(context.Background(), owner, created.ID, 0)
	require.NoError(t, err)
	require.Equal(t, assetID, meta.ID)
	data, err := io.ReadAll(original)
	require.NoError(t, err)
	require.NoError(t, original.Close())
	require.Equal(t, validPNG, data)

	_, _, err = svc.OpenLocalAssetContent(context.Background(), ImageTaskOwner{UserID: 999, APIKeyID: 2}, created.ID, 0)
	require.ErrorIs(t, err, ErrImageTaskNotFound)

	remoteURL := "https://cdn.test/images/users/1/" + created.ID + "-0.png"
	require.NoError(t, local.MarkUploaded(assetID, remoteURL))
	resolvedRemoteURL, err := svc.OriginalRemoteURL(context.Background(), owner, created.ID, 0)
	require.NoError(t, err)
	require.Equal(t, remoteURL, resolvedRemoteURL)
	require.NoError(t, os.Remove(local.assetPath(meta)))
	_, _, err = svc.OpenLocalAssetContent(context.Background(), owner, created.ID, 0)
	require.ErrorIs(t, err, ErrImageTaskContentNotFound)

	uploaded, err := svc.Get(context.Background(), owner, created.ID)
	require.NoError(t, err)
	require.Equal(t, ImageTaskStatusCompleted, uploaded.Status)
	var uploadedResult struct {
		Data []map[string]json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(uploaded.Result, &uploadedResult))
	require.Len(t, uploadedResult.Data, 1)
	require.JSONEq(t, strconv.Quote(remoteURL), string(uploadedResult.Data[0]["url"]))
	require.JSONEq(t, `"uploaded"`, string(uploadedResult.Data[0]["upload_status"]))
	require.Equal(t, remoteURL, uploaded.ImageURL)
}

func TestImageTaskServiceCompleteOffloadFailureMarksFailed(t *testing.T) {
	store := &imageTaskMemoryStore{}
	storage := &fakeImageStorage{err: errors.New("bucket unreachable")}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	svc := NewImageTaskServiceWithUploader(store, uploader, time.Hour, time.Minute)

	owner := ImageTaskOwner{UserID: 1, APIKeyID: 2}
	created, err := svc.Create(context.Background(), owner)
	require.NoError(t, err)

	b64 := base64.StdEncoding.EncodeToString(pngBytes)
	result := json.RawMessage(`{"data":[{"b64_json":"` + b64 + `"}]}`)
	require.NoError(t, svc.Complete(context.Background(), created.ID, http.StatusOK, result))

	got, err := svc.Get(context.Background(), owner, created.ID)
	require.NoError(t, err)
	require.Equal(t, ImageTaskStatusFailed, got.Status)
	require.Equal(t, http.StatusBadGateway, got.HTTPStatus)
	require.Contains(t, string(got.Error), "object storage")
	require.NotContains(t, string(got.Result), "b64_json", "failed offload must not persist base64 to Redis")
}

func TestImageStorageSettingServiceUploadLocalAssetMarksRemoteReady(t *testing.T) {
	local := NewLocalImageAssetStore(t.TempDir())
	meta, err := local.Save(
		context.Background(),
		42,
		"imgtask_queue",
		"images/users/42/imgtask_queue-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		pngBytes,
	)
	require.NoError(t, err)
	storage := &fakeImageStorage{url: "https://cdn.test/images/users/42/imgtask_queue-0.png"}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	svc := &ImageStorageSettingService{localAssets: local}

	svc.uploadLocalAsset(context.Background(), meta, uploader)

	require.Len(t, storage.saved, 1)
	require.Equal(t, "images/users/42/imgtask_queue-0.png", storage.saved[0].key)
	got, err := local.Get(meta.ID)
	require.NoError(t, err)
	require.True(t, got.Uploaded)
	require.Equal(t, storage.url, got.RemoteURL)
	_, data, err := local.Read(meta.ID)
	require.NoError(t, err)
	require.Equal(t, pngBytes, data)
}

func TestImageStorageSettingServiceRetriesLocalAssetAfterRemoteFailure(t *testing.T) {
	local := NewLocalImageAssetStore(t.TempDir())
	meta, err := local.Save(
		context.Background(),
		42,
		"imgtask_retry",
		"images/users/42/imgtask_retry-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		pngBytes,
	)
	require.NoError(t, err)
	storage := &fakeImageStorage{err: errors.New("temporary R2 outage")}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	svc := &ImageStorageSettingService{localAssets: local}

	svc.uploadLocalAsset(context.Background(), meta, uploader)
	pending, err := local.Get(meta.ID)
	require.NoError(t, err)
	require.False(t, pending.Uploaded)
	_, _, err = local.Read(meta.ID)
	require.NoError(t, err, "the local original must remain readable while R2 is unavailable")

	storage.err = nil
	storage.url = "https://cdn.test/images/users/42/imgtask_retry-0.png"
	svc.uploadLocalAsset(context.Background(), pending, uploader)
	uploaded, err := local.Get(meta.ID)
	require.NoError(t, err)
	require.True(t, uploaded.Uploaded)
	require.Equal(t, storage.url, uploaded.RemoteURL)
}

func TestImageStorageSettingServicePausesLocalAssetRetriesAfterAuthFailure(t *testing.T) {
	local := NewLocalImageAssetStore(t.TempDir())
	meta, err := local.Save(
		context.Background(),
		42,
		"imgtask_auth_failed",
		"images/users/42/imgtask_auth_failed-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		pngBytes,
	)
	require.NoError(t, err)
	storage := &fakeImageStorage{err: errors.New("S3 PutObject: https response error StatusCode: 401, api error Unauthorized")}
	uploader := NewImageResultUploader(storage, "images/", 0, nil)
	svc := &ImageStorageSettingService{localAssets: local}

	require.Error(t, svc.uploadLocalAsset(context.Background(), meta, uploader))
	ready, wait := svc.localAssetRetryReady(meta.ID, time.Now())
	require.False(t, ready)
	require.GreaterOrEqual(t, wait, localAssetAuthFailurePause-time.Second)

	storage.err = nil
	storage.url = "https://cdn.test/images/users/42/imgtask_auth_failed-0.png"
	svc.Invalidate()
	ready, wait = svc.localAssetRetryReady(meta.ID, time.Now())
	require.True(t, ready, "saving new storage settings must release the retry pause")
	require.Zero(t, wait)
}

func TestImageStorageSettingServiceLocalAssetRetryBackoff(t *testing.T) {
	svc := &ImageStorageSettingService{}
	now := time.Now()

	first := svc.recordLocalAssetFailure("asset-1", errors.New("temporary network failure"), now)
	second := svc.recordLocalAssetFailure("asset-1", errors.New("temporary network failure"), now.Add(first))
	require.Greater(t, second, first, "retry delay must grow after repeated failures")

	svc.recordLocalAssetSuccess("asset-1")
	ready, wait := svc.localAssetRetryReady("asset-1", now)
	require.True(t, ready)
	require.Zero(t, wait)
}
