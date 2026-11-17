package webassets

import "embed"

//go:embed all:dist all:local
var FS embed.FS
