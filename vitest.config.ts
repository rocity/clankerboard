import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    globalSetup: ["apps/server/test/global-setup.ts"],
    setupFiles: ["apps/server/test/worker-setup.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
