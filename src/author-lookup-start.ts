/**
 * **The after-response lookup for an author gift** — the seam between the
 * routes and the one web-search call. docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md,
 * D4 and R2-F5/F6.
 *
 * The routes in src/routes.ts hand `startAuthorLookup` to `afterResponse` with
 * the id of a lookup row that `ensureAuthorGift` or `beginLookup`
 * (src/store/pg-author-gifts.ts) has just committed as pending. In order:
 *
 * 1. **Read the article, as its owner.** `lookupSubject` names the gift's
 *    article and `created_by`; the reads are the owner's own
 *    (`pgArticleReader.loadArticleIdentity` for the revision's own title,
 *    byline and authors — never the owner's rename, since the result goes to a
 *    stranger, as in src/store/voucher-starter.ts — and
 *    `pgArticleReader.loadArticle` for the source URL and the blocks), under
 *    `runAsOwner(created_by)`. Anything missing finishes the row `failed`
 *    before a collector is even opened: nothing is spent.
 * 2. **A collector of its own.** After-response work drains in
 *    `withAfterResponseTasks`' `finally`, outside the request's `collectSpend`
 *    (`handleApi` nests them that way round), so the request's collector has
 *    already reported and cannot see these calls; and even were this ever run
 *    inside another collector, `collectSpend` shadows rather than merges
 *    (src/ai-spend.ts § `collectSpend`). Attribution is explicit — the
 *    administrator and the article's slug — and the sink is the ledger.
 * 3. **Claim, then call.** `claimLookup` writes that collector's own run id
 *    (`currentSpend().runId`) onto the row before any provider request; false
 *    means another run has it, or it was finished as stale, and nothing is
 *    called. So `ai_calls.run_id` names exactly this run's calls.
 * 4. **Finish.** `runAuthorLookup` never throws on a provider failure; its
 *    result maps onto `finishLookup`'s union. Anything unexpected — a database
 *    error, a bug — finishes the row `failed` with the error's *name* (never
 *    its message, which can carry SQL or text), so no row is left looking like
 *    a search in progress.
 */

import { collectSpend, currentSpend } from "./ai-spend.js";
import { type AuthorLookupCall, type AuthorLookupInput, type AuthorLookupResult, runAuthorLookup } from "./author-lookup.js";
import { log } from "./log.js";
import { runAsOwner } from "./owner.js";
import { costStore } from "./store/ai-calls.js";
import { type LookupResult, pgAuthorGiftStore } from "./store/pg-author-gifts.js";
import { pgArticleReader } from "./store/pg.js";

const logger = log("model");

/** Seams for tests; each defaults to the real thing. */
export interface StartAuthorLookupDeps {
  /** The provider call, handed to `runAuthorLookup`. Tests inject a fake: nothing under tests/ reaches a paid provider. */
  readonly call?: AuthorLookupCall;
}

/** What the lookup reads, or why it cannot run. */
type Loaded =
  | { readonly kind: "ready"; readonly ownerId: string; readonly slug: string; readonly input: AuthorLookupInput }
  | { readonly kind: "missing"; readonly failure: string };

/** The `status` the owner's reads give an article that is not theirs, not there, or (409) not processed. */
function readRefusal(err: unknown): string | null {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  if (status === 404) return "article-gone";
  if (status === 409) return "article-unread";
  return null;
}

async function load(lookupId: string): Promise<Loaded> {
  const subject = await pgAuthorGiftStore.lookupSubject(lookupId);
  if (!subject) return { kind: "missing", failure: "gift-gone" };
  const { slug, createdBy } = subject;
  try {
    return await runAsOwner(createdBy, async (): Promise<Loaded> => {
      const identity = await pgArticleReader.loadArticleIdentity(slug);
      const article = await pgArticleReader.loadArticle(slug);
      const text = article.blocks
        .map((b) => b.text)
        .filter(Boolean)
        .join("\n\n");
      if (text.trim() === "") return { kind: "missing", failure: "article-empty" };
      return {
        kind: "ready",
        ownerId: createdBy,
        slug,
        input: {
          title: identity.title,
          byline: identity.byline ?? null,
          authors: identity.authors ?? null,
          sourceUrl: article.meta.url ?? null,
          text,
        },
      };
    });
  } catch (err) {
    const refusal = readRefusal(err);
    if (refusal !== null) return { kind: "missing", failure: refusal };
    throw err;
  }
}

/** `runAuthorLookup`'s answer, as the store's finish takes it. */
export function lookupResultFor(result: AuthorLookupResult): LookupResult {
  const { searches, model, notes } = result;
  if (result.outcome === "failed") return { kind: "failed", failure: result.failure, searches, model, notes };
  return {
    kind: "found",
    authorName: result.authorName,
    authorSourceUrl: result.authorSourceUrl,
    email: result.email,
    emailSourceUrl: result.emailSourceUrl,
    suggestedEmail: result.suggestedEmail,
    contactUrl: result.contactUrl,
    searches,
    model,
    notes,
  };
}

/** Finish the row failed; a finish that itself fails is logged and swallowed — the row then goes stale in five minutes. */
async function finishFailed(lookupId: string, failure: string): Promise<void> {
  try {
    await pgAuthorGiftStore.finishLookup(lookupId, { kind: "failed", failure });
  } catch (err) {
    logger.error({ lookupId, failure, finishError: err instanceof Error ? err.name : "unknown" }, "an author lookup could not be finished");
  }
}

/** The work, which may throw; `startAuthorLookup` is the wrapper that never does. */
async function runLookup(lookupId: string, deps: StartAuthorLookupDeps): Promise<void> {
  const loaded = await load(lookupId);
  if (loaded.kind === "missing") {
    logger.warn({ lookupId, failure: loaded.failure }, "an author lookup had nothing to read");
    await finishFailed(lookupId, loaded.failure);
    return;
  }

  await collectSpend(
    async () => {
      const runId = currentSpend()?.runId;
      if (!runId) throw new Error("author lookup: no spend collector open inside its own collectSpend");
      if (!(await pgAuthorGiftStore.claimLookup(lookupId, runId))) {
        logger.info({ lookupId }, "an author lookup was already claimed or finished; nothing called");
        return;
      }
      const result = await runAuthorLookup(loaded.input, deps.call ? { call: deps.call } : {});
      const finished = await pgAuthorGiftStore.finishLookup(lookupId, lookupResultFor(result));
      logger.info({ lookupId, runId, outcome: result.outcome, finish: finished.kind }, "author lookup finished");
    },
    {
      attribution: { scopeKind: "request", ownerId: loaded.ownerId, articleSlug: loaded.slug },
      sink: (row) => costStore.record(row),
    },
  );
}

/**
 * **Run one pending lookup. Never throws**, so `afterResponse`'s own catch is
 * never what settles it: an unexpected error finishes the row `failed` with
 * the error's name. (A finish that fails twice leaves the row for
 * `beginLookup`'s stale sweep.)
 */
export async function startAuthorLookup(lookupId: string, deps: StartAuthorLookupDeps = {}): Promise<void> {
  try {
    await runLookup(lookupId, deps);
  } catch (err) {
    const failure = err instanceof Error ? err.name : "unknown";
    logger.error({ lookupId, failure }, "an author lookup failed unexpectedly");
    await finishFailed(lookupId, failure);
  }
}
