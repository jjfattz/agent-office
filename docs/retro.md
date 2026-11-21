# The boss's computer

Back to the [README](../README.md).

The computer on the boss's desk, up in the boss office on the loft, plays retro games: the NES, the Super Nintendo, the Genesis, the Master System, the Game Boy, the Game Boy Advance, the Atari 2600 and more. Sit in the boss's chair and press **E**. The camera glides up to the monitor and its library opens right on the screen.

## The library

The consoles run down the side, with how many games each has, and the games show as cards with a picture of each: your own games first, by name, with their boxes, then the homebrew the computer comes with. **★ All games** lists everything, **⏱ Played lately** lists what you played last, and the collections are **📁 Office shelf** (the office's games), **💾 This browser** (the ones you added) and **🎁 Homebrew** (the ones it comes with).

- **← → ↑ ↓** pick a game, **Enter** (or a double-click) plays it, and **/** jumps to the search, which looks through titles, file names, makers, publishers, genres and consoles.
- The panel on the right tells you about the game you picked: who made it and who published it, when, where it's from, what kind of game it is and how many can play. It has **▶ Play**, or **▶ Continue** and **↺ Start over** for a game you've played before, and your own saves of it.
- **＋ Add games** adds games of your own (see [Your own games](#your-own-games)), and so does dropping game files anywhere on the screen.

## Playing

The game fills the monitor's screen. Under it, the bar says what you're playing and its keys, and has **☰ Games** (back to the library, with the game paused), **💾 Save** and **📂 Load**.

| Keys | Does |
| --- | --- |
| **← ↑ → ↓** | The D-pad |
| **X** and **Z** | A and B (on the Genesis, **A Z X** are its A B C; on the Master System, **Z** and **X** are 1 and 2; on the Atari 2600, **Z** fires) |
| **S** and **A** | X and Y |
| **Q** and **W** | L and R (**E** and **R** are L2 and R2) |
| **Enter** and **Shift** | Start and Select (on the Atari 2600, Reset and Select) |
| **T F G H** and **I J K L** | The left and right analog sticks, for the Nintendo 64 |

A gamepad works as soon as you press one of its buttons. The emulator's own menu (its gear, at the bottom of the game when you move the mouse over it) changes the keys and the gamepad's buttons, the volume, the picture's filters and more, and this browser keeps what you set.

**Esc** or **✕** steps away from the computer, straight back into the office.

## Saving

- **Where you left it.** Stepping away (**✕**, **Esc**, **☰ Games**, or starting another game) pauses the game and keeps where you are in it, and so does every minute you play. Next time, the game's card says **▶ Continue** and picks up right there. Back in the office, the monitor shows you the game you left, paused where you left it.
- **Your own saves.** **💾 Save** keeps a save of where you are, with a picture of it, up to eight a game (a ninth drops the oldest). **📂 Load** picks up from one of them, and so do the saves under a game in the library. The 🗑 next to one deletes it.

Saves are kept in your browser, not in the office: they're yours, and another browser (or a private window) starts afresh.

## Your workers come first

When one of your workers needs input while you play, the game pauses and a bar over the screen says which one, with **💬 Open its terminal** and **▶ Carry on**. It carries on by itself once the worker has what it needs.

## The games it comes with

The computer comes with nearly a hundred games, under **🎁 Homebrew**: homebrew made for these consoles in the last twenty years by the people who made them, who let them be handed out for free. They're from the [Retrobrews](https://github.com/retrobrews) collections, and the page loads each one from Retrobrews' own collection on GitHub, pinned to a commit, so the office never copies them.

| Console | Games | A few of them |
| --- | --- | --- |
| NES | 19 | Nova the Squirrel, Twin Dragons, Super Tilt Bro., Lunar Limit, Cheril the Goddess |
| Super Nintendo | 11 | Super Boss Gaiden, Hilda, Tchou 2, N-Warp Daisakusen |
| Genesis | 18 | Old Towers, Miniplanets, Xump 2, Papi Commando Remix, Bare Knuckled Princess |
| Master System | 15 | Silver Valley, Astro Force, Galactic Revenge, Waimanu |
| Game Boy | 7 | µCity, Geometrix, Burly Bear, Blastah |
| Game Boy Advance | 14 | Goodboy Advance, Anguna, Metal Warrior 4, Blast Arena Advance |
| Atari 2600 | 13 | Anguna 2600, Bit Quest, Stardust, Sand Castles |

They're all games of their own: no copies or ports of anybody else's.

The games you remember from the shops (Super Mario Bros., Sonic the Hedgehog, Pitfall!) aren't here. They still belong to the companies that made them, and only those companies can hand them out, so the office can't come with them, or download them for you. If you own a game, you can play your own copy of it (see [Your own games](#your-own-games)), and the office knows it when it sees it (see [Recognizing your games](#recognizing-your-games)).

## Your own games

There are two ways to add games, each from a game file (a ROM: `.nes`, `.sfc`, `.md`, `.gba` and the rest), and zipped ones work too.

- **Just for you.** **＋ Add games** in the library, with **📄 Choose game files…** or **📁 Choose a folder…** (a whole folder of them, folders in it and all), or game files or folders dropped on the screen. Each goes to the console its file name says, or else the one its folder is named for (`SNES/`, `Genesis/`, `Nintendo - Game Boy Advance/` and the like); pick one for any it can't tell (a `.bin` can be a Genesis or an Atari 2600 game, and a `.zip` could be anything), or one for all of those at once. Files that aren't games are skipped, and so are games you already added. They're kept in your browser, under **💾 This browser**, and **🗑 Remove from this browser** on one takes it out again, with its saves.
- **For everyone in the office.** Put the files on the computer that runs the office, in the folder for their console: `~/agent-office/.agent-office/roms/<console>/` (the office makes the folders the first time anyone opens the library). They show up under **📁 Office shelf** for everyone signed in. The office only reads plain files in those folders, and hands them out only to people who are signed in.

| Console | Its folder | Its files |
| --- | --- | --- |
| NES | `nes` | `.nes` `.unf` `.unif` |
| Super Nintendo | `snes` | `.sfc` `.smc` `.fig` `.swc` |
| Nintendo 64 | `n64` | `.n64` `.z64` `.v64` |
| Game Boy and Game Boy Color | `gb` | `.gb` `.gbc` `.dmg` |
| Game Boy Advance | `gba` | `.gba` `.agb` |
| Nintendo DS | `nds` | `.nds` |
| Virtual Boy | `vb` | `.vb` `.vboy` |
| Genesis | `genesis` | `.md` `.gen` `.smd` `.bin` |
| Master System | `sms` | `.sms` |
| Game Gear | `gg` | `.gg` |
| 32X | `s32x` | `.32x` |
| Atari 2600 | `atari2600` | `.a26` `.bin` |
| Atari 7800 | `atari7800` | `.a78` |
| Atari Jaguar | `jaguar` | `.j64` `.jag` |
| TurboGrafx-16 | `pce` | `.pce` |
| Neo Geo Pocket (Color) | `ngp` | `.ngp` `.ngc` |
| WonderSwan (Color) | `ws` | `.ws` `.wsc` |

Any of them can be a `.zip` or `.7z` too. A game can be up to 512 MB. The Nintendo 64 and the DS are slow on a slow computer. Consoles that need the console's own BIOS to play anything (the PlayStation, the Sega CD, the Atari Lynx and 5200, the ColecoVision, the Famicom Disk System) aren't on the list.

## Recognizing your games

The office looks up each game of yours, on the shelf or in your browser, in the [libretro database](https://github.com/libretro/libretro-database), the lists of games RetroArch uses ([No-Intro](https://no-intro.org)'s list of every cartridge, with each one's year, maker, publisher, genre and players). It shows the game by its proper name, "Legend of Zelda, The - A Link to the Past (USA).sfc" as **The Legend of Zelda: A Link to the Past**, with its year, maker and the rest, and its box from [libretro's thumbnails](https://github.com/libretro-thumbnails) (else its title screen, else a picture of it playing).

- **By what's in it.** A game is looked up by its checksum (CRC-32) first, so a file called `zelda3.smc` is still A Link to the Past, whichever copy it is (with or without the header some NES, Super Nintendo and Atari 7800 copies have). A zipped game's checksum is read from the zip, without unzipping it.
- **Else by its name.** A copy the list doesn't have (a hack, a bad dump) is looked up by its file name: its exact name, then its title, preferring the USA's and the world's over betas and other countries'. The panel says when a game was found by its name, as it could be another version of it.
- **Else by its file name.** A game it doesn't find at all (homebrew of your own) shows by its file's name, with its console's colors for a picture.

The first time the office looks up a console's games, it downloads that console's lists (from raw.githubusercontent.com, pinned to a commit) and keeps them in `~/agent-office/.agent-office/retro-db/`, a few hundred KB to 1 MB a console, so after that it needs nothing more. The library shows your games by their file names until then, and fills in the rest a few seconds later. The shelf's checksums are kept there too, so the office reads each game once. The boxes are downloaded by the browser, from GitHub, each time it shows one (and kept a while). Without the internet, games show by their file names.

## How it works

The games play in [EmulatorJS](https://emulatorjs.org) (version 4.2.3, from its own site), which runs the [libretro](https://www.libretro.com) emulators in the browser. It needs the internet: the page downloads the emulator for a console the first time you play one of its games, and the browser keeps it after that.

EmulatorJS runs in a sandboxed frame with no origin of its own, so it can't see the office's page, its sign-in or its terminals. The office hands it the game and talks to it only in messages: start, pause, save. Its code is in `src/client/features/retro/`, and the office's shelf is `src/server/retro.ts`. Recognizing games is `src/server/retro-db.ts` (the lists), `src/shared/retro-crc.ts` (the checksums, which the browser works out for games you add and sends to the office to look up) and `src/shared/retro-names.ts` (game names, folders and boxes).

## Working on it

What's where, for changing the boss's computer:

| File | What it is |
| --- | --- |
| `src/shared/retro.ts` | The consoles (`RETRO_SYSTEMS`: name, EmulatorJS core, file extensions, color, libretro list names), checking a game file's name, and `RetroMeta`, what the office says a game is. |
| `src/shared/retro-names.ts` | No-Intro names: a game's title (`prettyTitle`), what two names of one game have in common (`titleKey`), its region, which copy to prefer (`nameRank`), its box's address (`thumbUrls`), and a console from a folder's name (`FOLDERS`). |
| `src/shared/retro-crc.ts` | CRC-32 of a game file, with and without a header, and a zip's CRCs from its directory. The server and the browser both use it. |
| `src/server/retro.ts` | The office's shelf: `files()` lists it, `list()` lists it recognized (waiting up to 4 s, then saying `pending`), `open()` hands out a game. |
| `src/server/retro-db.ts` | libretro's lists: downloading, `parseDat`, `buildIndex`, and `RetroDb.identify` (CRC, then name). |
| `src/server/http/routes/retro.ts` | `GET /api/retro/shelf`, `POST /api/retro/identify` (the browser's games), `GET /api/retro/rom`. |
| `src/client/features/retro/` | The page's side: `catalog.ts` (the homebrew), `games.ts` (the library as one list, recognizing, fetching a game), `library.ts` (the library's screen), `add.ts` (＋ Add games), `store.ts` (what the browser keeps), `frame.ts` (the page inside the sandbox), `player.ts` (the frame on the office's page), `monitor.ts` (the monitor in 3D), `ui.ts` (the window). |
| `tests/retro.test.ts`, `tests/retro-recognize.test.ts` | Its tests. |

**Pinned versions.** EmulatorJS is `EJS_VERSION` in `frame.ts`, the homebrew collections are `COLLECTIONS` in `catalog.ts`, and libretro's lists are `LIBRETRO_DB_COMMIT` in `retro-db.ts`. A new list commit is a new folder in `.agent-office/retro-db/`, so offices download the lists again. The boxes aren't pinned (libretro-thumbnails' `master`); `thumbnails.libretro.com` answered 404 for them, so they come from GitHub.

**A new console.** Its row in `RETRO_SYSTEMS` (with its EmulatorJS core and libretro's list names for it, as in `metadat/no-intro/` in libretro-database), its folder names in `FOLDERS` in `retro-names.ts` (more particular ones before the ones they contain: `snes` before `nes`, `gba` before `gb`), and its row in the tables on this page. A console that needs its own BIOS to play anything stays out.

**A new homebrew game.** Its entry in `CATALOG` in `catalog.ts`, from one of the pinned collections, with its maker, year, genre, players and a blurb. The tests check every file is for its console, under a pinned commit, and has a title of its own. Only games their makers let be handed out, and none that are copies or ports of somebody else's. The office never comes with, or downloads, commercial games: people play their own copies, which it recognizes.

**What's easy to break.**
- **The frame stays put.** It lives in `.retro-host` on the page, not in the window, and `place()` lays it over the screen each frame, because moving an iframe in the page reloads it and the game would be gone. Chrome stops drawing a hidden frame from another origin, and EmulatorJS only takes a picture (for a save) as it draws, so a frame being saved stays drawn, see-through, until it's done.
- **Pictures of a paused game.** The bridge in `frame.ts` runs a paused game for a moment to take one, else a save's picture is empty.
- **Focus.** A hidden frame can't take the keyboard, so `focus()` waits for it to be up (`wantsFocus`).
- **Starting another game.** `quit()` takes a game out; `cancel()` also gives up on one still starting. Starting a game cancels the last one, never itself.
- **The sandbox.** The frame has no storage of its own, so its settings come and go in messages, and EmulatorJS's wake lock is stubbed out. Never give it `allow-same-origin`: a test checks.
- **Recognizing.** `identify` gives `undefined` when a console's lists couldn't be loaded and `null` for a game it doesn't know. `pending` means only that it ran out of time, so the library asks again (every 3 s, up to 40 times); a list that couldn't be downloaded isn't asked for again for 10 minutes.

**Trying it.** `scripts/fork/sandbox.sh` (see [The fork](fork.md)), with game files in the sandbox's `.agent-office/roms/<console>/`. A file named like a real game (`Super Metroid.sfc`, even if it's not one) is enough to see it recognized by name, with its box. In a headless browser, sign in, close the welcome windows with Esc, then `window.__office.retro.play()` opens the library and `window.__office.retro.games` lists what's in it, with what each was recognized as (`known`). Chrome needs `--use-angle=swiftshader --enable-unsafe-swiftshader` for the office's 3D, and shows a "running slowly" card that's only the headless GPU.
