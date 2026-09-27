---
name: add-news-source
description: Add a news outlet to Capy's world desk (the public map) in config/sources.yaml, with the city it publishes from, verifying the feed and keeping the list balanced across regions and sides. Use when asked to add an outlet, feed, newspaper or local source to the map.
---

# Add a world-desk source

Paths are relative to the repository root. Every outlet is a pin at the city it publishes from, so all its stories appear there.

## Steps

1. **Check the gap.** Which region or language does it cover that the map is missing? Count the `desk: world` entries per region. Don't add a third outlet for one city while a region has none.
2. **Check the balance.** For an outlet based in a party to a conflict, add one only alongside an equivalent outlet from the other side, and say so to Davis. Prefer outlets not based in either.
3. **Find the official feed** on the outlet's own site (`<link rel="alternate" type="application/rss+xml">`, or a /rss or /feed page). Never invent a URL. If the session can't fetch it, say so and mark it unverified.
4. **Add the entry** under the world-desk section of `config/sources.yaml`:
   ```yaml
   - { id: outlet-id, name: Outlet Name, url: "https://outlet.example/rss", topic: world, tier: general, desk: world, place: { name: Dakar, lat: 14.69, lon: -17.44 } }
   ```
   `tier: primary` only for agencies publishing their own records (UN News, ReliefWeb). `place.name` is the city, never a country. Add `lang: fr` for a non-English feed.
5. **Verify:** `npm run stage -- sources check` (needs network) and `npm run check`.
6. Run the `neutrality-review` skill's pipeline section.
