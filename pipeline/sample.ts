/**
 * Writes public/data/sample.json: placeholder data for development and design
 * review when live data isn't available. Every headline is invented, deliberately
 * mundane, and linked to example.com. The app shows a "Sample data" banner
 * whenever it loads this file. Never ship this as if it were news.
 *
 *   npm run sample
 */
import { writeFile, mkdir } from "node:fs/promises";
import type { Item, NewsFile, Place, Topic } from "../src/types.ts";

const CITIES: [string, number, number][] = [
  ["Reykjavik", 64.15, -21.94], ["Oslo", 59.91, 10.75], ["Helsinki", 60.17, 24.94], ["Dublin", 53.35, -6.26],
  ["Lisbon", 38.72, -9.14], ["Madrid", 40.42, -3.7], ["Marseille", 43.3, 5.37], ["Milan", 45.46, 9.19],
  ["Vienna", 48.21, 16.37], ["Krakow", 50.06, 19.94], ["Athens", 37.98, 23.73], ["Bucharest", 44.43, 26.1],
  ["Istanbul", 41.01, 28.98], ["Tbilisi", 41.72, 44.79], ["Almaty", 43.24, 76.89], ["Tashkent", 41.3, 69.24],
  ["Casablanca", 33.57, -7.59], ["Dakar", 14.72, -17.47], ["Bamako", 12.64, -8.0], ["Accra", 5.6, -0.19],
  ["Lagos", 6.52, 3.38], ["Kano", 12.0, 8.52], ["Douala", 4.05, 9.7], ["Kinshasa", -4.44, 15.27],
  ["Luanda", -8.84, 13.23], ["Windhoek", -22.56, 17.08], ["Cape Town", -33.92, 18.42], ["Durban", -29.86, 31.02],
  ["Maputo", -25.97, 32.57], ["Antananarivo", -18.88, 47.51], ["Lusaka", -15.39, 28.32], ["Kampala", 0.35, 32.58],
  ["Nairobi", -1.29, 36.82], ["Mombasa", -4.04, 39.67], ["Addis Ababa", 9.03, 38.74], ["Khartoum", 15.5, 32.56],
  ["Cairo", 30.04, 31.24], ["Tunis", 36.81, 10.18], ["Amman", 31.95, 35.93], ["Muscat", 23.59, 58.41],
  ["Doha", 25.29, 51.53], ["Karachi", 24.86, 67.01], ["Mumbai", 19.08, 72.88], ["Bengaluru", 12.97, 77.59],
  ["Chennai", 13.08, 80.27], ["Kolkata", 22.57, 88.36], ["Kathmandu", 27.72, 85.32], ["Dhaka", 23.81, 90.41],
  ["Colombo", 6.93, 79.86], ["Yangon", 16.87, 96.2], ["Bangkok", 13.76, 100.5], ["Hanoi", 21.03, 105.85],
  ["Kuala Lumpur", 3.14, 101.69], ["Singapore", 1.35, 103.82], ["Jakarta", -6.21, 106.85], ["Surabaya", -7.25, 112.75],
  ["Manila", 14.6, 120.98], ["Cebu", 10.32, 123.89], ["Hong Kong", 22.32, 114.17], ["Chengdu", 30.57, 104.07],
  ["Ulaanbaatar", 47.89, 106.91], ["Busan", 35.18, 129.08], ["Osaka", 34.69, 135.5], ["Sapporo", 43.06, 141.35],
  ["Vladivostok", 43.12, 131.89], ["Novosibirsk", 55.01, 82.93], ["Port Moresby", -9.44, 147.18], ["Darwin", -12.46, 130.84],
  ["Perth", -31.95, 115.86], ["Adelaide", -34.93, 138.6], ["Brisbane", -27.47, 153.03], ["Hobart", -42.88, 147.33],
  ["Auckland", -36.85, 174.76], ["Suva", -18.14, 178.44], ["Apia", -13.83, -171.76], ["Honolulu", 21.31, -157.86],
  ["Anchorage", 61.22, -149.9], ["Vancouver", 49.28, -123.12], ["Seattle", 47.61, -122.33], ["Denver", 39.74, -104.99],
  ["Winnipeg", 49.9, -97.14], ["Chicago", 41.88, -87.63], ["Houston", 29.76, -95.37], ["Atlanta", 33.75, -84.39],
  ["Montreal", 45.5, -73.57], ["Halifax", 44.65, -63.57], ["Monterrey", 25.69, -100.32], ["Guadalajara", 20.66, -103.35],
  ["Oaxaca", 17.07, -96.73], ["Guatemala City", 14.63, -90.51], ["San Jose", 9.93, -84.08], ["Havana", 23.11, -82.37],
  ["Santo Domingo", 18.49, -69.93], ["Medellin", 6.24, -75.58], ["Quito", -0.18, -78.47], ["Lima", -12.05, -77.04],
  ["Manaus", -3.12, -60.02], ["Recife", -8.05, -34.88], ["La Paz", -16.5, -68.15], ["Salvador", -12.97, -38.5],
  ["Sao Paulo", -23.55, -46.63], ["Asuncion", -25.26, -57.58], ["Montevideo", -34.9, -56.16], ["Cordoba", -31.42, -64.18],
  ["Santiago", -33.45, -70.67], ["Punta Arenas", -53.16, -70.91], ["Nuuk", 64.18, -51.72], ["Tromso", 69.65, 18.96],
];

const TEMPLATES: [Topic, string, string][] = [
  ["environment", "en", "Seasonal rainfall runs above average, water board says"],
  ["environment", "en", "Volunteers plant mangroves along northern shoreline"],
  ["economy", "en", "Harbour cargo volumes steady for third straight month"],
  ["economy", "en", "Local market vendors adjust hours for festival week"],
  ["science", "en", "University team publishes survey of coastal bird populations"],
  ["science", "en", "Observatory opens public nights for meteor shower"],
  ["health", "en", "Clinics extend weekend hours ahead of vaccination drive"],
  ["culture", "en", "Old town library reopens after two-year restoration"],
  ["culture", "en", "Film festival announces programme of regional shorts"],
  ["sport", "en", "Marathon organisers publish revised race-day route"],
  ["sport", "en", "Youth sailing regatta draws record entries"],
  ["politics", "en", "City council schedules public hearing on transit budget"],
  ["justice", "en", "Court reopens records office after digitisation project"],
  ["economy", "es", "El mercado central amplía su horario durante las fiestas"],
  ["culture", "es", "La biblioteca municipal inaugura una sala de lectura infantil"],
  ["environment", "fr", "Le service météo prévoit un week-end ensoleillé sur la côte"],
  ["science", "fr", "Une équipe locale étudie la migration des tortues marines"],
  ["sport", "pt", "Clube de remo abre inscrições para a nova temporada"],
  ["health", "sw", "Hospitali ya mkoa yaongeza vitanda vya wagonjwa"],
  ["culture", "id", "Festival musik tradisional digelar akhir pekan ini"],
  ["environment", "ja", "港の近くで桜の開花が観測された"],
  ["economy", "de", "Wochenmarkt verlängert Öffnungszeiten im Sommer"],
  ["science", "ar", "جامعة محلية تفتتح مختبرا جديدا لعلوم البحار"],
  ["culture", "hi", "शहर के संग्रहालय में नई प्रदर्शनी खुली"],
];

const STORIES: [Topic, string][] = [
  ["science", "Scientists across several ports log the same unusual plankton bloom"],
  ["environment", "Coastal cities compare notes on a long-running heat spell"],
  ["sport", "Regional football cup draw sets up long-distance away trips"],
  ["culture", "Touring orchestra begins month-long series of harbour concerts"],
];

const EXCERPT =
  "Placeholder preview text. In live data this is the short description the outlet publishes for link previews, never the article itself.";

/** Small deterministic PRNG so the sample is stable between runs. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSample(now: number): NewsFile {
  const rand = rng(42);
  const places: Place[] = CITIES.map(([name, lat, lon]) => ({
    id: `ll:${lat.toFixed(1)},${lon.toFixed(1)}`,
    name,
    lat,
    lon,
  }));
  const items: Item[] = [];
  let n = 0;
  places.forEach((_, p) => {
    const count = 1 + Math.floor(rand() ** 2 * 9);
    for (let k = 0; k < count; k++) {
      const [topic, lang, title] = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
      const outlet = `gazette-${1 + Math.floor(rand() * 40)}.example`;
      items.push({
        id: `x${n}`,
        t: now - Math.floor(rand() ** 1.5 * 24 * 3600),
        title,
        url: `https://example.com/sample/${n++}`,
        domain: outlet,
        lang,
        topics: [topic],
        place: p,
        excerpt: EXCERPT,
        embed: rand() < 0.3,
      });
    }
  });
  STORIES.forEach(([topic, title], s) => {
    const start = now - Math.floor((2 + s * 4) * 3600);
    const spots = new Set<number>();
    while (spots.size < 4 + s) spots.add(Math.floor(rand() * places.length));
    for (const p of spots) {
      items.push({
        id: `x${n}`,
        t: start + Math.floor(rand() * 3 * 3600),
        title,
        url: `https://example.com/sample/${n++}`,
        domain: `courier-${1 + Math.floor(rand() * 20)}.example`,
        lang: "en",
        topics: [topic],
        place: p,
        story: `sample-${s}`,
        excerpt: EXCERPT,
      });
    }
  });
  items.sort((a, b) => b.t - a.t);
  return { version: 1, source: "sample", generatedAt: now, places, items };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir("public/data", { recursive: true });
  const file = makeSample(Math.floor(Date.now() / 1000));
  await writeFile("public/data/sample.json", JSON.stringify(file));
  console.log(`sample: ${file.items.length} items, ${file.places.length} places`);
}
