/** Builds a GKG 2.1 row (27 tab-separated columns) for tests and fixtures. */
export function gkgRow(o: {
  id?: string;
  date?: string;
  domain?: string;
  url?: string;
  title?: string;
  themes?: string;
  locations?: string;
  persons?: string;
  orgs?: string;
  image?: string;
  translation?: string;
  collection?: string;
}): string {
  const c = new Array(27).fill("");
  c[0] = o.id ?? "20260927031500-1";
  c[1] = o.date ?? "20260927031500";
  c[2] = o.collection ?? "1";
  c[3] = o.domain ?? "example-news.org";
  c[4] = o.url ?? "https://example-news.org/local/story-1";
  c[7] = o.themes ?? "";
  c[10] = o.locations ?? "";
  c[11] = o.persons ?? "";
  c[13] = o.orgs ?? "";
  c[18] = o.image ?? "";
  c[25] = o.translation ?? "";
  c[26] = o.title === undefined ? "<PAGE_TITLE>Harbour reopens after repairs</PAGE_TITLE>" : `<PAGE_TITLE>${o.title}</PAGE_TITLE>`;
  return c.join("\t");
}

export const NAIROBI = "4#Nairobi, Nairobi Area, Kenya#KE#KE05##-1.28333#36.8167#-1473298#120";
export const MOMBASA = "4#Mombasa, Coast, Kenya#KE#KE02##-4.05#39.6667#-1473306#40";
export const COUNTRY = "1#Kenya#KE#KE##1#38#KE#10";
