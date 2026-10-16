#!/bin/bash
set -e

source "$(dirname "$0")/env.sh"

COMPOSE_FILE="$(dirname "$0")/db/docker-compose.yml"

echo "Starting database for instance ${INSTANCE} on port ${DB_PORT}..."

INSTANCE=$INSTANCE DB_PORT=$DB_PORT docker compose \
  -f "$COMPOSE_FILE" \
  -p "modelfleet-${INSTANCE}-db" \
  up -d

echo "Waiting for Postgres to be ready..."
MAX_WAIT=60
ELAPSED=0
# Over TCP, so the socket-only server init-db.sh runs under on a fresh volume does not count.
until docker exec "modelfleet-${INSTANCE}-db" pg_isready -h localhost -U postgres > /dev/null 2>&1; do
  if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    echo "Timed out waiting for Postgres after ${MAX_WAIT}s" >&2
    exit 1
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

echo "Database ready on localhost:${DB_PORT}"
