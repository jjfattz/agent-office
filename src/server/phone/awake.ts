// Keeping the computer awake while phone access is on: a phone can only reach the office while the
// computer it runs on is on and awake. It's held by a small child process that each OS offers for
// this, which also watches the office's own process, so the hold ends if the office dies.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

/** The command that holds the computer awake for as long as process `pid` runs, on this OS; undefined where there's none. */
export function awakeCommand(platform: NodeJS.Platform, pid: number, has: (cmd: string) => boolean = onPath): [string, string[]] | undefined {
  if (platform === 'darwin') return ['caffeinate', ['-i', '-s', '-w', String(pid)]];
  if (platform === 'linux') {
    if (!has('systemd-inhibit')) return undefined;
    return ['systemd-inhibit', ['--what=idle:sleep', '--who=Agent Office', '--why=Your phone can reach the office', '--mode=block', 'sh', '-c', `while kill -0 ${pid} 2>/dev/null; do sleep 30; done`]];
  }
  if (platform === 'win32') {
    // ES_CONTINUOUS | ES_SYSTEM_REQUIRED, held by this thread until it ends with the office.
    const script = [
      `Add-Type -Name Power -Namespace AgentOffice -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'`,
      `[AgentOffice.Power]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null`,
      `while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 30 }`,
    ].join('; ');
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script]];
  }
  return undefined;
}

function onPath(cmd: string): boolean {
  return (process.env.PATH ?? '').split(':').some((d) => d && existsSync(`${d}/${cmd}`));
}

/** What to warn about when this computer is a laptop, which sleeps when its lid closes whatever else holds it awake. */
export function laptopNote(platform: NodeJS.Platform = process.platform): string | undefined {
  try {
    if (platform === 'darwin') {
      const batt = execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      return /InternalBattery/.test(batt) ? 'A MacBook still sleeps when you close its lid, unless it’s plugged in with a screen attached.' : undefined;
    }
    if (platform === 'linux') {
      return readdirSync('/sys/class/power_supply').some((d) => /^BAT/.test(d)) ? 'A laptop still sleeps when you close its lid.' : undefined;
    }
  } catch {
    // can't tell: say nothing
  }
  return undefined;
}

/** Holds the computer awake while asked to. */
export class KeepAwake {
  private child?: ChildProcess;
  readonly supported: boolean;
  private readonly cmd: [string, string[]] | undefined;

  constructor(platform: NodeJS.Platform = process.platform, pid = process.pid) {
    this.cmd = awakeCommand(platform, pid);
    this.supported = !!this.cmd;
  }

  get holding(): boolean {
    return !!this.child;
  }

  hold(on: boolean) {
    if (on === this.holding || !this.cmd) return;
    if (!on) {
      this.child?.kill();
      this.child = undefined;
      return;
    }
    const child = spawn(this.cmd[0], this.cmd[1], { stdio: 'ignore', windowsHide: true });
    child.on('error', () => {
      if (this.child === child) this.child = undefined;
    });
    child.on('exit', () => {
      if (this.child === child) this.child = undefined;
    });
    this.child = child;
  }
}
