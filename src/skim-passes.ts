/**
 * **Which stops each pass of a Skim route walks — the one definition**, shared
 * by the band (src/web/skim-route.ts re-exports it) and the server's growth
 * rule (src/skim.ts § `passSizes`, `growPasses`), so that what the route is
 * checked against is what the reader walks. Until plan 261010g the server
 * checked cumulative counts instead, and a route whose More walked 5 stops and
 * Most 4 passed (spya-nbmce7). Pure: types only.
 */
import type { SkimDepth, SkimStop } from "./types.js";

/** The three depths, shallowest first. */
export const DEPTHS: readonly SkimDepth[] = [1, 2, 3];

/** `walkedIn`, with the offered depths already in hand — one scan per pass, not per stop. */
function inPass(stop: SkimStop, depth: SkimDepth, offered: readonly SkimDepth[]): boolean {
  if (stop.depth === depth) return true;
  return offered.includes(depth) && (stop.again?.includes(depth) ?? false);
}

/**
 * **Whether a stop is walked in a pass — the one definition** (plan 261003l).
 * It is when the stop was first placed at that depth, or when its `again` names
 * the depth **and the route offers it** (`offeredDepths`). The second half is
 * Sol's plan-review F1: a carried stop does not make a pass, so an `again`
 * naming a depth nothing is first placed at is ignored here, as `validateRoute`
 * (src/skim.ts) drops it before it is stored.
 */
export function walkedIn(stops: readonly SkimStop[], stop: SkimStop, depth: SkimDepth): boolean {
  return inPass(stop, depth, offeredDepths(stops));
}

/**
 * The stops a pass walks, in route order: the ones first placed at that depth,
 * and any shallower stop carried into it (`walkedIn`). A carried stop keeps its
 * one place in the order.
 */
export function passRoute(
  stops: readonly SkimStop[],
  depth: SkimDepth,
): SkimStop[] {
  const offered = offeredDepths(stops);
  return stops.filter((s) => inPass(s, depth, offered));
}

/** How many stops a pass walks — its own and the carried ones. */
export function passCount(stops: readonly SkimStop[], depth: SkimDepth): number {
  const offered = offeredDepths(stops);
  return stops.reduce((n, s) => (inPass(s, depth, offered) ? n + 1 : n), 0);
}

/**
 * **The depths with a stop first placed there**, shallowest first. A short
 * spiral is allowed on an article with few quotes (the plan's growth rule), so
 * a depth can have none, and a pass with nothing to walk is not a choice worth
 * a button.
 *
 * **Any stop of its own is enough** — a deeper pass no bigger than the one
 * before it is still a pass of stops the reader has not stood at (Sol, plan
 * 260929e review F1: a real route's passes are 2 / 2 / 4).
 *
 * **A carried stop is not enough, and this does not ask `walkedIn`** (Sol, plan
 * 261003l review F1): one Gist stop with `again: [2]` and no More stop would
 * otherwise offer a More that is the same one stop again. `walkedIn` asks this,
 * not the other way round.
 */
export function offeredDepths(stops: readonly SkimStop[]): SkimDepth[] {
  return DEPTHS.filter((d) => stops.some((s) => s.depth === d));
}
