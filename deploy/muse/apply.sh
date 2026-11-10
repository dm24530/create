#!/usr/bin/env sh
set -eu

CONTAINER="${CONTAINER:-create-postgres}"
DATABASE="${DATABASE:-create}"
DB_USER="${DB_USER:-create}"
MUSE_BASE_URL="${MUSE_BASE_URL:-https://momoapi.xin/v1}"

if [ -z "${MUSE_API_KEY:-}" ]; then
    printf "Muse API key: "
    stty -echo
    IFS= read -r MUSE_API_KEY
    stty echo
    printf "\n"
fi

if [ -z "${MUSE_API_KEY:-}" ]; then
    echo "MUSE_API_KEY is required" >&2
    exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONTAINER_SEED_PATH="/tmp/create-muse-seed.sql"

docker cp "$SCRIPT_DIR/seed.sql" "$CONTAINER:$CONTAINER_SEED_PATH"
trap 'docker exec "$CONTAINER" rm -f "$CONTAINER_SEED_PATH" >/dev/null 2>&1 || true' EXIT

docker exec "$CONTAINER" psql \
    -U "$DB_USER" \
    -d "$DATABASE" \
    -v ON_ERROR_STOP=1 \
    -v "muse_api_key=$MUSE_API_KEY" \
    -v "muse_base_url=$MUSE_BASE_URL" \
    -f "$CONTAINER_SEED_PATH"
