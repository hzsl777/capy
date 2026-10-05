// Lava Lamp (lava): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./lava.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/400-italic.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/shrikhand/400.css";
import "@fontsource/shrikhand/latin-400.css";
import "@fontsource/shrikhand/latin-ext-400.css";
import "@fontsource/righteous/400.css";
import { registerSurface } from "../registry.ts";
import { drawLava, LavaCache } from "../map/lava.ts";

registerSurface("lava", { make: () => new LavaCache(), draw: (f, c) => void drawLava(f, c) });
