// App-wide UI state, shared by the screens and the status bar.
import { create } from "zustand";
import { ROBLOX_BUSY, ROBLOX_UNREACHABLE } from "../../shared/messages";
import type {
  AccountOverview,
  ActivityUpdate,
  AddAccountResult,
  FriendView,
  InstanceState,
  Library,
  LibraryGame,
  ResolvedGame,
  RobloxInstall,
  UpdateStatus,
} from "../../shared/types";
import { call } from "./api";
import { t } from "./i18n";

/** How often to try again while Roblox can't be reached. */
export const ROBLOX_RETRY_MS = 5000;

export type ViewId = "welcome" | "play" | "library" | "mods" | "accounts" | "settings" | "gallery";

export type Loaded<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "error"; message: string };

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

const serverLink = (placeId: string, jobId: string) =>
  `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${jobId}`;

const launchTarget = ({ target }: ResolvedGame) => (target.jobId ? serverLink(target.placeId, target.jobId) : target.placeId);

interface AppStore {
  view: ViewId;
  /** False until the first screen is known, so Play doesn't flash before first-run setup. */
  booted: boolean;
  installs: Loaded<RobloxInstall[]>;
  overview: Loaded<AccountOverview>;
  selected: ResolvedGame | null;
  /** Name of the game being launched, or null when idle. */
  launchingGame: string | null;
  /** Whether Roblox is running a game, as reported by the main process. */
  instance: InstanceState;
  /** The game being played, or null. */
  activity: ActivityUpdate | null;
  library: Loaded<Library>;
  update: UpdateStatus;

  setView(view: ViewId): void;
  start(): Promise<void>;
  /** Detects Roblox again, for when someone installs it while Pusar is open. */
  detectInstalls(): Promise<void>;
  /** Leaves first-run setup for good. */
  finishSetup(): Promise<void>;
  refreshOverview(): Promise<void>;
  setActiveAccount(id: string): Promise<void>;
  addAccount(): Promise<AddAccountResult>;
  removeAccount(id: string): Promise<void>;
  /** Accepts a place ID or link. Rejects with a message for the user. */
  selectGame(input: string): Promise<void>;
  /** Reopens the last game, waiting out a lost connection. */
  restoreLastGame(placeId: string): Promise<void>;
  /** Someone started browsing, so the last game mustn't appear over what they're doing. */
  stopRestoringLastGame(): void;
  clearSelection(): void;
  /** Resolves with a warning if the game started but mods couldn't be applied. */
  launch(): Promise<string | undefined>;
  /** Opens the friend's server on Play and launches it. Resolves like launch(). */
  joinFriend(join: NonNullable<FriendView["join"]>): Promise<string | undefined>;
  killInstance(): Promise<void>;
  refreshLibrary(): Promise<void>;
  checkForUpdates(): Promise<void>;
  /** Restarts Pusar into the downloaded update. Roblox keeps running. */
  installUpdate(): Promise<void>;
  setFavorite(game: LibraryGame, favorite: boolean): Promise<void>;
}

// Only the most recent selection may land, even if an earlier lookup finishes later.
let latestSelection = 0;
let subscribedToInstance = false;

export const useApp = create<AppStore>((set, get) => ({
  view: "play",
  booted: false,
  installs: { state: "loading" },
  overview: { state: "loading" },
  selected: null,
  launchingGame: null,
  instance: { status: "idle" },
  activity: null,
  library: { state: "loading" },
  update: { state: "unsupported" },

  setView: (view) => set({ view }),

  async start() {
    if (!subscribedToInstance) {
      subscribedToInstance = true;
      window.pusar.onInstance((instance) => set({ instance }));
      window.pusar.onActivity((update) => set({ activity: update.state.status === "idle" ? null : update }));
      window.pusar.onUpdate((update) => set({ update }));
    }
    call("instance:state").then((instance) => set({ instance }), () => {});
    call("activity:current").then((activity) => set({ activity }), () => {});
    call("update:status").then((update) => set({ update }), () => {});
    void get().refreshLibrary();

    void get().detectInstalls();
    const [, prefs] = await Promise.all([get().refreshOverview(), call("prefs:get").catch(() => null)]);

    // Someone who already added an account has clearly found their way around.
    const { overview } = get();
    const noAccounts = overview.state === "ready" && overview.value.accounts.length === 0;
    if (!prefs?.onboarded && noAccounts) set({ view: "welcome" });
    set({ booted: true });

    if (prefs?.lastPlaceId && !get().selected) void get().restoreLastGame(prefs.lastPlaceId);
  },

  async detectInstalls() {
    try {
      set({ installs: { state: "ready", value: await call("install:detect") } });
    } catch (err) {
      set({ installs: { state: "error", message: messageOf(err) } });
    }
  },

  async finishSetup() {
    await call("prefs:set", { onboarded: true });
    set({ view: "play" });
  },

  async refreshOverview() {
    try {
      set({ overview: { state: "ready", value: await call("accounts:overview") } });
    } catch (err) {
      set({ overview: { state: "error", message: messageOf(err) } });
    }
  },

  async setActiveAccount(id) {
    set({ overview: { state: "ready", value: await call("accounts:setActive", { id }) } });
  },

  async addAccount() {
    const result = await call("accounts:add");
    await get().refreshOverview();
    return result;
  },

  async removeAccount(id) {
    await call("accounts:remove", { id });
    await get().refreshOverview();
  },

  async selectGame(input) {
    const selection = ++latestSelection;
    const resolved = await call("games:resolve", { input });
    if (selection === latestSelection) set({ selected: resolved });
  },

  async restoreLastGame(placeId) {
    const selection = ++latestSelection;
    while (selection === latestSelection) {
      try {
        const resolved = await call("games:resolve", { input: placeId });
        if (selection === latestSelection) set({ selected: resolved });
        return;
      } catch (err) {
        // A game that's gone stays gone. Only a temporary problem is worth waiting out.
        const message = messageOf(err);
        if (message !== ROBLOX_UNREACHABLE && message !== ROBLOX_BUSY) return;
      }
      await new Promise((resolve) => setTimeout(resolve, ROBLOX_RETRY_MS));
    }
  },

  stopRestoringLastGame() {
    latestSelection++;
  },

  clearSelection() {
    latestSelection++;
    set({ selected: null });
  },

  async killInstance() {
    set({ instance: await call("instance:kill") });
  },

  async launch() {
    const { selected, overview } = get();
    const accountId = overview.state === "ready" ? overview.value.activeAccountId : null;
    if (!selected || !accountId) return;

    set({ launchingGame: selected.game.name });
    try {
      // Detect again: a Roblox update can replace the install at any time.
      const installs = await call("install:detect");
      set({ installs: { state: "ready", value: installs } });
      const [install] = installs;
      if (!install) throw new Error(t("game.robloxMissingShort"));
      const result = await call("launch:place", { accountId, rootDir: install.rootDir, target: launchTarget(selected) });
      return result.warning;
    } finally {
      set({ launchingGame: null });
    }
  },

  async joinFriend({ placeId, jobId }) {
    await get().selectGame(serverLink(placeId, jobId));
    set({ view: "play" });
    return get().launch();
  },

  async checkForUpdates() {
    set({ update: await call("update:check") });
  },

  async installUpdate() {
    await call("update:install");
  },

  async refreshLibrary() {
    try {
      set({ library: { state: "ready", value: await call("library:get") } });
    } catch (err) {
      set({ library: { state: "error", message: messageOf(err) } });
    }
  },

  async setFavorite({ universeId, placeId, name, creatorName }, favorite) {
    const value = await call("library:setFavorite", { game: { universeId, placeId, name, creatorName }, favorite });
    set({ library: { state: "ready", value } });
  },
}));
