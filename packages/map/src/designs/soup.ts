// Noodle Bowl (soup): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./soup.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/400-italic.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/sniglet/400.css";
import "@fontsource/sniglet/800.css";
import { registerSurface } from "../registry.ts";
import { drawSoup, SoupCache } from "../map/soup.ts";

registerSurface("soup", {
  make: () => new SoupCache(),
  draw: drawSoup,
  wobble: (c, now, lon, lat, zoom, scale, w, h, still) => c.wobble.step(now, lon, lat, zoom, scale, w, h, still),
});
