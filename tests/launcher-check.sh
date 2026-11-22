#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/打包/融侨学迹.app"
LAUNCHER="$APP/Contents/MacOS/融侨学迹"

[[ -x "$LAUNCHER" ]] || { printf '%s\n' '缺少可执行的融侨学迹应用入口' >&2; exit 1; }
[[ -f "$APP/Contents/Info.plist" ]] || { printf '%s\n' '缺少应用信息文件' >&2; exit 1; }
grep -q '<string>融侨学迹</string>' "$APP/Contents/Info.plist"
grep -q 'PROJECT_ROOT=' "$LAUNCHER"
grep -q 'server.py' "$LAUNCHER"
grep -q '127.0.0.1' "$ROOT/server.py"
zsh -n "$LAUNCHER"
zsh -n "$ROOT/启动融侨学迹.command"

PORT=8898
DATA_DIR="/tmp/rongqiao-launcher-check-$$"
mkdir -p "$DATA_DIR"
cleanup() { [[ -n "${APP_PID:-}" ]] && kill "$APP_PID" 2>/dev/null || true; [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT
ZHIXU_DATA_DIR="$DATA_DIR" "$LAUNCHER" --port "$PORT" --no-open >"$DATA_DIR/app.log" 2>&1 &
APP_PID=$!
for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
curl -fsS "http://127.0.0.1:$PORT/" | grep -q '融侨学迹'
kill "$APP_PID" 2>/dev/null || true
wait "$APP_PID" 2>/dev/null || true
unset APP_PID

PORT=8899
ZHIXU_DATA_DIR="$DATA_DIR" python3 "$ROOT/server.py" --port "$PORT" --no-open >"$DATA_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
occupied="$(ZHIXU_DATA_DIR="$DATA_DIR" "$LAUNCHER" --port "$PORT" --no-open 2>&1)"
printf '%s\n' "$occupied" | grep -q '已经在运行'
printf '%s\n' 'PASS 融侨学迹应用包启动、入口访问与端口占用恢复提示'
