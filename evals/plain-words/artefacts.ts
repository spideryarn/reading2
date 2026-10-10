/**
 * **The same question as run.ts and answers.ts, for every other prompt that
 * writes words a reader reads**: arc, tweets, ideas, quotes' reasons,
 * Bibliography's why, illustrated, quiz, FAQ, labels, sketch, timeline, quiz-mark,
 * search, Learn, chat's "?" help turn and the referee's claims.
 * docs/plans/260926a-plainer-summaries-and-glossary.md § Stage 3, "Measuring
 * it, per kind". Debate and live are not here; the plan says why.
 *
 * **Link summaries are not here either, and not by choice.** A summary is
 * written from the destination's text in the ownerless preview cache, and
 * `linkSummaryStream` never fetches; on 2026-09-28 none of this article's
 * ~55 links had a cached preview on the box, and filling one is a live fetch
 * plus a database write, which this eval does not do. `plan` does not list
 * them; the check was a one-off.
 *
 * ```
 * npx tsx evals/plain-words/artefacts.ts plan                     # free: the article, the fixed cases
 * npx tsx evals/plain-words/artefacts.ts generate --arm before    # paid: ~24 article-sized calls + 2 small ones
 * npx tsx evals/plain-words/artefacts.ts generate --arm before-2  # the same prompts again: the control
 * npx tsx evals/plain-words/artefacts.ts generate --arm after --only labels,sketch
 * npx tsx evals/plain-words/artefacts.ts report                   # free
 * npx tsx evals/plain-words/artefacts.ts pairs --a before --b after
 * ```
 *
 * **One article** (`SLUG`), and **production's own generators**, called the way
 * the pipeline steps in src/pipeline.ts call them (quiz-mark and search the way
 * src/routes.ts does), with three differences, all named:
 *
 * - **The article comes through the reader's `loadArticle`**, as
 *   evals/reception/run.ts does, not the pipeline's `readArticle` (which needs a
 *   job's store). Blocks and tree are the same rows; `meta` is the reader's,
 *   whose title may be synthesised where the extract had none.
 * - **No reader profile and no `previous`**: every artefact is written fresh,
 *   for the default reader, so an arm cannot inherit an id or a list from the
 *   stored one. Labels get `nullCheckpointStore()` for the same reason — a
 *   stored batch would be the old prompt's answer.
 * - **Illustrated writes its brief and draws nothing**: `draw` is a stub that
 *   refuses, so each plate records a failure and no image is bought. Its Sketch
 *   is the one the `sketch` generator wrote **in the same arm**, which is what a
 *   reader who paints after drawing gets. (With `--only illustrated` and no
 *   sketch in the arm yet, it uses that arm's stored sketch file if there is
 *   one and refuses otherwise.)
 * - **Learn and help are single first turns** (`converse`, no history):
 *   Learn with `kind: "learn"` on a reader's summary written once below,
 *   help with `help: true`, `HELP_QUESTION` and the block as the thread's
 *   anchor, as `helpAboutBlock` in src/web/reader/Reader.tsx starts one. Tools
 *   on, as the route leaves them.
 * - **Referee claims** is `runClaims`, which returns its claims and persists
 *   nothing (the route does that).
 *
 * **Nothing is written to the database but spend**: `generate` runs inside
 * `withLedger`, so each call is an `ai_calls` row and shows in `npm run cost`
 * (before 2026-10-07 no collector was open and the spend went unrecorded; an
 * eval's spend is now refused without one). Each generator's file is written as soon as it lands, and an
 * existing file is never overwritten — a re-run skips it — so one generator
 * failing costs one generator.
 *
 * **Pairing across arms.** Two runs write different lists, so an item is keyed
 * on what is stable:
 *
 * | generator | key |
 * |---|---|
 * | quotes | the quote's own text (the article's words) |
 * | bibliography | the cited work's title, lower-cased |
 * | labels | the block id |
 * | quiz-mark | the fixed case (`MARK_CASES`) |
 * | search | the fixed query and the block the hit is in |
 * | learn, help | the fixed input |
 * | everything else | **position**: the Nth idea of run A against the Nth of run B |
 *
 * A position pair is a comparison of **registers**, not of identical content:
 * the two items may be about different things, and the judge is told so.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import type { Sketch } from "../../src/sketch-scene.js";
import type { QuizEvidence } from "../../src/types.js";
import { prose } from "./answers.js";
import { blindCoin, hardShare, isCommon, wordsIn } from "./run.js";
import { sourceFingerprint } from "./source-fingerprint.js";
import { formerName, storedResult } from "../stored-result.js";

const OUT = path.join(import.meta.dirname, "..", "results", "plain-words", "artefacts");

/** The one article: a consciousness essay, with a bibliography, dates and a long argument. */
const SLUG = "noema-mythology-of-conscious-ai";

const GENERATORS = [
  "arc",
  "tweets",
  "ideas",
  "quotes",
  "bibliography",
  "sketch",
  "illustrated",
  "quiz",
  "faq",
  "labels",
  "timeline",
  "quiz-mark",
  "search",
  "learn",
  "help",
  "referee-claims",
] as const;
type Generator = (typeof GENERATORS)[number];

/** Whether an item is paired across arms by position rather than by content. */
const BY_POSITION: ReadonlySet<Generator> = new Set(["arc", "tweets", "ideas", "sketch", "illustrated", "quiz", "faq", "timeline", "referee-claims"]);

/** The generators whose words should keep the author's own key term. */
const KEY_TERM: ReadonlySet<Generator> = new Set(["labels", "sketch", "timeline"]);

/** The source files whose prompt each generator sends; source-fingerprint.ts adds the shared prompt modules they import. */
export const PROMPT_FILES: Record<Generator, string[]> = {
  arc: ["arc.ts"],
  tweets: ["tweets.ts"],
  ideas: ["ideas.ts"],
  quotes: ["quotes.ts"],
  bibliography: ["bibliography.ts"],
  sketch: ["sketch.ts"],
  illustrated: ["illustrated.ts"],
  quiz: ["quiz.ts"],
  faq: ["faq.ts"],
  labels: ["labels.ts"],
  timeline: ["timeline.ts"],
  "quiz-mark": ["quiz-mark.ts"],
  search: ["search.ts"],
  learn: ["converse.ts"],
  help: ["converse.ts"],
  "referee-claims": ["referee-claims-run.ts"],
};

/** Two readers' Learn summaries — one mostly right, one half wrong — the same in every arm. */
const LEARN_CASES = [
  {
    id: "mostly-right",
    text: "My takeaway: Seth thinks AI probably won't be conscious, because consciousness seems tied to being a living body and not just to running the right software. He also says we're easily fooled because the chatbots talk like us.",
  },
  {
    id: "half-wrong",
    text: "I think the main point is that we should stop calling AI mistakes hallucinations, and that AI will become conscious once it is complex enough, so we need to start giving it rights.",
  },
];

/** Two dense paragraphs a reader presses "?" on, the same in every arm. */
const HELP_BLOCKS = ["spya-npjt4j", "spya-vys3vj"];

/** Three fixed searches, the same in every arm. */
const SEARCHES = [
  "Arguments that AI systems will not become conscious",
  "Where the author says what consciousness depends on",
  "Why people are tempted to believe a chatbot is conscious",
];

/**
 * Three fixed quiz questions, each with a deliberately half-right reader
 * answer, the same in every arm. The questions, reference answers and evidence
 * were copied once from the quiz stored for this article on 2026-09-28 (its
 * `before` prompt), because the quiz generator writes different questions on
 * every run and a mark can only be compared against the same inputs.
 */
interface MarkCase {
  id: string;
  question: string;
  referenceAnswer: string;
  evidence: QuizEvidence[];
  answer: string;
}
const MARK_CASES: MarkCase[] = [
  {
    id: "computational-functionalism",
    question: "What is 'computational functionalism' and why does it matter for the whole essay?",
    referenceAnswer:
      "It's the assumption that implementing the right kind of computation or information processing is sufficient for consciousness to arise. Seth argues this assumption underlies the entire idea of conscious AI, and if it's wrong, real artificial consciousness is off the table for standard digital computers.",
    evidence: [
      {
        quote: "This assumption, which philosophers call computational functionalism, is so deeply ingrained that it can be difficult to recognize it as an assumption at all.",
        start: 238,
        blockId: "spya-wepmnr",
      },
    ],
    /* Half right: the definition, but not why it matters to the argument. */
    answer: "It's the idea that the mind is basically what the brain computes, so the right software could be conscious on any hardware.",
  },
  {
    id: "neural-replacement",
    question: "Why does Seth think the popular 'neural replacement' thought experiment fails to prove consciousness is substrate-independent?",
    referenceAnswer:
      "Because it assumes you could replace biological neurons with silicon equivalents that function identically, but Seth argues this is impossible—some neurons even fire to clear metabolic waste, and replicating this would require inventing a whole silicon-based metabolism. The only way to seamlessly replace a neuron is with another biological one.",
    evidence: [
      {
        quote: "the argument fails at its first hurdle, given the impossibility of replacing any part of the brain with a perfect silicon equivalent.",
        start: 697,
        blockId: "spya-ahtr6e",
      },
      {
        quote:
          "Coming up with a perfect silicon replacement for these neurons would require inventing a whole new silicon-based metabolism, too, which just isn’t the kind of thing silicon is suitable for.",
        start: 175,
        blockId: "spya-un9fjn",
      },
    ],
    /* Half right: the conclusion, with the wrong reason. */
    answer: "Because nobody could ever tell whether the person still felt the same after their neurons were swapped — you'd have to take their word for it.",
  },
  {
    id: "simulation-instantiation",
    question: "What does Seth mean when he says 'simulation is not instantiation'?",
    referenceAnswer:
      "He means that a computational model of something isn't the thing itself—just as a simulated rainstorm doesn't make anything wet, a simulation of the brain won't produce actual consciousness unless consciousness itself is fundamentally computational. Assuming otherwise already presupposes computational functionalism is true.",
    evidence: [
      {
        quote: "a computational simulation of X does not bring X into being — does not instantiate X — unless X is a computational process (specifically, an algorithm) itself.",
        start: 324,
        blockId: "spya-npjt4j",
      },
    ],
    /* Half right: the rainstorm point, missing the "unless it is itself a computation" qualifier. */
    answer: "A simulation of a storm doesn't make anything wet, so a simulated brain can never be conscious.",
  },
];

interface Item {
  key: string;
  field: string;
  text: string;
  /** The article's own words the item is about, when there is one: the paragraph a label names, a quote, a hit. */
  context?: string;
}

interface ArmFile {
  arm: string;
  generator: Generator;
  slug: string;
  sourceSha256: Record<string, string>;
  blocksSha256: string;
  at: string;
  /** Which Sketch illustrated painted — absent on every other generator. */
  sketchFrom?: string;
  /**
   * What the generator's own run says it used, where it says (the Anthropic-SDK
   * stages do; quiz-mark, search, Learn, help and the referee do not). Runs
   * from before 2026-10-07 reached no spend ledger (see the header), so for
   * them this is the only record of what an arm cost. Absent on the first
   * `before` files, which predate it.
   */
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  items: Item[];
}

/** The token counts off a generator's run. */
function usageOf(run: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }): Pick<ArmFile, "usage"> {
  return {
    usage: {
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      cacheReadTokens: run.cacheReadTokens ?? 0,
      cacheWriteTokens: run.cacheWriteTokens ?? 0,
    },
  };
}

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function loadTheArticle() {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const owner = environmentOwnerId();
  const found = await runAsOwner(owner, () => loadArticle(SLUG));
  return { owner, runAsOwner, found, article: { slug: SLUG, blocks: found.blocks, tree: found.tree, meta: found.meta } };
}

/* ------------------------------------------------------------------ plan ---- */

/** Free: what a run would read, and the stored quiz the fixed mark cases come from. */
async function plan(): Promise<void> {
  const { owner, runAsOwner, found, article } = await loadTheArticle();
  const { planBatches } = await import("../../src/labels.js");
  const words = article.blocks.reduce((n, b) => n + wordsIn(b.text).length, 0);
  console.log(`${SLUG}: ${article.blocks.length} blocks, ${words} words, title "${found.meta.title}"`);
  console.log(`labels: ${planBatches(article.tree, article.blocks).length} batches`);
  console.log(`fixed quiz-mark cases: ${MARK_CASES.length}; fixed searches: ${SEARCHES.length}`);
  const { loadQuiz, loadSketch } = await import("../../src/store/index.js");
  await runAsOwner(owner, async () => {
    try {
      const s = await loadSketch(SLUG);
      console.log(`stored sketch: ${(s.sketch as Sketch).scenes.length} scenes${s.stale ? " (stale)" : ""}`);
    } catch (err) {
      console.log(`stored sketch: none (${(err as Error).message})`);
    }
    try {
      const q = await loadQuiz(SLUG);
      console.log(`stored quiz: ${q.quiz.questions.length} questions${q.stale ? " (stale)" : ""}`);
      for (const [i, x] of q.quiz.questions.entries()) {
        console.log(`\n[${i}] ${x.premise ? `(${x.premise}) ` : ""}${x.question}\n    ref: ${x.referenceAnswer}\n    evidence: ${JSON.stringify(x.evidence)}`);
      }
    } catch (err) {
      console.log(`stored quiz: none (${(err as Error).message})`);
    }
  });
}

/* -------------------------------------------------------------- generate ---- */

async function generate(arm: string, only: Set<Generator> | null): Promise<void> {
  if (MARK_CASES.length !== 3) throw new Error(`MARK_CASES has ${MARK_CASES.length} cases; write three before a paid run`);
  /* Before the generators are imported and run, not in `write()` after them: a
     file edited during a long call would otherwise be recorded as what was sent. */
  const sourceSha256 = Object.fromEntries(GENERATORS.map((g) => [g, sourceFingerprint(PROMPT_FILES[g])])) as Record<
    Generator,
    Record<string, string>
  >;
  const { owner, runAsOwner, article } = await loadTheArticle();
  const { nullCheckpointStore } = await import("../../src/store/checkpoints.js");
  const { generateArc } = await import("../../src/arc.js");
  const { generateTweets } = await import("../../src/tweets.js");
  const { generateIdeas } = await import("../../src/ideas.js");
  const { generateQuotes } = await import("../../src/quotes.js");
  const { generateBibliography } = await import("../../src/bibliography.js");
  const { generateSketch } = await import("../../src/sketch.js");
  const { generateIllustrated } = await import("../../src/illustrated.js");
  const { generateQuiz } = await import("../../src/quiz.js");
  const { generateFaq } = await import("../../src/faq.js");
  const { generateLabels } = await import("../../src/labels.js");
  const { generateTimeline } = await import("../../src/timeline.js");
  const { markAnswer } = await import("../../src/quiz-mark.js");
  const { findPassages } = await import("../../src/search.js");
  const { converse } = await import("../../src/converse.js");
  const { runClaims } = await import("../../src/referee-claims-run.js");
  const { HELP_QUESTION } = await import("../../src/web/chat-handoff.js");

  /** One first turn of `converse`, to its `done`. */
  async function turn(req: Omit<Parameters<typeof converse>[0], "meta" | "blocks" | "history" | "slug">): Promise<string> {
    for await (const e of converse({ meta: article.meta, blocks: article.blocks, history: [], slug: SLUG, ...req })) {
      if (e.type === "done") return e.text;
    }
    throw new Error("converse ended without a done event");
  }

  const blocksSha256 = sha256(JSON.stringify(article.blocks.map((b) => [b.id, b.text])));
  const blockText = new Map(article.blocks.map((b) => [b.id as string, b.text]));
  const dir = path.join(OUT, arm);
  fs.mkdirSync(dir, { recursive: true });
  const fileOf = (g: Generator) => path.join(dir, `${g}.json`);
  const fullSketch = path.join(dir, "sketch.full.json");
  const wanted = (g: Generator) => (only ? only.has(g) : true) && !fs.existsSync(fileOf(g));

  function write(g: Generator, items: Item[], extra: Partial<ArmFile> = {}): void {
    if (items.length === 0) throw new Error(`${g}: the generator returned nothing to read`);
    const out = fileOf(g);
    if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), out)}`);
    const file: ArmFile = { arm, generator: g, slug: SLUG, sourceSha256: sourceSha256[g], blocksSha256, at: new Date().toISOString(), ...extra, items };
    fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`${arm}: wrote ${path.relative(process.cwd(), out)} (${items.length} items)`);
  }

  const pos = (i: number) => `#${String(i + 1).padStart(2, "0")}`;
  const jobs: Record<Exclude<Generator, "illustrated">, () => Promise<void>> = {
    arc: async () => {
      const run = await generateArc({ power: "standard", article });
      write("arc", run.arc.entries.map((e, i) => ({ key: pos(i), field: "text", text: e.text })), usageOf(run));
    },
    tweets: async () => {
      const run = await generateTweets({ power: "standard", article, profile: null });
      write("tweets", run.thread.tweets.map((t, i) => ({ key: pos(i), field: "text", text: t.text })), usageOf(run));
    },
    ideas: async () => {
      const run = await generateIdeas({ power: "standard", article, previous: null, profile: null });
      write(
        "ideas",
        run.ideas.ideas.flatMap((idea, i) =>
          (["name", "statement", "whyYouNeedIt", "analogy"] as const).flatMap((field) => {
            const text = idea[field];
            return text ? [{ key: pos(i), field, text }] : [];
          }),
        ),
        usageOf(run),
      );
    },
    quotes: async () => {
      const run = await generateQuotes({ power: "standard", article, previous: null, profile: null });
      write(
        "quotes",
        run.quotes.quotes.flatMap((q) => (q.reason ? [{ key: norm(q.text), field: "reason", text: q.reason, context: q.text }] : [])),
        usageOf(run),
      );
    },
    bibliography: async () => {
      const run = await generateBibliography({ power: "standard", article, previous: null, referenceList: null });
      write("bibliography", run.bibliography.citations.map((c) => ({ key: norm(c.title), field: "why", text: c.why, context: c.title })), usageOf(run));
    },
    sketch: async () => {
      const run = await generateSketch({ power: "standard", article, profile: null });
      /* The whole Sketch first, beside its items, so a later `--only illustrated` paints the same one. */
      fs.writeFileSync(fullSketch, `${JSON.stringify(run.sketch, null, 2)}\n`);
      write("sketch", sketchItems(run.sketch, blockText), usageOf(run));
      sketchThisRun = run.sketch;
    },
    quiz: async () => {
      const run = await generateQuiz({ power: "standard", article });
      write(
        "quiz",
        run.quiz.questions.flatMap((q, i) => [
          { key: pos(i), field: "question", text: q.question },
          { key: pos(i), field: "referenceAnswer", text: q.referenceAnswer },
        ]),
        usageOf(run),
      );
    },
    faq: async () => {
      const run = await generateFaq({ power: "standard", article });
      /* The FAQ writes questions only; its answers are the article's own passages. */
      write("faq", run.faq.questions.map((q, i) => ({ key: pos(i), field: "question", text: q.question })), usageOf(run));
    },
    labels: async () => {
      const run = await generateLabels({ power: "standard", tree: article.tree, blocks: article.blocks, slug: SLUG, checkpoints: nullCheckpointStore() });
      const order = article.blocks.map((b) => b.id as string).filter((id) => run.labels[id] !== undefined);
      write("labels", order.map((id) => ({ key: id, field: "label", text: run.labels[id] as string, context: clip(blockText.get(id) ?? "") })), usageOf(run));
    },
    timeline: async () => {
      const run = await generateTimeline({ power: "standard", article, previous: null });
      write(
        "timeline",
        run.timeline.events.map((e, i) => ({ key: pos(i), field: "label", text: e.label, ...(e.occurrences[0] ? { context: e.occurrences[0].quote } : {}) })),
        usageOf(run),
      );
    },
    "quiz-mark": async () => {
      const items: Item[] = [];
      for (const c of MARK_CASES) {
        const r = await markAnswer({ power: "standard",
          meta: article.meta,
          blocks: article.blocks,
          question: c.question,
          referenceAnswer: c.referenceAnswer,
          evidence: c.evidence,
          answer: c.answer,
        });
        items.push({ key: c.id, field: "reply", text: r.reply, context: `Q: ${c.question}\nReader's answer: ${c.answer}` });
      }
      write("quiz-mark", items);
    },
    search: async () => {
      const items: Item[] = [];
      for (const criterion of SEARCHES) {
        const r = await findPassages({ power: "standard", meta: article.meta, blocks: article.blocks, criterion });
        const seen = new Map<string, number>();
        for (const h of r.hits) {
          /* Two hits in one block get #2, so a key still names one item. */
          const n = (seen.get(h.blockId) ?? 0) + 1;
          seen.set(h.blockId, n);
          items.push({ key: `${criterion} | ${h.blockId}${n > 1 ? ` #${n}` : ""}`, field: "reasoning", text: h.reasoning, context: h.quote });
        }
      }
      write("search", items);
    },
    learn: async () => {
      const items: Item[] = [];
      for (const c of LEARN_CASES) {
        items.push({ key: c.id, field: "reply", text: await turn({ power: "standard", question: c.text, kind: "learn" }), context: `Reader's summary: ${c.text}` });
      }
      write("learn", items);
    },
    help: async () => {
      const items: Item[] = [];
      for (const blockId of HELP_BLOCKS) {
        if (!blockText.has(blockId)) throw new Error(`${blockId} is not in the article`);
        items.push({
          key: blockId,
          field: "reply",
          text: await turn({ power: "standard", question: HELP_QUESTION, at: blockId, kind: "chat", anchor: { blockId }, help: true }),
          context: clip(blockText.get(blockId) ?? "", 1200),
        });
      }
      write("help", items);
    },
    "referee-claims": async () => {
      const out = await runClaims({ power: "standard", meta: article.meta, blocks: article.blocks });
      write(
        "referee-claims",
        out.claims.flatMap((c, i) => [
          { key: pos(i), field: "claim", text: c.claim },
          ...c.passages.map((p, j) => ({ key: `${pos(i)} passage ${j + 1}`, field: "reasoning", text: p.reasoning })),
        ]),
      );
    },
  };

  let sketchThisRun: Sketch | null = null;
  const failures: string[] = [];
  await runAsOwner(owner, async () => {
    const run = async (g: Generator, job: () => Promise<void>) => {
      try {
        await job();
      } catch (err) {
        failures.push(`${g}: ${err instanceof Error ? err.message : String(err)}`);
        console.error(`${arm}: ${g} FAILED — ${err instanceof Error ? err.stack : String(err)}`);
      }
    };
    const skipped = GENERATORS.filter((g) => !wanted(g) && (!only || only.has(g)));
    for (const g of skipped) console.log(`${arm}: ${g} already written — skipped`);
    await Promise.all(
      (Object.keys(jobs) as (keyof typeof jobs)[]).filter(wanted).map((g) => run(g, jobs[g])),
    );
    if (wanted("illustrated")) {
      await run("illustrated", async () => {
        let sketch = sketchThisRun;
        let from = "this run";
        if (!sketch) {
          const raw = fs.existsSync(fullSketch) ? fs.readFileSync(fullSketch, "utf-8") : null;
          if (!raw) throw new Error("no sketch in this arm to illustrate — run sketch first");
          sketch = JSON.parse(raw) as Sketch;
          from = "this arm's earlier sketch run";
        }
        const run = await generateIllustrated({ power: "standard",
          article,
          sketch,
          profile: null,
          draw: async () => {
            throw new Error("eval: the brief only, no picture is bought");
          },
        });
        write(
          "illustrated",
          run.illustrated.plates.flatMap((p, i) => [
            { key: `plate ${i + 1}`, field: "title", text: p.title },
            ...p.vignettes.flatMap((v, j) => [
              { key: `plate ${i + 1} vignette ${j + 1}`, field: "depicts", text: v.depicts, context: v.quote },
              ...(v.title ? [{ key: `plate ${i + 1} vignette ${j + 1}`, field: "title", text: v.title }] : []),
            ]),
          ]),
          { sketchFrom: from, ...usageOf(run) },
        );
      });
    }
  });
  if (failures.length > 0) {
    console.error(`\n${arm}: ${failures.length} generator(s) failed — re-run to retry just those:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
}

/** Every string in a Sketch a reader reads, keyed by where it sits. */
function sketchItems(
  sketch: Sketch,
  blockText: Map<string, string>,
): Item[] {
  const items: Item[] = [
    { key: "sketch", field: "title", text: sketch.title },
    { key: "sketch", field: "caption", text: sketch.caption },
  ];
  for (const [i, scene] of sketch.scenes.entries()) {
    const at = `scene ${i + 1}`;
    items.push({ key: at, field: "title", text: scene.title });
    if (scene.caption) items.push({ key: at, field: "caption", text: scene.caption });
    const n: Record<string, number> = {};
    for (const item of scene.items) {
      n[item.kind] = (n[item.kind] ?? 0) + 1;
      const key = `${at} ${item.kind} ${n[item.kind]}`;
      const block = item.kind === "node" && item.block ? blockText.get(item.block) : undefined;
      const context = block ? { context: clip(block) } : {};
      const fields: [string, string | undefined][] =
        item.kind === "node"
          ? [["text", item.text], ["sub", item.sub], ["detail", item.detail]]
          : item.kind === "region" || item.kind === "edge"
            ? [["label", item.label]]
            : item.kind === "label"
              ? [["text", item.text]]
              : [];
      for (const [field, text] of fields) {
        if (typeof text === "string" && text.trim() !== "") items.push({ key, field, text, ...context });
      }
    }
  }
  return items.filter((x) => x.text && x.text.trim() !== "");
}

/* ------------------------------------------------------------ report/pairs ---- */

/** Every generator of one arm, refusing an arm with a generator missing, empty, or for another article. */
/**
 * Every generator of one arm. A generator missing from the arm is **named, not
 * forgiven**: `report` prints it and `pairs` refuses unless it is missing from
 * both arms — one that production itself could not run on this article (the
 * referee's claims overflowed twice on 2026-09-28) must not stop the other
 * sixteen being read, and must not quietly vanish from one side either.
 */
export function readArm(arm: string): { files: Map<Generator, ArmFile>; missing: Generator[] } {
  const files = new Map<Generator, ArmFile>();
  const missing: Generator[] = [];
  for (const g of GENERATORS) {
    /* An arm saved before 2026-10-06 has `remember.json`, which calls itself
       `remember` inside: the generator now called `learn`. Read as that. */
    const f = storedResult(path.join(OUT, arm, `${g}.json`));
    if (!fs.existsSync(f)) {
      missing.push(g);
      continue;
    }
    const read = JSON.parse(fs.readFileSync(f, "utf-8")) as Omit<ArmFile, "generator"> & { generator: string };
    const named = read.generator === g || read.generator === formerName(g);
    if (!named || read.slug !== SLUG || read.arm !== arm) throw new Error(`${f}: says it is ${read.arm}/${read.generator}/${read.slug}`);
    if (read.items.length === 0) throw new Error(`${f}: no items`);
    files.set(g, { ...read, generator: g });
  }
  if (files.size === 0) throw new Error(`arm ${arm} has no generators`);
  const shas = new Set([...files.values()].map((f) => f.blocksSha256));
  if (shas.size !== 1) throw new Error(`arm ${arm}: the article changed between generators`);
  return { files, missing };
}

function report(): void {
  if (!fs.existsSync(OUT)) throw new Error(`nothing at ${path.relative(process.cwd(), OUT)} yet`);
  for (const arm of fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()).sort()) {
    const { files, missing } = readArm(arm);
    console.log(`\n== ${arm}${missing.length > 0 ? `   (MISSING: ${missing.join(", ")})` : ""}`);
    console.log("generator      items  words/item  hard-share  hard types/100w   top hard words");
    let allWords = 0;
    let allHard = 0;
    for (const [g, file] of files) {
      const texts = file.items.map((x) => prose(x.text));
      const h = hardShare(texts);
      /* Types per item, summed, over words: a word repeated inside one item counts once, as answers.ts. */
      let types = 0;
      for (const t of texts) types += new Set(wordsIn(t).map((w) => w.toLowerCase()).filter((w) => !isCommon(w))).size;
      allWords += h.words;
      allHard += h.hard;
      console.log(
        `${g.padEnd(13)} ${String(file.items.length).padStart(6)}  ${(h.words / file.items.length).toFixed(1).padStart(10)}  ${`${(h.share * 100).toFixed(1)}%`.padStart(10)}  ${((types / Math.max(h.words, 1)) * 100).toFixed(2).padStart(15)}   ${h.top.slice(0, 8).join(" ")}`,
      );
    }
    console.log(`${"all".padEnd(13)} ${"".padStart(6)}  ${"".padStart(10)}  ${`${((allHard / Math.max(allWords, 1)) * 100).toFixed(1)}%`.padStart(10)}`);
  }
}

/** At most this many pairs per generator, spread evenly, so labels' hundred-odd rows do not drown the rest. */
const MAX_PAIRS_PER_GENERATOR = 30;

function spread<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)] as T);
}

/** A blind side-by-side per generator, matched by generator, field and key; sides shuffled by `blindCoin`. */
/** `skip` names generators to leave out of both arms, said on the command line so the omission is visible. */
function pairs(a: string, b: string, skip: string[] = []): void {
  const pairsFile = path.join(OUT, `pairs-${a}-vs-${b}.md`);
  const keyFile = path.join(OUT, `pairs-${a}-vs-${b}.key.tsv`);
  if (fs.existsSync(pairsFile) || fs.existsSync(keyFile)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), pairsFile)}`);
  const { files: A, missing: missingA0 } = readArm(a);
  const { files: B, missing: missingB0 } = readArm(b);
  const missingA = [...new Set([...missingA0, ...skip])];
  const missingB = [...new Set([...missingB0, ...skip])];
  if (skip.length) console.log(`skipped on the command line: ${skip.join(", ")}`);
  const lopsided = GENERATORS.filter((g) => missingA.includes(g) !== missingB.includes(g));
  if (lopsided.length > 0) throw new Error(`in one arm and not the other: ${lopsided.join(", ")} — generate it (--only) before pairing`);
  const both = GENERATORS.filter((g) => !missingA.includes(g));
  if (missingA.length > 0) console.log(`not in either arm, so not paired: ${missingA.join(", ")}`);
  const coin = blindCoin();
  const out = [
    "# Blind pairs: two versions of the same kind of text",
    "",
    "A reading assistant writes many small texts about an article: a one-line arc per section, a thread, the ideas the piece assumes, why a quote is worth keeping, why a cited work matters, a diagram's labels, picture descriptions, quiz questions and the marking of an answer, FAQ questions, a label per paragraph, timeline events, why a search hit matches, a reply to a reader's summary of what they remember, a plain explanation of a paragraph the reader asked for help with, and a referee's list of the paper's claims.",
    "Each pair below is two versions, X and Y, of one such text for the same article (Anil Seth's Noema essay on the mythology of conscious AI).",
    "",
    "Judge each pair: **which would a curious reader from OUTSIDE the field understand more easily, and did either lose, bend or blur what the other gets right?**",
    "",
    "- Where a section says *paired by position*, X and Y are the Nth item of two separate runs and may be about different things. Judge the register — how plainly each is written — not which topic it picked.",
    "- Where a section says *key term*, also say: **does either drop the author's own key term (the word or phrase the article itself uses for this) that the other keeps?** Name the term.",
    "- Where an *Article's words* line is given, it is the passage the text is about, for checking fidelity.",
    "",
  ];
  const key: string[] = [];
  let n = 0;
  for (const g of both) {
    const fa = A.get(g) as ArmFile;
    const fb = B.get(g) as ArmFile;
    if (fa.blocksSha256 !== fb.blocksSha256) throw new Error(`${g}: the article changed between ${a} and ${b}`);
    const idOf = (x: Item) => `${x.field}\u0000${x.key}`;
    const byB = new Map(fb.items.map((x) => [idOf(x), x]));
    const matched = fa.items.filter((x) => byB.has(idOf(x)));
    const chosen = spread(matched, MAX_PAIRS_PER_GENERATOR);
    const onlyA = fa.items.length - matched.length;
    const onlyB = fb.items.length - matched.length;
    out.push(
      `# ${g}`,
      "",
      `${BY_POSITION.has(g) ? "*Paired by position.* " : ""}${KEY_TERM.has(g) ? "*Key term.* " : ""}${chosen.length} of ${matched.length} matched pairs shown; ${onlyA + onlyB} items had no partner.`,
      "",
    );
    for (const x of chosen) {
      const y = byB.get(idOf(x)) as Item;
      n++;
      const flip = coin();
      const [X, Y] = flip ? [y, x] : [x, y];
      out.push(`## ${n}. ${g} — ${x.field} (${x.key})`, "");
      /* Content-keyed items share their article words; position-keyed ones may not, so each side shows its own. */
      if (!BY_POSITION.has(g) && x.context) out.push(`Article's words: ${x.context}`, "");
      out.push("### X", "", X.text, "");
      if (BY_POSITION.has(g) && X.context) out.push(`(Article's words: ${X.context})`, "");
      out.push("### Y", "", Y.text, "");
      if (BY_POSITION.has(g) && Y.context) out.push(`(Article's words: ${Y.context})`, "");
      key.push(`${n}\t${g}\t${x.field}\tX=${flip ? b : a}\tY=${flip ? a : b}`);
    }
    console.log(`${g}: ${chosen.length} pairs (${matched.length} matched, ${onlyA} only in ${a}, ${onlyB} only in ${b})`);
  }
  fs.writeFileSync(pairsFile, `${out.join("\n")}\n`);
  fs.writeFileSync(keyFile, `${key.join("\n")}\n`);
  console.log(`${n} pairs → ${path.relative(process.cwd(), pairsFile)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  if (cmd === "plan") {
    await plan();
  } else if (cmd === "generate") {
    const arm = flag("--arm");
    if (!arm || !/^(before|after)(-\d+)?$/.test(arm)) throw new Error("generate needs --arm before|after[-N]");
    const onlyFlag = flag("--only");
    let only: Set<Generator> | null = null;
    if (onlyFlag) {
      const names = onlyFlag.split(",");
      const bad = names.filter((x) => !(GENERATORS as readonly string[]).includes(x));
      if (bad.length > 0) throw new Error(`--only: no generator called ${bad.join(", ")}`);
      only = new Set(names as Generator[]);
    }
    loadEnvLocal();
    const { withLedger } = await import("../../src/cli-ledger.js");
    /* The ledger is open around the paid command only: an eval's spend is refused without one (src/ai-spend.ts § UnrecordedSpendRefused). */
    await withLedger("eval", () => generate(arm, only));
  } else if (cmd === "report") {
    report();
  } else if (cmd === "pairs") {
    const a = flag("--a");
    const b = flag("--b");
    if (!a || !b) throw new Error("pairs needs --a <arm> --b <arm> [--skip g,g]");
    pairs(a, b, (flag("--skip") ?? "").split(",").filter(Boolean));
  } else {
    throw new Error("usage: artefacts.ts plan | generate --arm <arm> [--only g,g] | report | pairs --a <arm> --b <arm>");
  }
}
