/**
 * Finding a quoted passage inside a block's text — **one definition, two
 * sides**, exactly as src/term-match.ts is for glossary terms.
 *
 * The server uses it to check that a passage the model claims to have found is
 * really in the block it named (src/search.ts § `validateHits`); the reading
 * view uses it to work out which characters to wash (src/web/search-hits.ts).
 * If those two disagreed, the panel would list a passage and the article would
 * show nothing marked — the [silent success](docs/reusable/silent-success.md)
 * in its most annoying form, because the feature looks like it is working.
 *
 * **It imports nothing from node**, which is what lets it reach the browser
 * bundle at all. The moment it needs `node:fs` the client half breaks and the
 * two definitions drift apart again.
 *
 * ## The problem this exists for
 *
 * The model is shown `block.text`. The browser renders `block.html`. Those are
 * *different strings*, and the difference is not cosmetic:
 *
 *  - `extractText` (src/blocks.ts) collapses every run of whitespace to one
 *    space, and inserts a space at every nested block boundary. So a paragraph
 *    containing a `<blockquote>` reads `…word quoted…` to the model and
 *    `…wordquoted…` to `Range.toString()`.
 *  - The model retypes the quote rather than copying bytes, so a line break
 *    becomes a space, a run of spaces becomes one, and a curly apostrophe
 *    sometimes comes back straight.
 *
 * A plain `indexOf` therefore fails on perfectly good quotes, and failing means
 * the whole paragraph gets washed instead of the sentence — a visible loss of
 * precision with no visible cause. Hence two increasingly forgiving passes.
 *
 * ## The second pass is a drawing aid, not a verifier
 *
 * Added 2026-08-31, after GPT Sol pointed out that a forgiving *equivalence*
 * had been read as a claim of *identity*. Pass two deletes whitespace, so
 * `fall a part` matches `fall apart` — harmless when the answer is "which
 * characters do I wash", and a false claim about a real person when the answer
 * is "did the model copy this". The `passes` argument on `findQuote` is that
 * distinction, and `"spaced"` is the setting for anything that will be shown
 * as a quotation. The other half of the same fix lives at the call site:
 * **store the slice of the article, never the model's string** —
 * src/quotes.ts § `place`.
 *
 * ## Why not a regex
 *
 * Because the needle is a sentence of the author's prose, and a sentence
 * contains `(`, `.`, `?`, `[` and `$`. Escaping it into a pattern is possible —
 * term-match.ts does exactly that — but a term is a handful of words the model
 * was asked to keep simple, and a quote is arbitrary text of arbitrary length.
 * The index-mapping below is O(n) with no backtracking and no escaping rule to
 * get wrong.
 */

export interface Span {
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * Character folds that **must not change the string's length**.
 *
 * That constraint is the whole reason this is a table of single characters
 * rather than a call to `String.normalize("NFKC")`. NFKC is the obviously right
 * thing and it is wrong here: it expands `…` to three characters and `ﬁ` to
 * two, and every offset after the change then points one or two characters left
 * of where it should. The mark lands slightly off, which reads as a CSS bug
 * rather than as a text bug, and nobody looks here.
 *
 * So: quotes and dashes, which are the folds that actually matter for prose a
 * model has retyped, and nothing that changes a length.
 */
const FOLD: Record<string, string> = {
  "‘": "'", // ‘
  "’": "'", // ’
  "‚": "'", // ‚
  "“": '"', // “
  "”": '"', // ”
  "„": '"', // „
  "–": "-", // –
  "—": "-", // —
  "−": "-", // −
  " ": " ", // non-breaking space, so it counts as whitespace below
};

function fold(ch: string): string {
  return FOLD[ch] ?? ch;
}

const isSpace = (ch: string) => /\s/.test(ch);

/**
 * A string reduced for comparison, plus the map back to where each surviving
 * character came from.
 *
 * `map[i]` is the offset in the original string of the character that produced
 * `value[i]`. That is what turns a match in the reduced space back into a span
 * in the real one — without it this whole approach would find the quote and
 * then have nowhere to draw it.
 */
interface Reduced {
  value: string;
  map: number[];
}

/**
 * Lower-case, fold the quotes and dashes, and do one of two things with
 * whitespace.
 *
 * `keepSpaces` is the difference between the two passes:
 *
 *  - `true` — every run of whitespace becomes a single space. This is the
 *    ordinary case, and it is what makes a quote retyped with different line
 *    breaks match the prose it came from.
 *  - `false` — whitespace is dropped entirely. This is for the case above where
 *    `extractText` *invented* a space at a nested block boundary that the
 *    rendered text does not have, so the needle has a space the haystack
 *    cannot supply.
 *
 * Leading whitespace produces no character at all in either mode, so the map
 * never points at a space the match does not own.
 */
function reduce(text: string, keepSpaces: boolean): Reduced {
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true; // so leading whitespace is dropped, not kept as one space
  for (let i = 0; i < text.length; i++) {
    const raw = text[i] ?? "";
    const ch = fold(raw);
    if (isSpace(ch)) {
      if (!keepSpaces || lastWasSpace) continue;
      out.push(" ");
      map.push(i);
      lastWasSpace = true;
      continue;
    }
    out.push(ch.toLowerCase());
    map.push(i);
    lastWasSpace = false;
  }
  // A trailing single space would make an otherwise-exact needle miss.
  while (out.length > 0 && out[out.length - 1] === " ") {
    out.pop();
    map.pop();
  }
  return { value: out.join(""), map };
}

/**
 * The end offset of the match, in the original string.
 *
 * `map` holds the *start* of each surviving character, so the last one's start
 * plus one is the exclusive end — except that a run of whitespace collapsed to
 * one space would end the span at the first space of the run, which is right:
 * the trailing whitespace is not part of the quote.
 */
function endOf(map: number[], index: number): number {
  return (map[index] ?? 0) + 1;
}

/**
 * Where `quote` sits in `text`, or `null` if it is not there.
 *
 * `near` is a **disambiguator, never the anchor** — the same rule
 * `resolveMark` in src/web/annotate.ts follows, and for the same reason set out
 * in docs/project/block-ids.md: text first, offsets only to choose between
 * repeats. Pass the offset a previous run recorded and a quote that appears
 * twice in one paragraph resolves to the same occurrence it did last time.
 *
 * Returns offsets into `text` exactly as given — so the caller decides which
 * string it is asking about, and the answer is in that string's own space.
 * There is deliberately no default for which string that is: the server asks
 * about `block.text` and the client asks about the rendered text, and a
 * function that quietly preferred one of them would be wrong half the time.
 */
export function findQuote(
  text: string,
  quote: string,
  near?: number,
  /**
   * **Which passes to run**, and it is a safety switch rather than a tuning
   * knob. Default `"forgiving"` — both passes, which is what every caller
   * wanted until 2026-08-31.
   *
   * `"spaced"` runs **only** the whitespace-preserving pass. Use it wherever a
   * match is being read as a claim that the model copied the text rather than
   * as a best effort at drawing a mark, because pass two deletes whitespace
   * entirely and therefore accepts a word the model split in two: an article
   * saying *fall apart* matches a model saying *fall a part*.
   *
   * The split is really between the two ends of this file's job:
   *
   * - **The browser** compares a stored quote against the *rendered* text,
   *   which genuinely lacks spaces `extractText` invented at a nested block
   *   boundary. Pass two exists for that and must stay.
   * - **The server** compares the model's typing against `block.text` — the
   *   exact string the model was shown. There is no whitespace discrepancy to
   *   forgive, so the forgiving pass buys nothing and costs the guarantee.
   *
   * Found by GPT Sol's review of docs/plans/quotes-mode.md, 2026-08-31, with a
   * worked case from `data/noema-mythology-of-conscious-ai`.
   *
   * **`validateHits` (src/search.ts) and `validateOccurrences` (src/ideas.ts)
   * still pass the default**, and that is a known gap rather than a decision —
   * both store the model's string too. Changing them is a separate landing with
   * its own artefacts to think about; src/quotes.ts § `place` is where the
   * shape they should take is written down.
   */
  passes: "forgiving" | "spaced" = "forgiving",
): Span | null {
  if (quote.trim() === "" || text === "") return null;
  // Pass one keeps whitespace as single spaces; pass two drops it. Two passes
  // rather than one forgiving one, because the second is genuinely more likely
  // to find a false positive — "in the end" would match "inthe end" — and it
  // should only ever run when the careful pass has already failed.
  for (const keepSpaces of passes === "spaced" ? [true] : [true, false]) {
    const hay = reduce(text, keepSpaces);
    const needle = reduce(quote, keepSpaces);
    if (needle.value === "") continue;
    const at = nearestIndex(hay.value, needle.value, near, hay.map);
    if (at === -1) continue;
    const start = hay.map[at];
    if (start === undefined) continue;
    return { start, end: endOf(hay.map, at + needle.value.length - 1) };
  }
  return null;
}

/**
 * The occurrence of `needle` in `hay` nearest to `near` in the *original*
 * offset space, or the first one when there is no hint.
 *
 * The comparison is done after mapping back, not in the reduced space, because
 * `near` is an offset into the original string and the two spaces drift apart
 * by however much whitespace has been collapsed. Comparing a reduced index
 * against an original offset is the silent-wrongness this file exists to avoid.
 */
function nearestIndex(hay: string, needle: string, near: number | undefined, map: number[]): number {
  const first = hay.indexOf(needle);
  if (first === -1 || near === undefined) return first;
  let best = first;
  let bestDistance = Math.abs((map[first] ?? 0) - near);
  for (let i = hay.indexOf(needle, first + 1); i !== -1; i = hay.indexOf(needle, i + 1)) {
    const distance = Math.abs((map[i] ?? 0) - near);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Is this quote in this text at all? Cheaper than nothing, but it is the same
 * work — it exists so the server's validation reads as the question it is
 * asking rather than as `findQuote(…) !== null`.
 */
export function quoteAppears(text: string, quote: string): boolean {
  return findQuote(text, quote) !== null;
}

/**
 * A short piece of `text` around `span`, for a results list.
 *
 * Two lengths, not one, is a finding carried over from the version this project
 * is an offshoot of
 * (docs/project/original-version/search-and-chat.md#text-search): a short
 * snippet in the list so the results stay scannable, a longer one on hover so a
 * hit can be judged without leaving the list. It is cheap, and it is the
 * difference between a list you skim and one you have to click through.
 *
 * The window is grown to a word boundary at each end where there is one nearby,
 * so a snippet does not start mid-word — and an ellipsis is added only where
 * something was actually cut, so a short paragraph does not pretend to be an
 * extract.
 */
export function snippet(text: string, span: Span, budget: number): string {
  const want = Math.max(0, budget - (span.end - span.start));
  const before = Math.floor(want / 2);
  let from = Math.max(0, span.start - before);
  let to = Math.min(text.length, span.end + (want - (span.start - from)));
  // Grow outwards to whitespace, but never far — a paragraph with no spaces
  // near the cut should be cut rather than swallowed whole.
  for (let i = 0; i < 15 && from > 0 && !isSpace(text[from - 1] ?? " "); i++) from--;
  for (let i = 0; i < 15 && to < text.length && !isSpace(text[to] ?? " "); i++) to++;
  const body = text.slice(from, to).trim();
  return `${from > 0 ? "…" : ""}${body}${to < text.length ? "…" : ""}`;
}
