---
name: add-news-source
description: Add a news outlet to GlobalGist's world desk (the public map) in config/sources.yaml, with the city it publishes from, verifying the feed and keeping the list balanced across regions and sides. Use when asked to add an outlet, feed, newspaper or local source to the map.
---

# Add a world-desk source

Paths are relative to the repository root. Every outlet is a pin at the city it publishes from, so all its stories appear there.

## Steps

1. **Check the gap.** Which region or language does it cover that the map is missing? Count the `desk: world` entries per region. Don't add a third outlet for one city while a region has none. The daily run's summary, or `npm run stage -- coverage --date <date>` with `DATABASE_URL` set, lists the countries and territories with no story that day (decision 78): start there.
2. **Check the balance.** For an outlet based in a party to a conflict, add one only alongside an equivalent outlet from the other side, and say so to Davis. Prefer outlets not based in either.
3. **Find the official feed** on the outlet's own site (`<link rel="alternate" type="application/rss+xml">`, or a /rss or /feed page). Never invent a URL. If the session can't fetch it, use the outlet's homepage and add `# feed unconfirmed`: ingest follows the feed link the page declares, and `sources check` prints the feed it found so you can replace the homepage (decision 31). For a section or an edition (an English page, a city edition), give the section's own page: ingest follows only the feeds that page links to in its own section and never tries the site's root, so a site feed in another language or from another edition is never pinned at this city (decision 81). `sources check` lists every feed the page links to; pick the section's own.
4. **Add the entry** under the world-desk section of `config/sources.yaml`:
   ```yaml
   - { id: outlet-id, name: Outlet Name, url: "https://outlet.example/rss", topic: world, tier: general, desk: world, place: { name: Dakar, lat: 14.69, lon: -17.44 } }
   ```
   `tier: primary` only for agencies publishing their own records (UN News, ReliefWeb). `place.name` is the city, never a country. Add `lang: fr` for a non-English feed.
5. **Verify:** `npm run stage -- sources check` (needs network; from a cloud session, run the Preflight workflow, which logs every source) and `npm run check`. Check the feed's title and the three headlines it prints: they should be the outlet's, in the entry's `lang`, about its city.
6. Run the `neutrality-review` skill's pipeline section.
