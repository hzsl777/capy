// Notebook (paper): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./paper.css";
import "@fontsource/patrick-hand/400.css";
import "@fontsource/dancing-script/700.css";
import "@fontsource/kalam/latin-400.css";
import "@fontsource/kalam/latin-ext-400.css";
import "@fontsource/kalam/latin-700.css";
import "@fontsource/kalam/latin-ext-700.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawPaper, PaperCache } from "../map/paper.ts";
import * as paperUi from "../ui/paper.ts";

registerSurface("paper", { make: () => new PaperCache(), draw: drawPaper });
registerUi("paper", paperUi);
