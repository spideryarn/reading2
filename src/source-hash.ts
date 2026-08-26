/**
 * A fingerprint of the article a generated artefact was written from.
 *
 * **Why this is its own module.** It began life inside src/tweets.ts, where it
 * answered the one question the original version of that feature could never
 * answer: does this thread still describe the article on disk? The glossary
 * needs exactly the same answer, and two stages computing "the same" hash two
 * ways is the second-copy-of-one-fact problem this repo keeps meeting — the two
 * can only ever disagree, and the day they do, one artefact quietly reports
 * itself current against a different definition of current.
 *
 * So it lives here, on its own, and both stages import it. src/tweets.ts
 * re-exports it so nothing that already imported it from there had to change.
 *
 * See docs/project/architecture.md#storage.
 */
import { createHash } from "node:crypto";
import type { Block, Tree } from "./types.js";

/**
 * The ids **and** the text, not the raw bytes of blocks.json.
 *
 * Bytes would change when a field we don't read is recomputed, and would not
 * change if two blocks swapped ids — this changes exactly when what a reader
 * would read changes, which is the only question it is asked.
 *
 * Sixteen hex characters. It is compared for equality, never for closeness, and
 * a full sha256 in every artefact buys nothing but width.
 *
 * **The parameter is the two fields it reads, not `Block`.** Every `Block[]`
 * still satisfies it, so nothing had to change; what it buys is that the
 * Postgres store can hash `select block_id, text from revision_blocks` without
 * inventing a second canonical form — which is the one thing this module exists
 * to prevent. src/store/pg-searches.ts is the caller that needed it.
 */
export function hashBlocks(blocks: readonly Pick<Block, "id" | "text">[]): string {
  const canonical = blocks.map((b) => `${b.id}\t${b.text}`).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

/**
 * A fingerprint of the **tree** — every node's id, parent, range, title and
 * gist.
 *
 * The companion to `hashBlocks`, and here for the identical reason: it began in
 * src/labels.ts (which re-exports it, so nothing that imported it from there
 * had to change) and a second stage now needs the same answer. Two modules
 * computing "the same" structure hash two ways can only ever disagree, and the
 * day they do, one artefact reports itself current against a different
 * definition of current.
 *
 * **Not `renderOutline`'s text.** The outline is titles and indentation, which
 * is the right thing to send a model and the wrong thing to compare two trees
 * by: two structures that cut the article in completely different places print
 * an identical outline. Walking the nodes means a boundary that moved changes
 * the hash even when every title stayed put. That correction was GPT-5.6-sol's,
 * 2026-08-26.
 *
 * **Why a second hash exists at all**, which is the thing to read before
 * ignoring it: `StepStamp` in src/store/artifacts.ts says the late stages
 * *"all read the tree as well as the blocks"*, and `inputHashFor` in
 * src/pipeline.ts hashes only the blocks. Section boundaries can move without a
 * single block changing, and a stage that judges what is load-bearing from the
 * skeleton is then answering a different question against an input it reports
 * as unchanged. `ideas` is the first stage to fold this in — see
 * docs/plans/ideas-mode.md § Freshness.
 */
export function structureHash(tree: Tree): string {
  const canonical = Object.keys(tree.nodes)
    .sort()
    .map((id) => {
      const n = tree.nodes[id]!;
      return [id, n.parent ?? "", n.range.join(".."), n.title ?? "", n.gist ?? ""].join("\u0000");
    })
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}
