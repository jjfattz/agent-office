#!/usr/bin/env bash
# Runs this checkout's office with hot reload, like `npm run dev`, but in a sandbox of its own, to
# try a change before it's merged without going near the office you work in:
#
#   scripts/fork/sandbox.sh        # then open http://localhost:5183 (password: dev)
#
# `npm run dev` keeps its data in ~/agent-office, the working office's own, and listens on :4600,
# where that office listens. Its server would share that office's floors and the terminal host its
# workers run in. The sandbox keeps its data in ~/.local/share/agent-office/sandbox instead (floors
# added in it are cloned there too), and runs the server on :4610 and Vite on :5183.
#
# Environment:
#   AGENT_OFFICE_SANDBOX            its data and floors (default ~/.local/share/agent-office/sandbox)
#   AGENT_OFFICE_SANDBOX_PORT       the server's port (default 4610)
#   AGENT_OFFICE_SANDBOX_VITE_PORT  Vite's port (default 5183)
set -euo pipefail

die() { printf 'sandbox: %s\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/../.."
[ -f package.json ] && [ -f scripts/fork/vite.sandbox.config.ts ] || die "run this from a checkout of agent-office"

SANDBOX="${AGENT_OFFICE_SANDBOX:-${XDG_DATA_HOME:-$HOME/.local/share}/agent-office/sandbox}"
PORT_SERVER="${AGENT_OFFICE_SANDBOX_PORT:-4610}"
PORT_VITE="${AGENT_OFFICE_SANDBOX_VITE_PORT:-5183}"
mkdir -p "$SANDBOX"
SANDBOX="$(cd "$SANDBOX" && pwd -P)"
case "$SANDBOX/" in
  "$(cd "$HOME" && pwd -P)/agent-office/"*) die "the sandbox can't be in ~/agent-office, the working office's own folder" ;;
esac
[ "$PORT_SERVER" != 4600 ] || die "the sandbox's server can't use :4600, where the working office listens"

# Nothing from the office this may be started in (a worker's terminal points these at it).
for var in $(env | sed -n 's/^\(AGENT_OFFICE_[A-Z_]*\)=.*/\1/p'); do
  case "$var" in AGENT_OFFICE_SANDBOX*) ;; *) unset "$var" ;; esac
done
unset PORT
export AGENT_OFFICE_HOME="$SANDBOX" AGENT_OFFICE_SANDBOX_PORT="$PORT_SERVER" AGENT_OFFICE_SANDBOX_VITE_PORT="$PORT_VITE"

[ -d node_modules ] || npm install --no-audit --no-fund

printf '\n  sandbox office: http://localhost:%s  (password: dev)\n  its data:       %s\n\n' "$PORT_VITE" "$SANDBOX"
exec npx concurrently -k -n vite,office \
  "vite --config scripts/fork/vite.sandbox.config.ts" \
  "tsx watch src/server/cli.ts --port $PORT_SERVER --password dev --no-open"
