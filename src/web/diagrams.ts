/**
 * **Which of the six to draw** — the router, and nothing else.
 *
 * It is its own file for one reason: [diagram.ts](./diagram.ts) owns the shared
 * vocabulary (`DiagramNode`, `wrapText`, `LABEL_PX`) and the three hand-rolled
 * tree pictures, and [diagram-d3.ts](./diagram-d3.ts) needs all of that to build
 * the three graph pictures. So D3 depends on the tree module, and a router
 * living in the tree module would depend back on D3 — **an import cycle, which
 * `npm run check` gates on** (docs/project/static-analysis.md). Two modules and
 * a third that knows about both is the shape that has no cycle in it.
 *
 * Everything else about the six lives in the two files this imports.
 */
import type { SummaryNode } from "./tree.js";
import {
  type DiagramKind,
  type DiagramLayout,
  type DiagramOptions,
  layoutMindmap,
  layoutStrata,
  layoutTree,
} from "./diagram.js";
import { hierarchyInput, layoutArc, layoutCluster, layoutForce } from "./diagram-d3.js";
import type { ArticleGraph } from "./graph.js";
import { layoutDrift, layoutTrail, type ScatterInput } from "./scatter.js";
import type { Block } from "../types.js";

/**
 * The one entry point the panel uses.
 *
 * The three D3 pictures need the **graph** rather than the tree, and it is
 * optional here rather than required: the graph needs the article's blocks, and
 * a caller holding only a tree should still get the three tree pictures rather
 * than an error. Asking for a graph picture without one falls back to `strata` —
 * the same "a link from a future version degrades to something real" rule
 * params.ts applies to every parameter it parses.
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
     on the other six. Putting it in the options would offer it to six layouts
     that must never look at it, and would make `DiagramOptions` mean two
     different things. Same reason `graph` is its own argument. */
  if (kind === "drift" || kind === "trail") {
    /* Without an answer yet, this falls back to `strata` — the same rule
       params.ts applies to a parameter from a future version: **degrade to
       something real rather than to nothing.** The panel's strip is what says
       the dots are still coming; a blank picture would say nothing at all. */
    if (!scatter || scatter.input.points.length === 0) return layoutStrata(root, opts);
    return kind === "drift"
      ? layoutDrift(root, scatter.blocks, opts, scatter.input)
      : layoutTrail(root, scatter.blocks, opts, scatter.input);
  }
  if (kind === "arc" || kind === "force" || kind === "cluster") {
    if (!graph) return layoutStrata(root, opts);
    if (kind === "arc") return layoutArc(graph, opts);
    if (kind === "force") return layoutForce(graph, opts);
    const input = hierarchyInput(graph);
    return input ? layoutCluster(graph, input, opts) : layoutStrata(root, opts);
  }
  if (kind === "strata") return layoutStrata(root, opts);
  if (kind === "mindmap") return layoutMindmap(root, opts);
  return layoutTree(root, opts);
}
