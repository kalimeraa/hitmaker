#!/usr/bin/env bash
set -euo pipefail

APP_PORT="${PORT:-3000}"
MONGO_PORT="${MONGO_PORT:-27017}"
REDIS_PORT="${REDIS_PORT:-6379}"
MONGO_DBPATH="${MONGO_DBPATH:-/data/db}"
REDIS_DIR="${REDIS_DIR:-/data/redis}"

cleanup() {
  for pid in "${APP_PID:-}" "${WORKER_PID:-}" "${MONGO_PID:-}" "${REDIS_PID:-}"; do
    if [[ -n "$pid" ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local label="$3"

  for _ in $(seq 1 60); do
    if timeout 1 bash -c ":</dev/tcp/$host/$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "$label did not become ready on $host:$port" >&2
  return 1
}

trap cleanup EXIT INT TERM

mkdir -p "$MONGO_DBPATH" "$REDIS_DIR" /tmp/hitmaker

export PORT="$APP_PORT"
export MONGODB_URI="${MONGODB_URI:-mongodb://127.0.0.1:${MONGO_PORT}/hitmaker}"
export REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
export REDIS_PORT="$REDIS_PORT"
export HEADLESS_DEFAULT="${HEADLESS_DEFAULT:-true}"
export MAX_PARALLEL_BROWSERS="${MAX_PARALLEL_BROWSERS:-1}"
export CLOAKBROWSER_PERSISTENT_PROFILE="${CLOAKBROWSER_PERSISTENT_PROFILE:-false}"
export CLOAKBROWSER_AUTO_UPDATE="${CLOAKBROWSER_AUTO_UPDATE:-false}"

echo "Starting embedded Redis on 127.0.0.1:$REDIS_PORT"
redis-server \
  --bind 127.0.0.1 \
  --port "$REDIS_PORT" \
  --dir "$REDIS_DIR" \
  --appendonly yes \
  --protected-mode no &
REDIS_PID="$!"

echo "Starting embedded MongoDB on 127.0.0.1:$MONGO_PORT"
mongod \
  --bind_ip 127.0.0.1 \
  --port "$MONGO_PORT" \
  --dbpath "$MONGO_DBPATH" &
MONGO_PID="$!"

wait_for_port 127.0.0.1 "$REDIS_PORT" "Redis"
wait_for_port 127.0.0.1 "$MONGO_PORT" "MongoDB"

echo "Starting Hitmaker web on port $PORT"
npm start &
APP_PID="$!"

echo "Starting Hitmaker worker"
npm run worker &
WORKER_PID="$!"

wait -n "$APP_PID" "$WORKER_PID" "$MONGO_PID" "$REDIS_PID"
