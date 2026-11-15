# Running this fork as your office

Back to the [README](../README.md).

This repository is [jjfattz/agent-office](https://github.com/jjfattz/agent-office), a fork of [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office) that goes its own way. The office you work in runs the fork's own `main`, rebuilt each time a change lands on it, and changes are tried in a sandbox before that, so neither ever touches the floors, workers and projects in `~/agent-office`. Everything for it is in [`scripts/fork/`](../scripts/fork).

## The `agent-office` command runs the fork

```bash
scripts/fork/install-local.sh            # build the fork's main and install it as agent-office
scripts/fork/install-local.sh --watch    # and again whenever main changes (checks every 5 minutes)
```

It replaces the release the upstream install line put in `~/.local/share/agent-office` and `~/.local/bin/agent-office`. Each time, it:

1. Fetches the fork from GitHub into a clone of its own (`~/.local/share/agent-office/fork/source.git`). It builds what's pushed, never a working tree, so nobody's uncommitted work and no worker's half-done branch ends up in the office.
2. Checks the commit out in a throwaway worktree and runs `npm ci` (which builds it), `npm run typecheck` and `npm test`.
3. Packs it the way [`release.yml`](../.github/workflows/release.yml) packs a release, as `v<major>.<minor>.<commits>-fork.g<sha>`, and installs it with that commit's `install.sh`, which builds the new version off to the side.
4. Points `~/.local/bin/agent-office` at it.

A build or a test that fails installs nothing and leaves the `agent-office` you have as it was. The watcher doesn't try that commit again, and the next one gets its own try; run the script by hand to retry a failed commit.

The office that's running keeps running its version: installing never stops or restarts it. To switch, press Ctrl+C where it runs and start `agent-office` again. Workers carry on through the restart in their terminal host, and their conversations resume. The office's data is the same `~/agent-office` it always was. `install.sh` removes the versions nothing runs from any more, never one an office or a worker still uses.

Options:

| Option | What it does |
| --- | --- |
| `--ref <branch or sha>` | build that instead of `main` (it must be pushed) |
| `--skip-tests` | skip the typecheck and the tests |
| `--if-changed` | do nothing when that commit is already installed, or already failed |
| `--watch [minutes]` | install a launchd agent (`~/Library/LaunchAgents/local.agent-office.fork-install.plist`) that runs `--if-changed` every few minutes, 5 unless you say. A new build shows a macOS notification |
| `--unwatch` | remove the launchd agent; what's installed stays |
| `--status` | what's installed, from which commit, and whether it's watching |

The watcher runs `~/.local/share/agent-office/fork/install-local.sh`, the copy of the script that came with the installed build, and logs to `~/.local/share/agent-office/fork/watch.log`. It runs with the `node`, `npm`, `git` and `gh` it found when you ran `--watch`; after switching Node versions (nvm), run `--watch` again. On Linux there's no launchd: run it from cron (`--watch` prints the line).

To go back to upstream's newest release instead, run upstream's install line (in the [README](../README.md#run-locally)), and `--unwatch` so the fork doesn't come back five minutes later.

## Trying a change in a sandbox

`npm run dev` keeps its data in `~/agent-office`, and its server listens on `:4600`. That's the working office's own folder and port: its server would share that office's floors and the terminal host its workers run in. To try a change before it's merged, run the sandbox from that branch's checkout instead:

```bash
scripts/fork/sandbox.sh        # http://localhost:5183, password: dev
```

It's `npm run dev` with its data and floors in `~/.local/share/agent-office/sandbox`, the server on `:4610` and Vite on `:5183`. It drops the `AGENT_OFFICE_*` variables a worker's terminal points at the working office, so it can run from a worker's desk too. `AGENT_OFFICE_SANDBOX`, `AGENT_OFFICE_SANDBOX_PORT` and `AGENT_OFFICE_SANDBOX_VITE_PORT` move it. Delete that folder to start the sandbox over.

## Pull requests and upstream

Pull requests go to the fork: `gh pr create --repo jjfattz/agent-office`. The checkout's `gh` default is the fork too (`gh repo set-default jjfattz/agent-office`), since a fresh fork's default is the repository it was forked from.

To bring in what's new upstream, merge it on a branch of its own and open a pull request:

```bash
git fetch origin && git fetch upstream    # upstream: https://github.com/AgentSystemLabs/agent-office
git switch -c sync-upstream origin/main
git merge upstream/main                   # resolve conflicts so both sides survive
git push -u origin sync-upstream
gh pr create --repo jjfattz/agent-office --title "Merge upstream" --body "What's new upstream"
```

Merge that pull request with **Create a merge commit**, not squash: a squashed sync loses track of what came from upstream, and the next sync conflicts on all of it again. Once it's on `main`, the watcher installs it like any other change.
