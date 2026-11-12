package handler

import (
	"bytes"
	"encoding/json"
	"strings"
	"sync"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

type imageTaskSSEPreviewWriter struct {
	gin.ResponseWriter
	publish func(json.RawMessage) error

	mu        sync.Mutex
	pending   []byte
	published bool
}

func newImageTaskSSEPreviewWriter(
	writer gin.ResponseWriter,
	publish func(json.RawMessage) error,
) *imageTaskSSEPreviewWriter {
	return &imageTaskSSEPreviewWriter{
		ResponseWriter: writer,
		publish:        publish,
	}
}

func (w *imageTaskSSEPreviewWriter) Write(data []byte) (int, error) {
	n, err := w.ResponseWriter.Write(data)
	if n > 0 {
		w.observe(data[:n])
	}
	return n, err
}

func (w *imageTaskSSEPreviewWriter) WriteString(value string) (int, error) {
	n, err := w.ResponseWriter.WriteString(value)
	if n > 0 {
		w.observe([]byte(value[:n]))
	}
	return n, err
}

func (w *imageTaskSSEPreviewWriter) observe(data []byte) {
	var preview json.RawMessage
	w.mu.Lock()
	w.pending = append(w.pending, data...)
	for !w.published {
		frame, consumed, ok := nextImageTaskSSEFrame(w.pending)
		if !ok {
			break
		}
		value, ok := imageTaskSSEFramePartialPreview(frame)
		w.pending = append(w.pending[:0], w.pending[consumed:]...)
		if ok {
			preview = append(json.RawMessage(nil), value...)
			w.published = true
		}
	}
	w.mu.Unlock()
	if len(preview) > 0 && w.publish != nil {
		_ = w.publish(preview)
	}
}

func nextImageTaskSSEFrame(data []byte) ([]byte, int, bool) {
	lf := bytes.Index(data, []byte("\n\n"))
	crlf := bytes.Index(data, []byte("\r\n\r\n"))
	switch {
	case lf < 0 && crlf < 0:
		return nil, 0, false
	case lf < 0:
		return data[:crlf], crlf + 4, true
	case crlf < 0:
		return data[:lf], lf + 2, true
	case crlf < lf:
		return data[:crlf], crlf + 4, true
	default:
		return data[:lf], lf + 2, true
	}
}

func imageTaskSSEFramePartialPreview(frame []byte) (json.RawMessage, bool) {
	lines := strings.Split(strings.ReplaceAll(string(frame), "\r\n", "\n"), "\n")
	eventType := ""
	dataLines := make([]string, 0, 1)
	for _, line := range lines {
		switch {
		case strings.HasPrefix(line, "event:"):
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			value := strings.TrimPrefix(line, "data:")
			value = strings.TrimPrefix(value, " ")
			dataLines = append(dataLines, value)
		}
	}
	if len(dataLines) == 0 {
		return nil, false
	}
	return service.OpenAIImagesTaskPartialPreview(eventType, []byte(strings.Join(dataLines, "\n")))
}
