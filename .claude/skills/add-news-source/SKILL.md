---
name: add-news-source
description: Add a hand-picked local news outlet (RSS or Atom feed) to Capy's pipeline/sources.json, verifying the feed works and keeping the source list balanced across regions and languages. Use when asked to add an outlet, feed, newspaper or local source.
---

# Add a news source

GDELT already covers many outlets in about 65 languages. Hand-picked sources fill gaps, usually places where GDELT's coverage is thin. Each source is pinned to its home city, so all its stories appear there.

## Steps

1. **Check the gap.** Ask why this outlet: which place or language does it cover that the map is missing? Look at the current `pipeline/sources.json` and count sources per region and language. Don't add a third outlet for one city while a whole region has none.
2. **Find the official feed.** Use the outlet's own site (look for `<link rel="alternate" type="application/rss+xml">` or a /rss or /feed page). Never invent a URL. If you can't fetch it from the session, say so and leave it for the owner to verify rather than guessing.
3. **Verify.** Fetch it and confirm it parses:
   ```
   curl -sSL "<feed url>" | head -c 2000
   ```
   It needs item titles and absolute http(s) links. Check the outlet's terms if they're easy to find; skip outlets that forbid aggregation.
4. **Add the entry** to `pipeline/sources.json`:
   ```json
   {
     "name": "Outlet name as it styles itself",
     "feed": "https://outlet.example/rss",
     "lang": "fr",
     "place": { "name": "Dakar", "lat": 14.69, "lon": -17.44 }
   }
   ```
   `lang` is a two-letter code. `place.name` is the city only, never a country. Coordinates to two decimals are enough.
5. **Test.** `npm test`, then if the network allows, `npm run ingest -- --no-enrich --out /tmp/out.json` and check that the log line `[rss] N items from M sources` counts the new source.
6. Run the `neutrality-review` skill's pipeline section.

## Don't
- Add state-run and independent outlets for one place unevenly. If you add one kind, note it for the owner so they can decide on balance.
- Pin a national outlet to a capital just to fill a dot. Pin it where it's based.
