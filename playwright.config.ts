import { defineConfig, devices } from "@playwright/test";

const port = 3197;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && node e2e/start-server.mjs",
    url: `http://localhost:${port}/healthz`,
    env: { PORT: String(port) },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
