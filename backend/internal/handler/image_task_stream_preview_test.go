package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func imageTaskPreviewTestBase64(t *testing.T) string {
	t.Helper()
	source := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < source.Bounds().Dy(); y++ {
		for x := 0; x < source.Bounds().Dx(); x++ {
			source.Set(x, y, color.RGBA{R: 240, G: 120, B: 40, A: 255})
		}
	}
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, source))
	return base64.StdEncoding.EncodeToString(encoded.Bytes())
}

func TestImageTaskSSEPreviewWriterPublishesFirstPartialAcrossChunks(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rawBase64 := imageTaskPreviewTestBase64(t)
	stream := "" +
		"event: image_generation.partial_image\r\n" +
		"data: {\"type\":\"image_generation.partial_image\",\"b64_json\":\"" + rawBase64 + "\"}\r\n\r\n" +
		"event: image_generation.partial_image\n" +
		"data: {\"type\":\"image_generation.partial_image\",\"url\":\"https://cdn.example.com/partial-2.png\"}\n\n" +
		"event: image_generation.completed\n" +
		"data: {\"type\":\"image_generation.completed\",\"b64_json\":\"ZmluYWw=\"}\n\n" +
		"data: [DONE]\n\n"
	originalStream := stream
	firstFrame, _, found := nextImageTaskSSEFrame([]byte(originalStream))
	require.True(t, found)
	_, previewOK := imageTaskSSEFramePartialPreview(firstFrame)
	require.True(t, previewOK)
	oneShotRecorder := httptest.NewRecorder()
	oneShotBase, _ := gin.CreateTestContext(oneShotRecorder)
	oneShotPublished := 0
	oneShotWriter := newImageTaskSSEPreviewWriter(oneShotBase.Writer, func(json.RawMessage) error {
		oneShotPublished++
		return nil
	})
	_, err := io.WriteString(oneShotWriter, originalStream)
	require.NoError(t, err)
	require.Equal(t, 1, oneShotPublished)

	recorder := httptest.NewRecorder()
	base, _ := gin.CreateTestContext(recorder)
	var published []json.RawMessage
	writer := newImageTaskSSEPreviewWriter(base.Writer, func(preview json.RawMessage) error {
		published = append(published, append(json.RawMessage(nil), preview...))
		return nil
	})

	for _, size := range []int{1, 7, 19, 53, 127, len(stream)} {
		if size > len(stream) {
			size = len(stream)
		}
		n, err := io.WriteString(writer, stream[:size])
		require.NoError(t, err)
		require.Equal(t, size, n)
		stream = stream[size:]
	}
	require.Empty(t, stream)
	require.Equal(t, originalStream, recorder.Body.String())
	require.Len(t, published, 1)
	require.Contains(t, string(published[0]), `"preview_data_url":"data:image/jpeg;base64,`)
	require.NotContains(t, string(published[0]), rawBase64)
	require.Contains(t, recorder.Body.String(), "image_generation.completed")
	require.Contains(t, recorder.Body.String(), "[DONE]")
}

func TestAsyncImageHandlerPublishesPreviewBeforeUpstreamCompletes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &asyncImageMemoryStore{tasks: make(map[string]*service.ImageTaskRecord)}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	taskID := "imgtask_preview"
	require.NoError(t, store.Save(context.Background(), &service.ImageTaskRecord{
		ID:        taskID,
		UserID:    7,
		APIKeyID:  9,
		Status:    service.ImageTaskStatusProcessing,
		CreatedAt: time.Now().UTC().Unix(),
		ExpiresAt: time.Now().UTC().Add(time.Hour).Unix(),
	}, time.Hour))

	rawBase64 := imageTaskPreviewTestBase64(t)
	release := make(chan struct{})
	h := &AsyncImageHandler{tasks: tasks}
	h.execute = func(_ string, c *gin.Context) {
		_, _ = c.Writer.WriteString("event: image_generation.partial_image\n")
		_, _ = c.Writer.WriteString(`data: {"type":"image_generation.partial_image","b64_json":"` + rawBase64 + `"}` + "\n\n")
		c.Writer.Flush()
		<-release
		_, _ = c.Writer.WriteString("event: image_generation.completed\n")
		_, _ = c.Writer.WriteString("data: {\"type\":\"image_generation.completed\",\"b64_json\":\"ZmluYWw=\"}\n\n")
	}

	recorder := httptest.NewRecorder()
	taskCtx, _ := gin.CreateTestContext(recorder)
	taskCtx.Request = httptest.NewRequest("POST", "/v1/images/generations", nil)
	go h.run(taskID, service.PlatformOpenAI, taskCtx, recorder, func() {})

	require.Eventually(t, func() bool {
		record, err := tasks.GetRecord(context.Background(), taskID)
		return err == nil && record.Status == service.ImageTaskStatusPreviewReady &&
			bytes.Contains(record.Result, []byte("preview_data_url"))
	}, time.Second, 10*time.Millisecond)

	close(release)
	require.Eventually(t, func() bool {
		record, err := tasks.GetRecord(context.Background(), taskID)
		return err == nil && record.Status == service.ImageTaskStatusCompleted &&
			bytes.Contains(record.Result, []byte("ZmluYWw="))
	}, time.Second, 10*time.Millisecond)
}
