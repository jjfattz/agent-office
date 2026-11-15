// Whose Claude plan each person in the office sees in the limits box under the workers: the plan the
// Claude workers they hire where they are run on (see provider-accounts/run-as.ts). That's their own,
// once they signed in to a Claude of their own; else the Claude provider account the floor they're on
// picked; else the office machine's own login. Going to another project's floor shows that project's
// account, with nothing to switch. Each plan anyone looks at has a PlanLimitsReader of its own.
import type { PlanLimits } from '../shared/protocol.js';
import type { PlanLimitsReader } from './limits.js';
import type { Client } from './office/client.js';
import type { ProviderAccounts } from './provider-accounts/index.js';
import type { SignIns } from './signins.js';

type Env = Record<string, string>;
export type LimitsReader = Pick<PlanLimitsReader, 'state' | 'refresh' | 'close'>;

export interface WhoseLimitsDeps {
  /** A reader of the plan `env` signs in to, polling while `wanted`. */
  read(env: Env, wanted: () => boolean, onChange: (state: PlanLimits) => void): LimitsReader;
  /** The office's own environment, which every plan's is built on. */
  base(): Env;
  signins: Pick<SignIns, 'claudeKey' | 'apply'>;
  accounts: Pick<ProviderAccounts, 'pick' | 'get' | 'apply'>;
  /** The floor `c` is on, none on the roof or in the lobby. */
  floorOf(c: Client): string | undefined;
  /** Everyone in the office. */
  clients(): Iterable<Client>;
  send(c: Client, state: PlanLimits): void;
}

/** A plan other than the office's own: someone's own Claude, or a provider account. */
interface Plan {
  /** `person:<their account>` or `account:<provider account>`. */
  id: string;
  /** Changes whenever what it signs in with changes, to read it afresh. */
  key: string;
  /** The provider account's name, to say whose numbers they are. */
  name?: string;
  env(): Env;
}

const PERSON = 'person:';
const ACCOUNT = 'account:';

export class WhoseLimits {
  private office: LimitsReader;
  private plans = new Map<string, { key: string; reader: LimitsReader }>();
  /** What each person was last sent: whose numbers, under what name. */
  private told = new WeakMap<Client, { reader: LimitsReader; name?: string }>();

  constructor(private d: WhoseLimitsDeps) {
    this.office = this.make(d.base());
  }

  /** What `c` sees from now on, for what they're sent as they walk in; read again when it's old. */
  shown(c: Client): PlanLimits {
    const { reader, name } = this.see(c);
    reader.refresh();
    return withName(reader.state, name);
  }

  /** Tells `c` the numbers they see, when they're someone else's than `c` was last told (another floor, another account). */
  show(c: Client) {
    const was = this.told.get(c);
    const { reader, name } = this.see(c);
    if (was?.reader === reader && was.name === name) return;
    this.d.send(c, withName(reader.state, name));
    if (was?.reader !== reader) reader.refresh();
  }

  /** Floors' picks, accounts or sign-ins changed: shows everyone theirs, and lets go of the accounts that are gone. */
  showAll() {
    for (const c of this.d.clients()) this.show(c);
    for (const [id, p] of this.plans) if (id.startsWith(ACCOUNT) && !this.d.accounts.get(id.slice(ACCOUNT.length))) this.drop(id, p.reader);
  }

  /** Reads what `c` sees again now (they clicked the box). */
  refresh(c: Client) {
    this.see(c).reader.refresh();
  }

  /** Account `id` was revoked: its own plan goes with it. */
  forget(id: string) {
    const p = this.plans.get(PERSON + id);
    if (p) this.drop(PERSON + id, p.reader);
  }

  close() {
    this.office.close();
    for (const p of this.plans.values()) p.reader.close();
    this.plans.clear();
  }

  // ---------------------------------------------------------------------------

  /** Whose numbers `c` sees now, and from now on: that plan's reader, made when nobody had it yet. */
  private see(c: Client): { reader: LimitsReader; name?: string } {
    const plan = this.planOf(c);
    let reader = this.office;
    if (plan) {
      let p = this.plans.get(plan.id);
      if (p?.key !== plan.key) {
        p?.reader.close();
        p = { key: plan.key, reader: this.make(plan.env()) };
        this.plans.set(plan.id, p);
      }
      reader = p.reader;
    }
    const seen = { reader, ...(plan?.name ? { name: plan.name } : {}) };
    this.told.set(c, seen);
    return seen;
  }

  /** Their own Claude comes first, as it does for the workers they hire; then the floor's account. */
  private planOf(c: Client): Plan | undefined {
    const { signins, accounts, base } = this.d;
    const owner = c.accountId;
    const own = owner ? signins.claudeKey(owner) : undefined;
    if (owner && own !== undefined) return { id: PERSON + owner, key: own, env: () => signins.apply(owner, base(), [], 'claude') };
    const floor = this.d.floorOf(c);
    const a = accounts.get(floor ? accounts.pick(floor, 'claude') : undefined);
    if (!a) return undefined;
    return {
      id: ACCOUNT + a.id,
      key: [a.how, a.dir ?? '', a.token?.slice(-12) ?? '', a.who ?? ''].join(':'),
      name: a.name,
      env: () => {
        const env = base();
        accounts.apply(a.id, env, []);
        return env;
      },
    };
  }

  private make(env: Env): LimitsReader {
    const reader: LimitsReader = this.d.read(
      env,
      () => this.viewers(reader).length > 0,
      () => {
        for (const c of this.viewers(reader)) this.d.send(c, withName(reader.state, this.told.get(c)?.name));
      },
    );
    return reader;
  }

  private viewers(reader: LimitsReader): Client[] {
    return [...this.d.clients()].filter((c) => this.told.get(c)?.reader === reader);
  }

  private drop(id: string, reader: LimitsReader) {
    reader.close();
    this.plans.delete(id);
  }
}

const withName = (state: PlanLimits, name: string | undefined): PlanLimits => (name ? { ...state, account: name } : state);
