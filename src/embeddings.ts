/**
 * **Turning passages into vectors**, and the one place that does it.
 *
 * Lifted out of [evals/embedding-retrieval.ts](../evals/embedding-retrieval.ts)
 * rather than written again. That eval put four models over this project's own
 * articles — 18 reader-phrased queries, 221 judged `(query, passage)` pairs,
 * the whole thing judged twice by two different model families — and the
 * hard-won parts of its request code are not the request. They are the three
 * failure modes underneath it, and every one of them is invisible if you get it
 * wrong: a permuted response, a 404 that is an account setting rather than a
 * bad model id, and a 429 that means "busy" rather than "no".
 *
 * So the eval now imports this, and there is one implementation of all three.
 *
 * ## The model was chosen by measurement
 *
 * `voyageai/voyage-4`. It is statistically tied with `openai/text-embedding-3-small`
 * on every measure under both judges, it is 1024 dimensions rather than 1536,
 * and it bills to OpenRouter credits rather than through BYOK to Greg's own
 * OpenAI account — which is the tie-break, and the reason the arm with the best
 * point estimates is not the one used.
 * [evals/results/embedding-retrieval-2026-08-26.md](../evals/results/embedding-retrieval-2026-08-26.md)
 * has the tables; docs/plans/semantic-search.md has the argument.
 *
 * ## `input_type` is not optional, and withholding it is not neutral
 *
 * Voyage's API takes `"query"` on a search string and `"document"` on a
 * passage, and **OpenRouter passes it through**. The eval carried an untyped
 * arm specifically to measure the size of that choice: the vectors differ from
 * the typed ones at cosine 0.93, and the untyped arm scored lower under both
 * judges. A caller therefore has to say which it is asking for. There is no
 * default here on purpose — a silent default would be a measurable quality loss
 * that nothing reports.
 *
 * ## What this file does *not* do
 *
 * Store anything. Persisting vectors needs pgvector, a migration, and a rule
 * about re-embedding when an article changes; that is the substance of
 * docs/plans/semantic-search.md and it should not be settled by whichever
 * feature happens to want a cache first. Callers that want one keep it
 * themselves — src/similar.ts is the current example, and says so.
 */
import { loadEnvLocal } from "./env.js";
import { type JsonCall, ProviderRefused, openRouterJson } from "./ai-call.js";

/**
 * The measured winner. See the file header — this is a conclusion, not a
 * preference, and changing it means re-running `npm run eval:embeddings`.
 */
export const EMBEDDING_MODEL = "voyageai/voyage-4";

/**
 * How many texts go in one request.
 *
 * OpenRouter's cap is 2048; this is well under it, and deliberately so — a
 * failed batch is retried whole, so a big batch is a big thing to lose and a
 * big thing to pay for twice.
 */
export const BATCH = 96;

/**
 * How long one request may take before we stop waiting.
 *
 * A batch of 96 passages comes back in two or three seconds; 45 is generous
 * enough that a slow provider is not mistaken for a dead one, and short enough
 * that a dead one does not hold a server request open until something upstream
 * gives up.
 */
const REQUEST_TIMEOUT_MS = 45_000;

/** Attempts including the first. Four retries at the backoff below is about a minute. */
const MAX_ATTEMPTS = 5;

/**
 * **The ceiling on a whole `embedAll`, which is a different number from the
 * ceiling on one request — and the one that has to be under the platform's.**
 *
 * ⟨Sol⟩ The per-request timeout is 45s and there are up to 5 attempts with up
 * to 30s of backoff between them, so **one batch alone can take about 345
 * seconds** against a provider that keeps returning retryable errors with a
 * long `Retry-After`. Vercel caps a function at 300 (`vercel.json`), and
 * batches run one after another — so an article of 400 blocks had no bound at
 * all that was smaller than the platform's, and the failure mode is the worst
 * kind: the work is killed mid-way, having been paid for, with nothing written
 * and nothing said.
 *
 * 240 leaves the route a minute to load the article and to answer. Checked
 * between attempts *and* between batches, and the backoff sleep is abortable so
 * a deadline reached during one does not have to wait it out.
 */
const TOTAL_TIMEOUT_MS = 240_000;

/**
 * How long to wait before trying again.
 *
 * **`Retry-After` first, because the provider knows and we are guessing.** It
 * comes as either a number of seconds or an HTTP date, and both are in the
 * spec, so both are read. Clamped, so a header saying "an hour" does not park
 * a request for an hour.
 *
 * Otherwise exponential, with jitter. The jitter is not decoration: without it,
 * a batch loop that hits a rate limit retries all of its requests on exactly
 * the same schedule and hits it again together.
 */
function backoffMs(retryAfterMs: number | null, attempt: number): number {
  /* The provider's own `Retry-After`, already parsed to a number by
     `ProviderRefused` — a header, not a body, so nothing it carries came from
     us. */
  if (retryAfterMs !== null) return retryAfterMs;
  const base = 2000 * 2 ** (attempt - 1);
  return Math.min(30_000, base) * (0.75 + Math.random() * 0.5);
}

export interface EmbeddingUsage {
  promptTokens: number;
  /** OpenRouter's `cost_details.upstream_inference_cost`, in dollars. */
  cost: number;
}

export interface EmbedResult {
  vectors: number[][];
  usage: EmbeddingUsage;
}

/** Which end of a retrieval pair this text is. Never defaulted — see the header. */
export type InputType = "query" | "document" | null;

/**
 * One embeddings request.
 *
 * **The response is re-sorted by `index` rather than trusted in order.**
 * OpenRouter does not promise the order of `data[]`, and the failure if it ever
 * comes back permuted is invisible: every vector is a real vector, every cosine
 * is a real number, and the answer is simply wrong. This is the shape of bug
 * docs/reusable/silent-success.md is about.
 */
export async function embedBatch(
  model: string,
  input: string[],
  apiKey: string,
  inputType: InputType,
  signal?: AbortSignal,
  attempt = 1,
): Promise<EmbedResult> {
  /* **A deadline of our own, not just the caller's.** `fetch` has no timeout:
     a provider that accepts the connection and then says nothing holds this
     request — and, on a server, a socket and a Node handle — until something
     else gives up. `AbortSignal.any` keeps the caller's own signal working
     beside it, so navigating away still cancels. */
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  /* **The request, the status check and the spend record are one operation now**
     — src/ai-call.ts. This was the last call in the app making its own `fetch`,
     and the only one whose *input is article prose*, which is why the failure
     handling below changed shape as well as location. */
  let call: JsonCall;
  try {
    call = await openRouterJson(
      "embeddings",
      inputType ? { model, input, input_type: inputType } : { model, input },
      { signal: signal ? AbortSignal.any([signal, deadline]) : deadline, apiKey },
    );
  } catch (err) {
    if (!(err instanceof ProviderRefused)) throw err;
    /**
     * "No endpoints available matching your guardrail restrictions and data
     * policy" is a 404 and reads like a bad model id. It is neither: it is
     * **this OpenRouter account's privacy settings** refusing every upstream
     * that serves the model, and it is per-account, not per-key-holder.
     *
     * It cost an hour, so the message says the whole thing. Both Voyage models
     * 404 on the key exported in Greg's shell and answer 200 on the key in
     * `.env.local` — two different accounts, one of which has not opted in to
     * whatever Voyage's endpoints require. See src/env.ts for which key wins.
     *
     * Retrying cannot help — it is a setting, not a queue — so this fails fast
     * with instructions rather than backing off five times first.
     *
     * **`raw: ${body}` used to be the last line of this message and is gone.**
     * The provider's body is the one place an upstream may echo the request
     * back, and the request *here* is a batch of the article's own paragraphs —
     * so this error, thrown from a pipeline stage, could carry article prose
     * into a log that docs/project/logging.md forbids it from reaching. The
     * classification survives; only the sentence somebody else wrote is gone.
     * See `ProviderRefused.kind`.
     */
    if (err.kind === "no-endpoints") {
      throw new Error(
        `embeddings ${model}: OpenRouter has no endpoint this account may use.\n` +
          `This is an account setting, not a transient failure and not a bad model id.\n` +
          `  key in use: ${apiKey.slice(0, 12)}…\n` +
          `  fix: allow this model's providers at https://openrouter.ai/settings/privacy`,
      );
    }
    /* 429 and 5xx are the provider being busy, not the request being wrong, and
       they are common enough on a run of a few hundred blocks that failing on
       one would waste every batch already paid for. Back off and try again. */
    const retryable = err.status === 429 || err.status >= 500;
    if (retryable && attempt < MAX_ATTEMPTS) {
      const wait = backoffMs(err.retryAfterMs, attempt);
      /* **The sleep is abortable.** A deadline that only gets looked at between
         requests is not a deadline when the wait between them can be thirty
         seconds — the whole point is to stop *before* the platform does. */
      await sleep(wait, signal);
      if (signal?.aborted) throw new Error(`embeddings ${model}: gave up waiting`);
      return embedBatch(model, input, apiKey, inputType, signal, attempt + 1);
    }
    /* The status, not the body — same rule, same reason as the branch above. */
    throw new Error(`embeddings ${model}: ${err.status}`);
  }

  /* **Validated, not asserted.** `openRouterJson` returns `unknown` — a
     deliberate refusal to hand back a lie in a type's clothing — and the cast
     below is only safe because of this check. Without it a provider that
     answers 200 with an error envelope, or with something that is not JSON at
     all, reaches `body.data.length` and throws a raw `TypeError` naming a
     property, which tells whoever reads the pipeline failure nothing about what
     happened. Raised by a GPT Sol review. */
  /* **Validated, not asserted.** `openRouterJson` returns `unknown` — a
     deliberate refusal to hand back a lie in a type's clothing — and the cast
     below is only safe because of this check. Without it a provider that
     answers 200 with an error envelope, or with something that is not JSON at
     all, reaches `body.data.length` and throws a raw `TypeError` naming a
     property, which tells whoever reads the pipeline failure nothing about what
     happened. Raised by a GPT Sol review. */
  if (
    call.json === null ||
    typeof call.json !== "object" ||
    !Array.isArray((call.json as { data?: unknown }).data)
  ) {
    throw new Error(`embeddings ${model}: the response carried no vectors`);
  }
  const body = call.json as {
    data: { index: number; embedding: number[] }[];
    usage?: { prompt_tokens?: number; cost_details?: { upstream_inference_cost?: number } };
  };
  if (body.data.length !== input.length) {
    throw new Error(`embeddings ${model}: asked for ${input.length}, got ${body.data.length}`);
  }
  const vectors = readVectors(model, body.data, input.length);
  return {
    vectors,
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      /* Not `usage.cost`: for a BYOK model that field is 0, because OpenRouter
         charged nothing — the bill went to the caller's own upstream account.
         The real number is the upstream one. */
      cost: body.usage?.cost_details?.upstream_inference_cost ?? 0,
    },
  };
}

/**
 * Turn the response's `data[]` into vectors in the order they were asked for,
 * refusing anything that would silently produce a real-looking number.
 *
 * Its own function so that `embedBatch` reads as "make the request, handle the
 * failures, read the answer" rather than as one long block with a validation
 * suite in the middle of it.
 */
function readVectors(
  model: string,
  data: { index: number; embedding: number[] }[],
  count: number,
): number[][] {
  /* **Every one of these checks guards a failure that produces a real number.**
     That is the whole reason they are here rather than in a comment saying the
     provider is well-behaved: a duplicated `index`, an out-of-range one, a
     short vector or a `null` that JSON coerced to 0 all leave you with cosines
     that compute, sort and draw. Nothing throws, nothing looks wrong, and the
     picture is confidently about the wrong passages —
     docs/reusable/silent-success.md. GPT Sol's finding, 2026-08-27. */
  const vectors: number[][] = new Array<number[]>(count);
  let dims = 0;
  for (const d of data) {
    if (!Number.isInteger(d.index) || d.index < 0 || d.index >= count) {
      throw new Error(`embeddings ${model}: index ${d.index} is outside 0..${count - 1}`);
    }
    if (vectors[d.index]) throw new Error(`embeddings ${model}: index ${d.index} came back twice`);
    if (!Array.isArray(d.embedding) || d.embedding.length === 0) {
      throw new Error(`embeddings ${model}: no vector at index ${d.index}`);
    }
    // One dimensionality for the whole response. Mixed lengths would make
    // `cosine` compare a vector against the first N components of another.
    if (dims === 0) dims = d.embedding.length;
    else if (d.embedding.length !== dims) {
      throw new Error(
        `embeddings ${model}: index ${d.index} has ${d.embedding.length} dimensions, not ${dims}`,
      );
    }
    if (!d.embedding.every((x) => Number.isFinite(x))) {
      throw new Error(`embeddings ${model}: index ${d.index} contains a non-finite value`);
    }
    vectors[d.index] = d.embedding;
  }
  for (const [i, v] of vectors.entries()) {
    if (!v) throw new Error(`embeddings ${model}: no vector at index ${i}`);
  }
  return vectors;
}

/**
 * Every text, in batches, in order.
 *
 * `onProgress` rather than writing to stderr: this runs in a request path as
 * well as in an eval, and a library that prints is a library you cannot use
 * twice.
 */
export async function embedAll(
  texts: string[],
  opts: {
    model?: string;
    inputType: InputType;
    apiKey?: string;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<EmbedResult> {
  const model = opts.model ?? EMBEDDING_MODEL;
  const apiKey = opts.apiKey ?? apiKeyFromEnv();
  /* One clock for the whole sweep, however many batches it takes. See
     `TOTAL_TIMEOUT_MS`; combined with the caller's own signal, if it has one. */
  const overall = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, overall]) : overall;

  const vectors: number[][] = [];
  const usage: EmbeddingUsage = { promptTokens: 0, cost: 0 };
  /** The dimensionality the first batch came back at. See below. */
  let dims = 0;
  for (let i = 0; i < texts.length; i += BATCH) {
    if (overall.aborted) {
      throw new Error(
        `embeddings ${model}: ran out of time after ${vectors.length} of ${texts.length}`,
      );
    }
    const got = await embedBatch(model, texts.slice(i, i + BATCH), apiKey, opts.inputType, signal);
    /* **Dimensionality is checked across batches, not only within one.**
       ⟨Sol⟩ `readVectors` starts fresh each call, so a 97-passage article — two
       batches — could come back 1024-dimensional and then 1536-dimensional, and
       nothing would notice. It cannot be caught downstream either: `dot` walks
       the shorter vector, so every comparison between the two batches would be
       a real number computed over the first 1024 components of a vector that
       means something else. That is a wrong picture with no error in it. */
    const width = got.vectors[0]?.length ?? 0;
    if (dims === 0) dims = width;
    else if (width !== dims) {
      throw new Error(
        `embeddings ${model}: batch at ${i} came back ${width}-dimensional, not ${dims}`,
      );
    }
    vectors.push(...got.vectors);
    usage.promptTokens += got.usage.promptTokens;
    usage.cost += got.usage.cost;
    opts.onProgress?.(vectors.length, texts.length);
  }
  return { vectors, usage };
}

/** `setTimeout` that gives up early if the signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * The key, the way every other OpenRouter caller in this repo gets it —
 * `loadEnvLocal()` first, because `.env.local` beats what the shell exported
 * and the two are different accounts (src/env.ts, and the 404 clause above is
 * what it looks like when the wrong one is used).
 */
function apiKeyFromEnv(): string {
  loadEnvLocal();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return key;
}

/**
 * Cosine similarity — the full form, not a dot product.
 *
 * Callers that normalise their vectors first may use a bare dot product and be
 * right; nothing here promises normalised input, and a dot product over
 * un-normalised vectors is a similarity measure that rewards long passages.
 */
/**
 * A copy of the vector scaled to unit length, or `null` if it has none.
 *
 * **Normalise once, then use `dot`.** `cosine` divides by both norms on every
 * call, so comparing n vectors pairwise recomputes each one's norm n times — at
 * a thousand blocks that is a million square roots over the same numbers. A
 * zero-norm vector returns `null` rather than a vector of `NaN`: it has no
 * direction, so it is not similar to anything, and saying so as a `null` is
 * better than letting `NaN` propagate into a sort where it compares false
 * against everything and quietly settles wherever the sort leaves it.
 */
export function normalise(v: readonly number[]): Float64Array | null {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (!(norm > 0) || !Number.isFinite(norm)) return null;
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] ?? 0) / norm;
  return out;
}

/**
 * The dot product. Over two vectors from `normalise`, this **is** the cosine.
 *
 * **Refuses two vectors of different lengths** rather than walking the shorter
 * one. ⟨Sol⟩ Silently truncating is the behaviour that lets a mixed-dimension
 * response through the whole pipeline: every comparison is a real number
 * between −1 and 1, nothing errors, and the answer is about the first N
 * components of something else.
 */
export function dot(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length) {
    throw new Error(`dot: ${a.length}-dimensional against ${b.length}-dimensional`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: ${a.length}-dimensional against ${b.length}-dimensional`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
