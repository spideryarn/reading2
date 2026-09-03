/**
 * **One article's blocks as vectors**, embedded once and kept for a moment.
 *
 * Two features want the same thing from the same article and neither should
 * have to know about the other: [similar.ts](similar.ts) wants the cosines
 * between passages (the Force picture's dotted lines), and
 * [projection.ts](projection.ts) wants the vectors themselves (the Drift and
 * Trail pictures' coordinates). Both embed the same paragraphs of the same
 * article with the same model, and there is no reason for that to be bought
 * twice.
 *
 * The design is that the *purchase* lives here and the *answers* live with
 * whoever computes them. Two answer-caches, deliberately, because they have
 * completely different shapes: a few hundred pairs is nothing and can be kept
 * for a dozen articles, where 276 × 1024 float64 is 2MB and cannot.
 *
 * ## **Today only `projection.ts` uses it, and that is a debt rather than a design**
 *
 * `similar.ts` still calls `embedAll` itself. It was being written by somebody
 * else in the same tree on the same afternoon, and reaching into a file
 * mid-flight to save a fifth of a cent is how two people's work gets lost — so
 * the seam was built and only one side was wired to it. **The cost, stated
 * rather than left to be discovered: a reader who opens Force and then Drift on
 * a cold article pays about $0.0015 and four seconds twice.**
 *
 * The move is small — `compute` in `similar.ts` replaces its own `embeddable`
 * plus `embedAll` with one call to `articleVectors` — and the only care it needs
 * is that its `eligible` count comes from `SkipCounts` instead. Flagged by GPT
 * Sol reviewing the built code, 2026-08-27, and it was right to: this file's
 * header claimed the sharing as a fact before it was one.
 *
 * ## What counts as embeddable is a rule, not a filter each caller writes
 *
 * It was written twice, once here in spirit and once in `similar.ts`, and the
 * two would have drifted the first time either was tuned — at which point the
 * dotted lines on Force and the dots on Drift would be about *different sets of
 * paragraphs* while both said "the article". That is not a bug anything would
 * report.
 *
 * ## The row index is the row in the WHOLE article
 *
 * Not the index in this filtered list. Everything downstream reasons about
 * reading order — `similar.ts` excludes immediate neighbours, `projection.ts`
 * puts the article down the page — and computing either over a compacted list
 * would make two paragraphs adjacent because everything between them was too
 * short to embed.
 *
 * ## Why the cache is in memory, again
 *
 * Same answer `similar.ts` gives and it has not changed: persisting vectors
 * needs pgvector, a migration, a re-embed-on-change rule and a place in the
 * pipeline, which is the substance of docs/plans/260826n-semantic-search.md. A diagram
 * toggle wanting a cache is not a good reason to settle it early. **When that
 * plan lands, this is the one file that changes.**
 *
 * On Vercel a request may always be a new process, so a cold cache is the
 * *normal* case rather than the unlucky one. The cost of being wrong is known:
 * about $0.002 and a second or two per article.
 */
import type { Block, BlockId, SkipCounts } from "./types.js";
import { EMBEDDING_MODEL, EmbeddingFailure, embedAll } from "./embeddings.js";
import { isEmbeddable } from "./block-policy.js";
import { hashBlocks } from "./source-hash.js";
import { log } from "./log.js";
import { processSingleton } from "./process-state.js";

/**
 * The shortest passage worth a vector.
 *
 * A three-word heading embeds fine and then sits at cosine 0.8 from every other
 * three-word heading, because what they have in common is being short. The
 * tf-idf graph had the same bug in the other measure (`MIN_TERMS_FOR_EDGE` in
 * src/web/graph.ts, put there by a Victorian pamphlet's title page); it is the
 * same mistake and it is worth refusing twice.
 *
 * The visible consequence, which the pictures have to own: **headings are
 * mostly not dots**, and the dots do not tile the article.
 */
export const MIN_WORDS = 12;

/**
 * A ceiling on what one request will pay to embed.
 *
 * Not a performance guard — a **spending** one. Nothing else in this app turns
 * a toggle press into a model call without a button that says so, and the
 * honest mitigation for that is a bound the reader cannot exceed by holding the
 * toggle down. 1,500 blocks is far above every article in the corpus (the
 * longest is 360) and about $0.01. Past it the article is embedded up to the
 * ceiling and the answer says how many were left out.
 */
export const MAX_BLOCKS = 1500;

/**
 * The most characters of any one block to send.
 *
 * A per-input ceiling rather than only a per-article one. Blocks are
 * paragraphs, so this never bites on a well-extracted article — but extraction
 * can go wrong, and a single "paragraph" that is the whole document is a
 * plausible failure of stage 2. Without this, one bad block is one enormous
 * billable request that also blows the model's own context limit and fails.
 *
 * Truncated rather than dropped: the first 8,000 characters of a passage still
 * say what it is about, which is all any of this asks of it.
 *
 * **It lives here rather than in each caller, and that is the point of this
 * module.** It began in `similar.ts`; the first draft of this file kept the
 * *filter* and left the truncation behind, which would have made one malformed
 * article fail — or overspend — on Drift and Trail while Force was fine. GPT
 * Sol's finding, 2026-08-27. The rule is: whatever decides the bytes that go to
 * the model belongs to the module that buys them.
 */
export const MAX_CHARS = 8000;

/**
 * What the cache key says about *how* these vectors were made.
 *
 * The source hash says what the article says; this says what we did to it
 * before asking. Change the model, the input type, the length cap or the
 * minimum, and yesterday's vectors are still perfectly good vectors of
 * something else. Bumping this string is how that miss happens on purpose.
 */
const RECIPE = `${EMBEDDING_MODEL}/document/${MIN_WORDS}w/${MAX_CHARS}c/body`;

/**
 * How much to keep, counted in **floats rather than articles**.
 *
 * A count of articles is the obvious cap and it is the wrong unit here. A
 * `SimilarResponse` is a few hundred pairs whatever the article; this is the
 * vectors themselves, and one article can be 276 × 1024 or 1,500 × 1024 — a
 * factor of five. "Four articles" reads as about 12MB and is 49MB at the
 * ceiling `MAX_BLOCKS` actually permits. GPT Sol's finding, 2026-08-27.
 *
 * 2.5M floats is about 20MB of float64, which is a few of the longest articles
 * in this corpus or one pathological one. Eviction is insertion-ordered: `Map`
 * iterates in insertion order, so the first key is the oldest.
 */
const MAX_FLOATS = 2_500_000;

/**
 * How many articles may be being embedded at the same moment.
 *
 * **A bound on concurrency, and therefore a second bound on spending.** The
 * per-key sharing below stops N readers of *one* article buying N copies; it
 * says nothing about one reader moving quickly through twenty articles, each of
 * which starts a request that nobody cancels and every one of which is paid
 * for. GPT Sol's finding, 2026-08-27.
 *
 * Four is generous for a beta whose readership is one person, and it is the
 * number that makes the failure *loud*: past it the request is refused with a
 * sentence, rather than queued behind work the reader has already navigated
 * away from. A refusal a reader can retry beats a spinner over an unbounded
 * queue.
 */
const MAX_INFLIGHT = 4;

/** One embeddable block, with where it sits in the article. */
interface VectorRow {
  id: BlockId;
  /** Its index in the article's own `blocks` array — document order. */
  row: number;
}

export interface ArticleVectors {
  model: string;
  /** The blocks that got a vector, in document order. */
  rows: VectorRow[];
  /**
   * One unit-length vector per entry of `rows`, same order.
   *
   * **Normalised here rather than by each caller.** Cosine is the geometry
   * these were trained for, nothing promises the provider returns unit vectors,
   * and a caller that assumes they are and is wrong gets a similarity measure
   * that quietly rewards long passages.
   */
  vectors: number[][];
  /**
   * How many of the article's blocks were not embedded, split by reason.
   *
   * The shape is `SkipCounts` in src/types.ts, because the browser reads the
   * same three numbers off the projection response and there should be one
   * definition of what they mean.
   */
  skipped: SkipCounts;
}

/** `${slug}:${hashBlocks(blocks)}:${RECIPE}` → the vectors. */
const CACHE = new Map<string, ArticleVectors>();
/**
 * The same key → the request in flight, so N readers do not buy N copies.
 *
 * **Kept on the process rather than the module, and here it guards two things.**
 * A Vite reload re-evaluates every server module inside the *same* process
 * without cancelling the request in flight
 * ([process-state.ts](process-state.ts)). A plain module-scope map is empty in
 * the second copy, so the next reader buys a second set of embeddings while the
 * first is still being paid for — **and `MAX_INFLIGHT` is counted off this map,
 * so a second copy silently doubles the cap** from four concurrent articles to
 * eight. `CACHE` above stays module-scope on purpose: a duplicated cache is a
 * cold cache, which costs a lookup, not a call.
 *
 * Found by GPT Sol reviewing
 * docs/plans/260903d-improve-the-codebase-second-sweep.md § T2.2.
 */
const INFLIGHT = processSingleton<Map<string, Promise<ArticleVectors>>>(
  "article-vectors.inflight",
  "2026-09-03-map",
  () => new Map(),
);

/**
 * The blocks worth embedding, with their positions kept.
 *
 * Exported because both callers want to reason about the same set, and because
 * a test that has to reach through a network call to find out which blocks were
 * chosen is a test nobody writes.
 */
export function embeddable(blocks: readonly Block[]): {
  items: { row: number; block: Block }[];
  skipped: SkipCounts;
} {
  const items: { row: number; block: Block }[] = [];
  const skipped: SkipCounts = { nonProse: 0, tooShort: 0, capped: 0 };
  for (const [row, block] of blocks.entries()) {
    /* **What a block IS comes first, and the budget second.** The other order
       reads more naturally and is wrong: past the ceiling it charges every
       remaining block to the cap, so an article that ends in forty headings
       reports forty paragraphs lost to our budget when they were never
       eligible. The reader is shown these numbers, and one of them is about
       their article while the other is about our wallet. GPT Sol's finding,
       2026-08-27. */
    /* `isEmbeddable`, not `gistable`: a footnote is prose and would embed
       perfectly well, and that is the problem — a hundred endnotes in the pool
       make every "related passage" answer about the bibliography. Counted as
       `nonProse` because that is the bucket the reader is shown and a note is
       not something our budget cost them. src/block-policy.ts. */
    if (!isEmbeddable(block)) {
      skipped.nonProse++;
      continue;
    }
    if (block.words < MIN_WORDS) {
      skipped.tooShort++;
      continue;
    }
    if (items.length >= MAX_BLOCKS) {
      // Counted rather than broken out of, so the answer can say how much of
      // the article the ceiling cost rather than only that it was reached.
      skipped.capped++;
      continue;
    }
    items.push({ row, block });
  }
  return { items, skipped };
}

/**
 * Embed an article's blocks, or return the ones already bought.
 *
 * Cached by slug, **by what the blocks say**, and by `RECIPE`, so a re-ingest
 * that rewrites the prose misses rather than serving vectors for text that is
 * gone, and a change of model or of length cap misses rather than serving
 * yesterday's vectors of something slightly different. A slug alone would be
 * the version of this cache that is wrong exactly when it matters.
 *
 * ## There is no `AbortSignal`, and that is the fix rather than an omission
 *
 * The obvious shape is to take the caller's signal and pass it to the fetch.
 * With one shared promise that is a trap: the *first* caller owns the
 * cancellation, so when they navigate away every later waiter's request dies
 * too — including one from a reader who is still looking at the picture. GPT
 * Sol's finding, 2026-08-27.
 *
 * The alternative to reference-counting waiters is to notice that there is
 * nothing worth cancelling. The work is a bounded model call that already has
 * its own deadline (`REQUEST_TIMEOUT_MS` in src/embeddings.ts), it is a second
 * or two, and its result is **cached** — so a request nobody is waiting for any
 * more is not wasted, it is paid for early. An abandoned reader's HTTP response
 * goes nowhere; the vectors stay.
 */
export async function articleVectors(
  slug: string,
  blocks: readonly Block[],
): Promise<ArticleVectors> {
  const key = `${slug}:${hashBlocks(blocks)}:${RECIPE}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  /* **One request per cold article, not one per reader.** Two tabs opening a
     picture that needs this at the same moment is the ordinary case, not the
     unlucky one, and without this they each embed the whole article and each
     pay for it. */
  const flying = INFLIGHT.get(key);
  if (flying) return flying;
  if (INFLIGHT.size >= MAX_INFLIGHT) {
    /* Deliberately a throw rather than a queue — see `MAX_INFLIGHT`.
       **`busy`, which is not `provider`**: nothing upstream has been asked
       anything. This is our own admission control, and calling it the
       provider's fault — which the old string-prefix classification did, by
       matching `"busy:"` alongside `"embeddings "` — would put our own back
       pressure on somebody else's status page. ⟨Sol⟩, 2026-08-28. */
    throw new EmbeddingFailure(
      "busy",
      `busy: ${MAX_INFLIGHT} articles are already being embedded`,
    );
  }

  const work = compute(slug, blocks, key).finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, work);
  return work;
}

async function compute(
  slug: string,
  blocks: readonly Block[],
  key: string,
): Promise<ArticleVectors> {
  const { items, skipped } = embeddable(blocks);
  if (items.length === 0) {
    const empty: ArticleVectors = { model: EMBEDDING_MODEL, rows: [], vectors: [], skipped };
    remember(key, empty);
    return empty;
  }

  const started = Date.now();
  const { vectors, usage } = await embedAll(
    items.map((i) => i.block.text.slice(0, MAX_CHARS)),
    // `"document"` because these are passages being searched, not a search
    // string. Voyage's vectors differ measurably by this flag — src/embeddings.ts.
    { inputType: "document" },
  );

  const answer: ArticleVectors = {
    model: EMBEDDING_MODEL,
    rows: items.map((i) => ({ id: i.block.id, row: i.row })),
    vectors: vectors.map(unit),
    skipped,
  };
  /* Never the article's prose, never a term — the rule in
     docs/project/logging.md. Counts, money and milliseconds only. */
  log("model")
    .child({ slug, model: EMBEDDING_MODEL })
    .info(
      {
        embedded: items.length,
        ...skipped,
        promptTokens: usage.promptTokens,
        costUsd: Number(usage.cost.toFixed(6)),
        ms: Date.now() - started,
      },
      "embedded an article's blocks",
    );
  remember(key, answer);
  return answer;
}

/**
 * A copy of `v` scaled to length 1, or `v` itself when it has no length.
 *
 * A zero vector cannot be normalised and must not become `NaN`s: one of those
 * poisons a mean, which poisons every principal component, which renders a
 * picture of nothing at all with no error anywhere. It should not happen — a
 * twelve-word passage does not embed to zero — but "should not happen" is how
 * that class of bug gets in.
 */
function unit(v: readonly number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum);
  if (!Number.isFinite(n) || n === 0) return [...v];
  return v.map((x) => x / n);
}

function remember(key: string, answer: ArticleVectors): void {
  CACHE.set(key, answer);
  let held = 0;
  for (const v of CACHE.values()) held += v.rows.length * (v.vectors[0]?.length ?? 0);
  while (held > MAX_FLOATS && CACHE.size > 1) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    const going = CACHE.get(oldest);
    held -= (going?.rows.length ?? 0) * (going?.vectors[0]?.length ?? 0);
    CACHE.delete(oldest);
  }
}

/*
 * **`isProviderFailure` used to live here, and it was a string match.**
 *
 * The route needs to know whose fault a failure is, and it cannot guess: every
 * failure inside `projectArticle` was once rewritten as "could not reach the
 * embedding model", so a bug in the principal-components arithmetic would have
 * been logged, and shown to the reader, as an upstream outage. GPT Sol's
 * finding, 2026-08-27, and the guard it asked for was
 *
 *     message.startsWith("embeddings ") || message.startsWith("busy:")
 *
 * — right about the shape and wrong about the mechanism. A classification that
 * depends on wording is only as good as the wording, and it was not good
 * enough: a `fetch` that never connected threw a bare `TypeError`, matched
 * neither prefix, and reached the catch-all as an unexplained 500. It also
 * could not tell this module's own back pressure from the provider's.
 *
 * `EmbeddingFailure` in [embeddings.ts](embeddings.ts) carries a `reason`
 * instead, so the route asks `instanceof` and reads a field. ⟨Sol⟩, 2026-08-28.
 */
