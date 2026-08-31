/**
 * **Can the arc tell whether it is still about this article?** Until 2026-08-29 it could not.
 *
 * `arc.json` recorded `version`, `generator` and `slug` and nothing about its *input*, so
 * `stepIsDone` fell back to "the file exists" (src/pipeline.ts § `stepIsDone`) and the step
 * reported itself done for ever. What kept that from biting was position, not knowledge: `arc` sat
 * in `DEFAULT_INGEST_STEPS` directly behind `toc`, so `cascadeForce` swept it whenever an earlier
 * step was forced.
 *
 * Two things follow, and the second is why this file exists rather than being part of the deferral:
 *
 *  - `cascadeForce` only ever names steps **already in that job** (src/jobs.ts), so a forced
 *    `steps: ["toc"]` has never reached `arc`. **This bug is live today**, not one the deferral
 *    introduces — anybody who has refreshed just the table of contents has a silently truncated arc.
 *  - Taking `arc` out of the default steps makes that the ordinary refresh path rather than an edge
 *    case, so the check has to exist first.
 *
 * The damage is silent, which is the whole reason it needs a test rather than a comment.
 * `buildArcColumn` (src/web/tree.ts) joins arc entries to tree nodes by **exact block range**, and
 * an entry matching no node is dropped from the reading view with no error, no log and no gap —
 * `TableView` simply falls back to the root gist. See docs/reusable/silent-success.md.
 *
 * docs/plans/defer-arc-and-rename-hierarchy.md § 2.1.
 */
import { describe, expect, it } from "vitest";
import { inputFingerprint, isStale, PROMPT_VERSION } from "../src/arc.js";
import { CAPABLE_MODEL } from "../src/models.js";
import type { Arc, Block, Meta, Tree, TreeNode } from "../src/types.js";

function block(id: string, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
  };
}

const BLOCKS: Block[] = [
  block("spya-aaaaaa", "Writing is thinking, and there is no way round that."),
  block("spya-bbbbbb", "Most people never had to write anything at all."),
  block("spya-cccccc", "So the pressure to learn it simply went away."),
];

function node(over: Partial<TreeNode> & { id: string }): TreeNode {
  return {
    depth: 1,
    parent: "n0",
    children: [],
    range: ["spya-aaaaaa", "spya-cccccc"],
    title: "A part",
    ...over,
  } as TreeNode;
}

function tree(parts: TreeNode[] = [node({ id: "n1", title: "All of it", gist: "A gist." })]): Tree {
  return {
    version: "toc/1",
    generator: "test",
    slug: "test",
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: parts.map((p) => p.id),
        range: ["spya-aaaaaa", "spya-cccccc"],
        title: "The whole thing",
      },
      ...Object.fromEntries(parts.map((p) => [p.id, p])),
    },
  } as Tree;
}

const META: Meta = { slug: "test", title: "Writing is thinking", byline: "A Writer", siteName: "Somewhere" };

function arc(over: Partial<Arc> = {}): Arc {
  return {
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: "test",
    sourceHash: inputFingerprint(BLOCKS, tree(), META),
    entries: [{ range: ["spya-aaaaaa", "spya-cccccc"], text: "One sentence." }],
    ...over,
  };
}

describe("inputFingerprint", () => {
  it("is stable for the same inputs", () => {
    expect(inputFingerprint(BLOCKS, tree(), META)).toBe(inputFingerprint(BLOCKS, tree(), META));
  });

  it("changes when a block changes", () => {
    const moved = [...BLOCKS.slice(0, 2), block("spya-cccccc", "Different words entirely.")];
    expect(inputFingerprint(BLOCKS, tree(), META)).not.toBe(inputFingerprint(moved, tree(), META));
  });

  it("changes when the tree is re-cut, though every block is identical", () => {
    /* The hazard the whole check exists for: section boundaries move, the arc's
       ranges no longer match any node, and buildArcColumn drops every entry
       without a word. A blocks-only hash reports no change at all. */
    const recut = tree([
      node({ id: "n1", title: "First half", gist: "A gist.", range: ["spya-aaaaaa", "spya-bbbbbb"] }),
      node({ id: "n2", title: "Second half", gist: "Another.", range: ["spya-cccccc", "spya-cccccc"] }),
    ]);
    expect(inputFingerprint(BLOCKS, tree(), META)).not.toBe(inputFingerprint(BLOCKS, recut, META));
  });

  it("changes when a gist is reworded and the ranges are untouched", () => {
    /* GPT Sol's finding 3, 2026-08-29: the arc prompt is built from the tree's
       titles and gists (src/arc.ts § renderParts), so identical ranges with
       different wording is a different question, not a stale-looking same one.
       `structureHash` already covers title and gist — this pins that it does. */
    const reworded = tree([node({ id: "n1", title: "All of it", gist: "A different gist." })]);
    expect(inputFingerprint(BLOCKS, tree(), META)).not.toBe(
      inputFingerprint(BLOCKS, reworded, META),
    );
  });

  it("changes when only the TITLE changes — blocks and tree byte-identical", () => {
    /* The one a blocks+tree fingerprint would miss, and it is reachable: the
       extracted title is stage 2's own reading of the page and moves whenever
       the page is re-extracted. **Not** the reader's own rename, which this
       comment used to cite — that is a shelf override (src/shelf.ts,
       `articles.title_override`) and no generator reads it. `generateArc` reads
       meta.json and `articleText` puts `TITLE:` at the head of the prompt
       (src/article-prompt.ts), so a changed extracted title genuinely changes
       what the model was asked. GPT Sol, 2026-08-31. */
    const renamed: Meta = { ...META, title: "Nobody had to write" };
    expect(inputFingerprint(BLOCKS, tree(), META)).not.toBe(
      inputFingerprint(BLOCKS, tree(), renamed),
    );
  });

  it("changes when only the byline or the site name changes", () => {
    expect(inputFingerprint(BLOCKS, tree(), META)).not.toBe(
      inputFingerprint(BLOCKS, tree(), { ...META, byline: "Someone Else" }),
    );
    expect(inputFingerprint(BLOCKS, tree(), META)).not.toBe(
      inputFingerprint(BLOCKS, tree(), { ...META, siteName: "Elsewhere" }),
    );
  });

  it("ignores metadata the prompt never sees", () => {
    /* `articleText` reads title, byline and siteName and nothing else. Folding
       in `fetchedAt` would mark every arc stale on every re-fetch of an
       unchanged page — a paid re-run bought for nothing.

       **A named `Meta`, not an object literal**, and that is the point rather
       than a workaround. Since the parameter narrowed to `MetaFingerprint`
       (src/source-hash.ts) a *literal* carrying `fetchedAt` no longer compiles
       at all, which is the stronger guard; a whole `Meta` still goes in, and
       this asserts that the extra fields on it change nothing. */
    const noisy: Meta = { ...META, fetchedAt: "2026-08-29T00:00:00Z", excerpt: "x" };
    expect(inputFingerprint(BLOCKS, tree(), META)).toBe(inputFingerprint(BLOCKS, tree(), noisy));
  });

  it("treats a missing meta.json as its own input, not as a crash", () => {
    /* generateArc tolerates an absent meta.json on purpose, so the fingerprint
       has to as well — and an article that gains one has changed. */
    expect(() => inputFingerprint(BLOCKS, tree(), null)).not.toThrow();
    expect(inputFingerprint(BLOCKS, tree(), null)).not.toBe(
      inputFingerprint(BLOCKS, tree(), META),
    );
  });
});

describe("isStale", () => {
  it("is false for an arc written from these very inputs", () => {
    expect(isStale(arc(), BLOCKS, tree(), META)).toBe(false);
  });

  it("is true when the tree has been re-cut beneath it", () => {
    const recut = tree([
      node({ id: "n1", title: "First half", gist: "A gist.", range: ["spya-aaaaaa", "spya-bbbbbb"] }),
      node({ id: "n2", title: "Second half", gist: "Another.", range: ["spya-cccccc", "spya-cccccc"] }),
    ]);
    expect(isStale(arc(), BLOCKS, recut, META)).toBe(true);
  });

  it("is true for a legacy arc that carries no sourceHash at all", () => {
    /* Every arc.json on disk predates this field. They must read as stale
       rather than as current, because "no hash" is exactly the state we cannot
       vouch for — and reading absent as current is how the old bug survived. */
    const legacy = { ...arc(), sourceHash: undefined } as unknown as Arc;
    expect(isStale(legacy, BLOCKS, tree(), META)).toBe(true);
  });

  it("is true when the prompt version moves", () => {
    expect(isStale({ ...arc(), version: "arc/1" }, BLOCKS, tree(), META)).toBe(true);
  });

  it("is true when a different model wrote it", () => {
    expect(isStale({ ...arc(), generator: "some/other-model" }, BLOCKS, tree(), META)).toBe(true);
  });
});
