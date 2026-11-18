#!/usr/bin/env bash
set -euo pipefail

repositoryRoot="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
postgresContainer=shop-pg
redisContainer=shop-redis
postgresPort=55432
redisPort=56379
export DATABASE_URL="postgres://app:fixturepw@127.0.0.1:${postgresPort}/shop"
export REDIS_URL="redis://127.0.0.1:${redisPort}"
export PORT=8080
export SEED_PROFILE=staging

apiLog="$(mktemp)"
workerLog="$(mktemp)"
apiPid=""
workerPid=""

cleanup() {
  [[ -n "$workerPid" ]] && kill "$workerPid" 2> /dev/null || true
  [[ -n "$apiPid" ]] && kill "$apiPid" 2> /dev/null || true
  docker rm -f "$postgresContainer" "$redisContainer" > /dev/null 2>&1 || true
  rm -f "$apiLog" "$workerLog"
}
trap cleanup EXIT

echo "== containers"
docker rm -f "$postgresContainer" "$redisContainer" > /dev/null 2>&1 || true
docker run -d --name "$postgresContainer" \
  -e POSTGRES_PASSWORD=fixturepw -e POSTGRES_USER=app -e POSTGRES_DB=shop \
  -p "${postgresPort}:5432" postgres:17-alpine > /dev/null
docker run -d --name "$redisContainer" -p "${redisPort}:6379" redis:7-alpine > /dev/null

for attempt in $(seq 1 60); do
  docker exec "$postgresContainer" pg_isready -U app -d shop > /dev/null 2>&1 && break
  sleep 1
done
docker exec "$postgresContainer" pg_isready -U app -d shop

echo "== npm ci"
for app in api worker cron; do
  (cd "${repositoryRoot}/apps/${app}" && npm ci --silent)
done

echo "== migrate and seed twice"
cd "${repositoryRoot}/apps/api"
node prisma/run-migrations.js
node prisma/seed/index.js
echo "-- second seed run (expected: only unchanged)"
node prisma/seed/index.js

echo "== api and worker"
node src/server.js > "$apiLog" 2>&1 &
apiPid=$!
cd "${repositoryRoot}/apps/worker"
node index.js > "$workerLog" 2>&1 &
workerPid=$!
for attempt in $(seq 1 60); do
  curl -sf "http://127.0.0.1:${PORT}/health" > /dev/null 2>&1 && break
  sleep 1
done

echo "== smoke"
cd "${repositoryRoot}"
bash scripts/smoke.sh "http://127.0.0.1:${PORT}"

echo "== cron once"
cd "${repositoryRoot}/apps/cron"
node index.js
docker exec "$postgresContainer" psql -U app -d shop -c "SELECT day, orders, revenue_cents FROM daily_sales ORDER BY day DESC LIMIT 3;"

echo "== FAIL_MIGRATION=4"
cd "${repositoryRoot}/apps/api"
set +e
FAIL_MIGRATION=4 node prisma/run-migrations.js
failMigrationExit=$?
set -e
echo "FAIL_MIGRATION=4 exit code: ${failMigrationExit}"
[[ "$failMigrationExit" -ne 0 ]] || { echo "FAIL FAIL_MIGRATION=4 exited 0" >&2; exit 1; }

echo "== health"
curl -s "http://127.0.0.1:${PORT}/health"
echo
echo "== api log"
tail -n 20 "$apiLog"
echo "== worker log"
tail -n 20 "$workerLog"
echo "OK local proof finished"
