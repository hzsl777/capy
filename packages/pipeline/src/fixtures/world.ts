// A fictional world-desk day: invented publishers pinned to real cities, reporting on invented places
// (Kestrel Valley, Port Lenn, the Oren highlands, Varda). Used by the tests and by `stage -- demo`, which
// builds the site's sample data through the real stages. Nothing here is real news.
import type { WorldTopic } from "@2dayai/core";
import type { FakeAnswer } from "../llm/fake.js";

type Outlet = { id: string; name: string; place: string; lat: number; lon: number };

export const WORLD_OUTLETS: Outlet[] = [
  { id: "northgate-wire", name: "Northgate Wire", place: "London", lat: 51.51, lon: -0.13 },
  { id: "harbor-daily", name: "Harbor Daily", place: "Lagos", lat: 6.52, lon: 3.38 },
  { id: "meridian-post", name: "Meridian Post", place: "Nairobi", lat: -1.29, lon: 36.82 },
  { id: "gulf-courier", name: "Gulf Courier", place: "Doha", lat: 25.29, lon: 51.53 },
  { id: "andes-ledger", name: "Andes Ledger", place: "Lima", lat: -12.05, lon: -77.04 },
  { id: "pacific-record", name: "Pacific Record", place: "Sydney", lat: -33.87, lon: 151.21 },
  { id: "indus-herald", name: "Indus Herald", place: "Karachi", lat: 24.86, lon: 67.01 },
  { id: "baltic-observer", name: "Baltic Observer", place: "Helsinki", lat: 60.17, lon: 24.94 },
  { id: "mekong-times", name: "Mekong Times", place: "Bangkok", lat: 13.76, lon: 100.5 },
  { id: "prairie-bulletin", name: "Prairie Bulletin", place: "Winnipeg", lat: 49.9, lon: -97.14 },
  { id: "atlas-review", name: "Atlas Review", place: "Casablanca", lat: 33.57, lon: -7.59 },
  { id: "cordillera-news", name: "Cordillera News", place: "Santiago", lat: -33.45, lon: -70.67 },
];

type Part = "whatHappened" | "whyItMatters" | "whatChangesNext";
type Story = {
  key: string;
  topic: WorldTopic;
  importance: number;
  title: string;
  /** Telegram line, for conflict stories. */
  line?: string;
  articles: { outlet: string; hour: number; headline: string; body: string }[];
  /** Explanation sentences. `cite` is [article index in this story, verbatim excerpt from its body]. */
  sentences: { part: Part; text: string; cite: [number, string] }[];
};

export const WORLD_STORIES: Story[] = [
  {
    key: "talks",
    topic: "conflict",
    importance: 5,
    title: "Ceasefire talks over Kestrel Valley resume in Port Lenn",
    line: "Delegations resumed ceasefire talks over Kestrel Valley in Port Lenn, with a draft that includes a prisoner exchange.",
    articles: [
      { outlet: "northgate-wire", hour: 11, headline: "Kestrel Valley ceasefire talks resume in Port Lenn", body: "Delegations resumed ceasefire talks in Port Lenn on Tuesday after a pause of three weeks. Mediators said a draft ceasefire would include a prisoner exchange and a monitoring mission. Both delegations confirmed they would meet again on Friday." },
      { outlet: "gulf-courier", hour: 13, headline: "Mediators present draft text as Kestrel Valley talks restart", body: "Mediators presented a draft text to both delegations in Port Lenn. The draft calls for a halt to shelling along the valley road within 72 hours of signing. Aid agencies said access to the valley has been limited since August." },
      { outlet: "meridian-post", hour: 16, headline: "Aid groups watch Port Lenn talks closely", body: "Aid groups said access to the valley has been limited since August and that 40,000 people depend on deliveries by road. A spokesperson said convoys could move within days if a ceasefire holds." },
    ],
    sentences: [
      { part: "whatHappened", text: "Delegations resumed ceasefire talks in Port Lenn after a three-week pause.", cite: [0, "resumed ceasefire talks in Port Lenn on Tuesday after a pause of three weeks"] },
      { part: "whatHappened", text: "Mediators said the draft includes a prisoner exchange and a monitoring mission.", cite: [0, "a draft ceasefire would include a prisoner exchange and a monitoring mission"] },
      { part: "whatHappened", text: "The draft calls for shelling along the valley road to stop within 72 hours of signing.", cite: [1, "calls for a halt to shelling along the valley road within 72 hours of signing"] },
      { part: "whyItMatters", text: "About 40,000 people depend on road deliveries into the valley.", cite: [2, "40,000 people depend on deliveries by road"] },
      { part: "whatChangesNext", text: "The delegations plan to meet again on Friday.", cite: [0, "Both delegations confirmed they would meet again on Friday"] },
    ],
  },
  {
    key: "highlands",
    topic: "conflict",
    importance: 4,
    title: "Shelling in the Oren highlands displaces families",
    line: "Shelling near two villages in the Oren highlands displaced about 1,200 families, according to local officials.",
    articles: [
      { outlet: "indus-herald", hour: 9, headline: "Families leave Oren highland villages after shelling", body: "Local officials said about 1,200 families left two villages in the Oren highlands after overnight shelling. A school in the district town is being used as a shelter. Officials said they had asked for tents and water tanks." },
      { outlet: "baltic-observer", hour: 14, headline: "Relief agencies send supplies to Oren highlands", body: "Relief agencies said a first convoy with tents and water tanks reached the district town on Wednesday. The agencies said the road into the highlands remains closed to civilian traffic." },
    ],
    sentences: [
      { part: "whatHappened", text: "About 1,200 families left two villages in the Oren highlands after overnight shelling.", cite: [0, "about 1,200 families left two villages in the Oren highlands after overnight shelling"] },
      { part: "whatHappened", text: "A school in the district town is being used as a shelter.", cite: [0, "A school in the district town is being used as a shelter"] },
      { part: "whyItMatters", text: "The road into the highlands is closed to civilian traffic.", cite: [1, "the road into the highlands remains closed to civilian traffic"] },
      { part: "whatChangesNext", text: "A first convoy with tents and water tanks reached the district town.", cite: [1, "a first convoy with tents and water tanks reached the district town"] },
    ],
  },
  {
    key: "exchange",
    topic: "conflict",
    importance: 3,
    title: "Prisoner exchange completed at the Varda crossing",
    line: "Both sides completed an exchange of 60 prisoners at the Varda crossing, overseen by an international observer team.",
    articles: [
      { outlet: "harbor-daily", hour: 10, headline: "Sixty prisoners exchanged at Varda crossing", body: "An exchange of 60 prisoners was completed at the Varda crossing on Tuesday morning. An international observer team oversaw the handover, which lasted about two hours." },
      { outlet: "atlas-review", hour: 12, headline: "Observers confirm Varda prisoner handover", body: "The observer team said the handover at the Varda crossing followed the agreed list of names. The team said a further exchange had been discussed but no date was set." },
    ],
    sentences: [
      { part: "whatHappened", text: "An exchange of 60 prisoners was completed at the Varda crossing.", cite: [0, "An exchange of 60 prisoners was completed at the Varda crossing"] },
      { part: "whatHappened", text: "An international observer team oversaw the handover.", cite: [0, "An international observer team oversaw the handover"] },
      { part: "whyItMatters", text: "Observers said the handover followed the agreed list of names.", cite: [1, "the handover at the Varda crossing followed the agreed list of names"] },
      { part: "whatChangesNext", text: "A further exchange was discussed with no date set.", cite: [1, "a further exchange had been discussed but no date was set"] },
    ],
  },
  {
    key: "floods",
    topic: "environment",
    importance: 4,
    title: "Floods close roads across the delta region",
    articles: [
      { outlet: "mekong-times", hour: 21, headline: "Delta floods close main roads", body: "Floodwater closed three main roads across the delta region after two days of heavy rain. The weather service said river levels would peak on Thursday." },
      { outlet: "pacific-record", hour: 15, headline: "Delta rain eases but rivers still rising", body: "Rain eased across the delta region on Wednesday but river levels were still rising. Emergency teams moved 900 residents from low-lying streets." },
    ],
    sentences: [
      { part: "whatHappened", text: "Floodwater closed three main roads in the delta region after two days of heavy rain.", cite: [0, "Floodwater closed three main roads across the delta region after two days of heavy rain"] },
      { part: "whatHappened", text: "Emergency teams moved 900 residents from low-lying streets.", cite: [1, "Emergency teams moved 900 residents from low-lying streets"] },
      { part: "whatChangesNext", text: "River levels are expected to peak on Thursday.", cite: [0, "river levels would peak on Thursday"] },
    ],
  },
  {
    key: "port",
    topic: "economy",
    importance: 3,
    title: "Grain port reopens after quay repairs",
    articles: [{ outlet: "andes-ledger", hour: 12, headline: "Grain port reopens after four months of repairs", body: "The grain port reopened on Wednesday after four months of quay repairs. The port authority said the first two ships would load this week." }],
    sentences: [],
  },
  {
    key: "budget",
    topic: "politics",
    importance: 2,
    title: "Regional council schedules budget vote",
    articles: [{ outlet: "prairie-bulletin", hour: 17, headline: "Council sets date for budget vote", body: "The regional council scheduled its budget vote for next month after a public hearing." }],
    sentences: [],
  },
  {
    key: "clinics",
    topic: "health",
    importance: 3,
    title: "Clinics extend hours for vaccination drive",
    articles: [{ outlet: "meridian-post", hour: 9, headline: "Clinics open on weekends for vaccination drive", body: "Clinics will open on weekends for the next month to support a vaccination drive, health officials said." }],
    sentences: [],
  },
  {
    key: "festival",
    topic: "culture",
    importance: 2,
    title: "Regional film festival opens",
    articles: [{ outlet: "atlas-review", hour: 19, headline: "Film festival opens with regional shorts", body: "The regional film festival opened with a programme of short films from twelve countries." }],
    sentences: [],
  },
  {
    key: "marathon",
    topic: "sport",
    importance: 1,
    title: "Marathon organisers publish new route",
    articles: [{ outlet: "cordillera-news", hour: 18, headline: "New marathon route published", body: "Marathon organisers published a new route that avoids the old town." }],
    sentences: [],
  },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function worldArticleUrl(outlet: string, headline: string): string {
  return `https://${outlet}.example/news/${slug(headline)}`;
}

/** sources.yaml for the fictional world desk. */
export function worldSourcesYaml(): string {
  const lines = WORLD_OUTLETS.map(
    (o) => `  - { id: ${o.id}, name: ${o.name}, url: "https://${o.id}.example/feed.xml", topic: world, tier: general, desk: world, place: { name: ${o.place}, lat: ${o.lat}, lon: ${o.lon} } }`,
  );
  return `sources:\n${lines.join("\n")}\n`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** One RSS document per outlet, dated inside the ingest window of `runDate` (the day before, UTC hours). */
export function worldFeedFor(url: string, runDate: string): string {
  const outlet = new URL(url).hostname.replace(/\.example$/, "");
  const day = new Date(`${runDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  const items = WORLD_STORIES.flatMap((s) => s.articles.filter((a) => a.outlet === outlet)).map((a) => {
    const when = new Date(day);
    when.setUTCHours(a.hour, 0, 0, 0);
    return `<item><title>${esc(a.headline)}</title><link>${worldArticleUrl(a.outlet, a.headline)}</link><pubDate>${when.toUTCString()}</pubDate><description>${esc(a.body.split(". ")[0]!)}.</description><content:encoded><![CDATA[<p>${a.body}</p>]]></content:encoded></item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>${outlet}</title>${items.join("")}</channel></rss>`;
}

function storyByHeadline(headline: string): { story: Story; index: number } | null {
  for (const story of WORLD_STORIES) {
    const index = story.articles.findIndex((a) => a.headline === headline);
    if (index >= 0) return { story, index };
  }
  return null;
}

/** Scripted model answers for the world desk, the way a good run would answer. `badWordFirst` exercises the retry. */
export function worldAnswers(opts: { badWordFirst?: string } = {}): Record<string, FakeAnswer> {
  return {
    "cluster-world": ({ user }) => {
      const byStory = new Map<string, number[]>();
      for (const m of user.matchAll(/^\[(\d+)\] (.+)$/gm)) {
        const found = storyByHeadline(m[2]!);
        if (!found) continue;
        const list = byStory.get(found.story.key) ?? [];
        list.push(Number(m[1]));
        byStory.set(found.story.key, list);
      }
      return {
        events: WORLD_STORIES.filter((s) => byStory.has(s.key)).map((s) => ({
          title: s.title,
          articleIds: byStory.get(s.key)!,
          importance: s.importance,
          importanceReason: "scripted fixture answer",
          topic: s.topic,
        })),
        skipped: [],
      };
    },
    explain: ({ user }) => {
      const title = /^Event: (.+)$/m.exec(user)?.[1] ?? "";
      const story = WORLD_STORIES.find((s) => s.title === title);
      const ids = new Map<number, number>();
      for (const m of user.matchAll(/^\[article (\d+)\] (.+)$/gm)) {
        const found = storyByHeadline(m[2]!);
        if (found) ids.set(found.index, Number(m[1]));
      }
      const out = { whatHappened: [] as unknown[], whyItMatters: [] as unknown[], whatChangesNext: [] as unknown[] };
      for (const s of story?.sentences ?? []) {
        const articleId = ids.get(s.cite[0]);
        if (articleId === undefined) continue;
        out[s.part].push({ text: s.text, citations: [{ articleId, excerpt: s.cite[1] }] });
      }
      return out;
    },
    telegram: ({ user, attempt }) => {
      const found = [...user.matchAll(/^\[event (\d+)\] (.+)$/gm)].map((m) => ({ id: Number(m[1]), story: WORLD_STORIES.find((s) => s.title === m[2]) }));
      const chosen = found.filter((f) => f.story && f.story.importance >= 3).sort((a, b) => b.story!.importance - a.story!.importance);
      const word = opts.badWordFirst && attempt === 1 ? opts.badWordFirst : "Ceasefire";
      return { word, quietDay: false, events: chosen.slice(0, 3).map((f) => ({ eventId: f.id, line: f.story!.line ?? f.story!.title })) };
    },
  };
}
