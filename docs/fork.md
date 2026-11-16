# Running this fork as your office

Back to the [README](../README.md).

This repository is [jjfattz/agent-office](https://github.com/jjfattz/agent-office), a fork of [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office) that goes its own way. The office you work in runs the fork's own `main`, updated each time you start it, and changes are tried in a sandbox before that, so neither ever touches the floors, workers and projects in `~/agent-office`. Everything for it is in [`scripts/fork/`](../scripts/fork).

## The `agent-office` command runs the fork

```bash
scripts/fork/install-local.sh            # build the fork's main and install it as agent-office
```

Run it once. It replaces the release the upstream install line put in `~/.local/share/agent-office` and `~/.local/bin/agent-office`, and from then on `agent-office` keeps itself up to date as it starts, so restarting the office is how you update it. Nothing runs in the background between starts.

Each time `agent-office` starts the office, it first:

1. Fetches the fork from GitHub into a clone of its own (`~/.local/share/agent-office/fork/source.git`). It builds what's pushed, never a working tree, so nobody's uncommitted work and no worker's half-done branch ends up in the office. When `main` hasn't moved since the last install, that's all, and the office starts right away.
2. Checks the new commit out in a throwaway worktree and runs `npm ci` (which builds it), `npm run typecheck` and `npm test`. That takes about a minute.
3. Packs it the way [`release.yml`](../.github/workflows/release.yml) packs a release, as `v<major>.<minor>.<commits>-fork.g<sha>`, and installs it with that commit's `install.sh`, which builds the new version off to the side.
4. Points `~/.local/bin/agent-office` at it, and starts it.

Running `scripts/fork/install-local.sh` by hand does all of that right away, except start the office. An office that's already running keeps running its version. To switch, press Ctrl+C where it runs and start `agent-office` again. Workers carry on through the restart in their terminal host, and their conversations resume. The office's data is the same `~/agent-office` it always was. `install.sh` removes the versions nothing runs from any more, never one an office or a worker still uses.

A start never fails because of an update. When a build or a test fails, or GitHub can't be reached (the fetch gives up after 30 seconds), the office starts the version that's installed. A commit that failed isn't tried again on its own: each start says so, and the full log is in `~/.local/share/agent-office/fork/failed.log`. Run the script by hand to retry it, or push a fix. Pressing Ctrl+C while it builds stops there, without starting the office or marking that commit failed.

`AGENT_OFFICE_NO_UPDATE=1 agent-office` starts what's installed without looking for updates. `agent-office prune`, `accounts`, `setup`, `tunnel` and `--help` never look, since they don't start the office.

Options:

| Option | What it does |
| --- | --- |
| `--ref <branch or sha>` | build that instead of `main` (it must be pushed), and have `agent-office` follow it as it starts |
| `--skip-tests` | skip the typecheck and the tests, now and as `agent-office` starts |
| `--if-changed` | do nothing when that commit is already installed, or already failed |
| `--status` | what's installed, from which commit, and whether `agent-office` looks for updates |
| `--unwatch` | take down the launchd agent that older versions of this script set up with `--watch`, which built `main` every five minutes |

That launchd agent (`~/Library/LaunchAgents/local.agent-office.fork-install.plist`) isn't needed any more. The first start of an `agent-office` that looks for updates removes it, and so does running the script by hand. On Linux, take out the cron line that ran the script, if you added one.

As it starts, `agent-office` runs `~/.local/share/agent-office/fork/install-local.sh`, the copy of the script that came with the installed build, with the `node`, `npm` and `git` on your `PATH` then.

To go back to upstream's newest release instead, run upstream's install line (in the [README](../README.md#run-locally)). It puts its own `agent-office` command back, which doesn't look at the fork.

## Trying a change in a sandbox

`npm run dev` keeps its data in `~/agent-office`, and its server listens on `:4600`. That's the working office's own folder and port: its server would share that office's floors and the terminal host its workers run in. To try a change before it's merged, run the sandbox from that branch's checkout instead:

```bash
scripts/fork/sandbox.sh        # http://localhost:5183, password: dev
```

It's `npm run dev` with its data and floors in `~/.local/share/agent-office/sandbox`, the server on `:4610` and Vite on `:5183`. It drops the `AGENT_OFFICE_*` variables a worker's terminal points at the working office, so it can run from a worker's desk too. `AGENT_OFFICE_SANDBOX`, `AGENT_OFFICE_SANDBOX_PORT` and `AGENT_OFFICE_SANDBOX_VITE_PORT` move it. Delete that folder to start the sandbox over.

## Pull requests and upstream

Pull requests go to the fork: `gh pr create --repo jjfattz/agent-office`. The checkout's `gh` default is the fork too (`gh repo set-default jjfattz/agent-office`), since a fresh fork's default is the repository it was forked from.

That default is also where the issues board reads from, and GitHub turns issues off on a new fork. Until they're on, the board says *Issues are turned off for jjfattz/agent-office*. Turn them on with `gh repo edit jjfattz/agent-office --enable-issues`, or under the repository's **Settings → General → Features → Issues**.

To bring in what's new upstream, merge it on a branch of its own and open a pull request:

```bash
git fetch origin && git fetch upstream    # upstream: https://github.com/AgentSystemLabs/agent-office
git switch -c sync-upstream origin/main
git merge upstream/main                   # resolve conflicts so both sides survive
git push -u origin sync-upstream
gh pr create --repo jjfattz/agent-office --title "Merge upstream" --body "What's new upstream"
```

Merge that pull request with **Create a merge commit**, not squash: a squashed sync loses track of what came from upstream, and the next sync conflicts on all of it again. Once it's on `main`, the next start of `agent-office` installs it like any other change.
