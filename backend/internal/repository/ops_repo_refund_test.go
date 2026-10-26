//go:build unit

package repository

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestMarkErrorRefundedUsesAmountParameterForRefundAmount(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	repo := &opsRepository{db: db}

	mock.ExpectExec(`(?s)UPDATE ops_error_logs\s+SET refund_status = 'refunded',\s+refund_amount = \$4,.*request_id = \$1.*client_request_id = \$3`).
		WithArgs("req-1", int64(9), "client-1", 0.12).
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, repo.MarkErrorRefunded(
		context.Background(),
		"req-1",
		"client-1",
		9,
		0.12,
	))
	require.NoError(t, mock.ExpectationsWereMet())
}
