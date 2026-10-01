import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/map/test/**/*.test.ts"],
    environment: "node",
    // Many tests start a fresh in-memory Postgres (PGlite) with every migration. Under a full parallel run that
    // can pass the 10 second default on a busy machine without anything being wrong.
    hookTimeout: 60_000,
    // The same goes for the tests that run a whole day's stages on that database: about two seconds alone, past the
    // 5 second default when the machine is busy.
    testTimeout: 30_000,
  },
});
