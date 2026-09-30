// Renderers for the three presentations of one edition (spec section 1: one content model, three presentations).
// Plain HTML, no client script, system fonts. No em dashes anywhere in output.
import type { EditionItemView, EditionView } from "./edition.js";
import { REJECT_REASON_TEXT } from "./edition.js";
import type { VerifiedSentence } from "./citations.js";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export type Links = {
  /** Base URL of the Worker, no trailing slash. */
  baseUrl: string;
};

export function editionUrl(links: Links, v: EditionView): string {
  return `${links.baseUrl}/r/${v.readerToken}/${v.runDate}`;
}
export function eventUrl(links: Links, v: EditionView, eventId: number): string {
  return `${editionUrl(links, v)}/e/${eventId}`;
}
export function feedbackUrl(links: Links, v: EditionView, eventId: number, kind: "more" | "less" | "wrong" | "promote"): string {
  return `${links.baseUrl}/f/${v.readerToken}/${v.runDate}/${eventId}/${kind}`;
}

/* Level 0 and 1 as plain text, for the terminal and the email text part. */
export function renderEditionText(v: EditionView, links?: Links): string {
  const lines: string[] = [];
  lines.push(v.headline);
  lines.push("");
  v.items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.line}${it.outsideInterests ? " (outside your usual interests)" : ""}`);
    if (links) lines.push(`   ${eventUrl(links, v, it.eventId)}`);
  });
  if (v.leftOut.length) {
    lines.push("");
    lines.push("Left out today:");
    for (const l of v.leftOut) lines.push(`- ${l.title} (${REJECT_REASON_TEXT[l.reason]})`);
  }
  return lines.join("\n");
}

const STYLE = `body{margin:0;background:#fff;color:#111;font:16px/1.5 Georgia,'Times New Roman',serif}
.wrap{max-width:640px;margin:0 auto;padding:32px 20px}
h1{font-size:28px;line-height:1.25;margin:0 0 24px}
h2{font-size:18px;margin:32px 0 8px}
p{margin:0 0 12px}
a{color:#111}
.muted{color:#555;font-size:14px}
.item{padding:16px 0;border-top:1px solid #ddd}
.item:last-child{border-bottom:1px solid #ddd}
.fb a{margin-right:12px;font-size:13px}
.left li{margin:4px 0}
sup a{text-decoration:none;color:#555}
.src{font-size:14px;margin:8px 0}
blockquote{margin:6px 0 12px;padding-left:12px;border-left:2px solid #bbb;color:#333;font-size:15px}
.stake{background:#f4f4f4;padding:12px;margin:12px 0}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><div class="wrap">${body}</div></body></html>`;
}

/* Level 0 and 1 as the email. */
export function renderEmailHtml(v: EditionView, links: Links): string {
  const items = v.items
    .map(
      (it, i) => `<div class="item"><p><strong>${i + 1}.</strong> ${escapeHtml(it.line)}${it.outsideInterests ? ' <span class="muted">(outside your usual interests)</span>' : ""}</p>
<p class="muted"><a href="${eventUrl(links, v, it.eventId)}">Open the story</a></p>
<p class="fb"><a href="${feedbackUrl(links, v, it.eventId, "more")}">More like this</a><a href="${feedbackUrl(links, v, it.eventId, "less")}">Less</a><a href="${feedbackUrl(links, v, it.eventId, "wrong")}">Wrong</a></p></div>`,
    )
    .join("\n");
  const left = v.leftOut.length
    ? `<h2>Left out today</h2><ul class="left">${v.leftOut.map((l) => `<li>${escapeHtml(l.title)} <span class="muted">${escapeHtml(REJECT_REASON_TEXT[l.reason])}</span> <a class="muted" href="${feedbackUrl(links, v, l.eventId, "promote")}">Should have been in</a></li>`).join("")}</ul>`
    : "";
  const body = `<h1>${escapeHtml(v.headline)}</h1>${items}${left}<p class="muted" style="margin-top:32px">2DayAI, ${escapeHtml(v.runDate)}. <a href="${editionUrl(links, v)}">Open today's edition</a>.</p>`;
  return page(v.headline, body);
}

function sentenceHtml(s: VerifiedSentence, sourceIndex: Map<number, number>): string {
  const marks = [...new Set(s.citations.map((c) => sourceIndex.get(c.articleId)).filter((n): n is number => n !== undefined))]
    .sort((a, b) => a - b)
    .map((n) => `<sup><a href="#src-${n}">${n}</a></sup>`)
    .join("");
  return `${escapeHtml(s.text)}${marks}`;
}

/* Level 2 and 3 as one page: the explanation with citation marks, then the sources with the excerpts. */
export function renderEventPage(v: EditionView, it: EditionItemView, links: Links): string {
  const sourceIndex = new Map(it.sources.map((s, i) => [s.articleId, i + 1]));
  const part = (title: string, list: VerifiedSentence[]) => (list.length ? `<h2>${title}</h2><p>${list.map((s) => sentenceHtml(s, sourceIndex)).join(" ")}</p>` : "");
  const excerptsFor = (articleId: number) => {
    const all = [...it.explanation.whatHappened, ...it.explanation.whyItMatters, ...it.explanation.whatChangesNext];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of all) for (const c of s.citations) if (c.articleId === articleId && !seen.has(c.excerpt)) { seen.add(c.excerpt); out.push(c.excerpt); }
    return out;
  };
  const sources = it.sources
    .map((s, i) => `<div class="src" id="src-${i + 1}"><strong>${i + 1}.</strong> <a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a> <span class="muted">${escapeHtml(s.publisher)}, ${s.publishedAt.toISOString().slice(0, 10)}</span>${excerptsFor(s.articleId).map((e) => `<blockquote>${escapeHtml(e)}</blockquote>`).join("")}</div>`)
    .join("");
  const body = `<p class="muted"><a href="${editionUrl(links, v)}">${escapeHtml(v.headline)}</a></p>
<h1>${escapeHtml(it.title)}</h1>
<p>${escapeHtml(it.line)}</p>
${part("What happened", it.explanation.whatHappened)}
${part("Why it matters", it.explanation.whyItMatters)}
${part("What changes next", it.explanation.whatChangesNext)}
<div class="stake"><p class="muted">Why this matters to you. Written from your profile, not from the sources.</p><p>${escapeHtml(it.stakeParagraph)}</p></div>
<h2>Sources</h2><p class="muted">Every sentence above carries a number. The number points at the quoted passage that supports it. Sentences without a supporting passage were removed before you saw this.</p>
${sources}
<p class="fb" style="margin-top:24px"><a href="${feedbackUrl(links, v, it.eventId, "more")}">More like this</a><a href="${feedbackUrl(links, v, it.eventId, "less")}">Less</a><a href="${feedbackUrl(links, v, it.eventId, "wrong")}">Something here is wrong</a></p>`;
  return page(it.title, body);
}

/* The edition page on the web: same as the email, reached from the email footer. */
export function renderEditionPage(v: EditionView, links: Links): string {
  return renderEmailHtml(v, links);
}

const FEEDBACK_TEXT: Record<string, { ask: string; done: string }> = {
  more: { ask: "More like this?", done: "Noted. More like this." },
  less: { ask: "Less of this?", done: "Noted. Less of this." },
  wrong: { ask: "Something here is wrong?", done: "Noted. This one gets a human look." },
  promote: { ask: "This should have been in?", done: "Noted. This should have been in." },
};

/** GET shows a one-button form so link scanners in mail clients do not record feedback. POST records it. */
export function renderFeedbackConfirm(kind: string, title: string, actionUrl: string): string {
  const t = FEEDBACK_TEXT[kind] ?? { ask: "Confirm?", done: "Noted." };
  return page(t.ask, `<h1>${escapeHtml(t.ask)}</h1><p class="muted">${escapeHtml(title)}</p><form method="post" action="${escapeHtml(actionUrl)}"><button type="submit" style="font:inherit;padding:8px 16px">Yes</button></form>`);
}

export function renderFeedbackPage(kind: string, title: string): string {
  const t = FEEDBACK_TEXT[kind] ?? { ask: "", done: "Noted." };
  return page("Thanks", `<h1>${escapeHtml(t.done)}</h1><p class="muted">${escapeHtml(title)}</p>`);
}

export function renderNotFound(): string {
  return page("Not found", `<h1>Nothing here.</h1><p class="muted">No page at this address. <a href="/">Open the map</a>.</p>`);
}

/** What the Worker shows when something failed, such as the database being down. Says nothing about the cause. */
export function renderUnavailable(): string {
  return page("Unavailable", `<h1>Not available right now.</h1><p class="muted">Try again in a few minutes. <a href="/">Open the map</a>.</p>`);
}
