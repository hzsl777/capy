import type { Place, Topic } from "../src/types.ts";

/** An article as the pipeline holds it between runs (before it becomes an `Item`). */
export interface PoolItem {
  id: string;
  t: number;
  title: string;
  url: string;
  domain: string;
  lang: string;
  topics: Topic[];
  place: Place;
  /** Lowercased people and organisations named in the article, used for story grouping. */
  entities: string[];
  image?: string;
  story?: string;
}
