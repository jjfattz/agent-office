# The arcade

Back to the [README](../README.md).

Workers take minutes, so there's an arcade cabinet in the lounge, next to the jukebox. Press **E** at it and the camera glides up to its screen, where a menu lists its games: **↑ ↓** (or the mouse) pick one, and **Enter** (or a click) plays it.

- **Watching.** Everyone else on your floor sees your game on the cabinet as you play, and hears it. Anyone can walk up and press **E** to watch it up close over your shoulder.
- **Your workers come first.** When one of your workers needs input, your game pauses and says which one, with a button to its terminal.
- **Stepping away.** **M** (or **☰ Games**) goes back to the menu, and **✕** or **Esc** walks away from the cabinet. Either way your game waits, paused, until you come back to it.
- **High scores.** Each game has its own high-score table of the top 10, the whole building's. The cabinet shows them in turn while nobody's playing, and they survive restarts (see [High scores](#high-scores)).

## The games

On every game **P** pauses (and carries on), **Enter** plays again once it's over, and **M** goes back to the menu.

| Game | What it is | Keys |
| --- | --- | --- |
| **BLOCKFALL** | Falling blocks. Turn and drop them to clear lines. | **← →** move, **↑** turn (**Z** the other way), **↓** faster, **Space** drop, **C** hold |
| **BUGSWARM** | A fixed shooter. A swarm of bugs flies in, settles into rows and dives at your ship. | **← →** move, **Space** fire |
| **BRICKBUST** | A brick-breaker. Bounce the ball off your paddle and knock the wall down. | **← →** move, **Space** launch the ball |
| **DUSTBOT** | A maze chase. Hoover every crumb off the office floor before the office cats get you. | **← ↑ → ↓** steer |

WASD works in place of the arrows in all of them.

### BLOCKFALL

- Pieces turn the usual way, with wall kicks, and come from a bag of all seven at a time.
- **C** puts the falling piece on hold for later.
- A ghost shows where the falling piece will land.
- Clearing 1 to 4 lines at once scores 100, 300, 500 or 800, times the level. The level goes up every ten lines, and so does the speed.

### BUGSWARM

- Each wave of 36 bugs flies in along looping paths, a few at a time, and settles into rows that sway over the field.
- Bugs then dive at your ship in ones and twos, stinging as they come.
- Gnats and wasps take one hit, and beetles take two. Every bug is worth more shot on the wing than sitting in the swarm.
- Shoot the whole wave down and the next one comes in, a little quicker.
- You start with three ships, and get another every 10,000 points, up to five.

### BRICKBUST

- Where the ball lands on your paddle says which way it goes back up: straight off the middle, and at a slant off the ends.
- Colored bricks break in one hit, hard ones take two, and steel ones never break.
- Now and then a brick drops a pill. Catch it on your paddle for:
  - a wider paddle
  - three balls
  - a slower ball
  - a ball to spare
- Knock a wall down for a bonus, and the next one goes up with the ball a little quicker. After eight walls they come round again, with more hard bricks.

### DUSTBOT

You're the office's robot vacuum, out on a floor of desks after hours, hoovering up every crumb. The office cats hunt you, each in its own way:

| Cat | How it hunts |
| --- | --- |
| **Ginger** | Walks the shortest way to you |
| **Smoke** | Heads for where you're going, a few tiles ahead of you |
| **Patch** | Guards its corner until you come within a few tiles, then comes for you |
| **Snowball** | Naps a few seconds, then dashes after you |

- Every so often the cats all get distracted (a **?** over each) and wander for a moment.
- The vacuum keeps going until it hits a desk. Press a direction early and it turns there as soon as it can. Press the way you came and it turns straight round.
- The corridor off each side of the floor comes back in on the other.
- **Batteries.** There's one in each corner. Catch one and the vacuum roars: every cat turns tail, slow and scared, and any you catch runs back to its bed. They score 250, 500, 750 and 1,000 for each in a row on one battery. Scared cats flash when they're about to get over it.
- **Donuts.** Twice a floor a donut turns up in the middle, for a while. It's worth more on each floor.
- Clean the floor and the next one goes down, everything a little quicker.
- You start with three vacuums, and get another every 10,000 points, up to five.

## High scores

The tables are saved in the office's data folder, in `.agent-office/arcade.json`. Each table keeps a game's top 10.

A browser can't just post a score: the office follows every game frame by frame (`src/server/games/`), and a game with a frame that doesn't add up never goes on the table. What each game's referee checks:

- **BLOCKFALL:** lines can't outrun the pieces landed, the score can't pass what those lines and drops could be worth, and pieces can't land faster than anyone can play.
- **BUGSWARM:** waves only go on once every bug in them is shot down, the score can't pass what those bugs are worth on the wing, and waves can't pass faster than they fly in.
- **BRICKBUST:** the bricks still standing must be ones that level's wall has, the bricks counted must be the ones gone, and bricks can't come down faster than a multi-ball knocks them.
- **DUSTBOT:** what's left on the floor must be crumbs and batteries the maze has, what's counted must be what's gone, and the vacuum can't hoover faster than it moves.

Starting more than three new games in a row, faster than one every 20 seconds, still plays, but the extra games never go on a table.

## Adding a game

A game is three modules and a line in each of three lists. The typecheck fails until it's in all of them.

1. **`src/shared/games/<game>.ts`.** Its frame (what its screen shows while someone plays) and `check<Game>Frame`, which checks a frame a browser sent. Put anything the office needs to referee it here too: BRICKBUST's walls, DUSTBOT's maze, the scoring.
2. **`src/server/games/<game>.ts`.** Its `Referee` (see `referee.ts`):
   - `follow` says whether a frame adds up after the last one.
   - `burst` and `perSecond` say how fast a player can go at it, counted in whatever `follow` counts (pieces, waves, bricks, crumbs).
3. **`src/client/features/cabinet/<game>.ts` and `<game>-paint.ts`.** The game itself is a `CabinetGame`. Its `Cartridge` holds:
   - its keys, the tip under the screen, its blurb and colors for the menu
   - `paint`, which draws a frame in the screen's 800×600 units
   - `hear`, what someone watching hears
   - `icon`, its picture on the menu card
4. **The lists:**
   - `TITLES`, `GAME_NAMES`, `CHECKS` and `CabinetFrame` in `src/shared/cabinet.ts`
   - `REFEREES` in `src/server/games/index.ts`
   - `CARTS` in `src/client/features/cabinet/games.ts`
5. **New sounds.** Add to `ArcadeSound` in `cart.ts`, with the recipe in `sound.ts`.
6. **Tests.** `tests/<game>.test.ts` covers checking its frames and its rules. It also has a bot play whole games while the office follows every frame, so the referee never voids an honest game, plus forged frames that never make the table. `tests/bugswarm.test.ts` and `tests/client-store.test.ts` list every game's empty table.
7. **Docs.** This page, the arcade line in [Features](features.md), and the arcade row in `HELP_ROWS` (`src/client/ui/help.ts`).

Make it a game of its own: a genre or mechanics anyone can use, but not another game's name, characters, art, music or levels.

## Games we could add next

Each of these fits the cabinet: one player at the keys, everyone else watching, and a score the office can bound.

- **CABLE RUN.** Snake-style: a network cable snaking round the server room, plugging into ports and growing with each one. It's small. Ports plugged can't outpace the cable's steps a second.
- **COMMUTE.** An endless runner: jump and duck past what's in the way on the way into the office. The easiest to referee, since distance can't pass time × top speed.
- **SPACE JUNK.** A rock-field shooter: turn, thrust and fire, with rocks splitting as they break. Each field has a fixed number of rocks, so it can be refereed like BUGSWARM's waves.
- **COFFEE RUN.** Lane crossing: hop across lanes of rolling chairs and mail carts to the coffee machine. Crossings can't come faster than the hops take.
- **SOFT LANDING.** A lander: thrust against gravity and set down gently on the pads before the fuel runs out. Landings a minute are bounded by the fall.
- **FIREWALL.** Base defense: steer a crosshair and burst incoming packets before they hit your servers. Each wave has a fixed number of packets.
