// Putting the office on the tailnet and taking it off again, for the 📱 window and for
// `agent-office phone on|off`. Serve's settings are read first every time, and nothing the office
// didn't set up is ever changed: a port that serves another app is left to it, and turning off
// removes exactly the ports the office added.
import { enableLink, needsOperator, parseServe, parseStatus, pickPort, portUse, serveOff, serveOn, sharesPort, type Run, type ServeConfig, type TsStatus } from './tailscale.js';

/** How long `tailscale serve` may wait for HTTPS to be turned on for the tailnet. */
export const SERVE_WAIT_MS = 10 * 60_000;

/** What Tailscale says now: its status, and Serve's settings while it runs. */
export interface Looked {
  status: TsStatus;
  serve: ServeConfig;
}

export async function lookAt(run: Run): Promise<Looked> {
  const st = await run(['status', '--json'], { timeoutMs: 8000 });
  const status = parseStatus(st.out);
  if (status.state !== 'running' || !status.host) return { status, serve: {} };
  const sv = await run(['serve', 'status', '--json'], { timeoutMs: 8000 });
  return { status, serve: sv.code === 0 ? parseServe(sv.out) : {} };
}

/** The first line of what a command said, for telling someone what went wrong. */
export const firstLine = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
    ?.slice(0, 200) ?? 'it gave no reason';

export type ServeResult =
  /** Served on `port`; `moved` when 443 was another app's. */
  | { port: number; moved: boolean }
  /** `operator`: this user may not change Serve's settings (Linux). `waiting`: HTTPS was never turned on. */
  | { error: string; operator?: boolean; waiting?: boolean; aborted?: boolean };

/**
 * Serves the office on the first of Tailscale's HTTPS ports that's free (or already the office's).
 * While HTTPS is off for the tailnet, `tailscale serve` waits for it with a link to Tailscale's page
 * that turns it on, which `onEnableLink` hears.
 */
export async function serveOffice(run: Run, look: Looked, officePort: number, opts: { signal?: AbortSignal; onEnableLink?: (url: string) => void } = {}): Promise<ServeResult> {
  const { status, serve } = look;
  if (status.state !== 'running' || !status.host) return { error: 'Tailscale isn’t running and signed in on this computer yet (steps 1 and 2).' };
  const pick = pickPort(serve, status.host, officePort);
  if (!pick) return { error: 'Other apps already use every secure link Tailscale offers this computer (ports 443, 8443 and 10000). Free one up (see tailscale serve status) and try again.' };
  const moved = pick.port !== 443;
  if (pick.already) return { port: pick.port, moved };
  let seen = '';
  const r = await run(serveOn(pick.port, officePort), {
    timeoutMs: SERVE_WAIT_MS,
    signal: opts.signal,
    onOutput: (t) => {
      const link = enableLink(t);
      if (link && link !== seen) opts.onEnableLink?.((seen = link));
    },
  });
  if (r.code === 0) return { port: pick.port, moved };
  const said = `${r.err}\n${r.out}`;
  if (r.code === null) return opts.signal?.aborted ? { error: '', aborted: true } : { error: 'Tailscale is still waiting for secure links to be turned on (step 3). Turn them on, then try again.', waiting: true };
  if (needsOperator(said)) return { error: 'Tailscale won’t let the office change its settings yet. Run the command below once, then turn phone access on again.', operator: true };
  return { error: `Tailscale couldn’t serve the office: ${firstLine(said)}` };
}

/** Stops serving each of `ports` that still points at the office; resolves to the first error, or ''. */
export async function unserve(run: Run, host: string, officePort: number, ports: number[]): Promise<string> {
  const { serve } = await lookAt(run);
  let error = '';
  for (const port of new Set(ports)) {
    if (portUse(serve, host, port, officePort) !== 'office') continue;
    const r = await run(serveOff(port, sharesPort(serve, host, port)), { timeoutMs: 30_000 });
    if (r.code !== 0) error ||= firstLine(`${r.err}\n${r.out}`);
  }
  return error;
}

/**
 * Serves workers' web servers on the tailnet (each port to the office, which relays it to the
 * worker's server for whoever's signed in): `wanted` now, given the ones the office already `owned`.
 * Ports another app serves are left to it. Resolves to the ports the office has now, and the first error.
 */
export async function syncWorkerPorts(run: Run, host: string, officePort: number, skip: number[], owned: number[], wanted: number[]): Promise<{ owned: number[]; error: string }> {
  const { serve } = await lookAt(run);
  const want = new Set(wanted.filter((p) => !skip.includes(p) && p !== officePort));
  const have = new Set(owned);
  let error = '';
  for (const port of [...have]) {
    if (want.has(port)) continue;
    if (portUse(serve, host, port, officePort) === 'office') {
      const r = await run(serveOff(port, sharesPort(serve, host, port)), { timeoutMs: 30_000 });
      if (r.code !== 0) {
        error ||= firstLine(`${r.err}\n${r.out}`);
        continue;
      }
    }
    have.delete(port);
  }
  for (const port of want) {
    if (have.has(port)) continue;
    const use = portUse(serve, host, port, officePort);
    if (use === 'other') continue;
    if (use === 'free') {
      const r = await run(serveOn(port, officePort), { timeoutMs: 30_000 });
      if (r.code !== 0) {
        error ||= firstLine(`${r.err}\n${r.out}`);
        continue;
      }
    }
    have.add(port);
  }
  return { owned: [...have].sort((a, b) => a - b), error };
}
