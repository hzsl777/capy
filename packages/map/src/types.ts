/**
 * The site's data contract is MapFile in @2dayai/core (packages/core/src/map.ts), built from the database by
 * loadMapView. Type-only imports: nothing from core is bundled into the site.
 */
import type { MapEvent, MapFile, MapItem, MapLocalIndex, MapPlace, MapRecentWord, MapTelegram, MapTile, MapTileItem, WorldTopic } from "@2dayai/core";

export type { MapEvent, MapFile, MapItem, MapLocalIndex, MapPlace, MapRecentWord, MapTelegram, MapTile, MapTileItem };
export type Topic = WorldTopic;

/** Same list as WORLD_TOPICS in core, repeated here as a value so the site stays free of zod. */
export const TOPICS = ["politics", "economy", "conflict", "environment", "health", "science", "justice", "culture", "sport", "other"] as const satisfies readonly Topic[];

// Compile-time check that the two lists match exactly.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const TOPICS_MATCH_CORE: Same<(typeof TOPICS)[number], Topic> = true;
