import { defineConfig } from "vite";

// BASE_PATH is set in CI for GitHub Pages project sites (e.g. "/capy/").
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
  build: { target: "es2022", sourcemap: true },
});
