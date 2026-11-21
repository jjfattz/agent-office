// What 📱 Use on your phone keeps in the office's config.json, under "phone": whether access is on,
// exactly which of Tailscale Serve's ports the office set up (so turning it off removes those and
// nothing else), and keep-awake. `agent-office phone on|off` writes it too.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface PhoneSaved {
  on: boolean;
  /** The HTTPS port the office is served on, when the office set it up. */
  port?: number;
  /** Workers' web servers' ports the office set up on the tailnet (each relayed by the office). */
  workerPorts: number[];
  /** Keep the computer awake while access is on. */
  awake: boolean;
}

const DEFAULTS: PhoneSaved = { on: false, workerPorts: [], awake: true };

const port = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 65536 ? (v as number) : undefined);

function readConfig(dataDir: string): Record<string, unknown> {
  try {
    const v = JSON.parse(readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function readPhone(dataDir: string): PhoneSaved {
  const p = readConfig(dataDir).phone as Partial<PhoneSaved> | undefined;
  if (!p || typeof p !== 'object') return { ...DEFAULTS, workerPorts: [] };
  return {
    on: p.on === true,
    ...(port(p.port) ? { port: port(p.port) } : {}),
    workerPorts: Array.isArray(p.workerPorts) ? p.workerPorts.map(port).filter((x): x is number => !!x) : [],
    awake: p.awake !== false,
  };
}

/** Writes "phone" into config.json, leaving the rest of it as it is on disk. */
export function writePhone(dataDir: string, saved: PhoneSaved) {
  const file = path.join(dataDir, 'config.json');
  const cfg = readConfig(dataDir);
  cfg.phone = saved;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}
