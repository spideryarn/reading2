/**
 * **Structure's stage 2: sub-sections where the author's own sub-headings
 * divide a section.** Plan docs/plans/261101d-structure-fourth-level-staged-second-call.md.
 *
 * Stage 1 is the whole-document call (`toc/13`), untouched: root, parts,
 * sections. This runs on the tree it made and only ever **adds** a level under
 * a section, so it cannot take a section away — the failure that sank both
 * one-call wordings in docs/investigations/261101b-structure-fourth-level-two-wordings-measured.md.
 *
 * The work is split along the line each side is good at:
 *
 * - **Code picks the sub-sections** (`planSubsections`, pure): the author's
 *   *immediate* sub-headings inside a section, compared by numbering first and
 *   tag second. No model decides where a sub-section starts, so there is no
 *   invented join and nothing to drift between runs.
 * - **One scoped call writes only the titles and gists** for those fixed
 *   pieces (`subsectionsRequest`), several sections a call, a few calls in
 *   flight. A wrong answer costs its own section, never the batch.
 *
 * Why not September's deepening wave (src/structure-deepen.ts), which is
 * Greg's same staged idea built for books: on articles it demotes a swallowed
 * sibling heading to a sub-section, flattens deeper headings beside their
 * parent, invents joins, is not limited to sections, and cost +180% on the
 * report's paper. The plan says so in full.
 */
import Anthropic from "@anthropic-ai/sdk";
import { type LeaseWindow, NeedsAnotherWindow } from "./another-window.js";
import { isBodyEvidence, isStructural } from "./block-policy.js";
import { WidthGate } from "./concurrency.js";
import { parseRetryAfter } from "./retry-after.js";
import { log } from "./log.js";
import { finishedText, streamMessage, type MessagesBody } from "./messages-stream.js";
import { withMessagesJsonSchema } from "./messages-structured-output.js";
import type { ModelPower } from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import { plainWords } from "./plain-words.js";
import { NO_LEVEL, headingLevel } from "./section-ranges.js";
import { proposalFromTree } from "./structure-cascade.js";
import { PRODUCTION_EFFORT, renderBlocks } from "./structure-prompt.js";
import { isSupplementNode } from "./supplement.js";
import { THINKING_HEADROOM } from "./token-budget.js";
/* Types only: src/structure.ts imports this file, so a value import from there
   would close a cycle. */
import type { ModelNode } from "./structure.js";
import type { Block, Tree, TreeNode } from "./types.js";

/** The prompt's stamp. Bump it with any change to `SUBSECTIONS_SYSTEM` or the request. */
export const SUBSECTIONS_PROMPT_VERSION = "subs/1";

/* ------------------------------------------------------------ the planner */

/**
 * **A heading's section number**: "2.4" → `{ path: [2, 4], letter: false }`,
 * "2.4.5(a)" → `{ path: [2, 4, 5], letter: true }`. `null` where the heading
 * does not open with one.
 *
 * Parts are one to three digits, so a year ("2020 Results") is not a number;
 * the only suffix is a bracketed lower-case letter, so "3D printing" is not
 * either. The extractor tags "2.4.5(a)" `h2` inside an `h3` section on the
 * report's paper, which is why a number is read before a tag.
 */
export function sectionNumber(text: string): { path: number[]; letter: boolean } | null {
  const m = /^\s*(\d{1,3}(?:\.\d{1,3})*)(\([a-z]\))?\.?(?:\s|$)/.exec(text);
  if (!m) return null;
  return { path: m[1]!.split(".").map(Number), letter: m[2] !== undefined };
}

/**
 * **How many levels below the section's own heading this one sits**: 1 for a
 * sub-heading, 0 or less for a sibling or an ancestor, `"incompatible"` for a
 * number that is not inside the section's own ("3.1.1" inside "2.4").
 *
 * **One number per heading, always measured from the section's own**, never
 * by comparing two sub-headings with each other: a pairwise rule that reads
 * numbers for one pair and tags for the next can go round in a circle (Sol,
 * second plan review, 1). When both are numbered the number decides, and it
 * must extend the section's own; otherwise the tags' distance does.
 */
export function levelsBelow(heading: Block, own: Block): number | "incompatible" {
  const h = sectionNumber(heading.text);
  const o = sectionNumber(own.text);
  if (h !== null && o !== null) {
    if (o.letter || o.path.some((part, i) => h.path[i] !== part)) {
      return h.path.length <= o.path.length ? 0 : "incompatible";
    }
    return h.path.length + (h.letter ? 1 : 0) - o.path.length;
  }
  const byTag = (headingLevel(heading) ?? NO_LEVEL) - (headingLevel(own) ?? NO_LEVEL);
  /* **An unnumbered heading inside a numbered one is below it**, whatever its
     tag: where the author numbers sections, a sibling would carry a number
     too. A book extracted from PDF tags "3.3 Deformation Stability" and its
     sub-topic "Stability to signal deformations" both h2; by tag they are
     siblings and the section was never divided. */
  if (o !== null && h === null) return Math.max(1, byTag);
  return byTag;
}

/** Are two headings at the same level? By number when both have one, else by tag. */
export function sameLevel(a: Block, b: Block): boolean {
  const na = sectionNumber(a.text);
  const nb = sectionNumber(b.text);
  if (na !== null && nb !== null) return na.path.length + (na.letter ? 1 : 0) === nb.path.length + (nb.letter ? 1 : 0);
  return (headingLevel(a) ?? NO_LEVEL) === (headingLevel(b) ?? NO_LEVEL);
}

/** One sub-section to be: body indices, inclusive, and the author heading it begins at. */
export interface PlannedChild {
  lo: number;
  hi: number;
  heading: Block | null;
}

export interface SubsectionPlan {
  /** The depth-2 node, as stage 1 built it. */
  section: TreeNode;
  /** Its part. */
  part: TreeNode;
  lo: number;
  hi: number;
  children: PlannedChild[];
}

/**
 * Why a section that holds a heading after its first block was left as stage 1
 * made it. A section with none is the ordinary case and is not counted.
 */
export type SkipReason =
  /** It starts mid-run at a paragraph, so there is no heading of its own to measure from. */
  | "no-own-heading"
  /** It holds apparatus (a stranded supplement), whose prose the call may not see. */
  | "holds-supplement"
  /** A heading inside it is not below its own: a sibling stage 1 swallowed. Never demoted. */
  | "holds-sibling-heading"
  /** A numbered heading inside it whose number is not inside the section's own. */
  | "incompatible-numbering"
  /** Its sub-headings make only one sub-section. */
  | "one-child";

export interface SubsectionPlanning {
  plans: SubsectionPlan[];
  skipped: Record<SkipReason, number>;
}

/**
 * **Which sections get sub-sections, and where each starts.** Pure.
 *
 * 1. Depth-2 nodes whose children are all leaves; never a supplement node, and
 *    never a section holding a supplement block.
 * 2. **Its own heading, by position and by its siblings** (`ownHeading`):
 *    the first heading in range at the level its sibling sections start at.
 *    Its first block when that is one; when the section starts where its part
 *    does, the part's heading may come first, because a first child is pinned
 *    to its parent's start (Sol, second review, 2). A section stage 1 began
 *    mid-run at a paragraph has none, and is skipped. Not `sourceHeading`:
 *    stage 1 does not write it on sections in practice (none in the report's
 *    paper), and position cannot be ambiguous where a heading's text can.
 * 3. Every heading after its own is measured by `levelsBelow`. One that is not
 *    below it — a sibling stage 1 swallowed, "2.5" inside 2.4 — or whose number
 *    is not inside the section's makes the section ineligible: demoting it to a
 *    sub-section would assert a wrong relationship.
 * 4. **The immediate sub-headings are the ones the fewest levels below**: in
 *    2.4, the six 2.4.k, not 2.4.5(a)–(c).
 * 5. The first child starts at the section's first block; one more at each
 *    immediate sub-heading, except that when nothing but headings comes before
 *    the first of them, it is the first child itself. Two or more, or none.
 *
 * Headings are read by `isBodyEvidence`, not `gistable`: a body heading marked
 * NOT-GISTABLE is still shown to the model and is still a boundary.
 */
export function planSubsections(tree: Tree, body: readonly Block[]): SubsectionPlanning {
  const index = new Map(body.map((b, i) => [b.id, i]));
  const skipped: Record<SkipReason, number> = {
    "no-own-heading": 0,
    "holds-supplement": 0,
    "holds-sibling-heading": 0,
    "incompatible-numbering": 0,
    "one-child": 0,
  };
  const plans: SubsectionPlan[] = [];
  const at = (id: string): number => {
    const i = index.get(id);
    if (i === undefined) throw new Error(`A tree node names a block that is not in the body.`);
    return i;
  };
  const isHeading = (b: Block) => b.kind === "heading" && isBodyEvidence(b);

  /**
   * The section's own heading, as a body index. **Its siblings say what level a
   * section starts at here**: the first block of each other section in the
   * part that starts at a heading. Its own is then the first heading in range
   * at that level, provided only its part's heading (at its first block) comes
   * before it. With no sibling to read the level from, its first block, if that
   * is a heading and not where its part starts.
   */
  const ownHeading = (section: TreeNode, part: TreeNode, lo: number, headings: number[]): number | undefined => {
    const refs = part.children
      .map((c) => tree.nodes[c])
      .filter((c): c is TreeNode => c !== undefined && c.id !== section.id)
      .map((c) => at(c.range[0]))
      /* The first sibling's first block is the part's heading, not a section's. */
      .filter((i) => i !== at(part.range[0]) && isHeading(body[i]!));
    const startsPart = at(part.range[0]) === lo;
    /* A section that does not start its part owns its first block, if that is
       a heading: the strongest evidence there is. Only a part's first section,
       whose first block may be the part's own heading, is read by its
       siblings' level — any sibling's, since stage 1 makes some sections of
       its own and they do not all start at one level. */
    if (!startsPart) return headings[0] === lo ? lo : undefined;
    /* After the first block first: there, the first block is usually the
       part's heading, and it can share its sections' tag. Only when nothing
       after it matches is the first block the section's own (a part stage 1
       made, with no heading of its own). */
    const matches = (i: number) => refs.some((r) => sameLevel(body[i]!, body[r]!));
    const own = headings.find((i) => i > lo && matches(i)) ?? (headings[0] === lo && matches(lo) ? lo : undefined);
    if (own === undefined) return undefined;
    /* Only the part's opening may come before it: a section stage 1 began
       mid-run, at a paragraph, has no heading of its own. */
    if (own !== lo && !startsPart) return undefined;
    return headings.every((i) => i >= own || (i === lo && startsPart)) ? own : undefined;
  };

  for (const section of Object.values(tree.nodes)) {
    if (section.depth !== 2 || section.children.length === 0 || isSupplementNode(section)) continue;
    if (section.children.some((c) => (tree.nodes[c]?.children.length ?? 0) > 0)) continue;
    const part = section.parent == null ? undefined : tree.nodes[section.parent];
    if (part === undefined) continue;
    const lo = at(section.range[0]);
    const hi = at(section.range[1]);
    const headings: number[] = [];
    for (let i = lo; i <= hi; i++) if (isHeading(body[i]!)) headings.push(i);
    if (!headings.some((i) => i > lo)) continue;
    const skip = (why: SkipReason) => {
      skipped[why] += 1;
    };

    const own = ownHeading(section, part, lo, headings);
    if (own === undefined) {
      skip("no-own-heading");
      continue;
    }
    let supplement = false;
    for (let i = lo; i <= hi; i++) if (body[i]!.treatment === "supplement") supplement = true;
    if (supplement) {
      skip("holds-supplement");
      continue;
    }
    const after = headings.filter((i) => i > own).map((i) => ({ i, below: levelsBelow(body[i]!, body[own]!) }));
    if (after.length === 0) continue;
    if (after.some((h) => h.below === "incompatible")) {
      skip("incompatible-numbering");
      continue;
    }
    const depths = after.map((h) => h.below as number);
    if (depths.some((d) => d <= 0)) {
      skip("holds-sibling-heading");
      continue;
    }
    const nearest = Math.min(...depths);
    const immediate = after.filter((h) => h.below === nearest).map((h) => h.i);
    const first = immediate[0]!;
    let prose = false;
    for (let i = lo; i < first; i++) if (!isHeading(body[i]!) && isStructural(body[i]!)) prose = true;
    const starts = [lo, ...immediate.filter((_, k) => k > 0 || prose)];
    if (starts.length < 2) {
      skip("one-child");
      continue;
    }
    const children = starts.map((s, k): PlannedChild => {
      const end = k + 1 < starts.length ? starts[k + 1]! - 1 : hi;
      const opensAt = k === 0 && !prose ? first : s;
      return { lo: s, hi: end, heading: immediate.includes(opensAt) ? body[opensAt]! : null };
    });
    plans.push({ section, part, lo, hi, children });
  }
  plans.sort((a, b) => a.lo - b.lo);
  return { plans, skipped };
}

/* -------------------------------------------------------------- the call */

export const SUBSECTIONS_SYSTEM = `You are adding one level to a nested table of contents. You are given one
or more SECTIONS of a longer work. Each section has already been divided into
sub-sections by the author's own sub-headings; the divisions are fixed. Your
job is to write a title and a gist for each sub-section.

For each section you are shown the titles and summaries of the part and the
section above it, then the section's blocks as a numbered list (numbers restart
at 0 in each section), then its sub-sections as block ranges. Some blocks are
marked NOT-GISTABLE, and a few of those are withheld and show no text; say
nothing about prose you cannot see.

TITLES

- Where a sub-section begins at the author's heading, its title is that
  heading, copied exactly. Write it back unchanged.
- A sub-section that begins at no heading is the section's opening. Give it a
  title of your own for what it says: 2-6 words, a landmark scanned at a
  glance, in the work's own words for what it names and ordinary words for the
  rest, told apart from the section's own title and its sub-headings. Never
  "Introduction" or "Opening". No trailing punctuation.

GISTS

- Exactly ONE sentence on every sub-section. It is a CLAIM or a MOVE, not a
  topic label. A reader at this zoom reads your sentence INSTEAD of the
  paragraphs it covers, so give them the claim AND the ground it stands on: its
  reason, contrast, consequence or example.
- AT LEAST 22 words, and at most 32. The floor is the half that will feel
  wrong, so obey it: a one-clause gist is too short here. The floor does not
  apply where the range itself is slight: a heading with a line under it.
  Never pad, and never invent support.
- Only what these blocks say. Not what the section's summary says, not what
  the work says elsewhere, and not what you know.
- No narration of document order: not "this sub-section explores", "the
  authors then turn to". Say what it CLAIMS.
- Keep the work's own name for a thing the reader will meet again in the
  prose, and make the sentence understandable to a curious reader from outside
  the field anyway. Check each gist before you send it: every word such a
  reader would not know is explained by its sentence, or gone.

OUTPUT

JSON only. One entry per section, in the order given, naming its number, with
exactly one entry per sub-section, in order — the same count as the section
lists:

{"sections": [{"section": 1, "subsections": [{"title": "...", "gist": "..."}]}]}

${plainWords()}`;

const SUBSECTIONS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          section: { type: "integer" },
          subsections: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { type: "string" }, gist: { type: "string" } },
              required: ["title", "gist"],
              additionalProperties: false,
            },
          },
        },
        required: ["section", "subsections"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections"],
  additionalProperties: false,
} as const;

/** A sub-section's answer is a title and a gist: a few dozen tokens. Generous, because unspent allowance is not billed. */
const TOKENS_PER_CHILD = 160;
const ENVELOPE_TOKENS = 200;

function rung(label: string, node: TreeNode): string {
  return `${label}: ${node.title}${node.gist ? ` — ${node.gist}` : ""}`;
}

function renderPlan(plan: SubsectionPlan, n: number, body: readonly Block[]): string {
  const slice = body.slice(plan.lo, plan.hi + 1) as Block[];
  const ranges = plan.children
    .map((c, k) => {
      const from = c.lo - plan.lo;
      const to = c.hi - plan.lo;
      const where = c.heading ? `begins at the author's heading "${c.heading.text}"` : "the section's opening, no heading of its own";
      return `  ${k + 1}. blocks [${from}]–[${to}], ${where}`;
    })
    .join("\n");
  return [
    `SECTION ${n}`,
    rung("Part", plan.part),
    rung("Section", plan.section),
    "Blocks:",
    renderBlocks(slice),
    `Sub-sections (${plan.children.length}):`,
    ranges,
  ].join("\n");
}

export interface SubsectionsRequest {
  plans: SubsectionPlan[];
  params: MessagesBody;
  maxTokens: number;
}

/** The request for one batch of sections. */
export function subsectionsRequest(plans: SubsectionPlan[], body: readonly Block[]): SubsectionsRequest {
  const user = plans.map((p, i) => renderPlan(p, i + 1, body)).join("\n\n");
  const children = plans.reduce((a, p) => a + p.children.length, 0);
  const maxTokens = THINKING_HEADROOM + ENVELOPE_TOKENS + TOKENS_PER_CHILD * children;
  return {
    plans,
    maxTokens,
    params: withMessagesJsonSchema(
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: PRODUCTION_EFFORT },
        system: SUBSECTIONS_SYSTEM,
        messages: [{ role: "user", content: user }],
      },
      SUBSECTIONS_OUTPUT_SCHEMA,
    ),
  };
}

/** About four characters a token; a packing estimate, not a bill. */
function evidenceTokens(plan: SubsectionPlan, body: readonly Block[]): number {
  let chars = 0;
  for (let i = plan.lo; i <= plan.hi; i++) chars += body[i]!.text.length + 24;
  return Math.ceil(chars / 4);
}

export const MAX_SECTIONS_PER_CALL = 6;
export const MAX_EVIDENCE_TOKENS_PER_CALL = 20_000;

/** Pack sections, in document order, into calls. A section bigger than the budget goes alone. */
export function packSubsectionCalls(plans: readonly SubsectionPlan[], body: readonly Block[]): SubsectionPlan[][] {
  const calls: SubsectionPlan[][] = [];
  let current: SubsectionPlan[] = [];
  let tokens = 0;
  for (const plan of plans) {
    const t = evidenceTokens(plan, body);
    if (current.length > 0 && (current.length >= MAX_SECTIONS_PER_CALL || tokens + t > MAX_EVIDENCE_TOKENS_PER_CALL)) {
      calls.push(current);
      current = [];
      tokens = 0;
    }
    current.push(plan);
    tokens += t;
  }
  if (current.length > 0) calls.push(current);
  return calls;
}

export interface WrittenChild {
  title: string;
  gist: string;
}

/** Mechanical bounds on what the call wrote: lenient, so they catch a broken answer and not a style. */
export const GIST_WORDS = { min: 6, max: 45 } as const;
export const OPENING_TITLE_MAX_WORDS = 8;

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * **Read one call's answer**, section by section, by the section number the
 * request gave it — never by position, so one section left out cannot shift
 * the rest onto the wrong prose (Sol, second review, 4).
 *
 * A section whose entry is missing or repeated, whose count of sub-sections is
 * not the count it was given, or whose gist or opening title is empty or out of
 * bounds, comes back `null` and keeps stage 1's shape; the others stand.
 * **A sub-section that begins at the author's heading takes that heading as
 * its title, from code**, whatever the model wrote back. Throws only when the
 * answer is not the shape at all, which is worth one more draw.
 */
export function readSubsectionsAnswer(raw: string, plans: readonly SubsectionPlan[]): (WrittenChild[] | null)[] {
  const parsed = parseJsonAnswer<{ sections?: unknown }>(raw, "subsections");
  if (!parsed || !Array.isArray(parsed.sections)) throw new Error("The sub-sections answer has no sections list.");
  const seen = new Map<number, unknown[] | "repeated">();
  for (const entry of parsed.sections as { section?: unknown; subsections?: unknown }[]) {
    if (typeof entry?.section !== "number" || !Array.isArray(entry.subsections)) continue;
    seen.set(entry.section, seen.has(entry.section) ? "repeated" : entry.subsections);
  }
  return plans.map((plan, i) => {
    const got = seen.get(i + 1);
    if (got === undefined || got === "repeated" || got.length !== plan.children.length) return null;
    const out: WrittenChild[] = [];
    for (const [k, c] of (got as { title?: unknown; gist?: unknown }[]).entries()) {
      const heading = plan.children[k]!.heading;
      const written = typeof c?.title === "string" ? c.title.trim() : "";
      const gist = typeof c?.gist === "string" ? c.gist.trim() : "";
      const words = wordCount(gist);
      if (words < GIST_WORDS.min || words > GIST_WORDS.max || /\n/.test(gist)) return null;
      if (heading === null && (!written || wordCount(written) > OPENING_TITLE_MAX_WORDS)) return null;
      out.push({ title: heading?.text.trim() ?? written, gist });
    }
    return out;
  });
}

/* ------------------------------------------------------------ the stage */

/** How a call reaches the model. Production's streams; a test's returns a string. */
export type SubsectionsExecutor = (request: SubsectionsRequest) => Promise<string>;

export function liveSubsectionsExecutor(power: ModelPower, signal?: AbortSignal): SubsectionsExecutor {
  return async (request) => {
    const call = streamMessage("structure", request.params, { power, ...(signal ? { signal } : {}) });
    const message: Anthropic.Message = await call.finalMessage();
    return finishedText(message, "sub-sections", request.maxTokens, 0, THINKING_HEADROOM);
  };
}

/** What stage 2 did, for the run's log line. Every field at every value. */
export interface SubsectionStats {
  /** Sections the planner chose. */
  eligible: number;
  /** Sections a call came back about, well-formed. */
  made: number;
  /** Sections whose answer was unusable, or whose call failed after its redraw. */
  failedSections: number;
  /** Sub-sections added. */
  added: number;
  /** Calls made, redraws included. */
  calls: number;
  /** Calls that failed whole on their last draw. */
  failedCalls: number;
  skipped: Record<SkipReason, number>;
  /** True when it was not started because the step's deadline was too close. */
  outOfTime: boolean;
}

/** Calls in flight for one article. */
export const SUBSECTION_CONCURRENCY = 4;
/**
 * **Calls in flight for the whole process**, across every job: a per-job
 * limit does not protect the account (src/structure-deepen.ts § `sharedGate`,
 * Sol's second review, 7). Eight, the deepening wave's width, which is off, so
 * the two never compete. The gate narrows itself on a 429.
 */
export const SUBSECTION_PROCESS_WIDTH = 8;
const sharedGate = new WidthGate(SUBSECTION_PROCESS_WIDTH);

/** A 429 narrows the gate, honouring `Retry-After`; anything else does not. */
function rateLimited(err: unknown): number | null | false {
  if (err instanceof Anthropic.APIError && err.status === 429) {
    return err.headers ? parseRetryAfter(err.headers.get("retry-after"), Date.now()) : null;
  }
  return false;
}

/** Don't start stage 2 with less than this left before the step's deadline. */
export const SUBSECTION_DEADLINE_RESERVE_MS = 120_000;

/**
 * **Run stage 2 on stage 1's body tree.** Returns the proposal to rebuild with
 * `buildTree` (or `null`: nothing was added, keep the tree you have) and the
 * stats. Never throws for a model's answer; a section it cannot use keeps the
 * shape stage 1 gave it.
 */
export async function addSubsections(opts: {
  tree: Tree;
  body: readonly Block[];
  slug: string;
  execute: SubsectionsExecutor;
  deadlineAt?: number;
  /** The queue's lease window: with too little time left and another window available, hand back. */
  window?: LeaseWindow;
  signal?: AbortSignal;
  /** Injectable for a test; production shares the process's. */
  gate?: WidthGate;
}): Promise<{ root: ModelNode | null; stats: SubsectionStats }> {
  const { plans, skipped } = planSubsections(opts.tree, opts.body);
  const stats: SubsectionStats = {
    eligible: plans.length,
    made: 0,
    failedSections: 0,
    added: 0,
    calls: 0,
    failedCalls: 0,
    skipped,
    outOfTime: false,
  };
  if (plans.length === 0) return { root: null, stats };
  /* **Too close to the deadline: hand the job back rather than finish short**,
     when the queue would grant another window. Stage 1's answer is already in
     its checkpoint (src/structure.ts), so the next window repeats no paid work;
     nothing of stage 2 has been bought yet. On the last window, or called with
     no queue, the article gets stage 1's tree and the run says why. */
  if (opts.deadlineAt !== undefined && opts.deadlineAt - Date.now() < SUBSECTION_DEADLINE_RESERVE_MS) {
    if (opts.window?.anotherAvailable === true) throw new NeedsAnotherWindow();
    stats.outOfTime = true;
    return { root: null, stats };
  }

  const gate = opts.gate ?? sharedGate;
  const batches = packSubsectionCalls(plans, opts.body);
  const written = new Map<TreeNode, WrittenChild[]>();
  const runBatch = async (batch: SubsectionPlan[]): Promise<void> => {
    const request = subsectionsRequest(batch, opts.body);
    for (let draw = 1; draw <= 2; draw++) {
      opts.signal?.throwIfAborted();
      stats.calls += 1;
      try {
        const raw = await gate.run(() => opts.execute(request), rateLimited, opts.signal);
        const answers = readSubsectionsAnswer(raw, batch);
        answers.forEach((a, i) => {
          if (a === null) stats.failedSections += 1;
          else written.set(batch[i]!.section, a);
        });
        return;
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        log("pipeline").warn(
          { slug: opts.slug, sections: batch.length, draw, err },
          "a sub-sections call failed; drawing again or leaving its sections as they were",
        );
      }
    }
    stats.failedCalls += 1;
    stats.failedSections += batch.length;
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(SUBSECTION_CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) await runBatch(batches[next++]!);
    }),
  );
  if (written.size === 0) return { root: null, stats };

  /* Attach the children to the proposal, by the section's range: the proposal
     is a copy, and a range is unique among a tree's depth-2 nodes. */
  const byRange = new Map<string, { plan: SubsectionPlan; children: WrittenChild[] }>();
  for (const plan of plans) {
    const children = written.get(plan.section);
    if (children) byRange.set(plan.section.range.join("\0"), { plan, children });
  }
  const root = proposalFromTree(opts.tree);
  const visit = (node: ModelNode, depth: number): void => {
    if (depth === 2) {
      const hit = byRange.get(node.range.join("\0"));
      if (hit && node.children === undefined) {
        node.children = hit.plan.children.map((c, k) => ({
          title: hit.children[k]!.title,
          gist: hit.children[k]!.gist,
          range: [opts.body[c.lo]!.id, opts.body[c.hi]!.id],
          ...(c.heading ? { sourceHeading: c.heading.text } : {}),
        }));
        stats.made += 1;
        stats.added += node.children.length;
      }
      return;
    }
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  visit(root, 0);
  return { root: stats.made > 0 ? root : null, stats };
}

/** On by default; `SPIDERYARN_SUBSECTIONS=0` (or `false`) turns stage 2 off without a rebuild. */
export const SUBSECTIONS_ENV = "SPIDERYARN_SUBSECTIONS";

export function subsectionsEnabled(): boolean {
  const asked = process.env.SPIDERYARN_SUBSECTIONS;
  return !(asked === "0" || asked === "false");
}
