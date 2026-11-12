package service

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestOpenAIImagesTaskResultFromSSEPrefersCompletedImage(t *testing.T) {
	body := []byte(`event: image_generation.partial_image
data: {"type":"image_generation.partial_image","b64_json":"cGFydGlhbA==","output_format":"png"}

event: image_generation.completed
data: {"type":"image_generation.completed","b64_json":"ZmluYWw=","created_at":123,"size":"1024x1024","output_format":"jpeg","usage":{"input_tokens":2,"output_tokens":3}}

data: [DONE]
`)

	got, err := OpenAIImagesTaskResultFromSSE(body)
	require.NoError(t, err)
	require.True(t, json.Valid(got))
	require.Equal(t, int64(123), gjson.GetBytes(got, "created").Int())
	require.Equal(t, "ZmluYWw=", gjson.GetBytes(got, "data.0.b64_json").String())
	require.Equal(t, "image/jpeg", gjson.GetBytes(got, "data.0.mime_type").String())
	require.Equal(t, int64(1024), gjson.GetBytes(got, "data.0.width").Int())
	require.Equal(t, int64(1024), gjson.GetBytes(got, "data.0.height").Int())
	require.Equal(t, int64(3), gjson.GetBytes(got, "usage.output_tokens").Int())
}

func TestOpenAIImagesTaskResultFromSSEPrefersURL(t *testing.T) {
	body := []byte(`data: {"type":"image_generation.completed","url":"https://cdn.example.com/image.png","b64_json":"ZmluYWw=","created_at":456,"output_format":"png"}

`)

	got, err := OpenAIImagesTaskResultFromSSE(body)
	require.NoError(t, err)
	require.Equal(t, "https://cdn.example.com/image.png", gjson.GetBytes(got, "data.0.url").String())
	require.False(t, gjson.GetBytes(got, "data.0.b64_json").Exists())
}

func TestOpenAIImagesTaskResultFromSSERejectsEmptyStream(t *testing.T) {
	_, err := OpenAIImagesTaskResultFromSSE([]byte("event: message\ndata: {}\n\n"))
	require.ErrorIs(t, err, ErrOpenAIImagesTaskStreamEmpty)
}

func TestOpenAIImagesTaskPartialPreviewBuildsDataURL(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 16, 9))
	for y := 0; y < source.Bounds().Dy(); y++ {
		for x := 0; x < source.Bounds().Dx(); x++ {
			source.Set(x, y, color.RGBA{R: 32, G: 144, B: 224, A: 255})
		}
	}
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, source))
	rawBase64 := base64.StdEncoding.EncodeToString(encoded.Bytes())

	payload, ok := OpenAIImagesTaskPartialPreview(
		"image_generation.partial_image",
		[]byte(`{"type":"image_generation.partial_image","b64_json":"`+rawBase64+`","output_format":"png","created_at":789}`),
	)
	require.True(t, ok)
	require.True(t, json.Valid(payload))
	require.Equal(t, int64(789), gjson.GetBytes(payload, "created").Int())
	require.Equal(t, "image/jpeg", gjson.GetBytes(payload, "data.0.mime_type").String())
	require.Equal(t, int64(16), gjson.GetBytes(payload, "data.0.width").Int())
	require.Equal(t, int64(9), gjson.GetBytes(payload, "data.0.height").Int())
	require.Contains(t, gjson.GetBytes(payload, "data.0.preview_data_url").String(), "data:image/jpeg;base64,")
	require.NotContains(t, string(payload), rawBase64)
	require.False(t, gjson.GetBytes(payload, "data.0.b64_json").Exists())
}

func TestOpenAIImagesTaskPartialPreviewAcceptsURLAndResponsesEvent(t *testing.T) {
	payload, ok := OpenAIImagesTaskPartialPreview(
		"response.image_generation_call.partial_image",
		[]byte(`{"type":"response.image_generation_call.partial_image","url":"https://cdn.example.com/partial.png","width":1024,"height":768}`),
	)
	require.True(t, ok)
	require.Equal(t, "https://cdn.example.com/partial.png", gjson.GetBytes(payload, "data.0.preview_url").String())
	require.Equal(t, int64(1024), gjson.GetBytes(payload, "data.0.width").Int())
	require.Equal(t, int64(768), gjson.GetBytes(payload, "data.0.height").Int())
}

func TestOpenAIImagesTaskPartialPreviewIgnoresCompletedEvent(t *testing.T) {
	_, ok := OpenAIImagesTaskPartialPreview(
		"image_generation.completed",
		[]byte(`{"type":"image_generation.completed","b64_json":"ZmluYWw="}`),
	)
	require.False(t, ok)
}
