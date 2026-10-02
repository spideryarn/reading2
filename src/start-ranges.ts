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
}): StartRangeResult<C> {
  const { children, blocks, index, where, policy } = opts;
  const [p0, p1] = opts.parent;
  const repairs: PartitionRepair[] = [];
  const droppedChildren: string[] = [];

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
    };
  }

  /* Resolve the whole sibling set before planning any of it. An invented id
     therefore refuses the answer rather than returning a partially built set. */
  const claimed: number[] = [];
  for (const [childIndex, child] of children.entries()) {
    const start = child.start;
    const at = typeof start === "string" ? index.get(start) : undefined;
    if (at === undefined) {
      return {
        ok: false,
        reason: "invented-start",
        childIndex,
        start,
        repairs,
        droppedChildren,
      };
    }
    claimed.push(at);
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
      };
    }
  }

  const clamp = (at: number) => Math.min(Math.max(at, p0), p1);
  const kept: { childIndex: number; start: number }[] = [];
  for (const [childIndex, raw] of claimed.entries()) {
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

  if (kept.length < policy.minimumChildren) {
    return {
      ok: false,
      reason: "not-an-expansion",
      usableChildren: kept.length,
      proposedChildren: children.length,
      repairs,
      droppedChildren,
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
  return { ok: true, children: derived, repairs, droppedChildren };
}
