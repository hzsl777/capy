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

/** Languages the browser said it can't translate into the reader's: asked once a visit. */
const unavailable = new Set<string>();

/**
 * The translator for one language. A language whose model must be downloaded first can only be created during a
 * tap or click, so a failure is not kept: the next tap on Translate asks again (prepareTranslation). Before, the
 * first failure was kept for the visit and Translate never worked again.
 */
function translatorFor(source: string): Promise<TranslatorLike | null> {
  let t = translators.get(source);
  if (!t) {
    t = (async () => {
      if (!api) return null;
      try {
        const opts = { sourceLanguage: source, targetLanguage };
        const status = await api.availability(opts);
        if (status === "unavailable") {
          unavailable.add(source);
          return null;
        }
        return await api.create(opts);
      } catch {
        return null;
      }
    })();
    translators.set(source, t);
    t.then((made) => {
      if (!made) translators.delete(source);
    });
  }
  return t;
}

/**
 * Called from the Translate button's click, while the tap still counts as the reader's: starts every language the
 * day needs at once, so models that must be downloaded are allowed to.
 */
export function prepareTranslation(langs: Iterable<string>): void {
  for (const lang of new Set(langs)) if (needsTranslation(lang)) void translatorFor(lang);
}

/** Whether the browser said it can't translate this language at all. */
export function cannotTranslate(lang: string): boolean {
  return unavailable.has(lang);
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
    // A failed translation is asked again next time, once the language's model is ready.
    r.then((out) => {
      if (out === null) results.delete(key);
    });
  }
  return r;
}
