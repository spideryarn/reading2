/**
 * **Which passages of one article are about the same thing**, by embedding.
 *
 * Greg, 2026-08-27:
 *
 * > when we generate the Force diagram, let's generate an embedding for each
 * > block, and add dotted links between the most similar blocks, to see what
 * > that does to the shape of the Force diagram.
 *
 * That is the whole brief, and the phrase to hold on to is *"to see what that
 * does"*. This is an experiment with a stated question — do embeddings group an
 * article differently from the tf-idf term overlap already drawn in
 * [src/web/graph.ts](web/graph.ts)? — and the two measures are put on the same
 * picture so the answer is visible rather than argued.
 *
 * ## Pairs come back, not vectors
 *
 * A 360-block article at 1024 dimensions is about 3MB of JSON. Sending that to
 * a browser so it can compute a dot product would be the wrong side of the
 * seam by two orders of magnitude. The cosine runs here — 360 blocks is 65,000
 * pairs, about 70M multiply-adds, tens of milliseconds — and what crosses the
 * wire is each block's few best neighbours.
 *
 * ## Adjacent blocks are excluded, and that is not tuning
 *
 * Two consecutive paragraphs of one argument are similar for a reason the Force
 * picture already draws, in thick, with an arrow on it. Left in, they would take
 * every one of the dotted lines and spend them re-stating reading order — the
 * measure would look like it worked and would have told the reader nothing.
 * `ADJACENT` below is the width of that exclusion.
 *
 * ## Why the cache is in memory
 *
 * Because persisting vectors is somebody else's decision. It needs pgvector, a
 * migration, a re-embed-on-change rule and a place in the pipeline, and all of
 * that is the substance of docs/plans/260826n-semantic-search.md. A diagram toggle
 * wanting a cache is not a good reason to settle it early, and a memory cache is
 * the version that can be deleted in one line when that plan lands.
 *
 * The cost of being wrong is small and known: a cold process re-embeds one
 * article for about $0.002 and a second or two. On Vercel, where a request may
 * always be a new process, that is the *normal* case rather than the unlucky
 * one — which is worth knowing before anyone reads a hit rate as a bug.
 */
import type { Block, SimilarPair, SimilarResponse, Tree } from "./types.js";
import { dot, EMBEDDING_MODEL, embedAll, normalise } from "./embeddings.js";
import { isEmbeddable } from "./block-policy.js";
import { hashBlocks, structureHash } from "./source-hash.js";
import { log } from "./log.js";
import { processSingleton } from "./process-state.js";

/**
 * How many pairs to send back — **the best ones in the article, globally.**
 *
 * The first version returned each block's own top three, on the reasoning that
 * a global cut would be won by whichever region of the article has the densest
 * vocabulary. GPT Sol showed that trades one problem for a worse one: per-block
 * K *censors*. A pair that is genuinely the best in the whole article can be
 * absent from the response because both of its blocks happened to have three
 * stronger neighbours each — and the client, which then sorts globally and
 * takes a handful, cannot recover what it was never sent.
 *
 * It gets worse downstream. The client drops pairs whose two blocks land in the
 * same section, so under per-block K those discarded pairs had already *spent*
 * a block's quota and taken nothing's place. The censoring and the filtering
 * compounded.
 *
 * All the pair scores are computed anyway, so a global ranking costs nothing
 * extra and has none of that. 240 is a deep enough pool that the client can
 * throw away same-section pairs, sequence duplicates and everything past its
 * own cap and still have candidates left.
 */
const POOL = 240;

/**
 * Blocks this close together are not allowed to form a pair.
 *
 * 1, not 0: only the immediately-neighbouring paragraph. Anything wider starts
 * deleting the finding rather than the noise — a callback four paragraphs later
 * is exactly the kind of thing this is meant to surface.
 */
const ADJACENT = 1;

/**
 * The shortest passage worth a vector.
 *
 * A three-word heading embeds fine and then sits at cosine 0.8 from every other
 * three-word heading, because what they have in common is being short. The
 * first version of the tf-idf graph had this bug in the other measure
 * (`MIN_TERMS_FOR_EDGE` in src/web/graph.ts, put there by a Victorian
 * pamphlet's title page); it is the same mistake and it is worth refusing twice.
 */
const MIN_WORDS = 12;

/**
 * A ceiling on what one request will pay to embed.
 *
 * Not a performance guard — a **spending** one. Nothing else in this app turns a
 * toggle press into a model call without a button that says so, and the honest
 * mitigation for that is a bound the reader cannot exceed by holding the toggle
 * down. 1,500 blocks is far above every article in the corpus (the longest is
 * 360) and about $0.01. Past it, the article is embedded up to the ceiling and
 * the response says how many were left out rather than silently truncating.
 */
const MAX_BLOCKS = 1500;

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
 * say what it is about, which is all this measure asks of it.
 */
const MAX_CHARS = 8000;

/**
 * **Which section each row belongs to**, deepest first, straight off the tree.
 *
 * The server has to know this, and the first version of this file thought it
 * did not. The reasoning was that the picture draws sections and the server
 * only knows blocks, so let the client map the pairs afterwards — which is
 * true, and is why the client still does its own filtering. What it missed is
 * that the *pool* is chosen here. GPT Sol's probe: a 52-block article produced
 * **240 same-section pairs at score 1.0 and not one cross-section pair**, so
 * the entire response was made of findings the client was about to discard, and
 * the picture reported that nothing useful came back. A globally-ranked pool of
 * the wrong candidates is worse than per-block K, because it fails completely
 * rather than partially.
 *
 * So same-section pairs are excluded **before** the ranking. Computed from the
 * tree's ranges rather than from `src/web/tree.ts`, which is client code — and
 * from the *full* tree, since collapse is a thing only the reader's browser
 * knows about. The client drops what collapse changes on top of this.
 */
function sectionOfRow(tree: Tree, blocks: readonly Block[]): (number | null)[] {
  const rowOf = new Map<string, number>();
  for (const [row, b] of blocks.entries()) if (!rowOf.has(b.id)) rowOf.set(b.id, row);

  const out: (number | null)[] = new Array(blocks.length).fill(null);
  const depthOf: number[] = new Array(blocks.length).fill(-1);
  let n = 0;
  for (const node of Object.values(tree.nodes)) {
    // The root spans everything and would put every row in one section, which
    // would exclude every pair in the article.
    if (node.depth === 0) continue;
    const from = rowOf.get(node.range[0]);
    const to = rowOf.get(node.range[1]);
    if (from === undefined || to === undefined) continue;
    const id = n++;
    for (let r = from; r <= to && r < blocks.length; r++) {
      // Deepest wins, since sections nest inside parts.
      if (node.depth > (depthOf[r] ?? -1)) {
        depthOf[r] = node.depth;
        out[r] = id;
      }
    }
  }
  return out;
}

/**
 * Bumped whenever anything that decides the *answer* changes — the model, the
 * eligibility rules, the pool size, the truncation.
 *
 * ⟨Sol⟩ `hashBlocks` hashes only each block's id and text, so a change to
 * `MIN_WORDS` or to `gistable` handling would leave a cached answer that was
 * computed under the old rules looking perfectly current. The recipe is part of
 * the identity of the result, not just the prose.
 *
 * `v2` → `v3` on 2026-08-28, when eligibility moved from `gistable` to
 * `isEmbeddable` and footnotes left the pool. `hashBlocks` now carries `role`
 * and `treatment` (src/source-hash.ts), so the fingerprint *does* move for an
 * article re-extracted with roles — but not for one whose blocks were stored
 * before roles existed, which is exactly the corpus this bump is for.
 */
const RECIPE = `v3:${EMBEDDING_MODEL}:${MIN_WORDS}:${MAX_BLOCKS}:${MAX_CHARS}:${POOL}:${ADJACENT}`;

/** `${slug}:${recipe}:${blocks}:${structure}` → the answer. */
const CACHE = new Map<string, SimilarResponse>();
/**
 * The same key → the request in flight, so N readers do not buy N copies.
 *
 * **Kept on the process rather than the module, because that sentence is about
 * money.** A Vite reload re-evaluates every server module inside the *same*
 * process without cancelling the request in flight
 * ([process-state.ts](process-state.ts)), so a plain module-scope map is empty
 * in the second copy and the next reader buys a second set of embeddings while
 * the first is still being paid for. `CACHE` above stays module-scope on
 * purpose: a duplicated cache is a cold cache, which costs a lookup, not a call.
 *
 * Found by GPT Sol reviewing
 * docs/plans/260903d-improve-the-codebase-second-sweep.md § T2.2.
 */
const INFLIGHT = processSingleton<Map<string, Promise<SimilarResponse>>>(
  "similar.inflight",
  "2026-09-03-map",
  () => new Map(),
);
/**
 * How many articles' answers to keep.
 *
 * Small on purpose. This is one `SimilarResponse` per article — a few hundred
 * pairs, not the vectors, which are dropped as soon as the cosines are computed
 * — so the memory is trivial either way, and the cap is here to stop an
 * unbounded map rather than to manage a budget. Insertion-ordered eviction:
 * `Map` iterates in insertion order, so the first key is the oldest.
 */
const MAX_CACHED = 12;

/**
 * The blocks worth embedding, with their positions kept.
 *
 * The index is the block's row in the **whole article**, not in this filtered
 * list — `ADJACENT` is a statement about reading order, and computing it over a
 * compacted list would make two paragraphs adjacent because everything between
 * them was too short.
 */
function embeddable(blocks: readonly Block[]): {
  items: { row: number; block: Block }[];
  eligible: number;
} {
  const items: { row: number; block: Block }[] = [];
  let eligible = 0;
  for (const [row, block] of blocks.entries()) {
    /* `isEmbeddable`, and the `v3` on `RECIPE` above is the other half of this
       edit rather than tidiness: this file's own comment says a change to
       `gistable` handling would leave a cached answer computed under the old
       rule looking perfectly current, because `hashBlocks` cannot see it. */
    if (!isEmbeddable(block)) continue;
    if (block.words < MIN_WORDS) continue;
    /* **Counted past the ceiling rather than stopped at it.** ⟨Sol⟩ The
       constant's own comment promised the response would say how many were left
       out, and the loop `break`ed, so it could not. A silent truncation reads
       as "we covered the article" — the failure
       docs/reusable/silent-success.md is about, and the one thing a bounded
       sweep must never do quietly. */
    eligible++;
    if (items.length < MAX_BLOCKS) items.push({ row, block });
  }
  return { items, eligible };
}

/**
 * Embed the article's blocks and return each one's nearest few.
 *
 * Cached by slug **and by what the blocks say**, so a re-ingest that rewrites
 * the prose misses rather than serving vectors for text that is gone. A slug
 * alone would be the version of this cache that is wrong exactly when it
 * matters.
 */
export async function similarBlocks(
  slug: string,
  blocks: readonly Block[],
  tree: Tree,
): Promise<SimilarResponse> {
  const key = `${slug}:${RECIPE}:${hashBlocks(blocks)}:${structureHash(tree)}`;
  const hit = CACHE.get(key);
  if (hit) {
    /* **Re-inserted, which is what makes this an LRU rather than a FIFO.**
       `Map` iterates in insertion order and `remember` evicts the first key, so
       without this a heavily-read article is thrown out on schedule while
       something nobody has opened since survives. ⟨Sol⟩ — the doc called it an
       LRU and it was not one. */
    CACHE.delete(key);
    CACHE.set(key, hit);
    return hit;
  }
  /* **One request per cold article, not one per reader.** Two tabs opening the
     Force picture at the same moment is the ordinary case, not the unlucky one,
     and without this they each embed the whole article and each pay for it. */
  const flying = INFLIGHT.get(key);
  if (flying) return flying;

  const work = compute(slug, blocks, tree, key).finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, work);
  return work;
}

/**
 * **There is deliberately no `AbortSignal` here, and that is the point of this
 * note**, because "pass the caller's signal through" is the obvious thing and
 * it is wrong once the work is shared. Two readers coalesce onto one promise;
 * if the first one's signal reached the fetch, the *second* reader's answer
 * would be cancelled by the first one navigating away — a failure that happens
 * only under concurrency and looks like a flaky provider.
 *
 * The request is not unbounded as a result: `embedBatch` carries its own
 * deadline (`REQUEST_TIMEOUT_MS` in src/embeddings.ts), which is the right
 * place for it, since it bounds the work rather than one caller's interest in
 * it.
 */
async function compute(
  slug: string,
  blocks: readonly Block[],
  tree: Tree,
  key: string,
): Promise<SimilarResponse> {
  const line = log("model").child({ slug, model: EMBEDDING_MODEL });
  const { items, eligible } = embeddable(blocks);
  const omitted = eligible - items.length;
  if (items.length < 2) {
    const empty = { model: EMBEDDING_MODEL, blocks: items.length, eligible, omitted, pairs: [] };
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

  const pairs = rankedPairs(items, vectors, sectionOfRow(tree, blocks));
  /* Never the article's prose, never a term — the rule in
     docs/project/logging.md. Counts, money and milliseconds only. */
  line.info(
    {
      embedded: items.length,
      eligible,
      omitted,
      tooShort: blocks.length - eligible,
      pairs: pairs.length,
      promptTokens: usage.promptTokens,
      costUsd: Number(usage.cost.toFixed(6)),
      ms: Date.now() - started,
    },
    "embedded an article for the similarity graph",
  );

  const answer = { model: EMBEDDING_MODEL, blocks: items.length, eligible, omitted, pairs };
  remember(key, answer);
  return answer;
}

/**
 * Every pair of passages, ranked, capped at `POOL`.
 *
 * O(n²) in the number of embedded blocks, which at 360 is 65,000 pairs and at
 * the `MAX_BLOCKS` ceiling is 1.1 million. Two things keep that honest:
 *
 *  - **The vectors are normalised once**, so the inner loop is a dot product
 *    rather than a cosine. `cosine` recomputes both norms every call, which
 *    over a million pairs is a million square roots of numbers that have not
 *    changed. GPT Sol's finding, 2026-08-27.
 *  - **The candidate list is truncated as it grows** rather than sorted at the
 *    end. A flat array of 1.1 million pair objects is tens of megabytes held to
 *    produce two hundred of them; trimming at a multiple of `POOL` keeps the
 *    peak flat and costs a handful of sorts.
 */
function rankedPairs(
  items: readonly { row: number; block: Block }[],
  vectors: readonly number[][],
  section: readonly (number | null)[],
): SimilarPair[] {
  const unit = vectors.map(normalise);
  let out: (SimilarPair & { rowA: number; rowB: number })[] = [];
  const trimAt = POOL * 8;

  const trim = () => {
    out.sort(byScore);
    out = out.slice(0, POOL);
  };

  for (let i = 0; i < items.length; i++) {
    const vi = unit[i];
    const from = items[i];
    // A passage with no direction — every component zero. It is not similar to
    // anything, and `normalise` says so with a null rather than a NaN.
    if (!vi || !from) continue;
    for (let j = i + 1; j < items.length; j++) {
      const to = items[j];
      const vj = unit[j];
      if (!to || !vj) continue;
      if (Math.abs(to.row - from.row) <= ADJACENT) continue;
      /* **Same section: not a finding, and not allowed to take a slot.** See
         `sectionOfRow` — this is the exclusion that has to happen before the
         ranking rather than after it. `null` means the tree covers neither row,
         which is not evidence that they are apart, so those pairs are kept. */
      const sa = section[from.row];
      const sb = section[to.row];
      if (sa !== null && sa !== undefined && sa === sb) continue;
      // i < j and rows are ascending, so `from` is always the earlier passage
      // and each unordered pair is visited exactly once. No dedupe needed.
      out.push({ a: from.block.id, b: to.block.id, score: dot(vi, vj), rowA: from.row, rowB: to.row });
    }
    if (out.length >= trimAt) trim();
  }
  trim();
  return out.map(({ rowA: _rowA, rowB: _rowB, ...p }) => p);
}

/**
 * Score first, then the rows — so two passages that really are equally alike
 * come out in the same order on every run. A picture that reshuffles between
 * two identical loads is the bug the whole determinism story in
 * src/web/diagram-d3.ts is about.
 */
function byScore(
  x: SimilarPair & { rowA: number; rowB: number },
  y: SimilarPair & { rowA: number; rowB: number },
): number {
  return y.score - x.score || x.rowA - y.rowA || x.rowB - y.rowB;
}

function remember(key: string, answer: SimilarResponse): void {
  CACHE.set(key, answer);
  while (CACHE.size > MAX_CACHED) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
}

/** Tests only — the cache is process-wide and a test must not inherit another's. */
export function clearSimilarCache(): void {
  CACHE.clear();
  INFLIGHT.clear();
}
