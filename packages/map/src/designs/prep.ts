// Country Club (prep): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./prep.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/playfair-display/700-italic.css";
import "@fontsource/playfair-display/400-italic.css";
import "@fontsource/playfair-display/600-italic.css";
import "@fontsource/libre-baskerville/400.css";
import "@fontsource/libre-baskerville/400-italic.css";
import "@fontsource/libre-baskerville/700.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawClub, ClubCache } from "../map/club.ts";
import * as extrasUi from "../ui/extras.ts";

registerSurface("club", { make: () => new ClubCache(), draw: (f, c) => void drawClub(f, c) });
registerUi("extras", extrasUi);
