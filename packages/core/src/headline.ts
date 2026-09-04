/** Headline rules from docs/SPEC.md section 6.5. Returns the violations; an empty list means the headline passes. */
export function headlineViolations(headline: string): string[] {
  const out: string[] = [];
  const text = headline.trim();
  if (text.length === 0) return ["empty"];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 15) out.push(`too long: ${words.length} words, limit 15`);
  if (text.endsWith("?")) out.push("question form");
  if (text.includes("!")) out.push("exclamation mark");
  if (/^[^:]{1,40}:\s/.test(text)) out.push("colon-led teaser");
  if (/\b(this|here'?s|here is) (is )?why\b/i.test(text)) out.push("withheld subject");
  if (/\b(you won'?t believe|what happens next|the reason)\b/i.test(text)) out.push("withheld subject");
  if (/\u2014/.test(text)) out.push("em dash");
  return out;
}
