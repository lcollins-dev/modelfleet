#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE "modelfleet" WITH ENCODING 'UTF8';

  CREATE USER "modelfleet" WITH ENCRYPTED PASSWORD 'modelfleet';

  GRANT CONNECT ON DATABASE "modelfleet" TO "modelfleet";
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "modelfleet" <<-EOSQL
  GRANT ALL ON SCHEMA public TO "modelfleet";
EOSQL
