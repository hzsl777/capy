// Machine Music (machine): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./machine.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/600.css";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawMachine, MachineCache } from "../map/machine.ts";
import * as extrasUi from "../ui/extras.ts";

registerSurface("machine", { make: () => new MachineCache(), draw: (f, c) => void drawMachine(f, c) });
registerUi("extras", extrasUi);
