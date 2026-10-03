/**
 * **Quick search** — every block of the article scored by Jev for how well it
 * matches what the reader typed, in about a second. The fast sibling of the
 * meaning search in [`search.ts`](search.ts), and a drop-in for it: it yields
 * the same `SearchEvent`s, so `search` in src/routes.ts picks one generator or
 * the other and stores the result the same way.
 *
 * Plan: docs/plans/261002e-quick-search-v1.md. Every number in this file — the
 * request shape, the floor, the chunk budget — was measured in
 * docs/investigations/261002o-quick-search-spike.md, with the wording and floor
 * rechecked in investigation 261003c and the fallback floor measured in
 * 261003f. Read those before changing one.
 *
 * ## What it asks
 *
 * One request per chunk of the article: `state = {query, passages: {<id>:
 * text}}` and one `noul` (yes/no, answered as a probability) question per
 * block, keyed by the block id. The state is billed **once**, not per question,
 * which is what makes one request over the whole article cost about $0.0004.
 * The question asks whether the passage *mentions or discusses* what the
 * reader wants. Until 2026-10-03 it asked whether the passage *matches*, and a
 * one-word topic the article only mentions in passing scored under the floor:
 * 109 of 141 literal-target opportunities missed on 18 short-topic queries
 * (47 targets, three runs each), against 17 with
 * this wording (docs/investigations/261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md).
 * A "meaning, not words" sentence was measured before that and bought nothing
 * for 45% more input.
 *
 * ## What it gives back, and what it cannot
 *
 * Blocks scoring at least `QUICK_FLOOR`, best first, capped at `MAX_HITS` —
 * or, when none does, the best few at `QUICK_FALLBACK_FLOOR` or more — each
 * as a `SearchHit` whose `quote` is the whole block — Jev scores blocks, so
 * there is no sentence inside one to point at — with `confidence` its
 * probability × 100 and no `reasoning`. That is what *thorough* (a meaning
 * search with the same words) is for. A quick 88 and a meaning 88 are
 * different numbers; the run's `kind` says which one this is.
 *
 * ## Not streamed, so one clock
 *
 * The Decisions endpoint answers in one body, so there is no stall to watch
 * for — only a deadline (`QUICK_TIMEOUT_MS`). The hits are yielded together
 * after the last chunk returns, then `done`.
 *
 * ## Logging
 *
 * One line per finished search under the `model` component, as src/search.ts
 * does. **Never the criterion, never a block's text, never the key** — only
 * counts, ids-free.
 */
import {
  type DecisionCall,
  type DecisionQuestion,
  ProviderRefused,
  UnreadableAnswer,
  openRouterDecisions,
} from "./ai-call.js";
import { isSearchable } from "./block-policy.js";
import { errorFields, log, since } from "./log.js";
import { PROVIDER_UNREADABLE, tookTooLong } from "./messages.js";
import { QUICK_SEARCH_MODEL } from "./models.js";
import { MAX_HITS, type SearchEvent, type SearchResult } from "./search.js";
import type { Block, Meta, SearchHit } from "./types.js";

/**
 * The probability a block must reach to be a hit. **Inclusive**, and the cap
 * (`MAX_HITS`, best first) does the rest.
 *
 * There is no natural break in Jev's scores: the top ten bunch at 0.85–0.94,
 * and a cut at 0.5 let in 34 blocks for one query and 255 of 542 for another,
 * because the whole article was about it. The plan said 0.8, measured on the
 * arm with the "meaning, not words" sentence; re-measured on the plain wording
 * this file sent then, 0.8 kept only about 52% of the meaning search's hits
 * against 73% at 0.7 before the cap, and the passages between 0.7 and 0.8 were nearly
 * all genuine. docs/investigations/261002o-quick-search-spike.md § threshold,
 * and evals/results/quick-search-spike-2026-10-02/floor-summary.json.
 *
 * **Re-measured on 2026-10-03 with the "mention or discuss" wording, and kept.**
 * On the same 16 queries 0.7 keeps 0.78 of the meaning search's hits (0.82 at
 * 0.65, 0.76 at 0.75, 0.65 at 0.8). On 18 short-topic queries floors of 0.6
 * and 0.65 find no more literal targets (17 of 141 opportunities missed at
 * 0.6 and at 0.7; 29 at 0.75) and let in more wrong blocks. At 0.5, 14 are
 * missed, with more junk and unjudged hits. The six absent-topic controls top
 * out at 0.04–0.11, so the floor returns nothing for them; a floor relative
 * to the top score would not. Investigation 261003c.
 */
export const QUICK_FLOOR = 0.7;

/**
 * The floor used **only when nothing reaches `QUICK_FLOOR`**, and the most a
 * search may show when it is. Inclusive, best first.
 *
 * Feedback `spya-jp5nxn`, 2026-10-03: "results" on a paper found nothing. Its
 * best paragraphs scored 0.52–0.57 and were the right ones. A bare word that
 * names a kind of passage or a field ("results", "examples", "linear algebra")
 * scores the passages that are instances of it under 0.7: on 37 such queries
 * over four articles, 62 of 111 searches came back empty. With this fallback
 * 50 of the 62 show something; 71% of what they show was judged right, blind,
 * by the stricter of two judges, and the top result on 36 of 50.
 * docs/investigations/261003f-quick-search-category-words-score-under-the-floor.md.
 *
 * - **Only when empty**, so it cannot change a search that finds anything:
 *   none of the 150 runs investigation 261003c saved is touched. A lower floor
 *   for everybody, and topping up a short list, both add known wrong blocks to
 *   searches that already work.
 * - **0.5, not 0.55**: at 0.55, 28 of the 62 stay empty (80% right); at 0.45,
 *   64% right. Of 25 absent and near-miss topics (75 searches), 71 still
 *   return nothing at 0.5; the rest show 1–4 wrong blocks.
 * - **8, not `MAX_HITS`**: the cap buys no precision (73% right at three, 71%
 *   at eight, 69% at twenty), so it is set where a weak list stays short.
 */
export const QUICK_FALLBACK_FLOOR = 0.5;
export const QUICK_FALLBACK_HITS = 8;

/**
 * How long the whole search may take, every chunk included.
 *
 * The spike's p90 was 0.5 s on a typical article and 0.9 s on a 542-block one,
 * so this is about twenty times the slow case — long enough never to fire on a
 * healthy endpoint, short enough that a hung one is reported rather than left
 * spinning on a feature whose whole promise is speed.
 */
export const QUICK_TIMEOUT_MS = 20_000;

/**
 * Estimated tokens per request, under Jev's 32k context with room to spare for
 * the estimate being wrong. A chunk past the real limit is refused with
 * `max_tokens_exceeded` and halved (`MAX_HALVINGS`), so the estimate only has
 * to be right most of the time.
 */
export const CHUNK_TOKEN_BUDGET = 26_000;

/** The spike's estimate: characters ÷ 3.2. Conservative for English prose. */
const CHARS_PER_TOKEN = 3.2;

/** What one question costs on top of its passage: its own wording and key. */
const TOKENS_PER_QUESTION = 30;

/** The state's framing and the query, charged once per request. */
const TOKENS_PER_REQUEST = 200;

/**
 * How many times a chunk may be halved after an overflow. Three halvings take a
 * 26k chunk to about 3k; anything still refused at that size is not a length
 * problem, and asking again would only spend.
 */
const MAX_HALVINGS = 3;

export interface QuickSearchRequest {
  /** Taken for parity with `SearchRequest`; the request sends no title. */
  meta: Meta;
  blocks: Block[];
  /** What the reader typed. */
  criterion: string;
  signal?: AbortSignal;
  /** Overridable so a test can use a deadline it can wait for. */
  timeoutMs?: number;
}

/** What turning answers into hits threw away, so the log can say so. */
export interface QuickDropped {
  /** Answers naming a block that was not asked about. */
  unknownIds: number;
  /** Hits beyond `MAX_HITS`. */
  truncated: number;
}

/**
 * The blocks worth asking about: searchable (`isSearchable`, the predicate
 * that decides whether a search hit may be shown at all — so notes stay in,
 * which is Greg's policy), with text, **and not headings**.
 *
 * Headings are dropped here rather than by that predicate, because they *are*
 * searchable — a meaning search may land on one — and the reason to drop them
 * is Jev's, not the policy's: it scored the article's title 0.85–0.90 against
 * any query about the piece (spike 261002o § Junk), which would put the title
 * at the top of every quick search.
 */
export function quickBlocks(blocks: Block[]): Block[] {
  return blocks.filter((b) => isSearchable(b) && b.kind !== "heading" && b.text.trim() !== "");
}

/** One block's estimated share of a request: its passage plus its question. */
export function estimateTokens(block: Block): number {
  return Math.ceil(block.text.length / CHARS_PER_TOKEN) + TOKENS_PER_QUESTION;
}

/**
 * Split the blocks into requests of at most `budget` estimated tokens, in
 * order. A block bigger than the budget on its own gets a request of its own
 * rather than being dropped — the overflow halving cannot split one block, so
 * that request may be refused, but silently not asking about a passage would be
 * the worse failure.
 */
export function chunkBlocks(blocks: Block[], budget: number = CHUNK_TOKEN_BUDGET): Block[][] {
  const chunks: Block[][] = [];
  let current: Block[] = [];
  let used = TOKENS_PER_REQUEST;
  for (const block of blocks) {
    const cost = estimateTokens(block);
    if (current.length > 0 && used + cost > budget) {
      chunks.push(current);
      current = [];
      used = TOKENS_PER_REQUEST;
    }
    current.push(block);
    used += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * The one question. On the eval's full-article "Buddhism" runs, the target
 * scored 0.70–0.75 with *match* and 0.96 with *mention or discuss*
 * (investigation 261003c, which is where to go before changing a word of it).
 */
function questionFor(id: string): DecisionQuestion {
  return {
    type: "noul",
    instructions: `Does passage ${id} mention or discuss what the reader is looking for (query)?`,
  };
}

/**
 * Probabilities to hits: at or above `QUICK_FLOOR`, best first (ties in the
 * article's order, so a re-render does not shuffle them), capped at
 * `MAX_HITS`. **When none reaches it**, those at or above
 * `QUICK_FALLBACK_FLOOR` instead, capped at `QUICK_FALLBACK_HITS`, and
 * `fallback` says so. `asked` is every block a question was sent about; an
 * answer for anything else is ignored and counted. A block with no answer is
 * simply not a hit here — `askChunk` has already refused a reply that left one
 * unanswered, so on the real path there is none.
 */
export function hitsFrom(
  noul: Record<string, number>,
  asked: Block[],
): { hits: SearchHit[]; dropped: QuickDropped; fallback: boolean } {
  const dropped: QuickDropped = { unknownIds: 0, truncated: 0 };
  const order = new Map(asked.map((b, i) => [b.id, i]));
  for (const id of Object.keys(noul)) if (!order.has(id)) dropped.unknownIds++;

  const atOrAbove = (floor: number) => {
    const out: { block: Block; p: number; i: number }[] = [];
    asked.forEach((block, i) => {
      const p = noul[block.id];
      if (p !== undefined && p >= floor) out.push({ block, p, i });
    });
    return out;
  };
  let kept = atOrAbove(QUICK_FLOOR);
  let cap = MAX_HITS;
  let fallback = false;
  if (kept.length === 0) {
    kept = atOrAbove(QUICK_FALLBACK_FLOOR);
    cap = QUICK_FALLBACK_HITS;
    fallback = kept.length > 0;
  }
  kept.sort((x, y) => y.p - x.p || x.i - y.i);
  if (kept.length > cap) {
    dropped.truncated = kept.length - cap;
    kept.length = cap;
  }
  const hits = kept.map(({ block, p }) => ({
    blockId: block.id,
    /* The block's own text, so `findQuote` places it at 0 and the wash covers
       the paragraph — the honest extent of what was judged. */
    quote: block.text,
    confidence: Math.round(p * 100),
    reasoning: "",
    start: 0,
  }));
  return { hits, dropped, fallback };
}

/** A reply that left questions unanswered. Carries a count and nothing else. */
class IncompleteAnswer extends Error {
  constructor(readonly unanswered: number) {
    super(`the decisions answer left ${unanswered} question(s) unanswered`);
  }
}

/** Thrown when the reader left; src/search.ts says why it is not an `[ai-*]` sentence. */
const READER_LEFT = "The reader disconnected before this search finished.";

interface Tally {
  requests: number;
  halvings: number;
  inputTokens: number | null;
  outputTokens: number | null;
  answeredBy: string | null;
}

function add(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

/**
 * Ask about one chunk; on a context overflow, halve it and ask about both
 * halves in parallel, at most `MAX_HALVINGS` deep.
 *
 * **Every question must come back answered**, with a probability — the
 * gateway drops an answer that is not a number in [0, 1], so a missing key
 * here covers both "not answered" and "answered nonsense". Either fails the
 * whole search rather than leaving that block out: a reply that skipped the
 * one passage the reader wanted would otherwise be stored as a clean result
 * that simply did not find it, which nobody could tell from a true miss.
 *
 * A single block that still overflows, or a chunk still refused after
 * `MAX_HALVINGS`, ends the search with the refusal. Skipping that block and
 * carrying on was the alternative; a block past 32k tokens on its own is about
 * 100k characters, which no extracted paragraph has been, so the rarer case got
 * the simpler answer.
 */
async function askChunk(
  criterion: string,
  blocks: Block[],
  signal: AbortSignal,
  tally: Tally,
  cancel: AbortController,
  depth = 0,
): Promise<Record<string, number>> {
  tally.requests++;
  let call: DecisionCall;
  try {
    call = await openRouterDecisions(
      "search-quick",
      {
        model: QUICK_SEARCH_MODEL,
        state: {
          query: criterion,
          passages: Object.fromEntries(blocks.map((b) => [b.id, b.text])),
        },
        questions: Object.fromEntries(blocks.map((b) => [b.id, questionFor(b.id)])),
      },
      { signal },
    );
  } catch (err) {
    if (
      err instanceof ProviderRefused &&
      err.kind === "context-exceeded" &&
      blocks.length > 1 &&
      depth < MAX_HALVINGS
    ) {
      tally.halvings++;
      const half = Math.ceil(blocks.length / 2);
      const halves = [
        askChunk(criterion, blocks.slice(0, half), signal, tally, cancel, depth + 1),
        askChunk(criterion, blocks.slice(half), signal, tally, cancel, depth + 1),
      ];
      try {
        const [first, second] = await Promise.all(halves);
        return { ...first, ...second };
      } catch (failure) {
        /* An aggregate rejection does not settle its other half. Cancel the
           whole search now, then drain both children at every recursion level
           so no descendant's meter can finish after the collector closes. */
        cancel.abort(failure);
        await Promise.allSettled(halves);
        throw failure;
      }
    }
    throw err;
  }
  tally.inputTokens = add(tally.inputTokens, call.inputTokens);
  tally.outputTokens = add(tally.outputTokens, call.outputTokens);
  tally.answeredBy ??= call.answeredBy;
  const unanswered = blocks.filter((b) => call.noul[b.id] === undefined).length;
  if (unanswered > 0) throw new IncompleteAnswer(unanswered);
  /* Only this chunk's ids are this chunk's answers. An id from another chunk
     would otherwise overwrite that chunk's own score in the merge; dropping it
     here leaves `hitsFrom` nothing to count, so it is counted as unknown by
     keeping it under a key no block has. */
  const own = new Set(blocks.map((b) => b.id));
  const out: Record<string, number> = {};
  for (const [id, p] of Object.entries(call.noul)) out[own.has(id) ? id : `?${id}`] = p;
  return out;
}

/**
 * Score the article and yield the hits, then one `done` — the shape
 * `findPassagesStream` yields, so the route can take either.
 */
export async function* quickPassagesStream({
  blocks,
  criterion,
  signal,
  timeoutMs = QUICK_TIMEOUT_MS,
}: QuickSearchRequest): AsyncGenerator<SearchEvent> {
  const line = log("model");
  /* No key check of its own: the gateway refuses a missing key with the
     reader's sentence before it meters anything (src/ai-call.ts § `apiKey`),
     and a second check here would be a second file naming the credential —
     which tests/no-undeclared-spend.test.ts reads as a way to spend. */
  const asked = quickBlocks(blocks);
  if (asked.length === 0) {
    /* Nothing to judge is an answer, not a failure: "nothing in this article
       matches" — and it costs nothing to give. */
    yield { type: "done", result: { hits: [], model: QUICK_SEARCH_MODEL } };
    return;
  }

  const chunks = chunkBlocks(asked);
  const started = Date.now();
  const deadline = AbortSignal.timeout(timeoutMs);
  /* Aborted when any chunk fails, so the others stop rather than spending on
     an answer nobody will see. */
  const cancel = new AbortController();
  const composite = AbortSignal.any(
    signal ? [signal, deadline, cancel.signal] : [deadline, cancel.signal],
  );
  const tally: Tally = {
    requests: 0,
    halvings: 0,
    inputTokens: null,
    outputTokens: null,
    answeredBy: null,
  };

  let noul: Record<string, number>;
  const tasks = chunks.map((chunk) => askChunk(criterion, chunk, composite, tally, cancel));
  try {
    noul = Object.assign({}, ...(await Promise.all(tasks)));
  } catch (caught) {
    /* A nested split cancels immediately but drains before rejecting. Another
       chunk can therefore reject with AbortError first; retain the failure
       that caused cancellation rather than reporting its secondary symptom. */
    const err = cancel.signal.aborted ? cancel.signal.reason : caught;
    cancel.abort(err);
    /* Every chunk's meter finishes before this generator throws, so each row
       lands inside the caller's collector rather than as a late finish. */
    await Promise.allSettled(tasks);
    const facts = {
      model: QUICK_SEARCH_MODEL,
      ms: since(started),
      chunks: chunks.length,
      requests: tally.requests,
      halvings: tally.halvings,
    };
    /* The composite keeps the first abort's reason. Cleanup can outlast the
       deadline or a later disconnect; neither should rename an earlier
       provider failure as a timeout or abandonment. */
    if (signal?.aborted && composite.reason === signal.reason) {
      line.info(facts, "quick search was abandoned");
      throw new Error(READER_LEFT);
    }
    if (deadline.aborted && composite.reason === deadline.reason) {
      line.error({ ...facts, timedOut: true }, `no answer from ${QUICK_SEARCH_MODEL} — deadline fired`);
      throw new Error(tookTooLong(Math.round(timeoutMs / 1000)).message);
    }
    if (err instanceof ProviderRefused) {
      /* The status and our own classification, never the body: it may echo
         the article back. */
      line.error(
        { ...facts, status: err.status, refusal: err.kind },
        `OpenRouter refused: ${err.status}`,
      );
      throw err;
    }
    if (err instanceof UnreadableAnswer) {
      line.error(facts, `${QUICK_SEARCH_MODEL}'s answer could not be read`);
      throw new Error(PROVIDER_UNREADABLE.message, { cause: "no-answers" });
    }
    if (err instanceof IncompleteAnswer) {
      line.error(
        { ...facts, unanswered: err.unanswered },
        `${QUICK_SEARCH_MODEL} left questions unanswered`,
      );
      throw new Error(PROVIDER_UNREADABLE.message, { cause: "unanswered" });
    }
    line.error({ ...errorFields(err), ...facts }, `quick search with ${QUICK_SEARCH_MODEL} failed`);
    throw err;
  }

  const { hits, dropped, fallback } = hitsFrom(noul, asked);
  const model = tally.answeredBy ?? QUICK_SEARCH_MODEL;
  try {
    line.info(
      {
        model,
        ms: since(started),
        chunks: chunks.length,
        requests: tally.requests,
        halvings: tally.halvings,
        inputTokens: tally.inputTokens,
        outputTokens: tally.outputTokens,
        hits: hits.length,
        fallback,
        criterionChars: criterion.length,
        blocks: asked.length,
        ...dropped,
      },
      `quick-searched an article with ${model} (${hits.length} passage${hits.length === 1 ? "" : "s"})`,
    );
  } catch {
    // Nothing worth failing a reader's search over.
  }

  for (const hit of hits) yield { type: "hit", hit };
  const result: SearchResult = {
    hits,
    model,
    usage: {
      promptTokens: tally.inputTokens,
      completionTokens: tally.outputTokens,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    },
  };
  yield { type: "done", result };
}
