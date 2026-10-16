#!/bin/bash
set -e

source "$(dirname "$0")/env.sh"

echo "Cleaning database for instance ${INSTANCE} (${TYPEORM_DATABASE} on localhost:${TYPEORM_PORT})..."

npm run db:clean --workspace=apps/server
