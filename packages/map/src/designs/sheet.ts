// Spreadsheet (sheet): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./sheet.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/700.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawSheet, SheetCache } from "../map/sheet.ts";
import * as extrasUi from "../ui/extras.ts";

registerSurface("sheet", { make: () => new SheetCache(), draw: (f, c) => void drawSheet(f, c) });
registerUi("extras", extrasUi);
