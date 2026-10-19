/**
 * **The shared starts-to-ranges kernel for Structure's two tilings.**
 *
 * A list of starts becomes a complete, ordered tiling: the first kept child is
 * pinned to its parent, later starts must advance, each end is one block before
 * the next start, and the final child reaches the parent end. Heading snapping
 * is applied once here, so the whole-document and scoped paths cannot disagree.
 *
 * The policies remain explicit because the calls have different evidence. A
 * whole-document answer saw the whole body, so an outside-parent start is
 * clamped and a sole child is allowed for `buildTree` to collapse. A scoped
 * answer saw only its parent, so an outside start is refused, and fewer than two
 * kept children is not an expansion and is refused too.
 */
import { snapStartsToHeadings } from "./heading-snap.js";
import type { PartitionRepair } from "./structure.js";
import type { Block } from "./types.js";

export interface StartProposal {
  start: unknown;
  sourceHeading?: unknown;
}

export const WHOLE_DOCUMENT_START_POLICY = {
  outsideParent: "clamp",
  minimumChildren: 0,
} as const;

export const SCOPED_START_POLICY = {
  outsideParent: "refuse",
  minimumChildren: 2,
} as const;

export type StartRangePolicy =
  | typeof WHOLE_DOCUMENT_START_POLICY
  | typeof SCOPED_START_POLICY;

/**
 * **What to do with a start that is not a block id** — whole-document answers only, and only
 * when the caller asks. docs/plans/261019l-structure-recovers-a-start-that-splices-the-line-number-into-the-id.md.
 *
 * - `refuse` — the answer is refused. The default, and the only mode the scoped cascade and the
 *   long-document slices use.
 * - `recover` — a first child is not asked (its start is pinned to its parent's whatever it says),
 *   and a start that splices the prompt's line number into the id resolves to that line
 *   (`splicedLineNumber`). Anything else is refused, so the step's re-ask still runs.
 * - `recover-or-drop` — as `recover`, and on top of it a start nothing recovers drops its child
 *   into the sibling before it, as a non-advancing start already does. For the last answer the
 *   step will get, where refusing costs the reader the whole tree and every mode built on it.
 */
export type UnresolvedStarts = "refuse" | "recover" | "recover-or-drop";

/** One start that was not a block id and did not refuse the answer. A first child's is not one. */
export interface UnresolvedStart {
  where: string;
  /** Position in the model's proposal for this sibling set, as in `where`. */
  childIndex: number;
  outcome: "line-number" | "dropped";
}

export interface DerivedStartRange<C extends StartProposal> {
  proposed: C;
  childIndex: number;
  start: number;
  end: number;
  range: [string, string];
}

interface PlannedEvidence {
  repairs: PartitionRepair[];
  droppedChildren: string[];
  unresolvedStarts: UnresolvedStart[];
}

export type StartRangeResult<C extends StartProposal> =
  | ({ ok: true; children: DerivedStartRange<C>[] } & PlannedEvidence)
  | ({
      ok: false;
      reason: "invented-start";
      childIndex: number;
      start: unknown;
    } & PlannedEvidence)
  | ({
      ok: false;
      reason: "outside-parent";
      childIndex: number;
      start: unknown;
    } & PlannedEvidence)
  | ({
      ok: false;
      reason: "not-an-expansion";
      usableChildren: number;
      proposedChildren: number;
    } & PlannedEvidence);

/** Derive one sibling set without mutating its proposals, blocks, index or policy. */
export function deriveStartRanges<C extends StartProposal>(opts: {
  children: readonly C[];
  parent: readonly [number, number];
  blocks: readonly Block[];
  index: ReadonlyMap<string, number>;
  where: string;
  policy: StartRangePolicy;
  /** Only ever set by a whole-document caller; `refuse` when absent. */
  unresolved?: UnresolvedStarts;
}): StartRangeResult<C> {
  const { children, blocks, index, where, policy } = opts;
  const unresolved = opts.unresolved ?? "refuse";
  const [p0, p1] = opts.parent;
  const repairs: PartitionRepair[] = [];
  const droppedChildren: string[] = [];
  const unresolvedStarts: UnresolvedStart[] = [];

  /* Empty is knowably not an expansion before there is anything to resolve.
     A one-child scoped answer is different: the incumbent resolves and
     range-checks that claim first, so an invented or outside start keeps its
     more precise refusal instead of being hidden by `not-an-expansion`. */
  if (children.length === 0 && policy.minimumChildren > 0) {
    return {
      ok: false,
      reason: "not-an-expansion",
      usableChildren: children.length,
      proposedChildren: children.length,
      repairs,
      droppedChildren,
      unresolvedStarts,
    };
  }

  /* Resolve the whole sibling set before planning any of it. An invented id
     therefore refuses the answer rather than returning a partially built set —
     unless the caller asked for `recover`, below. */
  const resolved: (number | undefined)[] = children.map((child) =>
    typeof child.start === "string" ? index.get(child.start) : undefined,
  );
  const refuse = (childIndex: number): StartRangeResult<C> => ({
    ok: false,
    reason: "invented-start",
    childIndex,
    start: children[childIndex]!.start,
    repairs,
    droppedChildren,
    unresolvedStarts,
  });
  if (unresolved === "refuse") {
    const first = resolved.indexOf(undefined);
    if (first !== -1) return refuse(first);
  }

  /* **Recovery, in document order.** A recovered start must land strictly
     after the previous start this set resolved (or the parent's start) and
     strictly before the next start that was a real id (or at most the parent's
     end), so it can neither reorder its siblings nor leave its parent. */
  const claimed: number[] = [];
  const dropped = new Set<number>();
  for (const [childIndex, child] of children.entries()) {
    const real = resolved[childIndex];
    if (real !== undefined) {
      claimed.push(real);
      continue;
    }
    /* A first child is pinned to its parent's start whatever it says, so an
       unresolvable one costs nothing and is not recorded. */
    if (childIndex === 0) {
      claimed.push(p0);
      continue;
    }
    const after = claimed.filter((_, i) => !dropped.has(i)).at(-1) ?? p0;
    const nextReal = resolved.slice(childIndex + 1).find((at) => at !== undefined);
    const before = Math.min(nextReal ?? p1 + 1, p1 + 1);
    const line = splicedLineNumber(child.start, blocks, after + 1, before - 1);
    if (line !== undefined) {
      claimed.push(line);
      unresolvedStarts.push({ where: `${where} > child ${childIndex + 1}`, childIndex, outcome: "line-number" });
      continue;
    }
    if (unresolved === "recover") return refuse(childIndex);
    /* `recover-or-drop`: nothing says where this child begins, so it is not
       built. The placeholder keeps `claimed` indexed by child; the planning
       loop below skips it. */
    dropped.add(childIndex);
    claimed.push(after);
    droppedChildren.push(`${where} > child ${childIndex + 1}`);
    unresolvedStarts.push({ where: `${where} > child ${childIndex + 1}`, childIndex, outcome: "dropped" });
  }

  /* **Every claim is range-checked, the first one included.** The check once sat
     below the pin, so a scoped answer whose first start named a block in a
     sibling section passed with that sibling's title and gist attached to this
     parent's prose. The pin is a rule about the parent's own first block, not a
     licence to believe a claim from outside it. */
  if (policy.outsideParent === "refuse") {
    const outside = claimed.findIndex((at) => at < p0 || at > p1);
    if (outside !== -1) {
      return {
        ok: false,
        reason: "outside-parent",
        childIndex: outside,
        start: children[outside]!.start,
        repairs,
        droppedChildren,
        unresolvedStarts,
      };
    }
  }

  const clamp = (at: number) => Math.min(Math.max(at, p0), p1);
  const kept: { childIndex: number; start: number }[] = [];
  for (const [childIndex, raw] of claimed.entries()) {
    if (dropped.has(childIndex)) continue;
    const at = policy.outsideParent === "clamp" ? clamp(raw) : raw;
    const previous = kept.at(-1);
    if (previous === undefined) {
      kept.push({ childIndex, start: p0 });
    } else if (at <= previous.start) {
      droppedChildren.push(`${where} > child ${childIndex + 1}`);
    } else {
      kept.push({ childIndex, start: at });
    }
  }

  /* **A drop may fold one section into its neighbour, not a sibling set into
     one section.** Two children with the second dropped would leave the first
     covering its whole parent — at the root, the whole article. ⟨GPT Sol, plan
     review r2, finding 4⟩ */
  const firstDrop = [...dropped][0];
  if (firstDrop !== undefined && kept.length < 2) return refuse(firstDrop);

  if (kept.length < policy.minimumChildren) {
    return {
      ok: false,
      reason: "not-an-expansion",
      usableChildren: kept.length,
      proposedChildren: children.length,
      repairs,
      droppedChildren,
      unresolvedStarts,
    };
  }

  /* Measure before snapping: the claim and the derived split are both evidence,
     while the snap records its own movement separately. With scoped refusal the
     later-start loop is structurally zero; with whole-document clamping it says
     exactly how far an outside claim was pulled back. */
  for (const child of kept) {
    const was = claimed[child.childIndex]!;
    const size = Math.abs(child.start - was);
    if (size > 0) {
      repairs.push({
        where: `${where} > child ${child.childIndex + 1}`,
        kind: was > child.start ? "gap" : "overlap",
        at: child.start,
        size,
      });
    }
  }
  repairs.push(...snapStartsToHeadings(children, kept, blocks, where));

  const derived = kept.map((child, keptIndex): DerivedStartRange<C> => {
    const next = kept[keptIndex + 1];
    const end = next === undefined ? p1 : next.start - 1;
    return {
      proposed: children[child.childIndex]!,
      childIndex: child.childIndex,
      start: child.start,
      end,
      /* In range: starts are the parent start, clamped claims, or in-parent
         claims; the snap is floored after the previous start. Ends are one
         before the next increasing start or the parent's already-resolved end. */
      range: [blocks[child.start]!.id, blocks[end]!.id],
    };
  });
  return { ok: true, children: derived, repairs, droppedChildren, unresolvedStarts };
}

/**
 * **The block a start names when the model copied its prompt line's number into the id.**
 *
 * `renderBlocks` (src/structure-prompt.ts) writes each block as `[582] spya-xcf0dz <h1>: …`, and at
 * effort `low` with a JSON schema the model sometimes copies that as `spya-582xcf0dz`, `spya-582xcf`
 * or `spya-582` — four of four re-runs of one production request did, 2026-10-19
 * (docs/postmortems/261019d-a-line-number-spliced-into-a-block-id-cost-the-whole-tree.md).
 *
 * Every split of the digit run is tried, because an id's own six characters may begin with digits:
 * a split is a candidate when its line number `N` is a block and what follows the number is a
 * prefix, possibly empty, of block `N`'s six characters. **Exactly one candidate across the whole
 * input, and then it must fall in `[lo, hi]`, or nothing.** Uniqueness first and the window second,
 * in that order: filtering by the window first would let a shorter split that happens to land
 * inside it win when the split the model meant lies outside — `spya-582xcf` read as line 58 because
 * block 58's id begins `2xcf`. ⟨GPT Sol, plan review r2, finding 1⟩ The window is then the evidence
 * the digits alone are not: the line has to fall where the section must begin, after its previous
 * sibling and before its next. `N` indexes the same array the prompt numbered, which is why only a
 * whole-document caller may use this — a scoped slice is numbered from 0.
 */
export function splicedLineNumber(
  start: unknown,
  blocks: readonly Block[],
  lo: number,
  hi: number,
): number | undefined {
  if (typeof start !== "string") return undefined;
  const spliced = /^spya-(\d+)([0-9a-z]*)$/.exec(start);
  if (spliced === null) return undefined;
  const digits = spliced[1]!;
  const tail = spliced[2]!;
  const candidates: number[] = [];
  for (let k = 1; k <= digits.length; k++) {
    if (k > 1 && digits[0] === "0") break;
    const line = Number(digits.slice(0, k));
    const rest = digits.slice(k) + tail;
    const own = blocks[line]?.id.slice("spya-".length);
    if (own !== undefined && own.startsWith(rest)) candidates.push(line);
  }
  const only = candidates.length === 1 ? candidates[0]! : undefined;
  return only !== undefined && only >= lo && only <= hi ? only : undefined;
}
