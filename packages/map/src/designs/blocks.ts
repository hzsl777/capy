// Block World (blocks): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./blocks.css";
import "@fontsource/press-start-2p/400.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import { registerSurface } from "../registry.ts";
import { drawBlocks, BlocksCache } from "../map/blocks.ts";

registerSurface("blocks", { make: () => new BlocksCache(), draw: (f, c) => void drawBlocks(f, c) });
