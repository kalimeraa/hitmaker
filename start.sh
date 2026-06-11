#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

APP_PORT="${PORT:-3100}"
MONGO_URI="${MONGODB_URI:-mongodb://localhost:27017/hitmaker}"
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"
MONGO_HOST="${MONGO_HOST:-localhost}"
MONGO_PORT="${MONGO_PORT:-27017}"

port_open() {
  local host="$1"
  local port="$2"

  nc -z "$host" "$port" >/dev/null 2>&1
}

start_brew_service() {
  local label="$1"
  shift

  if ! command -v brew >/dev/null 2>&1; then
    echo "brew yok; $label otomatik başlatılamadı."
    return 1
  fi

  for service in "$@"; do
    if brew services list 2>/dev/null | awk '{print $1}' | grep -qx "$service"; then
      echo "$label kapalı görünüyor, brew services start $service çalıştırılıyor..."
      brew services start "$service" >/dev/null
      return 0
    fi
  done

  echo "$label için Homebrew service bulunamadı. Denenen servisler: $*"
  return 1
}

ensure_port() {
  local host="$1"
  local port="$2"
  local label="$3"
  shift 3

  if port_open "$host" "$port"; then
    return 0
  fi

  start_brew_service "$label" "$@" || true
  sleep 2

  if port_open "$host" "$port"; then
    return 0
  fi

  echo "$label bulunamadı: $host:$port"
  echo "Local $label servisini başlatıp script'i tekrar çalıştır."
  exit 1
}

cleanup() {
  if [[ -n "${APP_PID:-}" ]]; then kill "$APP_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "${WORKER_PID:-}" ]]; then kill "$WORKER_PID" >/dev/null 2>&1 || true; fi
}

trap cleanup EXIT INT TERM

if [[ ! -d node_modules ]]; then
  echo "node_modules yok. Önce npm install çalıştır."
  exit 1
fi

ensure_port "$REDIS_HOST" "$REDIS_PORT" "Redis" "redis"
ensure_port "$MONGO_HOST" "$MONGO_PORT" "MongoDB" "mongodb-community" "mongodb/brew/mongodb-community" "mongodb-community@7.0" "mongodb-community@6.0"

export PORT="$APP_PORT"
export MONGODB_URI="$MONGO_URI"
export REDIS_HOST="$REDIS_HOST"
export REDIS_PORT="$REDIS_PORT"
export HEADLESS_DEFAULT="${HEADLESS_DEFAULT:-false}"
export MAX_PARALLEL_BROWSERS="${MAX_PARALLEL_BROWSERS:-2}"
export GOOGLE_MAX_RESULT_PAGES="${GOOGLE_MAX_RESULT_PAGES:-10}"
export GOOGLE_SEARCH_HL="${GOOGLE_SEARCH_HL:-tr}"
export GOOGLE_SEARCH_GL="${GOOGLE_SEARCH_GL:-tr}"
export CLOAKBROWSER_HUMANIZE="${CLOAKBROWSER_HUMANIZE:-true}"
export CLOAKBROWSER_HUMAN_PRESET="${CLOAKBROWSER_HUMAN_PRESET:-careful}"
export CLOAKBROWSER_AUTO_UPDATE="${CLOAKBROWSER_AUTO_UPDATE:-false}"

echo "Hitmaker local mode"
echo "UI: http://localhost:$PORT"
echo "Mongo: $MONGODB_URI"
echo "Redis: $REDIS_HOST:$REDIS_PORT"
echo "Headless default: $HEADLESS_DEFAULT"
echo

npm run dev &
APP_PID="$!"

npm run worker &
WORKER_PID="$!"

while kill -0 "$APP_PID" >/dev/null 2>&1 && kill -0 "$WORKER_PID" >/dev/null 2>&1; do
  sleep 1
done
