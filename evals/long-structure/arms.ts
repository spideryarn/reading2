/**
 * The four ways of getting a long document's table of contents that the eval
 * compares. Plan 261005j § Stage 2.
 *
 *  - `one`: the ordinary single whole-document call, where it fits.
 *  - `A`: today's path past the line: `runSlices`, then the stitch, as
 *    `generateStructure` does it. Run only on documents past the line.
 *  - `B`: one call for the top level, then one call per part for its sections
 *    and their gists. The per-part call is the scoped expansion prompt
 *    (src/structure-expand.ts), unchanged.
 *  - `C`: as B, but the per-part call returns starts and titles only, and a
 *    third round writes the gists.
 *
 * Every arm runs cold (no checkpoint is read or written), writes nothing to
 * the database, and hands back a `ModelNode` proposal. `finishTree` is the one
 * build every proposal goes through; a tree that fails it is a failed cell,
 * never mended.
 */
import { type AiCallRow, collectSpend } from "../../src/ai-spend.js";
import { buildBoundedHeadingTree } from "../../src/heading-tree.js";
import { parseJsonAnswer } from "../../src/parse-json.js";
import { CASCADE_RECIPE, ExpansionRefused, type ExpansionTarget, normaliseExpansion, type ProposedChild } from "../../src/structure-cascade.js";
import { readExpansion } from "../../src/structure-deepen.js";
import { expansionRequest, expectedChildren, renderFrozenOutline } from "../../src/structure-expand.js";
import {
  acceptRoot,
  planSlices,
  runSlices,
  seamsHeld,
  SLICE_CALL_CAP_MS,
  SLICE_CONCURRENCY,
  type SliceDeps,
  slicesDeadline,
  sliceStarts,
} from "../../src/structure-slices.js";
import {
  type BuildReport,
  buildTree,
  canonicalWholeDocumentRequest,
  estimateStructureTokens,
  type ModelNode,
  parseWholeDocumentAnswer,
  questionFor,
  STRUCTURE_HEADROOM,
  wholeDocumentRequest,
} from "../../src/structure.js";
import { nullCheckpointStore } from "../../src/store/checkpoints.js";
import { appendSupplement, isSupplementNode, splitBlocks } from "../../src/supplement.js";
import { THINKING_HEADROOM, TooLongForOnePass } from "../../src/token-budget.js";
import { assertTreeSound, checkTree } from "../../src/tree-invariants.js";
import type { Block, Tree } from "../../src/types.js";
import {
  ask,
  type CallContext,
  type CallRecord,
  estimateUsd,
  type FailureReason,
  inPool,
  type Ledger,
  POWER,
  recordsFromRows,
  requestTokens,
  ShapeFault,
} from "./calls.js";
import type { Doc } from "./corpus.js";
import { gistsRequest, type PartBriefing, sectionsRequest, topRequest } from "./prompts.js";

export const ARMS = ["one", "A", "B", "C"] as const;
export type Arm = (typeof ARMS)[number];

/** A part of this many blocks or fewer gets no second-round call: its children are its paragraphs. */
export const SMALL_PART_BLOCKS = 12;
/** The queue's budget for the structure step (`STEP_BUDGET_MS.structure`, src/jobs.ts), which arm A's deadline is cut from. */
const STEP_BUDGET_MS = 700_000;
/** Longest the whole-document call and the top-level call may run here. */
const WHOLE_CALL_CAP_MS = 700_000;
const TOP_CALL_CAP_MS = 400_000;

export type CellStatus =
  | "ok"
  | "failed"
  /* `wholeDocumentRequest` threw `TooLongForOnePass`: the answer cannot fit one call. */
  | "does-not-fit"
  /* The top-level call's request is larger than the model's context window. */
  | "input-does-not-fit"
  /* Arm A on a document under the line, where `one` is today's output. */
  | "not-run";

export interface ArmResult {
  status: CellStatus;
  /** Why, for anything but `ok`. A reason's name, never the article's words. */
  failure?: string;
  startedAt: string;
  /** Milliseconds from the arm's start to each stage. `null` where the arm never got there. */
  topMs: number | null;
  /** Arm C only: every section has its start and title, none has a gist yet. */
  titlesMs: number | null;
  treeMs: number | null;
  calls: CallRecord[];
  proposal: ModelNode | null;
  build: Record<keyof BuildReport, number> | null;
  checkTreeProblems: string[];
  /** Arm-specific counts: slices, refills, parts with no second-round call, pieces. */
  detail: Record<string, unknown>;
}

export interface ArmContext {
  doc: Doc;
  cell: string;
  ledger: Ledger;
  /** The structure model's context window, in tokens. */
  contextTokens: number;
}

const emptyReport = (): BuildReport => ({
  repairs: [],
  droppedChildren: [],
  rangelessChildren: [],
  droppedHeadings: [],
  collapsedRungs: [],
  droppedQuestions: [],
});

const countReport = (r: BuildReport): Record<keyof BuildReport, number> => ({
  repairs: r.repairs.length,
  droppedChildren: r.droppedChildren.length,
  rangelessChildren: r.rangelessChildren.length,
  droppedHeadings: r.droppedHeadings.length,
  collapsedRungs: r.collapsedRungs.length,
  droppedQuestions: r.droppedQuestions.length,
});

/** The one build every arm's proposal goes through. Throws what `buildTree` throws. */
export function finishTree(doc: Doc, proposal: ModelNode): { tree: Tree; bodyTree: Tree; built: BuildReport; problems: string[] } {
  const { groups } = splitBlocks(doc.blocks);
  const built = emptyReport();
  const bodyTree = buildTree(proposal, {}, doc.body, doc.slug, built);
  const tree = appendSupplement(bodyTree, groups);
  return { tree, bodyTree, built, problems: checkTree(doc.blocks, tree).problems };
}

const started = (): { at: number; iso: string } => ({ at: Date.now(), iso: new Date().toISOString() });

function result(
  begun: { at: number; iso: string },
  calls: CallRecord[],
  over: Partial<ArmResult> & { status: CellStatus },
): ArmResult {
  return {
    startedAt: begun.iso,
    topMs: null,
    titlesMs: null,
    treeMs: null,
    calls,
    proposal: null,
    build: null,
    checkTreeProblems: [],
    detail: {},
    ...over,
  };
}

/** Build the proposal, and turn the outcome into the cell's last fields. */
function finished(
  ctx: ArmContext,
  begun: { at: number; iso: string },
  calls: CallRecord[],
  proposal: ModelNode,
  over: Partial<ArmResult>,
): ArmResult {
  try {
    const { built, problems } = finishTree(ctx.doc, proposal);
    return result(begun, calls, {
      status: problems.length === 0 ? "ok" : "failed",
      ...(problems.length === 0 ? {} : { failure: "checkTree" }),
      proposal,
      build: countReport(built),
      checkTreeProblems: problems.slice(0, 20),
      treeMs: Date.now() - begun.at,
      ...over,
    });
  } catch (err) {
    return result(begun, calls, { status: "failed", failure: `build:${(err as Error).name}`, proposal, ...over });
  }
}

const callContext = (ctx: ArmContext, calls: CallRecord[]): CallContext => ({
  cell: ctx.cell,
  slug: ctx.doc.slug,
  ledger: ctx.ledger,
  calls,
});

/* ------------------------------------------------------------------ one -- */

export async function armOne(ctx: ArmContext): Promise<ArmResult> {
  const begun = started();
  const calls: CallRecord[] = [];
  const { doc } = ctx;
  let request: ReturnType<typeof wholeDocumentRequest>;
  try {
    request = wholeDocumentRequest(doc.body);
  } catch (err) {
    if (!(err instanceof TooLongForOnePass)) throw err;
    return result(begun, calls, { status: "does-not-fit", failure: "answer-too-long" });
  }
  const { groups } = splitBlocks(doc.blocks);
  const got = await ask(callContext(ctx, calls), {
    purpose: "whole-document",
    params: request.params,
    maxTokens: request.maxTokens,
    answerTokens: estimateStructureTokens(doc.body),
    headroom: STRUCTURE_HEADROOM,
    capMs: WHOLE_CALL_CAP_MS,
    /* Everything `generateStructure` § `treeFrom` asks of an answer before it keeps it. */
    accept: (text) => {
      const { root } = parseWholeDocumentAnswer(text, doc.body);
      assertTreeSound(doc.blocks, appendSupplement(buildTree(root, {}, doc.body, doc.slug), groups));
      return root;
    },
  });
  if (!got.ok) return result(begun, calls, { status: "failed", failure: got.reason });
  const top = Date.now() - begun.at;
  return finished(ctx, begun, calls, got.value, { topMs: top });
}

/* -------------------------------------------------------------------- A -- */

/** `SLICE_DEPS` in src/structure.ts, which is not exported: the same six functions. */
const SLICE_DEPS: SliceDeps = {
  request: (blocks) => {
    const { params, user, maxTokens } = wholeDocumentRequest(blocks);
    return { params, user, maxTokens, answerTokens: estimateStructureTokens(blocks) };
  },
  headroom: STRUCTURE_HEADROOM,
  parse: parseWholeDocumentAnswer,
  build: buildTree,
  canonical: canonicalWholeDocumentRequest,
  question: questionFor,
};

const fitsOneAnswer = (blocks: Block[]): boolean => {
  try {
    wholeDocumentRequest(blocks);
    return true;
  } catch {
    return false;
  }
};

export async function armA(ctx: ArmContext): Promise<ArmResult> {
  const begun = started();
  const { doc } = ctx;
  if (fitsOneAnswer(doc.body)) return result(begun, [], { status: "not-run", failure: "under-the-line" });
  const bounded = buildBoundedHeadingTree(doc.blocks, doc.slug, doc.title).tree;
  /* The same plan `runSlices` will make, for the cap's estimate only. */
  const plan = planSlices(doc.body, sliceStarts(doc.body, bounded), fitsOneAnswer);
  const estimate = (plan ?? []).reduce((a, s) => {
    const blocks = doc.body.slice(s.lo, s.hi + 1);
    return a + estimateUsd(wholeDocumentRequest(blocks).params, estimateStructureTokens(blocks));
  }, 0.05);
  const release = ctx.ledger.admit(estimate);
  const rows: AiCallRow[] = [];
  const { result: sliced } = await collectSpend(
    () =>
      runSlices({
        body: doc.body,
        slug: doc.slug,
        bounded,
        power: POWER,
        checkpoints: nullCheckpointStore(),
        deps: SLICE_DEPS,
        deadline: slicesDeadline(begun.at, STEP_BUDGET_MS),
      }),
    {
      attribution: { scopeKind: "eval", articleSlug: doc.slug },
      sink: async (row) => {
        rows.push(row);
      },
    },
  );
  release();
  /* `runSlices` does not say which call was which. The root call is the last
     one started when the path succeeded; every other is a slice or a refill. */
  const purposeOf = (_row: AiCallRow, i: number): string => (sliced.ok && i === rows.length - 1 ? "root" : "slice-or-refill");
  const calls = recordsFromRows(rows, purposeOf);
  [...rows]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .forEach((row, i) => {
      ctx.ledger.write(ctx.cell, purposeOf(row, i), undefined, 1, row);
    });
  const detail = {
    slices: sliced.slices,
    reasked: sliced.reasked,
    startedRequests: sliced.spend.calls,
    refilled: sliced.ok ? sliced.refilled : null,
    plannedSlices: plan?.length ?? null,
  };
  if (!sliced.ok) return result(begun, calls, { status: "failed", failure: `slices:${sliced.failure}`, detail });
  const top = Date.now() - begun.at;
  /* The stitch, as `generateStructure` does it: one build, the seams, the checks. */
  try {
    const { bodyTree, built, problems } = finishTree(doc, sliced.proposal);
    const over = { proposal: sliced.proposal, build: countReport(built), checkTreeProblems: problems.slice(0, 20), topMs: top, detail };
    if (!seamsHeld(bodyTree, sliced.sections, sliced.seams)) return result(begun, calls, { status: "failed", failure: "slices:tree-unsound(seams)", ...over });
    if (problems.length > 0) return result(begun, calls, { status: "failed", failure: "slices:tree-unsound(checkTree)", ...over });
    return result(begun, calls, { status: "ok", ...over, treeMs: Date.now() - begun.at });
  } catch (err) {
    return result(begun, calls, { status: "failed", failure: `slices:tree-unsound(${(err as Error).name})`, proposal: sliced.proposal, detail });
  }
}

/* ------------------------------------------------------------- B and C -- */

interface TopAnswer {
  root: { gist: string; question: string };
  parts: ModelNode[];
}

type TopOutcome = { ok: true; top: TopAnswer } | { ok: false; status: CellStatus; failure: string; detail: Record<string, unknown> };

/** Call 1: the whole document in, the top level out. */
async function topLevel(ctx: ArmContext, calls: CallRecord[]): Promise<TopOutcome> {
  const { doc } = ctx;
  const bounded = buildBoundedHeadingTree(doc.blocks, doc.slug, doc.title).tree;
  const headed = Object.values(bounded.nodes).filter((n) => n.depth === 1 && n.children.length > 0 && !isSupplementNode(n)).length;
  const request = topRequest(doc.body, headed);
  const wanted = requestTokens(request.params) + request.maxTokens;
  const fit = { requestTokensEstimated: requestTokens(request.params), maxTokens: request.maxTokens, contextTokens: ctx.contextTokens };
  if (wanted > ctx.contextTokens) return { ok: false, status: "input-does-not-fit", failure: "input-does-not-fit", detail: fit };
  const whole: [string, string] = [doc.body[0]!.id, doc.body.at(-1)!.id];
  const got = await ask<TopAnswer>(callContext(ctx, calls), {
    purpose: "top",
    params: request.params,
    maxTokens: request.maxTokens,
    answerTokens: request.answerTokens,
    headroom: request.headroom,
    capMs: TOP_CALL_CAP_MS,
    accept: (text) => {
      const answer = parseJsonAnswer<{ gist?: unknown; question?: unknown; parts?: unknown }>(text, "the top-level response");
      if (!Array.isArray(answer.parts)) throw new ShapeFault("no parts");
      const proposed = answer.parts.map((p): ProposedChild => {
        const part = p as Record<string, unknown>;
        for (const field of ["start", "title", "gist"] as const) {
          if (typeof part[field] !== "string" || (part[field] as string).trim() === "") throw new ShapeFault(`a part has no ${field}`);
        }
        return {
          start: part.start as string,
          title: part.title as string,
          gist: part.gist as string,
          ...(typeof part.question === "string" ? { question: part.question } : {}),
          ...(typeof part.sourceHeading === "string" ? { sourceHeading: part.sourceHeading } : {}),
        };
      });
      /* The root's two lines pass the bar the slices path's root call sets. */
      const root = acceptRoot(JSON.stringify({ gist: answer.gist, question: answer.question }), questionFor);
      const parts = normaliseExpansion({ children: proposed, parent: whole, blocks: doc.body, where: "root", report: emptyReport() });
      return { root, parts: parts.map((p) => p.node) };
    },
  });
  if (!got.ok) return { ok: false, status: "failed", failure: `top:${got.reason}`, detail: fit };
  return { ok: true, top: got.value };
}

/**
 * A part the model returns as one section has no sections: its children are
 * its paragraphs, as for a small part. `normaliseExpansion` refuses fewer than
 * two children (the cascade has no use for a level that divides nothing), and
 * the first paid run lost arm C to exactly that, twice, on one part.
 * The slices path keeps the original section in the same case (its refill).
 */
function oneSectionIsNone(read: () => ModelNode[]): ModelNode[] {
  try {
    return read();
  } catch (err) {
    if (err instanceof ExpansionRefused && err.reason === "not-an-expansion") return [];
    throw err;
  }
}

interface Unit {
  part: number;
  /** The part itself, or one piece of a part too big for one call. */
  lo: number;
  hi: number;
  label: string;
}

/**
 * The calls one round makes: one per part over `SMALL_PART_BLOCKS`, or several
 * where the part is too big for one call, cut by the slices planner.
 * `null` in place of a part's units means it could not be cut.
 */
function unitsFor(doc: Doc, parts: readonly ModelNode[], bounded: Tree, fits: (blocks: Block[]) => boolean): (Unit[] | null)[] {
  const index = new Map(doc.body.map((b, i) => [b.id, i]));
  return parts.map((part, p) => {
    const lo = index.get(part.range[0])!;
    const hi = index.get(part.range[1])!;
    if (hi - lo + 1 <= SMALL_PART_BLOCKS) return [];
    const blocks = doc.body.slice(lo, hi + 1);
    if (fits(blocks)) return [{ part: p, lo, hi, label: `part ${p + 1}` }];
    const pieces = planSlices(blocks, sliceStarts(blocks, bounded), fits);
    if (pieces === null) return null;
    return pieces.map((s, k) => ({ part: p, lo: lo + s.lo, hi: lo + s.hi, label: `part ${p + 1} piece ${k + 1} of ${pieces.length}` }));
  });
}

/** The proposal B and C hand to the final build: the root, its parts, and each part's sections. */
function assemble(doc: Doc, top: TopAnswer, sections: readonly (ModelNode[] | undefined)[]): ModelNode {
  return {
    title: doc.title,
    gist: top.root.gist,
    question: top.root.question,
    range: [doc.body[0]!.id, doc.body.at(-1)!.id],
    children: top.parts.map((part, i) => ({ ...part, ...(sections[i]?.length ? { children: sections[i]! } : {}) })),
  };
}

const briefingOf = (doc: Doc, outline: string, part: ModelNode): PartBriefing => ({
  documentTitle: doc.title,
  outline,
  title: part.title,
  gist: part.gist ?? "",
});

/**
 * Round 2, shared by B and C: every unit asked at `SLICE_CONCURRENCY`, its
 * children concatenated per part. Returns the parts' sections, or the reasons
 * some part has none.
 */
async function secondRound(
  ctx: ArmContext,
  top: TopAnswer,
  fits: (blocks: Block[]) => boolean,
  askUnit: (unit: Unit, part: ModelNode) => Promise<{ ok: true; value: ModelNode[] } | { ok: false; reason: FailureReason }>,
): Promise<{ sections: (ModelNode[] | undefined)[]; failures: string[]; detail: Record<string, unknown> }> {
  const { doc } = ctx;
  const bounded = buildBoundedHeadingTree(doc.blocks, doc.slug, doc.title).tree;
  const planned = unitsFor(doc, top.parts, bounded, fits);
  const failures: string[] = planned.flatMap((u, p) => (u === null ? [`part ${p + 1}:could-not-plan`] : []));
  const units = planned.flatMap((u) => u ?? []);
  const answers = await inPool(
    SLICE_CONCURRENCY,
    units.map((unit) => () => askUnit(unit, top.parts[unit.part]!)),
  );
  const sections: (ModelNode[] | undefined)[] = top.parts.map(() => undefined);
  const bad = new Set<number>();
  units.forEach((unit, i) => {
    const got = answers[i]!;
    if (!got.ok) {
      failures.push(`${unit.label}:${got.reason}`);
      bad.add(unit.part);
      return;
    }
    /* One piece of a cut-up part that came back as one section would leave its blocks under no section. */
    if (got.value.length === 0 && units.filter((u) => u.part === unit.part).length > 1) {
      failures.push(`${unit.label}:tiling`);
      bad.add(unit.part);
      return;
    }
    sections[unit.part] = [...(sections[unit.part] ?? []), ...got.value];
  });
  for (const p of bad) sections[p] = undefined;
  return {
    sections,
    failures,
    detail: {
      parts: top.parts.length,
      partsWithNoSecondCall: planned.filter((u) => u !== null && u.length === 0).length,
      partsCutIntoPieces: planned.filter((u) => u !== null && u.length > 1).length,
      secondRoundUnits: units.length,
    },
  };
}

export async function armB(ctx: ArmContext): Promise<ArmResult> {
  const begun = started();
  const calls: CallRecord[] = [];
  const { doc } = ctx;
  const first = await topLevel(ctx, calls);
  if (!first.ok) return result(begun, calls, { status: first.status, failure: first.failure, detail: first.detail });
  const { top } = first;
  const topMs = Date.now() - begun.at;
  const outline = renderFrozenOutline(assemble(doc, top, []));
  const ancestors = [{ title: doc.title, gist: top.root.gist }];
  const requestFor = (unit: Pick<Unit, "lo" | "hi" | "part">, part: ModelNode) => {
    const target: ExpansionTarget = {
      node: { status: "pending", title: part.title, ...(part.gist !== undefined ? { gist: part.gist } : {}), range: [doc.body[unit.lo]!.id, doc.body[unit.hi]!.id] },
      where: `root > child ${unit.part + 1}`,
    };
    return { target, request: expansionRequest({ briefings: [{ target, ancestors }], blocks: doc.body, outline, recipe: CASCADE_RECIPE, power: POWER }) };
  };
  /* One call's worth: the cascade's own ceiling on a request, and a budget that does not throw. */
  const fits = (blocks: Block[]): boolean => {
    const index = new Map(doc.body.map((b, i) => [b.id, i]));
    try {
      const { request } = requestFor({ part: 0, lo: index.get(blocks[0]!.id)!, hi: index.get(blocks.at(-1)!.id)! }, { title: "", range: ["", ""] });
      return requestTokens(request.params) <= CASCADE_RECIPE.maxRequestTokensPerBatch;
    } catch {
      return false;
    }
  };
  const round = await secondRound(ctx, top, fits, (unit, part) => {
    const { target, request } = requestFor(unit, part);
    return ask(callContext(ctx, calls), {
      purpose: "part-sections+gists",
      unit: unit.label,
      params: request.params,
      maxTokens: request.maxTokens,
      answerTokens: 200 + expectedChildren(target.node, doc.body, CASCADE_RECIPE) * 200,
      headroom: THINKING_HEADROOM,
      capMs: SLICE_CALL_CAP_MS,
      accept: (text) => oneSectionIsNone(() => readExpansion({ raw: text, targets: [target], blocks: doc.body }).targets[0]!.children.map((c) => c.node)),
    });
  });
  const detail = { ...round.detail, secondRoundPrompt: "EXPAND_SYSTEM, unchanged" };
  if (round.failures.length > 0) {
    return result(begun, calls, { status: "failed", failure: `round2:${round.failures.join(",")}`, topMs, detail });
  }
  return finished(ctx, begun, calls, assemble(doc, top, round.sections), { topMs, detail });
}

export async function armC(ctx: ArmContext): Promise<ArmResult> {
  const begun = started();
  const calls: CallRecord[] = [];
  const { doc } = ctx;
  const first = await topLevel(ctx, calls);
  if (!first.ok) return result(begun, calls, { status: first.status, failure: first.failure, detail: first.detail });
  const { top } = first;
  const topMs = Date.now() - begun.at;
  const outline = renderFrozenOutline(assemble(doc, top, []));
  const index = new Map(doc.body.map((b, i) => [b.id, i]));
  const slice = (node: ModelNode): Block[] => doc.body.slice(index.get(node.range[0])!, index.get(node.range[1])! + 1);
  const blank = briefingOf(doc, outline, { title: "", range: ["", ""] });
  const fits = (blocks: Block[]): boolean => {
    try {
      return requestTokens(sectionsRequest(blank, blocks).params) <= CASCADE_RECIPE.maxRequestTokensPerBatch;
    } catch {
      return false;
    }
  };
  const round2 = await secondRound(ctx, top, fits, (unit, part) => {
    const blocks = doc.body.slice(unit.lo, unit.hi + 1);
    const request = sectionsRequest(briefingOf(doc, outline, part), blocks);
    return ask(callContext(ctx, calls), {
      purpose: "part-sections",
      unit: unit.label,
      ...request,
      capMs: SLICE_CALL_CAP_MS,
      accept: (text) => {
        const answer = parseJsonAnswer<{ sections?: unknown }>(text, "the part-sections response");
        if (!Array.isArray(answer.sections)) throw new ShapeFault("no sections");
        const proposed = answer.sections.map((s): ProposedChild => {
          const section = s as Record<string, unknown>;
          if (typeof section.start !== "string" || typeof section.title !== "string" || section.title.trim() === "") throw new ShapeFault("a section has no start or title");
          return { start: section.start, title: section.title, ...(typeof section.sourceHeading === "string" ? { sourceHeading: section.sourceHeading } : {}) };
        });
        return oneSectionIsNone(() => normaliseExpansion({
          children: proposed,
          parent: [doc.body[unit.lo]!.id, doc.body[unit.hi]!.id],
          blocks: doc.body,
          where: `root > child ${unit.part + 1}`,
          report: emptyReport(),
        }).map((c) => c.node));
      },
    });
  });
  if (round2.failures.length > 0) {
    return result(begun, calls, { status: "failed", failure: `round2:${round2.failures.join(",")}`, topMs, detail: round2.detail });
  }
  const titlesMs = Date.now() - begun.at;

  /* Round 3: one call per part that has sections, or several where the part's
     text is too big for one call, each over a consecutive run of its sections. */
  const gistFits = (briefing: PartBriefing, sections: ModelNode[]): boolean => {
    try {
      return requestTokens(gistsRequest(briefing, sections.map((s) => ({ title: s.title, blocks: slice(s) }))).params) <= CASCADE_RECIPE.maxRequestTokensPerBatch;
    } catch {
      return false;
    }
  };
  const groups: { part: number; from: number; sections: ModelNode[]; label: string }[] = [];
  const failures: string[] = [];
  round2.sections.forEach((sections, p) => {
    if (!sections?.length) return;
    const briefing = briefingOf(doc, outline, top.parts[p]!);
    const cutUp = (from: number, run: ModelNode[]): void => {
      if (gistFits(briefing, run)) groups.push({ part: p, from, sections: run, label: `part ${p + 1}` });
      else if (run.length === 1) failures.push(`part ${p + 1}:could-not-plan`);
      else {
        const half = Math.ceil(run.length / 2);
        cutUp(from, run.slice(0, half));
        cutUp(from + half, run.slice(half));
      }
    };
    cutUp(0, sections);
  });
  const answers = await inPool(
    SLICE_CONCURRENCY,
    groups.map((group) => () => {
      const request = gistsRequest(
        briefingOf(doc, outline, top.parts[group.part]!),
        group.sections.map((s) => ({ title: s.title, blocks: slice(s) })),
      );
      return ask(callContext(ctx, calls), {
        purpose: "part-gists",
        unit: `${group.label}${group.from > 0 || group.sections.length < round2.sections[group.part]!.length ? ` sections from ${group.from + 1}` : ""}`,
        ...request,
        capMs: SLICE_CALL_CAP_MS,
        accept: (text) => {
          const answer = parseJsonAnswer<{ gists?: unknown }>(text, "the section-gists response");
          if (!Array.isArray(answer.gists)) throw new ShapeFault("no gists");
          const byNumber = new Map<number, string>();
          for (const g of answer.gists as { section?: unknown; gist?: unknown }[]) {
            if (typeof g.section !== "number" || typeof g.gist !== "string" || g.gist.trim() === "") throw new ShapeFault("a gist entry is not a number and a sentence");
            if (byNumber.has(g.section)) throw new ShapeFault("a section is answered twice");
            byNumber.set(g.section, g.gist.trim());
          }
          const gists = group.sections.map((_s, i) => byNumber.get(i + 1));
          if (byNumber.size !== group.sections.length || gists.some((g) => g === undefined)) throw new ShapeFault("the gists do not cover the sections asked about");
          return gists as string[];
        },
      });
    }),
  );
  const withGists = round2.sections.map((sections) => sections?.map((s) => ({ ...s })));
  groups.forEach((group, i) => {
    const got = answers[i]!;
    if (!got.ok) {
      failures.push(`${group.label}:${got.reason}`);
      return;
    }
    got.value.forEach((gist, k) => {
      withGists[group.part]![group.from + k]!.gist = gist;
    });
  });
  const detail = { ...round2.detail, thirdRoundCalls: groups.length };
  if (failures.length > 0) {
    return result(begun, calls, { status: "failed", failure: `round3:${failures.join(",")}`, topMs, titlesMs, detail });
  }
  return finished(ctx, begun, calls, assemble(doc, top, withGists), { topMs, titlesMs, detail });
}

export const RUN_ARM: Record<Arm, (ctx: ArmContext) => Promise<ArmResult>> = { one: armOne, A: armA, B: armB, C: armC };
