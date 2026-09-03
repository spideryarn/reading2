/**
 * **A bug report, written down before it goes anywhere else.**
 *
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md. The reader
 * presses Feedback, answers three questions, and this is the row that makes the
 * answer durable. A copy also goes to Sentry; the row is the authoritative one,
 * it is written first, and its success is what the reader is told about.
 *
 * ## One transaction, four steps, and the order is the design
 *
 * 1. **An owner-scoped advisory lock**, taken first.
 * 2. **Idempotency**: this reader already filed this id ⇒ `duplicate`, nothing
 *    written.
 * 3. **The cap**: ten reports an hour ⇒ `limited`, nothing written.
 * 4. Insert, and answer `created`.
 *
 * **The lock is not decoration.** `count` then `insert` is raceable: concurrent
 * requests all see the same count and all insert, so a "cap" without it is a
 * suggestion. It is `pg_advisory_xact_lock` and never the session form, because
 * Supabase's transaction pooler silently does nothing with session advisory
 * locks (src/db/client.ts) — the transaction-scoped one is held on the same
 * connection the transaction is on, and released when it ends, however it ends.
 *
 * **The lock comes before the idempotency read**, which is the one place this
 * differs from a naive reading of the steps. With it second, two copies of one
 * retry both find nothing, then serialise on the lock, and the loser gets a raw
 * uniqueness error that src/routes.ts turns into a 500 — the reader's report
 * fails for a reason that is not about their report. This is the same lesson
 * `pg-comments.ts` records about `on conflict`: close the gap between looking
 * and writing rather than narrowing it.
 *
 * **Idempotency comes before the cap** for a reason that shows up only when both
 * fire: a reader whose submit timed out and was retried must be told their
 * report is filed — it is — rather than being told they are rate-limited by
 * their own report. tests/feedback-store.test.ts pins that ordering.
 *
 * ## What may be logged from this file
 *
 * **Lengths, never text.** The id, the counts, the route, the slug, how many
 * characters were written — never `body`, and never the reporter's email. This whole feature is a deliberate exception to
 * src/monitoring-scrub.ts's rule about a reader's words leaving the machine, and
 * the exception is the *Sentry* channel the reader consented to, not the log
 * this file writes. docs/project/logging.md.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { feedback as feedbackTable } from "../db/schema.js";
import { log } from "../log.js";
import { currentOwnerId } from "../owner.js";
import type {
  FeedbackDiagnosticsPayload,
  FeedbackEnvironment,
  FeedbackKind,
} from "../types.js";
import {
  FEEDBACK_HOURLY_CAP,
  FEEDBACK_WINDOW_MS,
  type FeedbackReport,
  type FeedbackStore,
  type FeedbackSubmission,
  type NewFeedback,
} from "./contracts.js";
import { guardDbStore } from "./db-errors.js";

const logger = log("store");

/**
 * The first half of the advisory lock's two-integer key — a namespace, so this
 * feature's lock cannot collide with another's on a shared hash space.
 *
 * The second half is `hashtext(owner_id)`. `hashtext` is an internal function
 * with no cross-version stability guarantee, and that costs nothing here: the
 * only thing the value has to do is agree with itself, in one database, between
 * two transactions running at the same moment. Two owners whose ids happen to
 * hash alike serialise with each other, which is slower and never wrong.
 */
const FEEDBACK_LOCK_NAMESPACE = 4919;

/**
 * What a read of a report selects — **everything except the screenshot's
 * bytes**.
 *
 * `octet_length` rather than the column: nothing that reads a report wants 300
 * KB of PNG, and a list of reports that dragged one per row through memory to
 * show a tick would be the wrong default in the one place we would not notice.
 */
const REPORT_COLUMNS = {
  id: feedbackTable.id,
  reporterEmail: feedbackTable.reporterEmail,
  body: feedbackTable.body,
  kind: feedbackTable.kind,
  consented: feedbackTable.consented,
  url: feedbackTable.url,
  slug: feedbackTable.slug,
  buildCommit: feedbackTable.buildCommit,
  environment: feedbackTable.environment,
  requestVercelId: feedbackTable.requestVercelId,
  diagnostics: feedbackTable.diagnostics,
  diagnosticsVersion: feedbackTable.diagnosticsVersion,
  screenshotBytes: sql<number | null>`octet_length(${feedbackTable.screenshot})`,
  mirrorAttemptedAt: feedbackTable.mirrorAttemptedAt,
  mirroredAt: feedbackTable.mirroredAt,
  sentryEventId: feedbackTable.sentryEventId,
  createdAt: feedbackTable.createdAt,
};

/**
 * The shape `REPORT_COLUMNS` comes back as, written out rather than inferred.
 *
 * Written out because it is then *checked*: every call below hands Drizzle's
 * own inferred row to `toReport`, so a column dropped from the selection, or a
 * type that turns out not to be what this file assumed, is a compile error at
 * the call site rather than an `undefined` in a report months later.
 */
interface ReportRow {
  id: string;
  reporterEmail: string;
  body: string;
  /** `text` in the database, a closed union or null in TypeScript — see `toReport`. */
  kind: string | null;
  consented: boolean;
  /** `text` in the database, a closed union in TypeScript — see `toReport`. */
  url: string | null;
  slug: string | null;
  buildCommit: string | null;
  environment: string;
  requestVercelId: string | null;
  diagnostics: FeedbackDiagnosticsPayload;
  diagnosticsVersion: number | null;
  screenshotBytes: number | null;
  mirrorAttemptedAt: Date | null;
  mirroredAt: Date | null;
  sentryEventId: string | null;
  createdAt: Date;
}

/**
 * A row as a report.
 *
 * The two casts are honest rather than hopeful: `environment` and
 * `kind` are `text` columns with CHECK constraints holding the **same** values
 * the TypeScript unions do (src/db/schema.ts), so a value outside the union
 * cannot be in the column. `kind` is checked for null first, because null is a
 * member of its domain and not of its union.
 */
function toReport(row: ReportRow): FeedbackReport {
  const version = row.diagnosticsVersion;
  return {
    id: row.id,
    reporterEmail: row.reporterEmail,
    body: row.body,
    kind: row.kind === null ? null : (row.kind as FeedbackKind),
    consented: row.consented,
    url: row.url,
    slug: row.slug,
    buildCommit: row.buildCommit,
    environment: row.environment as FeedbackEnvironment,
    requestVercelId: row.requestVercelId,
    /* The pair is stored in two columns and handed back as one thing — which is
       what the `feedback_diagnostics_version` CHECK exists to make safe. */
    diagnostics: version === null ? null : { version, payload: row.diagnostics },
    screenshotBytes: row.screenshotBytes,
    mirrorAttemptedAt:
      row.mirrorAttemptedAt === null ? null : row.mirrorAttemptedAt.toISOString(),
    mirroredAt: row.mirroredAt === null ? null : row.mirroredAt.toISOString(),
    sentryEventId: row.sentryEventId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** How much the reader wrote. The one number this file logs about their words. */
function charsIn(input: NewFeedback): number {
  return input.body.length;
}

const rawPgFeedbackStore: FeedbackStore = {
  async submit(input: NewFeedback): Promise<FeedbackSubmission> {
    const db = getDb();
    const ownerId = currentOwnerId();

    /**
     * **A versioned blob with nothing in it is not diagnostics.**
     *
     * Normalised here rather than left to the insert, because the two columns
     * must agree — `feedback_diagnostics_version` says so — and Drizzle writes a
     * `null` payload as SQL NULL, which would leave a version standing beside an
     * absent blob and fail the constraint at the last possible moment.
     */
    const diagnostics =
      input.diagnostics === null ||
      input.diagnostics.payload === null ||
      input.diagnostics.payload === undefined
        ? null
        : input.diagnostics;

    /**
     * **`read committed`, said out loud.**
     *
     * It is PostgreSQL's default, so this changes nothing today — and the
     * correctness argument above *depends* on it, which is exactly why it is
     * written down rather than inherited. Under `repeatable read` the lock
     * statement can establish a snapshot before it starts waiting, so the reads
     * after the wait would be taken from before the transaction that held the
     * lock committed: the idempotency check would miss the row it is looking
     * for, and the cap would count one short. GPT Sol's code review,
     * 2026-08-31. A `default_transaction_isolation` set on the role or the
     * database would do that silently, and nothing would fail on a laptop.
     */
    return db.transaction(async (tx) => {
      /* Step 1. Everything below happens one submit at a time, per owner. */
      await tx.execute(
        sql`select pg_advisory_xact_lock(${sql.raw(String(FEEDBACK_LOCK_NAMESPACE))}, hashtext(${ownerId}))`,
      );

      /* Step 2. Already filed? Hand back what is STORED, not what has just been
         submitted: a retry that differs in its text must not overwrite the
         reader's first telling, and reporting the new text back would hide
         that it had been ignored. */
      const [existing] = await tx
        .select(REPORT_COLUMNS)
        .from(feedbackTable)
        .where(and(eq(feedbackTable.ownerId, ownerId), eq(feedbackTable.id, input.id)));
      if (existing) {
        logger.info({ id: input.id, repeat: true }, "feedback report already filed");
        return { kind: "duplicate", report: toReport(existing) };
      }

      /* Step 3. The cap, over the index this table has for exactly this query.
         The oldest rows rather than a bare `count`, because the same read
         answers both "how many" and "when does the window free up" — and it is
         bounded by the cap, so it cannot grow into a scan.

         **One clock, and it is the database's.** The cutoff and the retry both
         come from `now()` in the same statement that reads `created_at`, rather
         than from `Date.now()` here. `created_at` is written by the database, so
         comparing it against this process's clock made the cap sensitive to skew
         between them — tighter than an hour in one direction and looser in the
         other, on a serverless instance whose clock nobody watches. GPT Sol's
         code review, 2026-08-31. `now()` is the transaction's start time, so it
         is also the same instant for both halves of this. */
      const windowSeconds = FEEDBACK_WINDOW_MS / 1000;
      const recent = await tx
        .select({
          retryAfterMs: sql<number>`ceil(extract(epoch from (${feedbackTable.createdAt} + make_interval(secs => ${windowSeconds}) - now())) * 1000)::double precision`,
        })
        .from(feedbackTable)
        .where(
          and(
            eq(feedbackTable.ownerId, ownerId),
            sql`${feedbackTable.createdAt} >= now() - make_interval(secs => ${windowSeconds})`,
          ),
        )
        .orderBy(asc(feedbackTable.createdAt))
        .limit(FEEDBACK_HOURLY_CAP);
      const oldest = recent[0];
      if (recent.length >= FEEDBACK_HOURLY_CAP && oldest) {
        /* At least a millisecond: a `retryAfterMs` of 0 is a header that tells
           the client to try again immediately, for ever. */
        const retryAfterMs = Math.max(1, Math.ceil(Number(oldest.retryAfterMs)));
        logger.warn(
          { recent: recent.length, retryAfterMs },
          "feedback report refused: hourly cap",
        );
        return { kind: "limited", retryAfterMs };
      }

      /* Step 4. **A plain insert, on purpose.** Under the lock a conflicting id
         cannot reach here, so `on conflict do nothing` would only hide the fact
         that the lock had stopped working — which is a thing to be told about
         loudly rather than to paper over. */
      const [created] = await tx
        .insert(feedbackTable)
        .values({
          id: input.id,
          ownerId,
          reporterEmail: input.reporterEmail,
          body: input.body,
          kind: input.kind,
          consented: input.consented,
          url: input.url,
          slug: input.slug,
          buildCommit: input.buildCommit,
          environment: input.environment,
          requestVercelId: input.requestVercelId,
          diagnostics: diagnostics === null ? null : diagnostics.payload,
          diagnosticsVersion: diagnostics === null ? null : diagnostics.version,
          screenshot: input.screenshot === null ? null : Buffer.from(input.screenshot),
        })
        .returning(REPORT_COLUMNS);
      if (!created) {
        /* `returning` over an insert that inserted nothing. There is no path
           here that should produce it, which is exactly why it must not be
           swallowed into a resolved value the route would report as success. */
        throw new Error("feedback insert returned no row");
      }

      const report = toReport(created);
      /* Lengths, never text. `chars` is how much the reader wrote, across all
         three answers; the email is not logged at all. */
      logger.info(
        {
          id: report.id,
          chars: charsIn(input),
          consented: input.consented,
          url: input.url,
          slug: input.slug,
          screenshotBytes: report.screenshotBytes,
          diagnosticsVersion: report.diagnostics?.version ?? null,
        },
        "feedback report filed",
      );
      return { kind: "created", report };
    }, { isolationLevel: "read committed" });
  },

  async read(id: string): Promise<FeedbackReport | null> {
    const [row] = await getDb()
      .select(REPORT_COLUMNS)
      .from(feedbackTable)
      .where(and(eq(feedbackTable.ownerId, currentOwnerId()), eq(feedbackTable.id, id)));
    return row ? toReport(row) : null;
  },

  async markMirrorAttempted(id: string): Promise<void> {
    /* **The honest half.** We have an event id, so the event exists and has been
       handed to the SDK — nothing more than that, and this column says nothing
       more than that. Owner-scoped like every other query here. */
    const updated = await getDb()
      .update(feedbackTable)
      .set({ mirrorAttemptedAt: new Date() })
      .where(and(eq(feedbackTable.ownerId, currentOwnerId()), eq(feedbackTable.id, id)))
      .returning({ id: feedbackTable.id });
    logger.info({ id, rows: updated.length }, "feedback report handed to sentry");
  },

  async markMirrored(id: string, sentryEventId: string | null): Promise<boolean> {
    /* One statement, so `mirrored_at` and `sentry_event_id` cannot disagree —
       `feedback_mirrored_pair` refuses an event id with no time anyway, and this
       is what makes that constraint something nobody has to think about.

       **`mirrored_at is null` in the WHERE**, so a second mark cannot overwrite
       the first. Two acknowledgements for one report should not be possible, and
       if they ever are, the first one is the true one and the second is a bug
       worth being able to see rather than one that has already tidied itself up.

       Owner-scoped like every other query in this file. Updating nothing is not
       an error: the row belongs to somebody else, has been removed, or was
       already marked. */
    const updated = await getDb()
      .update(feedbackTable)
      .set({ mirroredAt: new Date(), sentryEventId })
      .where(
        and(
          eq(feedbackTable.ownerId, currentOwnerId()),
          eq(feedbackTable.id, id),
          isNull(feedbackTable.mirroredAt),
        ),
      )
      .returning({ id: feedbackTable.id });
    /* **The answer, not a log line.** An update that matched nothing and one
       that marked the report look identical from here otherwise, and the first
       is how `mirrored_at is null` would quietly stop meaning anything. The
       caller gets to decide what to do about it; this file says what happened. */
    const marked = updated.length === 1;
    logger.info({ id, marked }, "feedback report mirrored");
    return marked;
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgFeedbackStore: FeedbackStore = guardDbStore("feedback", rawPgFeedbackStore);
