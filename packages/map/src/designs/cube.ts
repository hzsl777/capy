// Couch Potato (cube): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./cube.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/400-italic.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/m-plus-rounded-1c/latin-500.css";
import "@fontsource/m-plus-rounded-1c/latin-800.css";
import "@fontsource/m-plus-rounded-1c/latin-ext-500.css";
import "@fontsource/m-plus-rounded-1c/latin-ext-800.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawGloss, GlossCache } from "../map/gloss.ts";
import * as channelsUi from "../ui/channels.ts";

registerSurface("gloss", { make: () => new GlossCache(), draw: drawGloss });
registerUi("channels", channelsUi);
