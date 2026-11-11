package handler

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestPrepareAsyncImageTaskStreamBodyEnablesGPTImageSSE(t *testing.T) {
	body := []byte(`{"model":"gpt-image-2-5-sunburst","prompt":"fox","response_format":"url"}`)

	got := prepareAsyncImageTaskStreamBody("openai", "application/json", body)

	require.True(t, json.Valid(got))
	require.True(t, gjson.GetBytes(got, "stream").Bool())
	require.Equal(t, int64(1), gjson.GetBytes(got, "partial_images").Int())
	require.Equal(t, "url", gjson.GetBytes(got, "response_format").String())
}

func TestPrepareAsyncImageTaskStreamBodyLeavesOtherRequestsAlone(t *testing.T) {
	body := []byte(`{"model":"grok-imagine-image","prompt":"fox"}`)
	require.Equal(t, body, prepareAsyncImageTaskStreamBody("grok", "application/json", body))
	require.Equal(t, body, prepareAsyncImageTaskStreamBody(
		"openai",
		"multipart/form-data; boundary=abc",
		body,
	))
}
