export TYPEORM_HOST=${TYPEORM_HOST:-localhost}
export TYPEORM_PORT=${TYPEORM_PORT:-5432}
export TYPEORM_USERNAME=${TYPEORM_USERNAME:-modelfleet}
export TYPEORM_PASSWORD=${TYPEORM_PASSWORD:-modelfleet}
export TYPEORM_DATABASE=${TYPEORM_DATABASE:-modelfleet}
export USE_TEST_MIGRATIONS=true

echo "Cleaning out database..."

psql postgres://$TYPEORM_USERNAME:$TYPEORM_PASSWORD@$TYPEORM_HOST:$TYPEORM_PORT/$TYPEORM_DATABASE --command="
DO \$\$ DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
    EXECUTE 'DROP TABLE ' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END \$\$;
"

echo "Running migrations..."

npm run build
npx typeorm migration:run -d dist/cli-data-source.js

echo "Done"