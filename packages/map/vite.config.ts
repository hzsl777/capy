import { defineConfig } from "vite";

// BASE_PATH is set in CI for GitHub Pages project sites (e.g. "/capy/").
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
  // No source maps: the public build ships only what browsers load.
  build: { target: "es2022", sourcemap: false },
});
