// Stadium Jumbotron (stadium): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./stadium.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/600.css";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";
import "@fontsource/jersey-10/400.css";
import "@fontsource/big-shoulders-display/600";
import "@fontsource/big-shoulders-display/800";
import { registerSurface } from "../registry.ts";
import { drawStadium, StadiumCache } from "../map/stadium.ts";

registerSurface("stadium", { make: () => new StadiumCache(), draw: drawStadium });
