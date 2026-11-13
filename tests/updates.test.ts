import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateService, type Updater } from "../src/core/updates";
import type { UpdateStatus } from "../src/shared/types";

// Shaped like electron-updater's AppUpdater, which emits the same events.
class FakeUpdater extends EventEmitter {
  allowPrerelease = false;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checkForUpdates = vi.fn(async () => {
    this.emit("checking-for-update");
    return null;
  });
  quitAndInstall = vi.fn();
}

function setUp() {
  const updater = new FakeUpdater();
  const seen: UpdateStatus[] = [];
  const logs: string[] = [];
  const service = new UpdateService(updater as unknown as Updater, (status) => seen.push(status), (line) => logs.push(line), () => 1234);
  return { updater, service, seen, logs };
}

afterEach(() => vi.useRealTimers());

describe("UpdateService", () => {
  it("does nothing in a build that can't update itself", async () => {
    const service = new UpdateService(null, () => {}, () => {});
    expect(service.status).toEqual({ state: "unsupported" });
    expect(await service.check()).toEqual({ state: "unsupported" });
    service.install();
  });

  it("downloads in the background and installs when Pusar quits", () => {
    const { updater } = setUp();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it("follows a check through download to ready", async () => {
    const { updater, service, seen } = setUp();
    await service.check();
    updater.emit("update-available", { version: "1.2.0" });
    updater.emit("download-progress", { percent: 41.6 });
    updater.emit("update-downloaded", { version: "1.2.0" });
    expect(seen).toEqual([
      { state: "checking" },
      { state: "downloading", version: "1.2.0", percent: 0 },
      { state: "downloading", version: "1.2.0", percent: 42 },
      { state: "ready", version: "1.2.0" },
    ]);
  });

  it("says when Pusar is up to date", async () => {
    const { updater, service } = setUp();
    await service.check();
    updater.emit("update-not-available", {});
    expect(service.status).toEqual({ state: "upToDate", checkedAt: 1234 });
  });

  it("logs only the first line of an error, and keeps a finished download", () => {
    const { updater, service, logs } = setUp();
    updater.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED\n    at stack"));
    expect(service.status).toEqual({ state: "error" });
    expect(logs).toEqual(["Updates: net::ERR_INTERNET_DISCONNECTED"]);

    updater.emit("update-downloaded", { version: "2.0.0" });
    updater.emit("error", new Error("later check failed"));
    expect(service.status).toEqual({ state: "ready", version: "2.0.0" });
  });

  it("doesn't start a second check while one is running or an update is waiting", async () => {
    const { updater, service } = setUp();
    await service.check();
    await service.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.emit("update-downloaded", { version: "2.0.0" });
    await service.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("survives a check that throws", async () => {
    const { updater, service } = setUp();
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit("error", new Error("offline"));
      throw new Error("offline");
    });
    expect(await service.check()).toEqual({ state: "error" });
  });

  it("installs only a downloaded update, and restarts Pusar afterwards", () => {
    const { updater, service } = setUp();
    service.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    updater.emit("update-downloaded", { version: "2.0.0" });
    service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("keeps a beta install on betas even with the switch off", () => {
    const updater = new FakeUpdater();
    const service = new UpdateService(updater as unknown as Updater, () => {}, () => {}, Date.now, true);
    service.setBeta(false);
    expect(updater.allowPrerelease).toBe(true);
  });

  it("switches beta updates on and off", () => {
    const { updater, service } = setUp();
    service.setBeta(true);
    expect(updater.allowPrerelease).toBe(true);
    service.setBeta(false);
    expect(updater.allowPrerelease).toBe(false);
  });

  it("waits a little after startup, then checks every few hours", () => {
    vi.useFakeTimers();
    const { updater, service } = setUp();
    service.start();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.emit("update-not-available", {});
    vi.advanceTimersByTime(6 * 60 * 60_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    service.stop();
  });
});
