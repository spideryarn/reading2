/**
 * **The arithmetic of walking a Skim** — which stops a depth shows, where
 * a step goes, where a change of depth lands, and what the door in the prose
 * offers. Pure, and pinned in tests/skim-route.test.ts, so the band and the
 * keys and the door all ask one module the same question.
 *
 * The stored route is one list (src/types.ts § `Skim`): **the array order
 * is the route, and each stop has the depth of the shallowest pass it belongs
 * to.** The caps are counted as nesting — depth *d* covering every stop with
 * `depth ≤ d` — but **the reader does not walk the passes that way.**
 *
 * Since plan 260929e a pass walks the stops first placed at its depth: Gist the
 * depth-1 stops, More the depth-2 ones, Most the depth-3 ones. Greg,
 * SPIDERYARN-READING2-4P: *"it's a bit annoying for the more detailed levels of
 * granularity to reuse the same snippets as the coarser levels if I've just read
 * the coarser level."*
 * docs/plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md.
 *
 * **Since plan 261003l a pass may also walk a shallower stop again** — one the
 * route carries into it with `SkimStop.again`. Walked that strictly, two related
 * points landed one in Gist and one in More, and Greg found it disjointed
 * (spya-ms9d69, 2026-10-03): *"it's not a guarantee, but nor is it excluded that
 * something in a coarser level shows up in a more detailed level."* A route with
 * no `again` — every one written before `skim/9` — walks exactly as 260929e
 * left it. `walkedIn` is the one definition; everything below asks it.
 * docs/plans/261003l-skim-arrows-stay-in-the-band-and-stops-shared-across-depths.md
 * § Stage 2.
 *
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § The mode (client) is where the other rules below were first specified.
 */
import { DEPTHS, offeredDepths, passCount, passRoute, walkedIn } from "../skim-passes.js";
import type { Block, BlockId, SkimDepth, SkimStop } from "../types.js";

/* The pass definitions are shared with the server's growth rule (src/skim.ts
   § `passSizes`), so they live in src/skim-passes.ts; re-exported here for the
   client's existing imports. */
export { DEPTHS, offeredDepths, passCount, passRoute, walkedIn };

/** What the depth control calls each pass — the Opus arbiter's labels. */
export const DEPTH_LABEL: Record<SkimDepth, string> = {
  1: "Gist",
  2: "More",
  3: "Most",
};

/**
 * The depth to draw: the one asked for if it is offered, else the deepest
 * offered depth below it, else the shallowest offered — and Gist when nothing
 * was asked. `null` only for a route with no stops.
 *
 * "Below it" rather than "nearest" because a link that said `?depth=3` on a
 * route with no third pass was asking to go as deep as the route goes.
 */
export function effectiveDepth(
  stops: readonly SkimStop[],
  asked: SkimDepth | null,
): SkimDepth | null {
  const offered = offeredDepths(stops);
  if (offered.length === 0) return null;
  if (asked === null) return offered[0]!;
  if (offered.includes(asked)) return asked;
  const below = offered.filter((d) => d < asked);
  return below.length > 0 ? below[below.length - 1]! : offered[0]!;
}

/** Where the reader is: the pass drawn, its stops, and the one stood at. */
export interface Location {
  depth: SkimDepth | null;
  route: SkimStop[];
  current: SkimStop | null;
}

/**
 * **Where `?depth=` and `?stop=` put the reader — the stop wins** (Sol, plan
 * 260929e review F4). A stop is the precise address and a depth only the pass
 * around it, and the two can disagree, as every link written before plan
 * 260929e that names a Gist stop at `depth=2` does. So:
 *
 * 1. a `?stop=` on the route is stood on, in **the asked pass when the stop is
 *    walked there, else the stop's own** — its `depth`, the shallowest it is in.
 *    Until plan 261003l a stop had exactly one pass, so the asked depth never
 *    mattered once a stop was named; an old route, with no `again`, still
 *    behaves that way, and so does a link with no `?depth=` (Sol, plan 261003l
 *    review F5);
 * 2. otherwise the asked depth (`effectiveDepth`), on its first stop — **a stale
 *    `?stop=` falls back to stop 1** (the plan's § URL): a quote chosen again,
 *    or a link from before a rebuild.
 */
export function locate(
  stops: readonly SkimStop[],
  askedDepth: SkimDepth | null,
  askedStop: string | null,
): Location {
  const named = askedStop === null ? undefined : stops.find((s) => s.quoteId === askedStop);
  const depth = named
    ? askedDepth !== null && walkedIn(stops, named, askedDepth)
      ? askedDepth
      : named.depth
    : effectiveDepth(stops, askedDepth);
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
  route: readonly SkimStop[],
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
 * pass contained it; a pass no longer contains the one before, and stop 1 is
 * where *More detail ›* lands too, so the buttons and the door agree.
 * Remembering where you were in each pass is deferred (that plan's § Deferred).
 *
 * **Stop 1 of the new pass can be the stop the reader is on** since plan
 * 261003l — a carried stop that comes first in the deeper pass. The caller
 * changes the pass and does not move (SkimMode.tsx § `changeDepth`). `null` for
 * a pass with no stops.
 */
export function firstStopOf(stops: readonly SkimStop[], depth: SkimDepth): string | null {
  return passRoute(stops, depth)[0]?.quoteId ?? null;
}

/**
 * **What the door after the current stop's block offers.**
 *
 * - `next`: the next stop on this pass.
 * - `end`: the last stop of the pass. When a deeper pass exists, *More
 *   detail ›* — that `deeper` depth, landing on **its** stop 1. On a route with
 *   no `again` that is always a stop the reader has not stood at (260929e);
 *   with one it can be a carried stop, even the one being stood at, in which
 *   case the pass changes and the door becomes *Next stop ›* (261003l). At the
 *   deepest pass `deeper` is `null` and the door offers no button, only the
 *   line saying which pass ended. *Go round again* (stop 1 of this pass) went in
 *   plan 260929b: ← walks back (SPIDERYARN-READING2-51).
 *
 * `null` for a route with no stops on this pass.
 */
export type Door =
  | { kind: "next"; quoteId: string }
  | { kind: "end"; deeper: { depth: SkimDepth; first: string } | null };

export function doorAfter(
  stops: readonly SkimStop[],
  depth: SkimDepth,
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
 * Every block midpoint in one pass after the total is known. The Skim
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
