import { defineConfig } from "vitest/config";

// BASE_PATH is set in CI for GitHub Pages project sites (e.g. "/capy/").
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
  build: { target: "es2022", sourcemap: true },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
