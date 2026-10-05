// Toy Train Set (trainset): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./trainset.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/600.css";
import "@fontsource/alfa-slab-one/400.css";
import { registerSurface } from "../registry.ts";
import { drawTrainset, TrainsetCache } from "../map/trainset.ts";

registerSurface("trainset", { make: () => new TrainsetCache(), draw: drawTrainset });
