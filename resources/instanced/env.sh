#!/bin/bash
# Reads this worktree's fixed instance number (see instance.sh) and exports all derived port and
# database variables for use by start/db scripts.

INSTANCED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INSTANCE=$(bash "$INSTANCED_DIR/instance.sh")

if [[ -z "$INSTANCE" ]]; then
  echo "error: could not determine instance number" >&2
  exit 1
fi

WORKTREE_DIR=$(git rev-parse --show-toplevel)

WORKDIR="$WORKTREE_DIR/.workdir"
LOG_DIR="$WORKDIR/logs"
MODEL_DIR="$WORKDIR/models"

export INSTANCE
export WORKTREE_DIR
export WORKDIR
export LOG_DIR
export MODEL_DIR

export TZ=UTC

export SERVER_PORT=$((3000 + INSTANCE * 100))
export GATEWAY_PORT=$((3030 + INSTANCE * 100))
export WEB_PORT=$((8080 + INSTANCE * 100))
export RELAY_PORT=$((3040 + INSTANCE * 100))

# Per-instance node key, so agents sharing a Docker daemon each own their own containers.
export DEV_NODE_KEY=$(printf 'dc9f2a26-2f30-4a1e-9f2c-%012x' "$INSTANCE")

export DB_PORT=$((15400 + INSTANCE))
export TYPEORM_HOST=localhost
export TYPEORM_PORT=$DB_PORT
export TYPEORM_DATABASE=modelfleet
export TYPEORM_USERNAME=modelfleet
export TYPEORM_PASSWORD=modelfleet

export USE_TEST_MIGRATIONS=true

# The e2e suite signs in from parallel workers, which the production rate limit would refuse.
export RATE_LIMIT_MAX_REQUESTS=100000
