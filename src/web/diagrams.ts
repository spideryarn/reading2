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
): DiagramLayout {
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
