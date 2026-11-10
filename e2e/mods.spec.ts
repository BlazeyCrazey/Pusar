import { expect, test, type Locator, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, ORIGINAL_CURSOR, ORIGINAL_FAMILY, stubFilePicker, type RunningApp } from "./launch";

let running: RunningApp;
let scratch: string;

/** The app may be rewriting a file at this exact moment, so a failed read just means "not settled yet". */
function settled<T>(read: () => T): T | "mid-write" {
  try {
    return read();
  } catch {
    return "mid-write";
  }
}

const flags = () =>
  settled(() =>
    existsSync(running.fakeRoblox.flagsFile)
      ? (JSON.parse(readFileSync(running.fakeRoblox.flagsFile, "utf8")) as Record<string, string>)
      : null,
  );
const cursor = () => settled(() => readFileSync(running.fakeRoblox.cursorFile, "utf8"));
const family = () => settled(() => readFileSync(running.fakeRoblox.familyFile, "utf8"));
const status = (page: Page) => page.getByRole("main").getByRole("status");
const row = (page: Page, text: string | RegExp): Locator => page.getByRole("main").getByRole("listitem").filter({ hasText: text });

function writePack(id: string, name: string, files: Record<string, string>): string {
  const file = path.join(scratch, `${id}.zip`);
  writeFileSync(
    file,
    zipSync({
      "manifest.json": strToU8(JSON.stringify({ id, name, version: "1.2", author: "Someone" })),
      ...Object.fromEntries(Object.entries(files).map(([name2, text]) => [name2, strToU8(text)])),
    }),
  );
  return file;
}

test.beforeAll(async () => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "pusar-e2e-files-"));
  running = await launchApp();
  await running.page.getByRole("button", { name: "Mods", exact: true }).click();
  await running.page.getByRole("heading", { name: "Mods", level: 1 }).waitFor();
  await status(running.page).waitFor();
});

test.afterAll(async () => {
  await running.cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

test("starts with nothing applied", async () => {
  await expect(status(running.page)).toHaveText("No mods active");
  expect(flags()).toBeNull();
});

test("labels presets nobody has confirmed yet", async () => {
  const { page } = running;
  await expect(row(page, "Gray sky")).not.toContainText("Untested");
  await expect(row(page, "No grass")).toContainText("Untested");
});

test("a preset writes real flags to Roblox, and turning it off removes them", async () => {
  const { page } = running;
  await page.getByRole("switch", { name: /Gray sky/ }).click();
  await expect(status(page)).toContainText("Applied to Roblox e2e00000");
  expect(flags()).toEqual({ FFlagDebugSkyGray: "True" });
  await expect(row(page, "FFlagDebugSkyGray")).toBeVisible();

  await page.getByRole("switch", { name: /Gray sky/ }).click();
  await expect(status(page)).toHaveText("No mods active");
  expect(flags()).toBeNull();
});

test("adds an FFlag from the allowlist, edits it and removes it", async () => {
  const { page } = running;
  await page.getByRole("combobox", { name: "Add an FFlag" }).click();
  await page.getByRole("option", { name: "FIntDebugForceMSAASamples" }).click();
  const value = page.getByLabel("Value of FIntDebugForceMSAASamples");
  await expect(value).toHaveValue("0");
  await expect.poll(flags).toEqual({ FIntDebugForceMSAASamples: "0" });

  await value.fill("4");
  await value.press("Enter");
  await expect.poll(flags).toEqual({ FIntDebugForceMSAASamples: "4" });

  await page.getByRole("button", { name: "Remove FIntDebugForceMSAASamples" }).click();
  await expect(value).toBeHidden();
  await expect.poll(flags).toBeNull();
});

test("a bad value is explained and snaps back", async () => {
  const { page } = running;
  await page.getByRole("combobox", { name: "Add an FFlag" }).click();
  await page.getByRole("option", { name: "FIntDebugForceMSAASamples" }).click();
  const value = page.getByLabel("Value of FIntDebugForceMSAASamples");
  await expect(value).toHaveValue("0");

  await value.fill("lots");
  await value.press("Enter");
  await expect(page.getByText("must be a whole number").first()).toBeVisible();
  expect(flags()).toEqual({ FIntDebugForceMSAASamples: "0" });
  await page.getByRole("button", { name: "Remove FIntDebugForceMSAASamples" }).click();
  await expect.poll(flags).toBeNull();
});

test("a boolean FFlag offers True or False", async () => {
  const { page } = running;
  await page.getByRole("combobox", { name: "Add an FFlag" }).click();
  await page.getByRole("option", { name: "FFlagDebugSkyGray" }).click();
  await page.getByRole("combobox", { name: "Value of FFlagDebugSkyGray" }).click();
  await page.getByRole("option", { name: "False" }).click();
  await expect.poll(flags).toEqual({ FFlagDebugSkyGray: "False" });
  await page.getByRole("button", { name: "Remove FFlagDebugSkyGray" }).click();
  await expect.poll(flags).toBeNull();
});

test("a font applies to Roblox and can be undone exactly", async () => {
  const { app, page } = running;
  const font = path.join(scratch, "Comic.ttf");
  writeFileSync(font, Buffer.from([0, 1, 0, 0, 1, 2, 3, 4]));
  await stubFilePicker(app, font);

  await page.getByRole("button", { name: "Choose font" }).click();
  await expect(page.getByText("Comic.ttf")).toBeVisible();
  expect(family()).toContain("PusarCustomFont.ttf");

  await page.getByRole("button", { name: "Use default" }).click();
  await expect(page.getByText("Roblox's default fonts")).toBeVisible();
  expect(family()).toBe(ORIGINAL_FAMILY);
});

test("a file that isn't really a font is refused", async () => {
  const { app, page } = running;
  const fake = path.join(scratch, "Fake.ttf");
  writeFileSync(fake, "this is not a font");
  await stubFilePicker(app, fake);
  await page.getByRole("button", { name: "Choose font" }).click();
  await expect(page.getByText("That file isn't a valid font.").first()).toBeVisible();
  expect(family()).toBe(ORIGINAL_FAMILY);
});

test.describe("mod packs", () => {
  test("imports a pack and applies it", async () => {
    const { app, page } = running;
    await stubFilePicker(app, writePack("cool-cursors", "Cool Cursors", { "content/textures/Cursors/ArrowCursor.png": "modded-cursor" }));
    await page.getByRole("button", { name: "Import pack" }).click();
    await expect(row(page, /^Cool Cursors/)).toContainText("v1.2 · by Someone · 1 files");
    expect(cursor()).toBe("modded-cursor");
  });

  test("turning a pack off restores Roblox's file", async () => {
    const { page } = running;
    await page.getByRole("switch", { name: /Cool Cursors/ }).click();
    await expect.poll(cursor).toBe(ORIGINAL_CURSOR);
    await page.getByRole("switch", { name: /Cool Cursors/ }).click();
    await expect.poll(cursor).toBe("modded-cursor");
  });

  test("warns when two packs replace the same file", async () => {
    const { app, page } = running;
    await stubFilePicker(app, writePack("other-cursors", "Other Cursors", { "content/textures/Cursors/ArrowCursor.png": "other-cursor" }));
    await page.getByRole("button", { name: "Import pack" }).click();
    await expect(row(page, /^Cool Cursors/)).toContainText("Replaces the same files as Other Cursors");
  });

  test("Use mods off restores everything and remembers the choices", async () => {
    const { page } = running;
    await page.getByRole("switch", { name: "Use mods" }).click();
    await expect(status(page)).toContainText("Off. Roblox is using its original files.");
    await expect.poll(cursor).toBe(ORIGINAL_CURSOR);
    await expect(row(page, /^Cool Cursors/)).toBeVisible();

    await page.getByRole("switch", { name: "Use mods" }).click();
    await expect.poll(cursor).not.toBe(ORIGINAL_CURSOR);
  });

  test("removing asks first, and restores Roblox's file", async () => {
    const { page } = running;
    await page.getByRole("button", { name: "Remove Other Cursors" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(row(page, /^Other Cursors/)).toHaveCount(0);
    await expect.poll(cursor).toBe("modded-cursor");

    await page.getByRole("button", { name: "Remove Cool Cursors" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect.poll(cursor).toBe(ORIGINAL_CURSOR);
  });

  test("refuses a pack containing a program", async () => {
    const { app, page } = running;
    await stubFilePicker(app, writePack("bad", "Bad Pack", { "content/textures/run.exe": "MZ" }));
    await page.getByRole("button", { name: "Import pack" }).click();
    await expect(page.getByText("This pack has a file type Pusar won't install: run.exe").first()).toBeVisible();
    await expect(row(page, "Bad Pack")).toHaveCount(0);
  });

  test("refuses a pack that tries to write outside Roblox's content folder", async () => {
    const { app, page } = running;
    await stubFilePicker(app, writePack("sneaky", "Sneaky", { "content/textures/../../../../sneaky.png": "x" }));
    await page.getByRole("button", { name: "Import pack" }).click();
    await expect(page.getByText(/This pack has an unsafe file path/).first()).toBeVisible();
    await expect(row(page, "Sneaky")).toHaveCount(0);
  });
});

test("produced no console errors or CSP violations", () => {
  expect(running.problems).toEqual([]);
});
