#!/bin/bash
set -e

# Runs the server integration suite against its own "modelfleet_int" database, recreated and
# migrated per run by the vitest global setup, in the same Postgres as the development
# database. The database has to already be running (`npm run instance:start`).
#
# CI can call vitest directly instead, exporting the same TYPEORM_* variables.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$(dirname "$SCRIPT_DIR")"
INSTANCED_DIR="$API_DIR/../../resources/instanced"

source "$INSTANCED_DIR/env.sh"

# env.sh points at the development database, and process.env wins over test.env.
export NODE_ENV=test
export TYPEORM_DATABASE=modelfleet_int

if ! (exec 3<>"/dev/tcp/${TYPEORM_HOST}/${TYPEORM_PORT}") 2>/dev/null; then
  echo "No Postgres reachable on ${TYPEORM_HOST}:${TYPEORM_PORT}." >&2
  echo "Start the instance first: npm run instance:start" >&2
  exit 1
fi

cd "$API_DIR"

echo ""
echo "Running server integration suite against ${TYPEORM_DATABASE} on ${TYPEORM_HOST}:${TYPEORM_PORT}"
echo ""

INTEGRATION_SERIAL=0 npx vitest run --config vitest.integration.config.ts

# Serial specs own their app, so they get a second process-isolated pass.
INTEGRATION_SERIAL=1 npx vitest run --config vitest.integration.config.ts --passWithNoTests
