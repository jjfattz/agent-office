// The referee of each game on the arcade cabinet (see referee.ts), by its title.
import type { FrameOf, Title } from '../../shared/cabinet.js';
import { blockfall } from './blockfall.js';
import { bugswarm } from './bugswarm.js';
import type { Referee } from './referee.js';

export type { Referee, Tally } from './referee.js';

export const REFEREES: { readonly [T in Title]: Referee<FrameOf<T>> } = { blockfall, bugswarm };
