import { describe, expect, it } from "vitest";
import { browserLanguages, LANGUAGES, needsTranslation, normalizeLanguage } from "../src/translate.ts";

describe("translation languages (decision 97)", () => {
  it("reads a browser's or a feed's tag as one of the model's languages", () => {
    expect(normalizeLanguage("pt-BR")).toBe("pt");
    expect(normalizeLanguage("zh-Hant-TW")).toBe("zh");
    expect(normalizeLanguage("nb")).toBe("no");
    expect(normalizeLanguage("fil")).toBe("tl");
    expect(normalizeLanguage("und")).toBeNull();
    expect(normalizeLanguage("")).toBeNull();
    expect(normalizeLanguage("tlh")).toBeNull();
  });

  it("starts from the browser's languages, best first, and falls back to English", () => {
    expect(browserLanguages(["es-MX", "es", "en-US", "xx"])).toEqual(["es", "en"]);
    expect(browserLanguages(["xx"])).toEqual(["en"]);
  });

  it("translates only a story in another known language, and only once a language is picked", () => {
    expect(needsTranslation("ar", "en")).toBe(true);
    expect(needsTranslation("en", "en")).toBe(false);
    expect(needsTranslation("und", "en")).toBe(false);
    expect(needsTranslation("ar", null)).toBe(false);
  });

  it("offers a hundred languages, each once", () => {
    expect(LANGUAGES.length).toBe(100);
    expect(new Set(LANGUAGES).size).toBe(LANGUAGES.length);
  });
});
