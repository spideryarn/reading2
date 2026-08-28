/**
 * The before-and-after inventory — step 1 of docs/plans/readability-repair-pass.md.
 *
 * No model calls, no money, no network. It answers the only question worth asking
 * before any of the rest: **what did Readability drop, and what did it drag in?**
 *
 *   npx tsx evals/extraction/inventory.mts data/noema-mythology-of-conscious-ai
 *   npx tsx evals/extraction/inventory.mts <dir> --rows      # the full table
 *   npx tsx evals/extraction/inventory.mts <dir> --json out.json
 *
 * A `<dir>` is anything holding `raw.html`; the URL comes from `meta.json` or
 * `raw.json` beside it, and only matters because jsdom wants a base.
 *
 * ## How "kept?" is decided, and the one way it lies
 *
 * Readability is run over a SECOND parse of the same bytes, because `parse()`
 * mutates the document it is handed — the raw DOM would be gone otherwise, and
 * "before and after" needs both. Each candidate block's normalised text is then
 * looked for inside the normalised text of Readability's output.
 *
 * That is a substring test on text, deliberately, because Readability rewrites
 * *markup* freely — it unwraps divs, promotes children, strips attributes — and
 * any test that compares nodes would report those as losses. Text is the thing
 * the reader gets.
 *
 * Where it lies: a block whose text appears verbatim somewhere ELSE in the
 * article is scored kept even if its own copy was dropped. Short blocks ("Read
 * more", "2026", a lone name) collide constantly, which is why anything under
 * MIN_MATCH_CHARS is reported as `short` rather than as kept or dropped and is
 * left out of the character totals. Long prose does not collide.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { unhideCollapsedSections } from "../../src/extract.js";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { isMain } from "../../src/is-main.js";

/**
 * Words per shingle, and the two thresholds a block is judged by.
 *
 * A shingle is N consecutive words. A block is scored by what fraction of its
 * shingles appear anywhere in Readability's output, which replaced an
 * exact-substring test — and the substring test was the third instrument bug in
 * this file. On Paul Graham's essay it reported the entire 2,953-character
 * article as **dropped** while the ratio underneath said 100%: one block, one
 * all-or-nothing comparison, and Readability had reflowed a `<br>` into a
 * paragraph break somewhere in the middle. A whole-page verdict rested on one
 * character.
 *
 * Fractions also buy a third answer that matters. `partial` is a block
 * Readability kept *some* of, which is a real and otherwise invisible failure —
 * and a category that cannot exist in a yes/no test, so its absence was not
 * something the old design could report.
 *
 * Eight words is long enough not to collide (a boilerplate "read more about
 * this in our newsletter" is seven) and short enough to survive a rewrite a few
 * words away.
 */
const SHINGLE = 8;
const KEPT_AT = 0.9;
const DROPPED_AT = 0.1;
/** Fewer words than this and no honest verdict is available — see `verdict`. */
const MIN_MATCH_WORDS = 12;
/** How much of a block the table shows. */
const SNIPPET = 90;
/** Below this, the walker has missed most of the page and the run is not evidence. */
const COVERAGE_FLOOR = 0.8;

/**
 * Below this a run of text is not a block, it is a label. Used to find the
 * *deepest* elements that carry prose — see `candidates`.
 */
const MIN_BLOCK_CHARS = 20;

/** Never inventoried, and never counted in the raw character total. */
const INVISIBLE = new Set(["script", "style", "noscript", "template", "svg", "head", "title"]);

/**
 * One normalisation, used on both sides. Whitespace collapsed because the two
 * sides serialise inline elements differently; case folded because a publisher's
 * CSS `text-transform` is not in the text but a hand-written check might be.
 */
const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/** N consecutive words, as one string each. */
function shingles(text: string): string[] {
  const words = text.split(" ").filter(Boolean);
  if (words.length < SHINGLE) return words.length ? [words.join(" ")] : [];
  const out: string[] = [];
  for (let i = 0; i + SHINGLE <= words.length; i++) out.push(words.slice(i, i + SHINGLE).join(" "));
  return out;
}

/** Longest run of values that increase — the standard patience-sorting one. */
function longestIncreasing(xs: number[]): number {
  const tails: number[] = [];
  for (const x of xs) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = x;
  }
  return tails.length;
}

/**
 * How much of one block survived into the extraction, and what to call it.
 *
 * **Position matters, not just presence**, and that is the fourth thing this
 * file got wrong. Counting how many of a block's shingles appear *anywhere* in
 * the extraction says "kept" for a block whose words are scattered across the
 * page in other people's sentences — which is not a hypothetical: boilerplate
 * repeats, and so do an author's stock phrases. A test written with four
 * near-identical synthetic paragraphs scored a wholly truncated article as
 * nothing-dropped, and the synthetic was only exaggerating what a page of
 * repeated legal notices does for real.
 *
 * So a shingle counts only as part of an increasing run of positions: the block
 * has to appear in the extraction *in its own order*. A repeated phrase can
 * still contribute one position, but it cannot lend order to text that has none.
 *
 * A block too short to fingerprint is `short` rather than `dropped`. That is not
 * a rounding-off: "Read more", a byline, a date and a section number collide
 * with each other and with the article across any page, so a match on one of
 * them is evidence of nothing in either direction, and counting them would move
 * the totals by hundreds of blocks. They stay out of the character sums too.
 */
function verdict(text: string, articleText: string): { verdict: Verdict; survived: number } {
  const words = text.split(" ").filter(Boolean);
  if (words.length < MIN_MATCH_WORDS) {
    /* Too short for an honest kept/dropped verdict, but not too short to say
       whether the string is *there* — and the difference matters downstream.
       A caller building a set of "blocks the extraction does not contain" needs
       to exclude the short ones that plainly do appear, or it hands a judge
       headings that were never dropped and reads the answer as discrimination.
       That happened: the Noema control fed Luna eight section headings
       Readability had kept, and its correct "these are the article" was scored
       as if it had rescued them. Plain containment, not shingles, because at
       this length a shingle is the whole string anyway. */
    return { verdict: "short", survived: articleText.includes(text) ? 1 : 0 };
  }
  const mine = shingles(text);
  const positions = mine.map((sh) => articleText.indexOf(sh)).filter((i) => i >= 0);
  const survived = mine.length ? longestIncreasing(positions) / mine.length : 0;
  return {
    verdict: survived >= KEPT_AT ? "kept" : survived <= DROPPED_AT ? "dropped" : "partial",
    survived,
  };
}

type Verdict = "kept" | "partial" | "dropped" | "short" | "duplicate";

interface Row {
  id: string;
  tag: string;
  depth: number;
  chars: number;
  /**
   * See `verdict`. `short` means too small to judge, not missing; `duplicate`
   * means this text appears more often in the source than in the extraction and
   * text alone cannot say which copy survived.
   */
  verdict: Verdict;
  /** Fraction of this block's shingles found in the extraction, 0–1. */
  survived: number;
  /** Where it sits, for a human reading the table. */
  path: string;
  snippet: string;
}

/** The nearest thing to a stable address for a node, for eyeballing only. */
function shortPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  for (let i = 0; node && i < 4; i++) {
    const tag = node.tagName.toLowerCase();
    const cls = (node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)[0];
    parts.unshift(cls ? `${tag}.${cls}` : tag);
    node = node.parentElement;
  }
  return parts.join(">");
}

function depthOf(el: Element): number {
  let d = 0;
  let node: Element | null = el.parentElement;
  while (node) { d++; node = node.parentElement; }
  return d;
}

/**
 * Elements that live *inside* a paragraph rather than being one.
 *
 * This is the list the walker below needs, and it is the right list to keep by
 * name: it is small, it is fixed by HTML itself, and it does not grow when a
 * publisher invents a class name. The block-level list is the one that rots —
 * see the note on `candidates`.
 */
const INLINE = new Set([
  "a", "abbr", "b", "bdi", "bdo", "big", "br", "cite", "code", "data", "del", "dfn", "em",
  "font", "i", "img", "ins", "kbd", "mark", "q", "s", "samp", "small", "span", "strike",
  "strong", "sub", "sup", "time", "tt", "u", "var", "wbr", "ruby", "rt", "rp",
]);

/**
 * Candidate blocks, in document order: the **deepest elements that are not
 * themselves made of blocks**.
 *
 * Two wrong versions of this got as far as printing numbers, and both are worth
 * recording because both looked fine.
 *
 * **A list of block tag names** (`p`, `li`, `h1`–`h6`, …) found *one* block of
 * 67 characters in Paul Graham's 3,096-character essay and printed
 * `ratio 100.0%` underneath. His HTML is a `<table>` holding a `<font>` holding
 * the whole essay split by `<br>`, and no tag on that page is on anybody's list.
 * The instrument was blind to the entire article and said nothing — the shape of
 * docs/reusable/silent-success.md, produced by the tool built to catch it. That
 * is what `coverage` now guards.
 *
 * **"Deepest element with 20+ characters"**, the fix for it, then reported 12,231
 * characters of the Noema essay as dropped when Readability had kept every word.
 * A paragraph containing a link with a long enough anchor has a *child* with 20+
 * characters, so the paragraph stopped being a candidate and shattered into the
 * link plus the loose text around it — text that is contiguous in the document
 * and is not contiguous in any string we build from it. Every fragment then
 * failed to match, and the failure looked exactly like a publisher's section
 * being dropped.
 *
 * So: a candidate is the deepest element whose qualifying children are all
 * **inline**. That keeps a paragraph whole through its own links and emphasis,
 * finds `<li>` and `<h2>` without naming them, and takes PG's `<font>` — while
 * refusing to swallow a `<div>` that is really a container of paragraphs.
 */
function candidates(doc: Document): { el: Element; text: string }[] {
  const out: { el: Element; text: string }[] = [];
  const body = doc.body;
  if (!body) return out;

  const big = (t: string | null) => norm(t ?? "").length >= MIN_BLOCK_CHARS;

  const walk = (el: Element): void => {
    if (INVISIBLE.has(el.tagName.toLowerCase())) return;
    const kids = Array.from(el.children).filter((c) => !INVISIBLE.has(c.tagName.toLowerCase()));
    const blockKids = kids.filter(
      (c) => !INLINE.has(c.tagName.toLowerCase()) && big(c.textContent),
    );
    if (!blockKids.length) {
      if (big(el.textContent)) out.push({ el, text: norm(el.textContent) });
      return;
    }
    /* Loose text of its own, alongside children that are blocks in their own
       right — `<div>intro<p>…</p></div>`. Rare, and invisible in every other
       design, so it gets a row rather than being silently scored as extracted. */
    const own = norm(
      Array.from(el.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent ?? "")
        .join(" "),
    );
    if (own.length >= MIN_BLOCK_CHARS) out.push({ el, text: own });
    for (const c of kids) walk(c);
  };
  walk(body);
  return out;
}

/**
 * Take the scaffolding out of the document, once, before anything reads it.
 *
 * It used to be filtered at each step instead, and that left a hole the walker
 * fell into: with `<script>` skipped as a *child* but still inside
 * `body.textContent`, a page whose only content was an inline script reported
 * one block, full coverage and nothing dropped. A page's JavaScript is not
 * prose, and any code that has to remember to exclude it will one day forget.
 * Removing it from the tree means nothing downstream can see it at all.
 */
function stripInvisible(doc: Document): void {
  for (const tag of INVISIBLE) {
    for (const el of Array.from(doc.querySelectorAll(tag))) el.remove();
  }
}

/** Visible text of a document. Assumes `stripInvisible` has already run. */
function visibleText(doc: Document): string {
  return norm(doc.body?.textContent ?? "");
}

/**
 * Things a reader loses that a character comparison cannot see.
 *
 * Added after the corpus run, and it earned its place immediately: on the
 * Wikipedia transformer article **0 of 188 `<math>` elements and 0 of 13 tables
 * survive extraction**, while the surrounding prose comes through fine. Compare
 * text and you see a paragraph that mostly survived; count elements and you see
 * that every equation in a deep-learning article is gone.
 *
 * This is failure mode **S**, and it is the one bag-of-words scoring is blind to
 * by construction — which is why it is counted separately rather than folded
 * into the ratio. Kept over present, per tag.
 */
export const STRUCTURE = [
  "math", "table", "pre", "figcaption", "code", "blockquote", "li", "h2", "h3", "img",
] as const;

export interface Comparison {
  rawTextChars: number;
  articleTextChars: number;
  /** Extracted over raw — the two-sided check. Low means truncation, high means boilerplate. */
  ratio: number;
  rows: Row[];
  totals: {
    blocks: number;
    kept: number;
    duplicate: number;
    partial: number;
    dropped: number;
    short: number;
    keptChars: number;
    droppedChars: number;
    coverage: number;
  };
  /** The longest runs of consecutive dropped blocks — where a truncation shows up. */
  gaps: { startId: string; blocks: number; chars: number; snippet: string }[];
  /** Per tag, how many of the page's own survived. See STRUCTURE. */
  structure: Record<string, { present: number; kept: number }>;
}

export interface Inventory extends Comparison {
  dir: string;
  url: string;
  rawBytes: number;
  title: string | null;
  /**
   * Readability's own output, verbatim. Carried so a caller can compare two arms
   * **as documents** rather than as character counts — which is how the `[hidden]`
   * regression hid for a day (see `gainedText` in corpus.mts). Equal counts are
   * not an unchanged page, and un-hiding Wikipedia proved it: identical text
   * length, 3,572 fewer bytes, all of it the removed attribute.
   */
  articleHtml: string;
}

/**
 * The comparison itself, over two strings — **the seam this whole file is
 * tested at**.
 *
 * Kept separate from `inventory` below, which reads files and calls
 * Readability, because a test that has to fetch a page and run a third-party
 * parser to check a matcher is a test nobody writes. Three instrument bugs got
 * as far as printing confident numbers here (see `candidates` and `verdict`),
 * and every one of them is now a four-line synthetic in
 * tests/extraction-inventory.test.ts precisely because this function takes the
 * before and the after as arguments.
 */
export function compare(rawHtml: string, articleHtml: string, url: string): Comparison {
  const opts = { url, virtualConsole: new VirtualConsole() };
  const before = new JSDOM(rawHtml, opts).window.document;
  const articleDoc = new JSDOM(`<!doctype html><body>${articleHtml}</body>`, opts).window.document;
  stripInvisible(before);
  stripInvisible(articleDoc);
  const articleText = visibleText(articleDoc);
  const rawText = visibleText(before);

  const rows: Row[] = [];
  const candidateText = new Map<string, string>();
  let n = 0;
  for (const { el, text } of candidates(before)) {
    const v = verdict(text, articleText);
    candidateText.set(`n${n + 1}`, text);
    rows.push({
      id: `n${++n}`,
      tag: el.tagName.toLowerCase(),
      depth: depthOf(el),
      chars: text.length,
      verdict: v.verdict,
      survived: v.survived,
      path: shortPath(el),
      snippet: text.slice(0, SNIPPET),
    });
  }

  /**
   * **The fifth instrument bug: multiplicity.** Found by a GPT Sol review of the
   * built code, 2026-08-27, and reproduced before being believed.
   *
   * `verdict` runs independently per row, and `indexOf` has no memory, so two
   * source rows with the same text both match the *same* single occurrence in
   * the extraction and both come back `kept`. The ordinary shape of that is a
   * teaser or a related-articles card repeating a sentence of the article: the
   * teaser was correctly dropped, and the inventory says both survived, with
   * `keptChars` counting the characters twice and `dropped` at zero.
   *
   * Text cannot say WHICH copy survived, and pretending otherwise is how the
   * previous four bugs happened. So the excess copies are marked `duplicate` —
   * not kept, not dropped, and out of the character totals — and the honest
   * repair is source-id provenance through Readability's `serializer` option,
   * which knows the answer outright. That is build-order step 2 in
   * docs/plans/readability-repair-pass.md; this is the guard until it lands.
   */
  const seen = new Map<string, number>();
  /** Texts that really were in the extraction and whose copies are now used up. */
  const exhausted = new Set<string>();
  for (const r of rows) {
    if (r.verdict !== "kept") continue;
    const text = candidateText.get(r.id) ?? "";
    /* `seen.has`, not `used === 0`. With 0 as the "not counted yet" sentinel,
       a text with exactly one occurrence counts down to 0 after the first row
       and the second row reads that as "not counted yet", recounts, and is
       kept — which is the bug this pass exists to fix, reproduced inside the
       fix. Caught by the test, which is the only reason it is not still here. */
    if (!seen.has(text)) {
      /* How many times does this text really occur in the extraction? */
      let count = 0;
      for (let i = articleText.indexOf(text); i >= 0; i = articleText.indexOf(text, i + 1)) count++;
      seen.set(text, count);
    }
    const left = seen.get(text) ?? 0;
    /* A row whose exact text occurs ZERO times was judged kept by shingles, not
       by exact presence — the extraction reflowed it, or kept 90% of it and cut
       the tail. Multiplicity has nothing to say about that, and demoting it here
       called a merely-truncated block a duplicate. Only demote where the text
       demonstrably exists and the copies have run out. */
    if (left === 0 && !exhausted.has(text)) continue;
    if (left <= 0) r.verdict = "duplicate";
    else {
      seen.set(text, left - 1);
      if (left - 1 === 0) exhausted.add(text);
    }
  }

  const totals = {
    blocks: rows.length,
    kept: rows.filter((r) => r.verdict === "kept").length,
    duplicate: rows.filter((r) => r.verdict === "duplicate").length,
    partial: rows.filter((r) => r.verdict === "partial").length,
    dropped: rows.filter((r) => r.verdict === "dropped").length,
    short: rows.filter((r) => r.verdict === "short").length,
    keptChars: rows.filter((r) => r.verdict === "kept").reduce((a, r) => a + r.chars, 0),
    droppedChars: rows.filter((r) => r.verdict === "dropped").reduce((a, r) => a + r.chars, 0),
    /**
     * What fraction of the page's visible text the inventory can actually see.
     *
     * The guard on the whole instrument. Every number beside it is computed from
     * the rows, so a page whose text the walker fails to reach scores perfectly
     * while measuring nothing — which is exactly what happened on PG (see
     * `candidates`). Anything under COVERAGE_FLOOR is shouted about rather than
     * reported, because a quiet 4% looks like a good result.
     */
    coverage: 0,
  };
  totals.coverage = rawText.length
    ? Math.min(1, rows.reduce((a, r) => a + r.chars, 0) / rawText.length)
    : 0;

  /* Runs of consecutive dropped blocks. One dropped paragraph among kept ones is
     noise; sixty in a row is a section of the article missing. A `short` block
     does not break a run — a dropped section is full of two-word list items. */
  const gaps: Comparison["gaps"] = [];
  let run: Row[] = [];
  const flush = () => {
    const chars = run.reduce((a, r) => a + r.chars, 0);
    if (run.length && chars > 0) {
      gaps.push({
        startId: run[0]!.id, blocks: run.length, chars, snippet: run[0]!.snippet.slice(0, 70),
      });
    }
    run = [];
  };
  for (const r of rows) {
    if (r.verdict === "dropped") run.push(r);
    else if (r.verdict === "kept") flush();
  }
  flush();
  gaps.sort((a, b) => b.chars - a.chars);

  const structure: Comparison["structure"] = {};
  for (const tag of STRUCTURE) {
    const present = before.querySelectorAll(tag).length;
    if (!present) continue;
    structure[tag] = { present, kept: articleDoc.querySelectorAll(tag).length };
  }

  return {
    rawTextChars: rawText.length,
    articleTextChars: articleText.length,
    ratio: rawText.length ? articleText.length / rawText.length : 0,
    rows,
    totals,
    gaps: gaps.slice(0, 8),
    structure,
  };
}

/**
 * Rung 0 of docs/plans/readability-repair-pass.md — **un-hide before parsing.**
 *
 * Re-exported from src/extract.ts rather than reimplemented, so this eval scores
 * the code that ships. The reasoning, the fifteen-page evidence and the reason
 * `[hidden]` is *not* in it are all on `unhideCollapsedSections`.
 */
export const unhide = unhideCollapsedSections;

/**
 * Readability over one HTML file, compared with the page it came from.
 *
 * Split out from `inventory` below so a corpus can be measured without first
 * being copied into `data/<slug>/` — a fixture set is a pile of files with
 * their URLs, and making it look like an ingested article before it can be
 * measured is work that buys nothing.
 */
export async function inventoryFile(
  htmlPath: string,
  url: string,
  opts: { unhide?: boolean } = {},
): Promise<Inventory> {
  const html = await readFile(htmlPath, "utf-8");
  return { ...inventoryHtml(html, url, opts), dir: htmlPath, url, rawBytes: Buffer.byteLength(html) };
}

function inventoryHtml(html: string, url: string, opts: { unhide?: boolean }): Inventory {
  /* Readability mutates the document it is handed, so this parse is its own and
     `compare` gets a fresh one. Sharing them destroys the "before". */
  const doc = new JSDOM(html, { url, virtualConsole: new VirtualConsole() }).window.document;
  if (opts.unhide) unhide(doc);
  const article = new Readability(doc).parse();
  const articleHtml = article?.content ?? "";
  return {
    dir: "", url, rawBytes: Buffer.byteLength(html),
    title: article?.title ?? null,
    articleHtml,
    ...compare(html, articleHtml, url),
  };
}

/** Readability over `<dir>/raw.html`, compared with the page it came from. */
export async function inventory(dir: string, opts: { unhide?: boolean } = {}): Promise<Inventory> {
  const html = await readFile(path.join(dir, "raw.html"), "utf-8");

  let url = "https://example.invalid/";
  for (const name of ["meta.json", "raw.json"]) {
    const p = path.join(dir, name);
    if (!existsSync(p)) continue;
    const j = JSON.parse(await readFile(p, "utf-8")) as { url?: string; finalUrl?: string };
    if (j.finalUrl || j.url) { url = (j.finalUrl ?? j.url) as string; break; }
  }

  return { ...inventoryHtml(html, url, opts), dir };
}

function report(inv: Inventory, showRows: boolean): void {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n${inv.dir}  —  ${inv.title ?? "(Readability returned nothing)"}`);
  console.log(`  ${inv.url}`);
  console.log(
    `  raw ${(inv.rawBytes / 1024).toFixed(0)} KB, ${inv.rawTextChars.toLocaleString()} text chars` +
    `  ->  article ${inv.articleTextChars.toLocaleString()}  (ratio ${pct(inv.ratio)})`,
  );
  const t = inv.totals;
  console.log(
    `  blocks ${t.blocks}: kept ${t.kept} (${t.keptChars.toLocaleString()} ch), ` +
    `partial ${t.partial}, dropped ${t.dropped} (${t.droppedChars.toLocaleString()} ch), ` +
    `too short to judge ${t.short}` +
    (t.duplicate ? `, ${t.duplicate} duplicate (which copy survived is unknowable from text)` : ""),
  );
  if (t.coverage < COVERAGE_FLOOR) {
    console.log(
      `  !! the inventory can only see ${pct(t.coverage)} of this page's text — ` +
      "every number above it is measuring a fraction of the page. Fix `candidates` before believing it.",
    );
  }
  const lost = Object.entries(inv.structure).filter(([, v]) => v.kept < v.present);
  if (lost.length) {
    console.log(
      `  structure kept/present: ${lost.map(([t, v]) => `${t} ${v.kept}/${v.present}`).join(", ")}`,
    );
  }
  if (inv.gaps.length) {
    console.log("  longest dropped runs:");
    for (const g of inv.gaps.slice(0, 5)) {
      console.log(`    ${g.startId.padEnd(6)} ${String(g.blocks).padStart(3)} blocks ` +
        `${String(g.chars).padStart(6)} ch  "${g.snippet}"`);
    }
  }
  if (!showRows) return;
  console.log("");
  for (const r of inv.rows) {
    const mark =
      r.verdict === "kept" ? "  "
      : r.verdict === "dropped" ? "--"
      : r.verdict === "partial" ? "~~"
      : r.verdict === "duplicate" ? "==" : "??";
    console.log(
      `${mark} ${r.id.padEnd(6)} ${r.tag.padEnd(10)} d${String(r.depth).padStart(2)} ` +
      `${String(r.chars).padStart(5)}  ${r.path.slice(-40).padEnd(40)}  ${r.snippet}`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dirs = args.filter((a) => !a.startsWith("--"));
  const showRows = args.includes("--rows");
  const doUnhide = args.includes("--unhide");
  const jsonAt = args.indexOf("--json");
  if (!dirs.length) {
    console.error("Usage: npx tsx evals/extraction/inventory.mts <dir with raw.html>… [--rows] [--json <file>]");
    process.exit(1);
  }
  const out: Inventory[] = [];
  for (const dir of dirs) {
    try {
      const inv = await inventory(dir, { unhide: doUnhide });
      out.push(inv);
      report(inv, showRows && dirs.length === 1);
    } catch (err) {
      console.error(`\n${dir}: ${(err as Error).message}`);
    }
  }
  if (jsonAt >= 0 && args[jsonAt + 1]) {
    await writeFile(args[jsonAt + 1]!, `${JSON.stringify(out, null, 2)}\n`, "utf-8");
    console.log(`\nWritten to ${args[jsonAt + 1]}`);
  }
}

if (isMain(import.meta.url)) void main();
