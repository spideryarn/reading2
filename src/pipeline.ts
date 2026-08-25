/**
 * The ingest pipeline, as data.
 *
 * Seven steps, each one a name, a label a reader can watch tick over, the
 * artefact it produces, and the function that produces it. Everything that
 * knows the *order* of the pipeline knows it from this file — and the last two,
 * `tweets` and `glossary`, are in the order without being in the default, which
 * is why there are two lists below rather than one.
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
import { generateGlossary, glossaryIsCurrent } from "./glossary.js";
import { generateSummaries, summariesAreCurrent } from "./summarise.js";
import { log } from "./log.js";
import { generateToc } from "./toc.js";
import { generateTweets, threadIsCurrent } from "./tweets.js";
import type { Meta, StepName } from "./types.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * One line per step, saying what the step cost.
 *
 * **Why the logging lives here rather than in the stages.** Every model stage
 * already counts its own tokens and times its own call, and then hands those
 * numbers back in its run object — which the `run()` closures below receive and
 * currently reduce to a sentence for a progress bar. The stage CLIs print them;
 * the queue threw them away. So "what did this article's tree cost?" had no
 * answer once the web UI became the normal way to ingest, which is open question
 * Q7 in docs/project/open-questions.md.
 *
 * The numbers are all in scope *here*, at the seam the queue already owns, so
 * this file can answer that question without a single edit inside somebody
 * else's stage — see architecture.md#stage-ownership. The two exceptions are two
 * lines each: `toc` and `arc` keep `MODEL` private, so they now return it.
 *
 * A module-level logger is fine and rule 4 in src/log.ts does not forbid it: it
 * carries the component name and nothing else. What must never be module-level
 * is a logger bound to *one job or request*, because several run concurrently in
 * one process and the lines would be attributed to the wrong article. Every
 * per-article field below is passed at the call site instead.
 */
const plog = log("pipeline");

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
 * that is `DEFAULT_INGEST_STEPS` now, because `tweets` was the first step that
 * belongs in the order and not in the default. `glossary` is the second, and
 * the pair of them is what turned that from an exception into the shape of the
 * list: everything up to `arc` makes the article readable, and everything after
 * it is a thing somebody asks for. See
 * docs/plans/tweet-thread-page.md#the-one-real-snag-stated-precisely and
 * docs/project/glossary.md.
 */
export const STEP_ORDER: StepName[] = [
  "fetch",
  "extract",
  "blocks",
  "toc",
  "arc",
  "tweets",
  "glossary",
  "summary",
];

/**
 * What "add this URL" runs: every step that makes the article readable.
 *
 * Not `tweets`, not `glossary`, and not `summary`. Each costs model calls over
 * the whole article and each is a thing you go to — a page, and two modes — so
 * each is generated when somebody asks for it, `{ steps: ["tweets"] }` or
 * `{ steps: ["glossary"] }` or `{ steps: ["summary"] }`, and never as a side
 * effect of adding an article. Greg was asked about the first two and said no
 * to both, directly (2026-08-25); `summary` follows the rule they established,
 * and it is the most expensive of the three — several batched calls rather than
 * one. See docs/project/summaries.md.
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
 *
 * `glossary` is here for both halves of the same argument: it reads the blocks
 * and the tree, nothing reads what it writes, and `glossaryIsCurrent` compares
 * its stored `sourceHash` against the blocks on disk. **And one thing more that
 * `tweets` does not have to worry about** — forcing this step *appends* a batch
 * of terms rather than replacing the list (src/glossary.ts § `generateGlossary`),
 * so being swept into the cascade would not merely waste a model call, it would
 * lengthen the reader's glossary as a side effect of re-fetching the article.
 *
 * `summary` is here on the same two grounds as `tweets` — it reads the blocks
 * and the tree, nothing reads what it writes, and `summariesAreCurrent` compares
 * its stored `sourceHash`, prompt version and model against what is on disk. It
 * is also the one step where being swept in costs the most: it is not one model
 * call but one per part, so a cascade would multiply a wasted regeneration by
 * the width of the article.
 */
export const FORCE_ONLY_WHEN_NAMED: ReadonlySet<StepName> = new Set<StepName>([
  "tweets",
  "glossary",
  "summary",
]);

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

/**
 * How many blocks a blocks.json holds, or 0 if it isn't there or isn't readable.
 *
 * Every unhappy answer is 0 — missing, half-written, not the shape we expect.
 * Only logging calls this, and a logging helper must never be the thing that
 * fails a step, so "we don't know" and "there was nothing" deliberately give the
 * same answer: stay quiet.
 */
async function countBlocksIn(file: string): Promise<number> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as { blocks?: unknown };
    return Array.isArray(parsed.blocks) ? parsed.blocks.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Did this article already have ids before stage 3 runs, and how many?
 *
 * Only the id-orphaning warn below uses this, and it exists so that warn can
 * tell apart the two ways a run can carry nothing over: a first ingest, where
 * minting every id is the correct and only thing to do, and a re-run over an
 * article that already had ids, where minting every id throws away every anchor
 * into it. Mere existence would confuse them, because an article whose first
 * extraction produced nothing leaves a perfectly real `{"blocks": []}` behind.
 *
 * **Both copies, and the second one is the point.** Stage 3 carries ids over
 * from its own copy beside the HTML, so that is what it reads and what this asks
 * first. But block-ids.md calls `data/<slug>/blocks.json` a source artefact
 * rather than a cache precisely because losing it loses the ids for good — and
 * if only stage 3's copy has gone missing, carry-over silently has nothing to
 * work from while stage 4's copy still sits there recording every id that used
 * to exist. Asking that copy too is what turns the worst case from an invisible
 * one into a warn. Read second because it is only needed when the first is
 * empty.
 */
async function previousBlockCount(ctx: StepContext): Promise<number> {
  const own = await countBlocksIn(blocksPathFor(ctx));
  if (own > 0) return own;
  return countBlocksIn(path.join(ctx.dir, "blocks.json"));
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
      const host = new URL(url).hostname;
      ctx.report(host);
      const html = await fetchHtml(url, { signal: ctx.signal });
      await mkdir(ctx.dir, { recursive: true });
      await writeFile(path.join(ctx.dir, "raw.html"), html, "utf8");
      const kb = Math.round(html.length / 1024);
      /* The **hostname**, not the URL. A log of full article URLs is a reading
         history, and nothing writes one down: the enqueue line in src/jobs.ts
         deliberately logs the slug and not the url, and says so. (This comment
         used to claim the URL "is already written once when the job is
         enqueued", which was never true — it read as a reason to relax here,
         which is the opposite of what the neighbouring file decided. Found by a
         GPT/Codex review, 2026-08-26.) The host and the size are what you want
         when a page comes back suspiciously small, or when one publisher keeps
         failing. See log.ts's note on `url` not being redacted, and why. */
      plog.debug({ slug: ctx.slug, step: "fetch", host, kb }, `fetch ${ctx.slug}: ${kb} KB`);
      return `${kb} KB`;
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
      // Read before the stage runs, because the stage overwrites blocks.json
      // with its own output. Afterwards there is no way to ask what was there.
      const previousBlocks = await previousBlockCount(ctx);

      const run = await runBlocks({ htmlFile: ctx.htmlFile });
      const { total, minted, carried, reused } = run.stats;
      const kept = reused + carried;

      const fields = {
        slug: ctx.slug,
        step: "blocks",
        total,
        minted,
        carried,
        reused,
        previousBlocks,
      };
      plog.info(fields, `blocks ${ctx.slug}: ${total} blocks, ${minted} minted, ${kept} kept`);

      /*
       * The one thing in this pipeline that quietly destroys reader data.
       *
       * Block ids are the spine: every comment, and later every note and
       * highlight, is anchored to one (docs/project/block-ids.md). Stage 3 is
       * meant to be idempotent — ids already in the HTML are reused, and ids the
       * previous blocks.json knew are carried over by matching the block's
       * words, which is what makes a re-extraction survivable. When that works,
       * `minted` is 0 or nearly 0 on a re-run.
       *
       * So: we had blocks before, and not one of them kept its id. Every anchor
       * into this article now points at nothing. The step still *succeeds* —
       * that is the whole problem, and it is the shape of failure this project
       * keeps meeting (docs/reusable/silent-success.md). A warn is the only
       * thing that would tell you.
       *
       * **`kept === 0`, deliberately, and not a ratio.** Zero survivors is
       * unambiguous, and it has three causes: carry-over is broken, the previous
       * blocks.json went missing, or the publisher rewrote every paragraph. The
       * reader's anchors are equally gone in all three, so all three deserve the
       * line, and none of them needs a threshold anyone has to tune. This warn
       * therefore says *what happened*, not whose fault it was — which is the
       * honest thing a log line can say from here.
       *
       * A *partial* loss — 5 of 139 survive — is just as real and is **not**
       * warned about, because any cutoff would be a guess and a guessed alarm
       * gets ignored. `previousBlocks`, `carried` and `reused` are all in the
       * info line above, so that case is one query away instead.
       *
       * `previousBlocks > 0` is what keeps a first ingest quiet: everything is
       * minted and nothing is lost, which is the opposite of a problem.
       */
      if (previousBlocks > 0 && kept === 0 && minted > 0) {
        plog.warn(
          fields,
          `blocks ${ctx.slug}: all ${minted} ids re-minted — ${previousBlocks} previous ids lost, anchors orphaned`,
        );
      }
      return `${total} blocks, ${minted} new ids (${kept} kept)`;
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
      /* `run.elapsedMs`, not a timer around this closure. The stage times the
         model call itself, which is the number that answers "what does a tree
         cost"; a timer out here would fold in reading blocks.json and writing
         two files, and quietly drift as that IO changed. Same for the other two
         model steps. */
      plog.info(
        {
          slug: ctx.slug,
          step: "toc",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          ms: run.elapsedMs,
          blocks: run.blocks,
          sections: run.internal,
        },
        `toc ${ctx.slug}: ${run.internal} sections over ${run.blocks} blocks`,
      );
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
      plog.info(
        {
          slug: ctx.slug,
          step: "arc",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          ms: run.elapsedMs,
          blocks: run.blocks,
          parts: run.parts.length,
        },
        `arc ${ctx.slug}: ${run.arc.entries.length} sentences over ${run.parts.length} parts`,
      );
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
      /* `run.thread.generator` is this stage's model id — it is already stored
         on the thread, because `threadIsCurrent` compares it to decide whether a
         thread needs rewriting. So unlike toc and arc, nothing had to be added
         to src/tweets.ts to log it. */
      plog.info(
        {
          slug: ctx.slug,
          step: "tweets",
          model: run.thread.generator,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          ms: run.elapsedMs,
          posts: run.thread.tweets.length,
          over: run.over,
        },
        `tweets ${ctx.slug}: ${run.thread.tweets.length} posts${over}`,
      );
      return `${run.thread.tweets.length} posts${over}`;
    },
  },

  /* Stage 5d — the glossary. In this list but not in DEFAULT_INGEST_STEPS, for
     the same reason `tweets` is not: it costs a model call and it is a thing
     somebody asks for.

     The second step with a real `isDone`, and the first whose `run` is not
     idempotent in the ordinary sense: running it again on a *current* glossary
     adds terms rather than rewriting the ones there. That is deliberate and it
     is what "Find more terms" is (docs/project/glossary.md § Finding more), but
     it is also exactly why this step must never be forced by position — see
     FORCE_ONLY_WHEN_NAMED above. Read those two notes together. */
  glossary: {
    name: "glossary",
    label: "Finding the terms",
    outputs: (ctx) => [path.join(ctx.dir, "glossary.json")],
    isDone: (ctx) => glossaryIsCurrent(ctx.dir),
    async run(ctx) {
      const run = await generateGlossary({
        dir: ctx.dir,
        onProgress: ctx.report,
        signal: ctx.signal,
      });
      const total = run.glossary.entries.length;
      plog.info(
        {
          slug: ctx.slug,
          step: "glossary",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          ms: run.elapsedMs,
          terms: total,
          added: run.added,
          pass: run.glossary.passes,
          /* The one number in this line that is a quality signal rather than a
             cost. An entry matching no block is the prompt's alias instruction
             not landing — the model named a term the article does not use in
             those words. It is not an error and must not fail the step, but it
             is the thing to watch when a glossary starts feeling wrong, and it
             is invisible unless it is written down. */
          unmatched: run.unmatched,
        },
        `glossary ${ctx.slug}: ${total} terms (${run.added} new, pass ${run.glossary.passes})`,
      );
      const added = run.glossary.passes > 1 ? `, ${run.added} new` : "";
      return `${total} ${total === 1 ? "term" : "terms"}${added}`;
    },
  },
  summary: {
    name: "summary",
    label: "Writing the summaries",
    outputs: (ctx) => [path.join(ctx.dir, "summary.json")],
    isDone: (ctx) => summariesAreCurrent(ctx.dir),
    async run(ctx) {
      const run = await generateSummaries({
        dir: ctx.dir,
        onProgress: ctx.report,
        signal: ctx.signal,
      });
      const { missing } = run.summaries;
      plog.info(
        {
          slug: ctx.slug,
          step: "summary",
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          ms: run.elapsedMs,
          sections: run.targets,
          batches: run.batches,
          /* The two quality signals in this line, and the reason partial
             salvage is safe to have at all. `missing` is how many sections came
             out of this run with no summary; `failedBatches` is how many groups
             gave up entirely after their one repair attempt. Both are normally
             zero, neither is an error, and a run that quietly starts returning
             a handful every time is the prompt or the model having moved —
             which is exactly the failure that is invisible unless it is
             counted. See docs/reusable/silent-success.md. */
          missing,
          failedBatches: run.failedBatches,
        },
        `summary ${ctx.slug}: ${run.targets - missing}/${run.targets} sections in ${run.batches} groups`,
      );
      const short = missing > 0 ? `, ${missing} missing` : "";
      return `${run.targets - missing} of ${run.targets} sections${short}`;
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
