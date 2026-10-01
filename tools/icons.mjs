// The site's icons from its one drawing, packages/map/public/favicon.svg: two of the masthead's blackletter Gs on a globe,
// in the Morning Edition's ink and paper (decision 94). Writes favicon.ico (16, 32 and 48 pixels, for browsers and search
// results that ask for it), the home-screen icon on a square of paper (phones round the corners themselves and fill
// anything transparent with black) and the two sizes the web manifest lists.
// Usage: node tools/icons.mjs [chromium path]
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const pub = join(resolve(import.meta.dirname, ".."), "packages/map/public");
const svg = readFileSync(join(pub, "favicon.svg"), "utf8");
const square = svg.replace(/(<svg[^>]*>)/, '$1<rect width="32" height="32" fill="#efe9da"/>');

const b = await chromium.launch({ executablePath: process.argv[2] || process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await b.newPage();
async function png(source, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${source.replace("<svg ", `<svg width="${size}" height="${size}" `)}`);
  return page.screenshot({ omitBackground: true });
}

// An ICO file is a directory of images; each entry here is a whole PNG, which every browser since 2007 reads.
const sizes = [16, 32, 48];
const images = [];
for (const s of sizes) images.push(await png(svg, s));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  head.writeUInt8(s, at);
  head.writeUInt8(s, at + 1);
  head.writeUInt16LE(1, at + 4);
  head.writeUInt16LE(32, at + 6);
  head.writeUInt32LE(images[i].length, at + 8);
  head.writeUInt32LE(offset, at + 12);
  offset += images[i].length;
});
writeFileSync(join(pub, "favicon.ico"), Buffer.concat([head, ...images]));
writeFileSync(join(pub, "apple-touch-icon.png"), await png(square, 180));
writeFileSync(join(pub, "icon-192.png"), await png(svg, 192));
writeFileSync(join(pub, "icon-512.png"), await png(square, 512));
await b.close();
console.log("favicon.ico, apple-touch-icon.png, icon-192.png and icon-512.png written");
