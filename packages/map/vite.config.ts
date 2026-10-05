import { createHash } from "node:crypto";
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

/**
 * Every design but the default is a chunk loaded when it is shown (src/registry.ts). A returning reader whose saved
 * design is not Morning Edition would otherwise wait for the whole page's script before its chunk even starts, and see
 * Morning Edition's chrome meanwhile. So the page opens with a tiny script (the CSP forbids inline ones) that reads
 * the saved design, holds the page back (`data-boot` on <html>, src/style.css) and starts that design's files loading
 * beside the main chunk. It carries a table of every design's files, which only the build knows (their names are
 * hashed), so it is written here with the page. The dev server has none: src/main.ts loads the design itself.
 */
function designBoot(): Plugin {
  let base = "./";
  return {
    name: "design-boot",
    enforce: "post",
    configResolved(config) {
      base = config.base;
    },
    generateBundle(_, bundle) {
      const page = bundle["index.html"];
      if (!page || page.type !== "asset") return;
      const files: string[] = [];
      const at = (file: string) => {
        const name = file.replace(/^assets\//, "");
        const i = files.indexOf(name);
        return i >= 0 ? i : files.push(name) - 1;
      };
      // A design's files: its own chunk and CSS, and those of the shared chunks it imports, bar the main chunk.
      const table: Record<string, [number[], number[]]> = {};
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isDynamicEntry) continue;
        const id = /\/src\/designs\/([\w-]+)\.ts$/.exec(chunk.facadeModuleId ?? "")?.[1];
        if (!id) continue;
        const js = new Set<string>();
        const css = new Set<string>();
        const visit = (name: string) => {
          const c = bundle[name];
          if (!c || c.type !== "chunk" || c.isEntry || js.has(name)) return;
          js.add(name);
          for (const f of c.viteMetadata?.importedCss ?? []) css.add(f);
          for (const dep of c.imports) visit(dep);
        };
        visit(chunk.fileName);
        table[id] = [[...js].map(at), [...css].map(at)];
      }
      const code = `(function(){try{var T=${JSON.stringify(files)},D=${JSON.stringify(table)},R={cotton:"candy"},c=[new URLSearchParams(location.search).get("theme")],d,i,j,l,id;try{c.push(localStorage.getItem("capy.theme"))}catch(e){}for(i=0;i<c.length;i++){id=R[c[i]]||c[i];if(id==="morning")return;if(id&&D.hasOwnProperty(id)){d=D[id];break}}if(!d)return;var b=document.currentScript.src,h=document.head;document.documentElement.setAttribute("data-boot",id);for(j=0;j<d[0].length;j++){l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";l.href=new URL(T[d[0][j]],b).href;h.appendChild(l)}for(j=0;j<d[1].length;j++){l=document.createElement("link");l.rel="stylesheet";l.crossOrigin="";l.href=new URL(T[d[1][j]],b).href;h.appendChild(l)}}catch(e){}})();\n`;
      const hash = createHash("sha256").update(code).digest("hex").slice(0, 8);
      const fileName = `assets/boot-${hash}.js`;
      this.emitFile({ type: "asset", fileName, source: code });
      // First in the body, so the page's stylesheet (in the head) is already in and the design's comes after it.
      const html = String(page.source).replace(/<body[^>]*>/, (open) => `${open}\n    <script src="${base}${fileName}"></script>`);
      page.source = html;
    },
  };
}

// BASE_PATH is set in CI for GitHub Pages project sites (e.g. "/capy/").
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
  // No source maps: the public build ships only what browsers load.
  build: { target: "es2022", sourcemap: false },
  plugins: [siteAddress(), cssCharset(), designBoot()],
});
