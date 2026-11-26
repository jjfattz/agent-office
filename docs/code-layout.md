# Code layout

Back to the [README](../README.md).

Where the code lives, and where a new feature's pieces go. The office used to grow by adding to the middle of a few big files: the server's message switch, the page's key handler, its frame loop and its store. Each of those is a registry now, and a feature is a folder of its own plus one line in each list it joins. If a change has you editing the middle of `main.ts`, `server.ts`, the store or `protocol.ts`, it probably belongs somewhere else.

There are three parts: `src/client` (the page, built by Vite, with three.js), `src/server` (Node) and `src/shared` (types and pure code both use, with no Node imports).

## Client

### `main.ts` and the context

`src/client/main.ts` is the install list: it makes the scene, calls each part's `install…(ctx, …)` in turn, and boots. The order is the order everything registers in (messages, keys, ticks, store topics), and it's kept on purpose, so a new feature's line goes at the end of its group unless it has to come before something.

Every part gets `ctx`: the `Ctx` type in `core/context.ts`, built by `createCtx` in `core/ctx.ts`. It has the scene, the camera, the player, the socket (`net`), sound, settings, what you're holding, the hint bar, `shake`, and the registries. A feature imports `Ctx` as a type and never imports `main.ts` (a test checks). When a part needs another one, it says which: a small `deps` object of callbacks that `main.ts` passes in (`GongDeps` in `features/gong/index.ts`), or a `Pick` of `Parts` (`core/parts.ts`, every part `main.ts` makes, by name). Parts are only read when something happens, never while installing, so a part can reach one installed after it.

### The registries

They're in `core/registry.ts`, and each is a field of `ctx`. Every registration hands back an `Off` that takes it out again.

| Registry | What it's for |
| --- | --- |
| `ctx.messages` | Server messages. `on(type, fn)` runs `fn` once the store has applied the message (`'before'` as a third argument: before it has); `onAny(fn)` runs on every message. |
| `ctx.keys` | Key presses. `add(stage, fn)` for the stages before the office's own keys (`guard`, `activity`, `emote`), and `bind({ code, when, run })` for a key of the office's own. |
| `ctx.ticks` | What runs each frame. `add(phase, fn)`, where the phases run in `TICK_PHASES` order: `pre`, `steer`, `vehicles`, `move`, `moved`, `play`, `me`, `others`, `world`, `env`, `aim`, `hud`, `render`. Within a phase, ticks run in install order. |
| `ctx.activities` | Something you're in the middle of that takes over the controls (a shot on the golf course, the dart board, a car). It gets keys before the office's own, draws the hint bar, and is stopped by `stopAll(why)` when you start something else. Its place among the others is `ACTIVITY_ORDER` in `core/ctx.ts`. |
| `ctx.interactions` | What each kind of thing you can use does: `define(kind, { reach, hint, use })`, once per kind. |
| `ctx.view` | What what you're doing does to your view each frame: something you hold on to, the field of view, covering the screen, or a filter (the drunk vision). |
| `ctx.windowOpened` | What lets go when a window opens (a shot being wound up, the emote wheel). |
| `ctx.usables` | Things to use that aren't part of the building and move about (the pictures, the dog, the ball): what each has to use, and what the aim can land on. |

`tests/client-registry.test.ts` pins how each one orders and dispatches.

### Folders

- **`features/<name>/`** is the home of a feature. `index.ts` has its `install<Name>(ctx, deps)`, and beside it is whatever it needs: `controller.ts` (what it does with you), `world.ts` (its 3D things), `sound.ts` (its sound recipes), `ui.ts` and `ui.css` (its window). `features/workers/` is the one without an `index.ts`: its install functions are in `actions.ts` and `views.ts`. `tests/client-structure.test.ts` checks `main.ts` calls every feature's install function once.
- **`core/`** is the office's own parts that aren't a feature: the renderer and scene (`scene.ts`), the frame loop (`loop.ts`), the building's maps (`worlds.ts`, `maps.ts`), floors and the elevator (`travel.ts`), arriving (`arrival.ts`), where you are (`place.ts`), the camera gliding up to a screen you use up close (`screen-zoom.ts`, for the boss's computer and the arcade cabinet), and the hint bar (`hintbar.ts`, with the pieces every hint is made of in `hint.ts`).
- **`input/`** is the keyboard (`keyboard.ts`, which hands every press to `ctx.keys`), aiming and clicking (`pointer.ts`), and windows and the game taking turns with both (`focus.ts`).
- **`state/`** is the store. `store.ts` declares the core fields (who you are, the people, the floors, and the floor you're on with its workers, screens, boards and queue), and `core.ts` keeps them up to date. Everything else is a slice in `state/slices/`: a module that adds its fields and topics to `Store` and `Topics` (`declare module '../store'`), sets where they start (`init`), and says what it takes in from each server message (`on`) and from each floor you arrive on (`enter`). Slices run in the order of `SLICES` in `state/slices/index.ts`, which is the order their topics fire in, so a new one goes at the end. Features follow a topic with `store.on('<topic>', fn)`. What the browser remembers between visits is `persist.ts`.
- **`ui/`** is the app shell: the HUD, the menu and the windows (settings, the palette, terminals, changes, the queue, and the GitHub windows in `ui/github/`). Each module imports its own stylesheet (`import './palette.css'`), as a feature's `ui.ts` does (`import './ui.css'`).
- **`world/`** is the engine and the scenery: toon materials and shapes (`toon.ts`), the characters (`world/character/`), the office floor (`world/office/`), the castle (`world/castle/`), the space station (`world/station/`), the scenic loop, the sky and the city. The types they share (what you bump into, what you can use, the seats, `Office`) are in `world/types.ts`.
- **`sound/`** is the office's sound. `OfficeSound` (`sound/index.ts`, the `ctx.sound` every part uses) is a facade over `AudioCore` (`sound/core.ts`: the audio context, its buses, where your ears are) and the recipes, each in a file of its own, here (`weather.ts`, `paper.ts`) or in its feature's folder (`features/gong/sound.ts`).
- **The 2D view** is `lite.ts` (with `lite.html` and `lite.css`), which puts together its own pieces in `lite/`: the worker cards and their answer buttons (`cards.ts`), the Claude limits box under them (`limits.ts`, drawn by the 3D office's `ui/limits.ts`), and coming back to the page and pull to refresh (`wake.ts`). It's an app on a phone's home screen through `pwa/` (the 📲 hint in `install.ts`, staying signed in in `session.ts`) and the files in `public/`: `manifest.webmanifest`, `icons/`, the service worker `sw.js` and `offline.html`, which it shows while the office can't be reached. `index.html` sends a phone there with a few lines of its own before the 3D office loads.
- **`push/`** is 🔔 Notify this phone, the browser's side of web push: subscribing through `sw.js`, telling the office while the 2D view is on screen (`index.ts`), and its window (`window.ts`). The office's side is `src/server/push/`.
- **`shared/`** (`src/client/shared/`) is what the 3D office and the 2D view at `/lite` both use: the tab title, hiring, sending a worker home (`send-home.ts`: **X** at a desk, and the 2D view's 🏠 on a card and in a terminal, `TerminalOptions.sendHome`), and following a phone's on-screen keyboard (`viewport.ts`). The 2D view loads no three.js and nothing from `core/`, `features/`, `input/`, `world/` or `player/`; `tests/client-structure.test.ts` follows `lite.ts`'s imports to check.

### Stylesheets

`style.css` is the 3D office's sheet. It pulls in `styles/base.css` (the colors, the reset, panels, buttons and the window frame, which the 2D view's `lite.css` loads too), `styles/hud.css`, `styles/loading.css` and `styles/phone.css`. That last one is the windows on a phone, which the 2D view loads too: full screen, sized to the part of the screen the on-screen keyboard leaves, and a thumb's size. Anything absolutely placed inside a box (the 🎤 of `dictateField`) grows to 44×44 there too, so the box has to grow with it: `phone.css` makes a one-line dictate box 54px tall for that. Its rules are all under `body.phone-ui`, which `lite.html`'s body always has and the 3D office's gets on a phone (`features/touch`); `ui/terminal.ts` gives a terminal its keypad there too. Every other sheet sits next to its module and comes in with it. A module's sheet loads in no fixed order against `base.css`, so a module rule that overrides a base rule of the same specificity has to be more specific, or live at the end of `base.css` with the others there.

### Touch controls

`features/touch/` is the 3D office on a phone: `installTouch(ctx)` puts its controls up when `settings.touch` says to (`auto` is `touchOnly()`, from `ui/touch.ts`), with `touch-ui` and `phone-ui` on the body. It's in pieces you can test apart: `touches.ts` (pure: the stick from a thumb, which finger is doing what by pointer id, and which keys a hint offers), `joystick.ts`, `look.ts`, `buttons.ts`, `keys.ts` and `intro.ts`, with its ⚙️ rows in `ui/settings-touch.ts`.

- **Walking.** The stick doesn't press W A S D. It writes `player.stick` (`{ x, z, run }`, `player/stick.ts`), an analog input the player reads next to its keys in `update`: the direction and how far it's pushed set the angle and speed, so it walks, climbs, rides and gets up off a seat exactly as the keys do. `player.holding('KeyW', …)` counts the stick pushed that way too (`stickHolds`), so whatever reads keys while it has hold of you, a car's pedals or aiming at the tee and the oche, works from the stick with no change of its own.
- **Looking.** The touch controls take the fingers on the canvas (`player.fingers`, so `player/pointer.ts` leaves touches alone and keeps the mouse) and turn you with `player.turn(dx, dy, speed)` and `player.zoom(by)`, the same moves a mouse drag and the wheel make. A tap is `player.onClick`, as a click is.
- **Buttons.** They follow the hint bar: `buttons.ts` watches `#hint` and makes a button of every key cap in it (`codeOf`: `E` is **Use**, `Space` is **Jump**, the rest fan out above). Each presses its key down and up as a thumb lands and lifts (`keys.ts`, a `KeyboardEvent` on the window), so the key goes through `ctx.keys` and every keyup listener just as typed, and holding a button holds the key. No handler may check `isTrusted` (a test in `tests/touch.test.ts` fails if one does). So **a new key gets its touch button by being in the hint bar**: a feature whose hint (`key('J', 'Juggle')`, or its activity's `hint`) shows the key has a button for it on a phone, and needs nothing in `features/touch/`. A key that's only ever in `HELP_ROWS` and not in any hint has no button: put it in the hint where it applies, or, if it belongs everywhere (like 😀 and 💬), add a button to `TouchButtons`. A key cap the stick or a drag stands for (`W A S D`, `Mouse`) gets no button and reads *🕹️ Stick* in the hint bar.
- **The rest of the HUD** moves out from under the thumbs in `features/touch/ui.css`, all of it under `body.touch-ui`, with the notch and home indicator (`env(safe-area-inset-*)`) in both orientations.

What's easy to trip on with touch:

- **`touch-action: none`** on the canvas (`body.touch-ui #scene`) is what stops the browser scrolling, zooming or cancelling a drag (`pointercancel`) mid-walk. Every button in the pad has it too.
- **iOS Safari ignores `user-scalable=no`** for pinch zoom: the controls put it in the viewport meta (with `viewport-fit=cover`, without which the safe-area insets are all 0) and also cancel `gesturestart`.
- **The phone's keyboard only comes up from a tap itself** on iOS: 💬 presses T on `click`, not `pointerdown`.
- **Fingers are tracked by `pointerId`**, both here and in `player/pointer.ts`'s drag, so a second finger never moves the first one's drag. Lifting, `pointercancel`, `touchcancel`, the window losing focus, the tab hidden and a window opening (`ctx.windowOpened`) all let go of the stick and every key held, so nothing drifts or stays wound up.
- **Pointer lock never happens on a phone.** `input/focus.ts` only takes the mouse back after a window for a fine pointer (`(pointer: fine)`), and the crosshair's *Click to look around* is hidden under `touch-ui`.
- **Scrolling a terminal with a finger** (`ui/termtouch.ts`, the keypad terminal in the 2D view and the 3D office on a phone) has two cases. A shell is in xterm's normal buffer, with scrollback, and the finger moves that (`term.scrollLines`). Claude Code takes the whole screen: it switches to the alternate buffer (`ESC[?1049h`), which has no scrollback, and turns on mouse reports (`?1000h`, `?1006h`), and scrolls its own conversation by the wheel. So there the finger dispatches a `WheelEvent` (one line-mode notch a row) on `.xterm-screen`, and xterm.js sends it on exactly as a mouse's wheel: an SGR wheel report (`ESC[<64;…M` up, `65` down) to a program that reads the mouse, ↑ / ↓ to one that doesn't (`less`, `vim`). The snapshot a terminal opens with keeps the mouse encoding (`server/screen.ts`), without which those reports wouldn't be SGR. `tests/mobile.test.ts` (`scrollsFullScreen`) feeds the terminal such a screen and drags a finger up it. To see what an agent's TUI switches on, run it in a pty and grep the `ESC[?…h` sequences.
- **Headless Chrome** draws the office with swiftshader (`--use-angle=swiftshader --enable-unsafe-swiftshader`, see `tests/mobile.test.ts`), slowly: a window's pop-in animation (scale .96) is still running when you'd measure its buttons, and the 2D view's *running slowly* offer comes up, so the tests wait for animations and set `agent-office.lite-declined-slow`. Touches go in as CDP `Input.dispatchTouchEvent`, which Chrome turns into `pointerType: 'touch'` pointer events.

## Server

- **`server.ts`** is the composition root: `startServer` builds the office's context a stage at a time, starts the hook server, opens the floors, and hands the context to the HTTP handler and the WebSocket.
- **`office/`** is that context (`Ctx` in `office/context.ts`: the building-wide services, sending to browsers, the floors, the people in the office, going between floors, and the checks before something happens) and the pieces that make it.
- **`ws/`** takes the sockets. Each domain's messages are handled in `ws/handlers/<domain>.ts`, a map from message type to handler that `satisfies HandlerMap<ItsClientMsg>`, and `ws/handlers/index.ts` puts them all in one `HandlerMap<ClientMsg>`: a message type with no handler, or a handler for a type that doesn't exist, fails the typecheck. The same file lists the features that keep something per person on a floor (`features`: what each lets go of when someone is `leaving` a floor, and once their socket has `closed`) and the pieces of what someone arriving on a floor is sent (`views`, one for each field of `FloorView`, put together by `office/views.ts`).
- **`http/`** answers HTTP from a route table. Each file in `http/routes/` exports its routes, and `http/routes/index.ts` lists them in the order they're tried. Every route says its `auth` (`public`, or `session` for a signed-in browser), and the `Route` type won't let you leave it out.
- **`hooks/`** is the loopback-only hook server the workers call: their agents' hook events (`/hooks/<provider>`), the board agents' queue (`/office/queue`) and `office-workers` (`/office/workers`).
- **`workers/`** is the worker manager (`WorkerManager` in `workers/manager.ts`) and its pieces: worktrees, pull requests, tasks, terminals, ACP workers, and saving to `workers.json`. `src/server/workers.ts` re-exports it for the modules that imported it from there.
- **`providers/`** holds one adapter per agent CLI (see [Adding an agent provider](#adding-an-agent-provider)).
- **`provider-accounts/`** keeps more than one login per provider and each floor's pick of them (`ProviderAccounts`), what each provider's login needs (`kinds.ts`), the `RunAs` a floor hands its worker manager, which puts whoever hired a worker and its provider account in its environment (`run-as.ts`), and moving a worker already at its desk to another account, its conversation copied along (`move.ts`, with the worker's side of it, ending its run and resuming it there, in `workers/account.ts`). Running Claude Code's own sign-in, for it and for `signins.ts`, is `logins.ts`.
- **`phone/`** is 📱 Use on your phone: running Tailscale's command line, and only the commands it allows (`tailscale.ts`), putting the office on the tailnet and taking it off without touching anyone else's Serve handlers (`access.ts`), pairing links and the devices they sign in (`pairing.ts`), keeping the computer awake (`awake.ts`), what it keeps in `config.json` (`saved.ts`), and `agent-office phone` (`cli.ts`). `Phone` (`index.ts`) is the service the office makes with the late ones; its messages are in `ws/handlers/phone.ts`, the `/pair` page's routes in `http/routes/phone.ts`, and its window in the client's `ui/phone.ts`.
- **`push/`** is web push (🔔 Notify this phone): the VAPID keys and the aes128gcm encryption, written out with `node:crypto` (`webpush.ts`), the devices that get pushes and the key pair, kept in `push.json` (`store.ts`), when a worker is worth a push, the team webhook's rule (`decide.ts`), and answering a worker's numbered choice from its card or a notification's button (`answer.ts`). `Push` (`index.ts`) is the building service, told about every worker update next to the webhook in `office/floors.ts`; its messages are in `ws/handlers/push.ts`, and the routes for the home-screen app (its files, the answer a notification sends, and the installed app's session) in `http/routes/app.ts`. The choices themselves are read off a waiting worker's screen by `workers/choices.ts`, as each screen is sent.
- **`tunnel/`** is `agent-office tunnel`, the one part that runs on someone's own computer instead of the office's: it asks the office for the workers' web servers (`/api/services`, in `http/routes/services.ts`) and listens on each one's port there. It imports nothing from the office but what the two say to each other (`tunnel/wire.ts`) and the cookie's name.

The rest of `src/server/` is a module per service or per thing a floor keeps (`dog.ts`, `jukebox.ts`, `queue.ts`, `meetings.ts`), made by the office or by each `Floor` (`floor.ts`).

## Shared

- **`protocol.ts`** is the wire protocol. It puts the domain files in `protocol/<domain>.ts` back together (`export *`) and makes the `ClientMsg` and `ServerMsg` unions every frame is one of. Keep `import type` between domain files: some name each other's types (`floors.ts` and `presence.ts` do), which only type imports can do without a cycle at run time.
- **`providers.ts`** is the provider table: every agent a worker can run, and what the office knows about each.

The rest is data and pure code both sides use: the floor's layout, maps (`shared/maps/`), the sun, the garage and so on.

## Adding a feature

A new feature adds files of its own and one line in each list it joins. For something on the floor that everyone there sees and uses, that's:

1. **Its messages** in a protocol domain file (`src/shared/protocol/toys.ts`, say). A new domain file also goes in `protocol.ts`: its `import type`, its `export *` and its members of the unions.
2. **A server handler file**, `src/server/ws/handlers/<name>.ts`, and its line in `handlers` in `ws/handlers/index.ts`. If it keeps something per person, its `FeatureHooks` go in `features` there; if people arriving on a floor need its state, that's a field of `FloorView` (`protocol/floors.ts`) and its piece in `views`. What a floor keeps is a module of its own in `src/server/`, which `Floor` makes.
3. **A state slice**, `src/client/state/slices/<name>.ts`, and its line at the end of `SLICES` in `state/slices/index.ts`.
4. **`src/client/features/<name>/`** with its `install<Name>(ctx, deps)`, and its line in `main.ts`. If another part needs what it returns, a line in `Parts` (`core/parts.ts`) too.
5. **What you can use.** The file that calls `ctx.interactions.define('<kind>', …)` also adds the kind, by augmenting `InteractKinds` in `world/types.ts` (`declare module '../../world/types'`); `tests/client-registry.test.ts` checks every kind is defined once, in the file that adds it. Something that stands in the office is a fixture: `export const <name>: Fixture<'<field>'>` in its `world.ts`, which adds the field it gives `Office` to `OfficeHandles` the same way, and a line in `floorPlan()` in `world/office/build.ts` (which won't typecheck while a field in `OfficeHandles` has no fixture giving it). `features/gong/` does both.
6. **A help row** in `HELP_ROWS` in `src/client/ui/help.ts`. A key of its own reaches a phone by being in the hint bar where it does something, which makes it a touch button (see [Touch controls](#touch-controls)).
7. **A sound recipe** in its `sound.ts` (a function or class that takes the `AudioCore`), and the method on `OfficeSound` that plays it.
8. **Its CSS** next to its ui module, imported from there.

Its HTTP routes, if it has any, go in `http/routes/`, and its tests in `tests/`.

A new game for the arcade cabinet isn't a feature of its own: it's three modules and a line in each of the cabinet's three lists, in [Adding a game](arcade.md#adding-a-game).

The boss's computer (`features/retro/`, with its server side in `src/server/retro.ts` and `retro-db.ts`) has its own map of what's where, and what's easy to break, in [Working on it](retro.md#working-on-it).

## Building things in the 3D office

What the skeeball machine (`features/skeeball/`) ran into, which holds for anything else built on the floor.

- **Flicker is shadows or coplanar faces.**
  - The sun's single shadow map covers the whole office (64 × 60 m at 2048², about 3 cm a texel), so a tall prop standing close to a wall throws a shadow that crawls and stair-steps on it as the sun moves. Build such a prop with `mesh(…, shadow = false)` and give it a soft contact-shadow plane on the floor instead.
  - A tall, plain solid facing away from the sun shows shadow acne when you stand right next to it. The stairs' side did this (`stairs.receiveShadow = false` in `world/office/loft.ts`). Turn off `receiveShadow` on the big surface, not on the small parts that need it.
  - Never put two faces in the same plane. Decals and art panels sit a few millimetres proud of what they're on, or they z-fight.
- **A camera close behind your head**: an activity with `takesCamera` that looks from just over you hides your own body in a `ctx.view` `update` (`ctx.me.root.visible = false`). That runs after the frame loop sets it, so it sticks for the frame. Everyone else still sees you.
- **Physics everyone sees.** The skeeball roll is a deterministic fixed-step simulation in `src/shared/skeeball.ts`, so every page runs the same roll from the same inputs. The message carries the inputs (aim, power) and the result (`points`), so every page counts the same score even if a float goes another way somewhere. The server checks the message is a roll anyone could have made (`rollOk`) and passes it on to the floor. The constants at the top of that file tune the feel (speeds, friction, bounces, the lips round the rings), and `tests/skeeball.test.ts` pins the order of the rings up the middle, that every score can be had, and that a 100 is a small target (under 2% of aims and powers, none from hugging the rail or rolling flat out). After retuning, print a table of score by aim and power, weigh it by how far off a hand's timing is (40–60 ms against how fast the aim slider and the meter move) to see what a good player averages, and play it in the sandbox. The machine is drawn `SIZE` times bigger than the frame it's worked out in, so `toWorld` and the footprint (`SKEEBALL.length`, `width`) scale by it and the roll doesn't.
- **Music from a thing in the room** (`features/skeeball/music.ts`, like the DJ's set) goes through a panner into the jukebox's `musicBus`, so the music volume governs it.
  - Schedule it from a `setInterval` with more than a second of notes ahead, so a hidden tab's slow timer doesn't make it stutter.
  - Give each run of the tune a gain node of its own, so stopping it silences notes already scheduled.
  - Start it from the tick, not when its mode is set, because the mode can be set before audio exists. One-shot effects go in the feature's `sound.ts` and play through `OfficeSound`.
- **Checking it headless.** Use playwright-core with Chrome and the swiftshader flags (see [Touch controls](#touch-controls)), plus `--autoplay-policy=no-user-gesture-required` for sound.
  - `window.__office` has the player (put yourself somewhere with `player.pos`, `facing` and `camYaw`), the office's fixtures (`office.skeeball`), the store and the renderer.
  - `window.__sound` has `played` (how many of each sound so far), `level()` and `musicLevel()`.
  - Hide a fixture's `group` to see whether a glitch is its own.
  - If you build the steps in a zsh variable, unquoted it's one argument (`${=steps}` splits it).

## Adding an agent provider

One adapter file in `src/server/providers/`, one entry in `PROVIDERS` in `src/server/providers/index.ts`, and one row in `src/shared/providers.ts` (its id in `AGENT_PROVIDERS`, its entry in `PROVIDER_META`). The typecheck fails until all three are there. Its row says which models and efforts it takes and how the hire dialog asks for them; one whose CLI lists its models gets a lister in `src/server/models.ts` too. What reads them, and the one place that still names providers one by one, are in [Provider seams](dsh-acp-integration.md#provider-seams).

## The size guard

`tests/size.test.ts` holds every `.ts` and `.css` file under `src/` to 600 lines. It asks `git ls-files` for them (tracked, and new ones that aren't ignored) rather than walking the folder, so a worktree checked out inside the repo can't trip it. The files that were longer when it came in are listed in `CEILINGS`, each with the length it had then: they may shrink, but never grow past it. Once one is down to 600 lines or fewer, or gone, the test fails until you take it off the list, so the list only gets shorter.

When it fails, split the file along the registries: a feature's code goes in its folder, a message handler in its domain's file, a tick or a key in the feature it's for, and what the page keeps of it in its own slice. Raising a ceiling, or adding a file to the list, only hands the problem to the next person, so the honest way to make room is to split the file. When you shrink a listed file, lower its ceiling to its new length in the same change, so it can't grow back.
