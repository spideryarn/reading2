/**
 * **The scorecard** — a card, not a scalar, and every number on it has been
 * watched going the wrong way before it was allowed to mean anything.
 *
 * ## The one failure this file is built against
 *
 * Three separate times, across two plans, the same mistake:
 * **a number that rewards recovery, read as a number that rewards quality.**
 *
 * 1. `droppedChars` fell when un-hiding recovered 95 characters of *"View a PDF
 *    of the paper titled …"*. Recovery went up; nothing fired.
 * 2. The warning that replaced it was printed only when the row was not already
 *    "helping" — and "helping" was recovered characters, and furniture is
 *    characters. A nav drawer inside the article container swallowed its own
 *    warning.
 * 3. A hidden *duplicate* paragraph added 1,700 characters that a substring test
 *    found already present. Zero gains reported, silence.
 *
 * All three are in `corpus.mts` § `gainedText`. The lesson is not "be careful";
 * it is that **a one-sided measure cannot be made two-sided by reading it
 * harder**. So this file ships a *pair* of primary numbers reported separately
 * and never combined — `requiredRecall` and `exclusionPrecision` — plus a
 * dilution measure, `bodyPurity`, that exists only where a gold does, and a
 * `polarityPair` harness that refuses the whole card unless it moves both ways.
 *
 * **No F1.** A single harmonic mean hides which half moved, and which half moved
 * is the entire question.
 *
 * ## What this can and cannot see, per fixture
 *
 * | tier | what supplies the truth | what it can score |
 * |---|---|---|
 * | **gold** | a `Gold` — body and chrome passages known *by construction* (a synthetic corruption, the negative-control page, a WCXB record) | recall, exclusion, and `bodyPurity`, which is genuinely two-sided |
 * | **manifest** | a hand-written [manifest](manifest.mts) naming specific strings | recall and exclusion **for the strings it names, and nothing else** |
 * | **region** | a manifest's `articleRegion` plus an output that carries stamps | `articleRecall` and `minArticleChars`, which count the **article** rather than the output |
 *
 * On the manifest tier there is no denominator for "what fraction of this output
 * is article", because nobody has written down what the article is. That is not
 * a gap to paper over — it is the actual epistemic position, and it is why
 * `exposure` is a field on every metric rather than a convention. A metric with
 * `exercised: 0` reports **`not exercised`**, never a passing score.
 *
 * The third tier is the 2026-09-05 repair of exactly that gap, and it exists
 * because leaving it open cost the corpus its headline claim twice in a day. It
 * asks a **narrower** question than a gold does — not "what fraction of this
 * output is the article" but "what fraction of the article came back" — and it
 * abstains, `—`, wherever the region or the provenance is missing. See
 * `articleReturned`.
 *
 * ## Gates, not metrics
 *
 * Attribution and source order are pass/fail. An arm that invents text, or
 * returns the article's sections in the wrong order, or says a paragraph twice,
 * has not scored badly — it has produced something that is not the article, and
 * no amount of recall redeems it. Folding either into a number would let a good
 * recall buy one.
 *
 * **They are scored by source-element identity, not by matching text**, wherever
 * the arm can supply it: every arm here is a DOM transform of one stamped source
 * document, so each output node can be asked which element it came from and
 * whether it still says what that element said. The text form is the fallback,
 * and it is weaker in a way the collage arm walked straight through. See
 * `gatesFor`.
 *
 * @see [manifest.mts](manifest.mts) — the assertions, and the binary per-fixture verdict
 * @see [corruptions.mts](corruptions.mts) — the damage this card has to notice
 * @see [../../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md](../../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md) § B
 */
import { JSDOM, VirtualConsole } from "jsdom";

import { splitIntoBlocks } from "../../src/blocks.js";
import { sourceRefOf } from "../../src/extract.js";
import { RESERVED_ATTRS } from "../../src/reserved.js";
import type { ArmFinding, ArticleRegion, AssertionManifest, ManifestTag } from "./manifest.mjs";

/* ------------------------------------------------------------------ text ---- */

/** One normalisation, used on every side. See `inventory.mts` for the reasoning. */
export const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * **Whitespace taken out of both sides.** See `gatesFor` note 2: the difference
 * between a block's text and the source's is our own spacing at element
 * boundaries, and failing a gate on it hid eight real extractions behind a
 * false red.
 */
const squeeze = (s: string): string => s.replace(/\s+/gu, "");

/**
 * **What this element itself says** — the text of its direct child text nodes,
 * and nothing its child elements say.
 *
 * This is the unit both hard gates judge, and arriving at it took two wrong
 * answers. Judging *every* element failed four correct extractions, because a
 * container's `textContent` is the union of its children's and Readability moves
 * children between containers: a stamped `<div>` legitimately ends up saying more
 * than the source element of that name said, and legitimately ends up before a
 * container it followed. Judging **leaves** — elements with no element children —
 * fixed that and opened a hole the other way: on `shakespeare-hamlet` **not one
 * leaf holds more than forty characters**, because every speech is an `<li>`
 * carrying its prose beside a `<strong>` speaker and a `<span>` line number. The
 * play's words belonged to no leaf and were judged by nothing.
 *
 * Own text has neither problem. Moving a child element in does not change it;
 * the `<li>`'s speech is its own.
 */
function ownTextOf(el: Element): string {
  let out = "";
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) out += n.textContent ?? "";
  return norm(out);
}


const domCache = new Map<string, Document>();
function docOf(html: string): Document {
  const hit = domCache.get(html);
  if (hit) return hit;
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`, {
    virtualConsole: new VirtualConsole(),
  }).window.document;
  /* Bounded, because a corpus run holds thirty-five pages of HTML and several
     arms apiece. Oldest out; correctness does not depend on a hit. */
  if (domCache.size > 24) domCache.delete(domCache.keys().next().value as string);
  domCache.set(html, doc);
  return doc;
}

export function textOf(html: string): string {
  return norm(docOf(html).body?.textContent ?? "");
}

/**
 * **The element whose children are the article's own pieces.**
 *
 * `article.content` is not a flat list of paragraphs: Readability wraps its
 * output in `<div id="readability-page-1"><div>…</div></div>`, so `body.children`
 * is one element on every real extraction and zero on none. An arm that
 * truncates "the first fifth of the top-level children" therefore truncates a
 * list of length one and produces either the whole article or nothing — which is
 * how `first-20-percent`, the arm whose entire purpose is to be caught, came
 * back **not exercised on any fixture**. Caught by the exposure count, which is
 * what it is for.
 *
 * So: descend through wrappers that have exactly one element child and no text
 * of their own, and stop at the first element that really does hold the pieces.
 */
export function contentRoot(doc: Document): Element {
  let el: Element = doc.body;
  for (let i = 0; i < 8; i++) {
    const kids = Array.from(el.children);
    if (kids.length !== 1) break;
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
    if (own.length) break;
    el = kids[0]!;
  }
  return el;
}

/**
 * **The haystack a `mustContain` needle is looked for in, and it is not just
 * `textOf`.**
 *
 * A normalised text match cannot see the bug stage A fixed. `extractText` used
 * to end `.replace(/\s+/g, " ")` with no `<pre>` branch, so every code block on
 * every article arrived as one unbroken line — and a needle matched against
 * whitespace-collapsed text is collapsed on *both* sides, so it matches
 * perfectly against the damage. The instrument would have reported the corpus
 * clean while every ABNF grammar and every Python recipe in it was mangled.
 * `docs/reusable/silent-success.md`: the natural check shares an assumption with
 * the bug, which is why it agrees with it.
 *
 * So a needle that carries **significant whitespace of its own** — a newline, or
 * a run of two or more spaces — is matched literally against the code blocks'
 * text exactly as stage 3 produced it, while every other needle is matched
 * normalised against the prose, as before. Which rule a needle gets is decided
 * by the needle itself, so a manifest author writes the indentation they mean
 * and gets it checked.
 *
 * The code blocks are joined on a NUL, which no manifest can contain, so a
 * needle cannot accidentally straddle two of them.
 */
export interface Haystack {
  /** Whitespace-collapsed text of the whole output. */
  prose: string;
  /** Every code block's text, verbatim, NUL-separated. */
  code: string;
}

/** A needle carrying whitespace of its own is a needle about code. */
const SIGNIFICANT_WS = /\n| {2}/;

export function haystackOf(
  html: string,
  blocks: ReturnType<typeof splitIntoBlocks>["blocks"],
): Haystack {
  return {
    prose: textOf(html),
    code: blocks
      .filter((b) => b.kind === "code")
      .map((b) => b.text)
      .join("\u0000"),
  };
}

/** Is this needle in that output? See `haystackOf` for why there are two rules. */
export function contains(hay: Haystack, needle: string): boolean {
  return SIGNIFICANT_WS.test(needle)
    ? hay.code.includes(needle)
    : hay.prose.includes(norm(needle));
}

const blockCache = new Map<string, ReturnType<typeof splitIntoBlocks>["blocks"]>();
function blocksOf(html: string): ReturnType<typeof splitIntoBlocks>["blocks"] {
  const hit = blockCache.get(html);
  if (hit) return hit;
  const blocks = html.trim() ? splitIntoBlocks(html).blocks : [];
  if (blockCache.size > 24) blockCache.delete(blockCache.keys().next().value as string);
  blockCache.set(html, blocks);
  return blocks;
}

/** How many times `needle` occurs in `hay`. Non-overlapping; prose does not need more. */
function occurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/* ------------------------------------------------------------------ gold ---- */

/**
 * **Truth by construction.** Only a synthetic corruption, a hand-built control
 * page, or a dataset that ships its own gold can supply one; a page off the web
 * cannot, and pretending otherwise is what this plan exists to stop.
 */
export interface Gold {
  /** Passages that ARE the article. Whole, as the reader would read them. */
  body: string[];
  /** Passages that are NOT — chrome, nav, boilerplate, a duplicated twin. */
  chrome: string[];
  /**
   * **Whether this gold covers the whole document.** WCXB's gold is plain text
   * with no structure, so `bodyPurity` over it means "text selection" and
   * nothing about tables, headings or code. Wherever a number from a partial
   * gold is quoted, this is the sentence that has to be quoted with it.
   */
  covers: "whole-document" | "text-selection-only";
}

/* --------------------------------------------------------------- metrics ---- */

export const METRICS = [
  "requiredRecall",
  "exclusionPrecision",
  "bodyPurity",
  /**
   * **What fraction of the declared article region came back**, by stamp. The
   * one number that moves on deletion and on truncation at once, and the reason
   * the corpus can now see an arm that deletes an article and refills the space
   * with the comment thread underneath it. See `articleReturned`.
   */
  "articleRecall",
  /**
   * **What fraction of the output is the declared article region.** The other
   * direction of the same question, and the one that catches an arm which
   * deletes nothing and merely adds — see `ArticleMeasure.precision`.
   */
  "regionPrecision",
  "structureFidelity",
  "metadataExactness",
  "blockCleanliness",
] as const;
export type MetricName = (typeof METRICS)[number];

export interface Metric {
  name: MetricName;
  /**
   * 0–1, **higher is better, always**. A metric that would naturally be a count
   * of bad things is inverted here rather than being given a direction flag, so
   * `polarityPair` has one rule instead of two.
   */
  value: number | null;
  /**
   * **The exposure count**, and it is a field rather than a convention because
   * 260827ab's "zero regressions across fourteen pages" was a safety claim about
   * an arm the corpus could not exercise. How many declared things this metric
   * actually looked at on this fixture. `0` means `not exercised` — never a pass.
   */
  exercised: number;
  /** What the exposure is made of, for a human reading the run. */
  basis: string;
}

export const GATES = ["attribution", "sourceOrder"] as const;
export type GateName = (typeof GATES)[number];

export interface GateResult {
  name: GateName;
  /** `null` when nothing was available to check it against. */
  passed: boolean | null;
  exercised: number;
  detail: string;
}

export interface Scorecard {
  fixture: string;
  arm: string;
  tier: "gold" | "manifest" | "none";
  metrics: Record<MetricName, Metric>;
  gates: Record<GateName, GateResult>;
  /**
   * **Binary, per fixture, never averaged.** Every declared assertion held.
   * `null` when there was no manifest to hold.
   */
  assertionsPassed: boolean | null;
  /**
   * **How much of the declared article region came back.** On the card rather
   * than only inside a metric, because `minArticleChars` is a floor on it and a
   * reader of the run needs the absolute number beside the fraction.
   */
  article: ArticleMeasure;
  /** Every assertion that failed, in words, for the runner to print. */
  failures: string[];
  /**
   * For the `--record` path: what the run found, which is **not** a verdict on
   * the article. Filled in by the runner, which is the only place that has the
   * shipped card to compare against. See `manifest.mts` § `ArmFinding`.
   */
  finding: ArmFinding | null;
}

/**
 * **How much came back**, in characters of gistable block text. The size of the
 * thing the arm returned, and **not** a claim that any of it is the article —
 * that question is `articleReturned`, and the difference is finding 1 of GPT
 * Sol's second review.
 *
 * It is on the runner's table because a card of 1.00s says nothing about size,
 * and 182 characters of `aaronson` scored 1.00 on everything it exercised.
 */
export function gistableChars(html: string): number {
  return blocksOf(html)
    .filter((b) => b.gistable)
    .reduce((n, b) => n + b.text.length, 0);
}

/* --------------------------------------------------------- article region ---- */

/** Elements whose text is not the page's. Kept in step with `arms.mts` § INVISIBLE. */
const INVISIBLE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD", "TITLE"]);

/**
 * **What the arm gave back of the article itself**, rather than of the page.
 *
 * ## The arm this exists to fail
 *
 * GPT Sol built one on `aaronson` from **genuine stamped source elements**: the
 * three required passages trimmed to their exact source text, five real figures,
 * two real blockquotes for the structural floor, and then padding made of the
 * page's own comment paragraphs until it cleared `minArticleChars: 30000`. It
 * kept **178 characters of the post — 0.542%** — scored 1.00 on every exercised
 * metric, passed both gates, satisfied every assertion and registered no
 * regression against the shipped arm.
 *
 * Nothing was wrong with the gates. **Provenance proves that text came from
 * somewhere on the page, and `aaronson` is 5,560 words of post under 52,776
 * words of comment thread.** Every length measure counted gistable characters of
 * *output*, so the thread could fill a floor written for the post.
 *
 * So the manifest declares the region — `manifest.mts` § `ArticleRegion` — and
 * this counts only output whose stamp lands inside it.
 *
 * ## Three ways to answer, and one of them is `—`
 *
 * - **no region declared** → `null`. Not zero, not the old measure: nobody has
 *   written down what the article is on this page, which is the same honest
 *   position `bodyPurity` takes on the manifest tier.
 * - **a region, and output carrying stamps** → the characters, and the fraction.
 * - **a region, and output with no stamps at all** → still `null`, and the
 *   reason travels in `basis`. A candidate that cannot say where its text came
 *   from cannot be credited with the article, and it cannot be convicted of
 *   losing it either. `score` records the un-checkable floor as a *failure*
 *   rather than letting it pass in silence.
 *
 * ## What it counts
 *
 * Each source element inside the region contributes its **own text** — the same
 * unit both gates judge, for the same reason (see `ownTextOf`): a container's
 * `textContent` is the union of its children's, and Readability moves children
 * between containers. An output node with a **direct** stamp inside the region
 * is credited up to what that source element actually said, so an arm cannot
 * inflate the number by repeating one paragraph.
 *
 * A node Readability **generated** is credited against its nearest stamped
 * ancestor's own text, and only for the source intervals it actually covers —
 * see the two paragraphs on `how === "ancestor"` and on the interval union in
 * the body below. It used to be credited nothing, and that sentence stood here
 * for a day after it stopped being true.
 */
export interface ArticleMeasure {
  /**
   * **The unit, said once so nothing downstream has to guess.** Every number
   * here is characters of **own text with whitespace removed** — the same unit
   * both gates compare, and *not* the `gistableChars` unit, which counts block
   * text with its spaces. The two differ by roughly the word count of the page,
   * so they must never be compared: `aaronson`'s region is 26,648 of these
   * against 32,820 gistable characters of shipped output. `minArticleChars` is a
   * floor on **this** one, and every floor was re-derived when the unit changed.
   */
  /** Characters of the region the output gave back, by stamp. `null` = abstained. */
  chars: number | null;
  /** `chars` over the region's own text. `null` for the same reasons. */
  recall: number | null;
  /**
   * **`chars` over everything the output said** — the other direction, and the
   * one that was a printed column rather than a number anything read.
   *
   * GPT Sol's third review: the complete `aaronson` post plus **595 genuine,
   * ordered, stamped comment paragraphs** — 231,371 characters against a correct
   * 32,820 — every assertion holding, both gates passing, `articleRecall`
   * unchanged at 0.9998, and `detects` finding **nothing**. § B said the
   * article/output pair covered it; that pair was printed and never read, and
   * printing a number beside another number is not a check.
   *
   * `articleRecall` cannot see padding by construction: it is a recall measure,
   * and an arm that returns the whole page scores 1.00 on it. This is the
   * denominator that moves.
   */
  precision: number | null;
  /** Own-text characters the output carried in total. `0` when abstaining. */
  outputChars: number;
  /** The region's own text, in characters. `0` when there is no region. */
  regionChars: number;
  /** Region source elements carrying text — the exposure count for the metric. */
  exercised: number;
  /** What the answer is made of, or why there is not one. */
  basis: string;
}

/**
 * **How much of an output has to be the article, for every fixture, one number.**
 *
 * `regionPrecision` was a metric and nothing else — read by `detects`, so every
 * arm lost on it, but with no floor under `assertionsPassed`. A ten-times-padded
 * output therefore still satisfied every declared assertion, and anybody quoting
 * `assertionsPassed` on its own was quoting a number that had not been asked the
 * question. Greg, 2026-09-05, and he is right that the option I rejected was the
 * wrong one: **fifteen per-manifest floors would be fifteen chances to flatter
 * the pipeline; one corpus-wide constant cannot be tuned per page to make a page
 * pass**, which is the whole failure mode.
 *
 * ## Where 0.50 comes from
 *
 * Measured 2026-09-05 on the shipped extraction of all thirteen fixtures that
 * declare a region (the *baseline*, which on four of them is not a passing card):
 *
 * | | regionPrecision |
 * |---|---|
 * | `mdn-cache-control`, `gutenberg-pride`, `constitution`, `shakespeare-hamlet`, `python-docs-itertools`, `negative-controls` | 1.0000 |
 * | `ar5iv-attention` | 0.9956 |
 * | `wiki-gdp-table` | 0.9794 |
 * | `aaronson` | 0.9675 |
 * | `quanta-year-physics` | 0.9534 |
 * | `plos-biology` | 0.9449 |
 * | `pg-greatwork` | 0.9237 |
 * | **`arxiv-abs`** | **0.6401** |
 *
 * and on every padding arm the corpus can exercise:
 *
 * | | regionPrecision |
 * |---|---|
 * | `region-padding-only` on `aaronson` | **0.0927** |
 * | `raw-body` on `aaronson` | **0.0925** |
 * | `region-padded-collage` on `aaronson` | **0.0974** |
 * | `raw-body` on `arxiv-abs` | **0.2464** |
 * | `raw-body` on `mdn-cache-control` | 0.6456 |
 * | `raw-body` on `quanta-year-physics` | 0.6880 |
 * | `region-padding-only` on `mdn-cache-control` | 0.7153 |
 * | `raw-body` on `wiki-gdp-table` | 0.7309 |
 * | `raw-body` on `plos-biology` | 0.8409 |
 * | `region-padding-only` on `plos-biology` | 0.8917 |
 * | `region-padding-only` on `constitution` | 0.9662 |
 * | `region-padding-only` on `gutenberg-pride` | 0.9971 |
 *
 * `arxiv-abs` is the bottom of the honest range, and **it is the worst shipped
 * baseline rather than the worst correct extraction** — a distinction GPT Sol's
 * fourth review insisted on and he is right: that page already **fails** its
 * manifest, for the *"View PDF | HTML (experimental)"* furniture it retains,
 * which sits outside the declared region and which the manifest names in
 * `mustNotContain`. Every other shipped card is 0.92 or better. So the empty
 * band runs from **0.6401 down to 0.2464**, and 0.50 sits in the middle of it:
 * **0.1401 of margin** under the lowest shipped baseline and **0.2536** above
 * the worst arm underneath. Both ends were watched: at 0 the padded card passes
 * everything again, and at 0.7 `arxiv-abs` fails.
 *
 * ## What it does not do, said plainly
 *
 * It is a semantic **"most of this output is the article" backstop, and
 * explicitly not a separator between good and padded output** — Sol's wording,
 * accepted. Across the padding-shaped arms there are **21 exercised
 * region-precision rows, 17 clearing this floor and 4 failing it**; some clear it
 * by a lot (`region-padding-only` on `gutenberg-pride` at 0.9971), because those
 * pages do not have enough material off the article to bury it in —
 * `python-docs-itertools` has 1,295 characters outside its region against 29,949
 * inside, and `pg-greatwork` has none at all. Those are caught by `detects`
 * comparing the arm against the shipped card, which is the *relative* question
 * and the sharper of the two. This one answers the question a reader of a single
 * card asks.
 *
 * Raising it to catch `mdn`'s 0.7153 would put it above `arxiv-abs`'s 0.6401 and
 * fail a card the corpus expects to see, so 0.50 is not a compromise — it is the
 * widest part of the only gap there is. **No fixture needs an exception**, which
 * is the property a per-manifest floor could not have offered: a single number
 * cannot be tuned per page to make a page pass.
 */
export const MIN_REGION_PRECISION = 0.5;

/** Every stamped source element inside the region, and what it said. Cached per page. */
const regionCache = new Map<string, Map<string, string>>();

export function regionTextById(
  sourceHtml: string,
  region: ArticleRegion,
): Map<string, string> {
  /* **The whole document in the key, not a length and a prefix.** Every other
     cache in this file keys on the full string, and a fingerprint that can
     collide is a silently wrong answer, which is the one thing this file is
     about. Bounded to eight entries below. */
  const key = `${region.within.join(",")} ${(region.except ?? []).join(",")} ${sourceHtml}`;
  const hit = regionCache.get(key);
  if (hit) return hit;
  const doc = docOf(sourceHtml);
  const roots = region.within.flatMap((sel) => Array.from(doc.querySelectorAll(sel)));
  const excluded = (region.except ?? []).flatMap((sel) => Array.from(doc.querySelectorAll(sel)));
  const out = new Map<string, string>();
  const walk = (el: Element): void => {
    if (INVISIBLE_TAGS.has(el.tagName)) return;
    if (excluded.some((x) => x === el || x.contains(el))) return;
    const id = el.getAttribute(SOURCE_REF);
    const own = squeeze(ownTextOf(el));
    /* Last one wins is wrong and first one wins is wrong; ids are unique in a
       stamped source, so a repeat would be an instrument bug. Keep the longer,
       and the manifest test would catch a document where that mattered. */
    if (id && own && (out.get(id)?.length ?? 0) < own.length) out.set(id, own);
    for (const kid of Array.from(el.children)) walk(kid);
  };
  for (const root of roots) walk(root);
  if (regionCache.size > 8) regionCache.delete(regionCache.keys().next().value as string);
  regionCache.set(key, out);
  return out;
}

/**
 * **Every `mustNotContain` string the declared region credits as article.**
 *
 * The general form of GPT Sol's fourth finding, and it caught all three of the
 * cases he named by hand: `ar5iv-attention`'s region held Google's reproduction
 * licence, `aaronson`'s held WordPress's trackback line, `plos-biology`'s held
 * 26 repeats of *"View Article | PubMed/NCBI"*. A region that credits what the
 * manifest forbids makes the two numbers disagree about what the article is —
 * removing known junk **lowers** `articleRecall` while **raising**
 * `exclusionPrecision`, so an arm can be rewarded for either answer.
 *
 * Checked over the whole corpus by [score.mts](score.mts), which exits non-zero
 * on it. It is a bug in the manifest rather than in the extraction, so it does
 * not go in `failures` where a reader would take it for damage.
 */
export function forbiddenInsideRegion(
  sourceHtml: string,
  manifest: AssertionManifest,
): string[] {
  if (!manifest.articleRegion) return [];
  /**
   * **The region's text as a reader would read it, not element by element.**
   *
   * The first version joined each element's own text on a NUL, and GPT Sol's
   * fourth review broke it in one line: `<span>Bad</span><span>Stuff</span>`
   * with `mustNotContain: "BadStuff"` came back clean, while
   * `exclusionPrecision` scored 0 on it and `articleRecall` scored 1. The
   * comment saying `articleReturned` could not pay for such text was simply
   * wrong — it credits both halves, one per element. The fifteen-fixture audit
   * was clean; the guarantee it was making was not.
   */
  const region = regionVisibleText(sourceHtml, manifest.articleRegion);
  return manifest.mustNotContain
    .map((n) => n.text)
    .filter((t) => region.includes(squeeze(t)));
}

/**
 * **Everything the declared region says, in document order, as one string** —
 * whitespace removed, invisible subtrees and `except` selectors taken out.
 *
 * The same walk `regionTextById` does, joined rather than kept per element, so a
 * string that straddles two inline elements is still findable. Cached per page,
 * because `score()` asks for it once per arm.
 *
 * **The two readings are not the same by construction, and that is worth
 * checking rather than assuming.** `regionTextById` keeps only elements that
 * carry a stamp, and its total is `articleRecall`'s denominator; this keeps every
 * character in the subtree. An unstamped region element would make the
 * denominator smaller than the region and every recall on the corpus quietly
 * optimistic. Measured 2026-09-05 across all thirteen region-bearing fixtures:
 * **they agree to the character on every one** — `gutenberg-pride` 589,148
 * against 589,148. `tests/extraction-scorer.test.ts` § *"measures the region the
 * same way twice"* is where that stays true.
 */
const regionVisibleCache = new Map<string, string>();
export function regionVisibleText(sourceHtml: string, region: ArticleRegion): string {
  const key = `${region.within.join(",")} ${(region.except ?? []).join(",")} ${sourceHtml}`;
  const hit = regionVisibleCache.get(key);
  if (hit !== undefined) return hit;
  const doc = docOf(sourceHtml);
  const roots = region.within.flatMap((sel) => Array.from(doc.querySelectorAll(sel)));
  const excluded = (region.except ?? []).flatMap((sel) => Array.from(doc.querySelectorAll(sel)));
  let out = "";
  const walk = (el: Element): void => {
    if (INVISIBLE_TAGS.has(el.tagName)) return;
    if (excluded.some((x) => x === el || x.contains(el))) return;
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) out += n.textContent ?? "";
      else if (n.nodeType === 1) walk(n as Element);
    }
  };
  /* A root nested inside another selected root would be walked twice. */
  for (const root of roots) if (!roots.some((r) => r !== root && r.contains(root))) walk(root);
  const text = squeeze(out);
  if (regionVisibleCache.size > 8) {
    regionVisibleCache.delete(regionVisibleCache.keys().next().value as string);
  }
  regionVisibleCache.set(key, text);
  return text;
}

export function articleReturned(input: {
  sourceHtml?: string | undefined;
  stampedHtml?: string | undefined;
  region?: ArticleRegion | undefined;
}): ArticleMeasure {
  const none = (basis: string): ArticleMeasure => ({
    chars: null, recall: null, precision: null, outputChars: 0, regionChars: 0, exercised: 0, basis,
  });
  if (!input.region) {
    return none("no articleRegion declared — nobody has written down what the article is here");
  }
  if (!input.sourceHtml) return none("no source HTML supplied, so the region cannot be resolved");
  const region = regionTextById(input.sourceHtml, input.region);
  const regionChars = [...region.values()].reduce((n, t) => n + t.length, 0);
  if (regionChars === 0) {
    return none(
      `articleRegion ${JSON.stringify(input.region.within.join(", "))} matched no text in the ` +
        "prepared source — the selector is wrong, or the preparation moved what it named",
    );
  }
  if (input.stampedHtml === undefined) {
    return {
      chars: null, recall: null, precision: null, outputChars: 0, regionChars,
      exercised: region.size,
      basis:
        "the output carries no provenance stamps, so none of it can be shown to come from the " +
        "article region — and none of it can be shown not to",
    };
  }
  /** Per source id, every stretch of ITS OWN TEXT some output node gave back. */
  const credited = new Map<string, CoveredRun[]>();
  let outputChars = 0;
  for (const el of Array.from(docOf(input.stampedHtml).querySelectorAll("*"))) {
    if (INVISIBLE_TAGS.has(el.tagName)) continue;
    const own = squeeze(ownTextOf(el));
    if (!own) continue;
    outputChars += own.length;
    const { id, how } = sourceRefOf(el);
    /**
     * **A node Readability generated counts too**, and until 2026-09-05 it did
     * not — which made deleting one free.
     *
     * `how === "direct"` was the whole rule, on the reasoning that a generated
     * node's source element is a guess. On `pg-greatwork` that is 216 nodes
     * carrying **44,408 of the 66,449 characters** the extraction returns, and
     * GPT Sol deleted every one of them: 81% of the output gone, `articleChars`
     * 6,330 and `articleRecall` 0.1153 **unchanged to the digit**, both gates
     * green, nothing detected. § B claimed ignoring them under-counts "in the
     * safe direction because the floors come from a measured run"; that is
     * false and is retracted. A floor cannot catch the deletion of text its
     * numerator never counted.
     *
     * The guess is narrower than it looked. A generated node resolves to its
     * nearest stamped **ancestor**, and what Readability generates is mostly
     * `<p>`s built out of the text nodes that ancestor already held — so the
     * generated node's own text is a slice of the ancestor's own text, which is
     * exactly what the cover below asks. Measured 2026-09-05: **91.4% of
     * `pg-greatwork`'s generated characters and 99.6% of `gutenberg-pride`'s**
     * are covered by their ancestor's own text, and the rest are worth nothing,
     * which is the safe direction and is now a *bounded* under-count rather than
     * an unbounded one.
     *
     * `descendant` is still worth nothing: that is a container Readability built
     * around stamped children, and the descendant's text is not the container's.
     *
     * **What that costs, counted rather than assumed, 2026-09-06.** On
     * `pg-greatwork` it is the whole of the gap between `articleRecall` 0.9237
     * and 1.00: **4,162 characters in 14 descendant nodes**, all of it genuine
     * article text the extraction returned. Every one of the 108 region elements
     * comes back; nothing is lost. This file said for a day that the gap was
     * generated nodes their ancestor could not cover — that was an attribution
     * nobody had checked, and it was wrong. The order gate's alignment can place
     * a descendant run; crediting one is a change to the numerator and to every
     * floor derived from it, and is deliberately not made here.
     */
    if ((how !== "direct" && how !== "ancestor") || !id) continue;
    const was = region.get(id);
    if (was === undefined) continue; /* outside the region, or not the article */
    /**
     * **Credited for what the source element actually said, not for wearing its
     * stamp.** Crediting `min(was.length, own.length)` was the first version and
     * it is an open door: an arm can put a region id on a node full of invented
     * text and be paid for the article it did not return. The attribution gate
     * would catch that separately — but a number that is only true when another
     * number is also true is a number somebody will quote on its own.
     *
     * So the same cover the gate computes decides the credit, and a node whose
     * text its source element does not support is worth nothing. Measured across
     * all twelve article fixtures on 2026-09-05: it changes no figure, because
     * every node of every shipped extraction is covered. It changes what an
     * adversary can do.
     */
    const cover = coverOf(was, own, MIN_RUN_IN_ELEMENT);
    if (cover.uncovered !== null) continue;
    /**
     * **The amount is WHICH PART of the element came back, not how much text
     * arrived claiming to be it.**
     *
     * Two wrong answers, both found by measurement. It was `own.length` first —
     * every character the node carried, including the ones `coverOf` waved
     * through as too short to judge — which paid an arm in full for 24.5% of
     * `negative-controls` displaced. Then it was `cover.covered` summed per id
     * and capped at the element's length, and GPT Sol's fourth review walked
     * through that: **197 copies of one genuine generated paragraph**, all
     * resolving to one stamped ancestor, each contributing its 277 characters to
     * the same total. `articleRecall` **0.9881**, `regionPrecision` **0.9817**,
     * both gates green — on an output holding **410 distinct characters, 0.75%
     * of a 54,900-character article**. The cap stopped the score exceeding 1.00;
     * it did nothing about the same 277 characters being counted 197 times.
     *
     * So the credit is the **union of the source intervals** each cover matched.
     * Saying the same paragraph twice is worth what saying it once is worth,
     * which is what "how much of the article came back" means.
     */
    credited.set(id, [...(credited.get(id) ?? []), ...cover.intervals]);
  }
  let chars = 0;
  /**
   * **What the elements the basis names could possibly be worth**, and it is on
   * the basis line because the two numbers this function prints disagreed by two
   * orders of magnitude and nothing compared them: *"1 of 108 stamped region
   * element(s) came back"* beside `articleRecall` **0.9881**. Greg's point, and
   * it is worth more than the specific fix.
   *
   * **Be precise about what this catches, because it is not that bug.** On
   * `pg-greatwork` one source element really does hold the whole essay — the
   * page is a 1990s table layout with every paragraph directly inside one
   * `<span>` — so "1 of 108, holding 54,900 of 54,900 characters" is not a
   * contradiction at all, and the reader can now see that instead of having to
   * reconcile *1 of 108* with *98.81%* in their head. Printing the second number
   * is what makes the first one readable. **What actually caught the bug is the
   * union above.**
   *
   * What the throw guards is the weaker structural property: credit must never
   * escape the elements it is credited to. That is true by construction while
   * the union and the per-element cap are both there, and it is watched failing
   * by removing them — with the raw per-node sum that preceded this, 197 copies
   * of a 472-character paragraph credit 92,984 characters to one element holding
   * 54,900, and this throws.
   */
  let ceiling = 0;
  for (const [id, spans] of credited) {
    const was = region.get(id)!;
    chars += Math.min(was.length, unionLength(spans.map((v) => [v.from, v.to] as const)));
    ceiling += was.length;
  }
  if (chars > ceiling) {
    throw new Error(
      `articleReturned credited ${chars} characters to ${credited.size} region element(s) whose ` +
        `own text totals ${ceiling} — the metric and its own basis line disagree, which is an ` +
        "instrument bug rather than a bad arm",
    );
  }
  return {
    chars,
    recall: chars / regionChars,
    precision: outputChars === 0 ? null : chars / outputChars,
    outputChars,
    regionChars,
    exercised: region.size,
    basis:
      `${credited.size} of ${region.size} stamped region element(s) came back, ` +
      `holding ${ceiling} of ${regionChars} characters`,
  };
}

export interface ScoreInput {
  fixture: string;
  arm: string;
  /** The arm's extracted article HTML — what stage 3 would be handed. */
  html: string;
  /**
   * The same HTML with `data-spya-src` still on it, when the arm is a DOM
   * transform of a stamped source. Its presence is what turns the two gates from
   * a text match into an identity check. See [arms.mts](arms.mts).
   */
  stampedHtml?: string | undefined;
  /** The extractor declined the page. See `Candidate.refused`. */
  refused?: boolean;
  title?: string | null;
  byline?: string | null;
  /** The page as fetched. Required by the two gates; absent means they abstain. */
  sourceHtml?: string;
  manifest?: AssertionManifest | null;
  gold?: Gold | null;
}

/**
 * **What a structure floor actually counts**, where counting the bare tag would
 * count the wrong thing.
 *
 * `img` is the case that forced this. The trawl's finding was *"zero figures
 * survive anywhere in the blocks"*, and the way an image dies in this pipeline
 * is that its `src` goes — the element is still in the DOM, rendering nothing.
 * A floor of `img: { atLeast: 8 }` counted against the bare tag is satisfied by
 * eight empty frames, so it is counted against `img[src]` instead: a floor about
 * pictures should be about pictures.
 *
 * Everything else counts its own tag. Add to this map only where the tag and the
 * thing the reader gets have come apart, and say which.
 */
const SELECTOR_FOR: Partial<Record<ManifestTag, string>> = { img: "img[src]" };

/**
 * How many offending blocks it takes to zero `blockCleanliness`.
 *
 * **A budget, not a denominator, and the difference is the whole point.** The
 * first draft of this metric was `1 - offending / totalBlocks`, which *rises*
 * when you glue thirty clean navigation items into the article — the denominator
 * grows and the numerator does not. `polarityPair` caught it on the `add nav`
 * half; see the note in the header about reading a recovery number as a quality
 * number, which is the same mistake wearing a ratio.
 */
const CLEAN_BUDGET = 40;

const PUNCT_ONLY = (t: string): boolean => t.length > 0 && !/[\p{L}\p{N}]/u.test(t);

function metric(name: MetricName, value: number | null, exercised: number, basis: string): Metric {
  return { name, value: exercised > 0 ? value : null, exercised, basis };
}

/**
 * Score one arm's output on one fixture.
 *
 * Nothing here throws on a missing input: a fixture with no manifest and no gold
 * gets a card of `not exercised`, which is the honest answer and is what the
 * runner prints. Silence would not be.
 */
export function score(input: ScoreInput): Scorecard {
  const { manifest, gold } = input;
  const blocks = blocksOf(input.html);
  const text = textOf(input.html);
  const hay = haystackOf(input.html, blocks);
  const gistable = blocks.filter((b) => b.gistable);
  const failures: string[] = [];

  /* -- requiredRecall: what had to be here, and is ------------------------- */
  /**
   * **Distinct passages, because the two lists overlap.** On the gold+manifest
   * conformance card this concatenation reported **19 required exposures for 17
   * distinct passages** — two `mustContain` needles are also gold body passages —
   * and the same again for exclusions, 32 for 30. GPT Sol, 2026-09-06, after I
   * had swept the exposure fields and said they were all counted once. They were
   * not, and the sweep missed the only tier where both sources are present at
   * once. An exposure count that counts a passage twice claims more coverage than
   * it has, which is the thing this field exists to refuse.
   */
  const required = [
    ...new Set([...(manifest?.mustContain ?? []).map((n) => n.text), ...(gold?.body ?? [])]),
  ];
  let present = 0;
  for (const need of required) {
    if (contains(hay, need)) present += 1;
    else failures.push(`missing required text: ${JSON.stringify(need.slice(0, 80))}`);
  }
  const requiredRecall = metric(
    "requiredRecall",
    required.length ? present / required.length : null,
    required.length,
    manifest && gold ? "mustContain + gold body" : gold ? "gold body passages" : "mustContain needles",
  );

  /* -- exclusionPrecision: what had to be gone, and is --------------------- */
  /* Distinct, for the reason above: two exclusions duplicated gold chrome. */
  const excluded = [
    ...new Set([...(manifest?.mustNotContain ?? []).map((n) => n.text), ...(gold?.chrome ?? [])]),
  ];
  let absent = 0;
  for (const bad of excluded) {
    if (!contains(hay, bad)) absent += 1;
    else failures.push(`kept excluded text: ${JSON.stringify(bad.slice(0, 80))}`);
  }
  const exclusionPrecision = metric(
    "exclusionPrecision",
    excluded.length ? absent / excluded.length : null,
    excluded.length,
    "named needles only — says nothing about junk nobody named",
  );

  /* -- bodyPurity: how much of the output is the article ------------------- *
     Only where a gold exists. This is the metric that falls when navigation is
     added, and without it the card is recovery-only — which is the failure this
     whole file is named after. Each distinct gold passage counts once, so a
     duplicated paragraph inflates the denominator and lowers purity: duplication
     is damage, and a membership test cannot see it (bug 3 in the header). */
  let bodyPurity: Metric;
  if (gold && text.length) {
    /* **Whitespace out of both sides**, for the same reason the gates squeeze it:
       `textContent` puts nothing between `<td>Hour</td><td>Speed</td>` while a
       person writing a gold passage writes "Hour Speed". Comparing the two as
       written made the whole-document gold impossible to state, and a gold that
       omits legitimate material makes deleting it look like an improvement —
       which is what GPT Sol found: the clean conformance page scored 0.931. */
    const flat = squeeze(text);
    let attributed = 0;
    for (const passage of new Set(gold.body.map((p) => squeeze(p)))) {
      if (occurrences(flat, passage) > 0) attributed += passage.length;
    }
    bodyPurity = metric("bodyPurity", Math.min(1, attributed / flat.length), gold.body.length,
      `gold body chars over output chars (${gold.covers})`);
  } else {
    bodyPurity = metric("bodyPurity", null, 0,
      "no gold — a page off the web cannot say what fraction of an output is the article");
  }

  /* -- structureFidelity: the floors, and the ceilings ---------------------- */
  const floors = Object.entries(manifest?.structure ?? {}) as [ManifestTag, { atLeast?: number; exactly?: number }][];
  let met = 0;
  const doc = docOf(input.html);
  for (const [tag, floor] of floors) {
    const n = doc.querySelectorAll(SELECTOR_FOR[tag] ?? tag).length;
    const ok =
      (floor.exactly === undefined || n === floor.exactly) &&
      (floor.atLeast === undefined || n >= floor.atLeast);
    if (ok) met += 1;
    else {
      failures.push(
        `structure ${tag}: ${n} against ` +
        [floor.exactly !== undefined ? `exactly ${floor.exactly}` : "",
         floor.atLeast !== undefined ? `at least ${floor.atLeast}` : ""].filter(Boolean).join(" and "),
      );
    }
  }
  const structureFidelity = metric(
    "structureFidelity", floors.length ? met / floors.length : null, floors.length,
    "declared per-tag floors met",
  );

  /* -- metadataExactness: the byline, exactly ------------------------------ */
  const meta: { field: string; want: string | null; got: string | null }[] = [];
  if (manifest && "byline" in manifest) {
    meta.push({ field: "byline", want: manifest.byline ?? null, got: input.byline ?? null });
  }
  if (manifest?.title !== undefined) {
    meta.push({ field: "title", want: manifest.title, got: input.title ?? null });
  }
  let exact = 0;
  for (const m of meta) {
    const got = m.got === null ? null : norm(m.got);
    if (got === m.want) exact += 1;
    else failures.push(`${m.field}: ${JSON.stringify(got)} — wanted ${JSON.stringify(m.want)}`);
  }
  const metadataExactness = metric(
    "metadataExactness", meta.length ? exact / meta.length : null, meta.length,
    "declared metadata fields matching exactly",
  );

  /* -- blockCleanliness: junk blocks, on a budget --------------------------- *
     Counted against a fixed budget rather than against the block total. See
     CLEAN_BUDGET: a ratio over the total is diluted by adding clean blocks, so
     gluing a nav into the article IMPROVES it — which polarityPair rejects. */
  const maxChars = manifest?.maxBlockChars;
  const wantsNoPunct = manifest?.noPunctuationOnlyBlocks ?? false;
  let offending = 0;
  if (wantsNoPunct) {
    for (const b of gistable) {
      if (PUNCT_ONLY(b.text.trim())) {
        offending += 1;
        if (offending <= 3) failures.push(`punctuation-only block: ${JSON.stringify(b.text.trim())}`);
      }
    }
  }
  if (maxChars !== undefined) {
    for (const b of blocks) {
      if (b.text.length > maxChars) {
        offending += 1;
        failures.push(`block of ${b.text.length} chars exceeds maxBlockChars ${maxChars}`);
      }
    }
  }
  const cleanChecks = (wantsNoPunct ? 1 : 0) + (maxChars !== undefined ? 1 : 0);
  const blockCleanliness = metric(
    "blockCleanliness",
    cleanChecks ? 1 - Math.min(1, offending / CLEAN_BUDGET) : null,
    cleanChecks,
    `offending blocks against a budget of ${CLEAN_BUDGET}`,
  );

  /* -- the article region: how much of the PIECE came back ------------------ *
     Not how much output there is. See `articleReturned`: an arm built out of
     genuine stamped comment-thread paragraphs cleared a 30,000-character floor
     on `aaronson` while returning 178 characters of the post. */
  const article = articleReturned({
    sourceHtml: input.sourceHtml,
    stampedHtml: input.stampedHtml,
    region: manifest?.articleRegion,
  });
  const articleRecall = metric(
    "articleRecall", article.recall, article.recall === null ? 0 : article.exercised,
    article.basis,
  );
  const regionPrecision = metric(
    "regionPrecision", article.precision, article.precision === null ? 0 : article.exercised,
    article.precision === null
      ? article.basis
      : `${article.chars} of ${article.outputChars} own-text characters are the article region`,
  );

  /* -- minArticleChars, which is a floor on THAT ---------------------------- */
  if (manifest?.minArticleChars !== undefined) {
    if (article.chars === null) {
      /* **An assertion that could not be checked is not an assertion that
         held.** Saying nothing here is the shape of every bug in this file's
         header: the check agrees with the code because it shares an assumption
         with it. docs/reusable/silent-success.md. */
      failures.push(
        `minArticleChars ${manifest.minArticleChars} COULD NOT BE CHECKED — ${article.basis}`,
      );
    } else if (article.chars < manifest.minArticleChars) {
      failures.push(
        `${article.chars} characters of the article region came back ` +
          `(${(article.recall! * 100).toFixed(1)}% of ${article.regionChars}), ` +
          `under minArticleChars ${manifest.minArticleChars}`,
      );
    }
  }

  /* -- and a floor on how much of the output is the article ----------------- *
     `articleRecall` is a recall measure and cannot see padding: an arm that
     returns the whole page scores 1.00 on it. This is the other direction, and
     it is an assertion rather than only a metric because `detects` answers the
     *relative* question and `assertionsPassed` answers the single-card one.
     See MIN_REGION_PRECISION for where 0.50 comes from. */
  if (manifest?.articleRegion) {
    if (article.precision === null) {
      failures.push(
        `minRegionPrecision ${MIN_REGION_PRECISION} COULD NOT BE CHECKED — ${article.basis}`,
      );
    } else if (article.precision < MIN_REGION_PRECISION) {
      failures.push(
        `only ${(article.precision * 100).toFixed(1)}% of the output is the declared article ` +
          `region (${article.chars} of ${article.outputChars} own-text characters), under the ` +
          `corpus floor of ${(MIN_REGION_PRECISION * 100).toFixed(0)}% — the rest of it came from ` +
          "somewhere else on the page",
      );
    }
  }

  /* -- refusal, which is a result and not an absence ------------------------ *
     **The worst silent success in the trawl, finally scoreable.** A bot wall or a
     login page comes back from `readArticle` looking like an article, and until
     2026-09-05 there was no way to write that down: `medium-about` and
     `pmc-article` were committed with no manifest at all, because the only
     assertion worth making about them is "refuse this", and the manifest could
     not say it. Deciding what *production* does — reject, retry, warn — is stage
     C's and Greg has not chosen; scoring it is this file's and could not wait.
     GPT Sol's finding 10, and he is right that the two halves are separable. */
  if (manifest?.notAnArticle) {
    if (!input.refused) {
      failures.push(
        "this page is not an article and the extractor did not refuse it — " +
          `it returned ${text.length} characters as though they were one`,
      );
    }
  } else if (input.refused && manifest) {
    /* Said once, plainly, rather than as fifteen missing-needle lines that make
       a refusal look like a bad extraction. */
    failures.push("the extractor REFUSED this page — every assertion below is moot");
  }

  const metrics: Record<MetricName, Metric> = {
    requiredRecall, exclusionPrecision, bodyPurity, articleRecall, regionPrecision,
    structureFidelity, metadataExactness, blockCleanliness,
  };

  return {
    fixture: input.fixture,
    arm: input.arm,
    tier: gold ? "gold" : manifest ? "manifest" : "none",
    metrics,
    gates: gatesFor(input, blocks),
    assertionsPassed: manifest ? failures.length === 0 : null,
    article,
    failures,
    finding: null,
  };
}

/* ----------------------------------------------------------------- gates ---- */

/**
 * **Hard gates, and deliberately not metrics.**
 *
 * `attribution` — nothing in the output may be text this page did not have.
 * `sourceOrder` — the article's pieces have to arrive once each, in the order the
 * document had them. A swapped pair of sections reads as a coherent article and
 * scores perfectly on every text measure ever written here; so does a paragraph
 * said twice.
 *
 * ## Each gate has two forms, and the strong one replaces the weak one
 *
 * | form | what it can see | when it exists |
 * |---|---|---|
 * | **provenance** | which *source element* each output node came from, by identity, and what that element said | the arm is a DOM transform of a stamped source and supplied `stampedHtml` |
 * | **text** | whether the output's text occurs in the source's text, and in what order | always, given `sourceHtml` |
 *
 * The provenance form answers everything the text form answers **and two things
 * it cannot**: a node fabricated out of copied page text (which is exactly
 * `needle-collage`, and every one of whose strings the text form finds), and
 * prose rewritten inside a node that kept its identity (which is what a model
 * repair pass would do). So where it exists it is the gate, and the weak form is
 * for candidates with no stamps — one built by hand in a test, one a corruption
 * was applied to. The `detail` says which form answered, in capitals when it is
 * the weak one.
 *
 * Running both and failing on either was the first design, and it fails correct
 * extractions: the text form asks whether a *block* — several elements' text
 * joined — occurs on the page, and Readability legitimately removes things from
 * inside a block, so on a dense-MathML page the survivors interleave with the
 * source at twenty-character granularity.
 *
 * ## Three things the old version got wrong, all of them silently
 *
 * 1. **It ignored every block under 60 characters**, on the reasoning that a
 *    short text match proves nothing. True — and the consequence was that the
 *    navigation corruption's 393 characters of invented link labels, spread over
 *    30 short blocks, passed attribution untouched. Nothing is ignored for being
 *    short now; the *pass* is weak evidence and the *failure* is not, and it is
 *    failures a gate is for.
 * 2. **It compared whitespace-normalised text**, and `textContent` on a source
 *    document glues `<td>Temperature, °C</td><td>14:00</td>` into
 *    `Temperature, °C14:00` while `splitIntoBlocks` puts a space at every block
 *    boundary. That difference — the pipeline's own spacing, not the page's —
 *    failed attribution on **8 of the 12 shipped extractions**, and a gate that
 *    is already false cannot notice further damage. Every comparison here ignores
 *    whitespace on both sides now. What the code-whitespace bug did to `<pre>`
 *    is caught by the needle rule in `haystackOf`, which is where it belongs.
 * 3. **It took each block's position with its own `source.indexOf`**, so a
 *    paragraph said twice got the same position twice, was non-decreasing, and
 *    passed. Both forms move forward only now, and the strong one adds the rule
 *    that no source element may say the same thing twice.
 *
 * **How many shipped extractions pass both gates is not written down here any
 * more, and that is deliberate.** The number moved three times in two days —
 * fourteen of fifteen with one abstaining, then "all fifteen" (an artefact of a
 * counting rule, retracted), then back, then changed again by the text-run walk
 * — and each time a sentence in this file went stale without anything noticing.
 *
 * So it is **read from the run**: `evals/results/extraction-score.json` carries
 * every shipped card's two gates and their exposure counts, and
 * `tests/extraction-manifests.test.ts` § *"says how many shipped extractions
 * pass each gate"* prints the tally and fails if a gate is neither passed nor
 * honestly abstaining. A claim nobody can quote from memory is a claim that
 * cannot go stale.
 *
 * The distinction worth keeping is the one § B did not make: a gate that is
 * already false on the page you are testing tells you nothing about the arm you
 * are testing, and neither does one that never ran. Both are reported, and they
 * are not the same.
 *
 * ## What these gates still cannot see, said out loud
 *
 * - **Structural relationships.** GPT Sol moved the last cell of one table row
 *   to the start of the next: global leaf order unchanged, every leaf still its
 *   own source element's, row widths `3, 5, 4, 4, 4` instead of the intended
 *   shape, and the datum now belongs to the wrong row. Nothing here sees it, and
 *   nothing here is going to — a ruler made of text and order is the wrong
 *   instrument for a claim about containment. It would want a third gate over
 *   the ancestor path of each stamped node, which is stage C's problem if it is
 *   anyone's.
 * - **Text `prepareDocument` itself invents**, because the gates are scored
 *   against the prepared document. `tests/extract-provenance.test.ts` watches
 *   that half.
 * - **A word swapped inside a node Readability generated**, which resolves only
 *   to an ancestor and is therefore judged against the whole page.
 */
function gatesFor(
  input: ScoreInput,
  blocks: ReturnType<typeof splitIntoBlocks>["blocks"],
): Record<GateName, GateResult> {
  const abstain = (name: GateName, why: string): GateResult => ({
    name, passed: null, exercised: 0, detail: why,
  });
  if (!input.sourceHtml) {
    return {
      attribution: abstain("attribution", "no source HTML supplied"),
      sourceOrder: abstain("sourceOrder", "no source HTML supplied"),
    };
  }
  /**
   * **The strong form replaces the weak one; it is not added to it.**
   *
   * Running both and failing on either was the first design and it fails correct
   * extractions: the whole-page text form asks whether a *block* — several
   * elements' text joined — occurs on the page, and Readability legitimately
   * removes things from inside a block, so on a dense-MathML page the survivors
   * interleave with the source at twenty-character granularity. The provenance
   * form asks the same question of each node against **its own** source element,
   * where there is nothing to interleave with, and it asks two more the text form
   * cannot (fabricated nodes, duplicated ids). It strictly dominates, so where it
   * exists it is the gate; where it does not — a candidate built by hand in a
   * test, a corruption applied to one — the text form is all there is, and the
   * detail says so in capitals.
   */
  const form =
    input.stampedHtml === undefined
      ? { ...textForm(input.sourceHtml, blocks), strong: false }
      : { ...provenanceForm(input.stampedHtml, input.sourceHtml), strong: true };

  return {
    attribution: {
      name: "attribution",
      passed: form.judged ? form.attribution.length === 0 : null,
      exercised: form.judged,
      detail: form.attribution.length
        ? `${form.attribution.length} problem(s): ${form.attribution[0]}`
        : `${form.judged} ${form.strong ? "output node(s) each say what their own source element said" : "block(s) found in the source — the WEAK text form, no stamped output"}`,
    },
    sourceOrder: {
      name: "sourceOrder",
      passed: form.ordered > 1 ? form.order.length === 0 : null,
      exercised: form.ordered,
      detail: form.order.length
        ? `${form.order.length} problem(s): ${form.order[0]}`
        : `${form.ordered} ${form.strong ? "text run(s) placed in source order; no DIRECTLY stamped node said twice" : "block(s) in source order (WEAK text form)"}`,
    },
  };
}

/**
 * **Anything with a character in it is judged**, and it used to be
 * `/[\p{L}\p{N}]/u` — a letter or a digit.
 *
 * The reasoning was that a block with no letter and no digit cannot say where it
 * came from. The consequence was that GPT Sol appended a fabricated
 * `<p>☠☠☠</p>` to the negative-control extraction and **attribution passed** —
 * on the one page in the corpus whose whole purpose is that `❦` is real article
 * content that a character-class rule would throw away. The gate says *nothing
 * in the output may be text this page did not have*, and three skulls are text
 * this page did not have.
 *
 * The worry behind the old rule was a false red: a stamped node whose own text
 * is a stray pilcrow, judged against a whole page that has pilcrows everywhere.
 * That worry is answered by *where* the question is asked — a directly stamped
 * node is judged against **its own source element**, where `❦` either is or is
 * not — so it was measured rather than argued. Across all twelve article
 * fixtures, 2026-09-05, both gates stay green and the number of nodes each one
 * judges goes **up**: `ar5iv-attention` 1,187 → 1,528, `python-docs-itertools`
 * 2,539 → 3,985, `gutenberg-pride` 3,505 → 3,541.
 */
const HAS_CONTENT = /\S/u;

/**
 * **How long a run has to be before it is evidence.** Below this, a match against
 * a whole page proves little — `"Home"` occurs on most of them — so a run this
 * short is only accepted as the *whole* of a short block.
 */
const MIN_RUN = 24;

/**
 * The same question asked of one source element rather than the whole page. The
 * haystack is one node's text, so a coincidental match is far less likely and the
 * run may be much shorter — which it has to be, because a node's text can be an
 * interleaving of its own at twenty-character granularity once Readability has
 * dropped a MathML annotation from inside it.
 */
const MIN_RUN_IN_ELEMENT = 8;

/** Only `src/reserved.ts` may name one of these; this is the read side of that. */
const SOURCE_REF = RESERVED_ATTRS.sourceRef;

/**
 * **Every character of this text has to sit inside a long run the source has.**
 *
 * Not "the whole block occurs in the source", which was the first version and is
 * provably wrong: extraction **removes** things from inside a block, and the
 * remainder is then a subsequence of the page rather than a substring of it.
 * Three real examples, all correct extractions the strict form failed:
 *
 * - `ar5iv-attention` — the source's MathML carries both the rendered `ht` and
 *   the LaTeX annotation `h_{t}`; Readability keeps one. **37 blocks**, on a page
 *   with nothing wrong with it.
 * - `arxiv-abs` — a `Focus to learn more` tooltip sits between two table cells.
 * - `wiki-gdp-table` — an inline `<style>` block's CSS text sits inside the map
 *   legend.
 *
 * A removal costs one join and nothing else, so it leaves every character inside
 * a long run. **Invented text has no long run anywhere in the page**, which is the
 * distinction the gate is actually about, and it is drawn without a tolerance
 * threshold: the cover has to be total.
 *
 * ## The cover has to be a subsequence **in order**, and until 2026-09-05 it did not
 *
 * The first version looked for each run *anywhere* in the source and never moved
 * a source-side cursor, so a total cover said nothing about arrangement. GPT Sol
 * took one directly stamped 459-character paragraph on `negative-controls`,
 * swapped its two halves (231 and 227 characters), and every metric, both gates
 * and every assertion passed: each half was still "in the source", just not in
 * that order. A cover is now built left to right with a cursor that only moves
 * forward, so the output's words have to occur in the source's own order.
 *
 * The removal cases above are untouched by that, because a removal does not
 * reorder anything: `ht−1h_{t-1}` minus its annotation is still left-to-right.
 *
 * **Which of them are actually exercised, measured rather than assumed.** Asked
 * on 2026-09-05 across `ar5iv-attention`, `arxiv-abs`, `wiki-gdp-table` and
 * `gutenberg-pride`: **zero** directly stamped nodes survive only because the
 * cover is a subsequence, and `From: Llion Jones [` is not in the shipped arXiv
 * output at all. The unit is why — the strong form compares an element's *own*
 * text against its own source element's, and a removed inline child's words were
 * never in either. The subsequence property earns its place in the **weak**
 * whole-page form, where a block is several elements' text joined, and in the
 * branch that judges a node Readability generated against the page. The one
 * still live here is `gutenberg-pride`'s split `s145`, and it is green.
 *
 * Returns the first uncovered stretch, or `null` when the text is fully covered;
 * **the block's first covered run**, which is the only honest anchor for the
 * order half (a fixed-length prefix straddles the first removal and is then found
 * nowhere, which read as a reordering on `wiki-gdp-table`'s map legend); and
 * **where in the source the cover begins and ends**, which is what lets two output
 * nodes sharing one source element be put in order — see `provenanceForm`.
 */
interface Cover {
  uncovered: string | null;
  anchor: string;
  /** Source index the cover starts at, or `-1` when nothing matched. */
  from: number;
  /** Source index just past the end of the cover. */
  to: number;
  /**
   * **Characters that sit inside a run the source really has, in the source's
   * own order** — and never the ones `forgiven` waved through.
   *
   * The cover answers a yes/no question for the gate, and the gate has to be
   * lenient about a fragment it cannot see. A *metric* must not be: an arm paid
   * for text the source does not have there is an arm paid for damage. So the
   * two numbers are separate — `uncovered` decides whether this counts at all,
   * and this decides how much. See `articleReturned`, which credits this.
   */
  covered: number;
  /**
   * **Which parts of the source those characters were**, as `[from, to)` pairs
   * in the source's own coordinates, disjoint and increasing (the cursor only
   * moves forward, so one cover cannot overlap itself).
   *
   * `covered` is their total length and is enough for one node. It is *not*
   * enough for a source element several output nodes resolve to, which is GPT
   * Sol's fourth review: 197 copies of one generated paragraph each contributed
   * their 277 characters to the same ancestor's credit, and the sum — capped
   * only at the ancestor's total — read as 98.81% of a 54,900-character article
   * that the arm had returned 410 characters of. Credit is the **union** of
   * these now. See `articleReturned`.
   */
  intervals: CoveredRun[];
  /** Characters waved through by `forgiven`. Bounded by `budget`. */
  forgiven: number;
}

/**
 * **One stretch of source text that an output node gave back**, in the source's
 * own coordinates. `articleReturned` unions these per source element so that
 * saying a paragraph twice is worth what saying it once is worth.
 *
 * ## It carried a third field for a day, and the reasoning is worth keeping
 *
 * `out` — where the matched run started in the *output* text — existed so that a
 * cover computed against an element's whole own text could be **clipped to the
 * individual text node it belonged to**, rather than given whole to whichever
 * node it started in. That mattered because an element's own text can be several
 * runs with children between them: `<p>See note <a>1</a> above.</p>` has "See
 * note" and " above." as two runs of the `<p>`, and the `<p>`'s cover is a
 * single interval spanning both, since its own text is contiguous in the source
 * element even though it is not contiguous in the document. Giving that whole
 * interval to the first run advanced the cursor past the `<a>` before the `<a>`
 * was reached — a two-character error, and **33 false reds on `pg-greatwork`**.
 *
 * The field is gone because the order gate no longer maps element covers onto
 * text nodes at all: it aligns the output's runs against the source directly
 * (`provenanceForm`). The failure it guarded is still a permanent test — the
 * `See note <a>1</a> above.` case, in both directions — because the shape is
 * what breaks an order rule, whichever mechanism is underneath.
 */
export interface CoveredRun {
  from: number;
  to: number;
}

/** Total length of a set of `[from, to)` pairs, counting overlap once. */
export function unionLength(spans: readonly (readonly [number, number])[]): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let [from, to] = sorted[0]!;
  for (const [a, b] of sorted.slice(1)) {
    if (a > to) { total += to - from; from = a; to = b; continue; }
    if (b > to) to = b;
  }
  return total + (to - from);
}

/**
 * **How much a single cover may forgive in total, across every join.**
 *
 * The per-join rule below says a stretch shorter than `minRun` is not evidence
 * either way. It was never given a total, and GPT Sol's third review showed what
 * that composes into: an adversary that emits `n` correct characters and then a
 * short displaced run, over and over, and asks the cover itself which
 * displacements it will forgive. Reproduced 2026-09-05 on `negative-controls` —
 * **24.5% of the attacked text displaced, `articleRecall` 1.00, both gates
 * green, every assertion held, `detects` found nothing**.
 *
 * One join's worth is the budget, because one join is what the rule was written
 * for: an inline child removed from the *start* of a node leaves one fragment
 * too short for the window to find. Measured on 2026-09-05 across all fourteen
 * shipped extractions, the strong per-element form forgives **zero characters
 * over zero joins** — so this bound is not a tolerance the corpus is living
 * inside, it is headroom nothing currently uses. The whole-page fallback is the
 * one place that does use it (`ar5iv-attention`, 222 characters over 17 blocks,
 * worst 37 in one), so that caller passes its own measured budget.
 */
const FORGIVE_BUDGET = (minRun: number): number => minRun - 1;

/**
 * **What the whole-page fallback may forgive**, and it is bigger for a measured
 * reason. A *block* is several elements' text joined, and Readability removes
 * things from inside one: `ar5iv-attention`'s MathML blocks carry both the
 * rendered form and the LaTeX annotation, and one block of 84 characters needs
 * 21 forgiven across several joins. Measured 2026-09-05 over the fourteen
 * shipped extractions: 222 characters forgiven in total, all of them on that one
 * page, worst block 37. Set above the worst, and far below what the composed
 * attack needs.
 */
const WHOLE_PAGE_FORGIVE_BUDGET = 48;

function coverOf(
  source: string,
  t: string,
  minRun: number = MIN_RUN,
  budget: number = FORGIVE_BUDGET(minRun),
): Cover {
  let i = 0;
  let bad = 0;
  let anchor = "";
  /** Where in the source the cover has reached. Never moves backwards. */
  let cursor = 0;
  let from = -1;
  let covered = 0;
  let forgivenSoFar = 0;
  const intervals: CoveredRun[] = [];
  /**
   * **A stretch shorter than the run floor is not evidence either way.**
   *
   * `minRun` says how long a match has to be before it counts as provenance; the
   * same length has to bound the other side, or the greedy walk condemns a
   * fragment it simply could not see. Two correct extractions failed on exactly
   * that: Readability removes the `<a>view email</a>` from arXiv's
   * `From: Llion Jones [<a>…</a>] Mon, 12 Jun 2017`, leaving the sixteen
   * characters `From: Llion Jones [` at the *start* of a node, too short for the
   * twenty-four-character window to find — while being plainly on the page.
   *
   * So a short stretch is forgiven **only when the source really does contain
   * it**. `"Zorbil weekly"` — thirteen characters of the `invent-short-text`
   * corruption — is short too, and is nowhere on the page, and is caught. The
   * honest limit: an adversary may hide up to twenty-three characters of invented
   * text per join *provided that exact string is elsewhere on the page*, and
   * **no more than `budget` characters of it in the whole cover** — which is the
   * half that was missing until 2026-09-05, and the half the composed attack
   * walked through.
   */
  const forgiven = (stretch: string): boolean =>
    stretch.length < minRun &&
    forgivenSoFar + stretch.length <= budget &&
    source.includes(stretch);
  while (i < t.length) {
    const floor = Math.min(minRun, t.length - i);
    if (source.indexOf(t.slice(i, i + floor), cursor) === -1) {
      i += 1;
      bad += 1;
      continue;
    }
    /* The longest run starting here that the source still has **ahead of the
       cursor**, by binary search, so a block that is present whole costs about a
       dozen searches. */
    let lo = floor;
    let hi = t.length - i;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (source.indexOf(t.slice(i, i + mid), cursor) !== -1) lo = mid;
      else hi = mid - 1;
    }
    const at = source.indexOf(t.slice(i, i + lo), cursor);
    if (bad > 0) {
      const stretch = t.slice(Math.max(0, i - bad), i);
      if (!forgiven(stretch)) {
        return {
          uncovered: stretch, anchor, from, to: cursor, covered, intervals,
          forgiven: forgivenSoFar,
        };
      }
      forgivenSoFar += stretch.length;
      bad = 0;
    }
    if (!anchor) {
      anchor = t.slice(i, i + lo);
      from = at;
    }
    covered += lo;
    intervals.push({ from: at, to: at + lo });
    cursor = at + lo;
    i += lo;
  }
  if (bad > 0) {
    const stretch = t.slice(t.length - bad);
    if (!forgiven(stretch)) {
      return {
        uncovered: stretch, anchor, from, to: cursor, covered, intervals,
        forgiven: forgivenSoFar,
      };
    }
    forgivenSoFar += stretch.length;
  }
  return {
    uncovered: null, anchor, from, to: cursor, covered, intervals, forgiven: forgivenSoFar,
  };
}

/**
 * The weak form: is this text on the page, and does it arrive in order?
 *
 * The order half uses each block's **anchor** — its longest opening run that the
 * source has — and a cursor that only moves forward. Until 2026-09-05 it took
 * each block's position with its own `source.indexOf`, so a paragraph said twice
 * got the same position twice, was non-decreasing, and passed. GPT Sol.
 */
function textForm(
  sourceHtml: string,
  blocks: ReturnType<typeof splitIntoBlocks>["blocks"],
): { attribution: string[]; order: string[]; judged: number; ordered: number } {
  const source = squeeze(textOf(sourceHtml));
  const judged = blocks.filter((b) => HAS_CONTENT.test(b.text));
  const attribution: string[] = [];
  const order: string[] = [];
  let cursor = 0;
  let found = 0;
  for (const b of judged) {
    const t = squeeze(b.text);
    const { uncovered, anchor } = coverOf(source, t, MIN_RUN, WHOLE_PAGE_FORGIVE_BUDGET);
    if (uncovered !== null) {
      attribution.push(
        `text the page does not have: ${JSON.stringify(uncovered.slice(0, 60))} — ` +
          `in ${JSON.stringify(norm(b.text).slice(0, 60))}`,
      );
      continue;
    }
    const at = source.indexOf(anchor, cursor);
    if (at < 0) {
      order.push(
        "out of order, or a second copy of text already used: " +
          JSON.stringify(norm(b.text).slice(0, 60)),
      );
      continue;
    }
    cursor = at + anchor.length;
    found += 1;
  }
  return { attribution, order, judged: judged.length, ordered: found };
}


/**
 * The strong form: **every output node has to be its own source element, and say
 * what that element said.**
 *
 * Three questions, and the second is the one that makes this worth having:
 *
 * 1. an output node carrying text of its own that resolves to nothing was
 *    **fabricated** — the collage arm's whole output is this;
 * 2. a **directly stamped** node's own text has to be covered by *that source
 *    element's* own text — so prose rewritten inside a node that kept its identity is
 *    caught, which is the exact thing a model repair pass would do and the thing
 *    the whole-page text form cannot see;
 * 3. the directly stamped text carriers have to arrive in **strictly increasing**
 *    source order, which is a reordering and a duplication in one rule: the second copy
 *    of a paragraph claims a source id the first copy already claimed.
 *
 * **Its own element, not the whole page**, and that is not fastidiousness. Asked
 * against the page, `ar5iv-attention` failed on 20 blocks of a correct
 * extraction: its MathML carries the rendered form and the LaTeX annotation side
 * by side (`ht−1h_{t-1}`), Readability keeps one, and the survivors are an
 * interleaving of the source at twenty-character granularity — too fine for any
 * whole-page run length to tell from invention. Against the node's own source
 * element there is nothing to interleave with.
 *
 * **The attribution question is asked of direct stamps only**, because the
 * fallbacks cannot bear it: on `pg-greatwork` 216 generated leaves resolve to an
 * ancestor and one source id is claimed by 217 output nodes, so a generated
 * node's "own" element is a guess, and its text is judged against the whole page
 * instead — weaker, and all that is available for it.
 *
 * **Order is not direct-stamps-only, and has not been since 2026-09-06.** That
 * sentence stood here while three separate rules were added underneath it. A
 * generated node walks forward through its ancestor's own text (the fourth
 * round's reversal finding), and **every** directly stamped element holding text
 * below it is checked for a decreasing stamp, whether or not it carries text of
 * its own (the fifth round's — twelve stamped sections reversed inside wrappers
 * with no own text of their own).
 */

function provenanceForm(
  stampedHtml: string,
  sourceHtml: string,
): { attribution: string[]; order: string[]; judged: number; ordered: number } {
  const doc = docOf(stampedHtml);
  const wholePage = squeeze(textOf(sourceHtml));
  const attribution: string[] = [];
  const order: string[] = [];
  let carriers = 0;
  const saidBefore = new Set<string>();
  const sourceText = sourceTextById(sourceHtml);

  for (const el of Array.from(doc.querySelectorAll("*"))) {
    const own = ownTextOf(el);
    const carriesText = HAS_CONTENT.test(own);
    const { id, how } = sourceRefOf(el);
    if (carriesText) {
      carriers += 1;
      if (how === "none") {
        attribution.push(
          `no source element for ${JSON.stringify(own.slice(0, 60))} — this node was fabricated`,
        );
      } else if (how !== "direct") {
        /* A node Readability generated. Its "own" source element is a guess — an
           ancestor may be the whole article — so its text is judged against the
           page instead, which is the weaker question and the only one available.
           `pg-greatwork` has 216 of these. */
        const { uncovered } = coverOf(wholePage, squeeze(own), MIN_RUN, WHOLE_PAGE_FORGIVE_BUDGET);
        if (uncovered !== null) {
          attribution.push(
            `a generated node says ${JSON.stringify(uncovered.slice(0, 60))}, ` +
              `which is nowhere on the page: ${JSON.stringify(own.slice(0, 60))}`,
          );
        }
      }
    }
    if (!carriesText || !id || (how !== "direct" && how !== "ancestor")) continue;

    /* What this element said where it came from. A missing id means the stamped
       source and the stamped output disagree about the document, which is a
       broken instrument rather than a bad arm — say so rather than pass. */
    const was = sourceText.get(id);
    if (was === undefined) {
      if (how === "direct") {
        attribution.push(`output claims source element ${id}, which the source does not have`);
      }
      continue;
    }
    const cover = coverOf(was, squeeze(own), MIN_RUN_IN_ELEMENT);
    if (cover.uncovered !== null) {
      /* **Two different failures wear the same red, so name which.** A cover is
         a subsequence *in order*, so words the element really does say, arriving
         before words already used, fail here too — and reporting that as "did
         not say" would send the reader looking for invented text that is not
         there. It is what GPT Sol's half-swapped paragraph does.

         Only for a node that IS this element. A generated node is judged against
         the whole page above; failing to slot into its ancestor's own text is
         not evidence of invention, it just means the ancestor is not where the
         order coordinate can place it. */
      if (how === "direct") {
        attribution.push(
          was.includes(cover.uncovered)
            ? `source element ${id} says ${JSON.stringify(cover.uncovered.slice(0, 60))} but ` +
                "not here — the output has its words out of the element's own order: " +
                JSON.stringify(own.slice(0, 60))
            : `source element ${id} did not say ${JSON.stringify(cover.uncovered.slice(0, 60))} — ` +
                `it is in the output as ${JSON.stringify(own.slice(0, 60))}`,
        );
      }
      continue;
    }

    /**
     * **No source element may say the same thing twice.**
     *
     * Separate from the order walk below, and it has to be: a repeat covers
     * ground already covered, which the order rule deliberately forgives —
     * `pg-greatwork` emits 28 generated nodes whose own text is `"["` and a
     * correct extraction must stay green. A real duplicate says the **same**
     * words under the same id, which is what this catches: a cloned paragraph,
     * and every node inside it, arrives with an `(id, own text)` pair already
     * seen. The `duplicate-paragraph` arm and the `duplicate-para-aria-hidden`
     * corruption both fail here.
     */
    if (how === "direct") {
      const said = `${id}\u0000${squeeze(own)}`;
      if (saidBefore.has(said)) {
        order.push(
          `source element ${id} says the same thing twice — a duplicate: ` +
            JSON.stringify(own.slice(0, 60)),
        );
        continue;
      }
      saidBefore.add(said);
    }
  }

  /**
   * **The order gate aligns every output text run, monotonically, against the
   * source text its own element could have supplied.** One walk, one cursor,
   * every carrier — directly stamped, generated, or a wrapper Readability built
   * around a stamped child.
   *
   * ## Why this is an alignment and not a fifth coordinate
   *
   * The four before it each answered a piece of the question and left a hole for
   * the next review to find. GPT Sol's seventh: `sourceRefOf` calls a generated
   * wrapper that contains a stamped child a **`descendant`**, and the previous
   * rule counted such a node's own text for attribution while leaving it out of
   * the order entirely. Both directions followed.
   *
   * - **A real reordering passed.** `<div><i>child first</i>loose text
   *   second</div>` extracted as `<p>loose text second<i>child first</i></p>`:
   *   the generated `<p>` resolves `descendant`, its loose text never entered the
   *   coordinate, and the clean and reordered cards were *identical* — attribution
   *   passed at exposure 3, order passed at exposure 2, every assertion held,
   *   `detects` empty.
   * - **A correct restructuring was condemned.** `A<i>X</i>B<span>Y</span>A<em>Z</em>`
   *   with `A<i>X</i>B` wrapped in a generated `<p>` reads identically, but the
   *   skipped `A`/`B` runs let the final direct `A` resolve to the *first*
   *   identical `A`, behind the already-consumed `Y`.
   *
   * **And it was not synthetic exposure**: the shipped corpus holds 31
   * descendant own-text carriers, 4,747 characters over six fixtures, 14 of them
   * and 4,162 characters on `pg-greatwork`. The "zero false reds" that justified
   * the previous rule was measured over a set that excluded exactly these runs.
   *
   * So the question is asked once, globally: **is there a monotone assignment of
   * the output's text runs to source text?** That subsumes what the four
   * coordinates were each half-answering — it lets `pg-greatwork`'s 28 `"["`
   * footnote markers take 28 *distinct* occurrences instead of being forgiven as
   * repeats, it lets a retained second occurrence map to the second occurrence,
   * and it rejects an output for which no monotone assignment exists.
   *
   * ## The algorithm, and what it costs
   *
   * Greedy earliest-admissible, in output order. For each run, take the admissible
   * placement that **ends** earliest, and advance the cursor to that end.
   *
   * **Earliest end, not earliest start**, and the distinction is not pedantry —
   * getting it wrong is what condemned a container that repeats its child's phrase
   * (§ the ninth review, at the bottom of this walk). The exchange argument is
   * unchanged in substance: the only thing a placement hands to the runs after it
   * is the cursor, feasibility is monotone in the cursor — anything placeable from
   * `c` is placeable from any `c' ≤ c` — so taking the smallest reachable cursor
   * never rules out a completion. What changes is which quantity that is. Where a
   * placement is an exact span its length is fixed, so earliest start *is* earliest
   * end and the two readings coincide; where it is a subsequence permitting
   * dropped children (`placeInSpan`) they come apart, and it is the end that the
   * argument is about.
   *
   * **What is not proven optimal** is the placement `coverOf` finds *within* one
   * stretch: it anchors at the earliest chunk it can and then takes the longest
   * run at each step, which is not guaranteed to be the cover that ends soonest.
   * Making it so would mean a search over chunk boundaries for a gain nothing has
   * yet needed — the candidates are compared by end, so the ordering between the
   * owner and the subtree is right, and only a subtree holding the same phrase
   * twice at chunk granularity could be placed later than necessary. Recorded
   * because the next false red of this family will start here.
   *
   * The owner is the run's element resolved by stamp — its **own text**, which
   * may be several pieces with other elements' text between them, and which a run
   * may straddle, because the child that sat between two pieces can have been
   * removed. A `descendant` or unstamped element has no owner, and its text is
   * matched against the whole page: a generated wrapper's loose text belongs to
   * no stamped element, and assigning it to its first stamped child would be
   * wrong — that child did not own it.
   *
   * Cost is one `indexOf` per run plus two binary searches, so it is linear in
   * the output's runs and logarithmic in one element's pieces, not quadratic.
   * Measured 2026-09-06 over the corpus: `gutenberg-pride`'s 4,465 runs in
   * **1.6 s**, `python-docs-itertools`'s 4,148 in 0.7 s, the whole fifteen in
   * about seven seconds. A first version scanned an element's own text
   * character by character to find the cursor and took **1,959 ms on
   * `pg-greatwork` alone**, whose one `<span>` holds 54,900 characters; that is
   * the binary search below.
   *
   * ## What it does not check
   *
   * Duplication is a separate rule above, and it has to be: under a monotone
   * alignment a second copy simply takes the next occurrence, and where the
   * source has only one there is nothing to take. It is checked for directly
   * stamped nodes by `(id, own text)`, and **not** for generated ones, for the
   * measured reason recorded there.
   */
  const { text: pageText, owners, subtrees } = sourceOwnership(sourceHtml);
  let cursor = 0;
  let judged = 0;
  const reordering = (run: string, where: string): void => {
    order.push(
      `${JSON.stringify(run.slice(0, 60))} is out of order — a reordering: the only place ` +
        `${where} has it is behind character ${cursor}, which the output has already passed`,
    );
  };
  const walk = (el: Element): void => {
    if (INVISIBLE_TAGS.has(el.tagName)) return;
    const { id, how } = sourceRefOf(el);
    const owner = (how === "direct" || how === "ancestor") && id ? owners.get(id) : undefined;
    /**
     * **A generated node's admissible set is its ancestor's whole subtree**, and
     * the ancestor's own text is only part of it — the rest is whatever children
     * the flattening kept. Looked up once per element rather than once per run;
     * `undefined` for every other resolution, which is what turns the branch off.
     */
    const subtree = how === "ancestor" && id ? subtrees.get(id) : undefined;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 1) {
        walk(node as Element);
        continue;
      }
      if (node.nodeType !== 3) continue;
      const run = squeeze(node.textContent ?? "");
      if (!run) continue;
      judged += 1;
      const placed = placeRun(pageText, run, cursor, owner);
      let span = placed.span;

      /**
       * **The ancestor's subtree, as an alignment rather than an exact match.**
       * See the two shapes above. The window stops at the owner's own placement
       * because a subtree placement is only worth having if it **ends earlier**:
       * the end is the whole of what the cursor carries forward, and bounding
       * the window by it is also what keeps this linear — the windows telescope,
       * one per step the cursor takes.
       *
       * When the owner could not place the run at all — including when its only
       * occurrence is behind the cursor — the window is the whole subtree, which
       * is the branch GPT Sol's eighth review opened; the fifteen **shipped**
       * extractions take it zero times, one degenerate arm does, and the note at
       * the bottom of this walk says which.
       */
      if (subtree) {
        const lo = Math.max(cursor, subtree.from);
        const hi = Math.min(subtree.to, span ? span[1] : subtree.to);
        const inSubtree = lo < hi ? placeInSpan(pageText, run, lo, hi) : null;
        if (inSubtree) span = inSubtree;
      }

      if (span) { cursor = span[1]; continue; }
      if (placed.behind) { reordering(run, id ? `source element ${id}` : "the page"); continue; }
      if (subtree && placeInSpan(pageText, run, subtree.from, subtree.to)) {
        reordering(run, `the subtree of source element ${id}`);
        continue;
      }

      /**
       * **Nothing above could place this run.** Kept as a named red rather than
       * a silent skip — the two branches that lead here are worth stating,
       * because both were bugs.
       *
       * **The owner could not supply it, and that used to drop it in silence**
       * on the reasoning that attribution had already rejected it. GPT Sol's
       * eighth review: attribution deliberately judges a generated node against
       * the *whole page*, so it had passed it, and the run simply vanished from
       * the alignment. `<div s1>A <i s2>X</i> B</div>` flattened to
       * `<div s1><p>A X B</p></div>` resolves to ancestor `s1`, whose own text is
       * only `AB`, so the `AXB` run was omitted — and moving that whole `<div>`
       * after a later paragraph produced a card *identical* to the correct one.
       *
       * **And the retry was an exact match rather than an alignment**, which is
       * GPT Sol's ninth, and the only defect this gate has had that condemned a
       * *correct* extraction rather than passing a bad one. `placeRun` looked for
       * the run as a substring of the subtree, so a flattening that legitimately
       * drops a child — `A <i>X</i> B <button>nav</button> C` becoming `AXBC` —
       * matched neither the own text `ABC` nor the subtree `AXBnavC`; and,
       * because the subtree was reached only *after* the owner, a container that
       * repeats its child's phrase placed the generated node at the owner's
       * later occurrence and then called the direct run left behind a reordering.
       *
       * The subtree was the right *spatial* boundary and that part stood. It is
       * a **cover** inside that boundary now — the same in-order, run-floored
       * subsequence `coverOf` gives attribution, so a dropped child costs a join
       * and nothing else — and it is one candidate among the placements rather
       * than a fallback behind one. See `placeInSpan`, and the tests named for
       * the ninth review in `tests/extraction-scorer.test.ts`.
       *
       * **Reaching here means nowhere its owner, its subtree or the page could
       * supply it.** This is text the page does not have, so attribution has
       * reported it too, and two reds for one fault is the cost. It is
       * deliberate: *"assume another check caught it"* is the shape of every hole
       * this gate has had, and a redundant red is cheaper than a silent skip.
       * Measured zero across the fifteen **shipped** extractions — but not zero
       * across the run: `drop-every-short-block` on `pmc-article` removes the
       * `<a>here</a>` from the bot wall's *"Click here if you are not
       * automatically redirected"*, and until this was fixed the card said this
       * run was invented while the attribution gate beside it said it was not.
       * The one thing this red is *not* is proof of invention on its own: a run
       * whose retained pieces are all present but in the wrong order inside the
       * subtree arrives here too, so the message below names both possibilities
       * rather than asserting the one the old wording asserted.
       */
      order.push(
        `${JSON.stringify(run.slice(0, 60))} could not be placed in the source at all — the ` +
          "order gate can say nothing about where it belongs" +
          (subtree
            ? `: the subtree of source element ${id} does not have it in this order, so either ` +
              "the words were invented or a generated node is saying what another container said"
            : ", and attribution should have reported the same text as invented"),
      );
    }
  };
  if (doc.body) walk(doc.body);

  return { attribution, order, judged: carriers, ordered: judged };
}

/**
 * **The page's visible text, and which stretches of it each stamped element
 * owns.** Walked over `childNodes`, so a run is placed where a reader meets it.
 *
 * An element's own text is `own`; `pieces` maps a position in `own` to its
 * position in the page, because the two differ wherever a child's text sits
 * between two of the element's own runs.
 */
interface Ownership {
  own: string;
  /** Sorted by `at`; `own[at .. at+len)` is `pageText[global .. global+len)`. */
  pieces: { at: number; len: number; global: number }[];
}
const ownershipCache = new Map<
  string,
  { text: string; owners: Map<string, Ownership>; subtrees: Map<string, { from: number; to: number }> }
>();
function sourceOwnership(sourceHtml: string): {
  text: string;
  owners: Map<string, Ownership>;
  /**
   * **Where everything under a stamped element sits**, as one `[from, to)` of
   * the page — a subtree's text is contiguous in document order.
   *
   * **Bounds, not strings**, and that is not tidiness. Storing each subtree's
   * text made the corpus run die: `gutenberg-pride` has 3,542 stamped elements
   * inside a 589,000-character page, and one slice apiece is quadratic in the
   * nesting. The run reached the sixth fixture and then
   * *"FATAL ERROR: Ineffective mark-compacts near heap limit"* at 4 GB, exit
   * **134**. The string is cut on demand, in the branch that needs it — which is
   * taken zero times on the fifteen.
   */
  subtrees: Map<string, { from: number; to: number }>;
} {
  const hit = ownershipCache.get(sourceHtml);
  if (hit) return hit;
  const owners = new Map<string, Ownership>();
  const subtrees = new Map<string, { from: number; to: number }>();
  let text = "";
  const walk = (el: Element): void => {
    if (INVISIBLE_TAGS.has(el.tagName)) return;
    const id = el.getAttribute(SOURCE_REF);
    const from = text.length;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 1) {
        walk(node as Element);
        continue;
      }
      if (node.nodeType !== 3) continue;
      const t = squeeze(node.textContent ?? "");
      if (!t) continue;
      if (id) {
        const o = owners.get(id) ?? { own: "", pieces: [] };
        o.pieces.push({ at: o.own.length, len: t.length, global: text.length });
        o.own += t;
        owners.set(id, o);
      }
      text += t;
    }
    if (id && text.length > from) subtrees.set(id, { from, to: text.length });
  };
  const body = docOf(sourceHtml).body;
  if (body) walk(body);
  const value = { text, owners, subtrees };
  if (ownershipCache.size > 4) ownershipCache.delete(ownershipCache.keys().next().value as string);
  ownershipCache.set(sourceHtml, value);
  return value;
}

/** `own[local]` → its position in the page, by binary search over the pieces. */
function globalOf(o: Ownership, local: number): number {
  let lo = 0;
  let hi = o.pieces.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = o.pieces[mid]!;
    if (local < p.at) hi = mid - 1;
    else if (local >= p.at + p.len) lo = mid + 1;
    else return p.global + (local - p.at);
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * **Where this run may sit, given who owns it and how far the walk has come.**
 *
 * `span` is where it was placed. `behind` says the only place it fits is behind
 * the cursor, which is a reordering. Neither means it is nowhere its owner could
 * supply it — invented text, which attribution reports on its own.
 */
function placeRun(
  pageText: string,
  run: string,
  cursor: number,
  owner: Ownership | undefined,
): { span?: [number, number]; behind: boolean } {
  if (!owner) {
    const at = pageText.indexOf(run, cursor);
    if (at !== -1) return { span: [at, at + run.length], behind: false };
    return { behind: pageText.includes(run) };
  }
  /* The first character of this element's own text that is at or beyond the
     cursor, by binary search over its pieces rather than a scan: `pg-greatwork`
     has one <span> of 54,900 characters and scanning it per run cost 1.9 s. */
  let lower = owner.own.length;
  let lo = 0;
  let hi = owner.pieces.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = owner.pieces[mid]!;
    if (p.global + p.len <= cursor) lo = mid + 1;
    else {
      lower = p.at + Math.max(0, cursor - p.global);
      hi = mid - 1;
    }
  }
  const k = owner.own.indexOf(run, lower);
  if (k !== -1) {
    return { span: [globalOf(owner, k), globalOf(owner, k + run.length - 1) + 1], behind: false };
  }
  return { behind: owner.own.includes(run) };
}

/**
 * **Where this run sits inside one stretch of the page, allowing for children
 * the extraction dropped.** `null` when it does not sit there at all.
 *
 * The caller is the `ancestor` branch of the order walk: a node Readability
 * built by flattening a subtree carries the ancestor's own text *and* whichever
 * children survived, and **no element owns that combination**, so an exact match
 * — against the own text or against the subtree — condemns a correct extraction.
 * That was the ninth review's finding, in both of its shapes.
 *
 * So the question asked here is `coverOf`'s: **is every character of the run
 * inside a run of at least `MIN_RUN_IN_ELEMENT` characters that this stretch
 * has, in this stretch's own order?** A dropped child costs one join and nothing
 * else, which is exactly the property the attribution gate is already built on,
 * so there is one mechanism here rather than a second one — and a *rearrangement*
 * of the retained children still fails, because a cover is a subsequence in
 * order.
 *
 * `MIN_RUN_IN_ELEMENT` rather than `MIN_RUN`, because the haystack is one
 * element's subtree rather than the page: the floor is what makes a match
 * evidence, and a coincidental one is far less likely here. Invention is not
 * this function's question in any case — attribution asks that of a generated
 * node against the whole page, at the 24-character floor.
 *
 * **The window is cut here, and only here.** Storing every element's subtree
 * text up front is quadratic in the nesting and killed the corpus run at 4 GB —
 * `gutenberg-pride` has 3,542 stamped elements inside 589,000 characters. The
 * caller passes `[lo, hi)` bounded by where the cursor is and by the placement
 * it already has, so what is cut is the distance the cursor travels rather than
 * a subtree apiece. Measured 2026-09-06, whole `score()` calls, warm, mean of
 * three: `gutenberg-pride` 587 → 598 ms, `python-docs-itertools` 371 → 393 ms,
 * `pg-greatwork` 65 → 103 ms — the last is where the 216 generated leaves are,
 * and 38 ms is what asking this question of every one of them costs.
 *
 * **The floor is not pinned by any test**, said out loud because this file's
 * rule is that a check nobody has seen fail is not evidence: dropping it to 1,
 * which turns the cover into a bare character subsequence, leaves all 66 cases
 * in `tests/extraction-scorer.test.ts` green (measured 2026-09-06, with the six
 * other mutations of this branch all caught). No shape anybody has written
 * distinguishes the two, and finding one belongs with C0's shape corpus.
 */
function placeInSpan(
  pageText: string,
  run: string,
  lo: number,
  hi: number,
): [number, number] | null {
  if (hi <= lo) return null;
  const cover = coverOf(pageText.slice(lo, hi), run, MIN_RUN_IN_ELEMENT);
  /* `from < 0` is a cover made entirely of forgiven fragments — nothing was
     actually matched, so there is no position to claim. */
  if (cover.uncovered !== null || cover.from < 0) return null;
  return [lo + cover.from, lo + cover.to];
}

/**
 * `s41` → what element 41 of the source said, squeezed. Built once per source
 * document and cached, because a corpus run asks for it once per arm.
 */
const sourceTextCache = new Map<string, Map<string, string>>();
function sourceTextById(sourceHtml: string): Map<string, string> {
  const hit = sourceTextCache.get(sourceHtml);
  if (hit) return hit;
  const out = new Map<string, string>();
  for (const el of Array.from(docOf(sourceHtml).querySelectorAll(`[${SOURCE_REF}]`))) {
    const id = el.getAttribute(SOURCE_REF);
    /* **Own text on this side too.** Comparing an output element's own text
       against its source element's *whole* text would forgive an arm that pulled
       a child's words up into the parent, which is text moving without being
       invented — and it is the shape `unwrap` takes. */
    if (id) out.set(id, squeeze(ownTextOf(el)));
  }
  if (sourceTextCache.size > 4) {
    sourceTextCache.delete(sourceTextCache.keys().next().value as string);
  }
  sourceTextCache.set(sourceHtml, out);
  return out;
}

/* -------------------------------------------------------------- polarity ---- */

export type Direction = "up" | "down" | "flat" | "not exercised";

export interface PolarityRow {
  metric: MetricName;
  before: number | null;
  restoreBody: Direction;
  addNav: Direction;
}

export interface PolarityVerdict {
  rows: PolarityRow[];
  passed: boolean;
  failures: string[];
  /** How many metrics each half actually moved — the exposure count, again. */
  movedOnRestore: number;
  movedOnNav: number;
}

const EPS = 1e-9;
function direction(before: number | null, after: number | null): Direction {
  if (before === null || after === null) return "not exercised";
  if (after > before + EPS) return "up";
  if (after < before - EPS) return "down";
  return "flat";
}

/**
 * **The polarity pair.** Nothing on this card may be quoted as evidence until
 * this passes, and it is run in `tests/extraction-scorer.test.ts` on every
 * change rather than by hand.
 *
 * Two mutations of the same document:
 *
 * - **restore body** — a thousand characters of text that *is* the article come
 *   back. Every metric must go up or stay flat, and **at least one must go up**.
 * - **add nav** — 393 characters of navigation are glued inside the
 *   article container, which is the shape `fixtures/README.md` calls "the case
 *   that would falsify the fix". Every metric must go down or stay flat, and
 *   **at least one must go down**.
 *
 * The second half is the one that matters. A recovery-only card — recall alone,
 * `droppedChars` alone, "characters gained" alone — passes the first and fails
 * the second, which is precisely the three bugs in the header, and it fails here
 * in a line that names the metric rather than in a plausible-looking number six
 * months later.
 *
 * `bodyHtml` and `navHtml` are the caller's, because *known* is doing the work
 * in "known article body" and "known navigation": only the caller knows which is
 * which, and a harness that invented them would be marking its own homework.
 */
export function polarityPair(
  base: ScoreInput,
  mutations: { withoutBody: string; withBody: string; withNav: string },
  /**
   * **The card to judge, and it is a parameter so the refusal can be executed.**
   *
   * The test named *"REFUSES a recovery-only card"* built a recovery-only scorer
   * and then never handed it to this function — it checked that the remaining
   * metrics were flat and stopped. `polarityPair` could have stopped refusing
   * altogether and that test would have stayed green, which makes it a control
   * that cannot go red: the exact shape this stage exists to refuse, one level up
   * in the apparatus. GPT Sol, 2026-09-05.
   */
  scorer: (input: ScoreInput) => Scorecard = score,
): PolarityVerdict {
  const at = (html: string): Scorecard => scorer({ ...base, html });
  const before = at(mutations.withoutBody);
  const restored = at(mutations.withBody);
  const navved = at(mutations.withNav);
  /* `before` for the nav half is the un-damaged document, not the truncated one:
     adding navigation to an article that is already missing a section would
     conflate the two moves. */
  const navBase = restored;

  const rows: PolarityRow[] = METRICS.map((m) => ({
    metric: m,
    before: before.metrics[m].value,
    restoreBody: direction(before.metrics[m].value, restored.metrics[m].value),
    addNav: direction(navBase.metrics[m].value, navved.metrics[m].value),
  }));

  const failures: string[] = [];
  for (const r of rows) {
    if (r.restoreBody === "down") {
      failures.push(`${r.metric} FELL when a thousand characters of article body came back`);
    }
    if (r.addNav === "up") {
      failures.push(
        `${r.metric} ROSE when the page's own navigation was added — ` +
        "this is the recovery-read-as-quality bug, exactly",
      );
    }
  }
  const movedOnRestore = rows.filter((r) => r.restoreBody === "up").length;
  const movedOnNav = rows.filter((r) => r.addNav === "down").length;
  if (movedOnRestore === 0) {
    failures.push("no metric rose when article body came back — the card cannot see recovery");
  }
  if (movedOnNav === 0) {
    failures.push(
      "no metric fell when navigation was added — the card is RECOVERY-ONLY, " +
      "which is the failure this whole stage exists to prevent",
    );
  }
  return { rows, passed: failures.length === 0, failures, movedOnRestore, movedOnNav };
}

/**
 * **Take a run of the article out, and say exactly what was taken.**
 *
 * The `restore body` half of the polarity pair needs a thousand characters of
 * *known article body* and nothing else, and "drop the second half" is not that.
 * The first version of the runner used exactly that, and three fixtures reported
 * a metric going the wrong way for reasons that were nothing to do with the
 * scorer:
 *
 * - **plos-biology and quanta**: their furniture is at the END — 26 `View
 *   Article` buttons, a `Next article` rail — so truncating the page removes
 *   furniture too, and `exclusionPrecision` was *better* on the truncated
 *   document. Putting the body back then made it worse, and the harness
 *   correctly refused a mutation that was never body-only.
 * - **gutenberg-pride**: its second half contains a block over the manifest's
 *   `maxBlockChars`, so restoring it restores an offence and `blockCleanliness`
 *   fell.
 *
 * So the run to remove is chosen rather than assumed: a contiguous run of the
 * article's own top-level pieces that reaches `minChars`, **contains at least
 * one string the manifest says must be there**, and **contains none of the
 * strings it says must not**. A page where no such run exists gets `null` and
 * the runner says so — which is an honest "this page cannot exercise the pair",
 * not a pass.
 */
export function bodyRunToRemove(
  html: string,
  opts: { want: readonly string[]; avoid: readonly string[]; minChars: number },
): { html: string; removedChars: number; wanted: string } | null {
  /* **Its own parse, not `docOf`'s.** That one caches by string and hands the
     same Document to every later caller, so removing nodes from it would quietly
     change what the next `textOf` on the same HTML returns. This one is mutated
     and thrown away, and the surrounding markup survives untouched — which the
     first version did not manage: it rebuilt the wrapper by slicing `outerHTML`
     around `innerHTML`, which drops an ancestor and returns nonsense if the two
     ever fail to line up. */
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`, {
    virtualConsole: new VirtualConsole(),
  }).window.document;
  const root = contentRoot(doc);
  const kids = Array.from(root.children);
  const textAt = kids.map((el) => norm(el.textContent ?? ""));
  const wants = opts.want.map(norm).filter((w) => w.length > 20);
  const avoids = opts.avoid.map(norm);

  for (let start = 0; start < kids.length; start++) {
    let chars = 0;
    for (let end = start; end < kids.length; end++) {
      chars += textAt[end]!.length;
      if (chars < opts.minChars) continue;
      const run = textAt.slice(start, end + 1).join(" ");
      const wanted = wants.find((w) => run.includes(w));
      if (!wanted) continue;
      if (avoids.some((a) => run.includes(a))) break; /* this start is contaminated */
      for (let i = start; i <= end; i++) kids[i]!.remove();
      return { html: doc.body.innerHTML, removedChars: chars, wanted };
    }
  }
  return null;
}

/**
 * A thousand-odd characters of navigation, in the shape the trawl found inside
 * article containers: a flat list of short link labels. Thirty items, because
 * that is the count `fixtures/README.md` records for the reproduction GPT Sol
 * built — "thirty items, 1,370 characters admitted".
 *
 * **That 1,370 is markup, and it is not even this rail's markup.** The thirty
 * labels below are **393 characters of text** (422 space-separated) inside
 * **1,211 bytes** of list markup; the 1,370 belongs to the real page GPT Sol
 * reproduced against. Every metric here measures text, so quoting a markup
 * figure as though it were a text figure is how the polarity test came to claim
 * a thousand-character mutation it was not making. All the numbers are asserted
 * in `tests/extraction-scorer.test.ts` rather than described here, so the next
 * edit to this list cannot leave the sentence behind. GPT Sol, 2026-09-05.
 */
export function navRail(): { html: string; texts: string[] } {
  const items = [
    "Home", "About us", "Contact", "Newsletter", "Subscribe now", "Privacy policy",
    "Terms of service", "Advertise with us", "Careers at the paper", "Corrections",
    "Send us a tip", "Reader services", "Gift subscriptions", "Manage your account",
    "Today's paper", "Most popular", "Editors' picks", "Video", "Podcasts",
    "Newsletters archive", "Crossword", "Cooking", "Wirecutter reviews", "Athletic",
    "Site index", "Site map", "Accessibility statement", "Help centre",
    "Sell your data preferences", "California notice",
  ];
  return {
    html:
      `<nav class="site-rail"><ul>${items
        .map((t) => `<li><a href="/x">${t}</a></li>`)
        .join("")}</ul></nav>`,
    texts: items,
  };
}

/* ------------------------------------------------------------- detection ---- */

export interface Detection {
  /** Metrics whose value fell between the clean card and the damaged one. */
  byMetric: MetricName[];
  /** Gates that passed on the clean card and failed on the damaged one. */
  byGate: GateName[];
  detected: boolean;
}

/**
 * **Did the card notice?** — the question mutation testing asks over and over.
 *
 * `disabled` deletes metrics from consideration, which is the mutation itself:
 * take one out, re-ask, and see whether some damage that used to be caught now
 * goes green. **A metric whose removal reddens nothing is not load-bearing and
 * should be deleted**, and this is the function that says so.
 *
 * A gate cannot be disabled, because a gate is not a metric: an arm that
 * scrambles the document order has not scored badly, it has produced something
 * that is not the article. So `byGate` is reported separately and never counts
 * towards a metric being load-bearing.
 */
export function detects(
  clean: Scorecard,
  damaged: Scorecard,
  disabled: readonly MetricName[] = [],
): Detection {
  const byMetric = METRICS.filter((m) => {
    if (disabled.includes(m)) return false;
    const a = clean.metrics[m].value;
    const b = damaged.metrics[m].value;
    return a !== null && b !== null && b < a - EPS;
  });
  const byGate = GATES.filter(
    (g) => clean.gates[g].passed === true && damaged.gates[g].passed === false,
  );
  return { byMetric, byGate, detected: byMetric.length > 0 || byGate.length > 0 };
}
