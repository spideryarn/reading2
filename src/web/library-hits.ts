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
 * inside a React component, where the one rule that matters about it, *which
 * parameters a link has to carry*, was pinned by nothing. It then lost one, and
 * the symptom was a link where every present parameter was correct and the page
 * highlighted nothing. As a pure function its test can hand the link's term to
 * the reading view's real matcher, which is the check that counts
 * (tests/library-hits.test.ts § the round trip).
 *
 * See docs/project/library.md and docs/plans/260826k-library-shelf-actions-and-search.md.
 */
import { readHref } from "./router.js";
import { MIN_FIND_CHARS } from "./search-hits.js";
import type { LibraryHit } from "../types.js";

/**
 * Fold for comparison: case, accents, curly punctuation.
 *
 * The browser twin of `fold` in src/library-search.ts, and it must stay its
 * twin — a reader who finds "Gödel" by typing "godel" in the passage results
 * and *not* in the card filter would reasonably conclude the box is broken.
 * Kept as two functions rather than one shared module because this one runs in
 * the browser and that one imports node:fs; tests/library-hits.test.ts § the
 * two folds are twins runs both over one list of strings.
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
 * `starts[i]` and `ends[i]` are the source span of **UTF-16 unit** `i` of
 * `folded` — units, because that is what `indexOf` counts. So the source text
 * under a folded match at `i` of length `n` is
 * `s.slice(starts[i], ends[i + n - 1])`.
 *
 * ## One cluster at a time
 *
 * The text is walked in clusters: a character and the combining marks that
 * follow it. Every folded unit a cluster produces gets the **whole** cluster's
 * span, both ends. Three earlier versions each recorded less than that, and
 * each drifted silently:
 *
 * - only the start, so matching `af` inside `aﬁ` ended *before* the ligature
 *   (cross-family review, 2026-08-26);
 * - one entry per folded code *point*, so an emoji earlier in the paragraph put
 *   every later offset out by one — `cafe` in `😀 café` came back as `afé`;
 * - the next start read from the last entry *pushed*, so a combining mark, which
 *   folds to nothing and pushes none, lost its width — `cafe` in a decomposed
 *   `á café` came back as ` caf`. (Both GPT Sol, 2026-10-03.)
 *
 * A cluster is also the unit NFKD works in — it never reorders marks across a
 * base character — so normalising cluster by cluster gives the same string as
 * normalising the whole text, which is what the server's twin does. A code
 * point at a time did not: pointed Hebrew came out in a different order.
 */
export function foldWithMap(s: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = "";
  let cased = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const m of s.matchAll(CLUSTER)) {
    const from = m.index;
    const to = from + m[0].length;
    const pre = unlowered(m[0]);
    const out = pre.toLowerCase();
    cased += pre;
    folded += out;
    for (let n = 0; n < out.length; n++) {
      starts.push(from);
      ends.push(to);
    }
  }
  /* Lowercased once more, over the whole string, as the server does: a
     word-final `Σ` becomes `ς` only when `toLowerCase` can see that it is
     final. After NFKD and mark stripping no lowercase mapping changes a
     string's length (`İ` is already `I`), so the map above still fits — and if
     that ever stops being true the clusters' own lowercasing is kept, because a
     fold that disagrees about one sigma is a smaller fault than a map that does
     not fit its string. */
  const whole = cased.toLowerCase();
  return { folded: whole.length === folded.length ? whole : folded, starts, ends };
}

/**
 * A character and the combining marks on it; or marks with nothing under them.
 *
 * `ﾞ` and `ﾟ` (U+FF9E, U+FF9F — halfwidth katakana's voicing marks) are letters
 * by category and combining marks once NFKD has run, and they are the only two
 * characters of which that is true: every code point was tried, 2026-10-03.
 */
const CLUSTER = /[^\p{M}ﾞﾟ][\p{M}ﾞﾟ]*|[\p{M}ﾞﾟ]+/gu;

/**
 * One cluster, folded in everything but case. May come back empty (a bare
 * combining mark) or longer (a ligature).
 */
function unlowered(cluster: string): string {
  return cluster
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-");
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
  return fold(query.replace(/["“”]/g, " "))
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
 *   in search mode, and the default mode is `plain`. Without this the other two
 *   parameters arrive at a page with nothing listening for them: right
 *   paragraph, nothing highlighted, no error. This is the one that was missing.
 * - `find` — the words themselves. **One term, not the query**: in-article
 *   search matches this as a single literal substring (`findLiteral` in
 *   search-hits.ts), so a two-word query, an `OR`, or a quoted phrase matched
 *   nothing at all. And **in the hit's own spelling, not the folded one**:
 *   find-on-page folds case and nothing else, on purpose, so `cafe` finds
 *   nothing in an article that says `café` — nor `don't` in one that says
 *   `don’t`, which is most English prose. Until 2026-10-03 this sent the folded
 *   term, and its test pinned `find=cafe`. See `ownSpelling`.
 * - `match=words` — said out loud because the default became `meaning`, and a
 *   meaning-mode panel has nothing to do with a literal `find`.
 *
 * With no usable term the link degrades to `at` alone: landing on the right
 * paragraph with no search panel is a good outcome, and opening an empty
 * search panel is not.
 */
export function libraryHitHref(hit: LibraryHit, query: string): string {
  const at = `${readHref(hit.slug)}?at=${encodeURIComponent(hit.blockId)}`;
  const term = ownSpelling(hit.text, queryTerms(query));
  if (term === null) return at;
  return `${at}&mode=search&find=${encodeURIComponent(term)}&match=words`;
}

/**
 * The first of `terms` that occurs in `text`, **as `text` spells it** — or
 * `null` when none does, or none can be searched for.
 *
 * The spelling can be wider than the term: `eff` lands inside `eﬃcient`'s
 * ligature and comes back as `eﬃ`, the whole character. It can also be
 * *shorter*: `ffi` is three letters typed and one in the article, and
 * find-on-page reads a one-character `find` as "not searching yet"
 * (`MIN_FIND_CHARS`). That one is widened by a character — to the right, else
 * to the left — and passed over for the next term if neither side has one.
 *
 * **A known limit:** `text` is the block's text and find-on-page searches the
 * rendered html. For one word those agree unless rendering changes the letters
 * — a hit on `alpha` inside `\(\alpha\)` leads to a paragraph that shows `α`,
 * and nothing is highlighted. The shelf has only the text, so it cannot tell.
 */
function ownSpelling(text: string, terms: readonly string[]): string | null {
  const { folded, starts, ends } = foldWithMap(text);
  for (const term of terms) {
    const i = folded.indexOf(term);
    if (i === -1) continue;
    const start = starts[i];
    const end = ends[i + term.length - 1];
    if (start === undefined || end === undefined) continue;
    const own = text.slice(start, end);
    if (searchable(own)) return own;
    const after = text.slice(end).match(/^./su)?.[0] ?? "";
    const before = text.slice(0, start).match(/.$/su)?.[0] ?? "";
    const widened = [own + after, before + own].find(searchable);
    if (widened !== undefined) return widened;
  }
  return null;
}

/** Whether find-on-page would search for this — the test at the top of `findLiteral`. */
function searchable(find: string): boolean {
  return find.trim().length >= MIN_FIND_CHARS;
}
