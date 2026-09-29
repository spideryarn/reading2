/**
 * **The shelf's topics, as the route answers them: the program's candidates,
 * a model's scores when there are any, and a refresh when the shelf moved.**
 * docs/plans/260929c-shelf-topics-chosen-by-a-model.md § Stage 2 (and its
 * review decisions R1–R4); docs/project/shelf-terms.md.
 *
 * ## One request, in order
 *
 * 1. **The snapshot** — the owner's shelf, its stored phrase runs, a bounded
 *    fill of the rest (src/store/pg-shelf-terms.ts). Unchanged from before the
 *    model arrived.
 * 2. **The stored scores**, if any. A row, fresh or stale, is applied through
 *    `ChooseOptions.quality`: the keys it scored take their score, and **a key
 *    it did not score is left out** — the same rule the eval measured, and the
 *    one that keeps *food* and *bowl* out of a list the model has judged. When
 *    that leaves no topics at all (a row scored for a very different shelf),
 *    the program's own list is used instead. No row: the program's list.
 * 3. **A refresh, only when it can be right.** Only once nothing is pending
 *    (the candidates are complete), there is a key, and the model's input —
 *    titles, gists, profile, candidates, prompt version, model, hashed
 *    together — differs from the stored row's. Then **one** statement claims
 *    the refresh for this (owner, scope, input) with a lease, refusing while
 *    another claim is live or the backoff has not passed; then the per-owner
 *    allowance (hourly and daily caps, and a global fuse) is taken.
 * 4. **The answer goes first.** The route sends the response and *then*
 *    awaits `refresh` before its handler returns — so the call's spend lands
 *    in the request's own collector, attributed to the reader, not as a late
 *    finish (ai-gateway.md § the late finishes rule; R1). The response says
 *    `refreshing: true`, and the client asks again a bounded number of times.
 * 5. **The write is fenced**: it lands only if the claim is still ours. A
 *    failure counts, clears the claim and pushes `retry_after` out; the next
 *    request uses whatever row there was.
 *
 * Search, sort, Unread and reading position never reach this function, so
 * they can never cause a refresh. Archiving and restoring change the active
 * scope's set — and so its hash — and not the `all` scope's, because an
 * archived article is still in `all`.
 *
 * ## What may be logged from this file
 *
 * The scope, counts, durations, the model, an outcome and an error's class.
 * **Never** a title, a gist, a profile, a topic label, a key, the prompt or
 * the answer — every one of them is the reader's reading list.
 */

import type { AllowanceTaken, FetchAllowanceStore, RatePolicy, ShelfTermsStore, TopicScope } from "./store/contracts.js";
import { errorFields, log } from "./log.js";
import { SHELF_TOPICS_MODEL } from "./models.js";
import { normaliseProfileText } from "./profile.js";
import { candidatePool, chooseTerms, type ChooseResult } from "./shelf-terms/choose.js";
import {
  inputHash,
  promptCandidates,
  SCORE_TIMEOUT_MS,
  type ScorerInput,
  type ScoreResult,
  scoreCandidates,
  scorerInput,
  SHELF_TOPICS_PROMPT_VERSION,
} from "./shelf-terms/model-scores.js";
import { fetchAllowanceStore, readerStore, shelfTermsStore } from "./store/index.js";
import { termsResponse } from "./store/pg-shelf-terms.js";
import type { LibraryTermsResponse } from "./types.js";

const logger = log("model");

/**
 * How long a claim holds: the model's own deadline plus room for the write,
 * so a healthy refresh never has its claim taken from under it and a process
 * that died costs one lease.
 */
export const SCORE_CLAIM_LEASE_MS = SCORE_TIMEOUT_MS + 30_000;

/**
 * **How many refreshes one reader may cause.** A refresh happens when the shelf
 * changes, not when anybody presses anything — so the steady state is a
 * handful a day, and these are a blast radius against a shelf that somehow
 * changes on every load, not a budget. At ~$0.001–0.002 a call the global fuse
 * is a few dollars a day at worst. Starting numbers, not measurements.
 */
export const SHELF_TOPICS_RATE_POLICY: RatePolicy = {
  fills: 12,
  windowMs: 60 * 60 * 1000,
  concurrency: 2,
  leaseMs: SCORE_CLAIM_LEASE_MS,
  daily: { fills: 40, globalFills: 3_000, windowMs: 24 * 60 * 60 * 1000 },
};

/** How long to wait after the allowance refuses before claiming again. Not a failure. */
export const ALLOWANCE_RETRY_MS = 30 * 60 * 1000;

export interface ShelfTopicsDeps {
  store: ShelfTermsStore;
  allowance: FetchAllowanceStore;
  /** The reader's own "about you", or null. */
  readProfile: () => Promise<string | null>;
  /** False: no key — the program's list, and no claim, no call. */
  hasKey: () => boolean;
  score: (input: ScorerInput) => Promise<ScoreResult>;
  model: string;
}

export interface ShelfTopicsAnswer {
  response: LibraryTermsResponse;
  /**
   * The refresh this request claimed, to be awaited **after** the response is
   * sent and before the handler returns. Never throws. Null: nothing to do.
   */
  refresh: (() => Promise<void>) | null;
}

const scopeOf = (archived: boolean): TopicScope => (archived ? "all" : "active");

/** The stored scores as the chooser's quality map, or null when unusable. */
function qualityFrom(scores: Record<string, number>): Map<string, number> | null {
  const out = new Map<string, number>();
  for (const [key, s] of Object.entries(scores)) {
    if (!Number.isInteger(s) || s < 0 || s > 3) return null;
    out.set(key, s);
  }
  return out.size > 0 ? out : null;
}

/**
 * The reader's answer, and the refresh to run after it is sent.
 * `deps` is for tests; the route uses `defaultShelfTopicsDeps()`.
 */
export async function shelfTopics(
  archived: boolean,
  deps: ShelfTopicsDeps,
  opts: { budgetMs?: number } = {},
): Promise<ShelfTopicsAnswer> {
  const scope = scopeOf(archived);
  const snap = await deps.store.snapshot({ archived }, opts);
  const program = chooseTerms(snap.input);

  /* A score row that cannot be read leaves the program's list standing; the
     topics are never worth a 500. */
  let stored: Awaited<ReturnType<ShelfTermsStore["readScores"]>> = null;
  try {
    stored = await deps.store.readScores(scope);
  } catch (err) {
    logger.error({ ...errorFields(err), scope }, "shelf topic scores could not be read");
  }

  let chosen: ChooseResult = program;
  let chosenBy: LibraryTermsResponse["chosenBy"] = "program";
  const quality = stored?.result ? qualityFrom(stored.result.scores) : null;
  if (quality) {
    const byModel = chooseTerms(snap.input, { quality });
    if (byModel.terms.length > 0) {
      chosen = byModel;
      chosenBy = "model";
    }
  }
  const response = termsResponse(snap, chosen);
  response.chosenBy = chosenBy;

  if (snap.pending > 0 || program.terms.length === 0 || !deps.hasKey()) return { response, refresh: null };

  const candidates = promptCandidates(
    candidatePool(snap.input),
    program.terms.map((t) => t.key),
  );
  if (candidates.length === 0) return { response, refresh: null };
  const input = scorerInput(snap.articles, normaliseProfileText(await deps.readProfile()), candidates);
  const hash = inputHash(input, deps.model);
  if (stored?.result?.inputHash === hash) return { response, refresh: null };

  /* A live claim for either the current input or the one just before it blocks
     this row. Keep the client asking: once that claimant writes, the next ask
     either reads its result or claims the still-newer input. */
  if (stored?.claim && stored.claim.until.getTime() > Date.now()) {
    response.refreshing = true;
    return { response, refresh: null };
  }

  /* Guarded like the read above: a claim that throws — the table not there yet
     because production got this code before its migration, or a database
     hiccup — leaves the answer standing and asks for nothing. */
  let claimId: string | null;
  try {
    claimId = await deps.store.claimScores(scope, hash, SCORE_CLAIM_LEASE_MS);
  } catch (err) {
    logger.error({ ...errorFields(err), scope }, "shelf topic scores could not be claimed");
    return { response, refresh: null };
  }
  if (!claimId) {
    /* Two requests can both read before either claim exists. The loser learns
       only `null` from the atomic claim, so re-read once: a live claim (or a
       result that won the race) means this response is stale and the client
       should ask again. Backoff/allowance refusal has neither and stays quiet.
       This read cannot authorise a call; only `claimScores` can do that. */
    try {
      const now = await deps.store.readScores(scope);
      response.refreshing = Boolean(
        (now?.claim && now.claim.until.getTime() > Date.now()) || now?.result?.inputHash === hash,
      );
    } catch (err) {
      logger.error({ ...errorFields(err), scope }, "shelf topic claim state could not be read");
    }
    return { response, refresh: null };
  }

  let allowance: AllowanceTaken;
  try {
    allowance = await deps.allowance.take("shelf-topics", SHELF_TOPICS_RATE_POLICY);
  } catch (err) {
    logger.error({ ...errorFields(err), scope }, "shelf topics allowance could not be read");
    await deps.store.failScores(scope, claimId).catch(() => {});
    return { response, refresh: null };
  }
  if (allowance.kind !== "allowed") {
    logger.warn({ scope, refused: allowance.kind }, "shelf topics refresh refused by its allowance");
    await deps.store.releaseScores(scope, claimId, ALLOWANCE_RETRY_MS).catch(() => {});
    return { response, refresh: null };
  }

  response.refreshing = true;
  const token = allowance.id;
  const refresh = async (): Promise<void> => {
    const started = Date.now();
    try {
      const got = await deps.score(input);
      const written = await deps.store.writeScores(scope, claimId, {
        inputHash: hash,
        model: deps.model,
        promptVersion: SHELF_TOPICS_PROMPT_VERSION,
        scores: Object.fromEntries(got.scores),
      });
      logger.info(
        {
          scope,
          model: got.answeredBy ?? deps.model,
          ms: got.ms,
          articles: input.articles.length,
          candidates: input.candidates.length,
          scored: got.scored,
          written,
        },
        written ? "scored the shelf's topics" : "scored the shelf's topics, but the claim had moved on",
      );
    } catch (err) {
      /* The error's class and our own message, never a provider body — the
         gateway and `parseScores` both discard those at their boundary. */
      logger.error(
        { ...errorFields(err), scope, ms: Date.now() - started, candidates: input.candidates.length },
        "shelf topics refresh failed; the next waits for the backoff",
      );
      await deps.store.failScores(scope, claimId).catch(() => {});
    } finally {
      await deps.allowance.finish(token).catch(() => {});
    }
  };
  return { response, refresh };
}

/* ------------------------------------------------------------ the wiring -- */

/**
 * The real composition. A presence check on the key only — the call itself
 * goes through `openRouterJson` in src/shelf-terms/model-scores.ts.
 */
export function defaultShelfTopicsDeps(): ShelfTopicsDeps {
  return {
    store: shelfTermsStore,
    allowance: fetchAllowanceStore,
    readProfile: () => readerStore.readProfile(),
    hasKey: () => Boolean(process.env.OPENROUTER_API_KEY),
    score: (input) => scoreCandidates(input, { model: SHELF_TOPICS_MODEL }),
    model: SHELF_TOPICS_MODEL,
  };
}
