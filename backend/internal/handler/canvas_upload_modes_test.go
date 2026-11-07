package handler

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCanvasAssetUploadSupportsAllMediaKinds(t *testing.T) {
	mp4 := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}
	wav := []byte("RIFF\x00\x00\x00\x00WAVE")
	tests := []struct {
		name        string
		kind        string
		contentType string
		data        []byte
	}{
		{name: "png", kind: "image", contentType: "image/png", data: canvasTestPNG},
		{name: "webp", kind: "image", contentType: "image/webp", data: []byte("RIFF\x00\x00\x00\x00WEBP")},
		{name: "mp4 video", kind: "video", contentType: "video/mp4", data: mp4},
		{name: "webm video", kind: "video", contentType: "video/webm", data: []byte{0x1a, 0x45, 0xdf, 0xa3}},
		{name: "mp3 audio", kind: "audio", contentType: "audio/mpeg", data: []byte("ID3audio")},
		{name: "wav audio", kind: "audio", contentType: "audio/wav", data: wav},
		{name: "ogg audio", kind: "audio", contentType: "audio/ogg", data: []byte("OggSaudio")},
		{name: "m4a audio", kind: "audio", contentType: "audio/mp4", data: mp4},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			kind, contentType, err := normalizeCanvasAssetInput(test.kind, test.contentType)
			require.NoError(t, err)
			require.Equal(t, test.kind, kind)
			require.Equal(t, test.contentType, contentType)
			require.True(t, validateCanvasObjectSignature(contentType, test.data))
		})
	}
}

func TestCanvasAssetUploadRejectsKindContentMismatch(t *testing.T) {
	tests := []struct {
		name        string
		kind        string
		contentType string
	}{
		{name: "video as image", kind: "image", contentType: "video/mp4"},
		{name: "audio as video", kind: "video", contentType: "audio/mpeg"},
		{name: "image as audio", kind: "audio", contentType: "image/png"},
		{name: "unsupported svg", kind: "image", contentType: "image/svg+xml"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, _, err := normalizeCanvasAssetInput(test.kind, test.contentType)
			require.Error(t, err)
		})
	}
}
