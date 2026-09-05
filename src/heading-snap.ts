/**
 * **A section that begins one paragraph below the heading it names is moved
 * back onto it** — the one derivation rule the two tilings share.
 *
 * ## Why it is a file of its own
 *
 * There are two places that turn a set of claimed starts into a tiling:
 * `planChildRanges` (src/hierarchy.ts), which the incumbent whole-document call
 * goes through, and `normaliseExpansion` (src/hierarchy-cascade.ts), which
 * every scoped call in the cascade goes through. From wave 2 on those two meet:
 * a scoped call is shown a slice `planChildRanges` derived, and its own answer
 * is derived by `normaliseExpansion`. Two rules over one tree is a boundary
 * that moves depending on which call produced it, and nothing downstream can
 * see the difference — the tree tiles either way.
 *
 * The snap is the whole of the divergence, so the snap is what is shared. The
 * two *start-collision* rules stay separate on purpose: `planChildRanges` has
 * the model's claimed ends to fall back on when a start carries no information
 * and `normaliseExpansion` does not, and a previous review ruled against
 * threading an optional `ends` parameter through one merged helper to paper
 * over that ⟨GPT Sol, 2026-09-04, quoted in tests/hierarchy-cascade.test.ts §
 * "the differential test"⟩.
 *
 * **Its own file rather than either of theirs**, because `hierarchy.ts` and
 * `hierarchy-cascade.ts` cannot import each other: the cascade already imports
 * `BuildReport` and `ModelNode` from the incumbent, and `npm run cycles`
 * (biome `noImportCycles`) is a gate at zero. A third module both can reach
 * costs one file and no cycle; the alternative was moving `PartitionRepair` out
 * of `hierarchy.ts`, which is a rename across the repo for no gain.
 *
 * ## The measurement it comes from
 *
 * A 142-page Kuhn paper, 2026-09-04 (Fable): of the model's 82 non-root nodes,
 * 24 started *on* a heading block and **53 on the block immediately after
 * one**, and every unbacked `sourceHeading` claim reproduced was at that
 * offset. The model was not overruling the author — it named the author's
 * heading correctly and put the boundary one block late. The heading then fell
 * into the previous section's tail, the derivation believed the start, and
 * `buildTree` dropped the claim as out of range. `droppedHeadings: 59` was
 * counting that.
 *
 * So the answer is code rather than a prompt line: a prompt can be ignored, and
 * the model was already doing what a prompt would have asked for.
 */
import { sameHeading } from "./tree-invariants.js";
import type { Block } from "./types.js";

/**
 * One kept child: where it sits in the model's proposal, and where it starts.
 *
 * Both callers already keep exactly this shape, so the snap can mutate theirs
 * in place rather than making them translate.
 */
export interface KeptChild {
  childIndex: number;
  start: number;
}

/**
 * What the snap records — structurally the `"heading"` member of
 * `PartitionRepair` (src/hierarchy.ts), narrowed to the one `kind` this file
 * can produce.
 *
 * Declared here rather than imported so that this module depends on nothing
 * that depends on it; see the header on cycles. It is **returned** rather than
 * pushed into a caller's array for the same reason — a `PartitionRepair[]`
 * parameter would need the type, and a structural `{ push }` parameter would be
 * cleverness in place of an import.
 */
export interface HeadingSnapRepair {
  where: string;
  kind: "heading";
  /** The boundary's coordinate: where it ended up, as everywhere else. */
  at: number;
  /** How many blocks changed hands. */
  size: number;
}

/**
 * **Move each kept child back onto the heading run it names**, and say what was
 * moved.
 *
 * ## Why the claim has to match
 *
 * The obvious rule — snap any start that sits one block after a heading — takes
 * headings the model deliberately left in the section before it. The fixture is
 * in tests/hierarchy-repairs.test.ts: a model that puts "The First Part" inside
 * child 1 and starts child 2 on the paragraph beneath it has proposed a
 * boundary, and moving that heading forward would invent a different one.
 * **Requiring the child's own `sourceHeading` to name a heading in the run makes
 * this self-evidencing** — it only ever honours a claim the answer already made,
 * which is also why it can be a repair rather than a heuristic. The `typeof`
 * guard is not decoration: `sourceHeading` is model output behind a cast, and
 * `sameHeading` throws inside `.replace` on a number.
 *
 * ## The run, and the floor under it
 *
 * Headings come in runs — an `h2` directly beneath an `h1` — and the section
 * begins at the *first* of the run, not the nearest, because the `h1` above it
 * introduces the same prose. The floor is the previous kept child's start: a
 * section cannot begin where its predecessor begins, so a run reaching back to a
 * heading the previous section starts on is entered at the first block after it.
 * That is the real case of a sub-section under a part title, not a corner.
 *
 * The first kept child is never snapped — it is pinned to its parent's start,
 * because nothing else can supply that block.
 *
 * **Run it after whatever measures the answer's own claims, never before.** The
 * boundary faults both callers record compare the model's claims with where the
 * boundary ended up, so a section moved back onto its heading would report a
 * phantom `overlap` against its own correct start, and the snap would be
 * invisible in the telemetry that exists to watch it.
 *
 * Mutates `kept` in place. `at` is where the boundary *ended up*, as everywhere
 * else, which is what lets `repairedBlockCount` see the pin it cascades into one
 * level down as the same movement rather than a second one.
 */
export function snapStartsToHeadings(
  /** The model's proposal, in its own order. Only `sourceHeading` is read. */
  children: readonly { sourceHeading?: unknown }[],
  kept: KeptChild[],
  blocks: readonly Block[],
  where: string,
): HeadingSnapRepair[] {
  const repairs: HeadingSnapRepair[] = [];
  const heading = (i: number) => blocks[i]?.kind === "heading";
  for (let k = 1; k < kept.length; k++) {
    const child = kept[k]!;
    const start = child.start;
    // Already on a heading, or not one block after one: nothing to do. This is
    // the no-op on every document the model gets right.
    if (heading(start) || !heading(start - 1)) continue;

    const claim = children[child.childIndex]?.sourceHeading;
    if (typeof claim !== "string" || claim.trim() === "") continue;

    let first = start - 1;
    while (heading(first - 1)) first -= 1;
    // The floor: never back onto, or past, the previous section's own start.
    first = Math.max(first, kept[k - 1]!.start + 1);
    /* **And never past a heading the previous section itself names.** The floor
       above stops the run reaching a heading the previous section *starts on*,
       which is not the same thing. A section can begin on a preamble and quote
       the `h1` further down; taking that `h1` forward would strip its
       provenance and leave its title and gist describing prose its own heading
       is no longer in. One matched heading justifies moving that heading, not
       every heading above it. ⟨GPT Sol, finding 2⟩ */
    const prior = children[kept[k - 1]!.childIndex]?.sourceHeading;
    if (typeof prior === "string" && prior.trim() !== "") {
      for (let j = start - 1; j >= first; j--) {
        if (sameHeading(blocks[j]!.text, prior)) {
          first = j + 1;
          break;
        }
      }
    }
    if (first >= start) continue;

    /* The claim must name one of the headings actually being moved. Read with
       `sameHeading`, the same tolerant comparison `buildTree` and `checkTree`
       use to decide whether a claim is backed — a match by any other rule would
       move a boundary to make a badge that then gets dropped anyway. */
    const named = blocks.slice(first, start).some((b) => sameHeading(b.text, claim));
    if (!named) continue;

    repairs.push({
      where: `${where} > child ${child.childIndex + 1}`,
      kind: "heading",
      at: first,
      size: start - first,
    });
    child.start = first;
  }
  return repairs;
}
