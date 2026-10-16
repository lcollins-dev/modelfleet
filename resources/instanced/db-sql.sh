#!/bin/bash
set -e

source "$(dirname "$0")/env.sh"

CONTAINER="modelfleet-${INSTANCE}-db"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "error: database container ${CONTAINER} is not running" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "Opening psql shell for instance ${INSTANCE} (${TYPEORM_DATABASE} on localhost:${TYPEORM_PORT})..."
  exec docker exec -it "$CONTAINER" psql -U "$TYPEORM_USERNAME" -d "$TYPEORM_DATABASE"
else
  exec docker exec -i "$CONTAINER" psql -U "$TYPEORM_USERNAME" -d "$TYPEORM_DATABASE" "$@"
fi
