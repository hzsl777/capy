// Fictional GDELT files for the fictional world day (decisions 54, 67 and 78): invented local sites and headlines about
// real towns, in the GKG 2.1 layout the local stage reads. Used by the tests and by `stage -- demo`, so the site's
// sample shows local stories the way a live day does. Nothing here is real news.
import { strToU8, zipSync } from "fflate";
import { ingestWindow, toRunDate } from "@2dayai/core";

export type GkgTown = { type?: string; name: string; lat: number; lon: number; id: string; offset?: number; cc?: string };

/** One GKG 2.1 row: 27 tab-separated columns, with only the ones the local stage reads filled in. */
export function gkgRow(o: { url: string; title?: string; when?: string; towns?: GkgTown[]; lang?: string | undefined; collection?: string }): string {
  const c = Array.from({ length: 27 }, () => "");
  c[0] = `${o.when ?? "20260927070000"}-1`;
  c[1] = o.when ?? "20260927070000";
  c[2] = o.collection ?? "1";
  c[3] = new URL(o.url).hostname;
  c[4] = o.url;
  c[10] = (o.towns ?? []).map((t) => [t.type ?? "4", t.name, t.cc ?? "XX", "XX00", "", t.lat, t.lon, t.id, t.offset ?? 100].join("#")).join(";");
  if (o.lang) c[25] = `srclc:${o.lang};eng:GT-ITA 1.0`;
  if (o.title !== undefined) c[26] = `<PAGE_LINKS></PAGE_LINKS><PAGE_TITLE>${o.title}</PAGE_TITLE>`;
  return c.join("\t");
}

export const gkgZip = (rows: string[]): Uint8Array => zipSync({ "x.gkg.csv": strToU8(rows.join("\n")) });

type Local = { site: string; town: GkgTown; hour: number; title: string; lang?: string };
const town = (name: string, lat: number, lon: number, id: string): GkgTown => ({ name, lat, lon, id });

// Towns in regions the fictional outlets never reach, towns in regions they do, small municipalities of a few thousand
// people (Stanmore near London, Ikinu north of Nairobi), a municipality next to an outlet's city (Espoo, 16 km from
// Helsinki), which gets its own stories, and two stories from outlets' own towns (Helsinki, and Valparaíso, where
// the port story sits), which the local stage leaves to the outlets. Kisumu has three, one more than a town keeps.
const LOCAL: Local[] = [
  { site: "lakeside-gazette", town: town("Kisumu, Nyanza, Kenya", -0.1, 34.75, "F1"), hour: 10, title: "Kisumu market traders get a new covered hall" },
  { site: "lakeside-gazette", town: town("Kisumu, Nyanza, Kenya", -0.1, 34.75, "F1"), hour: 18, title: "Ferry timetable on the gulf changes next month" },
  { site: "lakeside-gazette", town: town("Kisumu, Nyanza, Kenya", -0.1, 34.75, "F1"), hour: 6, title: "Kisumu bus park gets new shelters before the rains" },
  { site: "highlands-voice", town: town("Ikinu, Kiambu, Kenya", -1.108, 36.792, "F27"), hour: 14, title: "Ikinu tea growers open a shared collection shed" },
  { site: "harrow-local", town: town("Stanmore, Greater London, United Kingdom", 51.6167, -0.3167, "F28"), hour: 9, title: "Stanmore library extends its weekend opening hours" },
  { site: "baltic-local", town: town("Helsinki, Southern Finland, Finland", 60.1756, 24.9342, "F29"), hour: 15, title: "Helsingin raitiovaunulinja saa uusia pysäkkejä", lang: "fin" },
  { site: "coast-weekly", town: town("Mombasa, Coast, Kenya", -4.05, 39.67, "F2"), hour: 12, title: "Mombasa port extends night shifts for cargo" },
  { site: "coast-weekly", town: town("Malindi, Coast, Kenya", -3.22, 40.12, "F3"), hour: 20, title: "Malindi beach clean-up draws hundreds of volunteers" },
  { site: "savanna-news", town: town("Kano, Kano, Nigeria", 12.0, 8.52, "F4"), hour: 9, title: "Kano state opens registration for farm input loans" },
  { site: "savanna-news", town: town("Zaria, Kaduna, Nigeria", 11.08, 7.71, "F5"), hour: 15, title: "Zaria teaching hospital adds a children's ward" },
  { site: "ridge-times", town: town("Ibadan, Oyo, Nigeria", 7.39, 3.9, "F6"), hour: 21, title: "Ibadan ring road repairs to finish before the rains" },
  { site: "fjord-posten", town: town("Tromso, Troms, Norway", 69.65, 18.96, "F7"), hour: 11, title: "Tromsø havn åpner en ny fergekai til vinteren", lang: "nor" },
  { site: "lapin-sanomat", town: town("Rovaniemi, Lapland, Finland", 66.5, 25.72, "F8"), hour: 14, title: "Rovaniemen kirjasto pidentää talven aukioloaikoja", lang: "fin" },
  { site: "uusimaa-uutiset", town: town("Espoo, Southern Finland, Finland", 60.21, 24.66, "F9"), hour: 13, title: "Espoon kaupunginhallitus hyväksyi uuden koulubudjetin", lang: "fin" },
  { site: "sierra-diario", town: town("Arequipa, Arequipa, Peru", -16.4, -71.54, "F10"), hour: 16, title: "Arequipa suma carriles para buses en su avenida principal", lang: "spa" },
  { site: "sierra-diario", town: town("Cusco, Cusco, Peru", -13.52, -71.97, "F11"), hour: 19, title: "Cusco restaura un puente colonial sobre el río", lang: "spa" },
  { site: "sierra-diario", town: town("Puno, Puno, Peru", -15.84, -70.02, "F12"), hour: 22, title: "Pescadores de Puno forman una cooperativa en el lago", lang: "spa" },
  { site: "norte-chico", town: town("Valparaiso, Valparaiso, Chile", -33.05, -71.62, "F13"), hour: 12, title: "Reabre el funicular de Valparaíso tras las reparaciones", lang: "spa" },
  { site: "lanna-post", town: town("Chiang Mai, Chiang Mai, Thailand", 18.79, 98.98, "F14"), hour: 8, title: "Chiang Mai night market moves to a new site" },
  { site: "isan-today", town: town("Khon Kaen, Khon Kaen, Thailand", 16.44, 102.83, "F15"), hour: 17, title: "Khon Kaen university opens a solar research centre" },
  { site: "atlas-sud", town: town("Marrakesh, Marrakech-Tensift-Al Haouz, Morocco", 31.63, -8.0, "F16"), hour: 10, title: "De nouvelles conduites d'eau pour la médina de Marrakech", lang: "fre" },
  { site: "atlas-sud", town: town("Agadir, Souss-Massa-Draa, Morocco", 30.42, -9.6, "F17"), hour: 23, title: "Semaine chargée pour la sardine au port de pêche d'Agadir", lang: "fre" },
  { site: "sindh-local", town: town("Hyderabad, Sindh, Pakistan", 25.38, 68.37, "F18"), hour: 9, title: "Hyderabad water board repairs a main canal gate" },
  { site: "sindh-local", town: town("Sukkur, Sindh, Pakistan", 27.7, 68.86, "F19"), hour: 13, title: "Sukkur barrage walkway reopens to the public" },
  { site: "punjab-daily", town: town("Multan, Punjab, Pakistan", 30.2, 71.47, "F20"), hour: 18, title: "Multan mango growers expect an early harvest" },
  { site: "prairie-local", town: town("Brandon, Manitoba, Canada", 49.85, -99.95, "F21"), hour: 15, title: "Brandon council votes to extend transit hours" },
  { site: "north-shore-news", town: town("Thunder Bay, Ontario, Canada", 48.38, -89.25, "F22"), hour: 20, title: "Thunder Bay grain terminal starts its autumn season" },
  { site: "illawarra-local", town: town("Wollongong, New South Wales, Australia", -34.42, 150.89, "F23"), hour: 7, title: "Wollongong beach patrols begin for the season" },
  { site: "tropic-bulletin", town: town("Townsville, Queensland, Australia", -19.26, 146.82, "F24"), hour: 11, title: "Townsville hospital opens a new outpatient clinic" },
  { site: "gulf-local", town: town("Al Khor, Al Khawr, Qatar", 25.68, 51.5, "F25"), hour: 16, title: "Al Khor park adds shaded walking paths" },
  { site: "bothnia-news", town: town("Oulu, Northern Ostrobothnia, Finland", 65.01, 25.47, "F26"), hour: 12, title: "Oulun raitiotieselvitys etenee kaupunginvaltuustoon", lang: "fin" },
];

/**
 * The fictional day's GDELT files: every local story in the quarter hour three hours into the run date's window, each
 * dated `hour` hours into the day's window.
 */
export function worldGdeltFor(url: string, runDate: string): Uint8Array | null {
  const { from } = ingestWindow(toRunDate(runDate));
  const stamp = new Date(from.getTime() + 3 * 3600_000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  if (!url.endsWith(`${stamp}.gkg.csv.zip`) && !url.endsWith(`${stamp}.translation.gkg.csv.zip`)) return null;
  const translated = url.includes(".translation.");
  const rows = LOCAL.filter((l) => !!l.lang === translated).map((l) => {
    const when = new Date(from.getTime() + l.hour * 3600_000);
    const slug = l.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return gkgRow({ url: `https://${l.site}.example/local/${slug}`, title: l.title, when: when.toISOString().replace(/[-:T]/g, "").slice(0, 14), towns: [l.town], lang: l.lang });
  });
  return gkgZip(rows);
}
