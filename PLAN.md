# Pusar: Project Plan

A Roblox launcher, **Windows first, macOS later**. It handles accounts, a game library, mods (FFlags and content swaps) and Discord presence, with a polished UI.

_Last updated: 2026-11-08_

---

## 1. Name and domains (checked 2026-11-07)

| Item | Status |
|---|---|
| **pusarlauncher.com** | ✅ Not registered (Verisign registry) |
| **pusarclient.com** | ✅ Not registered |
| getpusar.com / pusarapp.com | ✅ Not registered |
| pusar.com | ❌ Registered 2004, parked ("may be for sale") |
| GitHub `pusarlauncher`, `pusar-launcher`, `pusarclient`, `pusar-client` | ✅ Free |
| GitHub `pusar` | ❌ Taken |
| Existing product named "Pusar" | None found |

**Watch out:** "Pusar" is one letter off **Pulsar Client / Pulsar Launcher**, a Minecraft client that registered pulsarclient.com in Apr 2026 and pulsarlauncher.com in Sep 2026. Search engines already autocorrect "Pusar" to "Pulsar". To reduce the mix-ups, always use the full name **"Pusar Launcher"** and give it a logo that looks nothing like theirs.

---

## 2. What Pusar is, and what it isn't

**It is:** a launcher and bootstrapper that handles accounts, launches games, manages mods (FFlags, fonts, cursors, sounds), shows Discord Rich Presence and server region, and has a much nicer UI than the stock Roblox launcher.

**It isn't:** an injector or executor. It does no DLL injection, no memory editing, and runs no scripts inside the game. Roblox's anti-cheat (Hyperion) blocks those and gets users banned. Staying well away from that also matters for trust (see §5.7).

**Design rule:** Everything except account features works without logging in. Logging in adds the library, friends and quick-join. If Roblox ever breaks third-party login, mods and launching keep working.

---

## 3. Tech stack

**Decision: Electron + TypeScript + React + Vite (`electron-vite`), packaged with `electron-builder`.**

Why Electron over Tauri for this app:
- **One browser engine on both OSes.** In-launcher login runs Roblox's real login page, which includes device-binding crypto code (§5.3). Electron uses Chromium everywhere. Tauri uses WebView2 on Windows and WKWebView on macOS, which means two engines to debug for the riskiest feature.
- **Separate session per account.** `session.fromPartition("persist:acct-<id>")` gives each account its own storage, and the cookie API can read HttpOnly cookies.
- **Real end-to-end tests on both OSes.** Playwright can drive Electron on Windows and macOS. Tauri's WebDriver support doesn't cover macOS.
- **Release tooling.** `electron-builder` handles Windows signing, macOS notarization and auto-update.

Cost: roughly a 100 MB install and 150 MB of RAM. To offset that, add a setting to close the launcher or minimize it to the tray when the game starts, which is what Lunar does. Tauri is still worth revisiting if the M0 spike shows size is a dealbreaker.

Other libraries:
- **UI:** Radix UI primitives (unstyled, accessible), CSS Modules plus design tokens in CSS variables, Phosphor icons
- **State and validation:** Zustand, zod
- **Discord:** `@xhayper/discord-rpc`
- **Testing:** Vitest, Playwright, MSW (mocks HTTP responses)
- **TypeScript:** pinned to 6.0, because typescript-eslint doesn't support 7 yet

---

## 4. Architecture

```
main process (Node)
├─ accounts/     login windows, per-account partitions, request signing, sign-out
├─ roblox/       install detection, version API, download/update, launch (URI + args)
├─ mods/         FFlag manager (allowlist), content overrides, apply/revert, integrity check
├─ activity/     Roblox log watcher → Discord RPC, server region lookup
├─ platform/     RobloxPlatform interface → win.ts / mac.ts
├─ updater/  settings/  diagnostics/
└─ ipc/          typed, allowlisted channels

renderer (React UI)  ⇄  preload (contextBridge, typed API)  ⇄  main
```

Security baseline:
- Turn on `contextIsolation` and `sandbox`, and turn off `nodeIntegration`. Use a strict CSP.
- Serve the UI from `pusar://app/` rather than `file://`, and send the CSP as a response header.
- Validate every IPC message with zod, and accept IPC only from the top frame of Pusar's own page.
- Developer switches (`--spike`, `--selftest`) and the dev-server variable are ignored in packaged builds.
- **The renderer never sees cookies or tickets.** It only gets user IDs, names and avatars.
- Login windows load only `https://*.roblox.com` pages. Block every other navigation and pop-up, and don't give login windows a preload script.
- Electron fuses:
  - Turn on `EnableCookieEncryption` (it's **off by default**), `OnlyLoadAppFromAsar` and `EnableEmbeddedAsarIntegrityValidation`.
  - Turn off `RunAsNode` and `EnableNodeCliInspectArguments`.

---

## 5. Roblox login without the OAuth API

**Why not OAuth:** Creating a Roblox OAuth app requires an ID-verified account. OAuth tokens also can't launch the game client, because launching needs a real web session.

### 5.1 Adding an account
1. "Add account" opens a Pusar window showing the **real `roblox.com/login` page** in a new persistent partition, `persist:acct-<uuid>`.
2. The user types their password, solves the captcha and completes 2FA. Pusar never reads, fills or automates the login form.
3. When the `.ROBLOSECURITY` cookie appears in that partition, close the window. Then fetch `users.roblox.com/v1/users/authenticated` and the avatar headshot.

### 5.2 What Pusar stores
- **Pusar's own data:** the user ID, display name and partition ID only. No copies of cookies.
- **The session itself:** stays in the account's partition. Chromium encrypts cookies at rest once the cookie-encryption fuse is on. It uses DPAPI on Windows and the Keychain on macOS.
- **Any other secrets:** if Pusar ever needs to keep one, use Electron `safeStorage`.

### 5.3 Device-bound sessions (important)
Roblox's login page now creates a signing key in the browser's IndexedDB (`hbaStore`) and ties the session to it. Requests can then require an `x-bound-auth-token` header signed with that key. A Sept 2026 report says Roblox isn't enforcing this yet, but that could change any day. Tools that log in through a throwaway browser profile and then reuse the cookie elsewhere will break when it does.

**Pusar's approach:**
- Keep each account's partition for as long as the account exists, because the key lives there.
- Make authenticated requests **from a hidden window on `www.roblox.com` in that same partition**. Sign them with the stored key using `roblox-bat` in on-site mode. This mirrors what roblox.com itself does when you press Play.
- **Don't** strip `secureAuthenticationIntent` from the login request. It would work, but it weakens the user's account security.
- Fallback: plain native HTTP with the cookie. It works only while Roblox still accepts unsigned requests. Use it when the hidden-window path fails, and log it.

### 5.4 Launching a game
1. Request an authentication ticket from inside the partition, using Roblox's anti-forgery (CSRF) handshake:
   - `POST auth.roblox.com/v1/authentication-ticket` returns 403 with an `x-csrf-token` header.
   - Retry the request with that `X-CSRF-TOKEN` and an `RBXAuthenticationNegotiation: 1` header.
   - Read the ticket from the `rbx-authentication-ticket` response header.
2. Build the launch URI: `roblox-player:1+launchmode:play+gameinfo:<ticket>+launchtime:<ms>+placelauncherurl:<encoded PlaceLauncher URL>+browsertrackerid:<id>+robloxLocale:…+gameLocale:…`
3. Hand it to Roblox:
   - **Windows:** run `RobloxPlayerBeta.exe` with the equivalent arguments.
   - **macOS:** run `Roblox.app` via `open` or the binary.

### 5.5 Signing out
Call Roblox's logout endpoint, then delete the account's partition from disk.

### 5.6 Risks
- Roblox could change its login or session rules. Watch the DevForum "Account Session Protection" threads.
- Roblox could treat third-party login as a ToS gray area.
- Mitigation: login is optional (see §2), so the launcher degrades gracefully.

### 5.7 Trust rules (non-negotiable)
Fake launchers that steal cookies are common Roblox malware, so users will be suspicious. Earn their trust:
- Cookies and tickets never leave the machine except in requests to `*.roblox.com`.
- Never log them. Scrub them from crash reports, diagnostics and screenshots, and add a test that enforces this.
- **Make the repo open source** so anyone can verify the above.
- Code-sign every build (§9). An unsigned app that asks for your Roblox login looks exactly like malware.

---

## 6. Roblox install, mods and launching

### Windows
- **Install location:** `%LOCALAPPDATA%\Roblox\Versions\version-<hash>\`. Get the current version from Roblox's client-version API.
- **Bootstrapper mode** (like Bloxstrap): Pusar downloads and updates Roblox itself, into its own folder, from Roblox's CDN. Roblox's own updater then can't wipe the mods.
- **Optional:** make Pusar the handler for `roblox-player:` links, so website Play buttons also go through Pusar.

### macOS (later)
- **App location:** `/Applications/Roblox.app` (also check `~/Applications`).
- **File locations:** FFlags go in `Contents/MacOS/ClientSettings/ClientAppSettings.json`, and content files are under `Contents/Resources/content/`.
- **Updates:** Roblox updates its app bundle itself, so reapply mods before every launch.
- **First macOS task:** confirm that modifying the bundle doesn't break launching (code signature or Gatekeeper). AppleBlox does this today, so study its approach.

### Mods in v1
- **FFlag editor:**
  - Roblox now only honors flags on its **allowlist**. Ship an up-to-date allowlist and mark or turn off flags that aren't on it.
  - Include presets, and use a monospace editor with validation.
  - Flags load only when a Roblox process starts, and Roblox keeps a background tray process that handles later launches. After a flag change, restart that process, but never one running a game (found in M0).
- **Content swaps:**
  - Fonts, cursors, the classic death sound, and textures where allowed.
  - A mod pack is a folder or zip with a `manifest.json` (id, name, version, target paths, platforms).
  - Apply means copying files in after backing up the originals, and revert restores the backups. Keep checksums so Pusar notices when a Roblox update overwrites a mod and reapplies it.
- **Activity:** Watch Roblox's log files for the place ID, job ID and server IP. Use them for Discord Rich Presence and to show the server's region.
- **Launch options:** close the launcher or minimize to tray on launch, and per-game profiles.

### Later
- **Library:** favorites, recently played, joinable friends, and game search.
- **Several Roblox windows at once:** check Roblox's current rules first.
- **Themes.**

---

## 7. UI: polished, not "AI-looking"

### Things that make a UI look AI-generated (banned)
- Purple or blue gradients, glassmorphism, glowing blobs, sparkle (✨) icons
- Emoji used as icons, or copy like "Welcome back! 👋"
- Stock shadcn/Tailwind styling: everything in a `rounded-2xl` card with a soft shadow, Inter at default weights
- Dashboards full of meaningless stat cards, centered hero sections, vague marketing copy
- Inconsistent spacing, five different corner radii, more than one accent color

### Direction
- **References:**
  - Look at real launchers: Riot Client, Battle.net, Steam's library, Lunar and the Xbox app.
  - Put content first: real game thumbnails from Roblox's thumbnail API do most of the visual work.
- **Layout:**
  - A left nav rail: Play / Library / Mods / Accounts / Settings.
  - A large Play area with the selected game and an account switcher.
  - A bottom status bar for launch progress and the Roblox version.
- **Color:**
  - A near-black neutral base (not pure `#000`).
  - **One** accent color, used only for the primary action and active state.
  - Semantic colors for status only.
- **Type:**
  - One UI font with some character, such as Hanken Grotesk, Instrument Sans or General Sans.
  - JetBrains Mono for the FFlag editor.
  - A fixed size scale: 12 / 13 / 15 / 18 / 24 / 32.
- **Shape:** two corner radii (4 px and 8 px), hairline borders instead of shadows, and a 4 px spacing grid.
- **Icons:** one set (Phosphor) at one weight, plus a custom Pusar logo mark.
- **Motion:**
  - Animations take 120–200 ms with ease-out, and only where they carry meaning: launch progress and panel changes.
  - No bounce, and respect the OS's reduce-motion setting.
- **Copy:** short and specific, for example "Roblox updated · reapplying 3 mods". No exclamation-mark spam.
- **Window frame:** frameless with a custom title bar on Windows, and native traffic-light buttons on macOS.

### Process
1. Moodboard of real launcher screenshots.
2. High-fidelity mockups of four key screens: Play, Library, Mods, Accounts.
3. Design tokens, then a component gallery page in the app (dev only).
4. Build the screens.
5. **"AI-look audit"** on every UI pull request: before and after screenshots, checked against the banned list above.

---

## 8. Testing and bug hunting

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | URI and argument building, FFlag allowlist checks and merging, mod manifest parsing, apply/revert, log parsing, version parsing, cookie scrubbing |
| Integration | Vitest + temp dirs + MSW | Fake Roblox install folders (Windows and macOS layouts); recorded roblox.com API responses; Roblox updating mid-session; missing, corrupt or read-only files |
| End-to-end | Playwright (Electron) | Onboarding, adding an account against a **local fake login server**, applying mods, and launching up to the point the process starts (Roblox's executable is stubbed out). **Never automate the real Roblox login or captcha.** |
| Visual regression | Playwright screenshots | Key screens, to catch UI breakage |
| Roblox canary | Scheduled CI (daily, plus Wednesdays when Roblox usually ships updates) | Fetches the latest Roblox version and checks that file layout, paths and the FFlag allowlist still match. Alerts **before** users hit a break. |

**Continuous integration:** GitHub Actions on `windows-latest`. Add macOS runners when macOS work starts. Every run does lint, type checking, unit, integration and end-to-end tests, then builds the installer.

**Manual QA checklist before every release** (real accounts, real Roblox):
- Windows 10 and 11
- A fresh install, and a machine with Roblox not installed
- An account with 2FA, and multiple accounts
- Offline, and sleep/wake during a launch
- Usernames and paths with spaces or non-English characters, and OneDrive-redirected folders
- Windows Defender and SmartScreen
- Roblox update day

**Bug reports:**
- Opt-in crash reporting (Sentry) that strictly scrubs cookies and tokens.
- An in-app **"Copy diagnostics"** button that produces a redacted log bundle.
- A GitHub issue template.

**Release channels:** nightly → beta (Discord testers) → stable, using electron-updater's channels.

---

## 9. Builds

**Windows is the only release target for now.**

- **Shared code:** platform-specific code sits behind a `RobloxPlatform` interface, so macOS can be added later without restructuring. A feature is done when it works on Windows.
- **Windows:**
  - An NSIS installer that installs per-user (no admin rights needed), for x64. Add ARM64 later.
  - **It must be code-signed**, or SmartScreen shows "Unknown publisher". Options: Microsoft Trusted Signing (about $10/month) or an OV certificate.
- **macOS (later):**
  - A universal (arm64 + x64) DMG with the hardened runtime, **notarized by Apple**.
  - Requires the Apple Developer Program ($99/year). Gatekeeper blocks apps that aren't notarized.
- **Auto-update:** signed updates from GitHub Releases via electron-updater.

---

## 10. Milestones

**M0: Spikes (1–2 weeks).** Prove the risky parts on Windows before building UI.
1. Log in through an Electron window, sign requests inside the partition, get an auth ticket and launch a place.
2. Detect the Roblox install, then apply one FFlag and one font swap.
3. Read Roblox's logs and show Discord Rich Presence.

_Exit criteria:_ all three work on Windows. If not, revisit this plan. **Met on 2026-11-08** (see [docs/M0-SPIKES.md](docs/M0-SPIKES.md)).

**M1: Foundation.** Repo, electron-vite, strict TypeScript, linting, the CI matrix, test harness, typed IPC, security baseline, design tokens and base components. **Done on 2026-11-08**, except that the CI workflow hasn't run yet because the project has no GitHub repo. The M0 test panel (`npm run spike`) stays until real screens replace it, and it doesn't ship in packaged builds.

**M2: Accounts and launching.** Add, remove and switch accounts; search for and launch games; join by link; the `roblox-player:` handler on Windows.

**M3: Mods.** FFlag editor with the allowlist, mod packs, apply/revert, reapply after Roblox updates, presets.

**M4: Extras.** Discord RPC, server region, library (recent, favorites, friends), settings, tray.

**M5: Polish.** A full UI pass, onboarding, empty and error states, accessibility, and strings ready for translation.

**M6: Release (Windows).** Code signing, auto-update, beta program, a site on pusarlauncher.com, docs, and a public repo.

**Later: macOS.** Run the macOS checklist in [docs/M0-SPIKES.md](docs/M0-SPIKES.md), starting with whether Roblox still launches from a modified app bundle. Then add macOS CI, QA and a notarized build.

---

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Roblox enforces device-bound sessions | Unsigned launches fail | Sign requests inside the partition (§5.3) from day one |
| Roblox changes the FFlag allowlist | Some flags stop working | Canary job compares allowlists; editor marks flags that aren't allowed |
| Roblox changes file layout or deployment | Mods or launching break | Canary job, platform abstraction, fast patch releases |
| macOS rejects a modified Roblox bundle (later) | macOS mods don't work | Test first when macOS work starts, study AppleBlox, fall back to FFlags-only on macOS |
| Roblox objects to the launcher | Takedown or breakage | No injection, login optional, open source, follow Roblox brand rules (no "Roblox" in the product name) |
| Users think it's a cookie stealer | Nobody installs it | Open source, code signing, published trust rules (§5.7) |
| Roblox's human check gets stuck in Pusar's sign-in window | Password sign-in fails for some users | Users complete checks themselves and Pusar never automates or disguises itself. Point users to Email a code or QR code (confirmed working). Real-browser sign-in is a last resort because the device key would stay in that browser. |
| Confusion with "Pulsar Client" (Minecraft) | Search and branding friction | Always say "Pusar Launcher", use a distinct logo |

---

## 12. Your to-dos before coding

- [ ] Register **pusarlauncher.com** (and **pusarclient.com** so nobody else grabs it), about $10–12/year each.
- [ ] Claim the GitHub org `pusarlauncher` and a Discord server.
- [ ] Budget for Windows code signing, about $120/year. Apple's $99/year can wait until macOS work starts.
- [ ] Choose a license. Open source is recommended for trust (MIT or GPL-3.0).

---

## Sources

- Device-bound sessions in third-party launchers: [Roblox-Account-Manager issue #10](https://github.com/ethanstoner/Roblox-Account-Manager/issues/10)
- Request signing (`x-bound-auth-token`): [RoSeal-Extension/Roblox-BAT](https://github.com/RoSeal-Extension/Roblox-BAT/blob/main/README.md)
- Auth ticket and `roblox-player:` launch flow: [KillianM00/roblox-multi-instance](https://github.com/KillianM00/roblox-multi-instance)
- Roblox session protection: [DevForum: Introducing Account Session Protection](https://devforum.roblox.com/t/introducing-account-session-protection/2668306)
- macOS launcher reference: [AppleBlox](https://github.com/triggqrd/appleblox)
- Cross-platform bootstrapper reference: [nullstrap on the DevForum](https://devforum.roblox.com/t/introducing-nullstrap-the-first-cross-platform-bootstrapper/4355697)
- Name check: [pulsarclient.com](https://pulsarclient.com), [pulsarlauncher.com](https://pulsarlauncher.com)
