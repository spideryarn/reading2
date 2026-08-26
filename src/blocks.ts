/**
 * Pipeline stage 3 — split an extracted article into blocks and give each a
 * stable id. See docs/project/architecture.md#pipeline and
 * docs/project/block-ids.md.
 *
 *   npm run blocks -- output/noema-mythology-of-conscious-ai.html
 *
 * Writes ids into the HTML in place (so `#spya-k3m9qt` anchors work with no
 * JavaScript) and a sibling `.blocks.json`. Re-running is idempotent: ids
 * already present are kept, only missing ones are minted.
 */

import { JSDOM } from "jsdom";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSpideryarnId, mintUniqueId } from "./ids.js";
import { sanitizeInPlace } from "./sanitize.js";
/* `Block` and `BlockKind` come from types.ts rather than being declared here.
   This file *writes* blocks.json — the spine every later stage addresses text
   through (docs/project/block-ids.md) — so a second declaration of its shape is
   the one place a silent divergence costs most. There was one until
   2026-08-26: field-for-field identical to types.ts, and nothing checking that
   it stayed so, because pipeline.ts reads only `run.stats` and there is no
   assignment point where the two would ever be compared.

   An `import type` is erased, so this does not put jsdom in anyone's bundle —
   the reason types.ts gives for staying declaration-only still holds. */
import type { Block, BlockKind } from "./types.js";

/**
 * Blocks are the *finest* unit a reader takes in as one thing, so a `<li>` is a
 * block and the `<ul>` around it is not. Containers become nodes in the tree
 * instead, which is what lets the ToC choose its own granularity: one row for a
 * list of terse bullets, one row per item for a list of real arguments.
 * See docs/project/table-of-contents.md#granularity.
 */
const LEAF_BLOCKS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "PRE", "BLOCKQUOTE", "FIGURE", "TABLE", "IMG", "HR", "IFRAME",
]);

/** Descended into, never emitted. */
const CONTAINERS = new Set([
  "DIV", "SECTION", "ARTICLE", "MAIN", "UL", "OL", "DL",
  "HEADER", "FOOTER", "ASIDE", "NAV", "BODY",
]);

/**
 * `IFRAME` is deliberately not here, though it used to be. By the time this
 * runs, src/sanitize.ts has already deleted every iframe except a video embed
 * from an allowlisted origin — so the only ones left are ones Greg decided to
 * keep (2026-08-25), and skipping them here would drop the video out of the
 * reading view while leaving it in the HTML file. That is precisely the bug the
 * allowlist was written to avoid, and it survived until GPT-5's review caught
 * it. Sanitising is what makes this line safe to change.
 */
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "FORM", "BUTTON"]);

/**
 * Captions that sit *beside* a figure rather than inside it, so they arrive as
 * ordinary paragraphs. They belong to the image, not to the argument, and a ToC
 * row reading "Figure 2: A modern version of a McCulloch-Pitts neuron…" as a
 * peer of real prose is noise. Matched on the explicit marker only — never on
 * length, because "Given all this, what should we do?" is seven words of
 * genuine argument.
 */
const CAPTION_MARKER = /^(figure|fig\.?|table|chart|diagram|image|photo|plate)\s*\d*\s*[:.—-]/i;

/** Standalone boilerplate labels acting as headings: "Credits", "Sources". */
const BOILERPLATE_LABEL = /^(credits?|sources?|notes?|references?|photo credits?)$/i;

/**
 * Fold text down to what two extractions of the same paragraph agree on: case,
 * punctuation and whitespace all drift between Readability runs, so none of
 * them can be part of a match key.
 *
 * Until 2026-08-26 this was `[^a-z0-9 ]`, which is a correct spelling of
 * "punctuation" only if the only text you have ever looked at is English. In
 * Cyrillic, Greek, Chinese, Arabic or Devanagari it deleted the paragraph, and
 * every one of the five resulting failures reported success — see
 * docs/postmortems/block-id-matching-non-latin.md.
 *
 * `NFKC` first is load-bearing rather than tidy: `\p{M}` is kept so Devanagari
 * matras and Arabic diacritics survive, which means NFD `café` (e + U+0301)
 * would otherwise key differently from NFC `café`. NFKC composes them. It
 * changes string length, which is fatal in src/quote-match.ts — that file
 * hand-rolls a length-preserving fold because it derives offsets — but nothing
 * here derives offsets, so it is available to us.
 *
 * Whitespace is collapsed *after* the strip, not before, so `and — as` and
 * `and as` agree; stripping the dash first leaves a double space behind.
 */
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, "")
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .trim();

/**
 * Is there anything here at all?
 *
 * A different question from "what is this text's match key", and it has to be
 * asked separately. `normalize` folds `★ ★ ★` and `©` to nothing, so a
 * paragraph made of symbols reads as empty to it — and three call sites used to
 * take that answer as permission to drop the paragraph.
 */
const hasContent = (s: string) => /\S/u.test(s);

/** Lists nested directly inside this element. */
const nestedLists = (el: Element) =>
  Array.from(el.children).filter((c) => c.tagName === "UL" || c.tagName === "OL");

/**
 * An `<li>` holding a nested list is a leaf *and* a container: "Nested outer"
 * is its own readable unit, and the items beneath it are separate ones. We emit
 * the item's own content as a block and descend into the sublist, so every item
 * at every level is addressable. Without this the sublist is swallowed into its
 * parent's text and cannot be linked to at all.
 *
 * The block's text and html come from a clone with the sublists stripped, so no
 * two blocks ever contain the same text — the flat sequence the tree ranges
 * over must not overlap.
 */
function ownContent(el: Element): Element {
  const nested = nestedLists(el);
  if (nested.length === 0) return el;
  const clone = el.cloneNode(true) as Element;
  for (const child of nestedLists(clone)) child.remove();
  return clone;
}

/**
 * Text with block boundaries preserved as spaces. Bare `textContent` runs
 * adjacent blocks together — a blockquote of two paragraphs comes out as
 * "…sentence one.Sentence two…" — which corrupts word counts and any gist
 * written from it.
 */
function extractText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const n of Array.from(
    clone.querySelectorAll("p,div,br,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,td,th,tr"),
  )) {
    n.insertAdjacentText("beforebegin", " ");
  }
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function classify(el: Element): { kind: BlockKind; level?: number } {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) return { kind: "heading", level: Number(tag[1]) };
  if (tag === "PRE") return { kind: "code" };
  if (tag === "BLOCKQUOTE") return { kind: "quote" };
  if (tag === "FIGURE" || tag === "IMG" || tag === "HR" || tag === "IFRAME") {
    return { kind: "media" };
  }
  if (tag === "TABLE") return { kind: "other" };
  return { kind: "text" };
}

/**
 * What kind of block this is, and whether the ToC should write a row about it.
 *
 * `classify` answers from the tag alone; this is everything that needs the text
 * as well. Split out of `splitIntoBlocks` so the id-assignment logic and the
 * gistable rules can each be read without the other.
 */
function describeBlock(
  el: Element,
  text: string,
  proseText: string[],
): { kind: BlockKind; level?: number; gistable: boolean; note?: string } {
  let { kind, level } = classify(el);
  let gistable = true;
  let note: string | undefined;

  if (kind === "media" || el.tagName === "HR") {
    gistable = false;
    note = "media";
  } else if (el.tagName === "P" && isImageOnly(el)) {
    kind = "media";
    gistable = false;
    note = "image-only paragraph";
  } else if (text.length === 0) {
    gistable = false;
    note = "empty";
  } else if (CAPTION_MARKER.test(text)) {
    kind = "caption";
    gistable = false;
    note = "figure caption";
  } else if (BOILERPLATE_LABEL.test(text)) {
    gistable = false;
    note = "boilerplate label";
  }

  // Pull-quotes repeat a sentence that is already in the prose. Giving them
  // gists would put the same claim in the ToC twice.
  if (gistable && (kind === "quote" || el.closest("figure"))) {
    const probe = normalize(text).slice(0, 60);
    if (probe.length >= 30 && proseText.some((p) => p.includes(probe))) {
      gistable = false;
      note = "pull-quote duplicating body text";
    }
  }

  return { kind, level, gistable, note };
}

/** A `<p>` whose only real content is an image is a media block, not prose. */
function isImageOnly(el: Element): boolean {
  return (
    el.querySelector("img") !== null && !hasContent(el.textContent ?? "")
  );
}

/**
 * Wrap loose text sitting directly inside a container in a `<p>`, so it becomes
 * addressable instead of vanishing.
 *
 * `walk` iterates `el.children`, which is elements only — so a bare text node
 * between two containers is invisible to it and its words never reach any
 * block. That was survivable while every wrapper the author wrote survived to
 * this point, because the text always had *some* element around it. Sanitising
 * broke that assumption: DOMPurify drops an unrecognised tag but keeps its
 * contents, so `<x-article>real prose</x-article>` — the kind of custom element
 * a modern CMS emits, which Readability passes through untouched — arrives here
 * as naked text and used to be silently dropped, along with whatever id it
 * carried. GPT-5's review caught it, 2026-08-25.
 *
 * Done here rather than in a pass of its own so it inherits `walk`'s decision
 * about what counts as a container: the only elements this touches are ones we
 * were about to descend into and emit nothing for.
 */
function rewrapOrphanText(el: Element): void {
  const doc = el.ownerDocument;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== 3) continue; // TEXT_NODE
    if (!hasContent(node.nodeValue ?? "")) continue;
    const p = doc.createElement("p");
    el.replaceChild(p, node);
    p.appendChild(node);
  }
}

function collectElements(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    rewrapOrphanText(el);
    for (const child of Array.from(el.children)) {
      const tag = child.tagName;
      if (SKIP.has(tag)) continue;
      if (LEAF_BLOCKS.has(tag)) {
        out.push(child);
        // A list item is the one leaf that can contain further blocks.
        if (tag === "LI") for (const sublist of nestedLists(child)) walk(sublist);
        continue; // otherwise never descend into a leaf
      }
      if (CONTAINERS.has(tag)) {
        walk(child);
        continue;
      }
      // Unknown wrapper: descend if it holds block-level children, else treat
      // it as a block so no content silently disappears.
      const hasBlockChildren = Array.from(child.children).some(
        (c) => LEAF_BLOCKS.has(c.tagName) || CONTAINERS.has(c.tagName),
      );
      if (hasBlockChildren) walk(child);
      else if (hasContent(child.textContent ?? "")) out.push(child);
    }
  };
  walk(root);
  return out;
}

export interface SplitResult {
  blocks: Block[];
  html: string;
  stats: {
    total: number;
    reused: number;
    carried: number;
    minted: number;
    gistable: number;
  };
}

/**
 * Ids already present in the HTML survive a re-run of this stage. They do NOT
 * survive a re-run of *stage 2*, which writes a fresh document from Readability
 * with no ids in it at all — and re-extraction is exactly the case random ids
 * exist to protect against (block-ids.md#why-random-and-not-sequential).
 *
 * So when the previous blocks.json is available we re-attach ids by matching
 * block text. A paragraph keeps its id for as long as its words are unchanged,
 * regardless of what was inserted above it. An edited paragraph gets a fresh id
 * and loses its annotations — that is a real limit, and honest: we cannot tell
 * a heavily rewritten paragraph from a new one.
 *
 * Matching is first-come over the previous document's order, and each previous
 * id is consumed once, so a page with several identical short paragraphs can't
 * hand the same id to two blocks.
 */
/**
 * Pass one's key: the text as written, whitespace collapsed. Two runs that
 * produced the same paragraph agree here, and an exact agreement is the only
 * kind that needs no judgement at all.
 */
function exactKey(text: string, html: string): string | null {
  const written = text.replace(/\s+/gu, " ").trim();
  if (written) return `x:${written}`;
  // Images and rules carry no text, so match them on what they point at —
  // otherwise every figure is re-minted on each re-extraction and any ToC row
  // aimed at a diagram goes stale.
  const src = /\bsrc="([^"]+)"/.exec(html)?.[1];
  return src ? `s:${src}` : null;
}

/** Pass two's key: the same words, once punctuation and case are folded away. */
function foldedKey(text: string): string | null {
  const words = normalize(text);
  return words ? `f:${words}` : null;
}

function bucketBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

interface Candidate {
  text: string;
  html: string;
}

/**
 * Re-attach previous ids to this run's blocks — the whole reason a
 * re-extraction is survivable, since stage 2 hands us a fresh document from
 * Readability with no ids in it at all
 * (block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters).
 *
 * **Two passes, and the second one refuses to guess.**
 *
 *   pass 1  exact text (or, for a block with none, its src)  → consume the id
 *   pass 2  the folded key, and only where exactly one previous block and
 *           exactly one new block claim it                   → consume the id
 *   else    re-mint
 *
 * Pass one first because it needs no judgement, and because it is what stops
 * two paragraphs trading ids when a re-render merely reorders them. Pass two
 * catches the ordinary drift the fold exists for — a curly apostrophe going
 * straight, an entity decoding differently.
 *
 * The ambiguity rule is the part with design in it. A fold creates equivalence
 * classes the raw text does not have — `Ⅳ` and `IV` both become `iv`, `①` and
 * `1` both become `1` — so a bucket can hold two genuinely different
 * paragraphs, and the old code handed the id to whichever came first. That is
 * not "the id was lost", it is "the reader's note is now attached to a
 * different claim", and block-ids.md is explicit that a lost anchor is the
 * safer failure. So an ambiguous bucket re-mints and says so in `minted`.
 *
 * Runs over the whole document at once rather than block by block, because
 * "is this bucket ambiguous?" cannot be answered until every claimant is known.
 *
 * Returns one entry per candidate: the id it may keep, or undefined to mint.
 */
function carryOverIds(
  previous: Block[] | undefined,
  candidates: Candidate[],
  taken: Set<string>,
): (string | undefined)[] {
  const out: (string | undefined)[] = candidates.map(() => undefined);
  if (!previous?.length) return out;

  const claim = (id: string | undefined): boolean => {
    if (id === undefined || taken.has(id)) return false;
    taken.add(id);
    return true;
  };

  // Pass one. Each previous id is consumed once, so a page with several
  // identical short paragraphs cannot hand the same id to two blocks.
  const byExact = bucketBy(previous, (b) => exactKey(b.text, b.html));
  const unmatched: number[] = [];
  candidates.forEach((c, i) => {
    const key = exactKey(c.text, c.html);
    const bucket = key === null ? undefined : byExact.get(key);
    let id: string | undefined;
    while (bucket?.length && id === undefined) {
      const next = bucket.shift()!.id;
      if (claim(next)) id = next;
    }
    if (id === undefined) unmatched.push(i);
    else out[i] = id;
  });

  // Pass two, over what is left on both sides.
  const byFolded = bucketBy(
    previous.filter((b) => !taken.has(b.id)),
    (b) => foldedKey(b.text),
  );
  const claimants = bucketBy(unmatched, (i) => foldedKey(candidates[i]!.text));
  for (const [key, indices] of claimants) {
    const bucket = byFolded.get(key);
    if (indices.length !== 1 || bucket?.length !== 1) continue; // ambiguous → mint
    if (claim(bucket[0]!.id)) out[indices[0]!] = bucket[0]!.id;
  }

  return out;
}

export function splitIntoBlocks(html: string, previous?: Block[]): SplitResult {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  /*
   * Before anything reads this document, and before a single id is minted.
   *
   * This is the only gate between a stranger's HTML and the reading view: the
   * client renders `block.html` with dangerouslySetInnerHTML, and Readability
   * upstream is not a sanitiser and does not claim to be. Doing it here rather
   * than in the client means the stored blocks.json is clean, so every later
   * consumer inherits that instead of having to remember. See src/sanitize.ts
   * for what survives and docs/project/security.md for why.
   *
   * Order matters: sanitising first means ids are stamped onto elements that
   * are staying. Sanitising afterwards would mint ids for elements about to be
   * deleted, and the blocks array would list ids that the HTML no longer has.
   */
  sanitizeInPlace(doc.body);

  const elements = collectElements(doc.body);

  // Reserve every id already in the document, ours or the author's, so a minted
  // id can never collide with one.
  const taken = new Set<string>(
    Array.from(doc.querySelectorAll("[id]"), (el) => el.id).filter(Boolean),
  );

  // Prose text, for spotting pull-quotes that merely repeat it.
  const proseText = elements
    .filter((el) => el.tagName === "P" && !el.closest("figure, blockquote"))
    .map((el) => normalize(el.textContent ?? ""));

  let reused = 0;
  let carried = 0;
  let minted = 0;

  /* Content first, ids second. The matcher works over the whole document at
     once — whether a folded bucket is ambiguous cannot be answered until every
     claimant is known — so every candidate has to exist before any id is handed
     out. See carryOverIds. */
  const found = elements.map((el) => {
    const content = ownContent(el);
    return { el, content, text: extractText(content) };
  });

  // Three ways to get an id, in descending order of confidence: it is already
  // in the document; the previous run had a block with these words; or this is
  // genuinely new text.
  const ids: (string | undefined)[] = found.map(({ el }) => {
    const existing = el.getAttribute("id");
    if (!isSpideryarnId(existing)) return undefined;
    reused++;
    taken.add(existing!);
    return existing!;
  });

  const pending = ids.flatMap((id, i) => (id === undefined ? [i] : []));
  const recovered = carryOverIds(
    previous,
    pending.map((i) => ({ text: found[i]!.text, html: found[i]!.content.outerHTML })),
    taken,
  );
  pending.forEach((i, n) => {
    const id = recovered[n];
    if (id === undefined) minted++;
    else carried++;
    ids[i] = id ?? mintUniqueId(taken);
    found[i]!.el.setAttribute("id", ids[i]!);
  });

  const blocks: Block[] = found.map(({ el, content, text }, index) => {
    const id = ids[index]!;
    // `ownContent` may have cloned before the id existed; keep the stored html
    // in step with the document.
    if (content !== el) content.setAttribute("id", id);

    const { kind, level, gistable, note } = describeBlock(el, text, proseText);
    return {
      id,
      tag: el.tagName.toLowerCase(),
      kind,
      ...(level !== undefined ? { level } : {}),
      text,
      words: text.length ? text.split(/\s+/).length : 0,
      html: content.outerHTML,
      gistable,
      ...(note ? { note } : {}),
    };
  });

  return {
    blocks,
    html: dom.serialize(),
    stats: {
      total: blocks.length,
      reused,
      carried,
      minted,
      gistable: blocks.filter((b) => b.gistable).length,
    },
  };
}

// ---------------------------------------------------------------- CLI

/**
 * The CLI lives in a function rather than at the top level so this module has
 * no top-level `await`. With one, the module becomes an *async module* and any
 * CommonJS consumer gets ERR_REQUIRE_ASYNC_MODULE on import — which the isMain
 * guard does not prevent, since it is the syntax that matters, not whether the
 * branch runs. ESM importers are unaffected either way; this just keeps
 * splitIntoBlocks importable from anywhere.
 */
export interface BlocksRun extends SplitResult {
  htmlFile: string;
  jsonFile: string;
}

/**
 * Stage 3 over a file on disk: read, split, write both artefacts back.
 *
 * Exported because there are two callers and they must not drift — `main()`
 * below, and the ingest queue running the same stage in the server process
 * (src/pipeline.ts). Everything interesting is still in `splitIntoBlocks`,
 * which is pure; this is the IO around it.
 *
 * **Ids are carried over from the existing blocks.json, not re-minted.** That
 * is the whole reason a re-extraction is survivable — see
 * docs/project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters.
 */
export async function runBlocks(opts: {
  htmlFile: string;
  jsonFile?: string;
}): Promise<BlocksRun> {
  const htmlFile = opts.htmlFile;
  const jsonFile = opts.jsonFile ?? `${htmlFile.replace(/\.html$/, "")}.blocks.json`;

  // If a previous run's blocks.json is sitting there, use it to carry ids
  // across a re-extraction that wiped them from the HTML.
  let previous: Block[] | undefined;
  try {
    previous = JSON.parse(await readFile(jsonFile, "utf-8")).blocks as Block[];
  } catch {
    previous = undefined; // first run for this article
  }

  const source = await readFile(htmlFile, "utf-8");
  const result = splitIntoBlocks(source, previous);

  await writeFile(htmlFile, result.html, "utf-8");
  await writeFile(jsonFile, JSON.stringify({ blocks: result.blocks }, null, 2), "utf-8");

  return { ...result, htmlFile, jsonFile };
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: tsx src/blocks.ts <article.html> [blocks.json]");
    process.exit(1);
  }
  const argOut = process.argv[3];
  const { blocks, stats, jsonFile: outJson } = await runBlocks({
    htmlFile: input,
    ...(argOut ? { jsonFile: argOut } : {}),
  });

  const byKind = blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.kind] = (acc[b.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Blocks:    ${stats.total}  (${JSON.stringify(byKind)})`);
  console.log(
    `Ids:       ${stats.reused} reused, ${stats.carried} carried over, ${stats.minted} minted`,
  );
  console.log(`Gistable:  ${stats.gistable}  (${stats.total - stats.gistable} skipped)`);
  console.log(`\nHTML:      ${path.resolve(input)}`);
  console.log(`Blocks:    ${path.resolve(outJson)}`);
}

/* Compared as resolved paths, not by suffix. `import.meta.url.endsWith(basename)`
   also matches when a *different* entry file with the same basename imports this
   module — `scripts/arc.ts` importing `src/arc.ts` would run the CLI as a side
   effect of the import, which is the one thing this guard exists to prevent. */
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void main();
