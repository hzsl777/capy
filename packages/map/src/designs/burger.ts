// Burger Joint (burger): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./burger.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import "@fontsource/bungee/400.css";
import "@fontsource/rubik/500.css";
import "@fontsource/rubik/700.css";
import "@fontsource/rubik/800-italic.css";
import "@fontsource/rubik/900-italic.css";
import "@fontsource/rubik/400.css";
import { registerSurface, registerUi } from "../registry.ts";
import { drawBurger, BurgerCache } from "../map/burger.ts";
import * as burgerUi from "../ui/burger.ts";

registerSurface("burger", { make: () => new BurgerCache(), draw: drawBurger });
registerUi("burger", burgerUi);
