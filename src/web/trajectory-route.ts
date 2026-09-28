/**
 * **The arithmetic of walking a Trajectory** — which stops a depth shows, where
 * a step goes, where a change of depth lands, and what the door in the prose
 * offers. Pure, and pinned in tests/trajectory-route.test.ts, so the band and the
 * keys and the door all ask one module the same question.
 *
 * The stored route is one list (src/types.ts § `Trajectory`): **the array order
 * is the route, and depth *d* shows every stop with `depth ≤ d`.** So the passes
 * nest by construction, and nothing here has three lists to keep in step.
 *
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § The mode (client) is the spec every rule below is quoted from.
 */
import type { Block, Tree, TreeNode, TrajectoryDepth, TrajectoryStop } from "../types.js";

/** The three depths, shallowest first. */
export const DEPTHS: readonly TrajectoryDepth[] = [1, 2, 3];

/** What the depth control calls each pass — the Opus arbiter's labels. */
export const DEPTH_LABEL: Record<TrajectoryDepth, string> = {
  1: "Gist",
  2: "More",
  3: "Most",
};

/** The stops a depth shows, in route order. */
export function visibleRoute(
  stops: readonly TrajectoryStop[],
  depth: TrajectoryDepth,
): TrajectoryStop[] {
  return stops.filter((s) => s.depth <= depth);
}

/** How many stops a depth shows. */
export function countAt(stops: readonly TrajectoryStop[], depth: TrajectoryDepth): number {
  return stops.reduce((n, s) => (s.depth <= depth ? n + 1 : n), 0);
}

/**
 * **The depths that add something**, shallowest first. A short spiral is
 * allowed on an article with few quotes (the plan's growth rule), and a depth
 * that shows exactly what the one before it showed is not a choice worth a
 * button. Gist is kept whenever there is any stop at all, so a route always has
 * a first pass.
 */
export function offeredDepths(stops: readonly TrajectoryStop[]): TrajectoryDepth[] {
  const out: TrajectoryDepth[] = [];
  let before = 0;
  for (const d of DEPTHS) {
    const n = countAt(stops, d);
    if (n > before || (d === 1 && n > 0)) out.push(d);
    before = n;
  }
  return out;
}

/**
 * The depth to draw: the one asked for if it is offered, else the deepest
 * offered depth below it, else the shallowest offered — and Gist when nothing
 * was asked. `null` only for a route with no stops.
 *
 * "Below it" rather than "nearest" because a link that said `?depth=3` on a
 * route whose third pass adds nothing is asking for *everything*, and the
 * deepest pass that exists is everything.
 */
export function effectiveDepth(
  stops: readonly TrajectoryStop[],
  asked: TrajectoryDepth | null,
): TrajectoryDepth | null {
  const offered = offeredDepths(stops);
  if (offered.length === 0) return null;
  if (asked === null) return offered[0]!;
  if (offered.includes(asked)) return asked;
  const below = offered.filter((d) => d < asked);
  return below.length > 0 ? below[below.length - 1]! : offered[0]!;
}

/**
 * The stop the reader is on: the one asked for if this depth shows it, else
 * the first stop. **A stale `?stop=` falls back to the first stop** (the plan's
 * § URL) — a quote chosen again, or a link from before a rebuild.
 */
export function currentStop(
  route: readonly TrajectoryStop[],
  asked: string | null,
): TrajectoryStop | null {
  if (route.length === 0) return null;
  return route.find((s) => s.quoteId === asked) ?? route[0]!;
}

/**
 * **One step along the route, with no wrap at either end.** `null` means there
 * is nowhere to go — the caller hands the key back rather than swallowing it.
 * A current stop that is not on this route steps to the first.
 */
export function stepStop(
  route: readonly TrajectoryStop[],
  from: string | null,
  dir: -1 | 1,
): string | null {
  if (route.length === 0) return null;
  const i = route.findIndex((s) => s.quoteId === from);
  if (i === -1) return route[0]!.quoteId;
  return route[i + dir]?.quoteId ?? null;
}

/**
 * **Where a change of depth lands** — "changing depth keeps your place, and
 * going round again starts again", exactly as the plan states it:
 *
 * - **Depth up**, when you are on the **last stop of the current pass**: go to
 *   the first stop that is new at the new depth. That is going round again.
 * - **Depth up** otherwise: stay on the current stop.
 * - **Depth down**: stay on the current stop if the shallower pass has it.
 *   Otherwise go to the nearest earlier stop that it has, or to its first stop
 *   if none comes earlier.
 *
 * With no current stop, or one that is not on the pass being left, it lands on
 * the new pass's first stop. `null` only when the new pass is empty.
 */
export function stopAfterDepthChange(
  stops: readonly TrajectoryStop[],
  from: TrajectoryDepth,
  to: TrajectoryDepth,
  current: string | null,
): string | null {
  const next = visibleRoute(stops, to);
  if (next.length === 0) return null;
  const first = next[0]!.quoteId;
  const pass = visibleRoute(stops, from);
  const at = pass.findIndex((s) => s.quoteId === current);
  if (at === -1) return first;
  const here = pass[at]!;

  if (to > from) {
    if (at === pass.length - 1) {
      /* Going round again: the first stop the deeper pass adds. A depth that
         adds nothing has no such stop, and then there is nowhere new to go. */
      const fresh = next.find((s) => s.depth > from);
      return fresh ? fresh.quoteId : here.quoteId;
    }
    return here.quoteId;
  }
  if (to === from) return here.quoteId;

  if (here.depth <= to) return here.quoteId;
  /* The nearest earlier stop the shallower pass has, walking back along the
     route as it stood — the full list, since `pass` is a superset of `next`. */
  const whole = stops.findIndex((s) => s.quoteId === here.quoteId);
  for (let i = whole - 1; i >= 0; i--) {
    const s = stops[i]!;
    if (s.depth <= to) return s.quoteId;
  }
  return first;
}

/**
 * **What the door after the current stop's block offers.**
 *
 * - `next`: the next stop on this pass.
 * - `again`: the end of a pass with a deeper one after it — *"Go round again —
 *   More ›"*. Pressing it is a depth change to `depth`, so it lands where
 *   `stopAfterDepthChange` says: the first stop new at that depth.
 * - `end`: the last stop of the deepest pass. Nothing further to offer.
 */
export type Door =
  | { kind: "next"; quoteId: string }
  | { kind: "again"; depth: TrajectoryDepth }
  | { kind: "end" };

export function doorAfter(
  stops: readonly TrajectoryStop[],
  depth: TrajectoryDepth,
  current: string | null,
): Door {
  const route = visibleRoute(stops, depth);
  const next = stepStop(route, current, 1);
  if (next !== null) return { kind: "next", quoteId: next };
  const deeper = offeredDepths(stops).find((d) => d > depth);
  return deeper === undefined ? { kind: "end" } : { kind: "again", depth: deeper };
}

/**
 * **The titles of the non-root ancestors of the leaf that holds this block** —
 * `["Results", "Robustness"]`. In a flat tree, where the leaf hangs off the
 * root, it is the leaf's own title. `[]` for a block the tree does not cover.
 *
 * The client's copy of `sectionPathOf` in src/trajectory.ts, which is the path
 * the model was shown — so the band says where a stop is in the same words the
 * route was planned in. A copy rather than an import because that module pulls
 * `node:crypto` and the Anthropic SDK, and src/web may import only pure leaves;
 * tests/trajectory-route.test.ts pins the two against one tree.
 *
 * Resolved by **block index**, never by comparing id strings
 * (docs/project/block-ids.md). Takes the index so a list of thirty stops builds
 * it once.
 */
export function sectionPath(
  blockId: string,
  index: ReadonlyMap<string, number>,
  tree: Tree,
): string[] {
  const at = index.get(blockId);
  if (at === undefined) return [];
  const contains = (n: TreeNode): boolean => {
    const lo = index.get(n.range[0]);
    const hi = index.get(n.range[1]);
    return lo !== undefined && hi !== undefined && lo <= at && at <= hi;
  };
  const path: TreeNode[] = [];
  let node = tree.nodes[tree.rootId];
  while (node && node.children.length > 0) {
    const next = node.children.map((id) => tree.nodes[id]).find((c) => c && contains(c));
    if (!next) break;
    path.push(next);
    node = next;
  }
  if (path.length === 0) return [];
  const leaf = path.at(-1)!;
  const ancestors = leaf.children.length === 0 ? path.slice(0, -1) : path;
  return (ancestors.length > 0 ? ancestors : [leaf]).map((n) => n.title);
}

/** Block id → position, for `sectionPath`. */
export function blockIndex(blocks: readonly Block[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const [i, b] of blocks.entries()) index.set(b.id, i);
  return index;
}
