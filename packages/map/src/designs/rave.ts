// Rave (rave): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./rave.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/unbounded/700.css";
import "@fontsource/unbounded/900.css";
import { registerKit, registerUi } from "../registry.ts";
import * as scenes from "../map/scene-view.ts";
import * as extrasUi from "../ui/extras.ts";

registerKit("scenes", scenes);
registerUi("extras", extrasUi);
