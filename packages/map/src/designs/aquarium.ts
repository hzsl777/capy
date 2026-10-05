// Aquarium (aquarium): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./aquarium.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/400-italic.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/sniglet/400.css";
import "@fontsource/sniglet/800.css";
import { registerSurface } from "../registry.ts";
import { drawAquarium, AquariumCache } from "../map/aquarium.ts";

registerSurface("aquarium", { make: () => new AquariumCache(), draw: (f, c) => void drawAquarium(f, c) });
