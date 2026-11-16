#!/usr/bin/env bash
# Builds Agent Office from this fork and installs it as the `agent-office` command, in place of
# upstream's release. Run it once, from any checkout of the fork:
#
#   scripts/fork/install-local.sh            # build the fork's main on GitHub and install it
#
# From then on `agent-office` keeps itself up to date as it starts: it looks for a newer main on
# GitHub and, when there is one, builds, tests and installs it (about a minute), then starts that.
# Nothing runs in between starts. `AGENT_OFFICE_NO_UPDATE=1 agent-office` starts what's installed
# without looking, and a new commit that fails to build or pass its tests is skipped.
#
# It builds what's pushed, never anyone's working tree: in a throwaway worktree of a clone of its
# own (~/.local/share/agent-office/fork/source.git), with the typecheck and the tests, packed the
# way .github/workflows/release.yml packs a release and installed by that commit's install.sh,
# as v<major>.<minor>.<commits>-fork.g<sha>. A failed build or test installs nothing, and the
# `agent-office` command only moves once the new version is in place.
#
# The office's data (~/agent-office: its floors, workers and projects) is never touched. Run by
# hand while an office is open, it installs without stopping that office: Ctrl+C it and run
# `agent-office` again to switch. Workers carry on through the restart in their terminal host.
# install.sh removes the versions nothing runs from any more, never one still in use.
#
# Options:
#   --ref <branch|sha>   build this instead of main (pushed to the fork); agent-office follows it
#   --if-changed         do nothing when that commit is already installed, or already failed
#   --skip-tests         don't run the typecheck and the tests first, now or when agent-office starts
#   --on-start           what agent-office runs as it starts: --if-changed, and saying what it found
#   --unwatch            take down the launchd agent older versions of this script set up to check
#                        every few minutes (installing, or starting agent-office, does that too)
#   --status             what's installed, and whether agent-office checks for updates
#
# Environment:
#   AGENT_OFFICE_INSTALL_DIR   where versions go (default ~/.local/share/agent-office), as install.sh
#   AGENT_OFFICE_BIN_DIR       where the `agent-office` command goes (default ~/.local/bin), as install.sh
#   AGENT_OFFICE_FORK_REMOTE   the repository to build (default: the origin of the checkout this is in)
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")"
INSTALL_DIR="${AGENT_OFFICE_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/agent-office}"
VERSIONS="$INSTALL_DIR/versions"
BIN_DIR="${AGENT_OFFICE_BIN_DIR-$HOME/.local/bin}"
STATE="$INSTALL_DIR/fork"
SOURCE="$STATE/source.git"
SELF="$STATE/install-local.sh"
# The launchd agent older versions of this script ran every few minutes (--watch).
LABEL="local.agent-office.fork-install"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# install.sh only replaces a launcher with this in it, so its install line can still take over.
MARKER="agent-office launcher, written by install.sh"
# And this marks the ones written here.
FORK_MARKER="by way of scripts/fork/install-local.sh"

# A worker's terminal points these at the office it runs in; the build and tests mustn't.
unset AGENT_OFFICE_WORKER_ID AGENT_OFFICE_HOOK_URL AGENT_OFFICE_HOOK_TOKEN AGENT_OFFICE_SESSION_ID \
  AGENT_OFFICE_TURN AGENT_OFFICE_HOME AGENT_OFFICE_PROJECTS PORT

if [ -t 2 ]; then CYAN=$'\033[1;36m' YELLOW=$'\033[1;33m' RED=$'\033[1;31m' RESET=$'\033[0m'
else CYAN="" YELLOW="" RED="" RESET=""; fi
NAME=install-local
step() { printf '%s==>%s %s\n' "$CYAN" "$RESET" "$*" >&2; }
warn() { printf '%swarning:%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() { printf '%s%s:%s %s\n' "$RED" "$NAME" "$RESET" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
sq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
# A remote to show: without any user or token in it.
shown() { printf '%s' "$1" | sed -E 's#://[^/@]*@#://#'; }

usage() { sed -n '2,/^set -euo/p' "$SCRIPT" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'; }

REF=main
IF_CHANGED=""
ON_START=""
TESTS=1
ACTION=install
BUILD=""
BUILDING=""
LOCKED=""

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)
      [ $# -ge 2 ] || die "--ref needs a branch or a commit"
      REF="$2"
      shift
      ;;
    --ref=*) REF="${1#*=}" ;;
    --if-changed) IF_CHANGED=1 ;;
    --on-start)
      IF_CHANGED=1
      ON_START=1
      NAME="agent-office update"
      ;;
    --skip-tests) TESTS="" ;;
    --watch*) die "there's no watcher any more: agent-office checks for updates each time it starts. Run this without --watch to install." ;;
    --unwatch) ACTION=unwatch ;;
    --status) ACTION=status ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
  shift
done
[[ "$REF" =~ ^[A-Za-z0-9._/-]+$ ]] || die "not a branch or a commit: $REF"
# Starting the office: a credential prompt mustn't stop it.
if [ -n "$ON_START" ]; then export GIT_TERMINAL_PROMPT=0; fi

# The fork's URL: from the checkout this script is in, or (for the copy agent-office runs as it
# starts, which isn't in one) the one it was installed from.
remote_url() {
  if [ -n "${AGENT_OFFICE_FORK_REMOTE:-}" ]; then
    printf '%s' "$AGENT_OFFICE_FORK_REMOTE"
    return
  fi
  local here top url=""
  here="$(dirname "$SCRIPT")"
  if [ "$here" != "$(mkdir -p "$STATE" && cd "$STATE" && pwd -P)" ]; then
    top="$(git -C "$here" rev-parse --show-toplevel 2>/dev/null || true)"
    if [ -n "$top" ] && [ -f "$top/scripts/fork/install-local.sh" ]; then
      url="$(git -C "$top" remote get-url origin 2>/dev/null || true)"
    fi
  fi
  if [ -z "$url" ] && [ -f "$STATE/remote" ]; then url="$(cat "$STATE/remote")"; fi
  [ -n "$url" ] || die "run this from a checkout of the fork, or set AGENT_OFFICE_FORK_REMOTE"
  printf '%s' "$url"
}

# The version the last install from the fork put in, if it's still there.
installed_tag() {
  local sha="" tag=""
  [ -f "$STATE/installed" ] && read -r sha tag <"$STATE/installed"
  if [ -n "$tag" ] && [ -f "$VERSIONS/$tag/.installed" ]; then printf '%s' "$tag"; fi
}

cleanup() {
  local rc=$? tag
  if [ -n "$BUILDING" ] && [ "$rc" -ne 0 ]; then
    printf '%s\n' "$BUILDING" >"$STATE/failed"
    cat "$BUILD"/*.log >"$STATE/failed.log" 2>/dev/null || true
  fi
  if [ -n "$BUILD" ] && [ -d "$BUILD" ]; then
    cd "$STATE"
    git -C "$SOURCE" worktree remove --force "$BUILD/src" >/dev/null 2>&1 || true
    rm -rf "$BUILD"
    git -C "$SOURCE" worktree prune >/dev/null 2>&1 || true
  fi
  if [ -n "$LOCKED" ]; then rm -rf "$STATE/lock"; fi
  if [ -n "$ON_START" ] && [ "$rc" -ne 0 ]; then
    tag="$(installed_tag)"
    if [ "$rc" -ge 128 ]; then
      step "Stopped. To start without looking for updates: AGENT_OFFICE_NO_UPDATE=1 agent-office"
    elif [ -n "$tag" ]; then
      warn "starting the installed $tag instead"
    fi
  fi
}

lock() {
  local pid fresh=0 waited=0
  mkdir -p "$STATE"
  until mkdir "$STATE/lock" 2>/dev/null; do
    pid="$(cat "$STATE/lock/pid" 2>/dev/null || true)"
    if [ -z "$pid" ] && [ "$fresh" -lt 2 ]; then
      # Another run may have only just taken it, and not written its pid yet.
      fresh=$((fresh + 1))
      sleep 1
      continue
    fi
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
      rm -rf "$STATE/lock" # left behind by a run that's gone
      continue
    fi
    if [ -z "$ON_START" ]; then
      if [ -n "$IF_CHANGED" ]; then exit 0; fi
      die "another install is running (pid $pid)"
    fi
    # Starting the office: wait for it, as it's most likely installing what this would.
    [ "$waited" -gt 0 ] || step "Waiting for another install (pid $pid) to finish"
    waited=$((waited + 1))
    [ "$waited" -lt 900 ] || die "another install (pid $pid) has been running for 15 minutes"
    sleep 1
  done
  LOCKED=1
  printf '%s\n' "$$" >"$STATE/lock/pid"
}

# Copies a script to where agent-office runs it from as it starts: by rename, as bash reads a
# script while it runs it, and this may be that script.
put_self() {
  cp "$1" "$SELF.tmp.$$"
  chmod 755 "$SELF.tmp.$$"
  mv -f "$SELF.tmp.$$" "$SELF"
}

# Runs a fetch. Starting the office, it gives up after 30 seconds, so a network that hangs can't
# keep the office from starting (macOS has no timeout(1), but it has perl).
net() {
  if [ -z "$ON_START" ]; then "$@"
  elif have timeout; then timeout 30 "$@"
  elif have perl; then perl -e 'alarm shift; exec @ARGV or exit 127' 30 "$@"
  else "$@"; fi
}

# The commit to build, after bringing the clone up to date with the fork's branches.
resolve() {
  local url="$1"
  if [ ! -d "$SOURCE" ]; then
    step "Cloning $(shown "$url")"
    git clone --quiet --bare "$url" "$SOURCE"
  fi
  git -C "$SOURCE" remote set-url origin "$url"
  net git -C "$SOURCE" fetch --quiet --force --prune origin '+refs/heads/*:refs/heads/*' ||
    die "couldn't fetch from $(shown "$url")"
  git -C "$SOURCE" rev-parse --verify --quiet "$REF^{commit}" ||
    die "no branch or commit $REF in $(shown "$url") (is it pushed?)"
}

# Older versions of this script kept the fork installed with a launchd agent that built main every
# few minutes. agent-office checks as it starts instead, so that agent goes. Not when it's that
# agent running this (an older plist, a newer copy of this script): taking it down from inside
# would stop this run part way. The next start of agent-office takes it down instead.
retire_watcher() {
  [ "$(uname -s)" = Darwin ] && [ -f "$PLIST" ] || return 0
  [ "$PPID" != 1 ] && [ "${XPC_SERVICE_NAME:-}" != "$LABEL" ] || return 0
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  step "Removed the launchd agent that built main every few minutes: agent-office looks for updates as it starts instead."
}

# The `agent-office` command. Each start runs this script with --on-start first (unless it's
# AGENT_OFFICE_NO_UPDATE=1, or one of the commands that don't start the office), then starts
# whichever version is installed by then. With --refresh it only replaces a launcher written here,
# to bring one an older version of this script wrote up to date.
write_launcher() {
  local tag="$1" entry="$2" sha="$3" url="$4" refresh="${5:-}" target tmp skip=""
  [ -n "$BIN_DIR" ] || return 0
  target="$BIN_DIR/agent-office"
  if [ -n "$refresh" ] && ! grep -q "$FORK_MARKER" "$target" 2>/dev/null; then return 0; fi
  if [ -e "$target" ] && ! grep -q "$MARKER" "$target" 2>/dev/null; then
    warn "left $target alone: install.sh didn't write it. Start this version with: node $entry"
    return 0
  fi
  [ -n "$TESTS" ] || skip=" --skip-tests"
  mkdir -p "$BIN_DIR"
  tmp="$target.tmp.$$"
  cat >"$tmp" <<EOF
#!/bin/sh
# $MARKER, $FORK_MARKER.
# Starts Agent Office, built from $(shown "$url"). Each start first looks for a newer $REF there,
# and builds, tests and installs it when there is one; nothing checks in between starts.
# AGENT_OFFICE_NO_UPDATE=1 agent-office starts what's installed without looking.
# Installed last: $tag, from $sha.
# (upstream's install line would put upstream's newest release back instead.)
entry=$(sq "$entry")
case "\${AGENT_OFFICE_NO_UPDATE:-}:\${1:-}" in
  1:* | *:prune | *:accounts | *:setup | *:tunnel | *:-h | *:--help) ;;
  *)
    if [ -f $(sq "$SELF") ]; then
      # Ctrl+C while it builds stops here, rather than starting the office.
      trap 'exit 130' INT
      AGENT_OFFICE_INSTALL_DIR=$(sq "$INSTALL_DIR") AGENT_OFFICE_BIN_DIR=$(sq "$BIN_DIR") \\
        bash $(sq "$SELF") --on-start --ref $(sq "$REF")$skip
      trap - INT
      tag=
      if [ -f $(sq "$STATE/installed") ]; then read -r _ tag <$(sq "$STATE/installed"); fi
      next=$(sq "$VERSIONS")/"\$tag/bin/agent-office.js"
      case "\$tag" in v*) if [ -f "\$next" ]; then entry="\$next"; fi ;; esac
    fi
    ;;
esac
exec node "\$entry" "\$@"
EOF
  chmod 755 "$tmp"
  if cmp -s "$tmp" "$target"; then rm -f "$tmp"; else mv -f "$tmp" "$target"; fi
}

install() {
  local url sha short version tag subject running had="" had_sha=""
  url="$(remote_url)"
  retire_watcher
  lock
  printf '%s\n' "$url" >"$STATE/remote"
  [ -z "$ON_START" ] || step "Looking for updates to $REF in $(shown "$url")"
  sha="$(resolve "$url")"
  short="${sha:0:7}"
  had="$(installed_tag)"
  if [ -n "$had" ]; then
    had_sha="$(cut -d' ' -f1 "$STATE/installed")"
    # A launcher an older version of this script wrote catches up.
    write_launcher "$had" "$VERSIONS/$had/bin/agent-office.js" "$had_sha" "$url" refresh
  fi
  if [ -n "$IF_CHANGED" ]; then
    if [ -n "$had" ] && [ "$had_sha" = "$sha" ]; then
      [ -z "$ON_START" ] || step "Up to date: $had"
      return 0
    fi
    # A commit that failed isn't tried again on its own; run this by hand to retry it.
    if [ -f "$STATE/failed" ] && [ "$(cat "$STATE/failed")" = "$sha" ]; then
      [ -z "$ON_START" ] || warn "$REF at $short failed to build or pass its tests (see $STATE/failed.log), so $had stays. To try it again: $SELF"
      return 0
    fi
  fi
  have node || die "this needs Node.js 20 or newer"
  have npm || die "this needs npm"

  BUILDING="$sha"
  BUILD="$(mktemp -d "$STATE/build.XXXXXX")"
  git -C "$SOURCE" worktree add --quiet --detach "$BUILD/src" "$sha"
  cd "$BUILD/src"
  subject="$(git log -1 --format=%s HEAD)"
  step "Building $REF at $short: $subject"
  # Its prepare script builds the client and the server.
  npm ci --no-audit --no-fund --loglevel=error >"$BUILD/build.log" 2>&1 || {
    tail -n 40 "$BUILD/build.log" >&2
    die "the build of $short failed, so it isn't installed"
  }
  if [ -n "$TESTS" ]; then
    step "Typecheck and tests"
    { npm run typecheck && npm test; } >"$BUILD/test.log" 2>&1 || {
      tail -n 60 "$BUILD/test.log" >&2
      die "the typecheck or tests of $short failed, so it isn't installed"
    }
  fi

  # Packed like .github/workflows/release.yml packs a release.
  version="$(node -p 'require("./package.json").version.split(".").slice(0, 2).join(".")').$(git rev-list --count HEAD)-fork.g$short"
  tag="v$version"
  {
    npm version "$version" --no-git-tag-version --allow-same-version
    npm pkg delete scripts.prepare
    cp package-lock.json npm-shrinkwrap.json
    npm pkg set 'files[]=npm-shrinkwrap.json'
    npm pack --ignore-scripts
  } >>"$BUILD/build.log" 2>&1 || {
    tail -n 20 "$BUILD/build.log" >&2
    die "couldn't pack $short"
  }
  mv "agent-office-$version.tgz" "$BUILD/agent-office.tgz"

  # The launcher is written below instead, saying where this one came from.
  step "Installing $tag"
  AGENT_OFFICE_TARBALL="$BUILD/agent-office.tgz" AGENT_OFFICE_INSTALL_DIR="$INSTALL_DIR" \
    AGENT_OFFICE_BIN_DIR="" AGENT_OFFICE_INSTALL_ONLY=1 bash "$BUILD/src/install.sh" >"$BUILD/install.log" 2>&1 || {
    tail -n 20 "$BUILD/install.log" >&2
    die "install.sh couldn't install $tag"
  }
  [ -f "$VERSIONS/$tag/.installed" ] || die "install.sh didn't install $tag"
  write_launcher "$tag" "$VERSIONS/$tag/bin/agent-office.js" "$sha" "$url"
  printf '%s %s\n' "$sha" "$tag" >"$STATE/installed"
  rm -f "$STATE/failed" "$STATE/failed.log"
  BUILDING=""
  # agent-office runs the copy that came with what's installed as it starts, so it keeps up with changes.
  if [ -f "$BUILD/src/scripts/fork/install-local.sh" ]; then put_self "$BUILD/src/scripts/fork/install-local.sh"
  elif [ ! -f "$SELF" ]; then put_self "$SCRIPT"; fi

  if [ -n "$ON_START" ]; then
    step "Installed $tag${had:+ (was $had)}"
    return 0
  fi
  # -a: run from a worker's terminal, the office is an ancestor, which macOS's pgrep leaves out otherwise.
  running="$(pgrep -a -f -- "$VERSIONS/v[^/]*/bin/agent-office.js" 2>/dev/null | head -n 1 || true)"
  if [ -n "$running" ] && ! pgrep -a -f -- "$VERSIONS/$tag/bin/agent-office.js" >/dev/null 2>&1; then
    step "Installed $tag. The office running now is an older version: Ctrl+C it and run agent-office to switch."
  else
    step "Installed $tag. Start it with: agent-office (each start looks for a newer $REF first)"
  fi
}

unwatch() {
  if [ -f "$PLIST" ]; then retire_watcher
  else step "There's no launchd agent to take down: agent-office looks for updates as it starts."; fi
}

status() {
  local current="" sha="" tag="" target="$BIN_DIR/agent-office"
  [ -f "$INSTALL_DIR/current" ] && current="$(cat "$INSTALL_DIR/current")"
  [ -f "$STATE/installed" ] && read -r sha tag <"$STATE/installed"
  printf 'agent-office runs:   %s\n' "${current:-nothing installed by install.sh}"
  if [ -n "$sha" ]; then printf 'last fork build:     %s (%s)\n' "$tag" "$sha"; fi
  if [ -n "$sha" ] && [ "$tag" != "$current" ]; then printf '                     (something else was installed since)\n'; fi
  if [ -f "$STATE/failed" ]; then printf 'last failed commit:  %s (see %s)\n' "$(cat "$STATE/failed")" "$STATE/failed.log"; fi
  if [ -f "$STATE/remote" ]; then printf 'fork:                %s\n' "$(shown "$(cat "$STATE/remote")")"; fi
  if [ -n "$BIN_DIR" ] && grep -q -- '--on-start' "$target" 2>/dev/null; then
    printf 'updates:             looked for each time %s starts\n' "$target"
  else
    printf "updates:             not looked for (%s wasn't written by this script; run it to install)\n" "$target"
  fi
  if [ -f "$PLIST" ]; then
    printf 'old watcher:         %s still builds every few minutes; --unwatch (or the next start) removes it\n' "$PLIST"
  fi
}

trap cleanup EXIT
# Stopped part way isn't a failed build: the next start may try that commit again.
trap 'BUILDING=""; exit 130' INT
trap 'BUILDING=""; exit 143' TERM
case "$ACTION" in
  install) install ;;
  unwatch) unwatch ;;
  status) status ;;
esac
