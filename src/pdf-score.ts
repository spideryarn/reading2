/**
 * **Is the transcription of this PDF any good?** — the check between pass 1 and
 * `article.html`, and the only thing standing between a model quietly losing a
 * paragraph and a reader reading an article with a paragraph missing.
 *
 * Deterministic. No model, no network. See
 * docs/plans/260826c-pdf-ingestion.md#v1-the-cheap-pass-checked.
 *
 * Three steps, in this order, and the order is the design:
 *
 *   1. ASSERT the page set          — before a single token is scored
 *   2. SCORE the CHUNK              — recall, precision, order, protected tokens
 *   3. FLOOR each page              — its own words, looked for anywhere in the
 *                                     chunk, so a short bad page cannot be paid
 *                                     for by a long good one
 *
 * **Step 2 was per page until a fourteen-page fixture proved it could not be.**
 * A paragraph that runs across a page break has to be filed under one page or
 * the other, and the model and the text layer do not always agree which — which
 * produced a 114-word "missing run" on one page and five "invented" numbers on
 * the next, for a transcription that was word-perfect. So the chunk, which is
 * the unit the model was actually asked for, is the unit that is judged.
 *
 * **Step 3 is what that cost, bought back.** Averaging over a chunk lets a
 * 2,700-word page carry a 100-word one: GPT Sol's probe kept every eighth word
 * of the short page and the chunk still scored 0.969. So each page is also
 * asked, separately, whether its own words are anywhere in the chunk's output —
 * which is boundary-proof, because a paragraph filed under the neighbour is
 * still in the chunk, and still catches a page nobody read.
 *
 * There used to be a fourth step: re-scoring a failing page against its
 * neighbours' baselines, to tell "read well, labelled badly" from "read badly".
 * Gating on the chunk answers that before it is asked, so it is gone.
 *
 * **Why step 1 exists at all**, which is the whole reason this file was written
 * the way it was: the bake-off's scoring script grouped records by the page the
 * model *claimed*, so a page the model emitted nothing for produced no row —
 * not a zero, no row. A dropped page passed by absence. It was caught by a
 * person counting records, which does not scale to a gate. Two reviewers found
 * the same hole independently. So the page set is asserted against the document
 * rather than inferred from the output, and that assertion cannot be passed by
 * saying nothing. See docs/reusable/silent-success.md — this is that pattern
 * with the checker itself playing the part of the thing that reports success.
 */

import { baselineFor, type Pass0, type PdfRecord, RENDERED } from "./pdf.js";
import {
  integrityVerdict,
  structuralFailureMessages,
  type IntegrityVerdict,
} from "./pdf-integrity.js";

/**
 * The smoke test, not the gate — and the difference is worth reading before
 * anybody moves these numbers.
 *
 * They separate the bake-off's sample perfectly, because that sample holds
 * near-verbatim successes and catastrophic failures and nothing in between. So
 * they measure no false-positive or false-negative rate at all. The arithmetic
 * that stings: **recall 0.85 permits 15% of the page to be missing**, which is
 * nowhere near the "essentially perfect" evals/pdf/README.md asks of the easy
 * fixture. The likely production failure — one omitted sentence, one altered
 * number — clears these comfortably.
 *
 * What catches that failure is not a tighter number here; it is `spans` below,
 * which fails a page for a *run* of consecutive missing words however small a
 * fraction of the page it is — and which is only affordable because the model
 * is asked to transcribe footnotes and references rather than to drop them
 * (src/pdf.ts § `RecordType`). Without that, every academic page has legitimate
 * missing runs and the only place left to put the tolerance is these numbers.
 *
 * The real gate is still set from held-out pages with deliberately seeded
 * faults, and validated on documents it was not tuned on.
 *
 * **Three inputs that pass and should not**, constructed by GPT Sol rather than
 * argued about, so that nobody has to rediscover them: an eight-word omission
 * made of words that occur elsewhere on the page (0.93 / 1.00 / 1.00);
 * twenty-five invented ordinary words on a hundred-word page (precision
 * exactly 0.80); a fifth of a page moved (order exactly 0.80). All three are
 * the same answer — a gold, in evals/pdf/<name>/gold.json — and none of them is
 * a reason to move a number here, because every number tight enough to catch
 * them fails pages that are correct.
 */
export const THRESHOLDS = { recall: 0.85, precision: 0.8, order: 0.8 } as const;

/** A missing run this long or longer is worth reporting. Eight words is about half a sentence. */
const MIN_SPAN = 8;

/**
 * How many words in that run must be missing from the output *entirely* before
 * it counts as lost text rather than as reordered text.
 *
 * The alignment on its own cannot tell those apart, and on a two-column page it
 * will regularly get it wrong in the model's favour's opposite direction: pdf.js
 * hands us the text layer in the order the file stores it, which on a
 * two-column page is often not reading order at all. Align a correct
 * transcription against a baseline in the wrong order and long runs come back
 * unaligned while every single word is present. Requiring three words that are
 * absent from the whole page's output — not just from this position in it —
 * separates "moved" from "gone" without a threshold anybody had to feel their
 * way to.
 */
const LOST_WORDS = 3;

/** How many exclusions to name in a failure message before saying "and N more". */
const SPANS_SHOWN = 5;

export interface PageScore {
  page: number;
  /** Baseline tokens after furniture removal. Zero for a scanned page — there is no text layer. */
  base: number;
  /** Tokens the model emitted for this page. */
  got: number;
  /** Baseline tokens present in the output. Catches omission and summary. `null` with no baseline. */
  recall: number | null;
  /**
   * Output tokens present **on the page** — not in the baseline. Catches invention.
   *
   * The page, because the baseline has had the running headers taken out of it
   * and the model was shown the previous page as context. Measuring against the
   * baseline made a correct transcription of a running header look like
   * invention, and made a sentence that continues across a chunk boundary look
   * like it too. Neither is invention; both are the model doing as it was told.
   * `null` where there is no text layer at all.
   */
  precision: number | null;
  /**
   * Longest common subsequence ÷ **the tokens that matched**, not ÷ the baseline.
   *
   * Dividing by the baseline is what the bake-off's script did, and it makes a
   * page that is missing a third of its words score badly on order as well —
   * the same fault counted twice, under two names, so the two numbers stop being
   * independent evidence. Divided by the matched tokens, this answers only the
   * question it is named for: of what the model *did* transcribe, is it in the
   * right sequence? Two columns read straight across scores badly here and
   * perfectly on recall, which is exactly the failure that needs its own number.
   */
  order: number | null;
  /**
   * Runs of consecutive baseline words the output does not have, longest first.
   *
   * `lost` is how many of those words appear nowhere in the page's output at
   * all; `words` counts the whole run. A run with a high `words` and a `lost` of
   * zero is text that moved, which `order` is the number for.
   */
  spans: { words: number; lost: number; text: string }[];
  /**
   * Numbers, dates, URLs and citations **in what the reader will see** that are
   * nowhere on the page.
   */
  invented: string[];
  /**
   * The same faults — invented tokens, markup, replacement characters — found in
   * records v1 transcribes and then throws away: footnotes, references, a
   * publisher's cover page, a table's cells.
   *
   * **Reported, never gated**, and the reasoning is the same one that put those
   * records in the prompt at all. On the `harder` fixture the reader invented a
   * DOI — `hgss-9-53-2018` for a paper printed on pages 79–83 — inside a
   * reference. That is a real fault and this check is right to have caught it,
   * and it is also in a bibliography v1 does not render. Failing a fourteen-page
   * article over it would teach whoever met it to widen the threshold, and the
   * threshold is what catches the same fault in a paragraph.
   *
   * The page's recall and its missing runs still cover these records, so a model
   * cannot escape the gate by labelling a paragraph `reference` — the page must
   * still be transcribed in full.
   */
  unshown: string[];
  /** The same, the other way round — reported, never gated. See `check` below for why. */
  absent: string[];
  records: number;
  /** Records the model marked `uncertain` — the one honest signal a scan gives us. */
  uncertain: number;
  /** Snippets where the reader would see markup instead of text. See `MARKUP`. */
  markup: string[];
  /** How many replacement characters (U+FFFD) the output holds — each one a word lost upstream. */
  garbage: number;
}

export interface Coverage {
  /** Pages we asked for that have no records at all. The failure that used to pass by absence. */
  missing: number[];
  /** Pages we asked for whose records carry no substantive text. */
  blank: number[];
  /** Pages claimed by a record that the document does not have. */
  impossible: number[];
  /** Real pages claimed by a record that this chunk did not ask for — the context page, usually. */
  unrequested: number[];
}

export interface Check {
  ok: boolean;
  /** Publication safety, separate from the prose written for diagnostics. */
  verdict: IntegrityVerdict;
  coverage: Coverage;
  /**
   * **The whole chunk, scored as one — and this is what the gate reads.**
   *
   * Per-page numbers below are diagnostics; they are not the unit of judgment,
   * and treating them as one cost an afternoon. A paragraph running across a
   * page break has to be attributed to one page or the other, and the model and
   * the PDF's text layer do not always agree which. On the `harder` fixture the
   * reader put the opening of page 9 — a sentence the text layer splits
   * mid-word, "…ange sphere of 15 cm" — into a page-8 record. Page 9 then had a
   * 114-word missing run and page 8 had five invented numbers, and every word
   * of it was transcribed correctly.
   *
   * That is a boundary, not a fidelity failure, and every document has them.
   * The chunk is the unit the model was actually asked for, so it is the unit
   * that is judged. What is lost is locality — a failure names three pages
   * rather than one — and `pages` is still there to narrow it down.
   *
   * The page SET assertion stays per page, because it is about presence rather
   * than attribution: a page with no records is a failure however the chunk
   * scores.
   */
  overall: PageScore;
  /** Per page, for reading a failure. Not the gate — see `overall`. */
  pages: PageScore[];
  /**
   * The pages `overall` actually covers — which is not the pages requested.
   *
   * A page with no text layer has nothing to check against, and a trailing
   * bibliography is deliberately left out. Both are reported honestly rather
   * than counted as checked, because `meta.pagesChecked` is what a reader is
   * shown and "8 of 8" for a document where one page was skipped is the kind of
   * number that is worse than none.
   */
  scored: number[];
  /** Plain sentences naming what went wrong and where. Empty when `ok`. */
  failures: string[];
  /**
   * Faults found in text v1 transcribes and does not show — a wrong DOI in a
   * bibliography, markup in a footnote. Worth logging, not worth failing an
   * article for. See `PageScore.unshown`.
   */
  notes: string[];
}

// ─────────────────────────────────────────────────────────── the folds

/**
 * Two texts compared as words.
 *
 * NFKC and case-folded, punctuation dropped — which is a **known weakness, not
 * a simplification**: the prompt demands spelling, punctuation and capitalisation
 * exactly, and this fold cannot see any of the three. It is here because the
 * text layer and the model disagree constantly about hyphens, quote marks and
 * spacing for reasons that are not the model's fault, and gating on those would
 * fire on every page until somebody widened the threshold until it caught
 * nothing. What punctuation and case actually need is a gold, which is
 * evals/pdf/<name>/gold.json and a different check. `protect` below is the part
 * of exactness that survives without one.
 */
const fold = (s: string) =>
  s.normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").toLowerCase().trim();

const tokens = (s: string): string[] => {
  const folded = fold(s);
  return folded ? folded.split(" ") : [];
};

/**
 * The tokens that must survive exactly: anything with a digit in it, and
 * anything that looks like a URL, DOI or email.
 *
 * Kept in their printed form apart from NFKC and stripped surrounding
 * punctuation, because `1,024` and `1024` are different numbers and `1868` and
 * `1863` are different years — and a transcription that gets a date wrong is
 * worse than one that drops it, since nothing downstream can tell.
 */
function protect(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.normalize("NFKC").split(/\s+/)) {
    const word = raw.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
    if (!word) continue;
    if (/\d/.test(word) || /:\/\/|^www\.|@|^10\.\d{4}/.test(word)) out.push(word);
  }
  return out;
}

/**
 * Which protected tokens of `want` are nowhere in `have`.
 *
 * **Matched against a set of whole tokens, not against the page as one string,
 * and the difference is a real defect it took a probe to find.** The first
 * version packed the page into one string with the spaces removed and asked
 * `includes`. That reads as tolerant, and it is — of the wrong thing. `12` is a
 * substring of `2012`, so a model that turned the year 2012 into 12 passed
 * this check silently: the one class of error `protect` exists to catch, waved
 * through by the matcher rather than by the threshold. Found by GPT Sol, by
 * constructing the input rather than by reading the code.
 *
 * What the packing was *for* stays, and it is why the haystack is built rather
 * than just split: a PDF breaks a long word — a URL, most often — across a line
 * with a hyphen, and the prompt tells the model to join it back up. So the page
 * holds `…/27/rock-` and `waga.html` on two lines and a correct transcription
 * holds `…/27/rockwaga.html`. Every such join is added to the haystack as its
 * own token, so the tolerance is a named case rather than a side effect of not
 * knowing where words end.
 */
function protectedFaults(want: string[], have: string, extra: readonly string[] = []): string[] {
  const haystack = new Set<string>();
  for (const token of protectedOf(have, extra)) {
    haystack.add(flatten(token));
    haystack.add(flatten(token).replace(/-/gu, ""));
  }
  return want.filter((token) => {
    const needle = flatten(token);
    return !haystack.has(needle) && !haystack.has(needle.replace(/-/gu, ""));
  });
}

/**
 * Every protected token on the page, plus **every way two or three adjacent
 * tokens could have been one before a line break split them.**
 *
 * A PDF breaks a long token wherever it runs out of line, and it does not
 * always leave a hyphen to say so. All three of these are on the `harder`
 * fixture, and all three were reported as invented by a transcription that was
 * exactly right:
 *
 *   page 3 ends "…meteorologist, 1936–"     page 4 begins "1940"
 *   "…pp. 9–"                                "12"
 *   "https://bildsuche."                     "digitale-sammlungen.de/…&bandnummer="
 *                                            "bsb00081185&pimage=00443&…"
 *
 * The first two are split at a dash *and across a page boundary*, so the
 * per-page hyphen mending in src/pdf.ts cannot see them. The third is split
 * three ways at a `.` and an `=`, with no hyphen anywhere — which no rule about
 * hyphens can ever catch.
 *
 * **This is the tolerance the old packed-string `includes` had, bought back
 * without the flaw that came with it.** That version tolerated any split at all
 * because it had no idea where tokens ended — and tolerated `2012 → 12` for
 * exactly the same reason. Joining adjacent tokens only ever makes a haystack
 * entry *longer*, so a truncated number still matches nothing. The test that
 * says so sits next to the two that need the joins.
 *
 * **And whatever `extra` the caller has for it** — in practice `defusedFolios`
 * below, the one place this file makes a haystack entry *shorter*. It is passed
 * in rather than derived here because it needs to know which page each line came
 * from, and by this point the pages of a chunk are one string.
 */
function protectedOf(text: string, extra: readonly string[]): string[] {
  const raw = text.normalize("NFKC").split(/\s+/);
  const all = [...raw];
  for (let i = 0; i < raw.length - 1; i++) {
    const first = raw[i]!;
    const second = raw[i + 1]!;
    all.push(first + second);
    /* And with a trailing hyphen dropped, which is the ordinary case and the
       one a reader would expect the model to have removed. */
    all.push(first.replace(/[-\u2010\u00ad]$/u, "") + second);
    const third = raw[i + 2];
    if (third !== undefined) all.push(first + second + third);
  }
  all.push(...extra);
  return protect(all.join(" "));
}

/**
 * A numbered heading, as a whole token: `4.`, `16.3.`, `9.5.10.`.
 *
 * The trailing dot is required and it is doing work — it is most of what keeps
 * this rule off an ordinary year. `2012` is not a numbered heading; `2012.` at
 * the start of a line is, as far as this can tell.
 */
const NUMBERED_HEADING = /^\d+(?:\.\d+)*\.$/u;

/**
 * **The page number the text layer welded onto the heading below it, taken back
 * off again — and only the page number this document actually prints there.**
 *
 * `pass0` in src/pdf.ts concatenates pdf.js text items with no separator unless
 * the item carries `hasEOL`, and pdf.js does not set it on a folio printed on
 * its own line. So a journal that prints the page number at the top of the page
 * and a paper that numbers its sections three deep produce this, verbatim, from
 * Kuhn's "A Landscape of Consciousness":
 *
 *     …Molecular Biology 190 (2024) 28–169␊649.5.10. Mansell's perceptual…
 *
 * `64` is the printed folio and `9.5.10.` is the heading. `protect` above
 * tokenises on whitespace, so the haystack holds `649.5.10` and never `9.5.10`
 * — and a model that correctly obeys rule 6 and drops the running furniture
 * writes a clean `9.5.10.` and is scored as having *invented* it. Eight
 * headings on that one document, every one genuinely printed where the model
 * put it. `protectedOf` can already *join* two tokens pdf.js split; nothing
 * could *split* one it had merged. Confirmed twice independently on the real
 * file — docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md
 * § The checker defect.
 *
 * **The first version of this stripped one to four leading digits from any
 * line-initial numbered heading, and that was a hole, not a rule.** GPT Sol
 * scored a page printing `12.3. Genuine heading` against a transcription saying
 * `2.3. Genuine heading` and the check passed it: any heading with a multi-digit
 * first component admitted every truncation of it. Corrupting a section number
 * is precisely the class `protect` exists to catch, and suppressing that retry
 * publishes a silently wrong article — much worse than the ~8 wasted retries the
 * rule was written to save. So the strip is now **one exact number, the folio
 * `folioOffset` elected for this document, on the page it belongs to**, and
 * every case it cannot corroborate goes back to being a fault.
 *
 * **Three constraints keep it there**, and each is load-bearing rather than
 * tidy:
 *
 * - **Line-initial only.** A folio is the first thing on its line and nothing
 *   else is. Without this clause the neighbouring test breaks: the page prints
 *   `1843–79`, the model writes `43–79`, and a free-floating digit strip would
 *   wave it through.
 * - **The whole token must be a numbered heading** — digits, dots, and a final
 *   dot. `2012a)` and `1843–79` are not, so neither is ever a candidate.
 * - **What is left when the folio comes off must be a numbered heading too.**
 *   That is what tells a folio welded to a heading from a heading that merely
 *   opens with this page's number: folio 77 against `77.3.` leaves `.3.`, which
 *   is nothing, so a model that shortens that heading to `3.` is still caught.
 *
 * Exported, with `folioOf`, only so evals/pdf/item-boundaries/compare.mts can
 * set what this recovers beside what the text-layer item boundary recovers —
 * docs/plans/260911b-pdf-item-boundaries-evidence.md.
 */
export function defusedFolios(text: string, folio: string | null): string[] {
  if (folio === null) return [];
  const out: string[] = [];
  for (const line of text.normalize("NFKC").split("\n")) {
    const first = line.trim().split(/\s+/)[0];
    if (first === undefined || !first.startsWith(folio)) continue;
    if (!NUMBERED_HEADING.test(first)) continue;
    const heading = first.slice(folio.length);
    if (!NUMBERED_HEADING.test(heading)) continue;
    out.push(heading);
  }
  return out;
}

/** How many leading digits of a line could be a folio. Nothing paginates past four. */
const MAX_FOLIO_DIGITS = 4;

/**
 * How much of a document has to agree before a number counts as its folio.
 *
 * Measured on Kuhn, whose 142 pages start at journal page 28: the offset 27 is
 * line-initial on **141** of them and the runner-up on **10**, so the winner
 * clears every one of these by a distance. They are written as a share and a
 * ratio rather than as counts so that a short document is held to the same
 * standard as a long one — and `pages` is there because two or three pages
 * cannot corroborate anything, however unanimous they look.
 */
const FOLIO_AGREEMENT = { pages: 3, share: 0.5, margin: 2 } as const;

/** Computed once per document: `check` runs per chunk, and there are 69 of them. */
const folioOffsets = new WeakMap<Pass0, number | null>();

/**
 * **How far the printed page numbers run ahead of the file's, if this document
 * prints page numbers at all.**
 *
 * The folio is knowable and it is worth knowing, because it is the one thing
 * that says which leading digits on a line are furniture rather than content.
 * Every page votes for every offset its line-initial digit runs could imply —
 * `649.5.10.` on file page 37 votes for 5, 63 and 648 — and an offset wins only
 * by being the same on most of the document. An offprint whose folios restart,
 * a book with roman front matter, a page of prose with no number printed on it:
 * none of those elects anything, and `defusedFolios` then does nothing at all.
 * That is the intended answer. **A wasted retry costs money; a suppressed
 * genuine fault costs the reader an article with a wrong number in it.**
 *
 * The stronger fix is upstream: `pass0` knows the text-layer item boundary
 * between the folio and the heading and throws it away. Keeping it would mean
 * none of this had to be inferred. src/pdf.ts § `pass0`, and the plan's stage 5.
 * Measured 2026-09-11 (docs/plans/260911b-pdf-item-boundaries-evidence.md): the
 * boundary recovers the same 11 headings on Kuhn with no vote, and a URL this
 * cannot reach — but splitting on it also turns a stacked `1`/`2` into two
 * tokens and forgives a dropped digit, so this stays until a narrower rule is
 * proved (docs/plans/260911c-score-pdf-pages-at-the-line-breaks-pdfjs-did-not-mark.md).
 */
function folioOffset(pass: Pass0): number | null {
  const known = folioOffsets.get(pass);
  if (known !== undefined) return known;
  const support = new Map<number, number>();
  for (const p of pass.pages) {
    const voted = new Set<number>();
    for (const line of p.text.normalize("NFKC").split("\n")) {
      const run = /^\d+/u.exec(line.trim())?.[0];
      if (run === undefined) continue;
      for (let take = 1; take <= run.length && take <= MAX_FOLIO_DIGITS; take++) {
        voted.add(Number(run.slice(0, take)) - p.page);
      }
    }
    for (const offset of voted) support.set(offset, (support.get(offset) ?? 0) + 1);
  }
  const ranked = [...support].sort((a, b) => b[1] - a[1]);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const elected =
    winner === undefined ||
      winner[1] < FOLIO_AGREEMENT.pages ||
      winner[1] < pass.pages.length * FOLIO_AGREEMENT.share ||
      (runnerUp !== undefined && winner[1] < runnerUp[1] * FOLIO_AGREEMENT.margin)
      ? null
      : winner[0];
  folioOffsets.set(pass, elected);
  return elected;
}

/** The page number printed on this page, as the text layer would hold it. */
export function folioOf(pass: Pass0, page: number): string | null {
  const offset = folioOffset(pass);
  if (offset === null) return null;
  const folio = page + offset;
  return folio > 0 ? String(folio) : null;
}

/**
 * A string reduced to what a comparison of *values* should care about: dash
 * style normalised, case folded, and every character that carries no
 * information at all removed.
 *
 * That last set is not hypothetical. Reading the `easy` fixture, the model
 * joined a hyphenated URL back together and put U+FFFE — a permanent
 * noncharacter — where the hyphen had been. Invisible, worthless, and enough to
 * make `http://jacketmagazine.com/27/rockwaga.html` look like a URL that is not
 * on the page. Emitting it is still a fault; it is just a different one, and
 * `GARBAGE` below is the check that names it.
 */
const flatten = (s: string) => dashes(s).replace(IGNORABLE, "").replace(/\s+/gu, "").toLowerCase();

/**
 * Every kind of dash, and a doubled hyphen, written the same way.
 *
 * `1868–2020` and `1868--2020` are the same page range, and the second is a
 * model rendering the first the way a typewriter would. That is a punctuation
 * error and the prompt does forbid it — but this check is the one that says a
 * *number is wrong*, and letting it fire on dash style buries a changed date
 * under a pile of hyphens. The markup check below is where "the model ignored
 * the format instructions" belongs.
 */
const dashes = (s: string) => s.normalize("NFKC").replace(/[\u2010-\u2015\u2212]|--+/gu, "-");

/** Characters that carry no information, so a comparison of values must ignore them. */
const IGNORABLE = /[\uFFFE\uFFFF\uFFFD]|\p{Default_Ignorable_Code_Point}/gu;

/**
 * **U+FFFD only** — and the fact that this is one character rather than the
 * whole ignorable set above is the decision, not an accident.
 *
 * The replacement character means something upstream met bytes it could not
 * decode and *lost a word*. What is on the page is gone rather than wrong, and
 * no later stage can tell. That is worth failing a page for.
 *
 * The permanent noncharacters U+FFFE and U+FFFF are a different thing: pure
 * rubbish, carrying nothing, and the model emits one reliably where the `easy`
 * fixture hyphenates a URL across a line. Failing an otherwise word-perfect
 * eight-page paper over two invisible characters would make the release
 * fixture un-ingestable to no purpose — so those are removed at the boundary
 * instead, counted, and reported in the pipeline's log line. src/pdf-read.ts
 * § `parseRecords`. Normalise what is meaningless; fail on what is missing.
 */
const GARBAGE = /\uFFFD/gu;

/**
 * Markdown, LaTeX and HTML, which rule 8 of the prompt forbids outright.
 *
 * Worth its own check because it is the cheapest signal there is that a model
 * has stopped following the instructions and started formatting — and because
 * it is invisible to every ratio here: `$^{1,\Omega}$` and `**Table 1**` fold
 * down to words that match the page perfectly. Mistral Medium emitted both on
 * the first page it was given, at a recall of 0.93.
 */
const MARKUP = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>|\$\^?\{|\\[a-zA-Z]{2,}|\*\*[^*\n]+\*\*|^#{1,6}\s/gmu;

function counts(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Which of `want` are present in `have`, in order, counting duplicates properly. */
function coveredMask(want: string[], have: string[]): boolean[] {
  const pool = counts(have);
  return want.map((t) => {
    const n = pool.get(t) ?? 0;
    if (n > 0) {
      pool.set(t, n - 1);
      return true;
    }
    return false;
  });
}

const hits = (want: string[], have: string[]) => coveredMask(want, have).filter(Boolean).length;

/**
 * The size at which the alignment table stops being a page-sized problem.
 *
 * 25 million cells is a 5,000-token baseline against a 5,000-token output —
 * which is not a page, it is a whole document, and it means the chunking above
 * handed us the wrong unit. Falling back to a cheaper approximation here would
 * be the tempting thing and the wrong one: the approximation is the bag of
 * words, the bag of words cannot see a deleted sentence, and the check would go
 * on reporting success on exactly the input it had stopped being able to check.
 * So it says so instead.
 */
const ALIGN_CELLS = 25_000_000;

/**
 * Which baseline positions the output actually covers, **in order** — the LCS
 * alignment rather than the bag of words.
 *
 * This distinction is the whole reason a deleted sentence is catchable. Ask the
 * multiset whether "a man may govern his tongue who cannot govern the shape of
 * his skull" is present and it answers yes on every word, because `a`, `his`,
 * `the` and `govern` all occur elsewhere on the page — so the run of missing
 * words has no run in it and the sentence disappears from the report while the
 * only trace left is 13 words of recall, which no threshold worth having would
 * fail. It is the same class of mistake as scoring the pages the model claimed:
 * a check that looks in the wrong place returns a clean answer.
 *
 * Recall stays on the multiset deliberately — "is this word anywhere in the
 * output" is the right question for omission, and asking it in order would fold
 * a column-order fault into the omission number, which is precisely what
 * `order` is separated out to avoid.
 */
function alignedMask(base: string[], got: string[]): boolean[] {
  if (!got.length) return base.map(() => false);
  if (base.length * got.length > ALIGN_CELLS) {
    throw new Error(
      `pdf-score: ${base.length} baseline tokens against ${got.length} transcribed ones is too big to ` +
        `align. That is not one page — check how the document was chunked before changing this limit.`,
    );
  }
  const width = got.length + 1;
  const table = new Uint32Array((base.length + 1) * width);
  for (let i = 1; i <= base.length; i++) {
    for (let j = 1; j <= got.length; j++) {
      table[i * width + j] =
        base[i - 1] === got[j - 1]
          ? table[(i - 1) * width + j - 1]! + 1
          : Math.max(table[(i - 1) * width + j]!, table[i * width + j - 1]!);
    }
  }
  const mask = base.map(() => false);
  let i = base.length;
  let j = got.length;
  while (i > 0 && j > 0) {
    if (base[i - 1] === got[j - 1]) {
      mask[i - 1] = true;
      i--;
      j--;
    } else if (table[(i - 1) * width + j]! >= table[i * width + j - 1]!) i--;
    else j--;
  }
  return mask;
}

/**
 * Maximal runs of unaligned baseline words, with how much of each is genuinely
 * absent from the output rather than merely somewhere else in it.
 */
function spansOf(base: string[], aligned: boolean[], present: boolean[]): PageScore["spans"] {
  const spans: PageScore["spans"] = [];
  let start = -1;
  for (let i = 0; i <= aligned.length; i++) {
    if (i < aligned.length && !aligned[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const words = i - start;
      const lost = present.slice(start, i).filter((p) => !p).length;
      if (words >= MIN_SPAN && lost >= LOST_WORDS) {
        spans.push({ words, lost, text: base.slice(start, i).join(" ") });
      }
      start = -1;
    }
  }
  return spans.sort((a, b) => b.lost - a.lost || b.words - a.words);
}

// ────────────────────────────────────────────────────────── the check

/**
 * One page's records scored against one page's baseline.
 *
 * `onPage` is the page's *whole* text layer, furniture included, and it exists
 * for one question only: is a number in the output on the page anywhere? The
 * baseline has the running headers taken out of it, which is right for recall —
 * the model is told to drop them — and wrong for invention, as the first real
 * page proved. The `harder` fixture prints its DOI in the running header of
 * every page, so pass 0 correctly calls it furniture, and a model that
 * transcribed the DOI was then accused of making it up.
 *
 * `defused` is what `defusedFolios` recovered from the page(s) `onPage` holds,
 * computed by `check` because only it knows which line came from which page and
 * what folio was printed on it. It joins the haystack for the two checks that
 * ask "is this on the page" and not the one that asks "did the model keep this":
 * the entries describe the *page*, so putting them in a haystack built from the
 * model's own words would answer a question nobody asked.
 */
export function scorePage(
  page: number,
  baseline: string[],
  records: PdfRecord[],
  onPage: string = baseline.join("\n"),
  defused: readonly string[] = [],
): PageScore {
  const base = baseline.flatMap(tokens);
  /* Everything, for recall and the missing runs: the page has to have been
     transcribed in full, whatever we intend to show of it. */
  const text = records.map((r) => r.text).join("\n");
  const got = tokens(text);
  /* What the reader will actually see, for the checks that gate. */
  const shownText = records.filter((r) => RENDERED.has(r.type)).map((r) => r.text).join("\n");
  const hiddenText = records.filter((r) => !RENDERED.has(r.type)).map((r) => r.text).join("\n");
  const shared: Omit<
    PageScore,
    "recall" | "precision" | "order" | "spans" | "absent" | "invented" | "unshown"
  > = {
    page,
    base: base.length,
    got: got.length,
    records: records.length,
    uncertain: records.filter((r) => r.uncertain).length,
    markup: [...shownText.matchAll(MARKUP)].map((m) => m[0]).slice(0, 5),
    garbage: shownText.match(GARBAGE)?.length ?? 0,
  };
  if (base.length === 0) {
    /* A scanned page. There is nothing to check against, and saying 1.0 here
       would be the worst possible answer — a perfect score for a page nobody
       has checked. Null means "not checked", and the reader is told so. */
    return {
      ...shared,
      recall: null,
      precision: null,
      order: null,
      spans: [],
      absent: [],
      invented: [],
      unshown: [],
    };
  }
  const mask = coveredMask(base, got);
  const matched = mask.filter(Boolean).length;
  const aligned = alignedMask(base, got);
  const baselineText = baseline.join("\n");
  return {
    ...shared,
    recall: round(matched / base.length),
    precision: got.length ? round(hits(got, tokens(onPage)) / got.length) : 0,
    order: matched ? round(aligned.filter(Boolean).length / matched) : 0,
    spans: spansOf(base, aligned, mask),
    absent: protectedFaults(protect(baselineText), text),
    invented: protectedFaults(protect(shownText), onPage, defused),
    unshown: [
      ...protectedFaults(protect(hiddenText), onPage, defused),
      ...[...hiddenText.matchAll(MARKUP)].map((m) => m[0]),
      ...(hiddenText.match(GARBAGE) ?? []),
    ].slice(0, 10),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Does every page we asked for actually have output, and does every record
 * claim a page that exists?
 *
 * This runs before anything is scored and it is not a score. A page with no
 * records has no row in the table below, so no threshold can be applied to it —
 * which is exactly how the failure this file exists for got through.
 */
export function coverageOf(records: PdfRecord[], requested: number[], pass: Pass0): Coverage {
  const claimed = new Set(records.filter((r) => hasText(r.text)).map((r) => r.page));
  const anyRecord = new Set(records.map((r) => r.page));
  const real = new Set(pass.pages.map((p) => p.page));
  return {
    missing: requested.filter((p) => !anyRecord.has(p)),
    blank: requested.filter((p) => anyRecord.has(p) && !claimed.has(p)),
    impossible: [...anyRecord].filter((p) => !real.has(p)).sort((a, b) => a - b),
    unrequested: [...anyRecord].filter((p) => real.has(p) && !requested.includes(p)).sort((a, b) => a - b),
  };
}

const hasText = (s: string) => /[\p{L}\p{N}]/u.test(s ?? "");

/**
 * The whole check for one chunk: assert the pages, score them, and explain any
 * failure in a sentence that names the page.
 *
 * **`invented` gates and `absent` only reports, and that asymmetry is the
 * point.** A number in the output that is nowhere on the page cannot be
 * anything but invention. A number in the *baseline* that is missing from the
 * output very often can be: the prompt tells the model to leave out page
 * numbers, footnotes and the references list, and the text layer still contains
 * every one of them. So the recall side of exactness is a list a person reads,
 * not a number a build fails on — and it is written down with its word count
 * rather than absorbed into a wider threshold, which is how an exclusion list
 * stops being load-bearing and starts being decorative.
 */
export function check(
  records: PdfRecord[],
  requested: number[],
  pass: Pass0,
  options: {
    thresholds?: { recall: number; precision: number; order: number };
    /**
     * The page sent with this chunk as evidence and not to be emitted.
     *
     * It counts as "on the page" for invention and precision, and never for
     * recall. A sentence that starts on the context page and finishes on the
     * first requested one is a sentence the model was shown, and pulling a few
     * of its words across the boundary is not making something up — but the
     * requested pages still have to be transcribed in full, so recall is
     * untouched by it.
     */
    context?: number | undefined;
    /**
     * Pages to leave out of the scoring entirely, with `why` said out loud.
     *
     * One caller and one reason: a trailing page that is mostly a reference
     * list. Rule 5 of the prompt asks for those to be transcribed and labelled
     * so the baseline and the output cover the same text — and on a paper with
     * sixty references the reader simply will not do it, returning a couple of
     * dozen and stopping. That is a recall of 0.055 on a page whose every word
     * of *body text* is correct.
     *
     * Excluding them is the honest move and it is not free, so the cost is
     * written down here rather than in a commit message: **a paragraph of real
     * prose on an excluded page is no longer checked.** What keeps that narrow
     * is that the caller only excludes *trailing* pages the model itself
     * labelled `reference` — a mid-document page labelled that way still gates,
     * so the evasion is not available where it would hurt — and that the
     * exclusion is reported every time rather than absorbed.
     */
    unchecked?: readonly number[];
  } = {},
): Check {
  const thresholds = options.thresholds ?? THRESHOLDS;
  const coverage = coverageOf(records, requested, pass);
  const failures: string[] = [];

  /* Structural failures are added from their typed form below. `coverage`
     deliberately still reports blank, scanned and reference pages even where
     their absence is not a reason to refuse the document. */

  /* **Per page, because a folio belongs to a page**, and by the time the chunk
     score below has joined four pages into one string there is no way to tell
     which line was printed under which number. Computed here, added to the
     haystack there. */
  const defusedOn = (page: number): string[] =>
    defusedFolios(pass.pages.find((p) => p.page === page)?.text ?? "", folioOf(pass, page));

  const notes: string[] = [];
  const pages: PageScore[] = [];
  for (const page of requested) {
    pages.push(
      scorePage(
        page,
        baselineFor(pass, page),
        records.filter((r) => r.page === page),
        pass.pages.find((p) => p.page === page)?.text,
        defusedOn(page),
      ),
    );
  }

  /*
   * One baseline and one transcription for the chunk, in page order — over the
   * pages that HAVE a baseline, and only those.
   *
   * That qualifier is the Wellcome scan. Its first chunk is pages 1–3, of which
   * page 1 is the digitising library's own generated rights page with a text
   * layer and pages 2–3 are photographs of Victorian print with nothing in them
   * at all. Concatenate the three and the chunk has 104 baseline tokens against
   * a thousand transcribed ones: recall 1.0, precision 0.1, and a perfect
   * transcription of a scan failing for having read the pages nobody could
   * check. Restricting both sides to the checkable pages is the only comparison
   * there is; the rest of the chunk is unverified, which is what the reader is
   * told on the page.
   */
  const where = requested.length === 1 ? `Page ${requested[0]}` : `Pages ${requested.join(", ")}`;
  const unchecked = [...new Set(options.unchecked ?? [])];
  const checkable = requested.filter(
    (page) => baselineFor(pass, page).length > 0 && !unchecked.includes(page),
  );
  if (unchecked.some((page) => requested.includes(page))) {
    notes.push(
      `Page(s) ${unchecked.filter((p) => requested.includes(p)).join(", ")} were not scored: the ` +
        `source text and transcribed records identify a reference list at the document's end, ` +
        `which models transcribe only partly. Body text on them is unchecked.`,
    );
  }

  const scoredPages = [...(options.context === undefined ? [] : [options.context]), ...checkable];
  const overall = scorePage(
    checkable[0] ?? 0,
    checkable.flatMap((page) => baselineFor(pass, page)),
    records.filter((r) => checkable.includes(r.page)).sort((a, b) => a.page - b.page),
    scoredPages.map((page) => pass.pages.find((p) => p.page === page)?.text ?? "").join("\n"),
    /* Each page's own folio taken off its own headings — this is the score that
       gates, so a fused folio the per-page rows forgive and this one does not
       would buy the retry anyway. */
    scoredPages.flatMap(defusedOn),
  );

  if (overall.recall !== null && !pass.isScan) {
    failures.push(...contentFailures(overall, where, thresholds, pages));
    failures.push(...thinPages(records, checkable, pass, thresholds.recall, overall.recall));
    if (overall.unshown.length) {
      notes.push(
        `${where}: ${overall.unshown.length} fault(s) in text v1 does not render — ${overall.unshown.slice(0, SPANS_SHOWN).join(", ")}.`,
      );
    }
  }
  const verdict = integrityVerdict(records, requested, pass, failures);
  if (verdict.kind === "structural") {
    failures.unshift(...structuralFailureMessages(verdict.issues, pass));
  }

  return {
    ok: verdict.kind === "pass",
    verdict,
    coverage,
    overall,
    pages,
    scored: checkable,
    failures,
    notes,
  };
}

/**
 * **Every page's own words, looked for in the WHOLE chunk's output** — the
 * floor under the chunk score, and the thing that stops one good page paying
 * for a bad one.
 *
 * GPT Sol built the input that needed it: a 100-word page with every eighth
 * word kept, followed by a perfect 2,700-word page. The chunk scores 0.969 and
 * passes; the small page scores 0.130. That is not a fixable flaw in the
 * average — a short page simply cannot move a long one — so the short page gets
 * a check of its own.
 *
 * Measured against the chunk's whole output rather than against the page's own
 * records, because that is the entire reason the gate moved to the chunk: a
 * paragraph filed under the neighbouring page is still *there*, and this must
 * not fail for it. What it catches is a page whose words are nowhere in the
 * chunk at all, which is the only thing "this page was not read" can mean.
 */
function thinPages(
  records: PdfRecord[],
  checkable: number[],
  pass: Pass0,
  floor: number,
  chunkRecall: number,
): string[] {
  const everything = tokens(records.map((r) => r.text).join("\n"));
  const out: string[] = [];
  for (const page of checkable) {
    const baseline = baselineFor(pass, page).flatMap(tokens);
    if (!baseline.length) continue;
    const found = round(hits(baseline, everything) / baseline.length);
    if (found < floor) {
      out.push(
        `Page ${page}: only ${found} of its words appear anywhere in this chunk's transcription. ` +
          `The chunk as a whole scores ${chunkRecall}, which is why this needs saying separately — ` +
          `a short page cannot move a long one's average.`,
      );
    }
  }
  return out;
}

/**
 * Which page dragged the chunk down — the cheap half of a diagnosis.
 *
 * The chunk is what fails now, so the message has to say where to look inside
 * it. This deliberately uses the *per-page* number the gate no longer trusts:
 * it is unreliable exactly at page boundaries, which is why it does not gate,
 * and it is perfectly good at pointing a person at the page that is wrong.
 *
 * What this replaced was a ±1 neighbour re-score, added to tell "read well,
 * labelled badly" from "read badly". Gating on the chunk answers that question
 * before it is asked — a record labelled with the wrong page inside the chunk
 * no longer costs anything — and the case it still could not fix, a whole chunk
 * numbered wrongly, is caught by the page-set assertion instead. A diagnostic
 * for a failure that can no longer happen is a thing that rots.
 */
function worstPage(pages: PageScore[], thresholds: { recall: number }): string {
  const scored = pages.filter((p) => p.recall !== null);
  if (scored.length < 2) return "";
  const worst = scored.reduce((a, b) => (a.recall! <= b.recall! ? a : b));
  return worst.recall! < thresholds.recall
    ? ` Page ${worst.page} is the weakest, at ${worst.recall}.`
    : "";
}

/**
 * Everything the scores say went wrong, as sentences.
 *
 * Split out from `check` because that function was doing two things: deciding
 * what is true, and writing it down. This is the writing down, and it is a flat
 * list of independent tests on purpose — each one names a different fault, and
 * folding them together would produce a message that says a page is bad without
 * saying how.
 */
function contentFailures(
  overall: PageScore,
  where: string,
  thresholds: { recall: number; precision: number; order: number },
  pages: PageScore[],
): string[] {
  const out: string[] = [];
  const bad: string[] = [];
  if (overall.recall! < thresholds.recall) bad.push(`recall ${overall.recall}`);
  if (overall.precision! < thresholds.precision) bad.push(`precision ${overall.precision}`);
  if (overall.order! < thresholds.order) bad.push(`order ${overall.order}`);
  if (bad.length) out.push(`${where}: ${bad.join(", ")}.${worstPage(pages, thresholds)}`);

  if (overall.spans.length) {
    const worst = overall.spans[0]!;
    out.push(
      `${where}: ${overall.spans.length} run(s) are missing from the transcription, the longest ` +
        `${worst.words} words — “${worst.text.slice(0, 120)}”.`,
    );
  }
  if (overall.markup.length) {
    out.push(
      `${where}: the output contains markup, which the prompt forbids — ${overall.markup.map((m) => `“${m}”`).join(", ")}.`,
    );
  }
  if (overall.garbage) {
    out.push(
      `${where}: ${overall.garbage} replacement character(s) (U+FFFD) in the output — ` +
        `something could not be decoded, and the word it stood for is gone.`,
    );
  }
  if (overall.invented.length) {
    out.push(
      `${where}: ${overall.invented.length} number(s) or address(es) in the output are on none of ` +
        `these pages — ${overall.invented.slice(0, SPANS_SHOWN).join(", ")}.`,
    );
  }
  return out;
}

/** The check as lines a person reads: the table first, then the sentences. */
export function report(result: Check): string {
  const lines = ["page  base   got  recall   prec  order  recs  unc  missing runs"];
  for (const p of [...result.pages, { ...result.overall, page: 0 }]) {
    const n = (v: number | null) => (v === null ? "    —" : String(v).padStart(5));
    const runs = p.spans.length ? p.spans.slice(0, 3).map((s) => s.words).join(",") : "";
    lines.push(
      `${(p.page === 0 ? " all" : String(p.page)).padStart(4)}  ${String(p.base).padStart(4)}  ${String(p.got).padStart(4)}  ` +
        `${n(p.recall)}  ${n(p.precision)}  ${n(p.order)}  ${String(p.records).padStart(4)}  ${String(p.uncertain).padStart(3)}  ${runs}`,
    );
  }
  if (result.failures.length) lines.push("", ...result.failures.map((f) => `FAIL  ${f}`));
  else lines.push("", "No catastrophe detected. That is not the same as correct — see THRESHOLDS.");
  if (result.notes.length) lines.push("", ...result.notes.map((n) => `note  ${n}`));
  return lines.join("\n");
}
