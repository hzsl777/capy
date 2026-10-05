// Zine (zine): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./zine.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import "@fontsource/bowlby-one/400.css";
import { registerKit, registerSurface } from "../registry.ts";
import * as zine from "../map/zine.ts";

registerKit("zine", zine);
registerSurface("zine", { make: () => new zine.ZineCache(), draw: (f, c) => void zine.drawZine(f, c) });
