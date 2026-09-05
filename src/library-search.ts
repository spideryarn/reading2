/**
 * **What the reader typed, as terms to look for** — and the fold that decides
 * whether two spellings are one word.
 *
 * Three search things exist and they are easy to confuse, so:
 *
 * | | scope | how | cost |
 * |---|---|---|---|
 * | `findLiteral` (src/web/search-hits.ts) | one article | substring, in the browser | free |
 * | `findPassages` (src/search.ts) | one article | a model call | seconds, and money |
 * | `pgLibrarySearch` (src/store/pg-shelf.ts) | the whole library | a `tsvector` index | free |
 *
 * The third of those used to have a filesystem twin here — `searchLibrary`,
 * which walked `data/`, folded every paragraph and scanned it. It went on
 * 2026-09-05 with the rest of the filesystem store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * the stage-G section), and what stayed is the part that was never about files:
 * `parseQuery` and `fold`. `src/chat-tools.ts` is why they are still here —
 * see the note on `parseQuery` about the one place the browser, chat and
 * Postgres are allowed to disagree, and src/store/contracts.ts about what a
 * comparison of two of them may claim.
 */

/**
 * The shortest word we will search for.
 *
 * One and two-character terms match everything and rank nothing. Postgres
 * throws them away too, as stop words — differently, and that difference is
 * declared in `parseQuery` rather than pretended away.
 */
const MIN_TERM = 2;

/**
 * What the reader typed, as terms to look for.
 *
 * **This is where the two adapters differ, and the difference is deliberate
 * rather than an oversight.** Postgres gets `websearch_to_tsquery`, which knows
 * about `OR`, leading `-` for exclusion, English stemming and a stop-word list —
 * so `qualia OR "hard problem"` is a real query over there. Here, everything is
 * ANDed and nothing is stemmed: a search for `qualia` will not find `qualias`.
 *
 * Reproducing `websearch_to_tsquery` by hand is exactly the wrong amount of
 * work — it is a lot of it, and the result would be a second parser that is
 * *nearly* the same, which is worse than one that is obviously simpler. So this
 * one is obviously simpler, quoted phrases are the only syntax it honours, and
 * the docs say so.
 */
/* Exported, along with `fold` below, for src/chat-tools.ts — chat's
   `search_article_words` parses the reader's query with this exact function
   rather than reimplementing it. That much must not fork: somebody typing words
   into the library box and then asking chat about the same words has to be
   asking the same *question*, and the way to be sure of that is not to have two
   parsers.

   **What the two do not share is the matching rule, and that is on purpose.**
   `searchLibrary` counted with a substring scan (it went with the filesystem
   store on 2026-09-05, and `evals/embedding-retrieval.ts` carries that scan
   forward for its baseline). Chat counts with `termPattern` from
   src/term-match.ts, which matches whole words. The reason is
   written out at `searchArticleWords` in src/chat-tools.ts: chat's count goes to
   a model as an exact figure, and a scan that finds "AI" inside "said" and
   "fair" turns that figure into a lie a model has no way to doubt. A reader
   reads the highlighted hit and judges it themselves.

   Until 2026-08-28 this comment also said the two
   sides must share the notion of "matches" too. Both halves were left over from
   before the 2026-08-26 split, and both were believed — the stale sentence sent
   a later reader looking for a wiring bug that was not there. See
   docs/project/chat-tools.md. */
export function parseQuery(query: string): { terms: string[]; phrases: string[] } {
  const phrases: string[] = [];
  // Pull out "quoted phrases" first, so their inner spaces don't become term
  // boundaries. Curly quotes too — the reader's keyboard may produce either.
  const rest = query.replace(/["“”]([^"“”]+)["“”]/g, (_all, inner: string) => {
    const p = fold(inner).trim();
    if (p) phrases.push(p);
    return " ";
  });
  const terms = fold(rest)
    .split(/\s+/)
    .filter((t) => t.length >= MIN_TERM);
  return { terms, phrases };
}

/**
 * Case-folded, accent-folded, punctuation-flattened.
 *
 * NFKD then strip combining marks, so `Gödel` is found by typing `godel` — the
 * ordinary thing a reader does, and the thing a naive `toLowerCase` gets wrong
 * silently. Curly quotes and dashes are folded to their ASCII forms for the
 * same reason src/quote-match.ts folds them: the article has them and the
 * keyboard does not.
 *
 * **Nothing here may take an offset in the folded text and use it against the
 * original.** Folding is not length-preserving — NFKD expands `ﬁ` to `fi`, and
 * `toLowerCase` lengthens `İ` — so such an offset drifts by one character per
 * ligature earlier in the paragraph, with no error and nothing to grep for.
 * An earlier draft of this file did exactly that to cut a snippet. It does not
 * any more, because a hit now carries the whole paragraph and the client does
 * the cutting (see `LibraryHit.text`); the offsets below are used only to count
 * and to compare with each other, never to slice.
 */
export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .toLowerCase();
}
