// Postcards (postcard): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./postcard.css";
import "@fontsource/special-elite/400.css";
import "@fontsource/patrick-hand/400.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import "@fontsource/alfa-slab-one/400.css";
import "@fontsource/kalam/latin-400.css";
import "@fontsource/kalam/latin-ext-400.css";
import "@fontsource/kalam/latin-700.css";
import "@fontsource/kalam/latin-ext-700.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawPostcard, PostcardCache } from "../map/postcard.ts";
import * as postcardUi from "../ui/postcard.ts";

registerSurface("postcard", { make: () => new PostcardCache(), draw: (f, c) => void drawPostcard(f, c) });
registerUi("postcard", postcardUi);
