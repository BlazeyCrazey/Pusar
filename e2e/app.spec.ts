import { expect, test } from "@playwright/test";
import { launchApp, type RunningApp } from "./launch";

let running: RunningApp;

test.beforeAll(async () => {
  running = await launchApp();
});

test.afterAll(async () => {
  await running.cleanup();
});

test.describe("app shell", () => {
  test("opens on Play with the title bar, nav and status bar", async () => {
    const { page } = running;
    await expect(page).toHaveTitle("Pusar");
    await expect(page.getByRole("heading", { name: "Play", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("contentinfo")).toContainText(/Roblox/);
    await expect(page.getByRole("contentinfo")).toContainText("No account added");
    await page.screenshot({ path: "test-results/shell-play.png" });
  });

  for (const name of ["Library", "Mods", "Accounts", "Settings", "Play"]) {
    test(`navigates to ${name}`, async () => {
      const { page } = running;
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "page");
    });
  }
});

test.describe("component kit", () => {
  test.beforeAll(async () => {
    await running.page.getByRole("button", { name: "Kit", exact: true }).click();
    await running.page.getByRole("heading", { name: "Kit", level: 1 }).waitFor();
  });

  test("renders with the bundled fonts", async () => {
    const { page } = running;
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
    expect(loaded.join()).toContain("Instrument Sans Variable");
    await page.screenshot({ path: "test-results/kit.png", fullPage: false });
  });

  test("select opens and picks a value", async () => {
    const { page } = running;
    await page.getByRole("combobox", { name: "Release channel" }).click();
    await page.screenshot({ path: "test-results/kit-select.png" });
    await page.getByRole("option", { name: "Beta" }).click();
    await expect(page.getByRole("combobox", { name: "Release channel" })).toContainText("Beta");
  });

  test("switch toggles", async () => {
    const toggle = running.page.getByRole("switch", { name: /Show my game on Discord/ });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
  });

  test("dialog opens, traps focus and closes", async () => {
    const { page } = running;
    await page.getByRole("button", { name: "Open dialog" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove this account?" });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: "test-results/kit-dialog.png" });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("toast appears", async () => {
    const { page } = running;
    await page.getByRole("button", { name: "Show toast" }).click();
    await expect(page.getByText("Reapplying 3 mods.").first()).toBeVisible();
    await page.screenshot({ path: "test-results/kit-toast.png" });
  });

  test("the UI produced no console errors or CSP violations", () => {
    expect(running.problems).toEqual([]);
  });
});
