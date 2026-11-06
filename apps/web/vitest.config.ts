import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The NEAR sandbox suite needs a sandbox node and a built wasm; it runs only with vitest.sandbox.config.ts.
    exclude: [...configDefaults.exclude, "src/**/*.sandbox.test.ts"],
    environment: "node",
  },
});
