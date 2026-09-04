// Reader pages (levels 1 to 3) and feedback endpoints. Server-rendered HTML, no client script.
// Reads the same database the pipeline writes; never calls the model.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Hono } from "hono";
import { renderEditionPage, renderEventPage, renderFeedbackPage, renderNotFound } from "@2dayai/core";
import * as schema from "@2dayai/db";
import { loadEditionView, recordFeedback, type Db } from "@2dayai/db";

type Bindings = { DATABASE_URL: string; WEB_BASE_URL?: string };

const app = new Hono<{ Bindings: Bindings }>();

function dbOf(env: Bindings): Db {
  return drizzle(neon(env.DATABASE_URL), { schema }) as unknown as Db;
}
function linksOf(env: Bindings, req: Request) {
  return { baseUrl: (env.WEB_BASE_URL ?? new URL(req.url).origin).replace(/\/$/, "") };
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(["more", "less", "wrong", "promote"]);

app.get("/health", (c) => c.json({ ok: true, service: "2dayai-web" }));

app.get("/r/:token/:date", async (c) => {
  const { token, date } = c.req.param();
  if (!DATE.test(date)) return c.html(renderNotFound(), 404);
  const view = await loadEditionView(dbOf(c.env), { readerToken: token, runDate: date });
  if (!view) return c.html(renderNotFound(), 404);
  return c.html(renderEditionPage(view, linksOf(c.env, c.req.raw)));
});

app.get("/r/:token/:date/e/:eventId", async (c) => {
  const { token, date, eventId } = c.req.param();
  if (!DATE.test(date)) return c.html(renderNotFound(), 404);
  const view = await loadEditionView(dbOf(c.env), { readerToken: token, runDate: date });
  const item = view?.items.find((it) => it.eventId === Number(eventId));
  if (!view || !item) return c.html(renderNotFound(), 404);
  return c.html(renderEventPage(view, item, linksOf(c.env, c.req.raw)));
});

app.get("/f/:token/:date/:eventId/:kind", async (c) => {
  const { token, date, eventId, kind } = c.req.param();
  if (!DATE.test(date) || !KINDS.has(kind)) return c.html(renderNotFound(), 404);
  const result = await recordFeedback(dbOf(c.env), { readerToken: token, runDate: date, eventId: Number(eventId), kind });
  if (!result) return c.html(renderNotFound(), 404);
  return c.html(renderFeedbackPage(kind, result.title));
});

app.notFound((c) => c.html(renderNotFound(), 404));

export default app;
