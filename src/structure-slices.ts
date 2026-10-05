/**
 * **A document too long for one structure answer, asked about in slices.**
 *
 * `generateStructure` (src/structure.ts) comes here when the whole table of
 * contents will not fit one model answer. The body is cut into consecutive
 * slices, each goes through the ordinary structure call with a short note
 * ahead of its blocks, and every slice's top-level sections are put under one
 * root whose gist and question come from one small call. Any failure, and the
 * caller returns the tree built from the document's headings instead
 * (src/heading-tree.ts § `buildBoundedHeadingTree`).
 * docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md
 *
 * **No value is imported from `structure.ts`**, which imports this file: the
 * request, the parser, the builder and the question rule arrive as `SliceDeps`.
 * The final build over the whole body stays with the caller.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { anthropicCallFailed } from "./anthropic-call.js";
import { MAX_BATCH } from "./labels.js";
import { log } from "./log.js";
import { finishedText, messagesWireBody, streamMessage, type MessagesBody } from "./messages-stream.js";
import { withMessagesJsonSchema } from "./messages-structured-output.js";
import type { ModelPower } from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import { plainWords } from "./plain-words.js";
import { checkpointKey } from "./source-hash.js";
import type { CheckpointStore } from "./store/checkpoints.js";
import type { BuildReport, ModelNode } from "./structure.js";
import { isSupplementNode } from "./supplement.js";
import { assertTreeSound } from "./tree-invariants.js";
import type { Block, Tree } from "./types.js";

/** About how many body blocks one slice holds. The spike's four slices of 628 to 904 each answered in under 100 s. */
export const SLICE_TARGET_BLOCKS = 1000;
/** Slice calls in flight at once. */
export const SLICE_CONCURRENCY = 8;
/** Longest one slice or refill call may run: two and a half times the slowest slice measured (96 s). */
export const SLICE_CALL_CAP_MS = 240_000;
/** Longest the root call may run. Measured at a few seconds. */
export const ROOT_CALL_CAP_MS = 60_000;
/**
 * Kept back from the step's deadline for what follows the last call: settling
 * aborted calls, checkpoint writes, the headings tree (5 s on the 250-page
 * book) and the caller's own write.
 */
export const SLICES_FINISH_RESERVE_MS = 30_000;
/** Bumped when the root prompt, or what is done with its answer, changes. */
export const ROOT_PROMPT_VERSION = "toc-root/1";
const ROOT_MAX_TOKENS = 6000;
const ROOT_ANSWER_TOKENS = 200;
/** The prompt asks for 18 words. This only refuses a paragraph; no tree rule bounds a gist's length. */
export const ROOT_GIST_MAX_WORDS = 40;
/**
 * Slice, refill and root answers share the whole-document namespace. Each key
 * digests its own full request, so none can answer another's question, and a
 * new namespace would need a migration (the CHECK in src/db/schema.ts).
 */
const NAMESPACE = "structure-whole-document" as const;

/** Why the slices path gave up and the headings tree was returned. */
export type SlicesFailure =
  | "could-not-plan"
  /* A slice's call failed, was refused or cut short, or its answer failed twice. */
  | "slice-failed"
  | "root-call-failed"
  | "tree-unsound"
  | "labels-could-not-ask"
  | "out-of-time";

/** A few words for the step's `detail`, which the reader's progress card shows. */
export const SLICES_FAILED_WORDS: Record<SlicesFailure, string> = {
  "could-not-plan": "it could not be cut into parts",
  "slice-failed": "one part could not be read",
  "root-call-failed": "its top line could not be written",
  "tree-unsound": "the parts did not join",
  "labels-could-not-ask": "a section was too long to label",
  "out-of-time": "there was not time to read it in parts",
};

export interface Slice {
  lo: number;
  hi: number;
  /** The kind of boundary this slice starts on. */
  startsOn: "body-start" | "part" | "authored-section" | "window";
}

/** Indexes into the body where a slice may start, best first. */
export interface SliceStarts {
  parts: number[];
  authored: number[];
  windows: number[];
}

/** Where the headings tree cuts the body: its parts, the sections an author headed, and every section. */
export function sliceStarts(body: readonly Block[], bounded: Tree): SliceStarts {
  const index = new Map(body.map((b, i) => [b.id, i]));
  const starts = (depth: number, authoredOnly: boolean): number[] =>
    Object.values(bounded.nodes)
      .filter((n) => n.depth === depth && n.children.length > 0 && !isSupplementNode(n))
      .filter((n) => !authoredOnly || n.sourceHeading !== undefined)
      .flatMap((n) => index.get(n.range[0]) ?? [])
      .sort((a, b) => a - b);
  return { parts: starts(1, false), authored: starts(2, true), windows: starts(2, false) };
}

/**
 * Cut the body into near-equal consecutive slices that `fits` accepts.
 *
 * Each cut goes to the part start nearest its ideal place when one lies within
 * a quarter of a slice, else to an authored section start within the same
 * distance, else to the nearest window start. If a slice does not fit, one more
 * slice is tried. Pure: the same blocks give the same slices.
 */
export function planSlices(
  body: readonly Block[],
  starts: SliceStarts,
  fits: (blocks: Block[]) => boolean,
  target: number = SLICE_TARGET_BLOCKS,
): Slice[] | null {
  const n = body.length;
  for (let k = Math.max(2, Math.ceil(n / target)); k <= n; k++) {
    const ideal = n / k;
    const cuts: { at: number; on: Slice["startsOn"] }[] = [];
    for (let j = 1; j < k; j++) {
      const want = j * ideal;
      const floor = (cuts.at(-1)?.at ?? 0) + 1;
      const nearest = (xs: number[]): number | undefined =>
        xs.filter((x) => x >= floor && x < n).sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)[0];
      const near = (x: number | undefined): x is number => x !== undefined && Math.abs(x - want) <= ideal / 4;
      const part = nearest(starts.parts);
      const authored = nearest(starts.authored);
      const window = nearest(starts.windows);
      const cut: { at: number; on: Slice["startsOn"] } | null = near(part)
        ? { at: part, on: "part" }
        : near(authored)
          ? { at: authored, on: "authored-section" }
          : window !== undefined
            ? { at: window, on: "window" }
            : null;
      if (cut === null) break;
      /* Never one block after a heading: the final build moves such a start
         back onto the heading (src/heading-snap.ts), which would move a seam. */
      while (cut.at > floor && body[cut.at - 1]!.kind === "heading") cut.at -= 1;
      cuts.push(cut);
    }
    if (cuts.length !== k - 1) continue;
    const slices: Slice[] = [];
    let lo = 0;
    let on: Slice["startsOn"] = "body-start";
    for (const cut of [...cuts, { at: n, on: "part" as const }]) {
      slices.push({ lo, hi: cut.at - 1, startsOn: on });
      lo = cut.at;
      on = cut.on;
    }
    if (slices.every((s) => fits(body.slice(s.lo, s.hi + 1)))) return slices;
  }
  return null;
}

/**
 * What a slice is told that an ordinary article is not. Generic on purpose:
 * the same words go ahead of a book, a paper and a headingless stretch.
 */
export const SLICE_NOTE =
  "This is one stretch of a longer document. Nothing before or after it is shown, and the stretch may " +
  "begin or end partway through a chapter.\n" +
  "Its top-level sections will sit beside the other stretches' top-level sections in one table of " +
  "contents. So where the document has chapters or other major divisions of its own, make each " +
  "top-level section one whole chapter or division, however few or many that gives, and put the " +
  "scenes, steps or sub-sections inside it one level down.\n\n";

/**
 * The ordinary structure request with the note ahead of its blocks. `user` is
 * the request's own user message (`wholeDocumentRequest(...).user`); the system
 * prompt is untouched.
 */
export function withSliceNote(params: MessagesBody, user: string): MessagesBody {
  return { ...params, messages: [{ role: "user", content: SLICE_NOTE + user }] };
}

/**
 * **The top-level sections a slice's answer contributes, or a throw.**
 *
 * A root with no sections is a sound tree on its own and contributes nothing
 * when its sections are promoted; the final build would then stretch a
 * neighbour over blocks its model never saw. So the sections must be there and
 * must tile exactly the blocks the call was given.
 */
export function promotedSections(root: ModelNode, given: readonly Block[]): ModelNode[] {
  const sections = root.children ?? [];
  if (sections.length === 0) throw new Error("The slice's answer has a root and no sections.");
  const index = new Map(given.map((b, i) => [b.id, i]));
  let next = 0;
  for (const section of sections) {
    if (index.get(section.range[0]) !== next) throw new Error("The slice's sections do not tile its blocks.");
    const end = index.get(section.range[1]);
    if (end === undefined || end < next) throw new Error("The slice's sections do not tile its blocks.");
    next = end + 1;
  }
  if (next !== given.length) throw new Error("The slice's sections stop before its last block.");
  return sections;
}

/** A top-level section with no sections of its own and more blocks than one labels batch is asked for again. */
export function needsRefill(section: ModelNode, index: ReadonlyMap<string, number>): boolean {
  if (section.children?.length) return false;
  return index.get(section.range[1])! - index.get(section.range[0])! + 1 > MAX_BATCH;
}

/** One root over the whole body, with every promoted section under it in order. */
export function stitchSlices(
  body: readonly Block[],
  title: string,
  root: RootAnswer,
  sections: ModelNode[],
): ModelNode {
  return { title, gist: root.gist, question: root.question, range: [body[0]!.id, body.at(-1)!.id], children: sections };
}

/**
 * Did the final build keep every promoted section, and start one at every
 * seam? False means a section was dropped or a seam moved, so some section
 * now holds blocks from a slice its model was not shown.
 */
export function seamsHeld(bodyTree: Tree, sections: number, seams: readonly string[]): boolean {
  const top = bodyTree.nodes[bodyTree.rootId]!.children.map((id) => bodyTree.nodes[id]!);
  const starts = new Set(top.map((n) => n.range[0]));
  return top.length === sections && seams.every((id) => starts.has(id));
}

export const ROOT_SYSTEM = `You are writing the top line of a long document's table of contents.

The document was too long to read in one go, so its sections were summarised
separately. You receive the document's title and, for each top-level section
in order, the section's title and its one-sentence gist. You have not seen the
document itself: work only from these lines, and claim nothing they do not
support.

One chapter or piece is often spread over several sections in a row, so the
number of sections is NOT the number of chapters, stories or essays. Never
give a count of them.

Write two things about the WHOLE document.

GIST

- Exactly ONE sentence of AT MOST 18 words. Count them. It is the blurb a
  reader sees on a shelf, and it is shorter than any section's gist.
- THE ONE claim the document makes. A collection of separate pieces has no
  single claim: say what its pieces have in common, in one clause, and stop.
- No list of topics, no list of sections, no author's name, no dashes.
- Do not narrate: not "the document opens by", "this collection explores".
- At most ONE term of art; everything else in ordinary words.

QUESTION

- Exactly ONE question: the one the whole document exists to answer.
- Shape: "<topic> — <question>? (<shape hint>)". The topic first, in the
  document's own words; then the question, ending in "?"; then an optional
  hint in brackets that says the KIND of answer ("short stories", "an argument
  and a case study"), never its content and never a number.
- "Why", "how" or "what follows if": never yes/no, never something one fact
  settles, never the gist with a question mark on it.
- Under 20 words in all.

OUTPUT

JSON only, no prose, no code fence: {"gist": "...", "question": "..."}

${plainWords("explain", "ask")}`;

const ROOT_SCHEMA = {
  type: "object",
  properties: { gist: { type: "string" }, question: { type: "string" } },
  required: ["gist", "question"],
  additionalProperties: false,
} as const;

export interface RootAnswer {
  gist: string;
  question: string;
}

/** The root call's request: the title, and each top-level section's title and gist. No prose. */
export function rootRequest(title: string, sections: readonly ModelNode[]): MessagesBody {
  const user = [
    `DOCUMENT TITLE: ${title}`,
    "",
    "SECTIONS, in order:",
    ...sections.map((s, i) => `${i + 1}. ${s.title} — ${s.gist ?? "(no gist)"}`),
  ].join("\n");
  return withMessagesJsonSchema(
    {
      max_tokens: ROOT_MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: ROOT_SYSTEM,
      messages: [{ role: "user", content: user }],
    },
    ROOT_SCHEMA,
  );
}

/** The root answer, or a throw: a gist that is one short sentence's worth, and a question the tree would keep. */
export function acceptRoot(raw: string, question: SliceDeps["question"]): RootAnswer {
  const answer = parseJsonAnswer<Partial<RootAnswer>>(raw, "the table-of-contents root response");
  const gist = typeof answer.gist === "string" ? answer.gist.trim() : "";
  const words = gist.split(/\s+/).filter(Boolean).length;
  if (words === 0 || words > ROOT_GIST_MAX_WORDS) throw new Error(`The root gist is ${words} words.`);
  const kept = question({ title: "", gist, range: ["", ""], ...(typeof answer.question === "string" ? { question: answer.question } : {}) }, 0);
  if (kept === undefined || kept !== answer.question?.trim()) {
    throw new Error("The root question is missing, unfinished, or is the gist asked again.");
  }
  return { gist, question: kept };
}

/**
 * When the slices path must have finished asking: the earlier of the step's
 * own budget and the queue's deadline, less the finish reserve. The queue ends
 * a job as interrupted if its own deadline fires, even when this step then
 * returns the headings tree, so this path stops itself first.
 */
export function slicesDeadline(started: number, stepBudgetMs?: number, deadlineAt?: number): number {
  return (
    Math.min(stepBudgetMs === undefined ? Infinity : started + stepBudgetMs, deadlineAt ?? Infinity) -
    SLICES_FINISH_RESERVE_MS
  );
}

/** What `structure.ts` lends this file, so that nothing here imports its values. */
export interface SliceDeps {
  /** `wholeDocumentRequest`, with the answer estimate its truncation sentence quotes. */
  request(blocks: Block[]): { params: MessagesBody; user: string; maxTokens: number; answerTokens: number };
  /** `STRUCTURE_HEADROOM`. */
  headroom: number;
  /** `parseWholeDocumentAnswer`. */
  parse(answer: string, blocks: readonly Block[], report?: BuildReport): { root: ModelNode };
  /** `buildTree`. */
  build(root: ModelNode, navLabels: Record<string, string>, blocks: Block[], slug: string, report?: BuildReport): Tree;
  /** `canonicalWholeDocumentRequest`. */
  canonical(params: MessagesBody, power: ModelPower): Record<string, unknown>;
  /** `questionFor`. */
  question(node: ModelNode, depth: number): string | undefined;
}

/** What this attempt asked a model for, whether or not a tree came of it. */
export interface SlicesSpend {
  /** Requests started, including transport retries and calls without a returned answer. */
  calls: number;
  /** Answers read back from a checkpoint instead of bought. */
  resumed: number;
  usage: { input_tokens: number; output_tokens: number };
}

export type SlicesOutcome = { spend: SlicesSpend; slices: number; reasked: number } & (
  | { ok: true; proposal: ModelNode; sections: number; seams: string[]; refilled: number }
  | { ok: false; failure: SlicesFailure }
);


interface Entry {
  fingerprint: string;
  answer: string;
}

interface NotAsked {
  ok: false;
  /** `stopped`: a peer had already failed, so this was never started. */
  why: "failed" | "out-of-time" | "stopped";
}
type Asked<T> = { ok: true; value: T } | NotAsked;
type Stitched = { ok: true; proposal: ModelNode; sections: number; seams: string[]; refilled: number };

/** `jobs`, at most `width` at once, each started only when a worker reaches it. None may reject. */
async function inPool<T>(width: number, jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out = new Array<T>(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, worker));
  return out;
}

/**
 * Ask for the slices, the refills and the root, and hand back one proposal for
 * the caller to build, or the reason there is none.
 *
 * **It returns only when every call it started has settled**, on the failure
 * path as well: a call still running when the step returns is outside the
 * step's spend ledger (src/ai-spend.ts § `collectSpend`). A good answer is
 * checkpointed even when a peer failed, so a retry buys only what is missing.
 *
 * A reader's Stop (`signal`) is not a failure of this path and is thrown on,
 * as the whole-document call throws it.
 */
export async function runSlices(opts: {
  body: Block[];
  slug: string;
  /** The headings tree: where slices may be cut, and the root's title. */
  bounded: Tree;
  power: ModelPower;
  checkpoints: CheckpointStore;
  deps: SliceDeps;
  /** `slicesDeadline`, on `Date.now()`'s clock. */
  deadline: number;
  signal?: AbortSignal;
  onProgress?: (detail: string) => void;
}): Promise<SlicesOutcome> {
  const { body, slug, power, checkpoints, deps, deadline, signal } = opts;
  const plog = log("pipeline");
  const spend: SlicesSpend = { calls: 0, resumed: 0, usage: { input_tokens: 0, output_tokens: 0 } };
  let reasked = 0;
  /** Set on the first failure: nothing new is started after it. */
  let stopped = false;
  let callError: unknown;
  let failure: SlicesFailure | null = null;
  const fail = (not: NotAsked, as: SlicesFailure): void => {
    stopped = true;
    if (not.why !== "stopped") failure ??= not.why === "out-of-time" ? "out-of-time" : as;
  };

  /**
   * One question: its checkpoint, then up to `attempts` calls. Each call runs
   * under a signal of this path's own, aborted by the reader's signal or by the
   * call's time cap, and is started only if the cap and `thenMs` (what must
   * still follow it) fit before the deadline.
   */
  const ask = async <T>(q: {
    params: MessagesBody;
    canonical: Record<string, unknown>;
    capMs: number;
    thenMs: number;
    attempts: 1 | 2;
    /** A required request stops admission at the failure site, before workers resume. */
    failure: "slice-failed" | "root-call-failed";
    /** A refill may be omitted before it starts when the cap cannot fit. */
    skipIfShort?: boolean;
    text: (message: Anthropic.Message) => string;
    accept: (answer: string) => T;
  }): Promise<Asked<T>> => {
    const refused = (why: NotAsked["why"]): NotAsked => {
      const not: NotAsked = { ok: false, why };
      fail(not, q.failure);
      return not;
    };
    if (signal?.aborted) return { ok: false, why: "stopped" };
    const key = checkpointKey(q.canonical);
    try {
      const entry = (await checkpoints.read<Partial<Entry>>(slug, NAMESPACE, [key])).get(key);
      if (entry?.fingerprint === key && typeof entry.answer === "string") {
        try {
          const value = q.accept(entry.answer);
          spend.resumed += 1;
          return { ok: true, value };
        } catch (err) {
          /* A stored answer that no longer passes is a miss; the write below replaces it. */
          plog.warn({ slug, key, err }, "a stored slice answer no longer passes; asking again");
        }
      }
    } catch (err) {
      plog.warn({ slug, key, err }, "could not read a slice checkpoint; asking again");
    }
    for (let attempt = 1; ; attempt++) {
      if (stopped || signal?.aborted) return { ok: false, why: "stopped" };
      if (Date.now() + q.capMs + q.thenMs > deadline) {
        return q.skipIfShort ? { ok: false, why: "out-of-time" } : refused("out-of-time");
      }
      const expiresAt = Date.now() + q.capMs;
      const own = new AbortController();
      const onStop = (): void => own.abort();
      if (signal?.aborted) own.abort();
      else signal?.addEventListener("abort", onStop, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        stopped = true;
        failure ??= "out-of-time";
        own.abort();
      }, q.capMs);
      let message: Anthropic.Message;
      let call: ReturnType<typeof streamMessage> | undefined;
      try {
        call = streamMessage("structure", q.params, { power, signal: own.signal });
        message = await call.finalMessage();
      } catch (err) {
        callError ??= err;
        plog.warn({ slug, key, err: anthropicCallFailed(err), timedOut }, "a slice call did not come back");
        return refused(timedOut ? "out-of-time" : "failed");
      } finally {
        if (call !== undefined) spend.calls += call.attempts();
        clearTimeout(timer);
        signal?.removeEventListener("abort", onStop);
      }
      /* Usage precedes acceptance: a refusal, truncation or late answer still spent tokens. */
      spend.usage.input_tokens += message.usage.input_tokens;
      spend.usage.output_tokens += message.usage.output_tokens;
      const late = timedOut || Date.now() > expiresAt;
      if (late) {
        stopped = true;
        failure ??= "out-of-time";
      }
      let answer: string;
      try {
        answer = q.text(message);
      } catch (err) {
        /* Refused or cut short. Asked again it would be again, as for the whole-document call. */
        plog.warn({ slug, key, err }, "a slice answer was refused or cut short");
        return refused(late ? "out-of-time" : "failed");
      }
      let value: T;
      try {
        value = q.accept(answer);
      } catch (err) {
        plog.warn({ slug, key, err, attempt }, "a slice answer did not pass");
        if (late || attempt >= q.attempts) return refused(late ? "out-of-time" : "failed");
        reasked += 1;
        continue;
      }
      try {
        await checkpoints.write(slug, NAMESPACE, key, { fingerprint: key, answer } satisfies Entry);
      } catch (err) {
        plog.warn({ slug, key, err }, "could not save a slice checkpoint; a later attempt will ask again");
      }
      return late ? refused("out-of-time") : { ok: true, value };
    }
  };

  /** The ordinary structure call on `blocks`, with the note, accepted only if its sections tile them. */
  const askSlice = async (blocks: Block[], attempts: 1 | 2): Promise<Asked<ModelNode[]>> => {
    let request: ReturnType<SliceDeps["request"]>;
    try {
      request = deps.request(blocks);
    } catch {
      return { ok: false, why: "failed" };
    }
    const params = withSliceNote(request.params, request.user);
    return ask({
      params,
      canonical: deps.canonical(params, power),
      capMs: SLICE_CALL_CAP_MS,
      thenMs: ROOT_CALL_CAP_MS,
      attempts,
      failure: "slice-failed",
      skipIfShort: attempts === 1,
      text: (message) => finishedText(message, "table of contents", request.maxTokens, request.answerTokens, deps.headroom),
      accept: (answer) => {
        const { root } = deps.parse(answer, blocks);
        assertTreeSound(blocks, deps.build(root, {}, blocks, slug));
        return promotedSections(root, blocks);
      },
    });
  };

  /** Every way out. A reader's Stop wins over whatever else happened. */
  const done = (out: Stitched | null, slices: number): SlicesOutcome => {
    if (signal?.aborted) throw anthropicCallFailed(callError ?? signal.reason);
    const base = { spend, slices, reasked };
    return out !== null ? { ...base, ...out } : { ...base, ok: false, failure: failure ?? "slice-failed" };
  };

  const plan = planSlices(body, sliceStarts(body, opts.bounded), (blocks) => {
    try {
      deps.request(blocks);
      return true;
    } catch {
      return false;
    }
  });
  if (plan === null) {
    failure = "could-not-plan";
    return done(null, 0);
  }

  let finished = 0;
  const perSlice = await inPool(
    SLICE_CONCURRENCY,
    plan.map((s) => async (): Promise<ModelNode[] | null> => {
      const got = await askSlice(body.slice(s.lo, s.hi + 1), 2);
      if (!got.ok) {
        fail(got, "slice-failed");
        return null;
      }
      try {
        opts.onProgress?.(`${++finished} of ${plan.length} parts of the table of contents`);
      } catch (err) {
        /* Progress is an observer. It cannot end a paid pool before its peers settle. */
        plog.warn({ slug, err }, "could not report slice progress");
      }
      return got.value;
    }),
  );
  if (stopped || perSlice.some((s) => s === null)) return done(null, plan.length);
  const promoted = perSlice.flatMap((s) => s ?? []);

  /* Refills: once each, no re-ask, and skipped before admission when time is
     short. A valid single section keeps the original. A failed started refill
     stops admission and gives D, just like a failed slice. */
  const index = new Map(body.map((b, i) => [b.id, i]));
  const refills = await inPool(
    SLICE_CONCURRENCY,
    promoted.map((section) => async (): Promise<ModelNode[]> => {
      if (!needsRefill(section, index)) return [section];
      const got = await askSlice(body.slice(index.get(section.range[0])!, index.get(section.range[1])! + 1), 1);
      return got.ok && got.value.length >= 2 ? got.value : [section];
    }),
  );
  const refilled = refills.filter((r) => r.length > 1).length;
  const sections = refills.flat();
  if (stopped || signal?.aborted) return done(null, plan.length);

  const title = opts.bounded.nodes[opts.bounded.rootId]!.title;
  const rootParams = rootRequest(title, sections);
  const root = await ask({
    params: rootParams,
    canonical: { promptVersion: ROOT_PROMPT_VERSION, request: messagesWireBody("structure", rootParams, power) },
    capMs: ROOT_CALL_CAP_MS,
    thenMs: 0,
    attempts: 2,
    failure: "root-call-failed",
    text: (message) => finishedText(message, "table of contents root", ROOT_MAX_TOKENS, ROOT_ANSWER_TOKENS),
    accept: (answer) => acceptRoot(answer, deps.question),
  });
  if (!root.ok) {
    fail(root, "root-call-failed");
    return done(null, plan.length);
  }
  return done(
    {
      ok: true,
      proposal: stitchSlices(body, title, root.value, sections),
      sections: sections.length,
      seams: plan.slice(1).map((s) => body[s.lo]!.id),
      refilled,
    },
    plan.length,
  );
}
