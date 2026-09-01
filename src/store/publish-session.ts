/**
 * The finalizer: when a job ends `done`, put the files it just wrote into
 * Postgres and make them the article a reader opens — in one transaction with
 * the job's own finish.
 *
 * > A finished job publishes nothing. `publishRevision` is called only from
 * > `revisions.ts`, the fixture loader and tests — never from `jobs.ts` or
 * > `pipeline.ts`. Publication today is a human running `npm run db:import`.
 * >
 * > — docs/plans/260830d-v1-imports-on-vercel.md § What is broken, measured
 *
 * That is the last thing standing between a working ingest and today. The
 * pipeline stages run, write their files, the job goes `done`, and
 * `articles.current_revision_id` never moves, so the reader's shelf stays empty
 * and every check involved reports success.
 *
 * ## Why this is a decorator and not `pgStoreSession`
 *
 * [`pg-session.ts`](pg-session.ts) is the end state and is already written,
 * reviewed and tested. It cannot be the answer yet: it asks `checkProduct` with
 * an **empty** unconverted set, so a step that returns no `parts` is refused by
 * name — and all ten steps are still on `LEGACY_UNCONVERTED_STEPS`, writing
 * their own files inside `run`. It becomes the publish path when D3–D5 convert
 * the stages (docs/plans/260827aa-delete-the-importer.md).
 *
 * So this is the vertical slice GPT Sol asked for — *"a small vertical slice of
 * D1b, not the whole artefact conversion"* (docs/plans/260830a-v1-imports-review-sol.md
 * critical 1). The stages go on writing files; when the job is over, the files
 * are copied through `ArtifactStore` into a draft and published. The copy is
 * `copyArtefacts` (src/store/copy-artefacts.ts), the same call
 * `tests/helpers/load-article.ts` has been driving over fixtures since C7.
 *
 * ## Why it wraps the session rather than sitting in `walkClaim`
 *
 * Because a `done` ending reaches the store through **two** doors and only one
 * of them is `settleJob`:
 *
 * 1. the last step ran, so `transitionAfter` hands `commit` an `end` transition
 *    whose ending is `done`, and the session finishes the job *inside* `commit`;
 * 2. every step skipped, so the walk never calls `commit` and ends the job
 *    through `settleJob` (src/jobs.ts, the line after the step loop).
 *
 * A finalizer bolted onto the coordinator after `endJob` would only ever see the
 * second, and for the first it would arrive **after** the job row already said
 * `done` — which is exactly the crash gap Sol's critical 2 is about: publication
 * committing separately from the terminal settlement leaves a kill between them
 * able to publish an article and fail its job. Wrapping the session puts both
 * doors in one place and lets the publication and the `finishIn` share a
 * transaction, which is the whole requirement.
 *
 * It also sits at the seam `pgStoreSession` will occupy — `PRODUCTION.session`
 * in src/jobs.ts — so removing this later is deleting one line rather than
 * unpicking the coordinator.
 *
 * ## What it does not change
 *
 * **With the filesystem store nothing here runs at all.** src/jobs.ts wraps only
 * when `STORE === "postgres"`; a laptop with the default flag gets the same
 * `fsStoreSession` it got before, unwrapped, and behaves exactly as it did. That
 * is deliberate: local development is the filesystem, and it must not change
 * under people.
 *
 * **A job that failed, was cancelled or was interrupted publishes nothing**, and
 * the reader stays on the revision they already had. Only a `done` ending
 * reaches the publishing branch; everything else is handed straight to the inner
 * session, which writes the ending and stops. That is `failRevision`'s rule
 * without needing `failRevision`: this claim's draft is not opened until the
 * moment it is about to be published, so a job that never gets there has no
 * draft to fail.
 *
 * ## The order inside, and the two rules that are not tidiness
 *
 * **The article lock first, before anything takes the job row.** Article, then
 * job, everywhere — see the header of [`pg-session.ts`](pg-session.ts). A
 * transaction that takes the job lock first and reaches `publishRevisionIn`
 * later still has job→article ordering and can deadlock with an article→job one.
 *
 * **The log line after the transaction commits, never inside it.**
 * `publishRevisionIn` returns its log fields rather than printing them precisely
 * so that a rollback cannot announce a publication that did not happen.
 */
import { getDb } from "../db/client.js";
import type { ArtifactStore } from "./artifacts.js";
import { type JobDraftRef, pgArtifactsIn } from "./artifacts-pg.js";
import { copyArtefacts } from "./copy-artefacts.js";
import { guardDbStore } from "./db-errors.js";
import { StaleAttemptError } from "./jobs.js";
import type { JobEnding } from "./jobs.js";
import type { Job } from "../types.js";
import { finishIn } from "./pg-jobs.js";
import { log } from "../log.js";
import {
  NotTheLiveAttempt,
  PublishRefused,
  failRevision,
  lockOrCreateArticle,
  logPublication,
  openOrBeginJobDraft,
  publishRevisionIn,
} from "./pg-revisions.js";
import { type DraftBase, refuseIfBaseMoved } from "./pg-session.js";
import type { JobEndTransition, JobTransition, StoreSession } from "./session.js";

/**
 * What a job card says when the publication failed for a reason of its own.
 *
 * A whole sentence and no detail, because the detail is a database error whose
 * message carries the bound parameters of the statement that failed — the job's
 * `steps` and its title, which is the article's. See `publishAndFinish`.
 */
const COULD_NOT_PUBLISH =
  "Everything ran, but putting the finished article on your shelf did not go through. " +
  "Nothing was published and your library is unchanged. Trying again is safe.";

/** An error's class name, which is safe to log where its message is not. */
function nameOf(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export interface PublishingSessionOptions {
  /** The claim this session belongs to. One session per successful claim. */
  readonly job: { readonly id: string; readonly attemptId: string };
  /** The article being ingested. */
  readonly slug: string;
  /**
   * Where the stages wrote. The filesystem artefact store in production; a
   * caller may name another, and a test does.
   *
   * **Named rather than reached for**, because the copy has to read the same
   * store the run phase wrote to. A finalizer that imported `fsArtifacts` for
   * itself would be reading a different disk from the one the session's own
   * `reads` answers from the moment anybody injects a session, and the two
   * disagreeing is precisely the silent success this file exists to end.
   */
  readonly from: ArtifactStore;
}

/**
 * Wrap `inner` so that a `done` ending publishes what the stages wrote.
 *
 * Every other call is `inner`'s, unchanged: `reads`, `beginStep`, a `keep`, a
 * `release`, and every ending that is not `done`.
 */
export function publishingSession(
  inner: StoreSession,
  options: PublishingSessionOptions,
): StoreSession {
  const { job, slug, from } = options;
  const db = getDb();
  const plog = log("store").child({ jobId: job.id, slug });

  /**
   * Copy this job's files into a fresh draft, publish it, and finish the job —
   * all of it in one transaction.
   *
   * **The draft is opened lazily, here, and not when the session is built.**
   * `openOrBeginJobDraft` runs its own transaction and cannot be part of this
   * one, so opening it eagerly would mint a draft revision for every job
   * including the ones that fail, and leave `sweepAbandonedDrafts` to reclaim
   * them. Opening it at the moment of publication means a job that never
   * publishes never has a draft, which is why the failing path below needs no
   * `failRevision` at all.
   */
  const publishAndFinish = async (ending: JobEnding): Promise<Job> => {
    const draft = await openOrBeginJobDraft({ slug, job });
    /* **What this draft was copied from**, read before the transaction that
       replaces it. See `DraftBase` in pg-session.ts.

       **Worth far less here than it is there, and saying so is the point.** This
       decorator opens its draft lazily, at the moment of publication, so the
       base is a few milliseconds old and almost nothing can have moved in
       between. `pgStoreSession` opens its draft when the claim starts and
       publishes minutes later, which is the window the guard is really for —
       stage 3 item 4 of docs/plans/260831b-finish-the-database-move.md, and it
       becomes reachable at the flip rather than before it.

       So the reopen branch is not resolved here at all. `pgStoreSession` reads
       the article's current revision for it, which is worth a query there
       because the draft may be minutes old; here it would be a query to compare
       a value with itself, and the case it stands for — a draft this job opened
       on an earlier claim and could not publish — is exactly the one where the
       answer is not knowable without the column that does not exist. */
    const base: DraftBase = draft.created
      ? { how: "minted", revisionId: draft.basedOn }
      : { how: "unknown", why: "a draft reopened by publishingSession records no lineage" };
    const ref: JobDraftRef = {
      slug,
      articleId: draft.articleId,
      revisionId: draft.revisionId,
      jobId: job.id,
      attemptId: job.attemptId,
    };

    let published: Awaited<ReturnType<typeof publishRevisionIn>> | undefined;
    let after: Job;
    try {
      after = await db.transaction(async (tx) => {
        /* **The article, first, before anything takes the job row.** See the
           file header: the order has to hold or this deadlocks with any other
           article→job transaction. Re-locking a row this transaction already
           holds is free, which is why `publishRevisionIn` goes on taking it for
           itself a few lines later. */
        const article = await lockOrCreateArticle(tx, slug);
        if (article.id !== ref.articleId) {
          /* The article was deleted and re-created under us between opening the
             draft and this statement. Everything below would write a perfectly
             valid revision into an article nobody is reading. */
          throw new Error(
            `The article for "${slug}" is now ${article.id}, but this job's draft belongs to ` +
              `${ref.articleId}. Refusing to publish into an article this draft is not part of.`,
          );
        }

        const copied = await copyArtefacts(from, pgArtifactsIn(ref, tx), slug);
        /* **Refuse a copy that moved nothing, before publishing it.** Stolen
           from `loadArticleIntoPg`, and it is the guard that matters most here.
           Carry-forward means a draft opened from a published revision already
           holds that revision's blocks, tree and step runs — so publishing after
           copying zero steps republishes the *old* article and reports the job
           done. The scratch directory could have been empty, or on another
           instance, or half-written, and the result would be indistinguishable
           from an ingest that worked (docs/reusable/silent-success.md). */
        if (copied.length === 0) {
          /* **`PublishRefused`, not a plain `Error`**, and the reason is the
             wrapper below rather than taste: `guardDbStore` scrubs everything
             that is not on its allowlist, so a plain error here would reach the
             reader's job card as *"this app asked its database for something it
             would not do"* — which is neither true nor actionable. Anything with
             a numeric `status` passes through, and 409 is what this is: a draft
             not fit to publish rather than a server fault. */
          throw new PublishRefused(slug, [
            "the pipeline store has no complete step for it, so the copy moved nothing — " +
              "publishing now would republish whatever is already in Postgres and call it an " +
              "ingest",
          ]);
        }

        /* Fences on the live attempt and clears `jobs.draft_revision_id` as it
           goes, so no pointer is left for the sweeper to treat as ownership. */
        published = await publishRevisionIn(tx, { slug, revisionId: ref.revisionId, job });
        /* **The base has to still be the base.** The article identity check
           above catches a slug re-created under us; this catches the commoner
           thing, which is a *revision* published under us — by `db:import`, by
           a hand-run `publishRevision`, or by another job — between this draft
           being copied and this statement. Without it the copy quietly wins and
           the other publication is gone. Stage 3 item 4 of
           docs/plans/260831b-finish-the-database-move.md. The throw rolls the
           publication and `finishIn` back together. */
        refuseIfBaseMoved({
          slug,
          revisionId: ref.revisionId,
          base,
          publishedOver: published.previousRevisionId,
        });

        /* **Last, and inside the same transaction as the publication.** This is
           Sol's critical 2: `importArticle` committed its own transaction before
           the job was settled, so a kill in between left the article published,
           the job `running` until `failExpired` failed it, and Retry blocked by
           a guard that now saw an article. Either both of these happened or
           neither did. */
        return await finishIn(tx, job.id, job.attemptId, ending);
      });
    } catch (err) {
      /* **The draft was committed by `openOrBeginJobDraft` and this rollback
         does not take it back.** The job row still points at it and is still
         `running`, and `sweepAbandonedDrafts` reads any job's pointer as
         ownership — including a terminal job's — so leaving it here makes that
         draft immortal. Failing it clears the pointer on its own fence, which
         `status = 'running'` still satisfies because the `finishIn` above rolled
         back with everything else.

         Best-effort, and it swallows its own failure: the caller records this
         throw as the step failure it is, and turning a leaked draft into a
         *different* exception would hide why the publication actually failed.

         **Skipped when the claim itself is what went**, because the fence
         inside `failRevision` is the same one that just refused us and cannot
         pass either — so the call can only fail, and failing here would put an
         alarming error line under every lost claim.

         **That does leave the draft behind, and an earlier version of this
         comment said there was nothing to clean up, which was wrong.** The
         revision this claim opened is a committed `draft` row and stays one.
         What makes it collectable rather than immortal is the *pointer*, not
         this call: `sweepAbandonedDrafts` spares any revision some job's
         `draft_revision_id` names, and the paths that end a job nobody is inside
         — `failExpired` and a queued `requestCancel` — both null that column
         (src/store/pg-jobs.ts). Once they have, the sweeper reclaims it on age.
         So the cost of skipping is a draft that lives until the lease lapses,
         not one that lives for ever. GPT Sol, 2026-08-30,
         docs/plans/260830ad-v1-publish-finalizer-review-sol.md design answer 3. */
      if (!(err instanceof NotTheLiveAttempt) && !(err instanceof StaleAttemptError)) {
        await failRevision({
          slug,
          revisionId: ref.revisionId,
          /* **A fixed sentence, never `err.message`, and this is a logging rule
             rather than tidiness.** `failRevision` logs `reason` verbatim
             (`logDraftFailure`), and the error here is very often a raw Drizzle
             one whose message carries the **bound parameters** of the statement
             that failed — which for `finishIn` is the whole `steps` array and
             the job's title. A step's `detail` may be article prose and the
             title *is* the article's, so interpolating the message put article
             content in a log line, which docs/project/logging.md forbids
             outright. GPT Sol, 2026-08-30,
             docs/plans/260830ad-v1-publish-finalizer-review-sol.md critical 1.

             Nothing is lost by it: the error itself is rethrown two lines down
             and `guardDbStore` logs its SQLSTATE, table and constraint on the
             way out. */
          reason: `the publication transaction for job ${job.id} rolled back`,
          job,
        }).catch((cleanup: unknown) => {
          /* **The class, never the message**, for the same reason as above — and
             `failRevision` is not itself wrapped, so a raw driver error reaches
             here with its parameters in it. `errorFields` does nothing but put
             the error under `err`, and pino serialises its message. */
          plog.error(
            { revisionId: ref.revisionId, errorType: nameOf(cleanup) },
            "could not fail the draft of a publication that rolled back",
          );
        });
      }
      throw err;
    }

    /* **After the commit, never inside it.** `publishRevisionIn` hands its log
       fields back rather than printing them precisely so that a transaction
       which later fails cannot have announced a publication. */
    if (published) logPublication({ slug }, published);
    return after;
  };

  /**
   * `NotTheLiveAttempt` is Postgres's way of saying what `StaleAttemptError`
   * says, and src/jobs.ts only knows the second one — it answers `busy` on an
   * `instanceof` and would otherwise turn a lost claim into a 500. Translated at
   * this boundary, which is the only place that knows both vocabularies.
   */
  const asStaleClaim = (err: unknown): never => {
    if (err instanceof NotTheLiveAttempt) throw new StaleAttemptError(job.id);
    throw err;
  };

  /** True for the one transition this session does anything about. */
  const publishes = (transition: JobTransition): transition is JobEndTransition =>
    transition.kind === "end" && transition.ending.status === "done";

  const session: StoreSession = {
    reads: inner.reads,
    beginStep: (s, step) => inner.beginStep(s, step),

    async commit(ctx, step, attempt, product, transition) {
      if (!publishes(transition)) return await inner.commit(ctx, step, attempt, product, transition);

      /* **The step commits as a `keep`, and then this publishes.** The inner
         session writes the artefacts, checks them and finishes the step; what it
         must *not* do is finish the job, because the job's finish belongs in the
         publication's transaction and there is no way to hand `fsStoreSession`
         one. So the ending it was given is taken off it and made here.

         On the filesystem that costs nothing — the four writes inside
         `fsStoreSession.commit` were never atomic and it says so itself. What is
         bought is that the *only* thing left outside a transaction is the file
         write, which is where v1 has decided to leave it. */
      const kept = await inner.commit(ctx, step, attempt, product, { kind: "keep" });
      if (kept.kind !== "kept") {
        throw new Error(
          `${job.id}: a "keep" settled as "${kept.kind}". The publication has not run and the ` +
            "job row has been written by something that should not have written it.",
        );
      }
      const after = await publishAndFinish(transition.ending).catch(asStaleClaim);
      return { kind: "ended", job: after, ending: transition.ending };
    },

    /**
     * Publish, and **if that fails, end the job before letting the failure go.**
     *
     * The commit door needs none of this: `runStep` catches whatever `commit`
     * throws, records it on the job, and the walk then ends the job through this
     * same `settleJob` with an `error` ending. This door has no such catcher.
     * `endJob` calls it, `walkClaim` re-raises anything that is not a
     * `StaleAttemptError`, and the job row is left exactly as it was — `running`,
     * holding its attempt and the **global** running slot, until the 760-second
     * lease lapses. Every retry until then is told `busy`, and the eventual
     * `failExpired` records a generic interruption rather than what really
     * happened. GPT Sol, 2026-08-30,
     * docs/plans/260830ad-v1-publish-finalizer-review-sol.md, the High finding.
     *
     * So the ending is made here instead, through the inner session — which is
     * the same statement `endJob` would have made — and *then* the error is
     * rethrown. Rethrown rather than swallowed, because the caller was told the
     * job was `done` and it is not: returning the settlement would have
     * `noteEnded` write "job done" into the log for a job that failed.
     *
     * **A lost claim is the one exception**, and it has to be: the inner
     * settlement is fenced on the same attempt that just failed, so it would be
     * refused too. The claim went somewhere else, and `walkClaim` answers `busy`.
     */
    async settleJob(transition: JobEndTransition) {
      /* Every ending that is not `done` — failed, cancelled, interrupted —
         belongs to the inner session unchanged. Nothing is published and the
         reader stays on the revision they already had. */
      if (!publishes(transition)) return await inner.settleJob(transition);
      /* The all-skipped claim: the walk never called `commit`, so this is the
         only door the ending comes through. It still publishes, because the
         files are there and the job is about to say it finished. */
      let after: Job;
      try {
        after = await publishAndFinish(transition.ending);
      } catch (err) {
        if (err instanceof NotTheLiveAttempt || err instanceof StaleAttemptError) {
          throw asStaleClaim(err);
        }
        await inner.settleJob({
          kind: "end",
          jobId: transition.jobId,
          attempt: transition.attempt,
          ending: {
            status: "error",
            steps: transition.ending.steps,
            /* **`PublishRefused`'s own words, or nothing.** That message is ours
               — a slug and a list of reasons naming block ids — and it is the
               one a person can act on. Anything else may be a driver error with
               the failed statement's bound parameters in it, which is article
               content on a job card and in a log. See `publishAndFinish`. */
            error: err instanceof PublishRefused ? err.message : COULD_NOT_PUBLISH,
            /* `retry`, because another go really is the right move: a scratch
               directory that was empty or half there is exactly what re-running
               the whole job fixes. See `canRetry` in src/messages.ts. */
            failureKind: "retry",
            ...(transition.ending.title !== undefined && { title: transition.ending.title }),
          },
        });
        plog.error(
          { errorType: nameOf(err) },
          "a job ended error because its publication failed, not because a step did",
        );
        throw err;
      }
      return { kind: "ended", job: after, ending: transition.ending };
    },
  };

  return guardDbStore("publishing session", session);
}
