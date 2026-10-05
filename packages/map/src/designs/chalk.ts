// Chalkboard (chalk): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./chalk.css";
import "@fontsource/patrick-hand/400.css";
import "@fontsource/fredericka-the-great/400.css";
import { registerSurface } from "../registry.ts";
import { drawChalk, ChalkCache } from "../map/chalk.ts";

registerSurface("chalk", { make: () => new ChalkCache(), draw: drawChalk });
