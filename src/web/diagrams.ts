/**
 * **Which of the four to draw** — the router, and nothing else.
 *
 * It is its own file for one reason: [diagram.ts](./diagram.ts) owns the shared
 * vocabulary (`DiagramNode`, `wrapText`, `LABEL_PX`) and the one hand-rolled
 * tree picture, and [diagram-d3.ts](./diagram-d3.ts) and
 * [scatter.ts](./scatter.ts) both need all of that to build theirs. So they
 * depend on the tree module, and a router living in the tree module would
 * depend back on them — **an import cycle, which `npm run check` gates on**
 * (docs/project/static-analysis.md). Two modules and a third that knows about
 * both is the shape that has no cycle in it.
 *
 * Everything else about the four lives in the files this imports.
 */
import type { SummaryNode } from "./tree.js";
import { type DiagramKind, type DiagramLayout, type DiagramOptions, layoutTree } from "./diagram.js";
import { layoutForce } from "./diagram-d3.js";
import type { ArticleGraph } from "./graph.js";
import { layoutDrift, layoutTrail, type ScatterInput } from "./scatter.js";
import type { Block } from "../types.js";

/**
 * The one entry point the panel uses.
 *
 * Force needs the **graph** rather than the tree, and it is optional here
 * rather than required: the graph needs the article's blocks, and a caller
 * holding only a tree should still get a picture rather than an error. Asking
 * for it without one falls back to `tree` — the same "a link from a future
 * version degrades to something real" rule params.ts applies to every parameter
 * it parses.
 *
 * **The fallback used to be `strata`**, which was the right choice while it
 * existed: it was the cheapest picture and the only one whose vertical axis was
 * the article, so a reader waiting for embeddings still got something that
 * followed them down the page. `tree` follows the reader too — it marks the
 * node you are standing in — it just cannot draw the line across.
 */
export function layoutDiagram(
  kind: DiagramKind,
  root: SummaryNode,
  opts: DiagramOptions,
  graph?: ArticleGraph | null,
  scatter?: { blocks: readonly Block[]; input: ScatterInput } | null,
): DiagramLayout {
  /* **The two scatters take a fifth argument rather than a fatter
     `DiagramOptions`**, and it is worth saying why: what they need is not a
     *setting*, it is a whole second data source — the server's projection of
     the article, which arrives after the picture is first drawn and is absent
     on the other two. Putting it in the options would offer it to layouts that
     must never look at it, and would make `DiagramOptions` mean two different
     things. Same reason `graph` is its own argument. */
  if (kind === "drift" || kind === "trail") {
    /* Without an answer yet, this falls back to `tree` — the same rule
       params.ts applies to a parameter from a future version: **degrade to
       something real rather than to nothing.** The panel's strip is what says
       the dots are still coming; a blank picture would say nothing at all. */
    if (!scatter || scatter.input.points.length === 0) return layoutTree(root, opts);
    return kind === "drift"
      ? layoutDrift(root, scatter.blocks, opts, scatter.input)
      : layoutTrail(root, scatter.blocks, opts, scatter.input);
  }
  if (kind === "force") return graph ? layoutForce(graph, opts) : layoutTree(root, opts);
  return layoutTree(root, opts);
}
