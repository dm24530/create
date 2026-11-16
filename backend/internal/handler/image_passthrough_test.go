package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestIsLocalImagePassthroughRequest(t *testing.T) {
	request := httptest.NewRequest("POST", "/v1/images/generations", nil)
	require.False(t, isLocalImagePassthroughRequest(request))

	request.Header.Set(localImagePassthroughHeader, localImagePassthroughValue)
	require.True(t, isLocalImagePassthroughRequest(request))

	request.Header.Set(localImagePassthroughHeader, " LOCAL ")
	require.True(t, isLocalImagePassthroughRequest(request))

	request.Header.Set(localImagePassthroughHeader, "web")
	require.False(t, isLocalImagePassthroughRequest(request))
}
