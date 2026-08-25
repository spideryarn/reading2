/**
 * The ingest pipeline, as data.
 *
 * Six steps, each one a name, a label a reader can watch tick over, the
 * artefact it produces, and the function that produces it. Everything that
 * knows the *order* of the pipeline knows it from this file — and the sixth,
 * `tweets`, is in the order without being in the default, which is why there
 * are two lists below rather than one.
 *
 * Written as a list rather than as a function that calls four other functions
 * for one reason: Greg asked for jobs beyond "add this URL" — re-run one stage
 * after a prompt change, refresh an article from source, and *"potentially
 * it'll be used in other ways too"* (2026-08-25). All of those are the same
 * machinery given a different sub-list of these steps, so a job is a list of
 * step names and nothing here needs a special case for any of them.
 *
 * See docs/project/ingest-queue.md. The queue that runs these is src/jobs.ts;
 * the stage implementations belong to other agents and are reached through
 * their exported functions, never by reimplementing what they do.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateArc } from "./arc.js";
import { runBlocks } from "./blocks.js";
import { runExtract } from "./extract.js";
import { fetchHtml } from "./fetch.js";
import { generateToc } from "./toc.js";
import { generateTweets, threadIsCurrent } from "./tweets.js";
import type { Meta, StepName } from "./types.js";

const ROOT = path.resolve(import.meta.dirname, "..");

export type { StepName };

/**
 * Every step there is, in pipeline order.
 *
 * This constant does two jobs and both need every name: `orderSteps` sorts by
 * `indexOf` here (a name that is missing gets `-1` and sorts to the **front**,
 * so it would run before `fetch`), and `isStepName` below is what decides which
 * names the API will accept at all.
 *
 * It used to do a third — being the default for a job that named no steps — and
 * that is `DEFAULT_INGEST_STEPS` now, because `tweets` is the first step that
 * belongs in the order and not in the default. See
 * docs/plans/tweet-thread-page.md#the-one-real-snag-stated-precisely.
 */
export const STEP_ORDER: StepName[] = ["fetch", "extract", "blocks", "toc", "arc", "tweets"];

/**
 * What "add this URL" runs: every step that makes the article readable.
 *
 * Not `tweets`. A thread costs a model call and is a page you go to, so it is
 * generated when somebody asks for one — `{ steps: ["tweets"] }` — and never as
 * a side effect of adding an article. Greg was asked and said no to that
 * directly (2026-08-25).
 */
export const DEFAULT_INGEST_STEPS: StepName[] = ["fetch", "extract", "blocks", "toc", "arc"];

/**
 * Steps the positional force-cascade must not sweep in — `cascadeForce`, in
 * src/jobs.ts. Forcing an earlier step does **not** force one of these; they
 * have to be named.
 *
 * **This is where the pipeline stops being one straight line, and it is worth
 * being exact about why.** `cascadeForce` encodes "invalidating a step
 * invalidates everything after it", which is sound for a chain where each step
 * eats what the one before it wrote. `tweets` does not sit in that chain: it
 * reads `blocks.json` and `tree.json`, the same inputs the arc reads, and
 * nothing reads what it writes. Forcing `arc` in a job that also holds `tweets`
 * would therefore spend a second model call to regenerate a thread whose inputs
 * did not move.
 *
 * The reason it is *safe* to take it out of the cascade is the other half of
 * this change, and the two must be read together: `tweets` has an `isDone` of
 * its own that compares the thread's `sourceHash` against the blocks on disk.
 * So when the article really has changed it re-runs **without** being forced,
 * and `force` goes back to meaning only what it says — "run this even though it
 * looks current".
 *
 * `arc` stays in the cascade for exactly the inverse reason: it cannot tell
 * whether it is current, so its position is the only signal there is. Give it a
 * freshness check of its own and it belongs here too.
 */
export const FORCE_ONLY_WHEN_NAMED: ReadonlySet<StepName> = new Set<StepName>(["tweets"]);

export interface StepContext {
  slug: string;
  /** The source URL. Absent only when re-running a late stage on an article that has one on disk. */
  url?: string;
  /** `data/<slug>` — where the durable artefacts live. */
  dir: string;
  /** `output/<slug>.html` — the debug page, and what stage 3 reads and writes ids into. */
  htmlFile: string;
  /** Say something short about how this step is going. Shown live; not persisted. */
  report(detail: string): void;
  signal: AbortSignal;
}

export interface PipelineStep {
  name: StepName;
  /** Present tense, naming the actual thing — "Fetching the page", never "Loading". */
  label: string;
  /**
   * Every file this step writes.
   *
   * A step counts as done when **all** of them are present, which is the only
   * safe reading for the two steps that write more than one: `extract` writes
   * the HTML and `meta.json`, `toc` writes `tree.json` and its copy of
   * `blocks.json`. Checking only the first would let a crash between the two
   * writes leave a step that reports itself finished with half its output, and
   * the stage after it would consume the missing half.
   *
   * **For most steps this is still an existence check, not a correctness
   * check** — unless the step supplies `isDone` below. See the honest account of
   * the gap in
   * docs/project/ingest-queue.md#idempotent-is-the-goal-this-is-a-step-towards-it.
   */
  outputs(ctx: StepContext): string[];
  /**
   * Optional: is this step's artefact not merely present but **current**?
   *
   * Existence is the default because it is all most steps can afford to check.
   * It is also not what "cached" means, and the difference is a
   * [silent success](docs/reusable/silent-success.md) waiting to happen: a
   * `tweets.json` describing last week's text is *present*, so the step skips,
   * reports "already done", and the reader gets a thread about an article that
   * has since changed — with a green tick over it.
   *
   * A step that can answer the real question answers it here. `tweets` does,
   * by comparing the `sourceHash` it stored against the blocks on disk, plus
   * its prompt version and model id — which is exactly what
   * architecture.md#storage has always specified for a cached artefact and what
   * nothing had implemented.
   *
   * Kept optional, and kept out of `outputs`, on purpose: this is the only
   * place in the interface that can read a file's *contents*, so a step that
   * gets it wrong burns a model call every run. Adding one is a deliberate act.
   * `assertProduced` still uses `outputs`, because "did you write the file"
   * stays a separate question from "was it worth writing".
   */
  isDone?(ctx: StepContext): Promise<boolean>;
  /** Do the work. The returned string is the one-line summary kept on the finished step. */
  run(ctx: StepContext): Promise<string>;
}

/** Stage 3's own artefact, beside the HTML. Stage 4 copies it into `data/<slug>/`. */
function blocksPathFor(ctx: StepContext): string {
  return ctx.htmlFile.replace(/\.html$/, ".blocks.json");
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Has this step already produced everything it produces, and is what it
 * produced still current?
 *
 * All of them, not any of them — see the note on `outputs`. The files must be
 * there whatever else is true, so the existence check runs first and a step's
 * own `isDone` only ever narrows the answer, never widens it: a freshness check
 * cannot accidentally declare a missing file fine.
 */
export async function stepIsDone(step: PipelineStep, ctx: StepContext): Promise<boolean> {
  const present = await Promise.all(step.outputs(ctx).map(exists));
  if (!present.every(Boolean)) return false;
  return step.isDone ? await step.isDone(ctx) : true;
}

/**
 * Did the step that just returned actually write what it says it writes?
 *
 * `outputs` is otherwise only a hint about skipping, and a hint is exactly the
 * kind of thing that drifts from the `run()` beside it without anything
 * failing. Checking it as a postcondition turns the list into a claim the step
 * has to keep — a stage that returns happily having written nothing is caught
 * here rather than three stages later, where the symptom is a missing file and
 * no clue about which step should have made it.
 */
export async function assertProduced(step: PipelineStep, ctx: StepContext): Promise<void> {
  const missing: string[] = [];
  for (const file of step.outputs(ctx)) {
    if (!(await exists(file))) missing.push(path.basename(file));
  }
  if (missing.length > 0) {
    throw new Error(`${step.name} finished without writing ${missing.join(" or ")}`);
  }
}

/** The source URL for a slug, from its meta.json. Undefined if there isn't one yet. */
export async function urlForSlug(slug: string): Promise<string | undefined> {
  try {
    const meta = JSON.parse(
      await readFile(path.join(ROOT, "data", slug, "meta.json"), "utf8"),
    ) as Meta;
    return meta.url;
  } catch {
    return undefined;
  }
}

/** Everything a step needs to know about where this article's files go. */
export function contextPaths(slug: string): { dir: string; htmlFile: string } {
  return {
    dir: path.join(ROOT, "data", slug),
    htmlFile: path.join(ROOT, "output", `${slug}.html`),
  };
}

/** The URL a step needs, or a clear error rather than a fetch of `undefined`. */
function requireUrl(ctx: StepContext): string {
  if (!ctx.url) {
    throw new Error(
      `No source URL for "${ctx.slug}". Its meta.json has none, and none was given.`,
    );
  }
  return ctx.url;
}

/**
 * The pipeline.
 *
 * Stage numbers here are the ones in architecture.md § Pipeline. The one that
 * looks missing is sanitising, which is not a step of its own: it happens
 * *inside* `blocks`, at the top of `splitIntoBlocks`, so that the stored
 * blocks.json is already safe and no later consumer has to remember. See
 * src/sanitize.ts.
 */
export const STEPS: Record<StepName, PipelineStep> = {
  /* Stage 1. Its own step, and its own artefact, so that a failed or wrong
     extraction can be retried without asking the publisher again — and without
     the answer being different because they changed the page in between.

     The work is src/fetch.ts, which is stage 1's own module and does a great
     deal more than a `fetch().then(r => r.text())`: byte caps that count the
     decompressed size, the page's declared encoding rather than an assumed
     UTF-8, PDFs told apart by their bytes, and typed failures with a sentence a
     reader can act on. Those messages are what a failed step shows, which is
     most of why this step is three lines. */
  fetch: {
    name: "fetch",
    label: "Fetching the page",
    outputs: (ctx) => [path.join(ctx.dir, "raw.html")],
    async run(ctx) {
      const url = requireUrl(ctx);
      ctx.report(new URL(url).hostname);
      const html = await fetchHtml(url, { signal: ctx.signal });
      await mkdir(ctx.dir, { recursive: true });
      await writeFile(path.join(ctx.dir, "raw.html"), html, "utf8");
      return `${Math.round(html.length / 1024)} KB`;
    },
  },

  /* Stage 2. Reads raw.html rather than re-fetching, which is the whole point
     of splitting the two. */
  extract: {
    name: "extract",
    label: "Extracting the article",
    outputs: (ctx) => [ctx.htmlFile, path.join(ctx.dir, "meta.json")],
    async run(ctx) {
      const url = requireUrl(ctx);
      const html = await readFile(path.join(ctx.dir, "raw.html"), "utf8");
      const result = await runExtract({ html, url, outFile: ctx.htmlFile, dataDir: ctx.dir });
      return result.meta.title;
    },
  },

  /* Stage 3 — and the sanitiser, inside it. */
  blocks: {
    name: "blocks",
    label: "Splitting into blocks",
    /**
     * The JSON **and the HTML**, and `output/<slug>.blocks.json` rather than
     * `data/<slug>/blocks.json`.
     *
     * Two separate points, both easy to get wrong.
     *
     * The HTML, because stage 3 writes the ids back into it — that is what
     * makes `#spya-k3m9qt` an anchor with no JavaScript. Listing only the JSON
     * would let a blocks-only job find its JSON, skip, and leave the HTML
     * without the ids the JSON says are in it.
     *
     * And the JSON beside the HTML, because there are two copies of it and only
     * that one is this step's: stage 4 copies it into the data directory as it
     * writes the tree, so the pair there is guaranteed to be what the tree was
     * built from. Checking the data copy here would mean a finished `blocks`
     * step reporting itself unfinished until `toc` had run too — so a retry
     * would redo stage 3 every time, and `{ steps: ["blocks"] }` could never
     * skip itself.
     */
    outputs: (ctx) => [blocksPathFor(ctx), ctx.htmlFile],
    async run(ctx) {
      const run = await runBlocks({ htmlFile: ctx.htmlFile });
      const { total, minted, carried, reused } = run.stats;
      return `${total} blocks, ${minted} new ids (${reused + carried} kept)`;
    },
  },

  /* Stages 4 + 5 — one model call writes the structure and the gists together;
     src/toc.ts says why they are not two passes. */
  toc: {
    name: "toc",
    label: "Building the table of contents",
    outputs: (ctx) => [path.join(ctx.dir, "tree.json"), path.join(ctx.dir, "blocks.json")],
    async run(ctx) {
      const run = await generateToc({
        blocksPath: blocksPathFor(ctx),
        outDir: ctx.dir,
        onProgress: ctx.report,
        signal: ctx.signal,
      });
      return `${run.internal} sections over ${run.blocks} blocks`;
    },
  },

  /* Stage 5b. */
  arc: {
    name: "arc",
    label: "Writing the arc",
    outputs: (ctx) => [path.join(ctx.dir, "arc.json")],
    async run(ctx) {
      const run = await generateArc({
        dir: ctx.dir,
        onProgress: ctx.report,
        signal: ctx.signal,
      });
      return `${run.arc.entries.length} sentences, one per part`;
    },
  },

  /* Stage 5c — the thread. In this list but not in DEFAULT_INGEST_STEPS: it
     runs when somebody asks for a thread, not on every ingest.

     The one step so far that knows whether its artefact is *current* rather
     than merely present — `threadIsCurrent` compares the stored `sourceHash`
     against the blocks on disk, and checks the prompt version and model id
     with it. Which is why `tweets` is also in FORCE_ONLY_WHEN_NAMED: it does
     not need the positional force-cascade to notice that the article moved,
     and being swept into one would only cost a model call for nothing. Read
     those two notes together; neither is safe on its own. */
  tweets: {
    name: "tweets",
    label: "Writing the thread",
    outputs: (ctx) => [path.join(ctx.dir, "tweets.json")],
    isDone: (ctx) => threadIsCurrent(ctx.dir),
    async run(ctx) {
      const run = await generateTweets({
        dir: ctx.dir,
        onProgress: ctx.report,
        signal: ctx.signal,
      });
      const over = run.over > 0 ? `, ${run.over} over ${run.thread.limit}` : "";
      return `${run.thread.tweets.length} posts${over}`;
    },
  },
};

/**
 * Validate a step name that arrived over HTTP.
 *
 * `STEP_ORDER.includes`, not `value in STEPS`. The `in` operator walks the
 * prototype chain, so `"constructor"` and `"toString"` are both "in" any object
 * — they would pass this check, and then `STEPS["constructor"]` hands the runner
 * `Object` instead of a step. The failure surfaces as a property of undefined,
 * several layers from the request that caused it. Covered by tests/jobs.test.ts.
 */
export function isStepName(value: unknown): value is StepName {
  return typeof value === "string" && (STEP_ORDER as string[]).includes(value);
}
