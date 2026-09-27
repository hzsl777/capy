/**
 * Headline translation using the browser's built-in, on-device Translator API
 * (Chrome 138+ and others as they ship it). Free, private, and nothing leaves
 * the viewer's machine. Where the API is missing, the app shows originals.
 */

interface TranslatorLike {
  translate(text: string): Promise<string>;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorLike>;
}

const api = (globalThis as unknown as { Translator?: TranslatorStatic }).Translator;
const translators = new Map<string, Promise<TranslatorLike | null>>();
const results = new Map<string, Promise<string | null>>();

export const targetLanguage = (navigator.language || "en").split("-")[0].toLowerCase();

export function translationSupported(): boolean {
  return !!api;
}

function translatorFor(source: string): Promise<TranslatorLike | null> {
  let t = translators.get(source);
  if (!t) {
    t = (async () => {
      if (!api) return null;
      try {
        const opts = { sourceLanguage: source, targetLanguage };
        const status = await api.availability(opts);
        if (status === "unavailable") return null;
        return await api.create(opts);
      } catch {
        return null;
      }
    })();
    translators.set(source, t);
  }
  return t;
}

export function needsTranslation(lang: string): boolean {
  return !!lang && lang !== "und" && lang !== targetLanguage;
}

export function translate(text: string, source: string): Promise<string | null> {
  const key = `${source}\u0000${text}`;
  let r = results.get(key);
  if (!r) {
    r = translatorFor(source).then((t) => (t ? t.translate(text).catch(() => null) : null));
    results.set(key, r);
  }
  return r;
}
