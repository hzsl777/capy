// Reader pages (levels 2 and 3) and feedback endpoints arrive at milestone 3.
// Milestone 0 ships the Worker skeleton so the deploy path exists from day one.
import { Hono } from "hono";

type Bindings = { DATABASE_URL: string };

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true, service: "2dayai-web" }));

app.get("/r/:token", (c) => c.text("No edition yet.", 404));

export default app;
