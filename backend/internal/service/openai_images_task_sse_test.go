package service

import (
	"encoding/json"
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
