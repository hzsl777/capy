// Old Realm (realm): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./realm.css";
import "@fontsource/medievalsharp/400.css";
import "@fontsource/alegreya/400.css";
import "@fontsource/alegreya/700.css";
import { registerUi } from "../registry.ts";
import * as extrasUi from "../ui/extras.ts";

registerUi("extras", extrasUi);
