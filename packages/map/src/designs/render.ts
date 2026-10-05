// First Render (render): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./render.css";
import "@fontsource/rubik/500.css";
import "@fontsource/rubik/700.css";
import "@fontsource/rubik/800-italic.css";
import "@fontsource/rubik/900-italic.css";
import "@fontsource/rubik/400.css";
import "@fontsource/rubik-mono-one/400.css";
import { registerSurface } from "../registry.ts";
import { drawRender, RenderCache } from "../map/render.ts";

registerSurface("render", { make: () => new RenderCache(), draw: drawRender });
