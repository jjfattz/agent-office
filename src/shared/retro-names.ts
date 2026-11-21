// Game names the way game files and libretro's database write them (No-Intro's: "Legend of Zelda, The
// (USA) (Rev 1)"), made into what people call the game, matched up, and turned into where its pictures
// are. The office's server matches with these (src/server/retro-db.ts) and the page shows them.
import type { RetroSystem } from './retro.js';

/** A name without its tags, the bits in brackets: "Legend of Zelda, The (USA) (Rev 1)" is "Legend of Zelda, The". */
export function baseTitle(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Legend of Zelda, The" is "The Legend of Zelda" (and the same for "A" and "An"). */
function articleFirst(part: string): string {
  const m = /^(.*), (The|A|An)$/i.exec(part);
  return m ? `${m[2]} ${m[1]}` : part;
}

/**
 * The game's title as people say it: "Legend of Zelda, The - A Link to the Past (USA)" is "The Legend
 * of Zelda: A Link to the Past".
 */
export function prettyTitle(name: string): string {
  const base = baseTitle(name);
  if (!base) return name.trim();
  const parts = base
    .split(' - ')
    .map((part) => articleFirst(part.trim()))
    .filter(Boolean);
  // "Pitfall! - Pitfall Harry's…" reads "Pitfall! Pitfall Harry's…", not "Pitfall!: …".
  return parts.reduce((title, part) => `${title}${/[!?:]$/.test(title) ? ' ' : ': '}${part}`);
}

/** What a game is filed under: its title without "The" or "A" first, so The Legend of Zelda is with the Ls. */
export function sortTitle(title: string): string {
  return title.replace(/^(the|a|an)\s+/i, '').toLowerCase();
}

/** Two games by title, the way a shelf of them is. */
export function byTitle(a: { title: string }, b: { title: string }): number {
  return sortTitle(a.title).localeCompare(sortTitle(b.title), undefined, { numeric: true });
}

/**
 * What every name of the same game comes down to, to match one to another: "The Legend of Zelda.nes",
 * "Legend of Zelda, The (USA)" and "legend_of_zelda" are all "legendofzelda".
 */
export function titleKey(name: string): string {
  return baseTitle(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/,\s*(the|a|an)\b/g, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

const REGIONS = /\b(USA|Europe|Japan|World|Asia|Korea|China|Taiwan|Hong Kong|Brazil|Australia|Canada|Germany|France|Spain|Italy|Netherlands|Sweden|Scandinavia|UK)\b/;

/** Where the game was sold, from its first tag that says: "USA", "Japan, USA", "Europe". */
export function regionOf(name: string): string | undefined {
  for (const m of name.matchAll(/\(([^)]*)\)/g)) if (REGIONS.test(m[1])) return m[1];
  return undefined;
}

/** How likely a name is the one people mean: lower is likelier. The USA's or the world's, not a demo or a beta. */
export function nameRank(name: string): number {
  const region = regionOf(name) ?? '';
  let rank = /USA|World/.test(region) ? 0 : /Europe/.test(region) ? 2 : /Japan/.test(region) ? 4 : 3;
  if (/\((?:[^)]*\b)?(Beta|Proto|Demo|Sample|Pirate|Hack|Unl|Aftermarket|Kiosk|Virtual Console|Collection|Promo|Debug)\b/i.test(name)) rank += 6;
  if (/\(Rev [^)]*\)/.test(name)) rank += 1;
  return rank;
}

/** Where libretro keeps its pictures of games, one GitHub repository a console's list. */
const THUMBS = 'https://raw.githubusercontent.com/libretro-thumbnails';

/** A game's pictures, the likeliest first: its box, its title screen, and a shot of it playing. */
export function thumbUrls(db: string, name: string): string[] {
  const repo = encodeURIComponent(db.replace(/ /g, '_'));
  // The file names swap the characters a file name can't have for _ (as RetroArch does).
  const file = `${encodeURIComponent(name.replace(/[&*/:`<>?\\|"]/g, '_'))}.png`;
  return ['Named_Boxarts', 'Named_Titles', 'Named_Snaps'].map((kind) => `${THUMBS}/${repo}/master/${kind}/${file}`);
}

/** What folders of games for each console tend to be called, the ones one name could be mistaken for first. */
const FOLDERS: readonly [RetroSystem, RegExp][] = [
  ['snes', /\b(snes|sfc|super nintendo|super famicom)\b/],
  ['n64', /\b(n64|nintendo 64)\b/],
  ['gba', /\b(gba|game ?boy advance)\b/],
  ['gb', /\b(gbc?|game ?boy( colou?r)?)\b/],
  ['nds', /\b(nds|nintendo ds)\b/],
  ['vb', /\b(vb|virtual ?boy)\b/],
  ['s32x', /\b(32x)\b/],
  ['genesis', /\b(genesis|mega ?drive|md|smd)\b/],
  ['sms', /\b(sms|master ?system|mark iii)\b/],
  ['gg', /\b(gg|game ?gear)\b/],
  ['atari7800', /\b(7800|a78)\b/],
  ['atari2600', /\b(2600|a26|vcs)\b/],
  ['jaguar', /\b(jaguar)\b/],
  ['pce', /\b(pce|pc ?engine|turbografx|tg-?16)\b/],
  ['ngp', /\b(ngpc?|neo ?geo pocket)\b/],
  ['ws', /\b(wsc?|wonderswan)\b/],
  ['nes', /\b(nes|famicom|nintendo entertainment system)\b/],
];

/**
 * The console the folders a file is in say it's for ("ROMs/SNES/…", "Sega - Mega Drive - Genesis/…"),
 * the nearest folder first, or null when none does.
 */
export function systemFromPath(filePath: string): RetroSystem | null {
  const folders = filePath.split(/[/\\]/).slice(0, -1).reverse();
  for (const folder of folders) {
    const f = folder.toLowerCase().replace(/[_.]+/g, ' ');
    for (const [id, re] of FOLDERS) if (re.test(f)) return id;
  }
  return null;
}
