/**
 * **Whether a stored `matter` value is about the blocks on screen** — the half
 * of the `matter` step that a read needs, and nothing that makes a call.
 *
 * A leaf, so that both article reads may import it: the owner's
 * (src/store/pg.ts § `loadArticle`) and a visitor's
 * (src/store/public-reader.ts § `loadArticle`), which must not reach the model
 * gateway that src/matter.ts and src/matter-step.ts import
 * (tests/public-imports.test.ts). The two reads hand the same check the same
 * sanitised blocks, so an owner and a visitor fold the same stretches.
 * docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md,
 * docs/plans/261018l-visitors-on-a-shared-link-get-the-front-and-back-matter-folds.md.
 */
import { createHash } from "node:crypto";

import { isMatterDocument } from "./matter-shape.js";
import type { BlockId, MatterStretchStored } from "./types.js";

/**
 * **The step's version**, stamped into the artefact and the run row. Bump it
 * when `MATTER_SYSTEM`, the request, the checks in src/matter.ts, the labels
 * rule or `MATTER_MODEL` change what would be stored, so every stored value
 * reads as outdated. **The model is in this version rather than in the stamp**,
 * because a stored value's `generator` names its sources — `labels+<model>`,
 * or `labels` alone after a failed call — not one model, and a stamp that
 * declared a model would clash with the second on every write.
 *
 * Here, in a leaf, rather than beside the prompt in src/matter.ts, because
 * `matterForReader` below reads it and the public article read
 * (src/store/public-reader.ts) calls that: src/matter.ts imports the model
 * gateway, which the public import graph may not reach
 * (tests/public-imports.test.ts). Plan 261018l.
 */
export const MATTER_PROMPT_VERSION = "matter/4";

/**
 * **The versions a read still folds.** Not the same thing as the version above,
 * which decides whether the step runs again: keep an older version here only
 * while every fold it admitted remains sound under today's rule. Withdrawing
 * sound folds until each article is re-read would take them off the shelf for
 * nothing; a change that invalidates an old admission must drop that version.
 *
 * - `matter/3` (plan 261024h) added the linked contents run to the labels rule;
 *   it did not weaken the evidence or admission of any stretch `matter/2`
 *   stored, so those older folds remain safe to show.
 * - `matter/4` (plan 261025f) added the front summary to the labels rule, and
 *   the `summary` kind; the same holds for what `matter/3` stored.
 */
export const MATTER_READABLE_VERSIONS: ReadonlySet<string> = new Set([MATTER_PROMPT_VERSION, "matter/3", "matter/2"]);

/** As much of a block as the pass reads. Every `Block` satisfies it. */
export interface MatterBlock {
  id: BlockId;
  kind: string;
  level?: number | null | undefined;
  text: string;
  words: number;
  /** The labels rule reads in-page links from the sanitised stored markup. */
  html: string;
  /** Stage 3's role: a `footnote` is the article's own note and is never folded as matter. */
  role?: string | null | undefined;
}

/** Prefixes the version of everything `matterInputHash` reads; bump it when that changes. */
export const MATTER_HASH_VERSION = "m3";

// ───────────────────────────────────────────────────────────────── the hash

/**
 * Anchor targets in stage 3's canonical, sanitised `Block.html`: lower-case
 * names and double-quoted attributes. Quote-aware before `href`, so an earlier
 * author's attribute may contain `>` without ending the tag; restricted to
 * `<a>` so an SVG image's `href` is not evidence of navigation.
 */
const IN_PAGE_HREF = /<a\b(?:[^">]|"[^"]*")*?\shref="#([^"]+)"/gu;

/** The one interpretation shared by the labels rule and its freshness hash. */
export function inPageHrefs(html: string): string[] {
  return [...html.matchAll(IN_PAGE_HREF)].map((match) => match[1]!);
}

/** Whether stage 3 stored the block as a list item; a front summary that is a list ends at its last one (src/matter.ts § `summaryAt`). */
export function isListItem(block: Pick<MatterBlock, "html">): boolean {
  return /^<li\b/u.test(block.html);
}

/**
 * **What the pass reads, fingerprinted** (plan review F1): ordered `[id, text,
 * kind, level, words, inPageHrefs(html), role, isListItem]`. The interpreted
 * href targets joined in matter/3 because the linked-contents rule reads them,
 * and the list-item bit in matter/4 because a front summary's extent does;
 * without each, a re-extraction could change it while a carried fold still
 * passed the reader's freshness check. The rest of `html` is deliberately
 * absent: emphasis and other markup do not affect the pass. JSON over
 * fixed-position arrays, for `hashBlocks`' reason: no delimiter a page could
 * contain.
 */
export function matterInputHash(blocks: readonly MatterBlock[]): string {
  const canon = JSON.stringify(
    blocks.map((b) => [b.id, b.text, b.kind, b.level ?? null, b.words, inPageHrefs(b.html), b.role ?? null, isListItem(b)]),
  );
  return `${MATTER_HASH_VERSION}:${createHash("sha256").update(canon).digest("hex").slice(0, 16)}`;
}

/** The matter/3 fingerprint, kept only while that stored version remains readable. */
function matter3InputHash(blocks: readonly MatterBlock[]): string {
  const canon = JSON.stringify(blocks.map((b) => [b.id, b.text, b.kind, b.level ?? null, b.words, inPageHrefs(b.html), b.role ?? null]));
  return `m2:${createHash("sha256").update(canon).digest("hex").slice(0, 16)}`;
}

/** The matter/2 fingerprint, kept only while that stored version remains readable. */
function matter2InputHash(blocks: readonly MatterBlock[]): string {
  const canon = JSON.stringify(blocks.map((b) => [b.id, b.text, b.kind, b.level ?? null, b.words, b.role ?? null]));
  return `m1:${createHash("sha256").update(canon).digest("hex").slice(0, 16)}`;
}

/**
 * **The stretches the reading view may fold, or `undefined` for *use today's
 * rule*.** Every one of these, or nothing (review F2):
 *
 * 1. the stored shape is valid and its status is `ok`;
 * 2. its version is one a read still folds (`MATTER_READABLE_VERSIONS`);
 * 3. `sourceHash` equals `matterInputHash` of the blocks on this payload —
 *    so a column a draft carried over changed blocks, or a value copied from
 *    another revision, is withheld;
 * 4. every id is a block here;
 * 5. each `from` is at or before its `to` **by index** (block-ids.md § The
 *    cost we accepted), and the stretches are in document order and do not
 *    overlap.
 *
 * 3 implies 4 and 5 for a value this step wrote; they are checked anyway,
 * because the column is a document anybody with a SQL prompt can write.
 */
export function matterForReader(value: unknown, blocks: readonly MatterBlock[]): MatterStretchStored[] | undefined {
  if (!isMatterDocument(value) || value.status !== "ok") return undefined;
  if (!MATTER_READABLE_VERSIONS.has(value.version)) return undefined;
  const sourceHash =
    value.version === "matter/2" ? matter2InputHash(blocks) : value.version === "matter/3" ? matter3InputHash(blocks) : matterInputHash(blocks);
  if (value.sourceHash !== sourceHash) return undefined;
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  let last = -1;
  for (const s of value.stretches) {
    const a = index.get(s.from);
    const b = index.get(s.to);
    if (a === undefined || b === undefined || a > b || a <= last) return undefined;
    last = b;
  }
  return value.stretches.map((s) => ({ from: s.from, to: s.to, kinds: [...s.kinds] }));
}
