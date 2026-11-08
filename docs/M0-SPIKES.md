# M0 spikes: status and test checklist

M0 proves the risky parts work before any real UI is built (see [PLAN.md §10](../PLAN.md)).
This page tracks what has been verified and what still needs a human or a live Roblox connection. M0 now covers Windows only; macOS is deferred.

_Last updated: 2026-11-08_

## Status

| Spike | Windows | macOS |
|---|---|---|
| **1. Login → signed request → auth ticket → launch** | 🟢 Works end to end: real Roblox login, session survives a restart, signed in-page ticket, straight into a game. 🟡 Sign-out (**Remove**) not tried yet. | ⏸ Deferred |
| **2. Detect install, apply FFlags and a font, revert** | 🟢 Font confirmed in a real game. 🟢 Roblox loaded the FFlag file and the gray-sky flag took effect. 🟢 Revert confirmed on the real install. | ⏸ Deferred |
| **3. Roblox logs → activity → Discord presence** | 🟢 Live tracking follows a real game: joining, in game, left. 🟢 Discord shows the game name, icon and "Playing", and clears after you leave. | ⏸ Deferred |

### Live results (2026-11-08, Windows, with a VPN on)
- **Login:** the real roblox.com sign-in page worked in Pusar's window and the account was added.
- **Launch:** place 189707 opened straight into the game, signed in. The first launch got its ticket `via native (signed=false)`. After the fix below, both later launches got `via page (signed=true)` with HTTP 200.
- **Session persistence:** after the app was restarted (and even force-stopped), the account launched again without signing in.
- **Device binding:** Diagnose reports a device key in the account's profile (`keyPair=true`), and a signed profile request returned HTTP 200.
- **Roblox's real signing rules (from its page metadata):** `secureAuthIntent=true`, signing enabled for all URLs, and `auth.roblox.com` on the signed list at 100%. The first launch's unsigned request was still accepted, so Roblox isn't rejecting unsigned ticket requests yet.
- **Font:** the custom font appeared across the in-game UI and on name tags.
- **FFlags and Roblox's background process:** the first game ran on Direct3D 11 despite the OpenGL flag, because the flag had not been loaded.
  - Roblox keeps a background tray process (`AppState/TrayMode`). The one in use had started at 21:45 the night before, before the flags were written at 13:15.
  - The process Pusar started logged `WebPlay NoReload with Tray only!` and exited, leaving the old process to run the game.
  - A Roblox process that started later logged `LoadClientSettingsFromLocal` followed by the flags, so the file location is right and flags load when a process starts.
  - The font worked anyway because content files are read when the game loads.
  - **M3 requirement:** after changing FFlags, Pusar has to restart Roblox's tray process (without killing a game in progress) or tell the user to.
  - The test preset now uses `FFlagDebugSkyGray`, whose effect is obvious.
- **Gray-sky retest:** a Roblox process started at 13:50 logged `FFlagDebugSkyGray` in `LoadClientSettingsFromLocal`, and the game it ran showed a slate-gray sky instead of the bright blue one in the earlier session. The game's own event scenery still shows near the horizon.
- **OpenGL flag:** that same process loaded `FFlagDebugGraphicsPreferOpenGL` but still rendered with Direct3D 11. Being on the allowlist doesn't guarantee a flag works, so presets need testing one by one.
- **Revert on the real install:** 42 files restored and 2 added files removed. No custom font file or family reference is left, and the flags file is gone.
  - Flags stay in memory, so a running Roblox process keeps them until it restarts.
- **Roblox update:** Roblox moved to a new version folder overnight, and mods had to be applied again. Pusar's detection picked the new version automatically. Reapplying mods automatically is M3.

### Sign-in and Discord results (2026-11-08)
- **Human check:** Roblox showed a press-and-hold check on a repeat password sign-in over the VPN, and it wouldn't complete in Pusar's window. **Email a code** in that same window worked and kept signing intact (`keyPair=true`, `signed=true`). Users complete any check themselves, and Pusar must never try to automate or disguise itself from it. The real UI should make the other sign-in options easy to find.
- **Live activity:** the tracker went joining → in game within 3 seconds, and back to not in a game when the player left.
- **Discord:** presence appeared with the right game and icon but stayed on "Joining" for the whole session. Three updates were sent within 3 seconds, and the last one wasn't displayed.
  - Likely cause: Discord's rate limit. Older Discord docs give one update per 15 seconds, but don't state a limit for this RPC command, so this isn't proven.
  - Fix: `LatestValueThrottle` waits 4 seconds for changes to settle, sends only the newest state, and spaces updates at least 15 seconds apart.
  - Retest passed: Discord showed "Playing Natural Disaster Survival" 4 seconds after the join and cleared 6 seconds after leaving.
- **Remove:** ran without errors, but Roblox's reply wasn't logged at the time. It is logged now.

### Bug: Pusar kept running after its window closed (fixed 2026-11-08)
The hidden Roblox session window counts as an open window, so closing the panel after a login left the app running with nothing on screen. Each later `npm start` found it already running and exited, printing only a harmless Chromium cache error. Closing the panel now closes the hidden windows and quits. Confirmed with a test that opens a hidden window and closes the panel: exit code 3 (still running) before the fix, 0 after.

### Why the signed path failed, and the fix
Checked against `auth.roblox.com/v1/authentication-ticket/` with no credentials:
- The CORS preflight doesn't allow `RBXAuthenticationNegotiation`, so the browser rejected the first in-page attempt before sending it.
- The response we could inspect exposes no headers to page scripts (`access-control-expose-headers` was absent). The page script may therefore be unable to read the anti-forgery token.

The header is now added at the network layer (`webRequest.onBeforeSendHeaders`). The anti-forgery token is read in the main process, which also handles the retry. The reasons for any failure are now written to the log.

**Result:** confirmed in the retest. The signed in-page request returned HTTP 200 and a ticket (`via page`, `signed=true`), so Pusar doesn't depend on Roblox continuing to accept unsigned requests.

### M0 result: passed on Windows (2026-11-08)
All three spikes work on Windows, which meets the exit criteria in [PLAN.md §10](../PLAN.md).

One small check is still open: Roblox's reply to **Remove** (sign-out) hasn't been seen, because it was only logged after the last sign-out. Look for `Sign-out: Roblox replied HTTP 200` the next time an account is removed.

macOS is deferred. The macOS code paths stay in the repo but have never run on a Mac.

### What was verified automatically (2026-11-07, Windows 11, Electron 45)
- `npm test`: **55 unit tests pass**, covering:
  - launch URI and link parsing, and redaction of credentials
  - log parsing and game state, plus following a log file as it grows
  - finding installs (Windows and macOS folder layouts), FFlags, fonts and backup/revert
  - building the Discord presence
- `npm run selftest` (runs inside real Electron; never touches the real install): **6/6 checks pass**
  - Found 3 Roblox player versions. The one that `roblox-player:` links open is listed first.
  - Applied the font mod to 42 font families on a copy of the real files (CJK fallback skipped), then reverted it to an identical copy.
  - Parsed 31 real player logs and rebuilt 6 game sessions: join, server address, leave.
  - The page script loads in an isolated world and can read signing metadata. This check uses a local test page with made-up values, so it says nothing about what Roblox really requires.
- `npm start`: the panel opens with no renderer errors and no Content Security Policy violations.

### Findings so far
- **Windows:** the `roblox-player:` handler runs `RobloxPlayerBeta.exe "%1"`, so passing the launch URI as the only argument is what Roblox itself does.
- **Roblox logs:** they already contain the network lines needed for server info. No extra FFlag is required for activity tracking.
- **FFlag allowlist:** `src/core/fflags.ts` now holds the full list of 18 flags from Roblox's DevForum post (last edited 2025-10-16, copied 2026-11-08). Roblox can change it, so the M1+ canary job should compare against the post.
- **Network block:** every Roblox domain currently resolves to `0.0.0.0` on this PC's network. The DNS server is the router (`192.168.50.1`), and there's no hosts-file entry, so the block is on the router. Live tests need Roblox to be reachable.
  - The first login attempt (2026-11-07) failed with `ERR_ADDRESS_INVALID` for this reason.
  - Pusar now checks DNS before signing in, diagnosing or launching. When roblox.com is sinkholed, it shows a clear "your network is blocking roblox.com" message instead of a blank window.
  - **The check must use Chromium's resolver** (`session.resolveHost`), the same one the login window uses. A first version asked the DNS server directly through Node. That reads only the Wi-Fi adapter's DNS server and ignores VPNs, so it reported a block even with a VPN on, while Chromium and Roblox resolved fine.
  - With the VPN on, Chromium resolves roblox.com and reaches the login page, and the check reports reachable.
  - Not yet seen live: what Chromium's resolver returns on the blocked network without a VPN. If the check misses it, the login window still catches the `ERR_ADDRESS_INVALID` load error and shows the same message.
  - `npm run selftest` now reports this under `robloxReachable`.

---

## How to run

```bash
npm install
npm test            # unit tests
npm run selftest    # offline checks inside Electron, prints JSON
npm start           # opens the spike panel
```

Pusar's data (account list, backups and per-account browser profiles) is stored in `%APPDATA%\Pusar` on Windows and `~/Library/Application Support/Pusar` on macOS.

## Live test checklist (needs you)

Do these with Roblox reachable. When finished, click **Copy spike report** in the panel and paste it back. Credentials are redacted from the report.

**Spike 2: mods**
1. Click **Detect installs**. The install marked "opens links" should be selected.
2. Click **Revert all** first if older test flags are still applied. Click **Apply test FFlags**, then quit Roblox from the system tray so the new flags load. Launch a game with visible sky. If the sky is gray, the flag took effect.
3. Click **Apply custom font…** and pick a font that's easy to spot, such as Comic Sans (`comic.ttf`). Open the Roblox app. Its UI text should use that font.
4. Click **Revert all**, open Roblox again, and confirm everything looks normal.
   - Note: if Roblox updates itself, it installs a new version folder and the mods won't carry over. That's expected; Pusar's own update handling comes in M3.

**Spike 1: login and launch**
1. Click **Add account**. Sign in on the Roblox page that opens: password, captcha and 2FA.
2. Click **Diagnose** on the account. Note the results for `cookie`, `profile HTTP`, `signed` and `device key`.
   - **`device key=true` is the key finding:** Roblox stored a signing key in this account's browser profile, so signed requests are possible.
3. Enter a place ID, such as a game you play, and click **Launch game**. Roblox should open straight into that game.
   - The confirmation message shows how the ticket was obtained: `via page` or `page-webRequest` (good) or `via native` (the fallback, which will stop working once Roblox enforces device-bound sessions).
4. Quit the app, run `npm start` again, and launch again without signing in. This proves the session survives a restart.
5. Click **Remove**. The account should be signed out on Roblox's side too.

**Spike 3: activity and Discord**
1. Optional: create an app named "Pusar" at https://discord.com/developers/applications and paste its **Application ID** into the panel.
2. Click **Start watching**, then launch a game.
   - The panel should show "Playing <game>" with the game's icon.
   - With an Application ID and the Discord app open, your Discord profile should show the same.
3. Leave the game. The status should go back to "Not in a game".

## macOS checklist (deferred: use this when macOS work starts)

1. Copy or clone this folder to the Mac, then run `npm install`, `npm test` and `npm run selftest`.
2. Run the same live checklist above.
3. Also check:
   - **Does Roblox still launch after the font mod changes `Roblox.app`?** If Gatekeeper or a code-signing check blocks it, macOS falls back to FFlags only (see PLAN.md §11). AppleBlox's approach is the reference.
   - Do the paths in `src/core/install.ts` match the real app (`Contents/Resources/content`, `Contents/MacOS/ClientSettings`) and the logs folder (`~/Library/Logs/Roblox`)?

## Known gaps (deliberately left for later milestones)
- **Cookie encryption:** the Electron fuses that encrypt cookies at rest aren't turned on yet, because fuses are set when the app is packaged (M1/M6).
- **Mods and Roblox updates:** mods are applied to Roblox's own install, so a Roblox update replaces them. Bootstrapper mode and reapplying mods automatically are M3.
- **Spike panel:** the panel is a test tool. The real UI starts in M1/M5, following PLAN.md §7.
