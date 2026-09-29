/**
 * **The arithmetic of walking a Trajectory** — which stops a depth shows, where
 * a step goes, where a change of depth lands, and what the door in the prose
 * offers. Pure, and pinned in tests/trajectory-route.test.ts, so the band and the
 * keys and the door all ask one module the same question.
 *
 * The stored route is one list (src/types.ts § `Trajectory`): **the array order
 * is the route, and each stop has the depth of the pass it belongs to.** The
 * model plans the passes as nesting — depth *d* covering every stop with
 * `depth ≤ d` — but **the reader walks each pass as only its own stops**: Gist
 * the depth-1 stops, More the depth-2 ones, Most the depth-3 ones. Greg,
 * SPIDERYARN-READING2-4P: *"it's a bit annoying for the more detailed levels of
 * granularity to reuse the same snippets as the coarser levels if I've just read
 * the coarser level."* So More and Most are what the shallower passes left out,
 * not skims that stand alone — plan
 * docs/plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md.
 *
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § The mode (client) is where the other rules below were first specified.
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

/** The stops a pass walks — exactly that depth's, in route order. */
export function passRoute(
  stops: readonly TrajectoryStop[],
  depth: TrajectoryDepth,
): TrajectoryStop[] {
  return stops.filter((s) => s.depth === depth);
}

/** How many stops a pass walks. */
export function passCount(stops: readonly TrajectoryStop[], depth: TrajectoryDepth): number {
  return stops.reduce((n, s) => (s.depth === depth ? n + 1 : n), 0);
}

/**
 * **The depths with a stop**, shallowest first. A short spiral is allowed on
 * an article with few quotes (the plan's growth rule), so a depth can have
 * none, and a pass with nothing to walk is not a choice worth a button.
 *
 * **Any stop at all is enough** — a deeper pass no bigger than the one before
 * it is still a pass of stops the reader has not stood at (Sol, plan review
 * F1: a real route's passes are 2 / 2 / 4).
 */
export function offeredDepths(stops: readonly TrajectoryStop[]): TrajectoryDepth[] {
  return DEPTHS.filter((d) => stops.some((s) => s.depth === d));
}

/**
 * The depth to draw: the one asked for if it is offered, else the deepest
 * offered depth below it, else the shallowest offered — and Gist when nothing
 * was asked. `null` only for a route with no stops.
 *
 * "Below it" rather than "nearest" because a link that said `?depth=3` on a
 * route with no third pass was asking to go as deep as the route goes.
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

/** Where the reader is: the pass drawn, its stops, and the one stood at. */
export interface Location {
  depth: TrajectoryDepth | null;
  route: TrajectoryStop[];
  current: TrajectoryStop | null;
}

/**
 * **Where `?depth=` and `?stop=` put the reader — the stop wins** (Sol, plan
 * review F4). A stop is the precise address and a depth only the pass around
 * it; with separate passes the two can disagree, as every link written before
 * plan 260929e that names a Gist stop at `depth=2` does. So:
 *
 * 1. a `?stop=` on the route draws that stop's own pass, standing on it;
 * 2. otherwise the asked depth (`effectiveDepth`), on its first stop — **a stale
 *    `?stop=` falls back to stop 1** (the plan's § URL): a quote chosen again,
 *    or a link from before a rebuild.
 */
export function locate(
  stops: readonly TrajectoryStop[],
  askedDepth: TrajectoryDepth | null,
  askedStop: string | null,
): Location {
  const named = askedStop === null ? undefined : stops.find((s) => s.quoteId === askedStop);
  const depth = named ? named.depth : effectiveDepth(stops, askedDepth);
  if (depth === null) return { depth: null, route: [], current: null };
  const route = passRoute(stops, depth);
  return { depth, route, current: named ?? route[0] ?? null };
}

/**
 * **One step along the pass, with no wrap at either end.** `null` means there
 * is nowhere to go — the caller hands the key back rather than swallowing it.
 * A current stop that is not on this pass steps to the first.
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
 * **Where a change of depth lands: stop 1 of the new pass**, deeper or
 * shallower. Until plan 260929e a depth change kept your stop, because a deeper
 * pass contained it; separate passes never share a stop, and stop 1 is where
 * *More detail ›* lands too, so the buttons and the door agree. Remembering
 * where you were in each pass is deferred (the plan's § Deferred). `null` for a
 * pass with no stops.
 */
export function firstStopOf(stops: readonly TrajectoryStop[], depth: TrajectoryDepth): string | null {
  return stops.find((s) => s.depth === depth)?.quoteId ?? null;
}

/**
 * **What the door after the current stop's block offers.**
 *
 * - `next`: the next stop on this pass.
 * - `end`: the last stop of the pass. When a deeper pass exists, *More
 *   detail ›* — that `deeper` depth, landing on **its** stop 1, which since plan
 *   260929e is always a stop the reader has not stood at. At the end of the
 *   deepest pass `deeper` is `null` and the door offers no button, only the
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
  const route = passRoute(stops, depth);
  if (route.length === 0) return null;
  const next = stepStop(route, current, 1);
  if (next !== null) return { kind: "next", quoteId: next };
  const d = offeredDepths(stops).find((x) => x > depth);
  const deeperFirst = d === undefined ? null : firstStopOf(stops, d);
  return {
    kind: "end",
    deeper: d === undefined || deeperFirst === null ? null : { depth: d, first: deeperFirst },
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
