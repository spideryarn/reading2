/**
 * **Which of the three to draw** — the router, and nothing else.
 *
 * It is its own file for one reason: [diagram.ts](./diagram.ts) owns the shared
 * vocabulary (`DiagramNode`, `wrapText`, `LABEL_PX`), and
 * [diagram-d3.ts](./diagram-d3.ts) and [scatter.ts](./scatter.ts) both need all
 * of that to build theirs. So they depend on the vocabulary module, and a
 * router living in that module would depend back on them — **an import cycle,
 * which `npm run check` gates on** (docs/project/static-analysis.md). Two
 * modules and a third that knows about both is the shape that has no cycle in
 * it.
 *
 * Everything else about the three lives in the files this imports.
 */
import type { SummaryNode } from "./tree.js";
import type { DiagramKind, DiagramLayout, DiagramOptions } from "./diagram.js";
import { layoutForce } from "./diagram-d3.js";
import type { ArticleGraph } from "./graph.js";
import { layoutDrift, layoutTrail, type ScatterInput } from "./scatter.js";
import type { Block } from "../types.js";

/**
 * The one entry point the panel uses. **`null` means "this picture's data is
 * not here yet"**, and the panel draws a spinner or an error in its place.
 *
 * ## It used to fall back to a picture, and that was the wrong answer
 *
 * Until 2026-08-30 a picture with no data got `layoutTree` — the outline, which
 * was free — on the reasoning that *a picture of something real with a line of
 * explanation beats a spinner over an empty box*. Two things were wrong with
 * it. The Tree is gone, cut for overlapping the outline and hierarchy views
 * that already exist. And a mode that answers a question you did not ask, while
 * a strip above it explains in small type that this is not the picture you
 * pressed, is a worse failure than an honest wait — it was also the source of a
 * whole class of bug on its own, because every branch in the panel then had to
 * remember that `kind` and what is on screen are different things, and twice it
 * did not.
 *
 * Greg, 2026-08-30:
 *
 * > if while loading and/or if there's an error with one of the others (e.g.
 * > with semantic embeddings), it falls back to Tree - instead, just show a
 * > loading spinner or error.
 *
 * So: no picture stands in for another. Force is the exception that proves it —
 * it needs no fetch to draw, because four of its five kinds of line are
 * arithmetic over prose the browser already holds, and the model's opinion only
 * adds the fifth.
 */
export function layoutDiagram(
  kind: DiagramKind,
  root: SummaryNode,
  opts: DiagramOptions,
  graph?: ArticleGraph | null,
  scatter?: { blocks: readonly Block[]; input: ScatterInput } | null,
): DiagramLayout | null {
  /* **The two scatters take a fifth argument rather than a fatter
     `DiagramOptions`**, and it is worth saying why: what they need is not a
     *setting*, it is a whole second data source — the server's projection of
     the article, which arrives after the toggle is pressed and is absent on
     Force. Putting it in the options would offer it to a layout that must never
     look at it, and would make `DiagramOptions` mean two different things. Same
     reason `graph` is its own argument. */
  if (kind === "drift" || kind === "trail") {
    if (!scatter || scatter.input.points.length === 0) return null;
    return kind === "drift"
      ? layoutDrift(root, scatter.blocks, opts, scatter.input)
      : layoutTrail(root, scatter.blocks, opts, scatter.input);
  }
  /* The graph is built in the browser from blocks the page already has, so in
     the app this is null only when there is no usable tree — which the panel
     has already said out loud in words. It is still a null rather than a throw,
     because a caller holding only a tree should get a wait rather than a crash. */
  return graph ? layoutForce(graph, opts) : null;
}
