/**
 * **The wall.** Whether this reader may add another article, asked at the two
 * routes that add one, and the slot given back when no job comes of it.
 *
 * The ledger underneath is src/store/pg-billing.ts; this is the half that knows
 * about HTTP, about Stripe, and about which requests spend money.
 *
 * ## Why this is at the routes and not inside `enqueue()`
 *
 * `enqueue()` looks like the perfect choke point — every job in the app is
 * created through it — and it is the wrong place. It also serves **step re-runs
 * on an article already on the shelf**: a glossary, a set of ideas, a quiz. Those
 * are free (docs/project/billing.md § *The quota*), and by the time a request
 * reaches `enqueue` the shape that would tell them apart has been normalised
 * away — a re-run's job carries a URL, filled in from the article's own metadata.
 * Only the route still knows whether the reader asked for a **new** ingest.
 *
 * So there are exactly three admitting call sites, and all three are in
 * src/routes.ts:
 *
 * | | |
 * |---|---|
 * | `POST /api/jobs {url}` | reserves |
 * | `POST /api/jobs {uploadId}` | reserves |
 * | `POST /api/jobs/:id/retry` of a job that **carried** a slot | reserves |
 * | `POST /api/jobs {slug, steps}` | free — a re-run |
 * | `POST /api/jobs/:id/retry` of a job that carried none | free |
 *
 * The retry route is a second front door: it goes straight to `retryJob` →
 * `enqueue()` and never passes through the `POST /api/jobs` handler, so a check
 * bolted onto that handler alone would leave a failed ingest retryable free, for
 * ever.
 *
 * ## Why the release is unconditional
 *
 * `reserveIngest` commits its own transaction and returns — the lock is **not**
 * held across `enqueue()`, because `enqueueOrGet` takes a second pooled
 * connection and `DATABASE_POOL_MAX` is 5. So between the reservation and the
 * job's INSERT there is a window, and every exit from it that produces no job
 * must give the slot back: `enqueue` deduplicating onto an existing job, an
 * upload that turns out to be an article already, a 404, a throw.
 *
 * Rather than enumerate those, `withIngestSlot` calls `releaseReservation` on
 * **every** path, and lets the ledger decide. That is not sloppiness borrowed
 * against a helpful no-op: `releaseReservation`'s
 * `not exists (select 1 from jobs where ingest_event_id = …)` is precisely the
 * question being asked here — *did a job end up spending this?* — and it is
 * asked of committed rows rather than of our own idea of what happened. The
 * enumerating version would have to be right about `enqueue`'s four outcomes and
 * about a throw over an INSERT that committed and lost its reply; this one is
 * right by construction, at the cost of one indexed UPDATE per ingest.
 *
 * ## The administrator is exempt, and takes no slot at all
 *
 * `isAdmin` (src/admin.ts) is a comparison against a **hardcoded list of two
 * uuids** — the seeded local dev-admin and Greg's production account — which is
 * what makes an exemption here safe: there is no environment variable, no
 * claim and no header that can put anybody else in it.
 *
 * Without it Greg is held to three lifetime articles on his own production
 * instance, and the mechanism that will eventually cover this — comp
 * subscriptions — is deliberately a post-go-live stage.
 *
 * **Nothing is reserved, rather than reserved and then forgiven.** An admin's
 * job carries a null `ingest_event_id`, exactly as a step re-run does, so
 * settlement no-ops on it and no `ingest_events` row is ever written. The
 * exemption therefore stays out of the counting path altogether instead of
 * becoming a special case inside it — which also means the ledger says what it
 * looks like it says, and Greg's ingests are legitimately absent from it.
 *
 * ## Postgres only
 *
 * Quota is a Postgres feature (docs/project/billing.md § *Billing is a Postgres
 * feature*): the settlement joins the Postgres publish transaction, which has no
 * filesystem counterpart, and a second ledger would be two implementations of
 * one count. Under the filesystem store every function here is inert — it admits
 * without reserving, and nothing it would have called is reached. That cannot
 * leak into production, because src/store/index.ts refuses to boot there on a
 * filesystem store.
 */

import { isAdmin } from "../admin.js";
import {
  BILLING_NOT_AVAILABLE,
  READ_THIS_ALREADY_RUNNING,
  highPowerNoRoom,
  ingestQuotaReached,
  minimalQuotaReached,
} from "../messages.js";
import { errorFields, log } from "../log.js";
import type { OwnerId } from "../owner.js";
import {
  ingestEligibility,
  noteRefusal,
  releaseReservation,
  reservationShapeOf,
  reserveIngest,
  reserveMinimal,
  reserveUpgrade,
  runUnderBillingLock,
  switchOnHighPower,
} from "../store/pg-billing.js";
import type { InLock, MinimalRefused, Refused, Stale } from "../store/pg-billing.js";
import { ingestProvenanceOf } from "../store/pg-jobs.js";
import { syncSubscriptionFromStripe } from "./sync.js";

const logger = log("store");

/**
 * The slot, shaped to be spread straight into an `EnqueueRequest`.
 *
 * **Empty whenever nothing was reserved** — a filesystem store, an
 * administrator, a request that was never a new ingest — so the caller has one
 * expression rather than a branch, and cannot forget to carry it. An empty one
 * leaves `jobs.ingest_event_id` null, which is what "spends no quota" is.
 */
export interface IngestSlot {
  readonly ingestEventId?: string;
}

/**
 * Resync one customer from Stripe. The real one is `syncSubscriptionFromStripe`.
 *
 * A seam because admission is its **first** caller: the checkout stage exercises
 * the real function against Stripe, and a test of the stale path here wants to
 * be about what admission does with the answer.
 */
export type Resync = (customerId: string) => Promise<unknown>;

export interface AdmissionDeps {
  readonly sync?: Resync;
}

/** An error carrying the HTTP status it should be reported as — as src/routes.ts does. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * **402 Payment Required**, and the alternative considered was 429.
 *
 * 429 is about a *rate* and comes with the implication that waiting fixes it,
 * which is false for a lifetime allowance and only accidentally true for a
 * monthly one. The message is what the reader actually sees
 * (`readJson` in src/web/lib/api.ts throws it verbatim); the status is what a
 * log or a script reads, and 402 is the honest one.
 */
function quotaRefusal(ownerId: string, refused: Refused): Error {
  noteRefusal(ownerId, refused);
  return httpError(
    402,
    ingestQuotaReached({
      limit: refused.limit,
      ...(refused.resetAt ? { resetAt: refused.resetAt } : {}),
      ...(refused.lapsed ? { lapsed: true } : {}),
      /* **Spread only when the wall computed one**, like the two above: absent
         means *sharing would not make room*, and a `0` would read as a number
         the sentence could be built from. */
      ...(refused.shareToMakeRoom === undefined
        ? {}
        : { shareToMakeRoom: refused.shareToMakeRoom }),
    }).message,
  );
}

/**
 * Ask Stripe once, then ask the ledger again.
 *
 * A `stale` admission is neither a yes nor a no: the row says this account is
 * subscribed and says its period ended, and both available answers are wrong —
 * the free limit falsely blocks somebody who has paid, and the paid limit
 * against a closed window is an uncapped month. Stripe is the authority, so ask
 * it, and take whatever the ledger says next.
 *
 * **Outside the lock, which is what makes it allowed at all.** `reserveIngest`
 * has already committed by the time it answers, so this network call is not
 * holding a pooled connection — see src/store/pg-billing.ts, *nothing that talks
 * to the network may be called between the lock and the commit*.
 *
 * A second `stale` is not retried again: the caller answers 503, Stripe having
 * already been asked and the row still not containing now.
 */
async function resyncAndRetry<T>(
  ownerId: string,
  customerId: string | null,
  sync: Resync,
  retry: () => Promise<T>,
): Promise<T | null> {
  /* Nothing to ask about. The schema requires a customer beside a subscription
     (`billing_accounts_subscription_needs_customer`), so this is the shape of a
     row nothing has ever synced. */
  if (!customerId) return null;
  try {
    await sync(customerId);
  } catch (err) {
    /* Stripe unreachable, misconfigured, or refusing. **Never fall through to
       the free allowance**: that reads as a block to somebody who has paid, and
       the other direction would be an uncapped month. */
    logger.warn(
      { ownerId, ...errorFields(err) },
      "could not resync a subscription whose stored period had run out",
    );
    return null;
  }
  /* The whole question again, after the resync has committed — never inside
     the locked transaction, which may not touch the network. */
  return await retry();
}

/**
 * **Ask the ledger, resync once if it says `stale`, and ask again** — the shape
 * every admission here shares. A second `stale` is a 503 rather than a guess in
 * either direction: this server cannot find out what the account is entitled
 * to. Anything else the ledger answered goes back to the caller to turn into
 * its own refusal.
 */
async function admitOrResync<A extends { readonly kind: string }>(
  ownerId: string,
  reserve: () => Promise<A | Stale>,
  deps: AdmissionDeps,
  what: string,
): Promise<Exclude<A, Stale>> {
  let admission: A | Stale = await reserve();
  if (isStale(admission)) {
    admission =
      (await resyncAndRetry(
        ownerId,
        admission.customerId,
        deps.sync ?? syncSubscriptionFromStripe,
        reserve,
      )) ?? admission;
  }
  if (isStale(admission)) {
    /* 503 rather than a guess in either direction, and it is a real one: this
       server cannot find out what this account is entitled to. */
    logger.error(
      { ownerId, subscriptionId: admission.subscriptionId },
      `refusing ${what}: the stored subscription period does not contain now, after a resync`,
    );
    throw httpError(503, BILLING_NOT_AVAILABLE.message);
  }
  return admission as Exclude<A, Stale>;
}

function isStale(answer: { readonly kind: string }): answer is Stale {
  return answer.kind === "stale";
}

/**
 * Take a slot for a new ingest, or throw the refusal the reader should see.
 *
 * @returns the reservation id, or `null` when quota is not enforced here.
 */
async function admitIngest(
  ownerId: string,
  slug: string | undefined,
  deps: AdmissionDeps,
): Promise<string | null> {
  if (isAdmin(ownerId)) return null;
  const admission = await admitOrResync(ownerId, () => reserveIngest(ownerId, slug), deps, "an ingest");
  if (admission.kind === "refused") throw quotaRefusal(ownerId, admission);
  return admission.reservationId;
}

/**
 * Run `body` holding a reservation, and give it back if no job took it — the
 * release half every slot shares. See the header for why it is unconditional.
 */
async function holding<T>(
  ownerId: string,
  reservationId: string | null,
  body: (slot: IngestSlot) => Promise<T>,
): Promise<T> {
  if (reservationId === null) return await body({});
  try {
    return await body({ ingestEventId: reservationId });
  } finally {
    /* Swallowed rather than thrown: a release that fails inside `finally` would
       replace whatever `body` threw with a message about the ledger, and the
       reader would be told about billing when their upload 404'd. A slot that
       leaks is one support conversation; there is deliberately no expiry
       (docs/project/billing.md § *Three things that look like improvements*). */
    await releaseReservation(reservationId).catch((err: unknown) => {
      logger.error(
        { ownerId, ...errorFields(err) },
        "could not give back an ingest slot that produced no job",
      );
    });
  }
}

/**
 * Run `body` holding a quota slot, and give the slot back if no job took it.
 *
 * The slot is handed to `body` to spread into its `EnqueueRequest`, from where
 * `enqueue` puts it on the ticket and the job's own INSERT writes it — that
 * INSERT is what makes the slot spent, and every path that does not reach one
 * gives it back. See the header for why the release is unconditional.
 *
 * @param slug what the article will be called, stored on the reservation as a
 * diagnostic only.
 */
export async function withIngestSlot<T>(
  intent: { ownerId: OwnerId; slug?: string },
  body: (slot: IngestSlot) => Promise<T>,
  deps: AdmissionDeps = {},
): Promise<T> {
  const reservationId = await admitIngest(intent.ownerId, intent.slug, deps);
  return await holding(intent.ownerId, reservationId, body);
}

/**
 * **402 for a minimal paper that does not fit**, saying how many still would
 * (`minimalQuotaReached`). Its own sentence, because the rule is its own: a
 * minimal paper must fit whole, so *the allowance is spent* can be false while
 * this refuses.
 */
function minimalRefusal(ownerId: string, refused: MinimalRefused): Error {
  logger.info(
    { ownerId, fits: refused.fits, limit: refused.limit },
    "minimal paper refused: the account is at its quota",
  );
  return httpError(
    402,
    minimalQuotaReached({
      fits: refused.fits,
      ...(refused.resetAt ? { resetAt: refused.resetAt } : {}),
    }).message,
  );
}

/**
 * **`withIngestSlot` for a minimal paper** — 2 points, `admitsMinimal`, and the
 * same release on every path.
 *
 * `inLock` is the seam Stage 3 of plan 261001m runs its duplicate check and
 * upload claim through, in the reservation's own transaction under the owner's
 * billing lock; see `InLock` in src/store/pg-billing.ts. **To decline, it
 * throws**, which rolls the reservation back and reaches the route unchanged.
 *
 * The administrator reserves nothing, exactly as `admitIngest`, and `inLock`
 * still runs, under the same lock with a null `reservationId`, so the
 * duplicate check is serialised for them too.
 */
export async function withMinimalSlot<T>(
  intent: { ownerId: OwnerId; slug?: string; inLock?: InLock },
  body: (slot: IngestSlot) => Promise<T>,
  deps: AdmissionDeps = {},
): Promise<T> {
  const { ownerId, slug, inLock } = intent;
  if (isAdmin(ownerId)) {
    if (inLock) await runUnderBillingLock(ownerId, inLock);
    return await body({});
  }
  const options = { ...(slug ? { slug } : {}), ...(inLock ? { inLock } : {}) };
  const admission = await admitOrResync(
    ownerId,
    () => reserveMinimal(ownerId, options),
    deps,
    "a minimal paper",
  );
  if (admission.kind === "refused") throw minimalRefusal(ownerId, admission);
  return await holding(ownerId, admission.reservationId, body);
}

/**
 * **`withIngestSlot` for *Read this* on a minimal paper** — an ingest at the
 * wall, credited the paper's own 2 points when they are in this window
 * (`reserveUpgrade`), with its reservation bound to the article from birth.
 *
 * Refused like an ingest (`ingestQuotaReached`, sharing offer and all); a
 * second press while one is in flight is a 409 (`READ_THIS_ALREADY_RUNNING`);
 * an article that is not this owner's (or has no live minimal charge to
 * upgrade) is a 404. The administrator reserves nothing, exactly as
 * `admitIngest`.
 */
export async function withUpgradeSlot<T>(
  intent: { ownerId: OwnerId; articleId: string },
  body: (slot: IngestSlot) => Promise<T>,
  deps: AdmissionDeps = {},
): Promise<T> {
  const { ownerId, articleId } = intent;
  if (isAdmin(ownerId)) return await body({});
  const admission = await admitOrResync(
    ownerId,
    () => reserveUpgrade(ownerId, articleId),
    deps,
    "Read this",
  );
  switch (admission.kind) {
    case "admitted":
      return await holding(ownerId, admission.reservationId, body);
    case "refused":
      throw quotaRefusal(ownerId, admission);
    case "in-flight":
      throw httpError(409, READ_THIS_ALREADY_RUNNING.message);
    case "not-found":
      throw httpError(404, "No such article on your shelf.");
    default: {
      const never: never = admission;
      throw new Error(`unhandled Read this admission ${JSON.stringify(never)}`);
    }
  }
}

/**
 * The same, for `POST /api/jobs/:id/retry`, which reserves **only** if the
 * attempt it repeats spent a slot — and **reserves the same kind again**.
 *
 * `Job.url` cannot be asked that question — a step re-run recovers a URL from
 * the article it names, so a re-run's job carries one exactly as an ingest does.
 * `jobs.ingest_event_id` is the fact, which is why the column exists, and
 * `ingestProvenanceOf` is the narrow read of it.
 *
 * A retry is otherwise an ordinary admission: a fresh reservation, because the
 * failed attempt's was released when it failed. So a failure costs nothing and
 * the eventual success costs exactly one, and a reader out of allowance cannot
 * retry a failed ingest for ever.
 *
 * **The old reservation's kind decides the new one** (Opus's review of 261001m):
 * a retried minimal paper reserves 2 points through `withMinimalSlot`, not 200,
 * and may carry Stage 3's duplicate/claim work into that same locked
 * transaction through `minimalInLock`;
 * a retried *Read this* goes back through `withUpgradeSlot`, bound to the same
 * article and credited the same way; anything else is an ordinary ingest.
 * `reservationShapeOf` reads it off the ledger row.
 *
 * A job that is not this owner's, or is not there at all, reserves nothing — the
 * retry then answers 404 on its own, and a refusal here would have told a
 * stranger the job exists.
 */
export async function withRetrySlot<T>(
  intent: { jobId: string; ownerId: OwnerId; minimalInLock?: InLock },
  body: (slot: IngestSlot) => Promise<T>,
  deps: AdmissionDeps = {},
): Promise<T> {
  const previous = await ingestProvenanceOf(intent.jobId, intent.ownerId);
  if (!previous?.ingestEventId) return await body({});
  const shape = await reservationShapeOf(previous.ingestEventId, intent.ownerId);
  const { ownerId } = intent;
  const named = previous.slug ? { slug: previous.slug } : {};
  switch (shape?.kind) {
    case "minimal":
      return await withMinimalSlot(
        { ownerId, ...named, ...(intent.minimalInLock ? { inLock: intent.minimalInLock } : {}) },
        body,
        deps,
      );
    case "upgrade":
      return await withUpgradeSlot({ ownerId, articleId: shape.articleId }, body, deps);
    case "ingest":
    case undefined:
      /* Undefined is a job naming a reservation this owner's ledger does not
         have — unreachable (`jobs.ingest_event_id`'s foreign key is composite on
         the owner), and an ordinary ingest is the price that cannot be gamed. */
      return await withIngestSlot({ ownerId, ...named }, body, deps);
    default: {
      const never: never = shape;
      throw new Error(`unhandled reservation shape ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Refuse `POST /api/uploads` from an account with no room left.
 *
 * **Not the gate**, and reserves nothing: it is the door telling somebody there
 * is no point carrying the sofa upstairs. The authoritative admission is
 * `withIngestSlot` at `POST /api/jobs`, which is serialised per owner; two of
 * these can both pass for one remaining slot and that is fine, because the one
 * that arrives second is refused where it counts.
 *
 * Only a plain refusal stops an upload. A `stale` subscription does not: the
 * resync belongs at the gate, where the answer decides something, and refusing a
 * paying subscriber a *staging area* because Stripe is slow would be a block
 * built out of a maybe.
 */
export async function refuseUploadWithoutQuota(ownerId: OwnerId): Promise<void> {
  if (isAdmin(ownerId)) return;
  const answer = await ingestEligibility(ownerId);
  if (answer.kind === "refused") throw quotaRefusal(ownerId, answer);
}

/**
 * **Switch a reader's article to High-powered AI, charging for it once**, or
 * throw what the reader should see — docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md.
 *
 * `switchOnHighPower` (src/store/pg-billing.ts) is the transaction; this is the
 * policy around it, `admitOrResync` like `admitIngest`: a stale entitlement resyncs from
 * Stripe once, *after* the transaction has committed, and asks again; still
 * stale is a 503 rather than a guess. A refusal is a 402 of its own
 * (`highPowerNoRoom`), with no sharing offer — see that function.
 *
 * **Not for the administrator**, who is exempt as with ingests: the route sends
 * them, and every switch-off, to the uncharged store method. That split is
 * asserted here too, so a caller that forgot cannot bill Greg.
 */
export async function chargeAndSwitchOnHighPower(
  ownerId: OwnerId,
  slug: string,
  deps: AdmissionDeps = {},
): Promise<{ highPowerSince: string }> {
  if (isAdmin(ownerId)) {
    throw new Error(
      "the administrator's High-powered AI is never charged; use the store's switchOnForAdmin",
    );
  }
  const answer = await admitOrResync(
    ownerId,
    () => switchOnHighPower(ownerId, slug),
    deps,
    "High-powered AI",
  );
  switch (answer.kind) {
    case "on":
      if (answer.charged) {
        logger.info({ ownerId, slug }, "High-powered AI switched on, and charged once");
      }
      return { highPowerSince: answer.highPowerSince.toISOString() };
    case "not-found":
      throw httpError(404, `No article artefacts for "${slug}".`);
    case "no-room":
      logger.info(
        { ownerId, slug, publicNow: answer.publicNow },
        "High-powered AI refused: not enough allowance left",
      );
      throw httpError(
        402,
        highPowerNoRoom(
          answer.entitlement.tier === "paid" ? { resetAt: answer.entitlement.periodEnd } : {},
        ).message,
      );
    default: {
      const never: never = answer;
      throw new Error(`unhandled High-powered AI answer ${JSON.stringify(never)}`);
    }
  }
}
