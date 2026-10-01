/**
 * **The parts of the argument** — moved here from src/arc.ts on 2026-10-01 so
 * that a module with no model call in it can ask (plan 261001b): the public
 * reader computes cross-references' staleness, and that hashes the skeleton
 * `partsOf` defines. src/arc.ts re-exports it, so every stage's import is
 * unchanged.
 */
import { stageFailure } from "./job-failure.js";
import { isSupplementNode } from "./supplement.js";
import type { Tree, TreeNode } from "./types.js";

/**
 * The parts — depth-1 nodes in document order, per the tree's own child list.
 *
 * **A supplement is not a part.** The apparatus is a depth-one child of the
 * root like every part is (src/supplement.ts), and excluding it here is what
 * keeps four separate things right at once, because this one function is where
 * "the parts of the argument" is defined:
 *
 *  - `buildArc` **throws** on a parts/sentences length mismatch, so a
 *    supplement counted as a part would fail the arc stage outright on every
 *    article with endnotes — the loud failure, and the one that made this
 *    obvious;
 *  - `renderPrompt` below, and the skeletons in src/glossary.ts, src/ideas.ts
 *    and src/tweets.ts, would each show a model a part called "Notes" with no
 *    gist and invite it to write about the bibliography;
 *  - the step marker would read "3 / 9" where the argument has seven parts,
 *    which is the one place the structure states a count out loud.
 *
 * The client's own numbering is a separate copy of this rule and cannot import
 * it — `buildArcColumn` in src/web/tree.ts numbers the cells it is drawing, not
 * the tree — so both are held by tests.
 */
export function partsOf(tree: Tree): TreeNode[] {
  const root = tree.nodes[tree.rootId];
  /* `bug`, so the job card does not offer a Retry that cannot work. The tree
     comes off disk from a `hierarchy` step that already finished, and Retry skips
     every step that finished — so a second attempt reads the identical
     tree.json and fails in the same line. A tree that names a root it does not
     contain is stage 4 having written something malformed, which is a defect
     here rather than anything the reader can act on. src/job-failure.ts. */
  if (!root) {
    throw stageFailure("bug", { generic: `rootId "${tree.rootId}" is not in nodes` });
  }
  return root.children
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n && !isSupplementNode(n));
}
