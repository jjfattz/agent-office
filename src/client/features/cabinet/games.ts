import type { CabinetFrame, FrameOf, Title } from '../../../shared/cabinet';
import { blockfall } from './blocks';
import { brickbust } from './brickbust-paint';
import { bugswarm } from './bugswarm-paint';
import type { Cartridge } from './cart';

/** Every game on the arcade cabinet, by its title (see shared/cabinet.ts for the others' lists). */
export const CARTS: { readonly [T in Title]: Cartridge<FrameOf<T>> } = { blockfall, bugswarm, brickbust };

/** The game a frame is of. */
export const cartOf = (f: CabinetFrame): Cartridge => CARTS[f.title] as Cartridge;
