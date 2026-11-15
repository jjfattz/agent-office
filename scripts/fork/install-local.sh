#!/usr/bin/env bash
# Builds Agent Office from this fork and installs it as the `agent-office` command, in place of
# upstream's release. Run it from any checkout of the fork:
#
#   scripts/fork/install-local.sh            # build the fork's main on GitHub and install it
#   scripts/fork/install-local.sh --watch    # the same, and again every time main changes
#
# It builds what's pushed, never anyone's working tree: in a throwaway worktree of a clone of its
# own (~/.local/share/agent-office/fork/source.git), with the typecheck and the tests, packed the
# way .github/workflows/release.yml packs a release and installed by that commit's install.sh,
# as v<major>.<minor>.<commits>-fork.g<sha>. A failed build or test installs nothing, and the
# `agent-office` command only moves once the new version is in place.
#
# The office's data (~/agent-office: its floors, workers and projects) is never touched, and the
# office that's running keeps running its version until you restart it: Ctrl+C it and run
# `agent-office` again. Workers carry on through the restart in their terminal host. install.sh
# removes the versions nothing runs from any more, never one still in use.
#
# Options:
#   --ref <branch|sha>   build this instead of main (pushed to the fork)
#   --if-changed         do nothing when that commit is already installed, or already failed
#   --skip-tests         don't run the typecheck and the tests first
#   --watch [minutes]    keep it up to date: a launchd agent (macOS) checks every few minutes
#                        (default 5) and installs each new commit. Its log: fork/watch.log
#   --unwatch            stop the launchd agent
#   --status             what's installed, and whether it's watching
#
# Environment:
#   AGENT_OFFICE_INSTALL_DIR   where versions go (default ~/.local/share/agent-office), as install.sh
#   AGENT_OFFICE_BIN_DIR       where the `agent-office` command goes (default ~/.local/bin), as install.sh
#   AGENT_OFFICE_FORK_REMOTE   the repository to build (default: the origin of the checkout this is in)
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")"
INSTALL_DIR="${AGENT_OFFICE_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/agent-office}"
BIN_DIR="${AGENT_OFFICE_BIN_DIR-$HOME/.local/bin}"
STATE="$INSTALL_DIR/fork"
SOURCE="$STATE/source.git"
SELF="$STATE/install-local.sh"
LOG="$STATE/watch.log"
LABEL="local.agent-office.fork-install"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# install.sh only replaces a launcher with this in it, so its install line can still take over.
MARKER="agent-office launcher, written by install.sh"

# A worker's terminal points these at the office it runs in; the build and tests mustn't.
unset AGENT_OFFICE_WORKER_ID AGENT_OFFICE_HOOK_URL AGENT_OFFICE_HOOK_TOKEN AGENT_OFFICE_SESSION_ID \
  AGENT_OFFICE_TURN AGENT_OFFICE_HOME AGENT_OFFICE_PROJECTS PORT

if [ -t 2 ]; then CYAN=$'\033[1;36m' YELLOW=$'\033[1;33m' RED=$'\033[1;31m' RESET=$'\033[0m'
else CYAN="" YELLOW="" RED="" RESET=""; fi
stamp() { [ -t 2 ] || printf '%s ' "$(date '+%Y-%m-%d %H:%M:%S')"; }
step() { printf '%s%s==>%s %s\n' "$(stamp)" "$CYAN" "$RESET" "$*" >&2; }
warn() { printf '%s%swarning:%s %s\n' "$(stamp)" "$YELLOW" "$RESET" "$*" >&2; }
die() { printf '%s%sinstall-local:%s %s\n' "$(stamp)" "$RED" "$RESET" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
sq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
# A remote to show: without any user or token in it.
shown() { printf '%s' "$1" | sed -E 's#://[^/@]*@#://#'; }

usage() { sed -n '2,/^set -euo/p' "$SCRIPT" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'; }

REF=main
IF_CHANGED=""
TESTS=1
ACTION=install
MINUTES=5
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
    --skip-tests) TESTS="" ;;
    --watch)
      ACTION=watch
      if [ $# -ge 2 ] && [[ "$2" =~ ^[0-9]+$ ]]; then
        MINUTES="$2"
        shift
      fi
      ;;
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
[ "$MINUTES" -ge 1 ] || die "--watch needs at least 1 minute"

# The fork's URL: from the checkout this script is in, or (for the copy the launchd agent runs,
# which isn't in one) the one it was set up with.
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

notify() {
  # A macOS notification when it runs unattended (the launchd agent); a terminal sees the output.
  [ ! -t 2 ] && [ "$(uname -s)" = Darwin ] && have osascript || return 0
  osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "Agent Office"' -e 'end run' "$1" >/dev/null 2>&1 || true
}

cleanup() {
  local rc=$?
  if [ -n "$BUILDING" ] && [ "$rc" -ne 0 ]; then
    printf '%s\n' "$BUILDING" >"$STATE/failed"
    notify "Couldn't build ${BUILDING:0:7} from the fork; the installed version stays. See $LOG"
  fi
  if [ -n "$BUILD" ] && [ -d "$BUILD" ]; then
    cd "$STATE"
    git -C "$SOURCE" worktree remove --force "$BUILD/src" >/dev/null 2>&1 || true
    rm -rf "$BUILD"
    git -C "$SOURCE" worktree prune >/dev/null 2>&1 || true
  fi
  if [ -n "$LOCKED" ]; then rm -rf "$STATE/lock"; fi
}

lock() {
  mkdir -p "$STATE"
  if ! mkdir "$STATE/lock" 2>/dev/null; then
    local pid
    pid="$(cat "$STATE/lock/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      if [ -n "$IF_CHANGED" ]; then exit 0; fi
      die "another install is running (pid $pid)"
    fi
    rm -rf "$STATE/lock"
    mkdir "$STATE/lock"
  fi
  LOCKED=1
  printf '%s\n' "$$" >"$STATE/lock/pid"
}

# Keeps the log the launchd agent appends to from growing without end.
trim_log() {
  [ -f "$LOG" ] || return 0
  if [ "$(wc -c <"$LOG")" -gt 2000000 ]; then
    tail -n 4000 "$LOG" >"$LOG.tmp" && mv -f "$LOG.tmp" "$LOG"
  fi
}

# Copies a script to where the launchd agent runs it from: by rename, as bash reads a script while
# it runs it, and this may be that script.
put_self() {
  cp "$1" "$SELF.tmp.$$"
  chmod 755 "$SELF.tmp.$$"
  mv -f "$SELF.tmp.$$" "$SELF"
}

# The commit to build, after bringing the clone up to date with the fork's branches.
resolve() {
  local url="$1"
  if [ ! -d "$SOURCE" ]; then
    step "Cloning $(shown "$url")"
    git clone --quiet --bare "$url" "$SOURCE"
  fi
  git -C "$SOURCE" remote set-url origin "$url"
  git -C "$SOURCE" fetch --quiet --force --prune origin '+refs/heads/*:refs/heads/*' ||
    die "couldn't fetch from $(shown "$url")"
  git -C "$SOURCE" rev-parse --verify --quiet "$REF^{commit}" ||
    die "no branch or commit $REF in $(shown "$url") (is it pushed?)"
}

write_launcher() {
  local tag="$1" entry="$2" sha="$3" url="$4" target tmp
  [ -n "$BIN_DIR" ] || return 0
  target="$BIN_DIR/agent-office"
  if [ -e "$target" ] && ! grep -q "$MARKER" "$target" 2>/dev/null; then
    warn "left $target alone: install.sh didn't write it. Start this version with: node $entry"
    return 0
  fi
  mkdir -p "$BIN_DIR"
  tmp="$target.tmp.$$"
  cat >"$tmp" <<EOF
#!/bin/sh
# $MARKER, by way of scripts/fork/install-local.sh.
# Starts Agent Office $tag, built from $(shown "$url") at $sha.
# To rebuild it from the fork's newest $REF, run: $SELF
# (upstream's install line would put upstream's newest release back instead.)
exec node $(sq "$entry") "\$@"
EOF
  chmod 755 "$tmp"
  mv -f "$tmp" "$target"
}

install() {
  local url sha short version tag subject running
  url="$(remote_url)"
  lock
  trim_log
  printf '%s\n' "$url" >"$STATE/remote"
  sha="$(resolve "$url")"
  short="${sha:0:7}"
  if [ -n "$IF_CHANGED" ]; then
    if [ -f "$STATE/installed" ] && [ "$(cut -d' ' -f1 "$STATE/installed")" = "$sha" ]; then return 0; fi
    # A commit that failed isn't tried again on its own; run this by hand to retry it.
    if [ -f "$STATE/failed" ] && [ "$(cat "$STATE/failed")" = "$sha" ]; then return 0; fi
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
    die "the build of $short failed"
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
  AGENT_OFFICE_TARBALL="$BUILD/agent-office.tgz" AGENT_OFFICE_INSTALL_DIR="$INSTALL_DIR" \
    AGENT_OFFICE_BIN_DIR="" AGENT_OFFICE_INSTALL_ONLY=1 bash "$BUILD/src/install.sh" ||
    die "install.sh couldn't install $tag"
  [ -f "$INSTALL_DIR/versions/$tag/.installed" ] || die "install.sh didn't install $tag"
  write_launcher "$tag" "$INSTALL_DIR/versions/$tag/bin/agent-office.js" "$sha" "$url"
  printf '%s %s\n' "$sha" "$tag" >"$STATE/installed"
  rm -f "$STATE/failed"
  BUILDING=""
  # The launchd agent runs the copy that came with what's installed, so it keeps up with changes.
  if [ -f "$BUILD/src/scripts/fork/install-local.sh" ]; then put_self "$BUILD/src/scripts/fork/install-local.sh"
  elif [ ! -f "$SELF" ]; then put_self "$SCRIPT"; fi

  running="$(pgrep -f -- "$INSTALL_DIR/versions/v[^/]*/bin/agent-office.js" 2>/dev/null | head -n 1 || true)"
  if [ -n "$running" ] && ! pgrep -f -- "$INSTALL_DIR/versions/$tag/bin/agent-office.js" >/dev/null 2>&1; then
    step "Installed $tag. The office running now is an older version: Ctrl+C it and run agent-office to switch."
    notify "$tag is installed. Restart the office (Ctrl+C, then agent-office) to run it."
  else
    step "Installed $tag. Start it with: agent-office"
    notify "$tag is installed."
  fi
}

# The PATH the launchd agent gets: launchd's own has no node, npm or gh.
agent_path() {
  local out="" dir tool
  for tool in node npm git gh; do
    have "$tool" || continue
    dir="$(dirname "$(command -v "$tool")")"
    case ":$out:" in *":$dir:"*) ;; *) out="${out:+$out:}$dir" ;; esac
  done
  for dir in /opt/homebrew/bin /usr/local/bin /usr/bin /bin /usr/sbin /sbin; do
    case ":$out:" in *":$dir:"*) ;; *) out="${out:+$out:}$dir" ;; esac
  done
  printf '%s' "$out"
}

watch() {
  local url args="" env="" arg uid skip=""
  if [ "$(uname -s)" != Darwin ]; then
    die "--watch sets up a launchd agent, on macOS. Elsewhere, run this from cron, e.g. with crontab -e:
  */$MINUTES * * * * $SELF --if-changed --ref $REF >> $LOG 2>&1"
  fi
  have node || die "this needs Node.js 20 or newer"
  url="$(remote_url)"
  mkdir -p "$STATE" "$(dirname "$PLIST")"
  printf '%s\n' "$url" >"$STATE/remote"
  # A checkout's newer copy of this script wins over the one the last install left.
  if [ "$SCRIPT" != "$(cd "$STATE" && pwd -P)/install-local.sh" ]; then put_self "$SCRIPT"; fi
  [ -n "$TESTS" ] || skip=--skip-tests
  for arg in /bin/bash "$SELF" --if-changed --ref "$REF" $skip; do
    args="$args    <string>$(xml "$arg")</string>
"
  done
  env="    <key>PATH</key><string>$(xml "$(agent_path)")</string>
"
  if [ -n "${AGENT_OFFICE_INSTALL_DIR:-}" ]; then
    env="$env    <key>AGENT_OFFICE_INSTALL_DIR</key><string>$(xml "$AGENT_OFFICE_INSTALL_DIR")</string>
"
  fi
  if [ -n "${AGENT_OFFICE_BIN_DIR+set}" ]; then
    env="$env    <key>AGENT_OFFICE_BIN_DIR</key><string>$(xml "$AGENT_OFFICE_BIN_DIR")</string>
"
  fi
  cat >"$PLIST.tmp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by agent-office's scripts/fork/install-local.sh --watch; remove it with --unwatch. -->
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
$args  </array>
  <key>EnvironmentVariables</key>
  <dict>
$env  </dict>
  <key>WorkingDirectory</key><string>$(xml "$STATE")</string>
  <key>StartInterval</key><integer>$((MINUTES * 60))</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>5</integer>
  <key>StandardOutPath</key><string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG")</string>
</dict>
</plist>
EOF
  mv -f "$PLIST.tmp" "$PLIST"
  uid="$(id -u)"
  launchctl bootout "gui/$uid/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$uid" "$PLIST" || die "launchctl couldn't load $PLIST"
  step "Watching $(shown "$url") $REF: every $MINUTES minutes, a new commit is built, tested and installed as agent-office."
  step "Its log is $LOG. Stop it with: $SELF --unwatch"
}

unwatch() {
  [ "$(uname -s)" = Darwin ] || die "--unwatch takes down the launchd agent, on macOS; elsewhere, remove the cron line"
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  step "Stopped watching the fork. What's installed stays installed."
}

status() {
  local current="" sha="" tag=""
  [ -f "$INSTALL_DIR/current" ] && current="$(cat "$INSTALL_DIR/current")"
  [ -f "$STATE/installed" ] && read -r sha tag <"$STATE/installed"
  printf 'agent-office runs:   %s\n' "${current:-nothing installed by install.sh}"
  if [ -n "$sha" ]; then printf 'last fork build:     %s (%s)\n' "$tag" "$sha"; fi
  if [ -n "$sha" ] && [ "$tag" != "$current" ]; then printf '                     (something else was installed since)\n'; fi
  if [ -f "$STATE/failed" ]; then printf 'last failed commit:  %s (see %s)\n' "$(cat "$STATE/failed")" "$LOG"; fi
  if [ -f "$STATE/remote" ]; then printf 'fork:                %s\n' "$(shown "$(cat "$STATE/remote")")"; fi
  if [ "$(uname -s)" = Darwin ] && launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    printf 'watching:            yes, %s (log: %s)\n' "$PLIST" "$LOG"
  else
    printf 'watching:            no\n'
  fi
}

trap cleanup EXIT
# Stopped part way isn't a failed build: the watcher may try that commit again.
trap 'BUILDING=""; exit 130' INT
trap 'BUILDING=""; exit 143' TERM
case "$ACTION" in
  install) install ;;
  watch) watch ;;
  unwatch) unwatch ;;
  status) status ;;
esac
