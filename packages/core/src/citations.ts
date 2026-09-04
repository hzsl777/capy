import type { Explanation, Sentence } from "./schemas.js";

export type ArticleText = { id: number; text: string };

export type VerifiedSentence = Sentence & { verified: boolean };

/** Minimum surviving sentences for an explanation to ship (spec 6.3). */
export const MIN_USABLE_SENTENCES = 3;

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim().toLowerCase();
}

/** A citation is valid when its excerpt appears verbatim (whitespace and quote-normalized) in the cited article. */
export function verifySentence(sentence: Sentence, articles: Map<number, string>): VerifiedSentence {
  const ok = sentence.citations.some((c) => {
    const body = articles.get(c.articleId);
    if (!body) return false;
    const excerpt = normalize(c.excerpt);
    return excerpt.length >= 12 && normalize(body).includes(excerpt);
  });
  return { ...sentence, verified: ok };
}

export type VerifiedExplanation = {
  whatHappened: VerifiedSentence[];
  whyItMatters: VerifiedSentence[];
  whatChangesNext: VerifiedSentence[];
  survivors: number;
  dropped: number;
  usable: boolean;
};

/** Drops every sentence without a valid citation. The explanation is usable only when enough survive. */
export function verifyExplanation(explanation: Explanation, articleTexts: ArticleText[]): VerifiedExplanation {
  const articles = new Map(articleTexts.map((a) => [a.id, a.text]));
  const check = (list: Sentence[]) => list.map((s) => verifySentence(s, articles));
  const parts = {
    whatHappened: check(explanation.whatHappened),
    whyItMatters: check(explanation.whyItMatters),
    whatChangesNext: check(explanation.whatChangesNext),
  };
  const all = [...parts.whatHappened, ...parts.whyItMatters, ...parts.whatChangesNext];
  const survivors = all.filter((s) => s.verified).length;
  return {
    whatHappened: parts.whatHappened.filter((s) => s.verified),
    whyItMatters: parts.whyItMatters.filter((s) => s.verified),
    whatChangesNext: parts.whatChangesNext.filter((s) => s.verified),
    survivors,
    dropped: all.length - survivors,
    usable: survivors >= MIN_USABLE_SENTENCES,
  };
}
