/**
 * **Can the arc tell whether it is still about this article?** Until 2026-08-29 it could not.
 *
 * `arc.json` recorded `version`, `generator` and `slug` and nothing about its *input*, so
 * `stepIsDone` fell back to "the file exists" (src/pipeline.ts § `stepIsDone`) and the step
 * reported itself done for ever. What kept that from biting was position, not knowledge: `arc` sat
 * in `DEFAULT_INGEST_STEPS` directly behind `structure`, so `cascadeForce` swept it whenever an earlier
 * step was forced.
 *
 * Two things follow, and the second is why this file exists rather than being part of the deferral:
 *
 *  - `cascadeForce` only ever names steps **already in that job** (src/jobs.ts), so a forced
 *    `steps: ["structure"]` has never reached `arc`. **This bug is live today**, not one the deferral
 *    introduces — anybody who has refreshed just the table of contents has a silently truncated arc.
 *  - Taking `arc` out of the default steps makes that the ordinary refresh path rather than an edge
 *    case, so the check has to exist first.
 *
 * The damage is silent, which is the whole reason it needs a test rather than a comment.
 * `buildArcColumn` (src/web/tree.ts) joins arc entries to tree nodes by **exact block range**, and
 * an entry matching no node is dropped from the reading view with no error, no log and no gap —
 * `TableView` simply falls back to the root gist. See docs/reusable/silent-success.md.
 *
 * docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 2.1.
 */
import { describe, expect, it } from "vitest";
import { fitsTree, inputFingerprint, isStale, PROMPT_VERSION } from "../src/arc.js";
import { CAPABLE_MODEL, HIGH_POWER_MODEL } from "../src/models.js";
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

  it("is false for an arc the high-power model wrote — switching back re-runs nothing", () => {
    /* docs/plans/260930f-high-powered-ai-per-article.md decision 6: Sonnet and
       Opus are one generation for freshness, in both directions. */
    expect(isStale({ ...arc(), generator: HIGH_POWER_MODEL }, BLOCKS, tree(), META)).toBe(false);
  });
});

/**
 * **Does the arc still fit the tree it is drawn against?** — the check
 * `loadArticle` makes before it embeds an arc in the article payload (plan
 * 261029l, GPT Sol's finding 1). Embedded, `useArc` trusts it and never asks
 * `/api/arc`, so a tree re-cut by a Structure re-run left the arc truncated for
 * good. Left out, the owner's `useArc` reads the route, finds it stale and
 * makes it again. Structural on purpose: the same rule `buildArcColumn` uses to
 * drop a sentence, and nothing about prompt versions, which would quietly
 * re-buy every arc on the shelf the day the prompt changes.
 */
describe("fitsTree", () => {
  it("is true when every sentence matches a part", () => {
    expect(fitsTree(arc(), tree())).toBe(true);
  });

  it("is false when the parts have been re-cut beneath it", () => {
    const recut = tree([
      node({ id: "n1", range: ["spya-aaaaaa", "spya-bbbbbb"] }),
      node({ id: "n2", range: ["spya-cccccc", "spya-cccccc"] }),
    ]);
    expect(fitsTree(arc(), recut)).toBe(false);
  });

  it("is false when every old sentence still lands but the tree has gained a part", () => {
    /* The one-way `entries.every(partRanges.has)` check this test replaced
       called this fit: the old sentence still matched `n1`, while `n2` had no
       sentence at all. `buildArcColumn` then drew an honest-looking empty cell
       and `useArc` trusted the payload for ever. Fit is a bijection, not a
       subset test. Plan 261029l code review. */
    const expanded = tree([
      node({ id: "n1", range: ["spya-aaaaaa", "spya-bbbbbb"] }),
      node({ id: "n2", range: ["spya-cccccc", "spya-cccccc"] }),
    ]);
    const partial = arc({
      entries: [{ range: ["spya-aaaaaa", "spya-bbbbbb"], text: "One." }],
    });
    expect(fitsTree(partial, expanded)).toBe(false);
  });

  it("is false when two sentences claim the same part", () => {
    const duplicate = arc({
      entries: [
        { range: ["spya-aaaaaa", "spya-cccccc"], text: "One." },
        { range: ["spya-aaaaaa", "spya-cccccc"], text: "Two." },
      ],
    });
    expect(fitsTree(duplicate, tree())).toBe(false);
  });

  it("does not count a depth-one supplement as an argument part", () => {
    const withNotes = tree([
      node({ id: "n1", range: ["spya-aaaaaa", "spya-bbbbbb"] }),
      node({
        id: "n-notes",
        range: ["spya-cccccc", "spya-cccccc"],
        title: "Notes",
        treatment: "supplement",
      }),
    ]);
    const complete = arc({
      entries: [{ range: ["spya-aaaaaa", "spya-bbbbbb"], text: "One." }],
    });
    expect(fitsTree(complete, withNotes)).toBe(true);
  });

  it("accepts the only complete arc for a tree with no parts", () => {
    const none = tree([]);
    expect(fitsTree(arc({ entries: [] }), none)).toBe(true);
    expect(fitsTree(arc(), none)).toBe(false);
  });

  /** One part, `n1`, divided into the sub-sections given. */
  function deeperTree(subs: TreeNode[]): Tree {
    const t = tree([node({ id: "n1", children: subs.map((s) => s.id) })]);
    for (const s of subs) t.nodes[s.id] = s;
    return t;
  }

  it("is true when only a part's insides changed — Structure going one level deeper", () => {
    const deeper = deeperTree([
      node({ id: "n2", depth: 2, parent: "n1", range: ["spya-aaaaaa", "spya-bbbbbb"] }),
      node({ id: "n3", depth: 2, parent: "n1", range: ["spya-cccccc", "spya-cccccc"] }),
    ]);
    expect(fitsTree(arc(), deeper)).toBe(true);
  });

  it("does not count a sub-section's range as a part", () => {
    const deeper = deeperTree([
      node({ id: "n2", depth: 2, parent: "n1", range: ["spya-aaaaaa", "spya-bbbbbb"] }),
    ]);
    const onTheSubSection = arc({ entries: [{ range: ["spya-aaaaaa", "spya-bbbbbb"], text: "One." }] });
    expect(fitsTree(onTheSubSection, deeper)).toBe(false);
  });
});
