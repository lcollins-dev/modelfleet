#!/bin/bash
set -e

source "$(dirname "$0")/env.sh"

COMPOSE_FILE="$(dirname "$0")/db/docker-compose.yml"

echo "Stopping database for instance ${INSTANCE}..."

INSTANCE=$INSTANCE DB_PORT=$DB_PORT docker compose \
  -f "$COMPOSE_FILE" \
  -p "modelfleet-${INSTANCE}-db" \
  down

echo "Done."
