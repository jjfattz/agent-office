// The games the boss's computer comes with: homebrew made for these consoles by their authors, which
// the Retrobrews project (github.com/retrobrews) hands out with their permission. The office doesn't
// copy them: the page loads each one from Retrobrews' own collection, pinned to a commit so a game is
// always the same file. They're all games of their own, not copies or ports of someone else's.
import type { RetroSystem } from '../../../shared/retro';

export interface CatalogGame {
  system: RetroSystem;
  /** Its file in that console's collection. Its picture is the .png of the same name. */
  file: string;
  title: string;
  by: string;
  year: number;
  genre: string;
  /** How many can play at once. */
  players: number;
  blurb: string;
}

/** Each console's collection, and the commit it's pinned to. */
export const COLLECTIONS: Partial<Record<RetroSystem, { repo: string; commit: string }>> = {
  nes: { repo: 'retrobrews/nes-games', commit: 'd20061bf9917e8bb8b947d4dba8c59372f5762a0' },
  snes: { repo: 'retrobrews/snes-games', commit: '2329cb432b4cad13aa6a9d2ad0699c771780b378' },
  genesis: { repo: 'retrobrews/md-games', commit: '69799854cb357a252ff5eda173381feb5e81aac5' },
  sms: { repo: 'retrobrews/sms-games', commit: '81fb3d1b9d435eb5af930e3ac2bc39de1fdcb730' },
  gb: { repo: 'retrobrews/gbc-games', commit: 'a23861c19f1b4d1eeea129879f3a30b709f1f48f' },
  gba: { repo: 'retrobrews/gba-games', commit: 'add86969f1a7a3b9534822a9a015d05ed20a0dcf' },
  atari2600: { repo: 'retrobrews/atari2600-games', commit: '0e16f397027ebb5d3be204c90efff169419ba5f8' },
};

/** Where a file of a console's collection is: GitHub's raw files, which any page may fetch. */
export function collectionUrl(system: RetroSystem, file: string): string {
  const c = COLLECTIONS[system];
  if (!c) throw new Error(`No collection for ${system}`);
  return `https://raw.githubusercontent.com/${c.repo}/${c.commit}/${encodeURIComponent(file)}`;
}

/** A game's picture: the screenshot that comes with it. */
export function artUrl(g: CatalogGame): string {
  return collectionUrl(g.system, `${g.file.replace(/\.[^.]+$/, '')}.png`);
}

const g = (system: RetroSystem, file: string, title: string, by: string, year: number, genre: string, players: number, blurb: string): CatalogGame => ({ system, file, title, by, year, genre, players, blurb });

export const CATALOG: readonly CatalogGame[] = [
  // ---- NES -----------------------------------------------------------------------------------------
  g('nes', 'novathesquirrel.nes', 'Nova the Squirrel', 'NovaSquirrel', 2018, 'Platformer', 1, 'A green squirrel lands in a strange world and copies the powers of whatever she defeats to get home.'),
  g('nes', 'twindragons.nes', 'Twin Dragons', 'Antoine Gohin', 2017, 'Platformer', 1, 'One of the twin dragons has been kidnapped, and the other stomps, swims and flies to the rescue.'),
  g('nes', 'owlia.nes', 'The Legends of Owlia', 'Gradual Games', 2016, 'Adventure', 1, 'A top-down quest across islands and dungeons to stop the King of the Mermen.'),
  g('nes', 'nomolos.nes', 'Nomolos: Storming the Catsle', 'Gradual Games', 2014, 'Action', 1, 'A knightly cat follows his kidnapped friend through a portal and fights his way up the castle.'),
  g('nes', 'super-tilt-bro.nes', 'Super Tilt Bro.', 'Sylvain Gadrat', 2018, 'Fighting', 2, 'A platform fighter: knock your friend (or the computer) off the stage.'),
  g('nes', 'thwaite.nes', 'Thwaite', 'Damian Yerrick', 2011, 'Arcade', 1, 'Missiles are falling on the village. Aim your fireworks and burst them in the sky before they land.'),
  g('nes', 'driar.nes', 'Driar', 'Adolfsson & Eriksson', 2012, 'Platformer', 1, 'Hop round each little world and grab every star to open the way on.'),
  g('nes', 'lunarlimit.nes', 'Lunar Limit', 'Pubby', 2017, 'Shooter', 1, 'An 80s-style arcade shooter where you guard a tiny planet Earth from waves of invaders.'),
  g('nes', 'superuwol.nes', 'Super Uwol', 'The Mojon Twins', 2016, 'Platformer', 2, 'Someone stole Uwol\'s savings. Leap through 45 rooms of a haunted house to collect the coins.'),
  g('nes', 'cheril-the-goddess.nes', 'Cheril the Goddess', 'The Mojon Twins', 2017, 'Adventure', 1, 'Explore a big map, open three gates and claim the skull that will make Cheril a goddess.'),
  g('nes', 'roboninjaclimb.nes', 'Robo-Ninja Climb', 'Nathan Tolbert', 2017, 'Arcade', 1, 'Wall-jump up an endless tower, dodging spikes on the way. One button, very hard to put down.'),
  g('nes', 'spaceymcracey.nes', 'Spacey McRacey', 'Nathan Tolbert', 2017, 'Party', 4, 'A four-player space race: stay in front and keep everyone else off the screen.'),
  g('nes', 'tigerjenny.nes', 'Tiger Jenny', 'Ludosity', 2014, 'Action', 1, 'A tiger warrior cuts her way through the forest to take revenge.'),
  g('nes', 'vigilanteninja.nes', 'Vigilante Ninja', 'Dougeff', 2015, 'Action', 1, 'Punch, jump and throw stars through four levels of bullets, spikes and bosses.'),
  g('nes', 'croom.nes', 'Concentration Room', 'Damian Yerrick', 2018, 'Puzzle', 2, 'Quarantined after a lab accident, you keep your wits by matching pairs of cards.'),
  g('nes', 'rhde.nes', 'RHDE: Furniture Fight', 'Damian Yerrick', 2014, 'Strategy', 2, 'Build up your house, then break into the neighbor\'s and steal their furniture.'),
  g('nes', 'megamountain.nes', 'Mega Mountain', 'AdrianMakesGames & Damian Yerrick', 2018, 'Platformer', 1, 'Your best friend was carried off to the top of Mega Mountain. Climb it.'),
  g('nes', 'fff.nes', 'F-FF', 'Pubby', 2018, 'Racing', 2, 'A fast little racer, with split screen for two.'),
  g('nes', 'yun.nes', 'Yun', 'The Mojon Twins', 2018, 'Platformer', 1, 'Stun every creature on the screen and catch them to stock Yun\'s restaurant pantry.'),

  // ---- Super Nintendo --------------------------------------------------------------------------------
  g('snes', 'superbossgaiden.sfc', 'Super Boss Gaiden', 'Chrono Moogle & D4S', 2016, 'Platformer', 1, 'A tight, funny 16-bit platformer with a lot of jumping and a lot of dying.'),
  g('snes', 'hilda.sfc', 'Hilda', 'O_manko', 2016, 'RPG', 1, 'A young princess who lost her family in the war sets out to find her missing sister.'),
  g('snes', 'tchouv2.smc', 'Tchou 2', 'Matthieu Debray', 2012, 'Shooter', 1, 'A big-eared green alien wins a spaceship in the lottery and flies straight into an octopus invasion.'),
  g('snes', 'questformoney.sfc', 'Uwol: Quest for Money', 'Alekmaul, The Mojon Twins & KungfuFurby', 2012, 'Platformer', 1, 'Uwol hops through a house of ghosts to win back his money, now in 16 bits.'),
  g('snes', 'saf.smc', 'Skipp and Friends', 'Mukunda Johnson & friends', 2009, 'Puzzle', 1, 'Get all three friends to the exit, each with their own limited special moves.'),
  g('snes', 'bucket.smc', 'Bucket', 'Sebastian Mihai', 2012, 'Puzzle', 1, 'Hugz the polar bear has buckets to deliver to some very grumpy walruses.'),
  g('snes', 'jetpilotrising.sfc', 'Jet Pilot Rising', 'D4S', 2008, 'Arcade', 1, 'A one-button game about a cat riding a rocket.'),
  g('snes', 'nwarpdaisakusen.smc', 'N-Warp Daisakusen', 'D4S', 2009, 'Party', 8, 'A deathmatch for up to eight players at once.'),
  g('snes', 'blt.sfc', 'BLT', 'Charles Doty', 2012, 'Shooter', 1, 'A vertical shooter. With bacon.'),
  g('snes', 'astrohawk.smc', 'Astrohawk', 'Paul Lay', 2003, 'Shooter', 1, 'Turn, thrust and blast through fields of drifting space rocks.'),
  g('snes', 'rockfall.smc', 'Rockfall', 'Paul Lay & Harvey A. Kong Tin', 1998, 'Puzzle', 1, 'Dig through the maze without letting the boulders come down on you.'),

  // ---- Genesis ---------------------------------------------------------------------------------------
  g('genesis', 'oldtowers.bin', 'Old Towers', 'RetroSouls', 2019, 'Puzzle', 1, 'A tiny explorer climbs towers full of traps and skulls, one screen at a time.'),
  g('genesis', 'miniplanets.bin', 'Miniplanets', 'Sik', 2018, 'Platformer', 1, 'Run round tiny planets whose paths wrap all the way around, collecting keys.'),
  g('genesis', 'xump2.bin', 'Xump 2: Back in Space', 'Retroguru', 2017, 'Puzzle', 1, 'Clear every crumbling tile on the board without getting stranded.'),
  g('genesis', 'mega-cheril-perils.bin', 'Mega Cheril Perils', 'The Mojon Twins', 2017, 'Platformer', 1, 'Cheril jumps on zombies to clean up the streets.'),
  g('genesis', 'dragonscastle.bin', 'Dragon\'s Castle', 'Sik', 2016, 'Platformer', 1, 'Fight your way through the castle with sword and magic.'),
  g('genesis', 'starchaser.bin', 'Star Chaser', 'Sik', 2015, 'Arcade', 1, 'Zoom round the maze and grab the stars before the other balls do.'),
  g('genesis', 'projectmd.bin', 'Project MD', 'Sik', 2012, 'Platformer', 1, 'Stephany finds everyday life boring, so she builds a virtual world to play in.'),
  g('genesis', 'grielsquest.bin', 'Griel\'s Quest for the Holy Porrón', 'MoonWatcherMD', 2018, 'Puzzle', 1, 'A knight solves room after room of block puzzles on his way to the Holy Porrón.'),
  g('genesis', 'papicommandoremix.bin', 'Papi Commando (Remix)', 'Studio Vetea', 2016, 'Shooter', 2, 'Run and gun through eleven zones of the enemy base camp.'),
  g('genesis', 'radrhino.bin', 'Rad Rhino', 'Triger Mountain', 2018, 'Shooter', 2, 'The last rhino and a bird take back what\'s left of the wild. Two can play.'),
  g('genesis', 'tgunii.smd', 'T-Gun II', 'Robot Urchin', 2015, 'Shooter', 1, 'Two metal hawks defend a bird sanctuary planet.'),
  g('genesis', 'vilqadventure.bin', 'VilQ Adventure', 'AceMan, Axi0maT & Koyot1222', 2017, 'Platformer', 1, 'A cute non-stop side-scroller: jump, run and slide.'),
  g('genesis', 'gravitypig.bin', 'Gravity Pig', 'ComradeOj', 2015, 'Platformer', 1, 'A pig that can\'t jump, but can flip gravity. Fifteen stages and a boss.'),
  g('genesis', 'breakanegg.bin', 'Break an Egg', 'Dr. Ludos', 2018, 'Arcade', 1, 'Eggs are falling. Move your chicken to bounce them into the nest.'),
  g('genesis', 'bareknuckleprincesss.bin', 'Bare Knuckled Princess', 'OhCarson', 2016, 'Fighting', 1, 'Princess Linear settles an insult the old-fashioned way.'),
  g('genesis', 'scorpionilluminati.bin', 'Scorpion Illuminati', 'MoonWatcherMD', 2015, 'Rhythm', 1, 'Hit the notes in time as they scroll down the highway.'),
  g('genesis', 'pingouinrose.bin', 'Pingouin Rose', 'DjCouchyCouch', 2014, 'Platformer', 1, 'Bring the lost stuffed penguins back home.'),
  g('genesis', 'twocyclops.bin', 'Two Cyclops', 'Nemezes Games', 2018, 'Platformer', 2, 'Jump past the obstacles and find the flag, alone or with a friend.'),

  // ---- Master System ---------------------------------------------------------------------------------
  g('sms', 'kunkunkokokun.sms', 'KunKun & KokoKun', 'Omar Cornut', 2006, 'Platformer', 1, 'Cute, short and unforgiving, in the style of old arcade games.'),
  g('sms', 'kunkunkokokun2.sms', 'KunKun & KokoKun 2', 'Omar Cornut', 2011, 'Platformer', 1, 'Return of the Kun: more cute, more unforgiving.'),
  g('sms', 'baraburu.sms', 'Bara Buru', 'Kagesan', 2016, 'Action', 2, 'Two ninjas climb thirty levels of a mysterious tower.'),
  g('sms', 'astroforce.sms', 'Astro Force', 'Enrique Ruiz', 2017, 'Shooter', 1, 'Six stages, each with its own music, enemies and boss.'),
  g('sms', 'silvervalley.sms', 'Silver Valley', 'Enrique Ruiz', 2017, 'Action', 1, 'Sixty-four stages between you and the dragon.'),
  g('sms', 'galacticrevenge.sms', 'Galactic Revenge', 'Enrique Ruiz', 2018, 'Shooter', 1, 'Aliens emptied your fridge. Revenge is a shoot \'em up.'),
  g('sms', 'waimanu.sms', 'Waimanu', 'Disjointed Studio', 2015, 'Puzzle', 1, 'A little blue penguin squashes the jelly invaders with blocks.'),
  g('sms', 'wekainvaders.sms', 'Weka Invaders', 'Disjointed Studio', 2017, 'Shooter', 1, 'The jelly aliens are back, in waves this time.'),
  g('sms', 'breadandbutter.sms', 'Bread and Butter', 'Dragonfeet', 2013, 'Arcade', 1, 'Run, jump and climb in a single-screen arcade scramble.'),
  g('sms', 'porkpolis.sms', 'Porkpolis', 'Dragonfeet', 2014, 'Shooter', 1, 'A flying pig sets out from the city of flying pigs to explore.'),
  g('sms', 'duckslayeradventures.sms', 'Duckslayer Adventures', 'Haroldo Pinheiro', 2018, 'Adventure', 1, 'Sir Jelly, Knight of the Square Table, goes questing.'),
  g('sms', 'astroswab.sms', 'Astroswab', 'Hang-on', 2018, 'Shooter', 1, 'Giant flaming rocks are falling out of the sky. Clean them up.'),
  g('sms', 'moggymaster.sms', 'Moggy Master', 'The Mojon Twins', 2015, 'Puzzle', 2, 'Gather your pink friends on each screen without touching the bushes.'),
  g('sms', 'cix.sms', 'Cix', 'PkK', 2016, 'Arcade', 2, 'Claim most of the field with your lines, alone or with a friend.'),
  g('sms', 'swordstrike.sms', 'Sword Strike', 'Dragonfeet', 2016, 'Action', 1, 'A knight\'s midnight raid through a passage into the enemy castle.'),

  // ---- Game Boy --------------------------------------------------------------------------------------
  g('gb', 'ucity.gbc', 'µCity', 'Antonio Niño Díaz', 2018, 'Strategy', 1, 'Build a city: zone it, power it and keep its people happy.'),
  g('gb', 'geometrix.gbc', 'Geometrix', 'Antonio Niño Díaz', 2015, 'Puzzle', 1, 'Line up three or more of the same shape to clear them.'),
  g('gb', 'burly.gbc', 'Burly Bear vs. the Mean Foxes', 'Sebastian Mihai', 2012, 'Action', 1, 'Swipe at foxes, eat cookies, move on.'),
  g('gb', 'blastah.gb', 'Blastah', 'Black Box', 2001, 'Shooter', 1, 'A quick, silly little shoot \'em up.'),
  g('gb', 'combatsoccer.gbc', 'Combat Soccer', 'Mike Kasprzak', 1999, 'Sports', 1, 'Something like soccer. First to 20 wins.'),
  g('gb', 'brickster.gbc', 'Brickster', 'Stephane Hockenhull', 1999, 'Arcade', 1, 'Bounce the ball and knock the bricks down.'),
  g('gb', 'klondike.gbc', 'Klondike', 'Harold Toler', 2001, 'Cards', 1, 'Solitaire, for those long builds.'),

  // ---- Game Boy Advance ------------------------------------------------------------------------------
  g('gba', 'goodboyadvance.gba', 'Goodboy Advance', 'Exelotl', 2018, 'Platformer', 1, 'A short exploration platformer about a dog and his red rocket.'),
  g('gba', 'anguna.gba', 'Anguna', 'Nathan Tolbert', 2008, 'Adventure', 1, 'Swords, bows, traps and dungeons in a top-down action adventure.'),
  g('gba', 'metalwarrior4.gba', 'Metal Warrior 4', 'Covert Bitops', 2007, 'Action', 1, 'Agents of Metal: a thrash metal band takes on a dystopian near future.'),
  g('gba', 'blastarenaadvance.gba', 'Blast Arena Advance', 'Mathew Carr', 2005, 'Shooter', 1, 'A slick abstract arena shooter.'),
  g('gba', 'superwings.gba', 'Super Wings', 'Mukunda Johnson', 2008, 'Shooter', 1, 'Steer your jet through the flashy bullets and shoot back.'),
  g('gba', 'powerpig.gba', 'Power Pig', 'Genecyst', 2013, 'Platformer', 1, 'A pig with a gravity gun takes on the animals.'),
  g('gba', 'awerewolftale.gba', 'A Werewolf Tale', 'Genecyst', 2012, 'Platformer', 1, 'A werewolf with big jumps clears the castle, level by level.'),
  g('gba', 'holyhell.gba', 'Holy Hell', 'Genecyst', 2010, 'Puzzle', 1, 'A puzzle game with a shoot \'em up streak: chain the blocks to the end.'),
  g('gba', 'waimanu.gba', 'Waimanu: Grinding Blocks', 'Sverx', 2013, 'Puzzle', 1, 'Push blocks into your enemies across 32 levels.'),
  g('gba', 'santassweatshop.gba', 'Santa\'s Sweatshop', 'Sumiguchi', 2006, 'Puzzle', 1, 'Keep up with the toys on Santa\'s production line.'),
  g('gba', 'wonkieguy.gba', 'Wonkie Guy', 'Sean Reid', 2003, 'Platformer', 1, 'A competition-winning little side-scroller.'),
  g('gba', 'negativespace.gba', 'Negative Space', 'Gener Gabasa & Mia', 2008, 'Puzzle', 1, 'A platformer about the space between things.'),
  g('gba', 'codenamehacker.gba', 'Codename: Hacker', 'Alekmaul, Lobo & Daydream', 2007, 'Action', 1, 'Collect the chips and slip past the guards.'),
  g('gba', 'factorybots.gba', 'Factory Bots', 'Nicholas Scheltema', 2009, 'Puzzle', 1, 'Steer the factory robots to get raw material where it needs to go.'),

  // ---- Atari 2600 ------------------------------------------------------------------------------------
  g('atari2600', 'anguna.bin', 'Anguna 2600', 'Nathan Tolbert', 2016, 'Adventure', 1, 'An overworld, five dungeons and the Goblin King, on a 2600.'),
  g('atari2600', 'bitquest.bin', 'Bit Quest', 'Brian W. Shea', 2017, 'Adventure', 1, 'A bit knight sets out to rescue the princess of the bits.'),
  g('atari2600', 'bitquest2.bin', 'Bit Quest II', 'Brian W. Shea', 2019, 'Adventure', 1, 'Now the knight is the one locked up.'),
  g('atari2600', 'stardust.bin', 'Stardust', 'Brian W. Shea', 2018, 'Shooter', 1, 'Explore the galaxy, zap aliens and take on the Dark Queen.'),
  g('atari2600', 'sandcastles.bin', 'Sand Castles', 'Brian W. Shea', 2017, 'Platformer', 1, 'Jump and shoot to clear each level before the reaper comes.'),
  g('atari2600', 'fishy.bin', 'Fishy', 'Brian W. Shea', 2017, 'Arcade', 2, 'Two fish, power-ups, first to five.'),
  g('atari2600', 'nanowing.bin', 'NanoWing 2600', 'Brian W. Shea', 2017, 'Arcade', 1, 'Hurtle through hyperspace and miss everything in the way.'),
  g('atari2600', 'hauntedbakery.bin', 'The Haunted Bakery', 'Denebola Interactive', 2018, 'Adventure', 1, 'Emelie the giraffe and Maxwell the crocodile investigate a haunted bakery.'),
  g('atari2600', 'kellykangaroo.bin', 'Kelly Kangaroo', 'Denebola Interactive', 2018, 'Platformer', 1, 'A mad scientist broke up Kelly\'s picnic. Hop after him.'),
  g('atari2600', 'winterfortress.bin', 'Winter Fortress', 'Denebola Interactive', 2018, 'Action', 1, 'Roll snowballs through the ruins to rescue six lost penguin chicks.'),
  g('atari2600', 'roboninjaclimb.bin', 'Robo-Ninja Climb', 'Nathan Tolbert', 2017, 'Arcade', 1, 'The wall-jumping tower climb, on the 2600.'),
  g('atari2600', 'solarplexus.bin', 'Solar Plexus', 'Jess Ragan', 2005, 'Shooter', 1, 'A routine salvage run at the edge of the galaxy turns into a fight to survive.'),
  g('atari2600', 'jammed.bin', 'Jammed', 'Thomas Jentzsch', 2002, 'Puzzle', 1, 'Shuffle the other cars out of the lot to get yours out. 600 puzzles.'),
];
