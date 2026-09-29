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
import type { Block, BlockId, TrajectoryDepth, TrajectoryStop } from "../types.js";

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
 * **Where a change of depth lands** — "changing depth keeps your place":
 *
 * - **Depth up**: stay on the current stop. The deeper pass contains it.
 * - **Depth down**: stay on the current stop if the shallower pass has it.
 *   Otherwise go to the nearest earlier stop that it has, or to its first stop
 *   if none comes earlier.
 *
 * With no current stop, or one that is not on the pass being left, it lands on
 * the new pass's first stop. `null` only when the new pass is empty.
 *
 * **Going round again is not here any more.** Until plan 260929a a depth-up on
 * the last stop of a pass jumped to the first stop new at the deeper pass. The
 * door at the end of a pass now names that choice itself — *More detail ›*
 * (Greg, SPIDERYARN-READING2-4N and 51) — so the depth buttons keep
 * one rule, and the doors choose their own landing (`doorAfter`).
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

  if (to >= from) return here.quoteId;

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
 * - `end`: the last stop of the pass. When a deeper offered pass exists, *More
 *   detail ›* — that `deeper` depth, landing on **its** stop 1. At the end of
 *   the deepest pass `deeper` is `null` and the door offers no button, only the
 *   line saying which pass ended. *Go round again* (stop 1 of this pass) went in
 *   plan 260929b: ← walks back (SPIDERYARN-READING2-51).
 *
 * `null` for a route with no stops on this pass.
 */
export type Door =
  | { kind: "next"; quoteId: string }
  | { kind: "end"; deeper: { depth: TrajectoryDepth; first: string } | null };

export function doorAfter(
  stops: readonly TrajectoryStop[],
  depth: TrajectoryDepth,
  current: string | null,
): Door | null {
  const route = visibleRoute(stops, depth);
  if (route.length === 0) return null;
  const next = stepStop(route, current, 1);
  if (next !== null) return { kind: "next", quoteId: next };
  const d = offeredDepths(stops).find((x) => x > depth);
  const deeperFirst = d === undefined ? undefined : visibleRoute(stops, d)[0];
  return {
    kind: "end",
    deeper: d === undefined || deeperFirst === undefined ? null : { depth: d, first: deeperFirst.quoteId },
  };
}

/**
 * **How far through the article a block sits**, 0 to 1 — the dot on each stop's
 * row (the plan's stage 5b). The words of every block before it plus half its
 * own, over the article's total, so a stop reads at its middle.
 *
 * **Words, not blocks**: a heading, a caption and a 300-word paragraph are one
 * block each, so a paper with many short blocks up front would look further
 * through than it reads. Words are what "how far through" means to a reader,
 * and what the spine's own sizes answer in. `null` for a block that is not in
 * the article.
 *
 * **Never NaN** (Sol F36): an article whose blocks all count zero words — a
 * scan with no text layer, say — falls back to the block's middle by count,
 * `(index + ½) / count`, rather than dividing by nothing.
 */
export function positionOf(blockId: BlockId, blocks: readonly Block[]): number | null {
  return positionsOf(blocks).get(blockId) ?? null;
}

/**
 * Every block midpoint in one pass after the total is known. The Trajectory
 * panel asks for up to 36 positions at once, so building this map once keeps a
 * render O(blocks + stops), rather than making `positionOf` rescan the article
 * for every row.
 */
export function positionsOf(blocks: readonly Block[]): ReadonlyMap<BlockId, number> {
  const positions = new Map<BlockId, number>();
  if (blocks.length === 0) return positions;

  const total = blocks.reduce((words, block) => words + block.words, 0);
  let before = 0;
  for (const [i, b] of blocks.entries()) {
    const words = b.words;
    positions.set(b.id, total <= 0 ? (i + 0.5) / blocks.length : (before + words / 2) / total);
    before += words;
  }
  return positions;
}
