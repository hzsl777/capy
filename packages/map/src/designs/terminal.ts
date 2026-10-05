// Market Terminal (terminal): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./terminal.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawTerminal, TerminalCache } from "../map/terminal.ts";
import * as extrasUi from "../ui/extras.ts";

registerSurface("terminal", { make: () => new TerminalCache(), draw: (f, c) => void drawTerminal(f, c) });
registerUi("extras", extrasUi);
