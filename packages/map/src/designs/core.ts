// Green Core (core): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./core.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/400-italic.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/unbounded/700.css";
import "@fontsource/unbounded/900.css";
import { registerSurface } from "../registry.ts";
import { drawCore, CoreCache } from "../map/core.ts";

registerSurface("core", { make: () => new CoreCache(), draw: drawCore });
