import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  timeout: 30_000,
  // One Electron app at a time: each test file drives a real window.
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
});
