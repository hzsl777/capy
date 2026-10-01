import { defineConfig, type Plugin } from "vite";

/**
 * The canonical address, og:url and the share image need the site's full address: globalgist.io, or SITE_DOMAIN when a
 * build sets it (decision 94). Link previews need the image's full address, so the default keeps them working on a build
 * nobody configured.
 */
const SITE_DOMAIN = "globalgist.io";

function siteAddress(): Plugin {
  const domain = (process.env.SITE_DOMAIN || SITE_DOMAIN).trim().replace(/^www\./, "");
  return {
    name: "site-address",
    transformIndexHtml() {
      if (!/^[a-z0-9.-]+$/i.test(domain)) return [];
      const url = `https://${domain}/`;
      return [
        { tag: "link", attrs: { rel: "canonical", href: url }, injectTo: "head" },
        { tag: "meta", attrs: { property: "og:url", content: url }, injectTo: "head" },
        // The day's share image (decision 92); link previews need its full address.
        { tag: "meta", attrs: { property: "og:image", content: `${url}og.png` }, injectTo: "head" },
        { tag: "meta", attrs: { name: "twitter:image", content: `${url}og.png` }, injectTo: "head" },
      ];
    },
  };
}

/**
 * The minifier writes the stylesheet's arrows and ornaments (the menus' carets, the check marks) as UTF-8 characters
 * and drops any @charset. A stylesheet with no charset of its own is read in its page's encoding, so a page that
 * doesn't declare UTF-8 (the body alone, served inside another page) showed each caret as three wrong letters. Saying
 * so at the top of the file fixes it.
 */
function cssCharset(): Plugin {
  return {
    name: "css-charset",
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) continue;
        const css = typeof file.source === "string" ? file.source : new TextDecoder().decode(file.source);
        if (/[^\x00-\x7f]/.test(css) && !css.startsWith("@charset")) file.source = `@charset "UTF-8";${css}`;
      }
    },
  };
}

// BASE_PATH is set in CI for GitHub Pages project sites (e.g. "/capy/").
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
  // No source maps: the public build ships only what browsers load.
  build: { target: "es2022", sourcemap: false },
  plugins: [siteAddress(), cssCharset()],
});
