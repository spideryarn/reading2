/**
 * Eval — **what does one interaction cost?**
 *
 *   npm run eval:cost:interactions -- --slug <slug> --preflight
 *   npm run eval:cost:interactions -- --slug <slug>
 *   npm run eval:cost:interactions -- --slug <slug> --task chat --task explain
 *   npm run eval:cost:interactions -- --list
 *
 * The other half of [run.ts](run.ts). That one measures what an *article* costs
 * — the ingest and the eight modes, each a job through the production queue.
 * This measures what a *reader* costs after the article exists: a chat turn, a
 * Remember turn, an explanation, a glossary term checked on the web, a search, a
 * marked quiz answer, the four referee tasks, a dictated sentence, the
 * embeddings a diagram buys — the whole of the plan's stated per-interaction
 * inventory, with `--list` as the roll call. Per-article and per-interaction are
 * kept apart on purpose and **must never be added together** — the plan's
 * Principles, and the reason is that one is paid once and the other is paid
 * every time somebody presses something.
 *
 * ## It needs an article, and the article has to be the eval owner's
 *
 * `--slug` names one rather than ingesting one: ingesting is what run.ts does,
 * and paying for a second ingest here would put an article's cost inside an
 * interaction's. **The article must belong to `EVAL_OWNER_ID`**, because every
 * store read below runs under `runAsOwner(EVAL_OWNER_ID, …)` and an article
 * owned by anybody else is a 404 to it. The way to get one is
 * `npm run eval:cost -- --fixture short-html --keep`, which leaves the article
 * behind and prints its slug.
 *
 * ## Cold and warm, reported separately and never averaged
 *
 * The prompt cache is worth **2.5× on a chat turn and 7× on quiz marking** —
 * the largest lever in the baseline data (stage 1 of the plan). So each task
 * runs twice against the same article and the two rounds are reported side by
 * side: round 1 is the first touch, round 2 is the turn after it. A task with
 * no article in its prompt (dictation) runs once and says why.
 *
 * **A round's label is a claim and the calls are the evidence.** `report.ts §
 * roundCache` decides cold or warm from the calls themselves — a read is
 * pre-existing when no earlier call in the round wrote a cache — and
 * `cacheRatio` prints "cache worth 2.5×" only when both rounds succeeded, both
 * were priced, and each one's observed state is the state it was labelled with.
 * Labelling by position is what made a wrong ratio possible: chat's tool loop
 * can read cache on a later call when the first was cold, and chat may invoke
 * passage search before the standalone search task runs at all, warming a round
 * still called cold. **A missing ratio is a fine outcome; a wrong one is not.**
 *
 * ## Why these are driven live rather than harvested from the ledger
 *
 * The plan gives three grounds and they all still hold. No ledger row records
 * the commit, so a changed prompt or `max_tokens` is invisible; chat's
 * historical warm rows straddle the 2026-08-26 automatic-breakpoint bug
 * (postmortem 260826h) and so describe a broken-cache era; and the referee tasks
 * have no ledger coverage at all. Historical figures are sanity cross-checks,
 * not comparators.
 *
 * ## No production change, and the reason it needs none
 *
 * **The only collector on the request path is the one `handleApi` opens**
 * (src/routes.ts), and nested collectors *shadow* — so if any function called
 * below opened its own, the rows would be recorded in that collector's scope and
 * the eval scope here would be silently ignored. Checked rather than assumed:
 * `grep -rn collectSpend src/` finds it defined in src/ai-spend.ts and opened in
 * exactly three places — src/routes.ts (per request), src/jobs.ts (per pipeline
 * step) and src/cli-ledger.ts (`withLedger`, which is what this file uses).
 * None of `converse`, `explain`, `findPassages`, `markAnswer`, `runCriterion`,
 * `runClaims`, `mirror`, `lookUpTerm`, `transcribe` or `articleVectors` opens
 * one, and none of them sets its own attribution either — every one of them
 * relies on its caller for `articleSlug`, exactly as the routes do. So this file
 * wraps each call in `withSpendAttribution({ articleSlug, ownerId })` for the
 * same reason routes.ts does — and for one more: `withLedger` pins the
 * collector's owner to `environmentOwnerId()`, so without the second field these
 * rows land under the wrong owner with a null `article_id`. See `measure`.
 *
 * Two of the tasks reach production through a **seam** rather than through the
 * whole route: `lookUpTerm` is built by `makeLookUpTerm` with a fabricated
 * glossary and a sink for the write, and Remember and Candidates are `converse`
 * with a `kind`, because that is all the routes give them either.
 *
 * The idiom itself is not new — `evals/referee-claims.ts` and
 * `evals/referee-mirror.ts` already call these functions directly under
 * `withLedger("eval", main)`.
 *
 * docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md
 * § *Per-interaction unit costs*.
 */

import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  currentSpend,
  formatNanos,
  type SpendRecord,
  totalSpend,
  withSpendAttribution,
} from "../../src/ai-spend.js";
/* **`src/store/index.js`, not `src/api.js`.** `src/api.ts` was the filesystem
   reader and went with the filesystem store on 2026-09-05; this is the
   store-aware binding routes.ts uses. */
import { loadArticle } from "../../src/store/index.js";
import { articleVectors } from "../../src/article-vectors.js";
import { withLedger } from "../../src/cli-ledger.js";
import { converse } from "../../src/converse.js";
import { loadEnvLocal } from "../../src/env.js";
import { explain } from "../../src/explain.js";
import { isMain } from "../../src/is-main.js";
import { environmentOwnerId, EVAL_OWNER_ID, runAsOwner } from "../../src/owner.js";
import { markAnswer } from "../../src/quiz-mark.js";
import { runClaims } from "../../src/referee-claims-run.js";
import { runCriterion } from "../../src/referee-criteria-run.js";
import { mirror } from "../../src/referee-mirror.js";
import { CANDIDATES_OPENING } from "../../src/referee-candidates.js";
import { findPassages } from "../../src/search.js";
import { costStore } from "../../src/store/ai-calls.js";
import { makeLookUpTerm } from "../../src/term-lookup.js";
import type { LookupsByTerm } from "../../src/glossary-lookups.js";
import type {
  Article,
  Block,
  ChatMessage,
  Glossary,
  GlossaryEntry,
  GlossaryLookup,
  RememberStance,
  ThreadKind,
} from "../../src/types.js";
import { transcribe } from "../../src/transcribe.js";
import { assertDistinctEvalOwner, assertLedgerUsable, localTarget } from "./harness.js";
import {
  cacheRatio,
  type RoundCache,
  type RoundForRatio,
  roundCache,
} from "./report.js";

/** A committed recording, so two runs measure the same seconds of audio. */
const DICTATION_CLIP = "evals/dictation/clips/short.webm";

/* ---------------------------------------------------------------- tasks -- */

interface TaskContext {
  slug: string;
  article: Article;
  /** 1 is the cold touch, 2 the turn after it. */
  round: 1 | 2;
}

/**
 * **How many rounds, and whether their quotient means anything.**
 *
 * A union rather than a count plus a flag, because the third case is the one a
 * count loses: `referee-candidates` really does run twice and its second turn
 * really does read the article warm, but the two turns do **different work** —
 * the brief searches barely at all and the names turn does nearly all of it — so
 * dividing one by the other measures the two turns' scope and not the cache.
 * Both numbers are worth having; the ratio is not.
 */
type RoundPlan =
  /** Nothing to warm. The `note` says why, since that is a different fact from "we ran it once". */
  | { kind: "one" }
  /** The same work against a cold article and then a warm one — the cache measurement. */
  | { kind: "cold-then-warm" }
  /** Two real turns of a conversation, doing different work. Priced separately, never divided. */
  | { kind: "two-different-turns" };

const roundCount = (plan: RoundPlan): 1 | 2 => (plan.kind === "one" ? 1 : 2);

interface InteractionTask {
  name: string;
  /** What this task's number means, carried into the result file rather than only here. */
  note: string;
  rounds: RoundPlan;
  /** Returns a one-line detail for the record — never the model's prose. */
  run(ctx: TaskContext): Promise<string>;
}

/** The first block with enough prose to quote, so a task has something real to point at. */
function quotableBlock(blocks: readonly Block[]): Block {
  const found = blocks.find((b) => b.gistable && b.words > 12);
  if (found) return found;
  const any = blocks[0];
  if (!any) throw new Error("That article has no blocks at all — nothing here can run on it.");
  return any;
}

/**
 * A glossary entry anchored to a block that really contains its name.
 *
 * `lookUpTerm` refuses an entry whose name (or any alias) does not appear in the
 * block it points at — a 409, and the right refusal: it would otherwise tell the
 * model a passage was selected in a paragraph that has nothing to do with the
 * term. So the name is lifted **out of** the block: one long word, which
 * `termPattern`'s word-boundary match will find.
 */
function fabricatedEntry(block: Block): GlossaryEntry {
  const word = block.text.match(/[A-Za-z]{7,}/)?.[0];
  if (!word) {
    throw new Error(
      `No word of seven letters or more in block ${block.id}, so no glossary term can be ` +
        "anchored to it. Point --slug at an article with ordinary prose in it.",
    );
  }
  return { id: block.id, name: word, kind: "concept", aliases: [], blocks: [block.id] };
}

function fabricatedGlossary(slug: string, entry: GlossaryEntry): Glossary {
  return {
    version: "glossary/2",
    generator: "evals/cost/interactions.ts",
    slug,
    sourceHash: "eval-fabricated",
    passes: 1,
    generatedAt: new Date().toISOString(),
    elapsedMs: 0,
    entries: [entry],
  };
}

/** A short quote out of a block, cut at a space so it is a phrase and not a fragment. */
function quoteFrom(block: Block, max = 90): string {
  const text = block.text.slice(0, max);
  const cut = text.lastIndexOf(" ");
  return cut > 20 ? text.slice(0, cut) : text;
}

/**
 * **Two questions, not one asked twice.** A repeated question would be a
 * different measurement — some providers deduplicate — and a reader's second
 * turn is a new question against a warm article, which is the thing being
 * priced.
 */
const QUESTIONS = [
  "What is the central claim here, and what would have to be true for it to hold?",
  "Which part of this does the piece itself treat as least settled?",
] as const;

/** What a reader says they took from the piece, and the follow-up a Remember turn gets. */
const RECOLLECTIONS = [
  "I think the argument is that the obvious explanation is the wrong one, and that the " +
    "evidence for the alternative is mostly indirect.",
  "I still cannot say what the author thinks follows from it in practice.",
] as const;

/**
 * **One turn of a conversation, whichever of the three kinds it is.**
 *
 * Chat, Remember and Candidates are all `converse` with a different `kind`
 * (src/converse.ts § `systemFor`, `jobFor`, `defaultModel`) — the prompt, the
 * model, the timeout and the web-search tool all follow from it — so they are
 * one function here rather than three copies that would drift. Round 2 carries
 * round 1's turn as history, which is what makes it warm: the article message is
 * byte-identical for the life of a conversation (tests/article-prompt.test.ts)
 * and the breakpoint sits after it.
 */
async function oneTurn(opts: {
  task: string;
  ctx: TaskContext;
  question: string;
  kind: ThreadKind;
  stance?: RememberStance;
}): Promise<string> {
  const { task, ctx, question, kind } = opts;
  let text = "";
  let tools = 0;
  for await (const event of converse({
    meta: ctx.article.meta,
    blocks: ctx.article.blocks,
    history: historyBefore(task, ctx.round),
    question,
    slug: ctx.slug,
    kind,
    ...(opts.stance ? { stance: opts.stance } : {}),
    /* `null` rather than the reader's real profile: the profile lands in the
       final user message, after the breakpoint, so it changes the answer and
       not the cache — and a run whose numbers depend on whose profile was in
       the database is not repeatable. */
    profile: null,
  })) {
    if (event.type === "delta") text += event.text;
    if (event.type === "tool") tools += 1;
  }
  if (ctx.round === 1) firstTurn.set(task, { question, answer: text });
  return `${text.length} chars, ${tools} tool event(s)`;
}

const TASKS: readonly InteractionTask[] = [
  {
    name: "chat",
    note:
      "One chat turn through `converse`, with the production tool loop on. Round 2 carries " +
      "round 1's turn as history, which is what makes it warm — the article message is " +
      "byte-identical for the life of a conversation (tests/article-prompt.test.ts) and the " +
      "breakpoint sits after it.",
    rounds: { kind: "cold-then-warm" },
    run: (ctx) =>
      oneTurn({
        task: "chat",
        ctx,
        question: QUESTIONS[ctx.round - 1] ?? QUESTIONS[0],
        kind: "chat",
      }),
  },
  {
    name: "remember",
    note:
      "One Remember turn — the reader says what they took from the piece and finds out. It is " +
      "`converse` with `kind: \"remember\"`, which is the whole difference: a different system " +
      "prompt, and the stance appended to the FINAL user message (src/converse.ts § " +
      "`stanceLine`), below the breakpoint, so the stance costs nothing in cache terms. " +
      "`balanced` is the stance the picker starts on. It bills under the `chat` AI job, so " +
      "read its number beside chat's rather than as a new line in the model table. The wire " +
      "validation in `streamChat` (thread kind, MAX_REMEMBER_CHARS) is not an input to the " +
      "model call, so no thread is needed.",
    rounds: { kind: "cold-then-warm" },
    run: (ctx) =>
      oneTurn({
        task: "remember",
        ctx,
        question: RECOLLECTIONS[ctx.round - 1] ?? RECOLLECTIONS[0],
        kind: "remember",
        stance: "balanced",
      }),
  },
  {
    name: "explain",
    note:
      "One explanation of a selection, through `explain`. It has a real per-article cache " +
      "breakpoint, so round 2 explains a *different* quote from the same article and should " +
      "read the prefix warm. `deep` is off — the web-search extra is a thing the reader asks " +
      "for, and pricing it is a separate question.",
    rounds: { kind: "cold-then-warm" },
    async run({ article, round }) {
      const block = quotableBlock(article.blocks.slice(round === 1 ? 0 : 1));
      const result = await explain({
        meta: article.meta,
        blocks: article.blocks,
        blockId: block.id,
        quote: quoteFrom(block),
        profile: null,
      });
      return `${result.answer.length} chars, ${result.searches} web search(es), ${result.citations.length} citation(s)`;
    },
  },
  {
    name: "glossary-lookup",
    note:
      "One glossary term checked on the web, through the production `lookUpTerm` " +
      "(src/term-lookup.ts). **It is `explain` with a different selection, deliberately** — the " +
      "glossary was built as the same mechanism rather than a second one — so this number " +
      "should come out at `explain`'s, and the point of running it is that we have never " +
      "checked. The glossary entry is fabricated rather than generated: a term is a name plus " +
      "the block it appears in, so a real word out of a real block is a real anchor, and " +
      "running the `glossary` mode here would put an article cost inside an interaction. The " +
      "store it writes to is a sink, so the eval owner's article is left as it was found.",
    rounds: { kind: "cold-then-warm" },
    async run({ article, slug, round }) {
      const block = quotableBlock(article.blocks.slice(round === 1 ? 0 : 1));
      const entry = fabricatedEntry(block);
      const lookUpTerm = makeLookUpTerm({
        reader: {
          loadArticle: async () => article,
          loadGlossary: async () => ({
            glossary: fabricatedGlossary(slug, entry),
            stale: false,
            outdated: false,
          }),
        },
        /* **A sink, not the real store.** The lookup is reader state on somebody
           else's article and this run is not that reader; keeping the write out
           means a repeated run measures the same thing every time, and it is the
           model call that costs money, not the row. */
        lookups: { load: async (): Promise<LookupsByTerm> => ({}), save: async (): Promise<LookupsByTerm> => ({}) },
      });
      /* The route streams since 2026-09-10; a cost run wants the one `done`. */
      let lookup: GlossaryLookup | undefined;
      for await (const event of (await lookUpTerm(slug, entry.id)).stream()) {
        if (event.type === "done") lookup = event.entry.lookup;
      }
      return `"${entry.name}" — ${lookup?.answer.length ?? 0} chars, ${lookup?.searches ?? 0} web search(es)`;
    },
  },
  {
    name: "search",
    note:
      "One passage search, through `findPassages`. Its prompt is the article and then the " +
      "criterion, with the breakpoint between them, so round 2 uses a different criterion and " +
      "reads the same article warm.",
    rounds: { kind: "cold-then-warm" },
    async run({ article, round }) {
      const criterion =
        round === 1 ? "passages that make a concrete prediction" : "passages that concede a limitation";
      const result = await findPassages({
        meta: article.meta,
        blocks: article.blocks,
        criterion,
      });
      return `${result.hits.length} hit(s)`;
    },
  },
  {
    name: "quiz-mark",
    note:
      "One quiz answer marked, through `markAnswer` — the interaction the baseline found the " +
      "cache worth 7× on. The question, reference answer and evidence are fabricated from the " +
      "article's own blocks rather than read from a generated quiz, because a quiz is a mode " +
      "run.ts already prices; what is being priced here is the *marking* call, and its prompt " +
      "shape does not depend on where the question came from.",
    rounds: { kind: "cold-then-warm" },
    async run({ article, round }) {
      const block = quotableBlock(article.blocks.slice(round === 1 ? 0 : 1));
      const quote = quoteFrom(block, 160);
      const result = await markAnswer({
        meta: article.meta,
        blocks: article.blocks,
        question: `In your own words, what is this passage doing in the argument?`,
        referenceAnswer: quote,
        evidence: [{ blockId: block.id, quote, start: 0 }],
        /* A deliberately half-right answer, so the marker has something to
           disagree with — a perfect answer and a blank one are the two cheapest
           cases and neither is what a reader writes. */
        answer:
          round === 1
            ? "It sets up the main claim, though I am not sure it establishes it."
            : "I think it is mostly an aside, but it does introduce the term used later.",
      });
      return `${result.reply.length} chars`;
    },
  },
  {
    name: "referee-criterion",
    note:
      "One referee criterion run, through `runCriterion` — the per-turn referee call, and the " +
      "one referee task a reader repeats. `{kind: \"single\"}` is the simplest of the three " +
      "configs; the diverging and literature kinds send different prompts and would each be " +
      "their own measurement.",
    rounds: { kind: "cold-then-warm" },
    async run({ article, round }) {
      const outcome = await runCriterion({
        meta: article.meta,
        blocks: article.blocks,
        criterion:
          round === 1
            ? "Places where a claim is made without evidence"
            : "Places where a term is used before it is defined",
        config: { kind: "single" },
      });
      return `${JSON.stringify(outcome).length} bytes of outcome`;
    },
  },
  {
    name: "referee-candidates",
    note:
      "The fourth referee task — finding reviewers — and it is `converse` with " +
      "`kind: \"candidates\"` rather than a runner of its own: the shortlist is parsed out of " +
      "the reply (src/referee-candidates.ts § `readShortlist`), never sent to it, so there is " +
      "no stored state to fabricate. **The app's most expensive turn by design**: a 240s " +
      "timeout, 12k output tokens and Exa web search set to 30 results (src/converse.ts). " +
      "**Two turns, and their ratio is not a cache measurement** — round 1 is the fit brief " +
      "and searches barely at all, round 2 asks for names and does nearly all the searching, so " +
      "they are two prices rather than one price twice. Pricing only the brief would have " +
      "reported the cheap half of the interaction as the whole of it.",
    rounds: { kind: "two-different-turns" },
    run: (ctx) =>
      oneTurn({
        task: "referee-candidates",
        ctx,
        question:
          ctx.round === 1
            ? CANDIDATES_OPENING
            : "Now give me the names, with the fit reason for each.",
        kind: "candidates",
      }),
  },
  {
    name: "referee-claims",
    note:
      "**A per-ARTICLE artefact, not a per-interaction one** — it is generated once and stored, " +
      "like a mode. It is measured here rather than in run.ts only because it is not a pipeline " +
      "step and so cannot be a draw there. Add it to the article's cost, never to a reader's.",
    rounds: { kind: "one" },
    async run({ article }) {
      const outcome = await runClaims({ meta: article.meta, blocks: article.blocks });
      return `${JSON.stringify(outcome).length} bytes of outcome`;
    },
  },
  {
    name: "referee-mirror",
    note:
      "**A repeated per-INTERACTION cost, not a stored artefact** — this was classified the " +
      "other way and it was wrong. `runMirror` writes nothing at all: no pending row, no " +
      "attempt, no result (src/routes.ts § runMirror, \"a remark is a prompt to look at your " +
      "own sentence again, not an artefact, and a reload asking for one again is a referee " +
      "asking again\"; src/web/useMirror.ts says \"one button, one run, nothing stored\"). So a " +
      "referee pays this on every press and again after every reload. Add it to the reader's " +
      "cost, never to the article's. It needs at least one comment with a body — `mirrorStream` " +
      "returns without a model call when there are none, above the API-key check, so a run with " +
      "no comments would look free and have bought nothing. One is fabricated here for that " +
      "reason. **One round**: mirror is never given the article and sends no `cache_control` at " +
      "all (src/referee-mirror.ts § the messages one run sends), so there is no prefix a second " +
      "press could read warm — which is part of why repeating it is not cheap.",
    rounds: { kind: "one" },
    async run({ article }) {
      const block = quotableBlock(article.blocks);
      const result = await mirror({
        blocks: article.blocks,
        comments: [
          {
            id: "spya-evalcm1",
            blockId: block.id,
            quote: quoteFrom(block),
            start: 0,
            createdAt: new Date().toISOString(),
            /* `none` — the referee wrote this themselves and asked no model
               about it, which is what a plain mark is (src/types.ts § Comment). */
            status: "none",
            body: "This is asserted rather than argued, and the rest of the section leans on it.",
          },
        ],
      });
      return `${JSON.stringify(result).length} bytes of result`;
    },
  },
  {
    name: "dictation",
    note:
      `One recording (${DICTATION_CLIP}) transcribed through \`transcribe\`, with the article's ` +
      "vocabulary in scope as the composer's mic has. **One round, because there is no article " +
      "prefix and no explicit cache breakpoint.** The number scales with the seconds of audio, " +
      "so it is a rate rather than a per-press price. " +
      "**Its cache state is UNKNOWN and will stay that way**, which is a stronger statement than " +
      "cold: since 2026-09-07 dictation is a transcription request to `openai/gpt-transcribe` on " +
      "the transcription endpoint, whose `usage` is `{seconds, cost}` — no token counts of any " +
      "kind, so no cache-read count for `roundCache` to read. It returns `unknown` here rather " +
      "than `cold`, this round is listed every run as not the state it was labelled, and the " +
      "zeros on its token line mean *not reported* rather than *measured zero*. " +
      "**The wording has now been wrong twice and both mistakes are worth keeping.** It first " +
      "said nothing could warm, which was false: `DICTATION_MODEL` was then a Gemini model and " +
      "Gemini caches implicitly, by default, with no breakpoint asked for, and the clip and the " +
      "vocabulary are fixed so a rerun inside the cache lifetime resends identical bytes. The " +
      "correction to that said the round was *checked* rather than assumed — which is still the " +
      "right instinct and is now the reason there is no answer, because the new wire reports " +
      "nothing to check. Whether the upstream warms anything is not something we can see from " +
      "here; do not write it down as cold.",
    rounds: { kind: "one" },
    async run({ slug }) {
      const audio = (
        await readFile(path.join(import.meta.dirname, "..", "..", DICTATION_CLIP))
      ).toString("base64");
      const result = await transcribe(audio, "webm", { kind: "article", slug });
      return `${result.text.length} chars in ${result.ms} ms`;
    },
  },
  {
    name: "embeddings",
    note:
      "The article embeddings a diagram buys, through `articleVectors` — **an article cost, not " +
      "an interaction cost** (the plan's Principles classifies Force/Drift embeddings as a cold " +
      "first-open article purchase). **One round**: `articleVectors` memoises on " +
      "slug + block hash in this process, so a second call would be a free cache hit rather " +
      "than a warm read, and reporting it as `warm: $0` would be a lie about the provider. " +
      "`src/similar.ts` still buys its own vectors separately, so a reader who opens both " +
      "Force and Drift can pay this twice — a known debt, not measured here.",
    rounds: { kind: "one" },
    async run({ slug, article }) {
      const vectors = await articleVectors(slug, article.blocks);
      return `${vectors.vectors.length} vector(s) over ${vectors.rows.length} row(s)`;
    },
  },
];

/**
 * Round 1's question and answer, per task, so round 2 can carry it as history.
 *
 * **Keyed by task**, which a single `let` was not: three tasks have a second
 * turn now, and a shared slot would have Remember carrying chat's answer into a
 * conversation it was never part of. Written and read by the same task, one
 * round after the other, in one process.
 */
const firstTurn = new Map<string, { question: string; answer: string }>();

/**
 * The turns before this one, as the route passes them.
 *
 * A cold round has none. A warm round has the previous question and its answer,
 * which is a real second turn rather than the same call made twice — and the
 * fallback answer exists only so a round 2 run on its own (`--task chat` after a
 * crash) is a warm turn rather than a crash of its own.
 */
function historyBefore(task: string, round: 1 | 2): ChatMessage[] {
  if (round === 1) return [];
  const before = firstTurn.get(task) ?? {
    question: QUESTIONS[0],
    answer: "That is a fair summary of what the piece argues.",
  };
  const createdAt = new Date().toISOString();
  return [
    { id: "spya-evalq1", role: "user", text: before.question, createdAt, status: "done" },
    { id: "spya-evala1", role: "assistant", text: before.answer, createdAt, status: "done" },
  ];
}

/* -------------------------------------------------------------- the record -- */

interface RoundResult {
  task: string;
  round: 1 | 2;
  /** What the round was *expected* to be. `cache` is what it turned out to be. */
  expected: "cold" | "warm";
  /**
   * **The observed cache state, from the calls rather than from the label** —
   * report.ts § `roundCache`. In the file as well as on the terminal, because
   * the ratio a reader quotes stands or falls on this and nothing else records
   * it.
   */
  cache: RoundCache;
  /** Whether the round was what it was labelled. False means no ratio may be taken from it. */
  asLabelled: boolean;
  calls: number;
  nanos: number;
  unpriced: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
  };
  models: string[];
  elapsedMs: number;
  detail?: string;
  error?: string;
}

interface RunFile {
  startedAt: string;
  slug: string;
  databaseTarget: string;
  evalOwnerId: string;
  environmentOwnerId: string;
  node: string;
  /** Words and blocks, so a per-interaction number can be read against the article's size. */
  article: { blocks: number; words: number };
  notes: string[];
  taskNotes: Record<string, string>;
  rounds: RoundResult[];
}

const STANDING_NOTES = [
  "Per-interaction costs and per-article costs must never be added together. An article is " +
    "paid for once; an interaction is paid for every time somebody presses something.",
  "`expected` says whether the round was meant to be cold or warm; `cache` says what it was, " +
    "read off the calls. A read counts as pre-existing when no earlier call in the round wrote " +
    "a cache — so chat's tool loop reading its own first call is still a cold round. A round " +
    "that was not what it was labelled is a finding about the measurement, not a price, and no " +
    "cold/warm ratio is taken from it.",
  "Every call here is made under scopeKind `eval` and ownerId EVAL_OWNER_ID, so none of it " +
    "lands in `npm run cost`'s Product bucket (scripts/ai-cost.ts defines Product as " +
    "scopeKind !== \"eval\") and every row resolves to the eval owner's article rather than to " +
    "a null article_id under the environment owner.",
  "`referee-claims` and `embeddings` are ARTICLE costs measured here only because they are not " +
    "pipeline steps and so cannot be draws in run.ts. `referee-mirror` is NOT one of them — it " +
    "stores nothing and is re-paid on every press and every reload, which makes it a repeated " +
    "reader cost. It was classified the other way until 2026-09-03.",
  "`referee-candidates` runs two turns that do different work — the fit brief, then the names " +
    "— so both numbers are real and their ratio means nothing. It is the most expensive turn " +
    "in the app by design: 12k output tokens and up to 30 web search results.",
  "Unpriced calls are unknown, not zero: a total carrying them is short by an unknown amount.",
  "The same goes for token counts. `tokens.cacheRead` and the rest are sums that read a missing " +
    "count as zero, and the model dictation is on since 2026-09-07 reports none of them — " +
    "`openai/gpt-transcribe` on the `transcription` wire, whose usage came back `{seconds, cost}` " +
    "on both calls anybody has measured. Read the row's `cache` field, not its zeros: `unknown` " +
    "there means nobody told us, and the terminal line prints NOT REPORTED rather than a number. " +
    "The token line has the same hazard and is not yet guarded the same way — a zero there may be " +
    "a real zero or a missing count, and only the `transcription` rows are suspect today.",
];

/* ------------------------------------------------------------- measuring -- */

/**
 * **Run one round and hand back exactly what it bought**, by taking the
 * collector's call list before and after.
 *
 * A nested `collectSpend` would have been the obvious way and is the wrong one:
 * nested collectors *shadow*, so the rows would carry the inner collector's
 * scope and the outer `withLedger("eval", …)` would see none of them. Slicing
 * the ambient collector's own list keeps every call in one eval-scoped run, with
 * one sink and one runId, and still says which task made which call.
 */
async function measure(
  task: InteractionTask,
  round: 1 | 2,
  ctx: TaskContext,
): Promise<RoundResult> {
  const before = currentSpend()?.calls.length ?? 0;
  const startedAt = Date.now();
  let detail: string | undefined;
  let error: string | undefined;
  try {
    /* **The article and the owner on every row.** The slug is what the routes
       set (src/routes.ts § the `withSpendAttribution` wrappers on chat, explain,
       search, quiz marking and the referee routes); without it "what has this
       piece cost me" covers the ingest and none of the questions asked about it
       afterwards.

       **`ownerId` is not redundant with the `runAsOwner` at the bottom of this
       file**, and leaving it out was a real defect. `withLedger` pins the
       collector's attribution to `environmentOwnerId()` (src/cli-ledger.ts), and
       explicit collector attribution beats ambient ownership in `ownerFor`
       (src/ai-spend.ts) — so every row landed under the environment owner, and
       the article lookup, which is owner-scoped, then wrote a null `article_id`.
       The rows were eval-scoped and stayed out of Product, and were invisible to
       every owner and article query. Re-nesting `runAsOwner` does not fix it:
       `environmentOwnerId()` reads configuration, not the ambient owner. run.ts
       passes the same field per draw, for the same reason. */
    detail = await withSpendAttribution(
      { articleSlug: ctx.slug, ownerId: EVAL_OWNER_ID },
      () => task.run(ctx),
    );
  } catch (err) {
    /* **Recorded, not thrown.** The call that failed had usually already been
       paid for, and one task falling over must not lose the numbers of the seven
       that worked — the same reasoning `CollectOptions.onDone` gives for
       reporting on both paths. */
    error = err instanceof Error ? err.message : String(err);
  }
  const after = currentSpend()?.calls ?? [];
  const mine = after.slice(before);
  const { nanos, unpriced } = totalSpend(mine);
  const expected = round === 1 ? "cold" : "warm";
  /* **In the order the collector recorded them**, which is the order they
     finished — see report.ts § `roundCache` for why that is the calling order
     here, and for which way it fails if it ever stops being. */
  const cache = roundCache(
    mine.map((c) => ({ cacheRead: c.cacheReadTokens, cacheWrite: c.cacheWriteTokens })),
  );
  return {
    task: task.name,
    round,
    expected,
    cache,
    asLabelled: cache.kind === expected,
    calls: mine.length,
    nanos,
    unpriced,
    tokens: {
      input: sum(mine, (c) => c.inputTokens),
      output: sum(mine, (c) => c.outputTokens),
      cacheRead: sum(mine, (c) => c.cacheReadTokens),
      cacheWrite: sum(mine, (c) => c.cacheWriteTokens),
      reasoning: sum(mine, (c) => c.reasoningTokens),
    },
    models: [...new Set(mine.map((c) => c.answeredBy ?? c.model))],
    elapsedMs: Date.now() - startedAt,
    ...(detail !== undefined ? { detail } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

function sum(calls: readonly SpendRecord[], of: (c: SpendRecord) => number | null): number {
  return calls.reduce((n, c) => n + (of(c) ?? 0), 0);
}

function printRound(r: RoundResult): void {
  console.log(
    `  ${r.task.padEnd(18)} ${r.expected.padEnd(4)}  ${formatNanos(r.nanos).padStart(9)}  ` +
      `${String(r.calls).padStart(2)} call(s)  ${(r.elapsedMs / 1000).toFixed(1)}s` +
      (r.unpriced > 0 ? `  ${r.unpriced} unpriced` : "") +
      (r.error ? `  FAILED: ${r.error}` : ""),
  );
  console.log(
    `  ${" ".repeat(18)}      tokens ${r.tokens.input.toLocaleString()} in / ` +
      `${r.tokens.output.toLocaleString()} out / ${r.tokens.reasoning.toLocaleString()} reasoning / ` +
      /* **`0 cache-read` and "nobody said" are different facts and used to print
         the same.** `sum` coerces a `null` count to zero, so a model reporting
         no counts — `openai/gpt-transcribe`, whose `usage` came back
         `{seconds, cost}` (src/models.ts § `Wire`) — rendered as a round that had
         demonstrably read no cache. `roundCache` already knows the difference and
         says so in `r.cache`, so this reads the verdict that exists rather than
         adding a second one. Added 2026-09-07 with dictation's move to
         the transcription endpoint.

         **The `in / out / reasoning` numbers on the line above have the same
         hazard and are not guarded**, so a transcription row still shows
         `0 in / 0 out`. Left because the fix is not another suffix — those three
         are summed across every row in the round, so one unreported row cannot
         be spoken for without splitting the sum by wire. Named here rather than
         quietly tolerated; GPT Sol's third review. */
      (r.cache.kind === "unknown"
        ? "cache-read / cache-write NOT REPORTED"
        : `${r.tokens.cacheRead.toLocaleString()} cache-read / ${r.tokens.cacheWrite.toLocaleString()} cache-write`) +
      /* The line that says whether the label was true, and it is the one thing
         on this page a wrong ratio would come from. A token count nobody reads
         is not a verdict; `roundCache` is. */
      (r.asLabelled ? "" : `   ← labelled ${r.expected}, ${describeCache(r.cache)}`) +
      (r.detail ? `\n  ${" ".repeat(18)}      ${r.detail}` : ""),
  );
}

/** The observed cache state as a phrase, for a line that already says what was expected. */
function describeCache(cache: RoundCache): string {
  switch (cache.kind) {
    case "no-calls":
      return "made no calls at all";
    case "unknown":
      return `cache state UNKNOWN — ${cache.why}`;
    case "cold":
      return cache.readWithinRound > 0
        ? `read nothing it had not written itself (${cache.readWithinRound} token(s) within the round)`
        : "read no cache at all";
    case "warm":
      return `read ${cache.read} PRE-EXISTING cached token(s)`;
  }
}

/* ------------------------------------------------------------------- main -- */

interface Args {
  slug: string;
  tasks: string[];
  preflight: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  if (argv.includes("--list")) {
    for (const t of TASKS) console.log(`${t.name}  (${roundCount(t.rounds)} round(s))  ${t.note}`);
    process.exit(0);
  }
  /* Gathered locally and only then made an `Args`, so the type says the slug is
     there rather than the code checking it again downstream. */
  let slug: string | null = null;
  const tasks: string[] = [];
  let preflight = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--slug":
        slug = argv[++i] ?? null;
        if (!slug) throw new Error("--slug needs a value");
        break;
      case "--task": {
        const name = argv[++i];
        if (!name) throw new Error("--task needs a value");
        if (!TASKS.some((t) => t.name === name)) {
          throw new Error(`No task "${name}". Have: ${TASKS.map((t) => t.name).join(", ")}`);
        }
        tasks.push(name);
        break;
      }
      case "--preflight":
        preflight = true;
        break;
      default:
        throw new Error(`Unknown argument ${flag}`);
    }
  }
  if (slug === null) {
    throw new Error(
      "--slug names the article to talk to. It must be one EVAL_OWNER_ID holds, because every " +
        "read here runs as that owner — `npm run eval:cost -- --fixture short-html --keep` " +
        "leaves one behind and prints its slug.",
    );
  }
  return { slug, tasks, preflight };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  /* **Every gate before anything that could spend**, and the same three run.ts
     uses — this file creates no articles and no jobs, so it needs no others, but
     it spends real money and so needs all of these. */
  const databaseTarget = localTarget(process.env.DATABASE_URL);
  assertDistinctEvalOwner(EVAL_OWNER_ID, environmentOwnerId());

  console.log(`Target: ${databaseTarget}`);
  console.log(`Ledger: ${costStore.describe()}`);
  console.log(`Owner:  ${EVAL_OWNER_ID}   (environment owner ${environmentOwnerId()})`);
  console.log(`Slug:   ${args.slug}`);

  /* Last, and before any money: the run's whole product is rows in this table,
     and on 2026-09-02 a run spent $0.0333 into a ledger that could not hold it.
     evals/cost/harness.ts § assertLedgerUsable. */
  await assertLedgerUsable(() => costStore.forJob("spya-ledger-probe"));

  const chosen = args.tasks.length > 0 ? TASKS.filter((t) => args.tasks.includes(t.name)) : TASKS;

  /* **Loaded before the preflight returns**, so `--preflight` also answers the
     question that actually stops these runs: is there an article under that
     slug that this owner can see. It is a free read. */
  const article = await loadArticleOrExplain(args.slug);
  const words = article.blocks.reduce((n, b) => n + b.words, 0);
  console.log(`Article: ${article.blocks.length} blocks, ${words} words`);
  console.log(`Tasks:  ${chosen.map((t) => `${t.name}×${roundCount(t.rounds)}`).join(", ")}`);

  if (args.preflight) {
    console.log(
      "\n--preflight: the gates above are everything this run checks — local target, an eval " +
        "owner no browser is signed in as, a ledger that answers, and an article this owner " +
        "can read. It spends nothing.",
    );
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const runDir = path.join(
    import.meta.dirname,
    "..",
    "results",
    "cost",
    `${stamp}-interactions-${args.slug}`,
  );
  await mkdir(runDir, { recursive: true });
  const runFile: RunFile = {
    startedAt: new Date().toISOString(),
    slug: args.slug,
    databaseTarget,
    evalOwnerId: EVAL_OWNER_ID,
    environmentOwnerId: environmentOwnerId(),
    node: process.version,
    article: { blocks: article.blocks.length, words },
    notes: STANDING_NOTES,
    taskNotes: Object.fromEntries(chosen.map((t) => [t.name, t.note])),
    rounds: [],
  };
  /* Through a temporary file and renamed, as run.ts does: a checkpoint that
     overwrites in place can be interrupted half-written, and this file is the
     only record of what the run has already paid for. */
  const checkpoint = async (): Promise<void> => {
    const final = path.join(runDir, "run.json");
    const temp = `${final}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(runFile, null, 2)}\n`, "utf-8");
    await rename(temp, final);
  };
  await checkpoint();

  console.log("\nRounds");
  console.log("─".repeat(72));
  try {
    for (const task of chosen) {
      /* **Both rounds of a task back to back**, rather than every task's cold
         round and then every task's warm one. A provider cache has a lifetime,
         and putting seven other tasks between the two would be measuring how
         long it lasts rather than what a warm turn costs. */
      for (let round = 1 as 1 | 2; round <= roundCount(task.rounds); round = (round + 1) as 1 | 2) {
        const result = await measure(task, round, { slug: args.slug, article, round });
        runFile.rounds.push(result);
        /* After every round, so a crash keeps everything already paid for. */
        await checkpoint();
        printRound(result);
      }
    }
  } finally {
    await checkpoint();
    summarise(runFile);
    console.log(`\nWrote ${path.relative(process.cwd(), runDir)}/run.json`);
    /* **A run whose numbers cannot all be quoted must not exit 0.** Rounds are
       recorded rather than thrown, deliberately — one task falling over must not
       lose the eleven that worked — but the exit code is the only thing a script
       or a person skimming the tail reads, and "some of these are not what they
       say" is not a success. It is the exit code and not a throw, because the
       results file and the summary above are the product and both are already
       written. */
    const unquotable = runFile.rounds.filter((r) => r.error !== undefined || !r.asLabelled);
    if (unquotable.length > 0) process.exitCode = 1;
  }
}

/**
 * `loadArticle`, with the failure this run actually hits translated.
 *
 * A slug the eval owner does not hold is indistinguishable from a slug that does
 * not exist — deliberately, docs/project/auth.md § *whose data is it* — so the
 * error a reader gets says nothing about which. That is right on the wire and
 * useless here, where the answer is nearly always "it is somebody else's".
 */
async function loadArticleOrExplain(slug: string): Promise<Article> {
  try {
    return await loadArticle(slug);
  } catch (err) {
    throw new Error(
      `Could not read "${slug}" as the eval owner (${EVAL_OWNER_ID}): ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "  Usually that means the article belongs to somebody else — every read here runs as " +
        "the eval owner, and another owner's article is a 404 to it. " +
        "`npm run eval:cost -- --fixture short-html --keep` leaves one behind that this can use.",
      { cause: err },
    );
  }
}

/**
 * **"cache worth 2.5×", or the reason there is no number.**
 *
 * Two rounds' quotient is only a cache saving when both rounds were what they
 * were labelled, both succeeded and both were priced — report.ts § `cacheRatio`
 * holds all of that. And it is meaningless whatever the rounds did when the two
 * turns did *different work*, which is `referee-candidates`: the brief and the
 * names turn are two prices, not one price twice.
 */
function savingLine(task: string, cold: RoundResult, warm: RoundResult): string {
  const plan = TASKS.find((t) => t.name === task)?.rounds;
  if (plan?.kind === "two-different-turns") {
    return "  (two different turns — their ratio is not a cache saving)";
  }
  const verdict = cacheRatio(forRatio(cold), forRatio(warm));
  return verdict.kind === "ratio"
    ? `  cache worth ${verdict.ratio.toFixed(1)}×`
    : `  no ratio — ${verdict.why}`;
}

function forRatio(r: RoundResult): RoundForRatio {
  return {
    expected: r.expected,
    nanos: r.nanos,
    unpriced: r.unpriced,
    failed: r.error !== undefined,
    cache: r.cache,
  };
}

function summarise(runFile: RunFile): void {
  if (runFile.rounds.length === 0) return;
  console.log("\nCold against warm");
  console.log("─".repeat(72));
  for (const task of [...new Set(runFile.rounds.map((r) => r.task))]) {
    const mine = runFile.rounds.filter((r) => r.task === task);
    const cold = mine.find((r) => r.round === 1);
    const warm = mine.find((r) => r.round === 2);
    if (!cold) continue;
    console.log(
      `  ${task.padEnd(18)} cold ${formatNanos(cold.nanos).padStart(9)}` +
        (warm
          ? `   warm ${formatNanos(warm.nanos).padStart(9)}${savingLine(task, cold, warm)}`
          : "   (one round)"),
    );
  }
  const misLabelled = runFile.rounds.filter((r) => !r.asLabelled);
  if (misLabelled.length > 0) {
    console.log(
      `\n${misLabelled.length} round(s) were not the cache state they were labelled with, so no ` +
        "ratio is taken from them and their number is not what it says on the line: " +
        misLabelled
          .map((r) => `${r.task} r${r.round} (${r.expected} → ${describeCache(r.cache)})`)
          .join("; "),
    );
  }
  const failed = runFile.rounds.filter((r) => r.error);
  if (failed.length > 0) {
    console.log(
      `\n${failed.length} round(s) failed and their numbers are what they bought before failing, ` +
        "not what the interaction costs: " +
        failed.map((r) => `${r.task} r${r.round}`).join(", "),
    );
  }
  const unpriced = runFile.rounds.reduce((n, r) => n + r.unpriced, 0);
  if (unpriced > 0) {
    console.log(
      `\n${unpriced} call(s) reported no cost at all. Those are unknown, not zero, and every ` +
        "total above is short by an unknown amount.",
    );
  }
}

if (isMain(import.meta.url)) {
  /* The program's edge, and the same shape as run.ts's: credentials load here
     and nowhere deeper; `withLedger("eval", …)` is the one collector every call
     below records into; and `runAsOwner(EVAL_OWNER_ID, …)` is what decides whose
     article these reads may see — the environment owner's articles are invisible
     to it, which is the isolation and not an inconvenience.

     A refused run is a sentence, not a stack trace: every gate above throws an
     error whose message is the whole point, and a `StoreFailure` from Postgres
     arrives with forty lines of driver frames on top of it. */
  loadEnvLocal();
  await withLedger("eval", () => runAsOwner(EVAL_OWNER_ID, main)).catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
