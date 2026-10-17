/**
 * **Which stops each pass of a Skim route walks — the one definition**, shared
 * by the band (src/web/skim-route.ts re-exports it) and the server's growth
 * rule (src/skim.ts § `passSizes`, `growPasses`), so that what the route is
 * checked against is what the reader walks. Until plan 261010t the server
 * checked cumulative counts instead, and a route whose More walked 5 stops and
 * Most 4 passed (spya-nbmce7). Pure: types only.
 *
 * **Since `skim/14` a walk holds figures too** (plan 261017d): `walkOf` merges
 * the route's quote stops and its figure stops into one list of `WalkStop`s,
 * and the functions below take either, because all they read is `depth` and
 * `again`. A figure is walked in its one pass and never makes a pass.
 */
import type { BlockId, SkimDepth, SkimFigureStop, SkimStop } from "./types.js";

/** The three depths, shallowest first. */
export const DEPTHS: readonly SkimDepth[] = [1, 2, 3];

/** What a pass is decided from: a stop's first pass, the deeper ones it is carried into, and whether it is a figure. */
export interface Passable {
  depth: SkimDepth;
  again?: readonly SkimDepth[];
  /** Absent on a `SkimStop`, which is a quote. */
  kind?: "quote" | "figure";
}

/**
 * **One stop of the walk**: a quote stop, keyed by its quote id, or a figure
 * stop, keyed by its block id — the same `?stop=` value the Figures walk
 * writes for that figure, so the two walks' links agree.
 */
export type WalkStop =
  | { kind: "quote"; key: string; depth: SkimDepth; again?: SkimDepth[]; stop: SkimStop }
  | { kind: "figure"; key: BlockId; depth: SkimDepth; stop: SkimFigureStop };

/**
 * **The route as it is walked: the quote stops in their order, each figure
 * straight after the quote its `after` names** (`null`: before the first
 * quote), figures anchored to one quote in their stored order.
 *
 * Belt and braces, since the server already refuses all of these (src/skim.ts
 * § `validateFigures`): a figure is left out when its anchor is not on the
 * route, when no quote stop is first placed at its depth (a figure never
 * makes a pass), when its block id is also a quote's id on the route (both are
 * `spya-…`, and two stops with one key would make `?stop=` ambiguous — GPT
 * Sol, plan review F7), or when it repeats a figure already placed.
 */
export function walkOf(stops: readonly SkimStop[], figures?: readonly SkimFigureStop[]): WalkStop[] {
  const quotes = stops.map(
    (stop): WalkStop => ({
      kind: "quote",
      key: stop.quoteId,
      depth: stop.depth,
      ...(stop.again ? { again: stop.again } : {}),
      stop,
    }),
  );
  if (!figures || figures.length === 0) return quotes;
  const onRoute = new Set(stops.map((s) => s.quoteId));
  const offered = new Set(offeredDepths(stops));
  const after = new Map<string | null, WalkStop[]>();
  const placed = new Set<string>();
  for (const figure of figures) {
    if (figure.after !== null && !onRoute.has(figure.after)) continue;
    if (!offered.has(figure.depth)) continue;
    if (onRoute.has(figure.blockId) || placed.has(figure.blockId)) continue;
    placed.add(figure.blockId);
    const list = after.get(figure.after) ?? [];
    list.push({ kind: "figure", key: figure.blockId, depth: figure.depth, stop: figure });
    after.set(figure.after, list);
  }
  return [...(after.get(null) ?? []), ...quotes.flatMap((q) => [q, ...(after.get(q.key) ?? [])])];
}

/** `walkedIn`, with the offered depths already in hand — one scan per pass, not per stop. */
function inPass(stop: Passable, depth: SkimDepth, offered: readonly SkimDepth[]): boolean {
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
export function walkedIn(stops: readonly Passable[], stop: Passable, depth: SkimDepth): boolean {
  return inPass(stop, depth, offeredDepths(stops));
}

/**
 * The stops a pass walks, in route order: the ones first placed at that depth,
 * and any shallower stop carried into it (`walkedIn`). A carried stop keeps its
 * one place in the order.
 */
export function passRoute<T extends Passable>(stops: readonly T[], depth: SkimDepth): T[] {
  const offered = offeredDepths(stops);
  return stops.filter((s) => inPass(s, depth, offered));
}

/** How many stops a pass walks — its own and the carried ones, figures included. */
export function passCount(stops: readonly Passable[], depth: SkimDepth): number {
  const offered = offeredDepths(stops);
  return stops.reduce((n, s) => (inPass(s, depth, offered) ? n + 1 : n), 0);
}

/**
 * **The depths with a quote stop first placed there**, shallowest first. A
 * short spiral is allowed on an article with few quotes (the plan's growth
 * rule), so a depth can have none, and a pass with nothing to walk is not a
 * choice worth a button.
 *
 * **Any stop of its own is enough** — a deeper pass no bigger than the one
 * before it is still a pass of stops the reader has not stood at (Sol, plan
 * 260929e review F1: a real route's passes are 2 / 2 / 4).
 *
 * **A carried stop is not enough, and this does not ask `walkedIn`** (Sol, plan
 * 261003l review F1): one Gist stop with `again: [2]` and no More stop would
 * otherwise offer a More that is the same one stop again. `walkedIn` asks this,
 * not the other way round. **Nor is a figure** (plan 261017d): a pass of
 * pictures alone would be a different walk, the Figures one.
 */
export function offeredDepths(stops: readonly Passable[]): SkimDepth[] {
  return DEPTHS.filter((d) => stops.some((s) => s.depth === d && s.kind !== "figure"));
}
