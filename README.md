# Pusar

A Roblox launcher for Windows, with accounts, a game library, mods and Discord presence. See [PLAN.md](PLAN.md) for the roadmap.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Runs the app from source with live reload |
| `npm run spike` | Opens the M0 test panel, which has the working sign-in, launch and mod tools |
| `npm run check` | Runs lint, type checks, unit tests and end-to-end tests |
| `npm run package:dir` | Builds the unpacked app into `release/win-unpacked` |
| `npm run package` | Builds the Windows installer |

End-to-end tests open real windows briefly. They use a throwaway profile, so they never touch your accounts.

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

## UI rules

Components use the tokens in `src/renderer/src/styles/tokens.css`, never raw values. PLAN.md §7 lists what makes a UI look AI-generated, and those patterns are banned. Running from source adds a **Kit** page to the nav with every token and component.
