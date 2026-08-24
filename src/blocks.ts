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
import { isSpideryarnId, mintUniqueId } from "./ids.js";

/**
 * Blocks are the *finest* unit a reader takes in as one thing, so a `<li>` is a
 * block and the `<ul>` around it is not. Containers become nodes in the tree
 * instead, which is what lets the ToC choose its own granularity: one row for a
 * list of terse bullets, one row per item for a list of real arguments.
 * See docs/project/table-of-contents.md#granularity.
 */
const LEAF_BLOCKS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "PRE", "BLOCKQUOTE", "FIGURE", "TABLE", "IMG", "HR",
]);

/** Descended into, never emitted. */
const CONTAINERS = new Set([
  "DIV", "SECTION", "ARTICLE", "MAIN", "UL", "OL", "DL",
  "HEADER", "FOOTER", "ASIDE", "NAV", "BODY",
]);

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "FORM", "BUTTON"]);

export type BlockKind =
  | "heading" | "text" | "quote" | "code" | "media" | "caption" | "other";

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

export interface Block {
  id: string;
  tag: string;
  kind: BlockKind;
  /** Depth 1–6 for headings, else undefined. Real headings only. */
  level?: number;
  text: string;
  words: number;
  html: string;
  /**
   * False for anything the ToC must not write a row about: images, rules, and
   * pull-quotes that repeat body text verbatim. These still get ids — the ToC
   * may want to *point* at a diagram — they just carry no gist.
   */
  gistable: boolean;
  /** Why gistable is false, for debugging the splitter. */
  note?: string;
}

const normalize = (s: string) =>
  s.replace(/\s+/g, " ").replace(/[^a-z0-9 ]/gi, "").toLowerCase().trim();

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
  if (tag === "FIGURE" || tag === "IMG" || tag === "HR") return { kind: "media" };
  if (tag === "TABLE") return { kind: "other" };
  return { kind: "text" };
}

/** A `<p>` whose only real content is an image is a media block, not prose. */
function isImageOnly(el: Element): boolean {
  return (
    el.querySelector("img") !== null && normalize(el.textContent ?? "").length === 0
  );
}

function collectElements(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
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
      else if (normalize(child.textContent ?? "").length > 0) out.push(child);
    }
  };
  walk(root);
  return out;
}

export interface SplitResult {
  blocks: Block[];
  html: string;
  stats: { total: number; reused: number; minted: number; gistable: number };
}

export function splitIntoBlocks(html: string): SplitResult {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

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
  let minted = 0;

  const blocks: Block[] = elements.map((el) => {
    let id = el.getAttribute("id");
    if (isSpideryarnId(id)) {
      reused++;
    } else {
      id = mintUniqueId(taken);
      minted++;
      el.setAttribute("id", id);
    }

    const content = ownContent(el);
    const text = extractText(content);
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

    return {
      id: id!,
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
async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: tsx src/blocks.ts <article.html> [blocks.json]");
    process.exit(1);
  }
  const outJson = process.argv[3] ?? input.replace(/\.html$/, "") + ".blocks.json";

  const source = await readFile(input, "utf-8");
  const { blocks, html, stats } = splitIntoBlocks(source);

  await writeFile(input, html, "utf-8");
  await writeFile(outJson, JSON.stringify({ blocks }, null, 2), "utf-8");

  const byKind = blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.kind] = (acc[b.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Blocks:    ${stats.total}  (${JSON.stringify(byKind)})`);
  console.log(`Ids:       ${stats.reused} reused, ${stats.minted} minted`);
  console.log(`Gistable:  ${stats.gistable}  (${stats.total - stats.gistable} skipped)`);
  console.log(`\nHTML:      ${path.resolve(input)}`);
  console.log(`Blocks:    ${path.resolve(outJson)}`);
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) void main();
