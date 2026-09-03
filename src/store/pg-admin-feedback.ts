/**
 * **Every reader's bug reports, with no owner filter** — the data behind
 * `/admin/feedback`. docs/plans/260902l-admin-feedback-page.md.
 *
 * ## Why this is not in pg-admin.ts
 *
 * That file's header is a sustained argument that it returns **counts and dates
 * and nothing else** — *"No title, no URL, no filename, no sentence"* — and it
 * is the paragraph docs/project/admin.md points at when it explains how narrow
 * the cross-owner exception is. Five of its paragraphs become false the moment a
 * `steps` column is selected in it, and a rule that has quietly stopped being
 * true is worse than no rule.
 *
 * So the two cross-owner readers are two files with two arguments, composed into
 * one `AdminStore` in [pg-admin.ts](pg-admin.ts).
 *
 * ## A report is `(owner_id, id)`, never `id`
 *
 * **The single most important sentence in this file.** `feedback`'s primary key
 * is composite (src/db/schema.ts) because the id is *minted by a browser* and is
 * therefore unique within an owner and not globally — `comments` is the same
 * shape for the same reason, and tests/feedback-store.test.ts has a case where
 * Alice and Bob deliberately file reports under one id.
 *
 * Every other reader of this table is owner-scoped, so `where id = …` is
 * complete there and *looks* complete here. It is not: a lookup keyed on the id
 * alone can hand back **somebody else's report**, and the caller has no way to
 * tell. GPT Sol found exactly that in the first draft of this file, 2026-09-02,
 * where the screenshot route was keyed on `id` — Bob's screenshot under Alice's
 * report, with a random-looking id making it read as a one-in-a-million accident
 * rather than as something a caller can simply choose.
 *
 * So both reads take an owner *and* an id, and so does every order and every
 * key built from them.
 *
 * ## The projection is written out, and that is the fence
 *
 * It would be tidier to import [pg-feedback.ts](pg-feedback.ts)'s
 * `REPORT_COLUMNS` and say the only difference is the predicate. That was the
 * first draft, and GPT Sol was right to refuse it: sharing the selection means
 * **a column added to the reader's own report crosses owners the same day**,
 * with no edit at this boundary and nothing to review.
 *
 * The duplication is the point. Adding a field to this page should be a
 * deliberate edit to the list below, and tests/admin-feedback-store.test.ts pins
 * the exact set of keys that comes back, so a field cannot arrive by
 * inheritance.
 *
 * ## What may go in that list
 *
 * The admin pages may show the account metadata documented for `/admin/users`,
 * and **the support report the reader submitted**: what they wrote, an
 * attachment they deliberately added, diagnostics they ticked a box for, and
 * Spideryarn's own fixed correlation metadata. Identifiers may not be followed
 * into articles, comments or notes — a `slug` here is a string to look up by
 * hand, never a join. docs/project/admin.md states the same boundary.
 */

import { and, desc, eq, lt, or, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { feedback as feedbackTable } from "../db/schema.js";
import type {
  AdminFeedbackDetail,
  AdminFeedbackPage,
  AdminFeedbackReport,
  FeedbackCursor,
  FeedbackDiagnosticsPayload,
  FeedbackEnvironment,
  FeedbackKind,
} from "../types.js";
import { ADMIN_FEEDBACK_DEFAULT_LIMIT, ADMIN_FEEDBACK_MAX } from "../types.js";

/**
 * **What crosses owners, written out by hand.** See the header — this list is
 * the fence, not a convenience.
 *
 * `octet_length` rather than the `screenshot` column, and `diagnostics_version`
 * rather than the `diagnostics` blob. Neither is tidiness: the blob's own
 * allowlist permits something like 179 KB of JSON per report
 * (src/feedback-payload.ts), so two hundred of them in one response is tens of
 * megabytes of something nobody has asked to look at, over whatever the
 * platform's response ceiling is. Both come from `readFeedbackAcrossOwners`
 * below, one report at a time, because somebody clicked. GPT Sol, 2026-09-02.
 */
const LIST_COLUMNS = {
  id: feedbackTable.id,
  ownerId: feedbackTable.ownerId,
  reporterEmail: feedbackTable.reporterEmail,
  body: feedbackTable.body,
  kind: feedbackTable.kind,
  consented: feedbackTable.consented,
  url: feedbackTable.url,
  slug: feedbackTable.slug,
  buildCommit: feedbackTable.buildCommit,
  environment: feedbackTable.environment,
  requestVercelId: feedbackTable.requestVercelId,
  diagnosticsVersion: feedbackTable.diagnosticsVersion,
  screenshotBytes: sql<number | null>`octet_length(${feedbackTable.screenshot})`,
  mirrorAttemptedAt: feedbackTable.mirrorAttemptedAt,
  mirroredAt: feedbackTable.mirroredAt,
  sentryEventId: feedbackTable.sentryEventId,
  createdAt: feedbackTable.createdAt,
  /**
   * **The same instant, at the precision the column actually holds.**
   *
   * `timestamptz` is microseconds; a JavaScript `Date` is milliseconds, so
   * `createdAt.toISOString()` — which is what the wire report carries, and
   * rightly — is a *truncation*. Building the keyset cursor from it made the
   * tie-break comparisons in `after()` compare a rounded value against a
   * precise one, so `created_at = <cursor>` matched nothing and paging
   * stopped dead at the first row of any group sharing a timestamp.
   *
   * Caught by tests/admin-feedback-store.test.ts § *keeps a stable order when
   * the timestamps are equal*, 2026-09-02 — a test written for the ordering
   * and which found the cursor instead.
   *
   * `to_char` rather than `::text` so the shape is ISO-8601 with a `T` and a
   * `Z`: `decodeFeedbackCursor` holds it to something `Date.parse` accepts,
   * and Postgres's own text form uses a space and an offset, which is
   * implementation-defined territory for that parser.
   *
   * **Never on the wire report.** It is read off the raw row into the cursor
   * and nowhere else, so the exact-key fence in the test stays exact.
   */
  createdAtExact: sql<string>`to_char(${feedbackTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};

/** The shape `LIST_COLUMNS` comes back as, so `toListed` is checked at its call sites. */
interface ListRow {
  id: string;
  ownerId: string;
  reporterEmail: string;
  body: string;
  kind: string | null;
  consented: boolean;
  url: string | null;
  slug: string | null;
  buildCommit: string | null;
  environment: string;
  requestVercelId: string | null;
  diagnosticsVersion: number | null;
  screenshotBytes: number | null;
  mirrorAttemptedAt: Date | null;
  mirroredAt: Date | null;
  sentryEventId: string | null;
  createdAt: Date;
  /** See `LIST_COLUMNS`. Read into the cursor, never onto the report. */
  createdAtExact: string;
}

/**
 * A row as a report.
 *
 * The casts are the honest ones `pg-feedback.ts` also makes: `environment` and
 * `kind` are `text` columns with CHECK constraints built from the same arrays
 * the TypeScript unions come from, so a value outside the union cannot be in the
 * column. `route_kind` was a third of them until 2026-09-02, when it became the
 * whole `url` — which has no union to cast to, and is checked by `isWebUrl` and
 * a length cap at the route instead. docs/project/feedback.md.
 */
function toListed(row: ListRow): AdminFeedbackReport {
  return {
    id: row.id,
    ownerId: row.ownerId,
    reporterEmail: row.reporterEmail,
    body: row.body,
    /* The same honest cast `environment` gets below, and for the same reason:
       the column is `text` with a CHECK built from the very array the union
       comes from (src/types.ts § FEEDBACK_KINDS), so a value outside it cannot
       be in the column. `null` passes through as itself — it means *they did
       not say*, which is a real answer. (This named `routeKind` as the third
       such cast until 2026-09-03; that column became `url` on 2026-09-02 and
       has no union to cast to.) */
    kind: row.kind as FeedbackKind | null,
    consented: row.consented,
    url: row.url,
    slug: row.slug,
    buildCommit: row.buildCommit,
    environment: row.environment as FeedbackEnvironment,
    requestVercelId: row.requestVercelId,
    diagnosticsVersion: row.diagnosticsVersion,
    screenshotBytes: row.screenshotBytes,
    mirrorAttemptedAt: row.mirrorAttemptedAt === null ? null : row.mirrorAttemptedAt.toISOString(),
    mirroredAt: row.mirroredAt === null ? null : row.mirroredAt.toISOString(),
    sentryEventId: row.sentryEventId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * **Everything strictly after this point in the order.**
 *
 * Keyset rather than `offset`, and on the *whole* sort key rather than on
 * `created_at` alone. An offset shifts under a list that is being written to
 * while it is being read, which for an inbox means a report arriving between two
 * clicks of *Load older* pushes another off the bottom unseen — and the report
 * this page exists to find is precisely an old one nobody knew about.
 *
 * Written as an explicit disjunction rather than SQL's `(a, b, c) < (…)` row
 * comparison: the row form is correct and Drizzle has no builder for it, so it
 * would be a `sql` template with three interpolated values and no type checking.
 * This is longer and the compiler reads it.
 */
function after(cursor: FeedbackCursor) {
  /* **Cast in SQL, never through a JavaScript `Date`.** The column is
     microseconds and a `Date` is milliseconds, so `new Date(cursor.createdAt)`
     rounds — and a rounded value on the equality side of a tie-break matches
     nothing, which stops paging at the first row of any group sharing an
     instant. `createdAtExact` above is where the precise value comes from. */
  const when = sql`${cursor.createdAt}::timestamptz`;
  return or(
    sql`${feedbackTable.createdAt} < ${when}`,
    and(sql`${feedbackTable.createdAt} = ${when}`, lt(feedbackTable.ownerId, cursor.ownerId)),
    and(
      sql`${feedbackTable.createdAt} = ${when}`,
      eq(feedbackTable.ownerId, cursor.ownerId),
      lt(feedbackTable.id, cursor.id),
    ),
  );
}

export async function listFeedbackAcrossOwners(
  limit: number,
  cursor: FeedbackCursor | null,
): Promise<AdminFeedbackPage> {
  /* Clamped rather than trusted, and floored before the compare so a fractional
     `?limit=1.5` off a query string cannot reach the driver. A limit of 0 is
     nonsense rather than "none", so the floor is 1. */
  const wanted = Number.isFinite(limit) ? Math.floor(limit) : ADMIN_FEEDBACK_DEFAULT_LIMIT;
  const capped = Math.min(Math.max(wanted, 1), ADMIN_FEEDBACK_MAX);

  const rows = await getDb()
    .select(LIST_COLUMNS)
    .from(feedbackTable)
    /* **The only predicate is the cursor.** No `owner_id` — which is what makes
       this file what it is, and why it is a file rather than a method. */
    .where(cursor ? after(cursor) : undefined)
    /* Newest first, then the whole primary key, so the order is *total*.
       `created_at` alone is not: two reports can share a millisecond, and two
       owners can share a report id, so both columns are needed before the
       sequence is stable between two loads — and a keyset cursor built on a
       non-total order silently skips rows. */
    .orderBy(desc(feedbackTable.createdAt), desc(feedbackTable.ownerId), desc(feedbackTable.id))
    /* **One more than asked for.** `hasMore` is then something we saw rather
       than something inferred from `rows.length === limit`, which is wrong
       exactly when the list ends on a boundary. A page that says *that is all of
       them* when it is not is the failure this whole feature exists to catch
       elsewhere. */
    .limit(capped + 1);

  const page = rows.slice(0, capped).map(toListed);
  /* The **raw** row, not the mapped report — the cursor needs the precise
     timestamp, and the report deliberately does not carry it. */
  const last = rows[page.length - 1];
  const hasMore = rows.length > capped;
  return {
    reports: page,
    hasMore,
    /* The cursor is the last row we are actually returning — never the extra
       one, which the caller has not seen and must not be skipped past. */
    nextCursor:
      hasMore && last
        ? { createdAt: last.createdAtExact, ownerId: last.ownerId, id: last.id }
        : null,
  };
}

/**
 * **One report in full**, including the diagnostics blob the list leaves out.
 *
 * Keyed on the pair, like everything else here. `null` for a pair that is not a
 * report, which the route turns into a 404.
 */
export async function readFeedbackAcrossOwners(
  ownerId: string,
  id: string,
): Promise<AdminFeedbackDetail | null> {
  const [row] = await getDb()
    .select({ ...LIST_COLUMNS, diagnostics: feedbackTable.diagnostics })
    .from(feedbackTable)
    .where(and(eq(feedbackTable.ownerId, ownerId), eq(feedbackTable.id, id)))
    .limit(1);
  if (!row) return null;
  const listed = toListed(row);
  return {
    ...listed,
    /* Two columns, one field on the wire — and `feedback_diagnostics_version`
       is the CHECK that makes putting them back together safe: a version
       standing beside an absent blob cannot be in the table. */
    diagnostics:
      listed.diagnosticsVersion === null
        ? null
        : {
            version: listed.diagnosticsVersion,
            payload: row.diagnostics as FeedbackDiagnosticsPayload,
          },
  };
}

/**
 * **One report's screenshot bytes.** The one place in the app that reads the
 * `screenshot` column at all — `LIST_COLUMNS` deliberately does not, so a list
 * can never drag PNGs through memory.
 *
 * `null` for a report with no screenshot **and** for a pair that is not a
 * report: both are the same 404 from the route, and telling them apart would
 * hand the caller a fact it may do nothing with.
 */
export async function readFeedbackScreenshotAcrossOwners(
  ownerId: string,
  id: string,
): Promise<Uint8Array | null> {
  const [row] = await getDb()
    .select({ screenshot: feedbackTable.screenshot })
    .from(feedbackTable)
    .where(and(eq(feedbackTable.ownerId, ownerId), eq(feedbackTable.id, id)))
    .limit(1);
  return row?.screenshot ?? null;
}
