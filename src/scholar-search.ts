/**
 * **A Google Scholar search for a work, as an address** — and the first
 * author's name that narrows it.
 *
 * Two callers: Citations, which links a reference it could find no address for
 * (src/citations.ts § `linkFor`), and Debate's Reception, which ends with *Who
 * cites it: search Google Scholar* (src/web/DebatePanel.tsx). A search, never a
 * guessed address — the rule plan 261003f set for author links.
 *
 * **A module of its own so the browser can import it.** These lived in
 * src/citations.ts until 2026-10-03, which is server code: it imports
 * `jsdom-lazy.ts` (Node's `createRequire` at module scope) and
 * `source-hash.ts` (`node:crypto`). Nothing here may import anything that does
 * (GPT Sol's F4 on plan 261003o).
 */

/** A search for the work, never its address. */
export function scholarUrl(title: string, authors?: string): string {
  const surname = firstAuthor(authors);
  const q = `"${title}"${surname ? ` ${surname}` : ""}`;
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`;
}

/** The first author's name as the article gives it — "Sapede, D.; Seydel, T." → "Sapede". */
export function firstAuthor(authors?: string): string {
  if (!authors) return "";
  const first = authors.split(/;|,|\s&\s|\band\b/)[0] ?? "";
  return first.replace(/\bet al\.?/i, "").trim();
}
