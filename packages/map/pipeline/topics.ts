import type { Topic } from "../src/types.ts";

/**
 * Maps GDELT GKG themes and URL path hints to the app's small topic list.
 * Heuristic on purpose: topics are for filtering, never for ranking or colouring.
 * Theme names come from the GDELT GKG theme list (V1THEMES column).
 */
const THEME_PREFIXES: [string, Topic][] = [
  ["ELECTION", "politics"],
  ["LEADER", "politics"],
  ["GENERAL_GOVERNMENT", "politics"],
  ["LEGISLATION", "politics"],
  ["GOV_", "politics"],
  ["DEMOCRACY", "politics"],
  ["ECON_", "economy"],
  ["UNEMPLOYMENT", "economy"],
  ["TAX_ECON", "economy"],
  ["WB_1104_MACROECONOMIC", "economy"],
  ["TRADE", "economy"],
  ["ARMEDCONFLICT", "conflict"],
  ["MILITARY", "conflict"],
  ["TERROR", "conflict"],
  ["REBELLION", "conflict"],
  ["CEASEFIRE", "conflict"],
  ["PEACEKEEPING", "conflict"],
  ["NATURAL_DISASTER", "environment"],
  ["ENV_", "environment"],
  ["CLIMATE", "environment"],
  ["WATER_SECURITY", "environment"],
  ["HEALTH_", "health"],
  ["MEDICAL", "health"],
  ["TAX_DISEASE", "health"],
  ["EPIDEMIC", "health"],
  ["SCIENCE", "science"],
  ["CYBER_ATTACK", "science"],
  ["SPACE", "science"],
  ["CRIME", "justice"],
  ["ARREST", "justice"],
  ["TRIAL", "justice"],
  ["JUDICIAL", "justice"],
  ["POLICE", "justice"],
  ["EDUCATION", "culture"],
  ["RELIGION", "culture"],
  ["MEDIA_", "culture"],
];

const PATH_HINTS: [RegExp, Topic][] = [
  [/\/(sports?|football|soccer|cricket|rugby|tennis|olympics|deportes|sport)\//i, "sport"],
  [/\/(culture|arts?|entertainment|music|film|movies|books|lifestyle|cultura)\//i, "culture"],
  [/\/(science|tech|technology|ciencia|wissenschaft)\//i, "science"],
  [/\/(health|salud|sante|gesundheit)\//i, "health"],
  [/\/(business|economy|markets|finance|economia|wirtschaft)\//i, "economy"],
  [/\/(politics|politica|politique|politik|elections?)\//i, "politics"],
  [/\/(environment|climate|weather|clima|umwelt)\//i, "environment"],
];

export function classify(themes: string[], url: string): Topic[] {
  const out = new Set<Topic>();
  let path = "";
  try {
    path = new URL(url).pathname + "/";
  } catch {
    /* keep empty */
  }
  // A URL section is the outlet's own label, so it wins when present.
  for (const [re, topic] of PATH_HINTS) if (re.test(path)) out.add(topic);
  if (out.size === 0) {
    const counts = new Map<Topic, number>();
    for (const theme of themes) {
      for (const [prefix, topic] of THEME_PREFIXES) {
        if (theme.startsWith(prefix)) {
          counts.set(topic, (counts.get(topic) ?? 0) + 1);
          break;
        }
      }
    }
    // Keep the two strongest signals so a passing mention doesn't tag the item.
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .forEach(([t]) => out.add(t));
  }
  return [...out];
}
