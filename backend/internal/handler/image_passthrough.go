package handler

import (
	"net/http"
	"strings"
)

const localImagePassthroughHeader = "X-Create-Image-Passthrough"
const localImagePassthroughValue = "local"

// A desktop client opts out of server-side image persistence. The gateway still
// performs authentication, routing, billing, and upstream failover, but returns
// image bytes directly and leaves storage/preview work to the local client.
func isLocalImagePassthroughRequest(request *http.Request) bool {
	if request == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(request.Header.Get(localImagePassthroughHeader)), localImagePassthroughValue)
}
