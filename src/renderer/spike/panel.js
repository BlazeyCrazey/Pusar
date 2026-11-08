// Spike panel logic. Talks to the main process only through window.pusar.
const $ = (selector) => document.querySelector(selector);

let installs = [];
let selectedRoot = null;
let accounts = [];
let toastTimer = null;

function toast(message, ok = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = ok ? "ok" : "";
  el.hidden = false;
  clearTimeout(toastTimer);
  // Long explanations (like the network-block message) need more reading time.
  toastTimer = setTimeout(() => (el.hidden = true), Math.max(6000, message.length * 70));
}

async function call(channel, payload) {
  const res = await window.pusar.invoke(channel, payload);
  if (!res.ok) {
    toast(res.error);
    throw new Error(res.error);
  }
  return res.data;
}

/** Disables the button while the action runs. */
function bind(selector, action) {
  const button = $(selector);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await action();
    } catch {
      // Already shown as a toast.
    } finally {
      button.disabled = false;
    }
  });
}

function requireInstall() {
  if (!selectedRoot) {
    toast("Detect and select a Roblox install first.");
    throw new Error("no install");
  }
  return selectedRoot;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

// ---- installs ----

function renderInstalls() {
  const list = $("#installs");
  list.replaceChildren();
  if (installs.length === 0) {
    list.append(el("p", { class: "muted" }, "No Roblox install found."));
    return;
  }
  for (const install of installs) {
    const radio = el("input", { type: "radio", name: "install" });
    radio.checked = install.rootDir === selectedRoot;
    radio.addEventListener("change", () => {
      selectedRoot = install.rootDir;
      refreshMods();
    });
    list.append(
      el(
        "label",
        { class: "item" },
        radio,
        el(
          "div",
          { class: "grow" },
          el("div", {}, `${install.source} · ${install.versionId ?? "unknown version"}`),
          el("div", { class: "path", title: install.playerPath }, install.playerPath),
        ),
        el("span", { class: `badge ${install.isProtocolHandler ? "on" : ""}` }, install.isProtocolHandler ? "opens links" : "not default"),
        el("span", { class: `badge ${install.hasFontFamilies ? "on" : ""}` }, install.hasFontFamilies ? "fonts ok" : "no fonts dir"),
      ),
    );
  }
}

async function refreshMods() {
  if (!selectedRoot) return;
  const status = await call("mods:status", { rootDir: selectedRoot });
  const flags = status.flags.length
    ? status.flags.map((f) => `${f.name} = ${f.value}  [${f.status}]`).join("\n")
    : "No FFlags set.";
  $("#mods-status").textContent = `${flags}\nFiles changed by Pusar: ${status.changedFiles}`;
}

bind("#detect", async () => {
  installs = await call("install:detect");
  selectedRoot = installs[0]?.rootDir ?? null;
  renderInstalls();
  await refreshMods();
});

bind("#apply-flags", async () => {
  await call("mods:applyFlags", { rootDir: requireInstall(), preset: "spikeTest" });
  await refreshMods();
  toast("FFlags written. Quit Roblox from the system tray, then launch a game: the sky should be gray.", true);
});

bind("#apply-font", async () => {
  const result = await call("mods:applyFont", { rootDir: requireInstall() });
  if (result) toast(`Font applied to ${result.familiesUpdated.length} font families.`, true);
  await refreshMods();
});

bind("#revert", async () => {
  const result = await call("mods:revert", { rootDir: requireInstall() });
  toast(`Restored ${result.restored} file(s), removed ${result.removed}.`, true);
  await refreshMods();
});

// ---- accounts ----

function renderAccounts() {
  const list = $("#accounts");
  list.replaceChildren();
  const select = $("#launch-account");
  select.replaceChildren();
  if (accounts.length === 0) {
    list.append(el("p", { class: "muted" }, "No accounts yet."));
    select.append(el("option", { value: "" }, "Add an account first"));
    return;
  }
  for (const account of accounts) {
    list.append(
      el(
        "div",
        { class: "item" },
        el(
          "div",
          { class: "grow" },
          el("div", {}, account.displayName),
          el("div", { class: "path" }, `@${account.username}`),
        ),
        el("button", { class: "secondary", onclick: () => diagnose(account) }, "Diagnose"),
        el("button", { class: "danger", onclick: () => removeAccount(account) }, "Remove"),
      ),
    );
    select.append(el("option", { value: account.id }, `${account.displayName} (@${account.username})`));
  }
}

async function loadAccounts() {
  accounts = await call("accounts:list");
  renderAccounts();
}

async function diagnose(account) {
  const result = await call("accounts:diagnose", { id: account.id });
  toast(
    `cookie=${result.hasCookie} · profile HTTP ${result.profileRequest.status} · signed=${result.profileRequest.signed} · device key=${result.hba.hasKeyPair}`,
    result.profileRequest.status === 200,
  );
}

async function removeAccount(account) {
  await call("accounts:remove", { id: account.id });
  await loadAccounts();
}

bind("#add-account", async () => {
  const result = await call("accounts:add");
  if (result.account) {
    toast(result.duplicate ? "That account was already added." : `Signed in as ${result.account.username}.`, true);
  }
  await loadAccounts();
});

// ---- launch ----

bind("#launch", async () => {
  const accountId = $("#launch-account").value;
  if (!accountId) return toast("Add an account first.");
  const result = await call("launch:place", { accountId, rootDir: requireInstall(), target: $("#place").value });
  toast(`Roblox started (ticket via ${result.via}, signed=${result.signed}).`, true);
});

bind("#open-app", async () => {
  await call("launch:app", { rootDir: requireInstall() });
});

// ---- activity ----

const discordInput = $("#discord-id");
discordInput.value = localStorage.getItem("discordClientId") ?? "";
discordInput.addEventListener("change", () => localStorage.setItem("discordClientId", discordInput.value.trim()));

bind("#activity-start", async () => {
  await call("activity:start", {
    rootDir: requireInstall(),
    discordClientId: discordInput.value.trim(),
    followExistingLog: $("#follow-existing").checked,
  });
  $("#activity").textContent = "Watching for a game…";
});

bind("#activity-stop", async () => {
  await call("activity:stop");
  $("#activity").textContent = "Not watching.";
});

window.pusar.onActivity(({ state, game, presence }) => {
  const box = $("#activity");
  box.replaceChildren();
  if (state.status === "idle") {
    box.append("Not in a game.");
    return;
  }
  if (game?.iconUrl) box.append(el("img", { src: game.iconUrl, alt: "" }));
  box.append(
    el(
      "div",
      {},
      el("div", {}, presence?.details ?? state.status),
      el("div", { class: "muted small" }, `${presence?.state ?? ""} · place ${state.placeId}`),
    ),
  );
});

// ---- log + report ----

const logEl = $("#log");
function appendLog(line) {
  const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 4;
  logEl.textContent += `${line}\n`;
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}
window.pusar.onLog(appendLog);

bind("#copy-report", async () => {
  const report = await call("spike:report");
  await navigator.clipboard.writeText(report);
  toast("Spike report copied (credentials redacted).", true);
});

(async () => {
  for (const line of await call("log:history")) appendLog(line);
  await loadAccounts();
})();
