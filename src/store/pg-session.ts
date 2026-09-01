/**
 * The seam from src/store/session.ts, with a transaction actually in it.
 *
 * > A stage stops writing. It returns a product. A short commit afterwards
 * > writes the product, checks it, finishes the step, and moves the job on.
 *
 * `fsStoreSession` says out loud that it holds no transaction: on the filesystem
 * the four writes happen one after another and a kill between any two of them
 * leaves the state it always did. This is the other implementation, and the
 * whole of its value is the word *one*: **artefacts, postcondition, step
 * completion, publication and job transition commit together or not at all.**
 *
 * The model call stays outside, permanently. `run` happens between `beginStep`
 * and `commit`, and neither of those two is inside the other's transaction.
 *
 * docs/plans/260827aa-delete-the-importer.md § D1b, and the design review that rewrote
 * half of it: docs/plans/260827aa-delete-the-importer-d1b-design-sol.md.
 *
 * ## The settlement state machine — five cases, not two
 *
 * This is the part most likely to be misremembered later, so it is written down
 * here as well as spelled out in the code below.
 *
 * 1. **Non-terminal success.** Write, validate, finish the step, release the
 *    claim — and **retain** the draft, because the next request continues into
 *    it. `commit` with a `release` transition.
 * 2. **Terminal success.** Write, validate, finish the step, **publish**, finish
 *    the job, and the publication clears `jobs.draft_revision_id` on its way
 *    past. `commit` with an `end` transition whose ending is `done`.
 * 3. **Stage failure or cancellation.** No product, so no write: **mark the step
 *    that was begun and never finished `error`**, fail the draft, clear the
 *    pointer, end the job. `settleJob` with an `end` transition whose ending is
 *    `error` or `cancelled`. The step comes first of the four, because the two
 *    after it are what stop it being allowed.
 * 4. **A release that resolves to cancellation.** A Stop landed while the step
 *    ran, so `releaseStepIn`'s own `case` expression ends the job instead of
 *    queueing it. The draft has to be disposed of and the *actual* settlement
 *    returned — a caller that believed its own request would tell the reader the
 *    job was still working.
 * 5. **Every step skipped.** Reaches `settleJob` and never `commit` at all
 *    (src/jobs.ts, the line after the step loop). It must **publish or discard
 *    the copied draft explicitly**, not merely finish the job.
 *
 * Cases 2 and 5 both publish, which is the sentence worth keeping: **publication
 * does not hang off `commit`.**
 *
 * And clearing `jobs.draft_revision_id` is part of every ending, because
 * `sweepAbandonedDrafts` treats *any* job's pointer as ownership — a terminal
 * job's included. `finish` and `releaseStep` still do not clear it and must not:
 * the first is always preceded here by a publication or a failure that clears it
 * on its own fence, and the second is the statement that hands the same draft to
 * the next request. The two endings that happen to a job *nobody is inside* —
 * `settleExpired` and a queued `requestCancel` — clear it themselves, since no
 * session will ever run for them (src/store/pg-jobs.ts; GPT Sol, 2026-08-30,
 * docs/plans/260827aa-delete-the-importer-d1b-sol.md finding 1).
 *
 * ## The lock order: article, then job, always
 *
 * `lockOrCreateArticle` is taken at the **top** of every transaction here,
 * before the artefact write's fence takes the job row — including on the commits
 * that will not publish and therefore have no other use for it. That is
 * correctness, not tidiness: a transaction that takes the job lock first and
 * reaches `publishRevisionIn` later still has job→article ordering, and being
 * inside one transaction does not stop it deadlocking with another article→job
 * transaction. Re-locking an article this transaction already holds is free,
 * which is why `publishRevisionIn` and `failRevisionIn` may go on taking it for
 * themselves. GPT Sol, 2026-08-29.
 *
 * ## It does not accept `JobSettles`
 *
 * `releaseStepIn(tx, …)` and `finishIn(tx, …)` are called directly, because the
 * public capability's methods reach `getDb()` for themselves and injecting them
 * would bind nothing to this transaction — artefacts and step state committing
 * while the release fails separately is the exact fault this file exists to
 * remove. See `JobSettles` in src/store/session.ts.
 *
 * ## Nothing real can run through it yet, and that is correct
 *
 * `checkProduct` is asked with an **empty** unconverted set, so a step that
 * returns no `parts` is refused by name — and all ten steps are still on
 * `LEGACY_UNCONVERTED_STEPS`. A stage that writes its own files during `run`
 * writes them outside this transaction, which is the failure the transaction is
 * for. D3 converts `arc` and it becomes the first real user.
 */
import { and, eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { jobs as jobsTable } from "../db/schema.js";
import { assertProduced } from "../pipeline.js";
import type { StepName } from "../types.js";
import {
  type JobDraftRef,
  pgArtifactsIn,
  readsPgArtifacts,
} from "./artifacts-pg.js";
import { guardDbStore } from "./db-errors.js";
import { StaleAttemptError } from "./jobs.js";
import type { JobEnding } from "./jobs.js";
import { finishIn, releaseStepIn } from "./pg-jobs.js";
import {
  NotTheLiveAttempt,
  PublishRefused,
  failRevisionIn,
  finishStepRun,
  lockOrCreateArticle,
  logDraftFailure,
  logPublication,
  publishRevisionIn,
  openOrBeginJobDraft,
  type OpenDraftResult,
  type PublishRevisionResult,
} from "./pg-revisions.js";
import {
  checkProduct,
  settlementOf,
  type JobEndTransition,
  type JobSettlement,
  type JobTransition,
  type StoreSession,
} from "./session.js";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * **No step is exempt here**, and it is a constant rather than an option.
 *
 * `fsStoreSession` consults `UNCONVERTED_STEPS` because on the filesystem a
 * stage writing its own files during `run` is simply how it has always worked.
 * Under a transaction those writes land outside it, so the same product would
 * pass its postcondition against the artefacts `beginDraftIn` carried forward
 * and be marked done having written nothing into the draft. There is no value
 * of this that would be safe, so there is no parameter.
 */
const NOTHING_UNCONVERTED: ReadonlySet<StepName> = new Set<StepName>();

/** What the transaction decided that only the caller may say out loud. */
interface Announcement {
  readonly published?: PublishRevisionResult;
  readonly failed?: { readonly revisionId: string; readonly reason: string; readonly changed: number | null };
}

/**
 * **The revision this draft was copied from** — the base a publication may
 * replace, and nothing else.
 *
 * `beginDraftIn` copies whichever revision is current at the moment the draft is
 * minted, and then the job runs for minutes. If something publishes this article
 * in the meantime, the draft's blocks, columns and step runs describe the *old*
 * article, and publishing it moves `articles.current_revision_id` back over work
 * nobody asked to lose — silently, because `publishRevisionIn` checks the
 * revision's article, its status and its tree, and never asks what it was based
 * on. That is stage 3 item 4 of docs/plans/260831b-finish-the-database-move.md,
 * carried forward through five reviews since GPT Sol's first one.
 *
 * ## `how` is here because the three answers are not equally strong
 *
 * - **`minted`** — this claim created the draft, so `beginDraftIn` handed back
 *   the id it actually copied. Exact.
 * - **`reopened`** — this claim found a draft an *earlier request of the same
 *   job* had minted, and the draft's own `based_on_revision_id` says what that
 *   request copied. Also exact, and read under the article lock inside
 *   `openOrBeginJobDraft`'s transaction. It says the same thing `minted` says:
 *   **this is the revision the draft's blocks, columns and step runs came
 *   from.**
 * - **`unknown`** — nobody could answer, and the check is skipped. It carries a
 *   `why` because a guard that turns itself off has to say when, and the one
 *   caller is named there.
 *
 * ## The column, and what it replaced
 *
 * Until 2026-09-01 there was no `based_on_revision_id`, and a reopened draft was
 * given *the article's current revision read at reopen*. That is the number the
 * publication is about to compare itself against, so the guard agreed with
 * itself and passed the exact race it exists to refuse: mint from R1, hand the
 * claim back, R2 publishes, the next claim reopens and records R2 as the base,
 * and the R1 copy buries R2. GPT Sol, finding 1 of
 * docs/plans/260831b-stage3-items3and4-review-sol.md. The column is written once
 * by `beginDraftIn` and is `mint` in `REVISION_CARRY_POLICY`
 * (src/store/pg-revisions.ts) — carried, a draft would inherit its parent's base
 * and the hole would reopen one generation along.
 *
 * A draft minted before that column existed carries `null`, which is
 * indistinguishable from "this article's first draft" and is refused whenever
 * the article is serving anything. That is fail-closed and it costs at most one
 * re-run of a job that was in flight at the deploy.
 */
export type DraftBase =
  | {
      readonly how: "minted" | "reopened";
      /**
       * **The revision the draft was actually copied from** — `null` for an
       * article's first draft, and for one minted before the column existed.
       *
       * True of `reopened` as well as `minted` since 2026-09-01: both read
       * `article_revisions.based_on_revision_id`, which is written at mint and
       * never changed. It is not "what the article is serving now", and the two
       * being confused is the bug this type is here to make impossible to
       * repeat.
       */
      readonly revisionId: string | null;
    }
  | { readonly how: "unknown"; readonly why: string };

/**
 * What `openOrBeginJobDraft` just answered, read as a base.
 *
 * **One line, and no query.** It was a second *statement* — a SELECT of
 * `articles.current_revision_id` — for as long as the reopen branch had nothing
 * to say about lineage, and that was two faults rather than one: the number was
 * the wrong number, and it was read outside the transaction that had just
 * decided which draft this is, so a publication landing in between was read as
 * the base too. Both close the same way: `openOrBeginJobDraft` returns the
 * lineage it read under the article lock, and this only labels it.
 */
export function draftBaseOf(draft: OpenDraftResult): DraftBase {
  return { how: draft.created ? "minted" : "reopened", revisionId: draft.basedOn };
}

/**
 * Refuse a publication that would bury a revision this draft never saw.
 *
 * Called **inside** the publishing transaction, with the pointer
 * `publishRevisionIn` just moved off (`previousRevisionId`, read under the
 * article lock). The throw rolls the publication, the step completion and the
 * job's finish back with it, so nothing is left half-done and the job records a
 * failure a person can act on.
 *
 * `PublishRefused` rather than a plain `Error`, and the reason is the wrapper
 * rather than taste: `guardDbStore` scrubs anything without a numeric `status`,
 * so a plain error would reach the reader's job card as *"this app asked its
 * database for something it would not do"*, which is neither true nor
 * actionable. This is a 409 — a draft not fit to publish, not a server fault.
 * No article text in the message, only revision ids (docs/project/logging.md).
 */
export function refuseIfBaseMoved(args: {
  readonly slug: string;
  readonly revisionId: string;
  readonly base: DraftBase;
  readonly publishedOver: string | null;
}): void {
  /* The one way past this guard, and it is a value a caller had to construct on
     purpose rather than a default. See `DraftBase`. */
  if (args.base.how === "unknown") return;
  if (args.base.revisionId === args.publishedOver) return;
  throw new PublishRefused(args.slug, [
    `this draft (${args.revisionId}) was copied from revision ${args.base.revisionId ?? "none"} ` +
      `(${args.base.how}), but the article is now serving ${args.publishedOver ?? "none"} — ` +
      "something else published while this job ran, and publishing now would discard it. " +
      "Nothing was published; run the job again against what is there.",
  ]);
}

export interface PgStoreSessionOptions {
  /** The draft this claim owns — `openOrBeginJobDraft`'s answer, plus the claim. */
  readonly ref: JobDraftRef;
  /**
   * The revision the draft was copied from, so the publication can check that it
   * is still the one being replaced. See `DraftBase`.
   *
   * **Required, and there is no "do not check" value.** An optional base would
   * be a guard that is off by default in exactly the callers that forgot it, and
   * this one has been forgotten for five reviews already.
   */
  readonly base: DraftBase;
  /** Overridable so a test can drive two sessions down one connection. */
  readonly db?: Db;
}

/**
 * Open (or reopen) this claim's draft and build the session over it.
 *
 * The production shape, and the shape the tests use: a session is built **once
 * per successful claim**, immediately after `claim` returns, because a Postgres
 * draft reference embeds the attempt token and a session built per job would be
 * stale on the second request.
 */
export async function openPgStoreSession(opts: {
  readonly slug: string;
  readonly job: { readonly id: string; readonly attemptId: string };
}): Promise<StoreSession> {
  const draft = await openOrBeginJobDraft({ slug: opts.slug, job: opts.job });
  return pgStoreSession({
    ref: {
      slug: opts.slug,
      articleId: draft.articleId,
      revisionId: draft.revisionId,
      jobId: opts.job.id,
      attemptId: opts.job.attemptId,
    },
    /* The draft's own record of what it was made from, carried straight off
       `openOrBeginJobDraft`'s answer. The question is never "what is the
       article serving" — by the time this draft publishes the article may be
       serving something else, and that is precisely the case the guard refuses.
       See `DraftBase`. */
    base: draftBaseOf(draft),
  });
}

/**
 * A session over one job's draft, with the commit as one transaction.
 *
 * The returned object goes through `guardDbStore`, which is the other half of
 * the note at the head of the settlement helpers in src/store/pg-jobs.ts:
 * `releaseStepIn` and `finishIn` are free functions and cannot be wrapped, so a
 * raw Drizzle error out of either of them — query text and bound parameters in
 * `Error.message` — would otherwise reach whatever is rendering the job card.
 * One of those rendered on the homepage on 2026-08-27.
 *
 * **`reads` is wrapped separately and on purpose.** `guardDbStore` walks own
 * enumerable *function* properties; `reads` is an object, so it is copied
 * across untouched and its six methods would be unguarded. Wrapping it as its
 * own store keeps the generics: the wrapper is `<T>(what, store: T): T`, so
 * `read<K>` and `readBaseline<K>` come back with their type parameter intact
 * rather than collapsed to `unknown`.
 */
export function pgStoreSession(options: PgStoreSessionOptions): StoreSession {
  const { ref, base } = options;
  const db = options.db ?? getDb();
  const job = { id: ref.jobId, attemptId: ref.attemptId };

  /**
   * The article row, locked, and **confirmed to be the one this draft is in.**
   *
   * The identity check is not decoration. `ref.articleId` came from
   * `openOrBeginJobDraft`; if the row now under this slug is a different one,
   * the article was deleted and re-created under us, and everything below would
   * write a perfectly valid draft into an article nobody is reading.
   */
  const lockArticleFor = async (tx: Tx, slug: string): Promise<void> => {
    const article = await lockOrCreateArticle(tx, slug);
    if (article.id !== ref.articleId) {
      throw new Error(
        `The article for "${slug}" is now ${article.id}, but this session's draft belongs to ` +
          `${ref.articleId}. Refusing to commit into an article this draft is not part of.`,
      );
    }
  };

  /**
   * Fail the draft and take the job's pointer off it, **unfenced**.
   *
   * Used only after `releaseStepIn` has already ended the job as cancelled —
   * case 4. `failRevisionIn`'s own fence requires `status = 'running'`, and by
   * then the status is `cancelled` and the token is null, so the fenced form
   * cannot be used and calling it would refuse rather than clean up.
   *
   * **It is safe on the commit path and it is reachable from nowhere else, and
   * the second half of that is what makes the first half true.** `commit`'s
   * artefact write has already proved job, attempt, status *and* draft
   * ownership through `requireLiveJobOwnsDraft`, and it holds the job row's
   * `for update` lock from then on, so the pointer cannot move underneath this.
   * `releaseStepIn` on its own would not be that fence: it checks job, attempt
   * and status and says nothing at all about which draft the job points at. An
   * earlier version of this comment credited the fence to `releaseStepIn` alone
   * and to "one statement earlier", which was false for any caller that had not
   * written artefacts first — so `settleJob` no longer accepts a `release` at
   * all (`JobEndTransition` in src/store/session.ts). GPT Sol, 2026-08-30,
   * docs/plans/260827aa-delete-the-importer-d1b-sol.md finding 4.
   *
   * The pointer update names the revision it expects as well, so it cannot
   * clear somebody else's.
   */
  const discardAfterCancel = async (tx: Tx, slug: string, reason: string): Promise<Announcement> => {
    const failed = await failRevisionIn(tx, { slug, revisionId: ref.revisionId, reason });
    const cleared = await tx
      .update(jobsTable)
      .set({ draftRevisionId: null })
      .where(and(eq(jobsTable.id, job.id), eq(jobsTable.draftRevisionId, ref.revisionId)));
    if (cleared.rowCount !== 1) {
      /* **A throw, and it rolls the cancellation back with it.** Given the fence
         above, exactly one row is the only answer this statement can have — so
         any other answer means something believed about this transaction is not
         true, and the two things it could mean are both worse than an ending
         that has to be made again. Zero rows is a draft the sweeper spares for
         ever, which is the leak this case exists to close; more than one is a
         pointer clear that reached a job this session does not own. The caller
         records the throw as a step failure and ends the job through
         `settleJob`, which fails the draft and clears the pointer on its own
         fence. A warning here left the job cancelled and the draft immortal,
         which is the silent half. */
      throw new Error(
        `Cancelling job ${job.id} cleared ${cleared.rowCount} draft pointers rather than 1. ` +
          "The job row is locked by this transaction and its pointer was proved to be " +
          `${ref.revisionId} before the artefacts were written, so neither answer is possible.`,
      );
    }
    return { failed: { revisionId: ref.revisionId, reason, changed: failed.changed } };
  };

  /** Why a draft is being thrown away, in the words the ending already has. */
  const reasonFor = (ending: JobEnding): string =>
    ending.error ?? `the job ended ${ending.status} with no message`;

  /**
   * The whole of the state machine, inside the caller's transaction.
   *
   * Returns what happened **and** what the caller should log once the
   * transaction has committed — `publishRevisionIn` and `failRevisionIn`
   * deliberately return their log fields rather than printing them, because a
   * `logger.info` in here would announce a publication that a later statement
   * then rolls back.
   */
  const settleIn = async (
    tx: Tx,
    slug: string,
    transition: JobTransition,
    /**
     * The step this session begun and never finished, if there is one.
     *
     * Passed in rather than read off `begunStep` at the point of use, because
     * the two callers know different things about it and only one of them is
     * looking at a `revision_step_runs` row that is still `running`: `commit`
     * has just finished the row inside this same transaction, and asking to
     * finish it a second time would be refused by `finishStepRun`'s fence and
     * take the whole commit down with it.
     *
     * It is only read on the failing branch, and there is no case where it
     * arrives with a `done` ending: the all-skipped claim that ends `done`
     * through `settleJob` never begins a step at all. Worth knowing if that ever
     * changes — the publication gate checks the `hierarchy` run row and no other, so a
     * revision published with some *other* step still `running` would not be
     * refused by it.
     */
    unfinished?: StepName,
  ): Promise<{ settlement: JobSettlement; announce: Announcement }> => {
    /**
     * **The step is done and the job goes on, holding its claim.** Case 0, and
     * it is the one the coordinator takes between the steps of a walk.
     *
     * Nothing about the *job row* belongs in this transaction. The step's
     * artefacts and its `revision_step_runs` row have just been written by the
     * caller and are what `stepIsDone` reads; the job's `steps` array is a
     * progress bar, written by `noteProgress` outside this transaction and
     * deliberately not renewing the lease. Widening the transaction to touch
     * the job row for a field nothing decides anything on would take the job
     * lock on every step of a walk for no gain.
     *
     * **And the draft stays exactly where it is**, which is the whole point of
     * keeping the claim: the next step in this same walk writes into it.
     */
    if (transition.kind === "keep") return { settlement: { kind: "kept" }, announce: {} };
    if (transition.kind === "release") {
      /* Case 1 and case 4, and which of the two it is cannot be decided here.
         `releaseStepIn`'s `case when cancelling` is the authority on it; asking
         the flag separately and predicting the answer would be a second copy of
         the same decision, free to drift from the statement that makes it. */
      const after = await releaseStepIn(
        tx,
        transition.jobId,
        transition.attempt,
        transition.steps,
        transition.fields,
      );
      const settlement = settlementOf(transition, after);
      /* Narrowed on `ended` rather than on "not released", because the union
         now carries `kept` too — and a `keep` never reaches here, so the
         remaining case would type as `kept | ended` and lose its `ending`. */
      if (settlement.kind !== "ended") return { settlement, announce: {} };
      return {
        settlement,
        announce: await discardAfterCancel(tx, slug, reasonFor(settlement.ending)),
      };
    }

    const { ending } = transition;
    /* Cases 2, 3 and 5. The draft is disposed of **before** the job row moves,
       and that ordering is required rather than tidy: both disposals fence on
       `status = 'running'`, and `finishIn` is the statement that stops that
       being true. */
    let announce: Announcement;
    if (ending.status === "done") {
      /* **Publish, rather than discard, and this is the one place that choice is
         live.** A `done` ending reaches here from two places: a last step that
         ran (case 2), and a claim where every step skipped (case 5). In the
         second the draft is usually a byte-for-byte copy of what is published
         and either answer looks the same — but not always. A two-step job whose
         first request ran `fetch` and *released*, and whose second request found
         every step current, holds that first request's real work in a draft
         nothing has published. Discarding would lose it and report the job done:
         a silent success, in the path built to prevent them.
         `publishRevisionIn` fences on the live attempt and clears the draft
         pointer as it goes. */
      const published = await publishRevisionIn(tx, { slug, revisionId: ref.revisionId, job });
      /* **After the publication, and inside its transaction.**
         `previousRevisionId` is `articles.current_revision_id` read under the
         article lock a statement before it moved, which is the only reading of
         it that cannot be stale. A mismatch throws and takes the whole
         transaction — publication, step, job ending — back with it. */
      refuseIfBaseMoved({
        slug,
        revisionId: ref.revisionId,
        base,
        publishedOver: published.previousRevisionId,
      });
      announce = { published };
    } else {
      /* **The step that was begun and never finished is marked `error` first.**
         A stage that threw, or that the reader stopped, leaves the row
         `beginStep` committed saying `running` — and nothing else ever revisits
         it, so the draft keeps a step that claims to be in flight for as long as
         the row survives. `interrupted` reads exactly that status, so the next
         claim over this draft would refuse to believe the step had ended.

         **Before the two below, and that ordering is required rather than
         tidy.** `finishStepRun` takes `requireLiveJobOwnsDraft`, which asks that
         the job still be `running` and still point at this revision;
         `failRevisionIn` clears the pointer and `finishIn` changes the status,
         so either of them going first makes this refuse. GPT Sol, 2026-08-30,
         docs/plans/260827aa-delete-the-importer-d1b-sol.md finding 2. */
      if (unfinished) {
        await finishStepRun(
          { revisionId: ref.revisionId, stepName: unfinished, job, status: "error" },
          tx,
        );
      }
      const reason = reasonFor(ending);
      const failed = await failRevisionIn(tx, { slug, revisionId: ref.revisionId, reason, job });
      announce = { failed: { revisionId: ref.revisionId, reason, changed: failed.changed } };
    }

    const after = await finishIn(tx, transition.jobId, transition.attempt, ending);
    return { settlement: settlementOf(transition, after), announce };
  };

  /** Everything the transaction decided, said out loud now that it has committed. */
  const announce = (slug: string, what: Announcement): void => {
    if (what.published) logPublication({ slug }, what.published);
    if (what.failed) {
      logDraftFailure(
        { slug, revisionId: what.failed.revisionId, reason: what.failed.reason },
        { changed: what.failed.changed },
      );
    }
  };

  /**
   * `NotTheLiveAttempt` is this store's way of saying what `StaleAttemptError`
   * says, and src/jobs.ts only knows the second one — it answers `busy` on an
   * `instanceof` and would otherwise turn a lost claim into a 500. Translated at
   * this boundary, which is the only place that knows both vocabularies.
   */
  const asStaleClaim = (err: unknown): never => {
    if (err instanceof NotTheLiveAttempt) throw new StaleAttemptError(job.id);
    throw err;
  };

  /**
   * The step `beginStep` started and nothing has finished yet.
   *
   * **Session state, because there is nowhere else it could live.** The runner
   * begins a step, runs it, and — when it throws or is stopped — ends the job
   * through `settleJob`, which is handed a `JobEnding` and knows nothing about
   * steps. Threading the name through `endJob` would put a Postgres-only
   * argument on the filesystem seam as well; a session is already one claim's
   * worth of state, and one claim runs one step (see `openPgStoreSession`).
   *
   * Cleared only once a transaction that finished the row has **committed**.
   * Clearing it inside `commit`'s transaction would be wrong in the one case
   * that matters: a commit that rolls back leaves the row `running` again.
   */
  let begunStep: StepName | undefined;

  const session: StoreSession = {
    reads: guardDbStore("session.reads", readsPgArtifacts(ref, db)),

    /**
     * **Its own transaction, and that is the point of it.**
     *
     * The `revision_step_runs` row saying *running* has to be committed before
     * `run` is called, or nothing records that this step started — and an
     * interrupted step that left no mark is one the next claim skips. It is the
     * Postgres counterpart of the `.running` marker file, and the same rule
     * applies: it is cleared only on the success path, so a throw, a cancel or a
     * kill all leave the step honestly not-done.
     *
     * Through `pgArtifactsIn` rather than calling `beginStepRun` directly, so
     * that the "is this store even about that article" refusal is the same one
     * `write` and `finishStep` make, from the same line.
     */
    async beginStep(slug, step) {
      const attempt = await db
        .transaction((tx) => pgArtifactsIn(ref, tx).beginStep(slug, step))
        .catch(asStaleClaim);
      /* **After the transaction, never before.** A `beginStep` that was refused
         left no `running` row, and a session that remembered one anyway would
         send a settlement off to finish a row that is not there — turning a
         step failure into `StepRunNotHeld` and a job that never ends. */
      begunStep = step;
      return attempt;
    },

    async settleJob(transition: JobEndTransition) {
      const slug = ref.slug;
      let announced: Announcement = {};
      const settled = await db
        .transaction(async (tx) => {
          await lockArticleFor(tx, slug);
          const { settlement, announce: what } = await settleIn(
            tx,
            slug,
            transition,
            /* The whole reason this session remembers anything: an ending with
               no product is an ending after a step that started and did not
               finish. See `begunStep`. */
            begunStep,
          );
          announced = what;
          return settlement;
        })
        .catch(asStaleClaim);
      begunStep = undefined;
      announce(slug, announced);
      return settled;
    },

    async commit(ctx, step, attempt, product, transition) {
      /* **Before the transaction opens**, because it is a claim about the
         product and not about the database, and a refusal that has not touched
         Postgres is one nothing has to roll back. */
      checkProduct(step, product, NOTHING_UNCONVERTED);

      let announced: Announcement = {};
      const settled = await db
        .transaction(async (tx) => {
          /* **The article, first, before anything takes the job row.** See the
             file header: the order has to hold on the commits that will never
             publish, or one of them deadlocks with a publication. */
          await lockArticleFor(tx, ctx.slug);

          const artifacts = pgArtifactsIn(ref, tx);
          if (product.parts) {
            await artifacts.write(ctx.slug, step.name, product.parts, product.stamp ?? {});
          }
          /* Asked of the same transaction that just wrote, so it sees this
             step's own uncommitted writes and nothing else's. `checkProduct`
             knows what the step *says* it made; this knows what the store can
             read back. */
          await assertProduced(step, ctx, readsPgArtifacts(ref, tx));
          await artifacts.finishStep(ctx.slug, step.name, attempt);

          /* **No unfinished step**, because the line above just finished it in
             this transaction. `settleIn` would otherwise ask `finishStepRun` to
             end a row that is already `done`, its fence would refuse, and a
             perfectly good commit would roll back — which is reachable, since
             `transitionAfter` returns an `end` with a `cancelled` or
             `interrupted` ending after a step that ran to completion. */
          const { settlement, announce: what } = await settleIn(tx, ctx.slug, transition);
          announced = what;
          return settlement;
        })
        .catch(asStaleClaim);
      /* Only now: a commit that threw rolled its `finishStep` back with
         everything else, and the row is `running` again for the settlement that
         follows the failure. */
      begunStep = undefined;
      announce(ctx.slug, announced);
      return settled;
    },
  };

  return guardDbStore("session", session);
}
