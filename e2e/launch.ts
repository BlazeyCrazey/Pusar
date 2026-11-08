import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RunningApp {
  app: ElectronApplication;
  page: Page;
  /** Console errors and uncaught exceptions, including CSP violations. */
  problems: string[];
  cleanup: () => Promise<void>;
}

/** Starts the built app with a throwaway profile, so tests never touch real accounts. */
export async function launchApp(options: { args?: string[]; ready?: string } = {}): Promise<RunningApp> {
  const userData = mkdtempSync(path.join(os.tmpdir(), "pusar-e2e-"));
  const app = await electron.launch({ args: [".", `--user-data-dir=${userData}`, ...(options.args ?? [])] });
  const page = await app.firstWindow();
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));
  await page.locator(options.ready ?? "nav[aria-label=Main]").waitFor();

  return {
    app,
    page,
    problems,
    cleanup: async () => {
      await app.close().catch(() => {});
      rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
