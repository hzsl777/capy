// Desktop 95 (desktop): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./desktop.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawDesktop, DesktopCache } from "../map/desktop.ts";
import * as desktopUi from "../ui/desktop.ts";

registerSurface("desktop", { make: () => new DesktopCache(), draw: drawDesktop });
registerUi("desktop", desktopUi);
