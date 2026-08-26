/**
 * **Is the transcription of this PDF any good?** — the check between pass 1 and
 * `article.html`, and the only thing standing between a model quietly losing a
 * paragraph and a reader reading an article with a paragraph missing.
 *
 * Deterministic. No model, no network. See
 * docs/plans/pdf-ingestion.md#v1-the-cheap-pass-checked.
 *
 * Three steps, in this order, and the order is the design:
 *
 *   1. ASSERT the page set          — before a single token is scored
 *   2. SCORE per page               — recall, precision, order, protected tokens
 *   3. ON FAILURE ONLY, re-score    — against the neighbouring pages' baselines,
 *                                     so "read well, labelled badly" is one
 *                                     sentence rather than an afternoon
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

import { baselineFor, type Pass0, type PdfRecord } from "./pdf.js";

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
  /** Output tokens present in the baseline. Catches invention. `null` with no baseline. */
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
  /** Numbers, dates, URLs and citations in the output that are nowhere in the baseline. */
  invented: string[];
  /** The same, the other way round — reported, never gated. See `check` below for why. */
  absent: string[];
  records: number;
  /** Records the model marked `uncertain` — the one honest signal a scan gives us. */
  uncertain: number;
  /** Snippets where the model emitted markup instead of text. See `MARKUP`. */
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
  coverage: Coverage;
  pages: PageScore[];
  /** Plain sentences naming what went wrong and where. Empty when `ok`. */
  failures: string[];
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
 * Which protected tokens of `want` are nowhere in `have` — matched against the
 * text with its spaces removed rather than token against token.
 *
 * **The token boundary was the first version's bug, and it was a loud one.** It
 * reported `https://doi.org/10.5194/hgss-12-43-2021` as invented on a page that
 * prints exactly that DOI, because the PDF's text layer breaks it across a line
 * and the model — correctly, as instructed — joined it back up. Same for `0.83°`
 * against a layer that separates the degree sign, and `Keul1,☆` against a
 * byline whose footnote dagger is its own run. Three false alarms on the first
 * real page it was pointed at, all of them the model doing the right thing.
 *
 * A check that cries wolf on correct output is worse than no check: it gets
 * relaxed, and it gets relaxed by whoever is annoyed by it rather than by
 * whoever understands it. So the comparison ignores where the whitespace fell,
 * which is the one thing the transcription is explicitly allowed to change.
 */
function protectedFaults(want: string[], have: string): string[] {
  const packed = flatten(have);
  /* Two haystacks, because a PDF breaks a long word — a URL, most often —
     across a line with a hyphen, and the model is told to join it back up. So
     the page holds `…/27/rock-` and `waga.html` on separate lines and a correct
     transcription holds `…/27/rockwaga.html`, with the hyphen gone. Comparing
     against only the hyphenated form calls that invention; comparing against
     only the stripped form would let a genuinely hyphenated range through
     unnoticed. Both, and a token has to fail against both to count. */
  const haystacks = [packed, packed.replace(/-/gu, "")];
  return want.filter((token) => {
    const needle = flatten(token);
    return !haystacks.some((h) => h.includes(needle) || h.includes(needle.replace(/-/gu, "")));
  });
}

/**
 * A string reduced to what a comparison of *values* should care about:
 * whitespace gone, dash style normalised, case folded, and every character that
 * carries no information at all removed.
 *
 * That last set is not hypothetical. Reading the `easy` fixture, the model
 * joined a hyphenated URL back together and put U+FFFE — a permanent
 * noncharacter — where the hyphen had been. Invisible, worthless, and enough to
 * make `http://jacketmagazine.com/27/rockwaga.html` look like a URL that is not
 * on the page. Emitting it is still a fault; it is just a different one, and
 * `GARBAGE` below is the check that names it.
 */
const flatten = (s: string) =>
  dashes(s)
    .replace(IGNORABLE, "")
    .replace(/\s+/gu, "")
    .toLowerCase();

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

/**
 * Markdown, LaTeX and HTML, which rule 7 of the prompt forbids outright.
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
 */
export function scorePage(
  page: number,
  baseline: string[],
  records: PdfRecord[],
  onPage: string = baseline.join("\n"),
): PageScore {
  const base = baseline.flatMap(tokens);
  const text = records.map((r) => r.text).join("\n");
  const got = tokens(text);
  const shared: Omit<PageScore, "recall" | "precision" | "order" | "spans" | "absent" | "invented"> = {
    page,
    base: base.length,
    got: got.length,
    records: records.length,
    uncertain: records.filter((r) => r.uncertain).length,
    markup: [...text.matchAll(MARKUP)].map((m) => m[0]).slice(0, 5),
    garbage: text.match(GARBAGE)?.length ?? 0,
  };
  if (base.length === 0) {
    /* A scanned page. There is nothing to check against, and saying 1.0 here
       would be the worst possible answer — a perfect score for a page nobody
       has checked. Null means "not checked", and the reader is told so. */
    return { ...shared, recall: null, precision: null, order: null, spans: [], absent: [], invented: [] };
  }
  const mask = coveredMask(base, got);
  const matched = mask.filter(Boolean).length;
  const aligned = alignedMask(base, got);
  const baselineText = baseline.join("\n");
  return {
    ...shared,
    recall: round(matched / base.length),
    precision: got.length ? round(hits(got, base) / got.length) : 0,
    order: matched ? round(aligned.filter(Boolean).length / matched) : 0,
    spans: spansOf(base, aligned, mask),
    absent: protectedFaults(protect(baselineText), text),
    invented: protectedFaults(protect(text), onPage),
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
  thresholds: { recall: number; precision: number; order: number } = THRESHOLDS,
): Check {
  const coverage = coverageOf(records, requested, pass);
  const failures: string[] = [];

  for (const page of coverage.missing) failures.push(`No records at all for page ${page}.`);
  for (const page of coverage.blank) failures.push(`Records for page ${page}, but none with any text in them.`);
  for (const page of coverage.impossible) {
    failures.push(`Records claim page ${page}, and the document has ${pass.pages.length} pages.`);
  }
  for (const page of coverage.unrequested) {
    failures.push(`Records claim page ${page}, which this chunk did not ask for.`);
  }

  const pages: PageScore[] = [];
  for (const page of requested) {
    const mine = records.filter((r) => r.page === page);
    const score = scorePage(page, baselineFor(pass, page), mine, pass.pages.find((p) => p.page === page)?.text);
    pages.push(score);
    if (score.recall === null) continue;

    const bad: string[] = [];
    if (score.recall < thresholds.recall) bad.push(`recall ${score.recall}`);
    if (score.precision! < thresholds.precision) bad.push(`precision ${score.precision}`);
    if (score.order! < thresholds.order) bad.push(`order ${score.order}`);
    if (bad.length) {
      failures.push(`Page ${page}: ${bad.join(", ")}.${nearby(records, page, pass)}`);
    }
    if (score.spans.length) {
      const worst = score.spans[0]!;
      failures.push(
        `Page ${page}: ${score.spans.length} run(s) of the page are missing from the transcription, the ` +
          `longest ${worst.words} words — “${worst.text.slice(0, 120)}”.`,
      );
    }
    if (score.markup.length) {
      failures.push(
        `Page ${page}: the output contains markup, which the prompt forbids — ${score.markup.map((m) => `“${m}”`).join(", ")}.`,
      );
    }
    if (score.garbage) {
      failures.push(
        `Page ${page}: ${score.garbage} replacement character(s) (U+FFFD) in the output — ` +
          `something could not be decoded, and the word it stood for is gone.`,
      );
    }
    if (score.invented.length) {
      failures.push(
        `Page ${page}: ${score.invented.length} number(s) or address(es) in the output are not on the page — ${score.invented.slice(0, SPANS_SHOWN).join(", ")}.`,
      );
    }
  }

  return { ok: failures.length === 0, coverage, pages, failures };
}

/**
 * Step 3, and only on a failure: do this page's records read like the page next
 * door?
 *
 * A model that transcribes well and numbers badly is a completely different
 * problem from a model that reads badly, and the two are indistinguishable from
 * a low score alone — that is the circularity in scoring records against the
 * page the records themselves claim. This is the cheap half of content-based
 * alignment: it *diagnoses*, and deliberately does not rescue. Full alignment is
 * only worth its cost if you intend to keep mislabelled output, and this design
 * fails loudly instead.
 */
function nearby(records: PdfRecord[], page: number, pass: Pass0): string {
  const mine = records.filter((r) => r.page === page);
  if (!mine.length) return "";
  let best: { page: number; recall: number } | null = null;
  for (const other of [page - 1, page + 1]) {
    const baseline = baselineFor(pass, other);
    if (!baseline.length) continue;
    const score = scorePage(other, baseline, mine);
    if (score.recall !== null && (!best || score.recall > best.recall)) best = { page: other, recall: score.recall };
  }
  return best && best.recall >= 0.8
    ? ` The records claiming page ${page} match page ${best.page}'s text at ${best.recall} — this looks like a numbering fault, not a reading one.`
    : "";
}

/** The check as lines a person reads: the table first, then the sentences. */
export function report(result: Check): string {
  const lines = ["page  base   got  recall   prec  order  recs  unc  missing runs"];
  for (const p of result.pages) {
    const n = (v: number | null) => (v === null ? "    —" : String(v).padStart(5));
    const runs = p.spans.length ? p.spans.slice(0, 3).map((s) => s.words).join(",") : "";
    lines.push(
      `${String(p.page).padStart(4)}  ${String(p.base).padStart(4)}  ${String(p.got).padStart(4)}  ` +
        `${n(p.recall)}  ${n(p.precision)}  ${n(p.order)}  ${String(p.records).padStart(4)}  ${String(p.uncertain).padStart(3)}  ${runs}`,
    );
  }
  if (result.failures.length) lines.push("", ...result.failures.map((f) => `FAIL  ${f}`));
  else lines.push("", "No catastrophe detected. That is not the same as correct — see THRESHOLDS.");
  return lines.join("\n");
}
