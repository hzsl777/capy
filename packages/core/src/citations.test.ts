import { describe, expect, it } from "vitest";
import { verifyExplanation, verifySentence } from "./citations.js";

const articles = [
  { id: 1, text: "The Federal Reserve held its benchmark rate steady on Wednesday, citing “stable inflation expectations.”" },
  { id: 2, text: "Chipmakers rose after the announcement, with the sector index up 2.1 percent." },
];

describe("verifySentence", () => {
  it("passes when the excerpt is verbatim in the cited article", () => {
    const s = verifySentence(
      { text: "The Fed held rates.", citations: [{ articleId: 1, excerpt: "held its benchmark rate steady" }] },
      new Map(articles.map((a) => [a.id, a.text])),
    );
    expect(s.verified).toBe(true);
  });
  it("normalizes whitespace and curly quotes", () => {
    const s = verifySentence(
      { text: "x", citations: [{ articleId: 1, excerpt: 'citing "stable   inflation expectations."' }] },
      new Map(articles.map((a) => [a.id, a.text])),
    );
    expect(s.verified).toBe(true);
  });
  it("fails on a paraphrase, a wrong article, or a tiny excerpt", () => {
    const map = new Map(articles.map((a) => [a.id, a.text]));
    expect(verifySentence({ text: "x", citations: [{ articleId: 1, excerpt: "kept rates unchanged" }] }, map).verified).toBe(false);
    expect(verifySentence({ text: "x", citations: [{ articleId: 2, excerpt: "held its benchmark rate" }] }, map).verified).toBe(false);
    expect(verifySentence({ text: "x", citations: [{ articleId: 1, excerpt: "rate" }] }, map).verified).toBe(false);
    expect(verifySentence({ text: "x", citations: [] }, map).verified).toBe(false);
  });
});

describe("verifySentence drops the bad citation beside a good one", () => {
  it("keeps the sentence but not the invented excerpt", () => {
    const s = verifySentence(
      { text: "x", citations: [{ articleId: 1, excerpt: "held its benchmark rate steady" }, { articleId: 2, excerpt: "an invented quote that is not there" }] },
      new Map(articles.map((a) => [a.id, a.text])),
    );
    expect(s.verified).toBe(true);
    expect(s.citations).toEqual([{ articleId: 1, excerpt: "held its benchmark rate steady" }]);
  });
});

describe("verifyExplanation", () => {
  it("drops unsupported sentences and marks usability by survivor count", () => {
    const good = { text: "a", citations: [{ articleId: 1, excerpt: "held its benchmark rate steady" }] };
    const bad = { text: "b", citations: [{ articleId: 2, excerpt: "not in the text at all" }] };
    const chips = { text: "c", citations: [{ articleId: 2, excerpt: "sector index up 2.1 percent" }] };
    const r = verifyExplanation({ whatHappened: [good, bad], whyItMatters: [chips], whatChangesNext: [bad] }, articles);
    expect(r.survivors).toBe(2);
    expect(r.dropped).toBe(2);
    expect(r.usable).toBe(false);
    const r2 = verifyExplanation({ whatHappened: [good], whyItMatters: [chips], whatChangesNext: [good] }, articles);
    expect(r2.usable).toBe(true);
  });
});
