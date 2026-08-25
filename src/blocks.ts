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
  if (tag === "FIGURE" || tag === "IMG" || tag === "HR" || tag === "IFRAME") {
    return { kind: "media" };
  }
  if (tag === "TABLE") return { kind: "other" };
  return { kind: "text" };
}

/** A `<p>` whose only real content is an image is a media block, not prose. */
function isImageOnly(el: Element): boolean {
  return (
    el.querySelector("img") !== null && normalize(el.textContent ?? "").length === 0
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
    if (normalize(node.nodeValue ?? "").length === 0) continue;
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
      else if (normalize(child.textContent ?? "").length > 0) out.push(child);
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
function matchKey(text: string, html: string): string | null {
  const words = normalize(text);
  if (words) return `t:${words}`;
  // Images and rules carry no text, so match them on what they point at —
  // otherwise every figure is re-minted on each re-extraction and any ToC row
  // aimed at a diagram goes stale.
  const src = /\bsrc="([^"]+)"/.exec(html)?.[1];
  return src ? `s:${src}` : null;
}

function carryOverIds(previous: Block[] | undefined) {
  const byKey = new Map<string, string[]>();
  for (const b of previous ?? []) {
    const key = matchKey(b.text, b.html);
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(b.id);
    else byKey.set(key, [b.id]);
  }
  return (text: string, html: string): string | undefined => {
    const key = matchKey(text, html);
    return key ? byKey.get(key)?.shift() : undefined;
  };
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
  const recoverId = carryOverIds(previous);

  const blocks: Block[] = elements.map((el) => {
    const content = ownContent(el);
    const text = extractText(content);

    // Three ways to get an id, in descending order of confidence: it is already
    // in the document; the previous run had a block with these exact words; or
    // this is genuinely new text.
    let id = el.getAttribute("id");
    if (isSpideryarnId(id)) {
      reused++;
      taken.add(id!);
    } else {
      const recovered = recoverId(text, content.outerHTML);
      if (recovered && !taken.has(recovered)) {
        id = recovered;
        carried++;
        taken.add(id);
      } else {
        id = mintUniqueId(taken);
        minted++;
      }
      el.setAttribute("id", id);
    }
    // `ownContent` may have cloned before the id existed; keep the stored html
    // in step with the document.
    if (content !== el) content.setAttribute("id", id!);

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
