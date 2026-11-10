# Pusar

A Roblox launcher for Windows, with accounts, a game library, mods and Discord presence. See [PLAN.md](PLAN.md) for the roadmap.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Runs the app from source with live reload. The terminal comes back when you close Pusar |
| `npm run spike` | Opens the M0 test panel, which has the working sign-in, launch and mod tools |
| `npm run check` | Runs lint, type checks, unit tests and end-to-end tests |
| `npm run package:dir` | Builds the unpacked app into `release/win-unpacked` |
| `npm run package` | Builds the Windows installer |

End-to-end tests open real windows briefly. They use a throwaway profile and stub out Roblox, so they never touch your accounts.

Running from source keeps its data in `%APPDATA%\Pusar`, and the installed app uses `%APPDATA%\Pusar Launcher`. They can't share one, because installed builds encrypt cookies and source runs can't read those.

## Layout

| Folder | Contents | Rule |
|---|---|---|
| `src/core` | Plain Node logic: installs, mods, launch links, log parsing | No Electron |
| `src/main` | Electron main process: windows, sign-in, IPC handlers | |
| `src/preload` | The bridge between the UI and the main process | |
| `src/renderer` | React UI, design tokens and base components | Reaches the system only through `window.pusar` |
| `src/shared` | Types and the IPC contract used by both sides | Depends on nothing |
| `src/page` | Script injected into hidden roblox.com pages | |
| `tests`, `e2e` | Unit tests, and end-to-end tests on the built app | |

ESLint enforces the rules above.

## Adding an IPC call

1. Add the channel to `IpcChannels` and `CHANNELS` in `src/shared/ipc.ts`.
2. Add its input schema in `src/main/ipc/schemas.ts`.
3. Add its handler in `src/main/ipc/handlers.ts`.

A missing piece is a compile error. The UI then uses `call("channel", input)` from `src/renderer/src/api.ts`.

## Mod packs

A pack is a folder or `.zip` with a `manifest.json` and a `content` folder that mirrors Roblox's own:

```text
my-pack/
  manifest.json
  content/
    textures/Cursors/KeyboardMouse/ArrowCursor.png
```

```json
{ "id": "my-pack", "name": "My Pack", "version": "1.0.0", "author": "You" }
```

Only `.png`, `.jpg`, `.jpeg`, `.ttf`, `.otf`, `.ogg`, `.mp3` and `.wav` files are accepted. Anything else in `content` makes Pusar refuse the whole pack. The `id` must be lowercase letters, numbers, dots, dashes or underscores.

## UI rules

Components use the tokens in `src/renderer/src/styles/tokens.css`, never raw values. PLAN.md §7 lists what makes a UI look AI-generated, and those patterns are banned. Running from source adds a **Kit** page to the nav with every token and component.
