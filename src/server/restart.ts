// ⚙️ Settings → Restart Agent Office: the office stops and whatever started it starts it again. Workers
// keep running through it in their terminal host, as they do through any restart (see cli.ts).

/**
 * The exit code that asks the `agent-office` command (scripts/fork/install-local.sh's launcher) to
 * start the office again, after looking for a newer version, rather than stop.
 */
export const RESTART_EXIT_CODE = 75;

/**
 * What starts the office again once it exits, if anything does:
 * - `launcher`: the `agent-office` command, which sets AGENT_OFFICE_RESTART=launcher and looks for
 *   updates as it starts the office again.
 * - `service`: systemd (deploy/provision.sh's unit, Restart=always), on the same version.
 */
export type Restarter = 'launcher' | 'service';

export function restarter(env: NodeJS.ProcessEnv = process.env): Restarter | undefined {
  if (env.AGENT_OFFICE_RESTART === 'launcher') return 'launcher';
  if (env.AGENT_OFFICE_SELF_UPDATE === '1') return 'service';
  return undefined;
}

/**
 * Stops the office for whatever started it to start again. cli.ts's SIGTERM handler shuts it down
 * gracefully, leaving the workers running, and exits with process.exitCode.
 */
export function restartOffice() {
  if (restarter() === 'launcher') process.exitCode = RESTART_EXIT_CODE;
  process.kill(process.pid, 'SIGTERM');
}
