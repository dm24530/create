package migrations

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGroupImageCostPricingMigration(t *testing.T) {
	content, err := FS.ReadFile("270_group_image_cost_pricing.sql")
	require.NoError(t, err)

	sql := strings.Join(strings.Fields(string(content)), " ")
	for _, column := range []string{
		"image_cost_price_1k",
		"image_cost_price_2k",
		"image_cost_price_4k",
	} {
		require.Contains(t, sql,
			"ADD COLUMN IF NOT EXISTS "+column+" DECIMAL(20,8)")
		require.Contains(t, sql, "COMMENT ON COLUMN groups."+column)
	}
}
