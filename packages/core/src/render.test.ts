import { describe, expect, it } from "vitest";
import type { EditionView } from "./edition.js";
import { renderEditionText, renderEmailHtml, renderEventPage, renderFeedbackConfirm } from "./render.js";

const view: EditionView = {
  editionId: 1,
  readerId: "r01",
  readerToken: "tok",
  runDate: "2026-09-04",
  headline: "Rates held, your model stands.",
  quietDay: false,
  items: [
    {
      eventId: 7,
      title: "Fed holds rates",
      importance: 4,
      line: "The Fed held rates <steady>.",
      stakeParagraph: "Your cash forecast assumptions hold.",
      outsideInterests: false,
      explanation: {
        whatHappened: [{ text: "The Fed held.", citations: [{ articleId: 11, excerpt: "held its benchmark rate steady" }], verified: true }],
        whyItMatters: [],
        whatChangesNext: [],
      },
      sources: [{ articleId: 11, title: "Fed statement", url: "https://fed.test/s", publisher: "Federal Reserve", publishedAt: new Date("2026-09-03T18:00:00Z") }],
    },
  ],
  leftOut: [{ eventId: 8, title: "Sports <b>thing</b>", reason: "muted" }],
};
const links = { baseUrl: "https://w.test" };

describe("render", () => {
  it("text carries headline, numbered lines, links, and left-out reasons", () => {
    const t = renderEditionText(view, links);
    expect(t.split("\n")[0]).toBe("Rates held, your model stands.");
    expect(t).toContain("1. The Fed held rates <steady>.");
    expect(t).toContain("https://w.test/r/tok/2026-09-04/e/7");
    expect(t).toContain("Sports <b>thing</b> (a topic you muted)");
  });
  it("email escapes html and carries feedback links", () => {
    const h = renderEmailHtml(view, links);
    expect(h).toContain("&lt;steady&gt;");
    expect(h).toContain("Sports &lt;b&gt;thing&lt;/b&gt;");
    expect(h).toContain("https://w.test/f/tok/2026-09-04/7/wrong");
    expect(h).not.toContain("\u2014");
  });
  it("feedback confirm page posts back to the same path", () => {
    const h = renderFeedbackConfirm("wrong", "Fed holds", "/f/tok/2026-09-04/7/wrong");
    expect(h).toContain('<form method="post" action="/f/tok/2026-09-04/7/wrong">');
  });
  it("event page numbers citations and quotes excerpts under sources", () => {
    const h = renderEventPage(view, view.items[0]!, links);
    expect(h).toContain('<sup><a href="#src-1">1</a></sup>');
    expect(h).toContain("<blockquote>held its benchmark rate steady</blockquote>");
    expect(h).toContain("Written from your profile, not from the sources.");
  });
});
