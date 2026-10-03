import type { Skim, SkimDepth } from "../src/types.js";
import { passRoute } from "../src/web/skim-route.js";

/** Unique block ids the stops walked at depth `d` sit on, route order preserved. */
export function stopBlocksAtDepth(
  skim: Pick<Skim, "stops">,
  quoteBlockOf: ReadonlyMap<string, string>,
  depth: SkimDepth,
): { blockIds: string[]; unresolved: number } {
  const blockIds: string[] = [];
  const seen = new Set<string>();
  let unresolved = 0;
  for (const stop of passRoute(skim.stops, depth)) {
    const blockId = quoteBlockOf.get(stop.quoteId);
    if (!blockId) {
      unresolved++;
      continue;
    }
    if (seen.has(blockId)) continue;
    seen.add(blockId);
    blockIds.push(blockId);
  }
  return { blockIds, unresolved };
}
