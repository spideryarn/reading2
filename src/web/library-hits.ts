/**
 * Folding, query terms, and the address of a library hit — the browser half.
 *
 * A module of its own, and each of the three things in it is here for a reason
 * that came out of a review.
 *
 * **The folding** was duplicated inline in Library.tsx and in
 * `src/library-search.ts`, and a cross-family review pointed out that two
 * hand-written Unicode implementations had already begun to diverge. This one
 * is the browser's; the server's stays separate only because it lives beside
 * code that imports `node:fs`, and the two must be read together.
 *
 * **`libraryHitHref` is here so it can be tested at all.** It was three lines
 * inside a React component, in a repo with no React test runner and a `node`
 * test environment — so the one rule that matters about it, *which parameters a
 * link has to carry*, could not be pinned by anything. It then lost one, and
 * the symptom was a link where every present parameter was correct and the page
 * highlighted nothing. Adding a component test runner to catch that would have
 * been framework churn (AGENTS.md); making the rule a pure function was not.
 *
 * See docs/project/library.md and docs/plans/library-shelf-actions-and-search.md.
 */
import { readHref } from "./router.js";
import type { LibraryHit } from "../types.js";

/**
 * Fold for comparison: case, accents, curly punctuation.
 *
 * The browser twin of `fold` in src/library-search.ts, and it must stay its
 * twin — a reader who finds "Gödel" by typing "godel" in the passage results
 * and *not* in the card filter would reasonably conclude the box is broken.
 * Kept as two small functions rather than one shared module because this one
 * runs in the browser and that one imports node:fs.
 */
export function fold(s: string): string {
  return foldWithMap(s).folded;
}

/**
 * The same fold, plus **where every folded character came from**.
 *
 * Needed because a snippet has to be cut out of the *original* paragraph — the
 * reader should see the article's real curly quotes and accents, not our
 * flattened copy — while the match is found in the folded one. And folding is
 * not length-preserving: NFKD expands `ﬁ` to `fi` and `½` to `1⁄2`, and
 * `toLowerCase` lengthens `İ`. So an offset carried straight across drifts by a
 * character per ligature earlier in the paragraph, with no error and nothing to
 * grep for — every ASCII test passes and one article looks subtly wrong.
 *
 * src/library-search.ts carries the same warning for the same reason.
 */
export function foldWithMap(s: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  /* Iterated by code POINT, not by code unit, so an emoji or any astral
     character is folded once rather than as two broken halves. */
  for (const ch of s) {
    const from = starts.length === 0 ? 0 : (ends[ends.length - 1] as number);
    const to = from + ch.length;
    for (const out of foldChar(ch)) {
      folded += out;
      /* **Every folded character gets the WHOLE source character's span**, and
         both ends of it. An earlier version stored only the start, so matching
         `af` inside `aﬁ` produced an end offset *before* the ligature and the
         snippet cut it off — the exact silent drift this function exists to
         prevent, reintroduced by recording half the answer. Caught by a
         cross-family review, 2026-08-26. */
      starts.push(from);
      ends.push(to);
    }
  }
  return { folded, starts, ends };
}

/** One character, folded. May come back empty (a combining mark) or longer (a ligature). */
function foldChar(ch: string): string {
  return ch
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .toLowerCase();
}

/**
 * The terms of a query, folded, ignoring the syntax neither matcher shares.
 *
 * Quotes are stripped rather than honoured, `or` is dropped, and an excluding
 * `-term` is left out: this is used for *filtering cards* and for
 * *highlighting*, not for the real match, and a third implementation of
 * `websearch_to_tsquery`'s grammar would be a third thing to keep in step with
 * the other two.
 */
export function queryTerms(query: string): string[] {
  return fold(query.replace(/["\u201c\u201d]/g, " "))
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t !== "or" && !t.startsWith("-"));
}

/**
 * Where a library hit leads: the paragraph, and the words lit up on it.
 *
 * **Four parameters, and dropping any one of them fails silently.**
 *
 * - `at` — the block to scroll to. Without it you land at the top.
 * - `mode=search` — the reading view mounts the band that *draws* the marks only
 *   in search mode, and the default mode is `hierarchy`. Without this the other two
 *   parameters arrive at a page with nothing listening for them: right
 *   paragraph, nothing highlighted, no error. This is the one that was missing.
 * - `find` — the words themselves. **One term, not the query**: in-article
 *   search matches this as a single literal substring (`findLiteral` in
 *   search-hits.ts), so a two-word query, an `OR`, or a quoted phrase matched
 *   nothing at all. The term chosen is one that actually occurs in this hit, so
 *   the highlight is always something the reader can see.
 * - `match=words` — said out loud because the default became `meaning`, and a
 *   meaning-mode panel has nothing to do with a literal `find`.
 *
 * With no usable term the link degrades to `at` alone: landing on the right
 * paragraph with no search panel is a good outcome, and opening an empty
 * search panel is not.
 */
export function libraryHitHref(hit: LibraryHit, query: string): string {
  const term = queryTerms(query).find((t) => fold(hit.text).includes(t));
  const at = `${readHref(hit.slug)}?at=${encodeURIComponent(hit.blockId)}`;
  if (!term) return at;
  return `${at}&mode=search&find=${encodeURIComponent(term)}&match=words`;
}
