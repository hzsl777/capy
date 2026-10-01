/**
 * Translation of headlines and summaries into the language a reader picks (decision 97). The browser's own translator
 * (Chrome's Translator API) is used when it already has the language pair, which keeps the text on the device;
 * otherwise the site's Worker translates it with Cloudflare Workers AI (/api/translate), and each headline is
 * translated once for everyone. Only the text goes, never anything about the reader. Opt-in, and always labelled.
 */

interface TranslatorLike {
  translate(text: string): Promise<string>;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorLike>;
}

const device = (globalThis as unknown as { Translator?: TranslatorStatic }).Translator;

/**
 * The languages the Worker's model translates between (M2M100's hundred), by ISO 639-1 code where there is one.
 * A reader can pick any of them.
 */
export const LANGUAGES = [
  "af", "am", "ar", "ast", "az", "ba", "be", "bg", "bn", "br", "bs", "ca", "ceb", "cs", "cy", "da", "de", "el", "en",
  "es", "et", "fa", "ff", "fi", "fr", "fy", "ga", "gd", "gl", "gu", "ha", "he", "hi", "hr", "ht", "hu", "hy", "id",
  "ig", "ilo", "is", "it", "ja", "jv", "ka", "kk", "km", "kn", "ko", "lb", "lg", "ln", "lo", "lt", "lv", "mg", "mk",
  "ml", "mn", "mr", "ms", "my", "ne", "nl", "no", "ns", "oc", "or", "pa", "pl", "ps", "pt", "ro", "ru", "sd", "si", "sk",
  "sl", "so", "sq", "sr", "ss", "su", "sv", "sw", "ta", "th", "tl", "tn", "tr", "uk", "ur", "uz", "vi", "wo", "xh",
  "yi", "yo", "zh", "zu",
] as const;
const KNOWN = new Set<string>(LANGUAGES);

/** Other names browsers and feeds use for the same languages. */
const ALIAS: Record<string, string> = { nb: "no", nn: "no", fil: "tl", iw: "he", in: "id", ji: "yi", jw: "jv", nso: "ns" };

/** Names browsers don't know for the model's own codes. */
export const OWN_NAMES: Record<string, string> = { ns: "Sesotho sa Leboa" };

/** A language tag ("pt-BR", "nb", "zh-Hant") as one of LANGUAGES, or null when the model has no such language. */
export function normalizeLanguage(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const base = tag.toLowerCase().split(/[-_]/)[0]!;
  const code = ALIAS[base] ?? base;
  return KNOWN.has(code) ? code : null;
}

/** The reader's languages as the browser reports them, best first, limited to the ones that can be translated into. */
export function browserLanguages(langs: readonly string[] = navigator.languages?.length ? navigator.languages : [navigator.language]): string[] {
  const out: string[] = [];
  for (const tag of langs) {
    const code = normalizeLanguage(tag);
    if (code && !out.includes(code)) out.push(code);
  }
  return out.length ? out : ["en"];
}

/** Whether a story in `lang` needs translating to be read in `target`. */
export function needsTranslation(lang: string, target: string | null): boolean {
  const from = normalizeLanguage(lang);
  return !!target && !!from && from !== target;
}

export type Translation = { text: string; via: "device" | "server" };

const translators = new Map<string, Promise<TranslatorLike | null>>();

/**
 * The browser's own translator for a pair, only when it already has the model: creating one that must download first
 * needs a tap, and the Worker can answer at once instead.
 */
function onDevice(from: string, to: string): Promise<TranslatorLike | null> {
  const key = `${from}>${to}`;
  let t = translators.get(key);
  if (!t) {
    t = (async () => {
      if (!device) return null;
      try {
        const opts = { sourceLanguage: from, targetLanguage: to };
        return (await device.availability(opts)) === "available" ? await device.create(opts) : null;
      } catch {
        return null;
      }
    })();
    translators.set(key, t);
  }
  return t;
}

// A panel can ask for dozens of headlines at once; a few requests at a time keep the Worker and the page responsive.
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((go) => waiting.push(go));
  inFlight += 1;
  try {
    return await work();
  } finally {
    inFlight -= 1;
    waiting.shift()?.();
  }
}

/** The last reason the Worker gave for not translating, shown under a headline it couldn't translate. */
export let lastFailure = "";

async function onServer(text: string, from: string, to: string): Promise<string | null> {
  const q = new URLSearchParams({ from, to, q: text });
  const res = await slot(() => fetch(`${import.meta.env.BASE_URL}api/translate?${q}`));
  const body = (await res.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
  if (res.ok && typeof body.text === "string" && body.text.trim()) return body.text;
  lastFailure = typeof body.error === "string" ? body.error : `the site answered ${res.status}`;
  return null;
}

const results = new Map<string, Promise<Translation | null>>();

/** The text in `target`, or null when neither the browser nor the Worker could translate it. */
export function translate(text: string, lang: string, target: string): Promise<Translation | null> {
  const from = normalizeLanguage(lang);
  if (!from || from === target) return Promise.resolve(null);
  const key = `${from}\u0000${target}\u0000${text}`;
  let r = results.get(key);
  if (!r) {
    r = (async () => {
      const local = await onDevice(from, target);
      if (local) {
        try {
          return { text: await local.translate(text), via: "device" as const };
        } catch {
          // Fall through to the Worker.
        }
      }
      const out =
        text.length <= 400
          ? await onServer(text, from, target).catch((err: unknown) => {
              lastFailure = err instanceof Error ? err.message : "the site could not be reached";
              return null;
            })
          : null;
      return out ? { text: out, via: "server" as const } : null;
    })();
    results.set(key, r);
    // A failure is asked again the next time the headline is drawn.
    r.then((out) => {
      if (!out) results.delete(key);
    });
  }
  return r;
}
