#!/bin/sh
set -eu

if [ ! -d /app/data/JECJordanData ] || [ -z "$(find /app/data/JECJordanData -name '*.csv' -print -quit 2>/dev/null)" ]; then
  echo "Seeding /app/data from bundled seed data"
  mkdir -p /app/data
  cp -a /app/seed-data/. /app/data/
fi

exec gunicorn \
  --chdir backend \
  --bind "0.0.0.0:${PORT:-5000}" \
  --workers "${WEB_CONCURRENCY:-1}" \
  --threads "${GUNICORN_THREADS:-4}" \
  --timeout "${GUNICORN_TIMEOUT:-120}" \
  app:app
