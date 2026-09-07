/**
 * **Does this page quote this article, and is it a copy of it?** — two ratios
 * over overlapping runs of words, with no model in it anywhere.
 *
 * Debate mode's group one claims that a page is *about this piece*. Until
 * 2026-09-06 the only proof of that was `namesArticle` — the page contains the
 * title, or links it — and on a 2023 article with a same-named 2026 successor
 * that put six pages about the wrong document on screen as reception. The
 * evidence this file adds is the one signal that separates them per row: **does
 * the page contain words that are actually in this article?**
 *
 * ## The two ratios, and why both
 *
 * - **Coverage** — the share of *the article's* windows found in the page's
 *   extract. It is the **floor**: any hit at all is evidence that this page has
 *   the article's words in it.
 * - **Density** — the share of *the extract's own* windows found in the article.
 *   It is the **ceiling**: a page that is almost entirely article words is a
 *   copy of the piece, not a response to it.
 *
 * **The ceiling counts density and not coverage, and that correction is the
 * whole reason this file has two numbers in it.** Coverage is the obvious copy
 * test and it is wrong on any article longer than its extract: a search engine
 * hands back two or three hundred characters of a long document, coverage reads
 * 0.5%, and a library's plain-text copy of the original is kept and shown as a
 * page that quotes the piece. Measured on three articles, every copy scored
 * ≥ 65% density and every genuine reply ≤ 17.3% — an empty band either side of
 * 50% — while on coverage the copies scored *below* the replies.
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md
 * § "The ceiling counts density, not coverage".
 *
 * ## What it is not
 *
 * Not a score. Nothing here is added to anything else or weighted against it:
 * the two ratios are shown to the reader as themselves, and the verdict a caller
 * draws from them is a lookup over named facts (`IdentificationSignal`,
 * src/types.ts). The plan refuses the composite and says why.
 *
 * Not a second matcher, either. Every comparison goes through
 * `findQuote(haystack, needle, undefined, "spaced")`, which is the same
 * server-safe call the rest of this mode makes — so a curly apostrophe, a
 * non-breaking space and a run of newlines are the same text on both sides, and
 * the forgiving pass that would accept *"fall a part"* for *"fall apart"* never
 * runs.
 *
 * **Model-free, IO-free and importing only `quote-match`**, which is what lets
 * the panel reach it if it ever needs to (tests/client-imports.test.ts).
 */

import { findQuote, quoteFinder } from "./quote-match.js";
import type { BlockKind } from "./types.js";

/**
 * **One block of the article, as the shingler needs it** — its words, and *what
 * it is*.
 *
 * The kind is here rather than inferred, because the one rule below that needs
 * it — a heading is naming evidence and never text evidence — has to be a fact
 * about the block and not a guess from its length or a comparison against the
 * title. A subtitle, a running head and a title repeated as a section heading
 * are all headings and none of them equals `article.title`.
 */
export interface ArticleBlockText {
  text: string;
  kind: BlockKind;
}

/**
 * **How many consecutive words make a window**, and **how many characters it
 * must reach.**
 *
 * Eight words is long enough that two pages sharing one is not a coincidence;
 * forty characters is what stops a run of eight short common words — *"a b c d
 * e f g h"* is fifteen characters — from being read as a quotation. Measured
 * over 2,308 windows of one article against eight third-party commentaries:
 * **no hit at all**, so the floor does not leak.
 */
export const SHINGLE_WORDS = 8;
/** See `SHINGLE_WORDS`. */
export const SHINGLE_MIN_CHARS = 40;

/**
 * **The share of a page's own words that may be the article's before it stops
 * being a response to it**, and the number of windows the question needs before
 * it may be asked at all.
 *
 * 50% sits in an empty band: every copy measured is ≥ 65% and every genuine
 * reply ≤ 17.3%. The five-window floor is because a 250-character extract
 * carries a couple of dozen windows and a ratio over three of them is noise.
 */
export const COPY_DENSITY = 0.5;
/** See `COPY_DENSITY`. */
export const COPY_MIN_WINDOWS = 5;

/** One run of words from the article, and the block it came from. */
export interface ArticleWindow {
  text: string;
  /** The block id, as the caller's map spells it. */
  blockId: string;
}

/**
 * **The article, shingled once.**
 *
 * Precomputed rather than derived per page, because a direct pass judges up to
 * twelve rows against the same article and the window list of a long piece runs
 * to a couple of thousand entries.
 */
export interface ArticleShingles {
  windows: readonly ArticleWindow[];
  /**
   * The block texts themselves, which is what density asks its question of —
   * **the same prose the windows came from**, headings excluded, so that one
   * rule about what a heading is holds on both sides of this file.
   */
  blocks: readonly ArticleWindow[];
}

/** What one page's extract shares with the article. */
export interface ShingleOverlap {
  /** Article windows found in the extract, over article windows. 0–1, and 0 when there are none. */
  coverage: number;
  /** Extract windows found in the article, over extract windows. 0–1, and 0 when there are none. */
  density: number;
  /** What each ratio was computed over, so a caller can say "one window in 349". */
  articleWindows: number;
  extractWindows: number;
  /**
   * **The first article window located in the page, as the page's own
   * characters** — or `null` when the page quotes nothing.
   *
   * The extract's spelling rather than the article's, which is the same
   * discipline `locate` (src/debate.ts) and `place` (src/quotes.ts) follow: what
   * is shown as a quotation from a page must be what a reader would find if they
   * followed the link.
   */
  hit: { quote: string; blockId: string } | null;
}

/**
 * **Every run of `SHINGLE_WORDS` words in this text that reaches
 * `SHINGLE_MIN_CHARS`**, one step at a time.
 *
 * Overlapping rather than tiled, so a quotation that begins mid-sentence — which
 * is what a search extract always is — still lines up with the article's own
 * windows. Whitespace of every kind is a word break, because `block.text` has
 * been collapsed to single spaces and an extract has not.
 */
export function shingleWindows(text: string): string[] {
  const words = text.split(/\s+/).filter((w) => w !== "");
  const out: string[] = [];
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) {
    const window = words.slice(i, i + SHINGLE_WORDS).join(" ");
    if (window.length >= SHINGLE_MIN_CHARS) out.push(window);
  }
  return out;
}

/**
 * **Shingle the article once**, from the same `blockText` map the group readers
 * already hold — so a window carries the id of the block it came from and a
 * `quoted` signal can point at a real passage.
 *
 * **Text evidence is over prose, and headings are not prose** (GPT Sol's F1,
 * 2026-09-06). A title of eight words reaching forty characters is itself a
 * window, so a page that merely repeats the title earned `quoted` — clearing the
 * default bar, and putting a 2026 successor at a different address on screen as
 * reception of the 2023 piece. That is precisely the failure this file exists to
 * prevent, arriving through the signal built to prevent it. A page repeating a
 * heading is evidence of *naming*, which `named` already covers, so nothing is
 * lost and the two levels stop overlapping.
 *
 * **One rule, both sides.** The first draft dropped headings from `windows` and
 * kept them in `blocks`, on the reasoning that a mirror reproduces the headings
 * too — and Sol found the contradiction that follows: a title long enough to
 * carry five windows made an extract that is *only* the title read as 100%
 * article words, so the same page the quotation rule had just been taught to let
 * through was dropped as a copy, and the reader told a second false thing about
 * it. A heading is naming evidence and nothing else, on every side of this file.
 */
export function articleShingles(blockText: ReadonlyMap<string, ArticleBlockText>): ArticleShingles {
  const windows: ArticleWindow[] = [];
  const blocks: ArticleWindow[] = [];
  for (const [blockId, block] of blockText) {
    if (block.kind === "heading") continue;
    blocks.push({ blockId, text: block.text });
    for (const window of shingleWindows(block.text)) windows.push({ text: window, blockId });
  }
  return { windows, blocks };
}

/**
 * **What this page's extract shares with this article**, both ways round.
 *
 * Both ratios are computed whatever the verdict, because the panel shows them
 * whether the row was kept, and a function that returned a boolean would make
 * the reader's tooltip a second pass over the same strings.
 *
 * Density is asked **per block** rather than of the blocks joined together: a
 * join would invent a run of words across a boundary the article does not have,
 * and inflating the copy test with text nobody wrote is the wrong direction to
 * be wrong in.
 */
export function shingleOverlap(article: ArticleShingles, extract: string): ShingleOverlap {
  const extractWindows = shingleWindows(extract);

  /* **`quoteFinder` rather than `findQuote`, and it is the same matcher.** Both
     loops below ask thousands of questions of a handful of haystacks, and
     `findQuote` reduces its haystack once per question: a 2,455-window article
     against an 8,000-character extract took eight seconds a row that way, on a
     step somebody is waiting for. */
  const inExtract = quoteFinder(extract, "spaced");
  let found = 0;
  let hit: ShingleOverlap["hit"] = null;
  for (const window of article.windows) {
    const span = inExtract(window.text);
    if (!span) continue;
    found++;
    /* The first one, in block order, and the page's own characters. */
    hit ??= { quote: extract.slice(span.start, span.end), blockId: window.blockId };
  }

  const inBlock = article.blocks.map((b) => quoteFinder(b.text, "spaced"));
  let mirrored = 0;
  for (const window of extractWindows) {
    if (inBlock.some((find) => find(window) !== null)) mirrored++;
  }

  return {
    coverage: ratio(found, article.windows.length),
    density: ratio(mirrored, extractWindows.length),
    articleWindows: article.windows.length,
    extractWindows: extractWindows.length,
    hit,
  };
}

/**
 * **Is this page a copy of the article rather than a response to it?**
 *
 * A copy is dropped even when it links the article and even when it quotes it —
 * maximal identification, minimal reason to show it — so this is asked *before*
 * a row is kept and never as a tie-break afterwards. `selfSource` wearing a new
 * hat: `sameTarget` cannot catch it, because a `www.` host and an archive are
 * different addresses.
 */
export function isCopy(overlap: ShingleOverlap): boolean {
  return overlap.extractWindows >= COPY_MIN_WINDOWS && overlap.density >= COPY_DENSITY;
}

/**
 * **Are these the article's own words?** — the second signal the copy refusal
 * asks for, over one passage rather than a ratio.
 *
 * `isCopy` judges the **search extract**, and an extract is whatever the engine
 * chose: a long blockquote and one short rebuttal is what a *fisking* looks
 * like, and it reads as 50% density (GPT Sol's F2, 2026-09-06, with a
 * 22-window reproduction). The overlapping windows make the five-window floor
 * weaker than it looks, too — five matches can come from one contiguous twelve
 * words rather than five independent passages.
 *
 * So the caller asks this of the row's own verified `sourceQuote` as well. **A
 * mirror has no words of its own**, so the words it engages with must be the
 * article's; a fisking's are its own rebuttal sentence. Two independent signals
 * both pointing at "this is a copy", rather than one.
 *
 * **Over the blocks joined, which is the one place in this file that is** —
 * corrected 2026-09-06 after Sol found the hole. Density is asked per block
 * because a join would *invent* windows across a boundary and inflate the copy
 * ratio with text nobody wrote. This question is the other way round: the
 * extract of a copy is the article's blocks with the breaks between them, the
 * spaced matcher reads straight across one, and a model that picked a
 * `sourceQuote` spanning two paragraphs took a mirror past the refusal. Across a
 * break the words are still the article's, so joining can only refuse *more*
 * copies — and a reply's own rebuttal sentence is no more findable in the joined
 * article than in any one block of it.
 */
export function isArticleText(article: ArticleShingles, quote: string): boolean {
  if (quote.trim() === "") return false;
  /* Document order, because `blockText` is built from the block array and a Map
     keeps its insertion order — so this is the article as it reads. */
  const whole = article.blocks.map((b) => b.text).join("\n\n");
  return findQuote(whole, quote, undefined, "spaced") !== null;
}

/** Zero rather than `NaN` for the empty case, which is a real one: a 70-character extract. */
function ratio(found: number, total: number): number {
  return total === 0 ? 0 : found / total;
}
