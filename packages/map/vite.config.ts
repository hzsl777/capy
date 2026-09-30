import { defineConfig, type Plugin } from "vite";

/**
 * The canonical address and og:url need the site's full address, which only the deploy knows: SITE_DOMAIN (a
 * repository variable, for example globalgist.com). Without it the tags are left out, never guessed.
 */
function siteAddress(): Plugin {
  const domain = (process.env.SITE_DOMAIN ?? "").trim().replace(/^www\./, "");
  return {
    name: "site-address",
    transformIndexHtml() {
      if (!/^[a-z0-9.-]+$/i.test(domain)) return [];
      const url = `https://${domain}/`;
      return [
        { tag: "link", attrs: { rel: "canonical", href: url }, injectTo: "head" },
        { tag: "meta", attrs: { property: "og:url", content: url }, injectTo: "head" },
      ];
    },
  };
}

// BASE_PATH is set in CI for GitHub Pages project sites (e.g. "/capy/").
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
  // No source maps: the public build ships only what browsers load.
  build: { target: "es2022", sourcemap: false },
  plugins: [siteAddress()],
});
