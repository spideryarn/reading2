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
 * **What to do with a start that names no block** — whole-document answers only, and only
 * when the caller asks. docs/plans/261019l-structure-recovers-a-start-that-splices-the-line-number-into-the-id.md.
 *
 * - `refuse` — the answer is refused. The default, and the only mode the scoped cascade and the
 *   long-document slices use.
 * - `recover` — a first child is not asked (its start is pinned to its parent's whatever it says).
 *   Any other start that names no block is refused, so the step's re-ask still runs.
 *
 *   It also read a start that spliced the prompt's line number into the id (`spya-582xcf0dz`) as
 *   that line, until `toc/13`: the whole-document answer now gives the number itself, an integer
 *   the schema types, so there is no id to splice it into and the decoder went.
 *   docs/plans/261020aa-structure-answers-the-block-number-not-its-id.md.
 * - `recover-or-drop` — as `recover`, and on top of it a later start that names no block drops its
 *   child into the sibling before it, as a non-advancing start already does. For the last answer
 *   the step will get, where refusing costs the reader the whole tree and every mode built on it.
 */
export type UnresolvedStarts = "refuse" | "recover" | "recover-or-drop";

/** One start that named no block and did not refuse the answer. A first child's is not one. */
export interface UnresolvedStart {
  where: string;
  /** Position in the model's proposal for this sibling set, as in `where`. */
  childIndex: number;
  outcome: "dropped";
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

interface RecoveredClaims {
  claimed: number[];
  dropped: Set<number>;
  droppedChildren: string[];
  unresolvedStarts: UnresolvedStart[];
  refusedChildIndex?: number;
}

/** Resolve the opt-in whole-document exceptions before the ordinary tiling planner runs. */
function recoverStartClaims(opts: {
  resolved: readonly (number | undefined)[];
  parent: readonly [number, number];
  where: string;
  unresolved: Exclude<UnresolvedStarts, "refuse">;
}): RecoveredClaims {
  const { resolved, where, unresolved } = opts;
  const [p0] = opts.parent;
  const claimed: number[] = [];
  const dropped = new Set<number>();
  const droppedChildren: string[] = [];
  const unresolvedStarts: UnresolvedStart[] = [];

  for (const [childIndex, real] of resolved.entries()) {
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
    if (unresolved === "recover") {
      return { claimed, dropped, droppedChildren, unresolvedStarts, refusedChildIndex: childIndex };
    }
    /* `recover-or-drop`: nothing says where this child begins, so it is not
       built. The placeholder keeps `claimed` indexed by child; the planning
       loop below skips it. */
    dropped.add(childIndex);
    claimed.push(p0);
    droppedChildren.push(`${where} > child ${childIndex + 1}`);
    unresolvedStarts.push({
      where: `${where} > child ${childIndex + 1}`,
      childIndex,
      outcome: "dropped",
    });
  }

  return { claimed, dropped, droppedChildren, unresolvedStarts };
}

type KeptClaims =
  | { ok: true; kept: { childIndex: number; start: number }[] }
  | { ok: false; outsideChildIndex: number };

/** Apply the policy's range rule and discard claims that mark no new split point. */
function keepStartClaims(opts: {
  claimed: readonly number[];
  dropped: ReadonlySet<number>;
  parent: readonly [number, number];
  policy: StartRangePolicy;
  where: string;
  droppedChildren: string[];
}): KeptClaims {
  const { claimed, dropped, policy, where, droppedChildren } = opts;
  const [p0, p1] = opts.parent;
  if (policy.outsideParent === "refuse") {
    const outsideChildIndex = claimed.findIndex((at) => at < p0 || at > p1);
    if (outsideChildIndex !== -1) return { ok: false, outsideChildIndex };
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
  return { ok: true, kept };
}

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

  /* **Whole-document exceptions, in document order.** The first unresolved
     start is pinned to its parent. A later one either refuses the answer or is
     marked for dropping; real starts continue to the ordinary planner. */
  let claimed: number[];
  let dropped: Set<number>;
  if (unresolved === "refuse") {
    claimed = resolved as number[];
    dropped = new Set<number>();
  } else {
    const recovered = recoverStartClaims({
      resolved,
      parent: [p0, p1],
      where,
      unresolved,
    });
    claimed = recovered.claimed;
    dropped = recovered.dropped;
    droppedChildren.push(...recovered.droppedChildren);
    unresolvedStarts.push(...recovered.unresolvedStarts);
    if (recovered.refusedChildIndex !== undefined) return refuse(recovered.refusedChildIndex);
  }

  /* **Every claim is range-checked, the first one included.** The check once sat
     below the pin, so a scoped answer whose first start named a block in a
     sibling section passed with that sibling's title and gist attached to this
     parent's prose. The pin is a rule about the parent's own first block, not a
     licence to believe a claim from outside it. */
  const plannedClaims = keepStartClaims({
    claimed,
    dropped,
    parent: [p0, p1],
    policy,
    where,
    droppedChildren,
  });
  if (!plannedClaims.ok) {
    const outside = plannedClaims.outsideChildIndex;
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
  const { kept } = plannedClaims;

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
