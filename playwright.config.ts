import { defineConfig, devices } from "@playwright/test";
import { e2ePort } from "./e2e/config.mjs";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${e2ePort}`,
    trace: "retain-on-failure",
  },
  // Every spec runs twice: wide and light, then phone-sized and dark. A spec that
  // checks the theme sets its own colorScheme.
  projects: [
    {
      name: "desktop-light",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        colorScheme: "light",
      },
    },
    {
      name: "mobile-dark",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        colorScheme: "dark",
      },
    },
  ],
  webServer: {
    command: "pnpm build && node e2e/start-server.mjs",
    url: `http://localhost:${e2ePort}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
