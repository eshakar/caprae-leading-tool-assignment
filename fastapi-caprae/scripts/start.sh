#!/bin/sh
# Container entrypoint: migrate -> seed (once) -> serve.
set -e
alembic upgrade head
python -m app.db.seed
# Workers skip seeding; it already ran above, exactly once.
export SEED_SAMPLE_DATA=false
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-2}" \
  --proxy-headers \
  --forwarded-allow-ips "*"
