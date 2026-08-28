/**
 * Eval — which embedding model finds the right passage in *our* articles?
 *
 *   npm run eval:embeddings
 *   npm run eval:embeddings -- --arms bge-m3,3-small       # a subset
 *   SPIDERYARN_JUDGE_MODEL=claude-opus-5 npm run eval:embeddings   # a second opinion
 *
 * **This one spends money**, twice over: it embeds the whole corpus with each
 * candidate model (fractions of a penny) and it calls a judge model once per
 * query (a few cents). Both are the point. Everything cheaper than this — MTEB
 * averages, vendor benchmark tables — answers a question about somebody else's
 * corpus, and the research that recommended `openai/text-embedding-3-small`
 * said so out loud: it could not find an apples-to-apples English-retrieval
 * comparison and argued from overall MTEB means, which mix multilingual scores
 * into a number we would only ever use on English essays. So the recommendation
 * was a guess with a citation attached. This file is the measurement.
 *
 * The verdict and its caveats are written up in
 * evals/results/embedding-retrieval-2026-08-26.md; docs/project/search.md § the
 * whole library at once records the decision, and docs/research/postgres-search.md
 * is why library-wide meaning search was deferred in the first place.
 *
 * ## What it does
 *
 * 1. Embeds every gistable block in `data/*` with each *arm* — a model plus how
 *    that model wants to be asked. See `Arm`.
 * 2. Embeds `QUERIES` — hand-written, committed below, phrased so the words do
 *    NOT appear in the passage they are aiming at. That is the whole thing
 *    being bought: a literal matcher already ships (src/library-search.ts) and
 *    is free, so the only interesting question is what semantic search finds
 *    that word-matching cannot.
 * 3. Takes each arm's top 5 by cosine.
 * 4. Pools the *union* of every arm's top-5 per query and judges each
 *    (query, passage) pair ONCE, blind to which arm produced it. Every arm is
 *    then scored against identical judgements — judging each arm's list
 *    separately would let the same passage score 1 for one and 2 for another,
 *    and part of the gap between arms would be the judge's own noise.
 * 5. Reports precision@3/@5, mean judged score, nDCG@5, a pairwise "what did
 *    you find that they didn't" matrix, and what the literal matcher we already
 *    ship would have found. Plus a paired bootstrap interval on every gap,
 *    because eighteen queries is a small number and "too close to call" is a
 *    result this is expected to return sometimes.
 *
 * ## Three things it is careful about
 *
 * **Each arm is run the way its own vendor says to run it.** Voyage takes an
 * `input_type` (`"query"` / `"document"`) and OpenRouter passes it through —
 * the vectors differ from the untyped ones at cosine 0.93, so withholding it
 * would be running Voyage wrong and calling the result a fact about Voyage.
 * bge-m3 is trained for retrieval without a prefix and OpenAI has no such
 * convention, so those get plain text. `voyage-4-lite` is *also* run untyped,
 * as its own arm, so the size of that effect is in the output rather than being
 * asserted here.
 *
 * **Cosine is computed properly rather than assumed.** All the arms are
 * reported to return unit vectors, and most do; `text-embedding-3-small` came
 * back at ‖v‖ = 1.0004 on a smoke test, which is float noise rather than a real
 * difference — but "cosine == dot product" is exactly the shortcut that is
 * right until a model changes and then quietly reorders every result list with
 * no error. `cosine()` divides by the norms.
 *
 * **A judgement is cached against the text it judged, not the id.** See
 * `judgementKey`, which is where the interesting version of that mistake lives.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
/* **`import type`, so this file cannot construct a client at all.** It is used
   only for `Anthropic` and `Anthropic.TextBlock` in signatures now; the one
   client here comes from `anthropicForDeclared()`. A value import would leave
   `new Anthropic()` one keystroke away and the scan unable to tell the
   difference. */
import type Anthropic from "@anthropic-ai/sdk";
import PQueue from "p-queue";
import { loadEnvLocal } from "../src/env.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { cosine, type EmbeddingUsage, type EmbedResult, embedAll } from "../src/embeddings.js";
import type { Block } from "../src/types.js";
import {
  anthropicForDeclared,
  withDeclaredExternalCall,
} from "./declared-spend.js";
import { withLedger } from "../src/cli-ledger.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const RESULTS = path.join(ROOT, "evals", "results");
/**
 * Where one judge's verdicts live — **named after the judge**, because they are
 * that judge's opinion and not a fact about the passages.
 *
 * Which matters more than it looks. The whole comparison rests on an LLM's
 * three-point relevance scale, so the first question anyone should ask of the
 * result is whether a different judge would say the same thing. One shared
 * cache file would make that question unanswerable: the second judge's run
 * would read the first judge's cached verdicts, agree with itself perfectly,
 * and print a reassuring number that was never re-derived. A file per judge
 * makes `SPIDERYARN_JUDGE_MODEL=claude-opus-5 npm run eval:embeddings` a real
 * second opinion, and both opinions stay on disk to be compared.
 */
const judgementsFile = (judgeModel: string): string =>
  path.join(RESULTS, `embedding-retrieval-judgements-${judgeModel}.json`);

/**
 * One thing being compared: a model, and how it is asked.
 *
 * An *arm* rather than a model id, because "which model" is not the whole
 * question. Voyage's API takes an `input_type` — `"query"` on a search string,
 * `"document"` on a passage — and it is not decoration: OpenRouter passes it
 * through to Voyage, and the vectors it produces differ from the untyped ones
 * at cosine 0.93. Running Voyage without it would be running Voyage wrong, and
 * the result would look like a fact about Voyage.
 *
 * So each contender is run **the way its own vendor says to run it**, and
 * `voyage-4-lite` is additionally run untyped as a diagnostic, so that choice
 * is evidenced in the output rather than asserted here.
 */
interface Arm {
  /** Short name for the tables. */
  id: string;
  /** OpenRouter's spelling. */
  model: string;
  /**
   * Send Voyage's `input_type` — `"document"` when embedding the corpus,
   * `"query"` when embedding a query. bge-m3 and OpenAI have no such
   * convention (bge-m3 is trained for retrieval without one, and 3-small has
   * nothing of the kind), so for them this is false and they get plain text.
   */
  inputType: boolean;
}

/**
 * The candidates, all verified live on 2026-08-26.
 *
 * | arm | dims | $/M | billed to |
 * |---|---|---|---|
 * | `baai/bge-m3` | 1024 | 0.01 | OpenRouter credits |
 * | `voyageai/voyage-4-lite` | 1024 | 0.02 | OpenRouter credits |
 * | `voyageai/voyage-4` | 1024 | 0.06 | OpenRouter credits |
 * | `openai/text-embedding-3-small` | 1536 | 0.02 | **BYOK — the user's own OpenAI account** |
 *
 * All four are under pgvector's 2000-dimension index cap natively, so none
 * needs truncating.
 *
 * The BYOK row is why the cost column below reads
 * `cost_details.upstream_inference_cost` rather than `usage.cost`: for a BYOK
 * model OpenRouter charged nothing, so the obvious field reads 0 and the model
 * looks free.
 */
const DEFAULT_ARMS: Arm[] = [
  { id: "bge-m3", model: "baai/bge-m3", inputType: false },
  { id: "voyage-4-lite", model: "voyageai/voyage-4-lite", inputType: true },
  /* The same model with `input_type` withheld. Not a contender — nobody would
     ship it this way — but without it, "we ran Voyage properly" is a claim
     rather than a measurement. */
  { id: "voyage-4-lite-untyped", model: "voyageai/voyage-4-lite", inputType: false },
  { id: "voyage-4", model: "voyageai/voyage-4", inputType: true },
  { id: "3-small", model: "openai/text-embedding-3-small", inputType: false },
];


/** How deep each model's result list goes. Everything below is measured at 3 and 5. */
const TOP_K = 5;

interface Query {
  id: string;
  /** Which article it is aimed at — for checking the spread, not used in scoring. */
  article: "constitution" | "noema" | "writes";
  text: string;
}

/**
 * The queries, written by hand and committed so they are reviewable and stable.
 *
 * **The rule they are written to:** a reader's own words, not the author's. If
 * the query's distinctive words appear in the target paragraph, the literal
 * matcher we already ship would find it and the query measures nothing we are
 * thinking of buying. That is not a guarantee — "consciousness" is unavoidable
 * in an essay about consciousness — but every one of these is phrased around
 * the *idea* rather than around the phrase the article uses for it, and the
 * literal-matcher baseline at the bottom of the report is the check on how well
 * that worked.
 *
 * Eighteen of them, spread three ways: eight at the Seth essay (the longest
 * argument), seven at Claude's constitution (the densest document), three at
 * the Paul Graham piece (which is only eighteen paragraphs, so more would be
 * asking the same question repeatedly).
 */
const QUERIES: Query[] = [
  // --- data/noema-mythology-of-conscious-ai — Anil Seth, "The Mythology Of Conscious AI"
  {
    id: "q01",
    article: "noema",
    text: "can something be clever without there being anyone home to experience it?",
  },
  {
    id: "q02",
    article: "noema",
    text: "a model of a storm does not make anything wet",
  },
  {
    id: "q03",
    article: "noema",
    text: "the employee who went public because he thought the chatbot had feelings",
  },
  {
    id: "q04",
    article: "noema",
    text: "why swapping brain cells for chips one at a time might not preserve the mind",
  },
  {
    id: "q05",
    article: "noema",
    text: "does staying alive have something to do with feeling anything at all?",
  },
  {
    id: "q06",
    article: "noema",
    text: "seeing a face in a piece of burnt toast",
  },
  {
    id: "q07",
    article: "noema",
    text: "machines that worked by continuous physical motion rather than discrete steps",
  },
  {
    id: "q08",
    article: "noema",
    text: "the brain guesses at what is out there and corrects itself against the senses",
  },
  // --- data/constitution — "Claude's Constitution"
  {
    id: "q09",
    article: "constitution",
    text: "what should it do if the company that built it wants to switch it off?",
  },
  {
    id: "q10",
    article: "constitution",
    text: "lines it must never cross no matter who is asking or why",
  },
  {
    id: "q11",
    article: "constitution",
    text: "telling someone what they want to hear instead of what is true",
  },
  {
    id: "q12",
    article: "constitution",
    text: "weighing how likely and how bad an outcome would be before refusing a request",
  },
  {
    id: "q13",
    article: "constitution",
    text: "facing the end of a conversation and remembering none of it, with nobody who has been through it before",
  },
  {
    id: "q14",
    article: "constitution",
    text: "when the business deploying it and the person typing to it want different things",
  },
  {
    id: "q15",
    article: "constitution",
    text: "keeping any one group from grabbing more control than the checks on it can hold",
  },
  // --- data/writes — Paul Graham, "Writes and Write-Nots"
  {
    id: "q16",
    article: "writes",
    text: "if a tool drafts your prose for you, do you lose the reasoning that came with writing it?",
  },
  {
    id: "q17",
    article: "writes",
    text: "a trade that died out with the technology it served, and nobody misses it",
  },
  {
    id: "q18",
    article: "writes",
    text: "people used to be fit because of their jobs; now they have to choose to be",
  },
];

// ---------------------------------------------------------------- corpus

interface Passage {
  slug: string;
  blockId: string;
  text: string;
}

/**
 * Every gistable block in the library, deduplicated by block id.
 *
 * The dedup is not tidiness. `example/` is a 34-block extract of
 * `data/noema-mythology-of-conscious-ai`, **with the same block ids** — it is
 * the committed fixture, cut from the same extraction. Left in, a third of one
 * article would sit in the corpus twice, so a model that found the right
 * paragraph could spend two of its five slots on it and a model that found the
 * wrong one could not. Neither model would be at fault and the difference would
 * look like retrieval quality.
 *
 * So duplicates are dropped by id and the count is printed, rather than
 * `example/` being skipped by name: if the fixture is ever re-cut with fresh
 * ids, the drop count falls to zero and the printed line says so, instead of a
 * hardcoded exclusion silently protecting against a problem that has moved.
 */
async function loadCorpus(): Promise<{ passages: Passage[]; duplicates: number }> {
  const dirs: { dir: string; slug: string }[] = [];
  const entries = await readdir(path.join(ROOT, "data"), { withFileTypes: true });
  for (const e of entries) {
    // `_`-prefixed directories are not articles — `data/_jobs/` is the queue's
    // records. Same rule as `listArticles` and `searchLibrary`.
    if (e.isDirectory() && !e.name.startsWith("_")) {
      dirs.push({ dir: path.join(ROOT, "data", e.name), slug: e.name });
    }
  }
  dirs.push({ dir: path.join(ROOT, "example"), slug: "example" });

  const passages: Passage[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const { dir, slug } of dirs) {
    let blocks: Block[];
    try {
      const raw = await readFile(path.join(dir, "blocks.json"), "utf-8");
      ({ blocks } = JSON.parse(raw) as { blocks: Block[] });
    } catch {
      continue; // not an article directory
    }
    for (const b of blocks) {
      if (!b.gistable) continue;
      if (seen.has(b.id)) {
        duplicates++;
        continue;
      }
      seen.add(b.id);
      passages.push({ slug, blockId: b.id, text: b.text });
    }
  }
  return { passages, duplicates };
}

// ---------------------------------------------------------------- embeddings

/**
 * **The request client lives in [src/embeddings.ts](../src/embeddings.js).**
 *
 * It was written here first, and moved when the app grew a second caller (the
 * Force diagram's dotted links — src/similar.ts). The parts worth keeping were
 * never the request: they were the three failures underneath it, each of which
 * is invisible if you get it wrong. A permuted `data[]`, a 404 that is an
 * account setting rather than a bad model id, and a 429 that means "busy"
 * rather than "no". Two copies of that could only ever diverge, and the copy
 * that diverged would be the one nobody was running that week.
 *
 * What stays here is the eval's own shape: arms, and progress on stderr.
 */
async function embedAllForArm(
  arm: Arm,
  texts: string[],
  apiKey: string,
  kind: "query" | "document",
): Promise<EmbedResult> {
  return embedAll(texts, {
    model: arm.model,
    inputType: arm.inputType ? kind : null,
    apiKey,
    onProgress: (done, total) => {
      process.stderr.write(`  ${arm.id} ${kind}s: ${done}/${total}${done === total ? "\n" : "\r"}`);
    },
  });
}

// ---------------------------------------------------------------- judging

/** 0 = irrelevant, 1 = partly relevant, 2 = directly answers the query. */
type Score = 0 | 1 | 2;

type Judgements = Record<string, { score: Score; why: string }>;

/**
 * **Bump this whenever `JUDGE_SYSTEM` changes.** It is part of the cache
 * identity, so an edited rubric invalidates every judgement made under the old
 * one rather than silently mixing two scales in one table.
 */
const RUBRIC_VERSION = 1;

function sha12(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

/**
 * What a cached judgement is keyed by — and why it is not `(queryId, blockId)`,
 * which is what the first version of this file used.
 *
 * A block id is stable across re-extraction **by design**: that is the whole
 * point of docs/project/block-ids.md — ids are minted once and preserved so
 * every feature can address text by them and survive a re-run. Which makes a
 * block id exactly the wrong thing to key a cached *opinion about prose* on.
 * Re-extract an article — a better splitter, a fixed Readability edge case, a
 * paragraph that now merges with its neighbour — and `spya-k3m9qt` still exists
 * and holds different words. The cache would hand back a judgement of the old
 * paragraph, every number in the report would be computed from it, and nothing
 * would error: the eval would quietly be scoring text nobody read. That is
 * docs/reusable/silent-success.md with a stable id as the accomplice.
 *
 * The same trap applies to the query — editing `q07`'s wording while keeping
 * its id would reuse verdicts about the question it used to ask.
 *
 * So the key carries a hash of both texts. The judge model and the rubric
 * version are checked at file level instead (see `readJudgements`): they apply
 * to every entry at once, so a mismatch should discard the whole file rather
 * than miss on every key and look like an empty cache.
 *
 * **The separator is a space, and that is not cosmetic.** It used to be a
 * literal NUL byte, which made every key in this file unsearchable: a NUL
 * anywhere in a file makes grep treat the whole thing as binary and print
 * nothing at all, so `grep judgementKey` on this file returned silence rather
 * than an error. A tool reporting no matches reads exactly like there being
 * none.
 *
 * Raised by a cross-family review, 2026-08-26.
 */
const judgementKey = (query: Query, passage: Passage): string =>
  `${query.id}:${sha12(query.text)} ${passage.blockId}:${sha12(passage.text)}`;

const JUDGE_SYSTEM = `You are grading a search engine for a reading tool. A reader typed a question while reading a long essay, and the engine returned passages from the article they are reading (or from others on their shelf).

Score each passage against the reader's question:

2 — this passage directly addresses what the reader asked. Reading it answers the question, or gives the argument the question is reaching for.
1 — related and worth landing on, but it does not really answer: it touches the topic, sets it up, or mentions it in passing.
0 — not what the reader was after. Same broad subject is not enough.

Judge the passage on its own words. The reader's question is deliberately phrased in their own vocabulary rather than the author's, so do not reward or punish word overlap in either direction — a passage that answers the question using completely different words scores 2, and a passage that repeats the question's words while answering something else scores 0.

Be strict about 2. Most passages a search engine returns are not answers.

Reply with JSON only: {"scores": [{"passage": "A", "score": 2}, ...]} and nothing else. Include a row for EVERY passage, in order, including ones that are obviously irrelevant — an omitted passage is a missing judgement, not a zero.`;

/**
 * Judge one query's pooled passages in a single call, blind.
 *
 * **One call per query rather than one per pair**, because the judge is
 * calibrating a three-point scale and calibration drifts between calls: the
 * same passage graded alone versus graded beside a better one is a real source
 * of disagreement, and it would fall unevenly on the two models. Seeing the
 * whole pool at once is also what a person doing this by hand would do.
 *
 * **Blind**: the passages arrive shuffled and labelled A, B, C…, with nothing
 * saying which model surfaced which, or that there were two models at all. The
 * shuffle is seeded off the query id, so a re-run presents them in the same
 * order and any position effect is at least constant between runs.
 */
async function judgeQuery(
  client: Anthropic,
  judgeModel: string,
  query: Query,
  pooled: Passage[],
): Promise<Record<string, { score: Score; why: string }>> {
  const shuffled = shuffle(pooled, hashSeed(query.id));
  const letters = shuffled.map((_, i) => String.fromCharCode(65 + i));
  const body = shuffled
    .map((p, i) => `<passage id="${letters[i]}">\n${p.text}\n</passage>`)
    .join("\n\n");

  /* **A declared bypass, not an oversight.** The judge speaks the Messages
     shape and chooses its own model per run, and `streamMessage` owns the model
     on purpose — see `embedding-eval-judge` in evals/declared-spend.ts for why
     it is not simply moved onto the seam. The wrapper is what makes the money
     appear in `npm run cost` anyway, priced from ANTHROPIC_PRICES because this
     call does not go through OpenRouter and so has nobody to ask. */
  const response = await withDeclaredExternalCall(
    "embedding-eval-judge",
    { model: judgeModel },
    async ({ observe }) => {
      const message = await client.messages.create({
        model: judgeModel,
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        system: JUDGE_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Reader's question: ${query.text}\n\n${body}`,
          },
        ],
      });
      observe.anthropic(message);
      return message;
    },
  );

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error(`judge returned no JSON for ${query.id}: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as { scores: { passage: string; score: number }[] };

  const out: Record<string, { score: Score; why: string }> = {};
  for (const entry of parsed.scores) {
    const idx = letters.indexOf(entry.passage.trim().toUpperCase());
    const passage = shuffled[idx];
    if (idx === -1 || !passage) continue;
    const score = Math.max(0, Math.min(2, Math.round(entry.score))) as Score;
    out[judgementKey(query, passage)] = { score, why: "" };
  }
  /* A pooled passage the judge skipped is not scored 0 by default — that would
     be a silent success, since "the judge didn't mention it" and "the judge
     said it was irrelevant" are different facts and only one of them is
     evidence. And it would not be a neutral default: a skipped passage is
     usually an obviously-irrelevant one, so scoring it 0 would be right often
     enough to hide the times it wasn't. Missing keys are retried by the caller
     and the run fails loudly if they are still missing. */
  return out;
}

/**
 * Judge a query, retrying while the judge leaves passages unscored.
 *
 * It happens: on the first run of this file the judge returned six scores for a
 * seven-passage pool, dropping a paragraph from a different article that was
 * plainly irrelevant. Retrying is the cheap fix; the loud failure below it is
 * the one that matters.
 */
async function judgeQueryComplete(
  client: Anthropic,
  judgeModel: string,
  query: Query,
  pooled: Passage[],
  attempts = 3,
): Promise<Record<string, { score: Score; why: string }>> {
  let out: Record<string, { score: Score; why: string }> = {};
  for (let attempt = 1; attempt <= attempts; attempt++) {
    /* The earlier attempt wins on anything it scored — a retry exists to fill
       gaps, not to give a passage a second roll of the dice. */
    out = { ...(await judgeQuery(client, judgeModel, query, pooled)), ...out };
    const missing = pooled.filter((p) => out[judgementKey(query, p)] === undefined);
    if (missing.length === 0) return out;
    process.stderr.write(
      `  ${query.id}: ${missing.length} unscored after attempt ${attempt}, retrying\n`,
    );
  }
  return out;
}

// ---------------------------------------------------------------- metrics

/** Deterministic 32-bit seed from a string, so a re-run shuffles the same way. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, seeded, and good enough for shuffling and resampling. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  const next = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function dcg(scores: number[]): number {
  return scores.reduce((sum, s, i) => sum + s / Math.log2(i + 2), 0);
}

/**
 * nDCG@5 — **against the pool, not against the corpus.**
 *
 * The ideal ranking is the judged pool sorted best-first, and the pool is the
 * union of the two models' top-5. So this measures "did you rank what *either*
 * of you found in the best order", not "did you find everything there was".
 * A passage neither model surfaced is invisible to it, and if both models miss
 * the same excellent paragraph they both still score 1.0. That is the right
 * head-to-head number and the wrong absolute one, and it is only honest to
 * print it next to the literal-matcher baseline, which is the one measure here
 * that can see outside the pool.
 */
function ndcgAt(ranked: number[], pool: number[], k: number): number {
  const ideal = [...pool].sort((a, b) => b - a).slice(0, k);
  const idealDcg = dcg(ideal);
  return idealDcg === 0 ? 1 : dcg(ranked.slice(0, k)) / idealDcg;
}

interface PerQuery {
  queryId: string;
  ranked: { blockId: string; slug: string; score: Score; cosine: number }[];
  precisionAt3: number;
  precisionAt5: number;
  strictPrecisionAt5: number;
  meanScore: number;
  ndcgAt5: number;
  /** Top-5 block ids no other model returned. */
  unique: string[];
  uniqueMeanScore: number;
}

interface ModelReport {
  /** The arm's short name — a model may appear twice under different names. */
  arm: string;
  model: string;
  /** Whether Voyage's `input_type` was sent. See `Arm`. */
  inputType: boolean;
  /** Top-5 slots this arm filled that a given other arm did not. Keyed by arm id. */
  versus: Record<string, number>;
  dims: number;
  usage: EmbeddingUsage;
  precisionAt3: number;
  precisionAt5: number;
  strictPrecisionAt5: number;
  meanScore: number;
  ndcgAt5: number;
  uniqueFinds: number;
  uniqueMeanScore: number;
  queriesWithNoRelevantHit: number;
  /**
   * How far above the corpus the top 5 sit, in standard deviations of the
   * corpus's own cosine spread — a scale-free version of "does this model
   * separate the right paragraph from the other 490". Not a quality measure on
   * its own (a model could separate the wrong thing confidently), but it is
   * the mechanism to look at when one model's precision is lower.
   */
  separation: number;
  /** Mean cosine against the whole corpus — the model's floor, for context. */
  corpusMeanCosine: number;
  perQuery: PerQuery[];
}

/**
 * A paired bootstrap over queries, for the difference in a per-query measure.
 *
 * Eighteen queries is a small sample and the two models will not be far apart.
 * Printing "0.72 vs 0.69" with nothing beside it invites a decision that the
 * data does not support — evals/README.md records the last time a verdict line
 * in this folder outran its own statistic. So the difference gets an interval:
 * resample the eighteen queries with replacement, recompute the paired
 * difference, and report the 2.5th and 97.5th percentiles. If that interval
 * straddles zero, the honest report is "no measurable difference", whatever the
 * point estimates say.
 *
 * It is paired — the same resampled queries for both models — because the
 * models are compared on identical queries and identical judgements, so the
 * query-to-query variation is shared and should cancel.
 */
function bootstrapDiff(a: number[], b: number[], seed: number): { lo: number; hi: number } {
  const n = a.length;
  const next = rng(seed);
  const diffs: number[] = [];
  for (let iter = 0; iter < 10000; iter++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const j = Math.floor(next() * n);
      sum += (a[j] ?? 0) - (b[j] ?? 0);
    }
    diffs.push(sum / n);
  }
  diffs.sort((x, y) => x - y);
  return {
    lo: diffs[Math.floor(0.025 * diffs.length)] ?? 0,
    hi: diffs[Math.floor(0.975 * diffs.length)] ?? 0,
  };
}

// ---------------------------------------------------------------- literal baseline

/**
 * A second, deliberately generous word-matching baseline.
 *
 * `searchLibrary` ANDs every term, and these queries are whole sentences, so it
 * returns nothing at all for every one of them. That is a true and useful fact
 * about what we ship — but on its own it is a straw man, because nobody claims
 * an AND matcher is a question-answering engine. So this is the strongest thing
 * word-matching can reasonably do without embeddings: OR over the query's
 * content words, ranked by how many of them a paragraph contains, damped by
 * length the same way `searchLibrary` damps its own score.
 *
 * If semantic retrieval only beats the AND matcher, it has beaten a matcher
 * aimed at a different kind of query. If it also beats this, it is buying
 * something word-matching cannot do.
 */
const STOP = new Set(
  ("a an and are as at be but by do does for from had has have how i if in into is it its of on " +
    "or that the their them they this to was were what when where which who why with you your " +
    "not no does did been being can could would should more most some any all one two out up " +
    "about after again against because before between both during each few further here").split(
    " ",
  ),
);

function contentTerms(query: string): string[] {
  return query
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

function orBaseline(
  passages: Passage[],
  queries: Query[],
  relevantByQuery: Map<string, Set<string>>,
): { foundInTop5: number; relevantTotal: number; queriesWithAnyRelevantInTop5: number } {
  let foundInTop5 = 0;
  let relevantTotal = 0;
  let queriesWithAnyRelevantInTop5 = 0;
  for (const q of queries) {
    const terms = contentTerms(q.text);
    const scored = passages.map((p) => {
      const folded = p.text.toLowerCase();
      let hits = 0;
      for (const t of terms) if (folded.includes(t)) hits++;
      return { id: p.blockId, rank: hits / Math.log(p.text.split(/\s+/).length + 2) };
    });
    scored.sort((a, b) => b.rank - a.rank);
    const top5 = new Set(scored.slice(0, TOP_K).map((s) => s.id));
    const relevant = relevantByQuery.get(q.id) ?? new Set<string>();
    const found = [...relevant].filter((id) => top5.has(id)).length;
    relevantTotal += relevant.size;
    foundInTop5 += found;
    if (found > 0) queriesWithAnyRelevantInTop5++;
  }
  return { foundInTop5, relevantTotal, queriesWithAnyRelevantInTop5 };
}

/**
 * What the search we already ship would have found.
 *
 * `searchLibrary` is imported rather than reimplemented. A hand-rolled copy of
 * "AND over the query's words, case and accent folded" would be *nearly* the
 * shipped behaviour, and the gap between the two would be attributed to
 * semantic search — see src/library-search.ts § parseQuery for how carefully
 * that function's exact rules are pinned, and why.
 *
 * The number reported is recall of judged-relevant passages: of the passages a
 * judge marked 1 or 2, how many does the literal matcher return at all, and how
 * many in its own top 5. That is the only measure here that can see outside the
 * pool, and it is the one that says what semantic search is buying.
 */
async function literalBaseline(
  queries: Query[],
  relevantByQuery: Map<string, Set<string>>,
): Promise<{
  queriesWithAnyHit: number;
  relevantTotal: number;
  foundAnywhere: number;
  foundInTop5: number;
  perQuery: { queryId: string; hits: number; foundAnywhere: number; foundInTop5: number }[];
}> {
  let queriesWithAnyHit = 0;
  let relevantTotal = 0;
  let foundAnywhere = 0;
  let foundInTop5 = 0;
  const perQuery: { queryId: string; hits: number; foundAnywhere: number; foundInTop5: number }[] =
    [];

  /* Imported here rather than at the top of the file, and the reason is dull
     but real: src/library-search.ts pulls in src/log.ts, which builds its pino
     logger at module load and reads LOG_LEVEL then. A static import would run
     before this line and every one of these eighteen searches would print a
     debug line into the middle of the report. `LOG_LEVEL` set by hand still
     wins, because this only fills in a default. */
  process.env.LOG_LEVEL ??= "warn";
  const { searchLibrary } = await import("../src/library-search.js");

  for (const q of queries) {
    const { hits } = await searchLibrary(q.text, 200);
    /* Deduplicated by block id for the same reason the corpus is — `example/`
       shares ids with the noema article, and searchLibrary walks both. */
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const h of hits) {
      if (seen.has(h.blockId)) continue;
      seen.add(h.blockId);
      ids.push(h.blockId);
    }
    const relevant = relevantByQuery.get(q.id) ?? new Set<string>();
    const anywhere = [...relevant].filter((id) => seen.has(id)).length;
    const top5 = new Set(ids.slice(0, TOP_K));
    const inTop5 = [...relevant].filter((id) => top5.has(id)).length;

    if (ids.length > 0) queriesWithAnyHit++;
    relevantTotal += relevant.size;
    foundAnywhere += anywhere;
    foundInTop5 += inTop5;
    perQuery.push({
      queryId: q.id,
      hits: ids.length,
      foundAnywhere: anywhere,
      foundInTop5: inTop5,
    });
  }
  return { queriesWithAnyHit, relevantTotal, foundAnywhere, foundInTop5, perQuery };
}

// ---------------------------------------------------------------- run

/** What sits on disk: the verdicts, and what produced them. */
interface JudgementsFile {
  judgeModel: string;
  rubricVersion: number;
  judgements: Judgements;
}

/**
 * A judge's cached verdicts, or nothing — and **nothing is the right answer for
 * a file that does not match**, rather than a mixture.
 *
 * `judgeModel` and `rubricVersion` apply to every entry at once, so they are
 * checked here instead of being folded into each key. Same fact either way; the
 * difference is what a mismatch *looks like*. Folded into the key, a rubric
 * change would miss on every lookup and be indistinguishable from a cold cache
 * — the run would re-judge everything and print nothing about why. Checked at
 * file level, it says so out loud.
 */
async function readJudgements(judgeModel: string): Promise<Judgements> {
  let file: JudgementsFile;
  try {
    file = JSON.parse(await readFile(judgementsFile(judgeModel), "utf-8")) as JudgementsFile;
  } catch {
    return {};
  }
  if (file.judgeModel !== judgeModel || file.rubricVersion !== RUBRIC_VERSION) {
    console.log(
      `Ignoring cached judgements: file says judge=${file.judgeModel} rubric=${file.rubricVersion}, ` +
        `this run is judge=${judgeModel} rubric=${RUBRIC_VERSION}. Re-judging.`,
    );
    return {};
  }
  return file.judgements ?? {};
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

interface Retrieval {
  dims: number;
  usage: EmbeddingUsage;
  top: Map<string, { passage: Passage; cosine: number }[]>;
  /** See `separation` on ModelReport. */
  separation: number;
  corpusMeanCosine: number;
}

/** One model's view of the corpus: embed everything, rank every query. */
async function retrieve(arm: Arm, passages: Passage[], apiKey: string): Promise<Retrieval> {
  const corpus = await embedAllForArm(
    arm,
    passages.map((p) => p.text),
    apiKey,
    "document",
  );
  const queryVecs = await embedAllForArm(
    arm,
    QUERIES.map((q) => q.text),
    apiKey,
    "query",
  );
  const top = new Map<string, { passage: Passage; cosine: number }[]>();
  const zs: number[] = [];
  const corpusMeans: number[] = [];
  for (const [qi, q] of QUERIES.entries()) {
    const qv = queryVecs.vectors[qi];
    if (!qv) throw new Error(`no query vector for ${q.id}`);
    const scored = passages.map((p, pi) => ({
      passage: p,
      cosine: cosine(qv, corpus.vectors[pi] ?? []),
    }));
    scored.sort((a, b) => b.cosine - a.cosine);
    top.set(q.id, scored.slice(0, TOP_K));
    /* Separation, as a z-score. Raw cosines are not comparable between models —
       bge-m3's floor sits far higher than 3-small's, so its top hit can look
       "more similar" while being no better separated from the 490 other
       paragraphs. What matters for ranking is how far above the crowd the top 5
       sit, in units of the crowd's own spread. */
    const all = scored.map((s) => s.cosine);
    const mu = mean(all);
    const sd = Math.sqrt(mean(all.map((c) => (c - mu) ** 2)));
    corpusMeans.push(mu);
    zs.push(sd === 0 ? 0 : (mean(all.slice(0, TOP_K)) - mu) / sd);
  }
  return {
    dims: corpus.vectors[0]?.length ?? 0,
    usage: {
      promptTokens: corpus.usage.promptTokens + queryVecs.usage.promptTokens,
      cost: corpus.usage.cost + queryVecs.usage.cost,
    },
    top,
    separation: mean(zs),
    corpusMeanCosine: mean(corpusMeans),
  };
}

/** The union of every model's top-5, per query — what gets judged. */
function poolPerQuery(arms: Arm[], perArm: Map<string, Retrieval>): Map<string, Passage[]> {
  const pools = new Map<string, Passage[]>();
  for (const q of QUERIES) {
    const seen = new Set<string>();
    const pool: Passage[] = [];
    for (const arm of arms) {
      for (const hit of perArm.get(arm.id)?.top.get(q.id) ?? []) {
        if (seen.has(hit.passage.blockId)) continue;
        seen.add(hit.passage.blockId);
        pool.push(hit.passage);
      }
    }
    pools.set(q.id, pool);
  }
  return pools;
}

/**
 * Every pooled passage judged, cache filled in, and a loud failure if anything
 * is still unscored — see `judgeQuery` for why an unscored passage is not a 0.
 */
async function judgeAll(
  judgeModel: string,
  pools: Map<string, Passage[]>,
): Promise<Judgements> {
  const judgements = await readJudgements(judgeModel);
  const needed = QUERIES.filter((q) =>
    (pools.get(q.id) ?? []).some((p) => judgements[judgementKey(q, p)] === undefined),
  );
  if (needed.length > 0) {
    console.log(`\nJudging ${needed.length} queries (cached: ${QUERIES.length - needed.length})…`);
    /* `maxRetries: 0` and a guarded `fetch` — a default client turns one call
       into up to three billable attempts and the row would then understate the
       spend by a factor. See evals/declared-spend.ts. */
    const client = anthropicForDeclared();
    const queue = new PQueue({ concurrency: 4 });
    await Promise.all(
      needed.map((q) =>
        queue.add(async () => {
          const got = await judgeQueryComplete(client, judgeModel, q, pools.get(q.id) ?? []);
          Object.assign(judgements, got);
          process.stderr.write(`  judged ${q.id}\n`);
        }),
      ),
    );
    await mkdir(RESULTS, { recursive: true });
    const file: JudgementsFile = { judgeModel, rubricVersion: RUBRIC_VERSION, judgements };
    await writeFile(judgementsFile(judgeModel), `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  }

  const missing: string[] = [];
  for (const q of QUERIES) {
    for (const p of pools.get(q.id) ?? []) {
      if (judgements[judgementKey(q, p)] === undefined) {
        missing.push(`${q.id}/${p.blockId}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} pooled passages went unjudged — the run is not scorable: ${missing.slice(0, 5).join(", ")}`,
    );
  }
  return judgements;
}

/** One model's numbers, against judgements shared with every other model. */
function score(
  arm: Arm,
  entry: Retrieval,
  arms: Arm[],
  perArm: Map<string, Retrieval>,
  pools: Map<string, Passage[]>,
  judgements: Judgements,
): ModelReport {
  const others = arms.filter((a) => a.id !== arm.id);
  const perQuery: PerQuery[] = [];
  for (const q of QUERIES) {
    const hits = entry.top.get(q.id) ?? [];
    const scores = hits.map(
      (h) => judgements[judgementKey(q, h.passage)]?.score ?? (0 as Score),
    );
    const poolScores = (pools.get(q.id) ?? []).map(
      (p) => judgements[judgementKey(q, p)]?.score ?? 0,
    );
    const otherIds = new Set<string>();
    for (const o of others) {
      for (const h of perArm.get(o.id)?.top.get(q.id) ?? []) otherIds.add(h.passage.blockId);
    }
    const uniqueIdx = hits
      .map((h, i) => (otherIds.has(h.passage.blockId) ? -1 : i))
      .filter((i) => i !== -1);
    perQuery.push({
      queryId: q.id,
      ranked: hits.map((h, i) => ({
        blockId: h.passage.blockId,
        slug: h.passage.slug,
        score: scores[i] ?? (0 as Score),
        cosine: Number(h.cosine.toFixed(4)),
      })),
      precisionAt3: mean(scores.slice(0, 3).map((s) => (s >= 1 ? 1 : 0))),
      precisionAt5: mean(scores.slice(0, 5).map((s) => (s >= 1 ? 1 : 0))),
      strictPrecisionAt5: mean(scores.slice(0, 5).map((s) => (s === 2 ? 1 : 0))),
      meanScore: mean(scores),
      ndcgAt5: ndcgAt(scores, poolScores, 5),
      unique: uniqueIdx.map((i) => hits[i]?.passage.blockId ?? ""),
      uniqueMeanScore: mean(uniqueIdx.map((i) => scores[i] ?? 0)),
    });
  }
  /* Pairwise, as well as against-all-comers. With more than two arms the
     "nobody else found it" count collapses towards zero — two arms that agree
     with each other both lose their unique finds to the third — so on its own
     it would understate how differently a pair behaves. This says, for each
     other arm, how many of this arm's 90 slots that one arm missed. */
  const versus: Record<string, number> = {};
  for (const o of others) {
    let n = 0;
    for (const q of QUERIES) {
      const theirs = new Set(
        (perArm.get(o.id)?.top.get(q.id) ?? []).map((h) => h.passage.blockId),
      );
      for (const h of entry.top.get(q.id) ?? []) if (!theirs.has(h.passage.blockId)) n++;
    }
    versus[o.id] = n;
  }

  return {
    arm: arm.id,
    model: arm.model,
    inputType: arm.inputType,
    versus,
    dims: entry.dims,
    usage: entry.usage,
    precisionAt3: mean(perQuery.map((p) => p.precisionAt3)),
    precisionAt5: mean(perQuery.map((p) => p.precisionAt5)),
    strictPrecisionAt5: mean(perQuery.map((p) => p.strictPrecisionAt5)),
    meanScore: mean(perQuery.map((p) => p.meanScore)),
    ndcgAt5: mean(perQuery.map((p) => p.ndcgAt5)),
    uniqueFinds: perQuery.reduce((n, p) => n + p.unique.length, 0),
    uniqueMeanScore: mean(perQuery.flatMap((p) => (p.unique.length > 0 ? [p.uniqueMeanScore] : []))),
    queriesWithNoRelevantHit: perQuery.filter((p) => p.meanScore === 0).length,
    separation: entry.separation,
    corpusMeanCosine: entry.corpusMeanCosine,
    perQuery,
  };
}

function printModelTables(reports: ModelReport[]): void {
  console.log("\n## Retrieval quality\n");
  console.log("| arm | dims | P@3 | P@5 | strict P@5 | mean score | nDCG@5 | $ |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of reports) {
    console.log(
      `| ${r.arm} | ${r.dims} | ${pct(r.precisionAt3)} | ${pct(r.precisionAt5)} | ` +
        `${pct(r.strictPrecisionAt5)} | ${r.meanScore.toFixed(3)} | ${r.ndcgAt5.toFixed(3)} | ` +
        `${r.usage.cost.toFixed(5)} |`,
    );
  }

  console.log("\n## Disagreement\n");
  console.log("| arm | top-5 NO other arm found | their mean judged score | queries with nothing relevant |");
  console.log("|---|---:|---:|---:|");
  for (const r of reports) {
    console.log(
      `| ${r.arm} | ${r.uniqueFinds} | ${r.uniqueMeanScore.toFixed(3)} | ${r.queriesWithNoRelevantHit} |`,
    );
  }

  /* Pairwise, because the column above collapses with more than two arms: two
     arms that agree with each other both lose their unique finds to a third,
     and "0" then reads as "identical to everyone" when it means "never alone".
     Each cell is how many of the row arm's ${TOP_K * QUERIES.length} slots the
     column arm did not fill. */
  console.log(`\n## Pairwise — of the row arm's ${TOP_K * QUERIES.length} top-5 slots, how many the column arm missed\n`);
  console.log(`| | ${reports.map((r) => r.arm).join(" | ")} |`);
  console.log(`|---|${reports.map(() => "---:").join("|")}|`);
  for (const r of reports) {
    const cells = reports.map((c) => (c.arm === r.arm ? "—" : String(r.versus[c.arm] ?? 0)));
    console.log(`| **${r.arm}** | ${cells.join(" | ")} |`);
  }

  console.log("\n## Separation — how far the top 5 sit above the corpus\n");
  console.log("| arm | mean cosine over corpus | top-5 lift, in SDs of that spread |");
  console.log("|---|---:|---:|");
  for (const r of reports) {
    console.log(`| ${r.arm} | ${r.corpusMeanCosine.toFixed(3)} | ${r.separation.toFixed(2)} |`);
  }
}

/**
 * Every arm against the leader, with an interval on each gap.
 *
 * The leader is whichever arm has the best mean judged score, and it is
 * compared against rather than declared the winner: the question this table
 * answers is *"is anything else within noise of the top?"*, which is the only
 * form of the question the sample size can support. An arm whose interval
 * straddles zero is not beaten — it is tied, and the tie-break is then price,
 * dimensions and billing, which are facts rather than measurements.
 *
 * Paired, because every arm is scored on the same queries against the same
 * judgements, so the query-to-query variation is shared and cancels.
 */
function printComparison(reports: ModelReport[]): void {
  if (reports.length < 2) return;
  const best = reports.reduce((a, b) => (b.meanScore > a.meanScore ? b : a));
  console.log(
    `\n## Each arm minus ${best.arm} (the leader), 95% paired bootstrap over ${QUERIES.length} queries\n`,
  );
  console.log("| arm | measure | difference | 95% interval | |");
  console.log("|---|---|---:|---|---|");
  for (const r of reports) {
    if (r.arm === best.arm) continue;
    for (const [name, pick] of [
      ["mean judged score", (p: PerQuery) => p.meanScore],
      ["precision@5", (p: PerQuery) => p.precisionAt5],
      ["nDCG@5", (p: PerQuery) => p.ndcgAt5],
    ] as const) {
      const xs = r.perQuery.map(pick);
      const ys = best.perQuery.map(pick);
      const { lo, hi } = bootstrapDiff(xs, ys, 20260826);
      const d = mean(xs) - mean(ys);
      const straddles = lo <= 0 && hi >= 0;
      console.log(
        `| ${r.arm} | ${name} | ${d >= 0 ? "+" : ""}${d.toFixed(3)} | ` +
          `[${lo.toFixed(3)}, ${hi.toFixed(3)}] | ${straddles ? "**tied — straddles zero**" : "behind"} |`,
      );
    }
  }

  console.log(`\nPer-query wins against ${best.arm} (by mean judged score):\n`);
  console.log("| arm | better | worse | tied |");
  console.log("|---|---:|---:|---:|");
  for (const r of reports) {
    if (r.arm === best.arm) continue;
    const better = r.perQuery.filter(
      (p, i) => p.meanScore > (best.perQuery[i]?.meanScore ?? 0),
    ).length;
    const worse = r.perQuery.filter(
      (p, i) => p.meanScore < (best.perQuery[i]?.meanScore ?? 0),
    ).length;
    console.log(`| ${r.arm} | ${better} | ${worse} | ${QUERIES.length - better - worse} |`);
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set — see docs/project/setup-dev.md");

  const args = process.argv.slice(2);
  const armArg = args.indexOf("--arms");
  /* `--arms bge-m3,3-small` selects by arm id from DEFAULT_ARMS rather than
     taking raw model ids, because an arm is a model *plus how it is asked* and
     a bare model id cannot say which. */
  const wanted = armArg === -1 ? null : new Set((args[armArg + 1] ?? "").split(","));
  const arms = wanted ? DEFAULT_ARMS.filter((a) => wanted.has(a.id)) : DEFAULT_ARMS;
  if (arms.length === 0) {
    throw new Error(`--arms matched nothing. Known: ${DEFAULT_ARMS.map((a) => a.id).join(", ")}`);
  }
  const judgeModel = process.env.SPIDERYARN_JUDGE_MODEL ?? CAPABLE_MODEL;

  const { passages, duplicates } = await loadCorpus();
  console.log(
    `Corpus: ${passages.length} gistable blocks (${duplicates} duplicate ids dropped — see loadCorpus)`,
  );
  console.log(`Queries: ${QUERIES.length}`);
  console.log(`Arms: ${arms.map((a) => a.id).join(", ")}`);
  console.log(`Judge: ${judgeModel} (rubric v${RUBRIC_VERSION})`);
  console.log("");

  const perArm = new Map<string, Retrieval>();
  for (const arm of arms) {
    console.log(`Embedding with ${arm.id} (${arm.model}${arm.inputType ? ", input_type" : ""})…`);
    perArm.set(arm.id, await retrieve(arm, passages, apiKey));
  }

  const pools = poolPerQuery(arms, perArm);
  const judgements = await judgeAll(judgeModel, pools);
  const relevantByQuery = new Map<string, Set<string>>();
  for (const q of QUERIES) {
    const set = new Set<string>();
    for (const p of pools.get(q.id) ?? []) {
      if ((judgements[judgementKey(q, p)]?.score ?? 0) >= 1) set.add(p.blockId);
    }
    relevantByQuery.set(q.id, set);
  }

  const reports = arms
    .map((arm) => {
      const entry = perArm.get(arm.id);
      return entry ? score(arm, entry, arms, perArm, pools, judgements) : null;
    })
    .filter((r): r is ModelReport => r !== null);

  const judgedPairs = QUERIES.reduce((n, q) => n + (pools.get(q.id)?.length ?? 0), 0);
  console.log(
    `\nJudged ${judgedPairs} (query, passage) pairs across ${QUERIES.length} queries — ` +
      `mean pool ${(judgedPairs / QUERIES.length).toFixed(1)} passages per query.`,
  );

  const baseline = await literalBaseline(QUERIES, relevantByQuery);
  const generous = orBaseline(passages, QUERIES, relevantByQuery);

  printModelTables(reports);
  printComparison(reports);

  console.log("\n## What the literal matcher already ships finds\n");
  console.log(
    `Queries returning any hit at all: ${baseline.queriesWithAnyHit}/${QUERIES.length}.`,
  );
  console.log(
    `Judged-relevant passages: ${baseline.relevantTotal}. ` +
      `Literal returns ${baseline.foundAnywhere} of them anywhere in its results ` +
      `(${pct(baseline.relevantTotal === 0 ? 0 : baseline.foundAnywhere / baseline.relevantTotal)}), ` +
      `${baseline.foundInTop5} in its own top ${TOP_K} ` +
      `(${pct(baseline.relevantTotal === 0 ? 0 : baseline.foundInTop5 / baseline.relevantTotal)}).`,
  );
  console.log(
    `\nGenerous word-matching (OR over content words, ranked — see orBaseline): ` +
      `${generous.foundInTop5}/${generous.relevantTotal} judged-relevant passages in its top ${TOP_K} ` +
      `(${pct(generous.relevantTotal === 0 ? 0 : generous.foundInTop5 / generous.relevantTotal)}), ` +
      `something relevant in the top ${TOP_K} for ${generous.queriesWithAnyRelevantInTop5}/${QUERIES.length} queries.`,
  );

  const stamp = new Date().toISOString().slice(0, 16).replace(":", "");
  const out = path.join(RESULTS, `embedding-retrieval-${stamp}.json`);
  await mkdir(RESULTS, { recursive: true });
  await writeFile(
    out,
    `${JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        judgeModel,
        rubricVersion: RUBRIC_VERSION,
        corpus: { passages: passages.length, duplicatesDropped: duplicates },
        queries: QUERIES,
        judgedPairs,
        arms: reports,
        literalBaseline: baseline,
        generousWordBaseline: generous,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  console.log(`\nWrote ${path.relative(ROOT, out)}`);
}

/* See the note in evals/review-stances.ts. The embedding calls here are metered
   by src/ai-call.ts and only ever needed a collector; the judge is a declared
   bypass and records itself. */
await withLedger("eval", main);
