// `pnpm --filter @caravan/web test:sandbox`: the end-to-end suite against a local NEAR sandbox node
// (src/server/__sandbox__/chain.sandbox.test.ts explains what it covers and how to run it).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.sandbox.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 10 * 60_000,
    hookTimeout: 15 * 60_000,
  },
});
