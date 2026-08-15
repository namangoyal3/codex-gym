#!/bin/sh
# Double-click this file to open Codex Gym.
#
# Starts the local server and opens the browser. Nothing is installed, and
# nothing is sent anywhere: the server listens on 127.0.0.1 only.

cd "$(dirname "$0")" || exit 1

PORT=8477
REPO="$1"

if [ -z "$REPO" ]; then
  # Prefer a gym the player already made, then the current folder.
  if [ -d "$HOME/codex-gym-projects" ] && [ -n "$(ls -A "$HOME/codex-gym-projects" 2>/dev/null)" ]; then
    REPO="$(find "$HOME/codex-gym-projects" -mindepth 1 -maxdepth 1 -type d | head -1)"
  else
    REPO="$PWD"
  fi
fi

PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
command -v "$PY" >/dev/null 2>&1 || {
  echo "Python 3 is required. Install it from https://www.python.org/downloads/"
  echo "Press return to close."
  read -r _
  exit 1
}

# Free the port if a previous session is still holding it.
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti "tcp:$PORT" 2>/dev/null)"
  [ -n "$PIDS" ] && kill $PIDS 2>/dev/null && sleep 1
fi

echo "CODEX GYM"
echo "  floor: $REPO"
echo "  opening http://127.0.0.1:$PORT"
echo "  close this window to shut the gym."
echo

( sleep 2
  if command -v open >/dev/null 2>&1; then open "http://127.0.0.1:$PORT"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://127.0.0.1:$PORT"
  fi ) &

exec "$PY" server.py --repo "$REPO" --port "$PORT"
