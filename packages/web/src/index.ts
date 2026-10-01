// Reader pages (levels 1 to 3), feedback endpoints, and the public map's data. The map itself is static
// assets (packages/map/dist) served by this Worker. Its data is the finished file the daily run stores in R2
// (decision 73), with the day's local stories in tiles beside it (decision 78), read from the database only when no
// stored file exists. Never calls the model.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Hono, type Context } from "hono";
import { renderEditionPage, renderEventPage, renderFeedbackConfirm, renderFeedbackPage, renderNotFound, renderUnavailable, tileBounds, toRunDate } from "@2dayai/core";
import * as schema from "@2dayai/db";
import { findEditionEvent, latestMapDate, loadEditionView, loadLocalTile, loadMapView, recordFeedback, type Db } from "@2dayai/db";
import { startRun, type ClockEnv } from "./clock.js";

/** No run date before this one has data: the project began in September 2026. */
const FIRST_DATE = "2026-09-01";
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const PERMISSIONS = "camera=(), microphone=(), geolocation=(), payment=()";
// No includeSubDomains: other names under a custom domain may not serve HTTPS.
const HSTS = "max-age=31536000";

/**
 * A branch or version preview on workers.dev (<branch>-globalgist.<account>.workers.dev). Only the production
 * address, globalgist.<account>.workers.dev, and a custom domain should be indexed by search engines.
 */
export function isPreview(hostname: string): boolean {
  return hostname.endsWith(".workers.dev") && !hostname.startsWith("globalgist.");
}

/** The part of an R2 bucket the Worker uses: reading one stored map file. */
export interface MapStore {
  get(key: string): Promise<{ body: ReadableStream; httpEtag: string } | null>;
}

type Bindings = { DATABASE_URL: string; WEB_BASE_URL?: string; MAPS?: MapStore } & ClockEnv;

function neonDb(env: Bindings): Db {
  return drizzle(neon(env.DATABASE_URL), { schema }) as unknown as Db;
}

/** The app with its database handle injected, so tests can run it against PGlite. */
export function createApp(dbOf: (env: Bindings) => Db = neonDb) {
  const app = new Hono<{ Bindings: Bindings }>();
  function linksOf(env: Bindings, req: Request) {
    return { baseUrl: (env.WEB_BASE_URL ?? new URL(req.url).origin).replace(/\/$/, "") };
  }
  // The static site's headers (packages/map/public/_headers) don't reach what the Worker builds. Reader and feedback
  // links carry a reader's secret token in the path, so no response sends a referrer, and the pages, which have no
  // scripts, may load none. A cached response's headers can't be changed, so each response is copied first.
  app.use("*", async (c, next) => {
    await next();
    const res = new Response(c.res.body, c.res);
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("Permissions-Policy", PERMISSIONS);
    res.headers.set("Strict-Transport-Security", HSTS);
    const html = (res.headers.get("content-type") ?? "").includes("text/html");
    res.headers.set("Content-Security-Policy", html ? PAGE_CSP : "default-src 'none'; frame-ancestors 'none'");
    if (isPreview(new URL(c.req.url).hostname)) res.headers.set("X-Robots-Tag", "noindex");
    c.res = res;
  });
  // Any failure (the database down, a missing secret) answers with a plain message. The error itself goes to the
  // Worker's logs only, so no stack trace or connection string reaches the public, and nothing is cached.
  app.onError((err, c) => {
    console.error(err);
    const headers = { "Cache-Control": "no-store" };
    if (new URL(c.req.url).pathname.startsWith("/data/")) return c.json({ error: "unavailable" }, 503, headers);
    return c.html(renderUnavailable(), 503, headers);
  });
  const KINDS = new Set(["more", "less", "wrong", "promote"]);
  const ID = /^\d{1,9}$/;
  // Reader tokens are 32 hex characters (packages/pipeline/src/profiles.ts). Anything else is refused before the database.
  const TOKEN = /^[0-9a-f]{32}$/;

  /**
   * A real calendar date in YYYY-MM-DD from FIRST_DATE to tomorrow in UTC, or null. No other date has data, and
   * refusing it here keeps made-up dates from each costing a database read.
   */
  function validDate(s: string): string | null {
    try {
      const d = toRunDate(s);
      if (new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) return null;
      return d >= FIRST_DATE && d <= toRunDate(new Date(Date.now() + DAY_MS)) ? d : null;
    } catch {
      return null;
    }
  }

  app.get("/health", (c) => c.json({ ok: true, service: "2dayai-web" }));

  // robots.txt comes from here, not from a static file, so a branch preview asks crawlers to stay out.
  app.get("/robots.txt", (c) =>
    c.text(isPreview(new URL(c.req.url).hostname) ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /\n", 200, { "Cache-Control": "public, max-age=3600" }),
  );

  // The public map's data (decision 25). Cached for five minutes at the edge with the Cache API, so a busy
  // day costs the database one read per location per five minutes, not one per visitor.
  const MAP_CACHE = "public, max-age=300, s-maxage=300";
  const edgeCache = (): Cache | null => (typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null);
  async function cachedJson(c: Context<{ Bindings: Bindings }>, build: () => Promise<Response>): Promise<Response> {
    // One cache entry per path: a query string can't skip the cache, and a HEAD request, which the Cache API refuses,
    // shares the GET entry.
    const url = new URL(c.req.url);
    const key = new Request(`${url.origin}${url.pathname}`);
    const cache = edgeCache();
    let res = cache ? await cache.match(key) : undefined;
    if (!res) {
      res = await build();
      if (cache && res.status === 200) {
        const put = cache.put(key, res.clone());
        try {
          c.executionCtx.waitUntil(put);
        } catch {
          await put;
        }
      }
    }
    // The site asks for the day's file with `no-cache`, so a browser that has it gets a 304, not the whole file again.
    const etag = res.headers.get("ETag");
    if (etag && c.req.header("If-None-Match") === etag) return new Response(null, { status: 304, headers: res.headers });
    return res;
  }

  // A stored file is streamed as it is, so a map of several megabytes costs the Worker almost no CPU time. Cloudflare's
  // free plan allows 10 ms a request, less than building and writing out a whole day's map takes.
  async function stored(env: Bindings, key: string): Promise<Response | null> {
    const obj = env.MAPS ? await env.MAPS.get(key) : null;
    if (!obj) return null;
    return new Response(obj.body, {
      headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": MAP_CACHE, ETag: obj.httpEtag },
    });
  }

  // The day's share image (decision 92), drawn by the daily run with its word and stored in R2 beside the map. Until
  // one is stored, the timeless image built into the site.
  app.get("/og.png", async (c) => {
    const obj = c.env.MAPS ? await c.env.MAPS.get("og.png") : null;
    if (!obj) return c.redirect("/og-image.png", 302);
    return new Response(obj.body, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", ETag: obj.httpEtag } });
  });

  app.get("/data/latest.json", (c) =>
    cachedJson(c, async () => {
      const file = await stored(c.env, "latest.json");
      if (file) return file;
      const db = dbOf(c.env);
      const date = await latestMapDate(db);
      if (!date) return c.json({ error: "no map data yet" }, 404);
      return c.json(await loadMapView(db, date, new Date(), { local: "index" }), 200, { "Cache-Control": MAP_CACHE });
    }),
  );

  // One tile of a day's local stories (decision 78), which the site asks for once zoomed in: the file the daily run
  // stored in R2 at local/<date>/<key>.json, else built from the database, else nothing.
  app.get("/data/local/:date/:file", async (c) => {
    const date = validDate(c.req.param("date"));
    const m = /^(\d{1,2}[NS]_\d{1,3}[EW])\.json$/.exec(c.req.param("file"));
    const key = m && tileBounds(m[1]!) ? m[1]! : null;
    if (!date || !key) return c.json({ error: "not found" }, 404);
    return cachedJson(c, async () => {
      const file = await stored(c.env, `local/${date}/${key}.json`);
      if (file) return file;
      const tile = await loadLocalTile(dbOf(c.env), date, key);
      return tile ? c.json(tile, 200, { "Cache-Control": MAP_CACHE }) : c.json({ error: "not found" }, 404);
    });
  });

  app.get("/data/:file", async (c) => {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(c.req.param("file"));
    const date = m ? validDate(m[1]!) : null;
    if (!date) return c.json({ error: "not found" }, 404);
    return cachedJson(c, async () => (await stored(c.env, `${date}.json`)) ?? c.json(await loadMapView(dbOf(c.env), date, new Date(), { local: "index" }), 200, { "Cache-Control": MAP_CACHE }));
  });

  // A reader's pages and feedback show that reader's edition, so no browser or proxy keeps a copy.
  for (const path of ["/r/*", "/f/*"]) {
    app.use(path, async (c, next) => {
      await next();
      c.header("Cache-Control", "private, no-store");
    });
  }

  app.get("/r/:token/:date", async (c) => {
    const { token } = c.req.param();
    const date = validDate(c.req.param("date"));
    if (!date || !TOKEN.test(token)) return c.html(renderNotFound(), 404);
    const view = await loadEditionView(dbOf(c.env), { readerToken: token, runDate: date });
    if (!view) return c.html(renderNotFound(), 404);
    return c.html(renderEditionPage(view, linksOf(c.env, c.req.raw)));
  });

  app.get("/r/:token/:date/e/:eventId", async (c) => {
    const { token, eventId } = c.req.param();
    const date = validDate(c.req.param("date"));
    if (!date || !TOKEN.test(token) || !ID.test(eventId)) return c.html(renderNotFound(), 404);
    const view = await loadEditionView(dbOf(c.env), { readerToken: token, runDate: date });
    const item = view?.items.find((it) => it.eventId === Number(eventId));
    if (!view || !item) return c.html(renderNotFound(), 404);
    return c.html(renderEventPage(view, item, linksOf(c.env, c.req.raw)));
  });

  app.get("/f/:token/:date/:eventId/:kind", async (c) => {
    const { token, eventId, kind } = c.req.param();
    const date = validDate(c.req.param("date"));
    if (!date || !TOKEN.test(token) || !ID.test(eventId) || !KINDS.has(kind)) return c.html(renderNotFound(), 404);
    const found = await findEditionEvent(dbOf(c.env), { readerToken: token, runDate: date, eventId: Number(eventId) });
    if (!found) return c.html(renderNotFound(), 404);
    return c.html(renderFeedbackConfirm(kind, found.title, new URL(c.req.url).pathname));
  });

  app.post("/f/:token/:date/:eventId/:kind", async (c) => {
    const { token, eventId, kind } = c.req.param();
    const date = validDate(c.req.param("date"));
    if (!date || !TOKEN.test(token) || !ID.test(eventId) || !KINDS.has(kind)) return c.html(renderNotFound(), 404);
    const result = await recordFeedback(dbOf(c.env), { readerToken: token, runDate: date, eventId: Number(eventId), kind });
    if (!result) return c.html(renderNotFound(), 404);
    return c.html(renderFeedbackPage(kind, result.title));
  });

  app.notFound((c) => c.html(renderNotFound(), 404));
  return app;
}

const app = createApp();

/** Requests, and the cron triggers in wrangler.toml, which start the GitHub runs on time (decision 91). */
export default {
  fetch: app.fetch,
  scheduled(controller: { cron: string }, env: Bindings, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(startRun(controller.cron, env).then((said) => console.log(said)));
  },
};
