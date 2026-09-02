#!/bin/sh
set -eu

if [ "${RUN_DB_MIGRATIONS:-true}" = "true" ]; then
  attempt=1
  max_attempts="${DB_MIGRATION_MAX_ATTEMPTS:-30}"

  echo "Applying database migrations..."
  until bun src/infrastructure/database/migrate.ts; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "Database migration failed after $attempt attempts." >&2
      exit 1
    fi

    echo "Database is not ready; retrying migration ($attempt/$max_attempts)..." >&2
    attempt=$((attempt + 1))
    sleep 2
  done
fi

exec "$@"
