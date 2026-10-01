/**
 * **What a cross-references artefact was written from, and whether it still
 * is** — the pure half of src/crossrefs.ts, moved here on 2026-10-01 (plan
 * 261001b) so the public reader can ask the same question the owner's read
 * asks, by the same function. A visitor's prose must not draw a stale link any
 * more than the owner's does (Sol F8 on 260930f), and a second fingerprint
 * would be two answers to one question.
 *
 * No model call, no store: tests/public-imports.test.ts holds that. The
 * stage re-exports everything here, so its callers are unchanged.
 */
import { createHash } from "node:crypto";

import { articleWithIds } from "./article-prompt.js";
import {
  type BlockFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { partsOf } from "./tree-parts.js";
import type { Crossrefs, Meta, Tree } from "./types.js";

/** The hard ceiling on links, however long the article. */
export const MAX_LINKS = 60;

/**
 * The most links one article may carry: **`min(60, max(3, round(blocks / 4)))`**,
 * over the body blocks the model was shown. One link per four paragraphs is
 * already a lot of underlining; the cap is the first dial if it proves noisy
 * (the plan's § Assumptions).
 */
export function linkCap(blocks: number): number {
  return Math.min(MAX_LINKS, Math.max(3, Math.round(blocks / 4)));
}

/**
 * What this artefact was written from: the exact article and skeleton bytes the
 * model sees. `articleWithIdsFingerprint` is close, but deliberately hashes
 * every block and every tree node; this request omits supplements and renders
 * only `partsOf(tree)`. Hashing those hidden inputs would report a fresh paid
 * artefact stale (Sol F11).
 *
 * The stage instructions have their own `PROMPT_VERSION`; the model has its own
 * stamp field. This hash owns the two content-bearing request strings.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  /* `BlockFingerprint.treatment` is a database string rather than Block's
     narrower union; the CHECK behind it permits only the same values. */
  const evidence = blocks.filter((block) => block.treatment !== "supplement");
  const renderedMeta: Meta = meta
    ? ({
        title: meta.title ?? fallbackHeadTitle(tree),
        ...(meta.byline == null ? {} : { byline: meta.byline }),
        ...(meta.siteName == null ? {} : { siteName: meta.siteName }),
        ...(meta.url == null ? {} : { url: meta.url }),
      } as Meta)
    : ({ title: fallbackHeadTitle(tree) } as Meta);
  const request = [
    articleWithIds(renderedMeta, evidence),
    renderPrompt({ tree, cap: linkCap(evidence.length) }),
  ];
  return createHash("sha256")
    .update(`spya-crossrefs-input/1\n${JSON.stringify(request)}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** Does this artefact still describe the article, tree and metadata? */
export function isStale(
  crossrefs: Crossrefs,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return crossrefs.sourceHash !== inputFingerprint(blocks, tree, meta);
}

/** The user message: the cap, then the skeleton — which is why the tree is in the fingerprint. */
export function renderPrompt(opts: { tree: Tree; cap: number }): string {
  const skeleton = partsOf(opts.tree)
    .map((p, i) => `PART ${i + 1}: ${p.title}\n  ${p.gist ?? "(no gist)"}`)
    .join("\n\n");
  return `Link this article to itself: at most ${opts.cap} links. Fewer is fine, and none is fine.

=== ITS SHAPE ===

${skeleton}`;
}
