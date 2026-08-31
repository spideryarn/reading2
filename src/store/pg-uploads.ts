/**
 * Upload records in Postgres — the adapter that lets a grant minted by one
 * request be claimed by another.
 *
 * That is the whole reason this exists. `POST /api/uploads` and
 * `POST /api/jobs { uploadId }` are two HTTP requests, and on a serverless host
 * they may not run on the same machine, so a record on a function's local disk
 * is a record the second request cannot find. The filesystem adapter is not
 * wrong; it is right about one process and there is more than one.
 *
 * ## Every transition is a conditional UPDATE, and `rowCount` is the answer
 *
 * Not read-then-write anywhere, including where the filesystem adapter has to
 * read first. The predicate carries the precondition, so the database decides
 * the winner rather than the order two requests happened to arrive in — and a
 * losing caller learns it lost rather than overwriting somebody.
 *
 * `canTransition` is still what says which states may follow which: the
 * `from` list goes into the `WHERE` rather than into an `if`. So the rules stay
 * in [`src/source.ts`](../source.ts), where both adapters read them, and this
 * file holds no opinion about the state machine at all.
 */

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { guardDbStore } from "./db-errors.js";
import { uploads } from "../db/schema.js";
import {
  type RejectReason,
  type UploadStatus,
  UPLOAD_STATUSES,
  canTransition,
} from "../source.js";
import {
  type ClaimResult,
  type SettleFields,
  type UploadRecord,
  type UploadStore,
  IllegalTransition,
  isUploadId,
} from "./uploads.js";

type Row = typeof uploads.$inferSelect;

/**
 * A row as the rest of the app wants it.
 *
 * **Absent rather than null.** `UploadRecord`'s optional fields mean "we do not
 * have this yet" and are checked with `!== undefined` all over; a `null`
 * arriving from the database would be truthy-false in the same places and
 * `JSON.stringify` would put it on the wire, where the client's own
 * `sha256?: string` says it cannot be. One conversion, here, rather than a
 * `?? undefined` at every reader.
 */
function toRecord(row: Row): UploadRecord {
  return {
    id: row.id,
    owner: row.ownerId,
    filename: row.filename,
    claimedBytes: row.claimedBytes,
    claimedSha256: row.claimedSha256,
    status: row.status as UploadStatus,
    mintedAt: row.mintedAt.toISOString(),
    grantExpiresAt: row.grantExpiresAt.toISOString(),
    ...(row.sha256 !== null && { sha256: row.sha256 }),
    ...(row.bytes !== null && { bytes: row.bytes }),
    ...(row.reason !== null && { reason: row.reason as RejectReason }),
    ...(row.slug !== null && { slug: row.slug }),
  };
}

/**
 * Which statuses may become `to`, asked of `canTransition` rather than listed.
 *
 * This is what keeps the state machine in one place while the check happens
 * inside a `WHERE`. Writing the `from` list out here would be a second copy of
 * `NEXT`, and a second copy is the thing that drifts — the same mistake the
 * `uploads_status` CHECK nearly shipped with, one layer down.
 */
function sourcesFor(to: UploadStatus): UploadStatus[] {
  return UPLOAD_STATUSES.filter((from) => canTransition(from, to));
}

/**
 * The store itself, **not exported** — see `pgUploadStore` at the foot of the
 * file. Private for the reason src/store/pg-jobs.ts gives about its own twin:
 * an unguarded spelling on offer is one somebody imports.
 */
const rawPgUploadStore: UploadStore = {
  async read(id: string, owner?: string): Promise<UploadRecord | null> {
    if (!isUploadId(id)) return null;
    const db = getDb();
    const where =
      owner === undefined
        ? eq(uploads.id, id)
        : and(eq(uploads.id, id), eq(uploads.ownerId, owner));
    const [row] = await db.select().from(uploads).where(where).limit(1);
    // Somebody else's reads as one that is not there — see `UploadStore.read`.
    return row ? toRecord(row) : null;
  },

  async create(record: UploadRecord): Promise<void> {
    const db = getDb();
    await db.insert(uploads).values({
      id: record.id,
      ownerId: record.owner,
      filename: record.filename,
      claimedBytes: record.claimedBytes,
      claimedSha256: record.claimedSha256,
      status: record.status,
      mintedAt: new Date(record.mintedAt),
      grantExpiresAt: new Date(record.grantExpiresAt),
      sha256: record.sha256 ?? null,
      bytes: record.bytes ?? null,
      reason: record.reason ?? null,
      slug: record.slug ?? null,
    });
  },

  /**
   * One statement, and no marker file.
   *
   * The filesystem adapter needs a create-only marker because read-then-write
   * has a gap in it. Here the precondition is the `WHERE`, so there is no gap
   * to have: `rowCount === 1` won the race and `0` lost it.
   *
   * The read afterwards is only to say **why** it lost — unknown, expired, or
   * somebody else got there first — and those are three different sentences to
   * the reader. It is deliberately after the update and not before it: doing it
   * first would put the gap back for the sake of a nicer error.
   */
  async claim(id: string, options: { owner?: string; now?: Date } = {}): Promise<ClaimResult> {
    if (!isUploadId(id)) return { ok: false, why: "unknown" };
    const now = options.now ?? new Date();
    const db = getDb();

    const conditions = [
      eq(uploads.id, id),
      eq(uploads.status, "pending"),
      // Strictly greater: the grant's own clock, and a grant that ends exactly
      // now has ended. `grantIsOver` uses `>=` and these have to agree.
      lt(sql`${now}::timestamptz`, uploads.grantExpiresAt),
    ];
    if (options.owner !== undefined) conditions.push(eq(uploads.ownerId, options.owner));

    const won = await db
      .update(uploads)
      .set({ status: "claimed" })
      .where(and(...conditions))
      .returning();
    if (won[0]) return { ok: true, record: toRecord(won[0]) };

    const existing = await this.read(id, options.owner);
    if (!existing) return { ok: false, why: "unknown" };
    if (existing.status !== "pending") return { ok: false, why: "taken" };
    return { ok: false, why: "expired" };
  },

  async settle(
    id: string,
    to: UploadStatus,
    fields: SettleFields = {},
  ): Promise<UploadRecord | null> {
    if (!isUploadId(id)) return null;
    const db = getDb();
    const moved = await db
      .update(uploads)
      .set({
        status: to,
        ...(fields.sha256 !== undefined && { sha256: fields.sha256 }),
        ...(fields.bytes !== undefined && { bytes: fields.bytes }),
        ...(fields.reason !== undefined && { reason: fields.reason }),
        ...(fields.slug !== undefined && { slug: fields.slug }),
      })
      .where(and(eq(uploads.id, id), inArray(uploads.status, sourcesFor(to))))
      .returning();
    if (moved[0]) return toRecord(moved[0]);

    /* Nothing moved, and the two reasons are not the same answer: a record that
       is not there is `null`, and a record in the wrong state throws — which is
       the strictness `UploadStore.settle` describes and the reason this is not
       just `return null`. */
    const existing = await this.read(id);
    if (!existing) return null;
    throw new IllegalTransition(existing.status, to);
  },

  async reject(id: string, reason: RejectReason): Promise<boolean> {
    if (!isUploadId(id)) return false;
    const db = getDb();
    const moved = await db
      .update(uploads)
      .set({ status: "rejected", reason })
      .where(and(eq(uploads.id, id), inArray(uploads.status, sourcesFor("rejected"))))
      .returning({ id: uploads.id });
    // No throw and no read-back: an upload already rejected is the ordinary
    // repeat this method exists to absorb. `false` means nothing was written.
    return moved.length === 1;
  },

  async noteSlug(id: string, slug: string): Promise<void> {
    if (!isUploadId(id)) return;
    const db = getDb();
    await db.update(uploads).set({ slug }).where(eq(uploads.id, id));
  },

  async list(): Promise<UploadRecord[]> {
    const db = getDb();
    const rows = await db.select().from(uploads).orderBy(desc(uploads.mintedAt));
    return rows.map(toRecord);
  },

  async forget(id: string): Promise<void> {
    if (!isUploadId(id)) return;
    const db = getDb();
    /* The staging object is deliberately left alone. Deleting one **re-arms**
       any grant still live over its key — measured against the running stack —
       so a tidy-up inside the two-hour TTL races the browser it is cleaning up
       after. docs/plans/260826u-pdf-upload-and-storage.md. */
    await db.delete(uploads).where(eq(uploads.id, id));
  },
};

/**
 * The upload store, with nothing a database said able to leave it.
 *
 * The same fix as src/store/pg-jobs.ts and found by the same review, and the
 * payload here is worse than the jobs one that was actually seen: `mint` binds
 * the **filename off the reader's own disk**, which is the one value in this
 * table that came from outside and the one most likely to say something about
 * its owner. A failed insert would have put it in `Error.message`, and from
 * there into the response, the log and — via the record's own `reason` column —
 * back into the next query's bound parameters.
 *
 * Selected in src/upload-records.ts rather than src/store/index.ts for the
 * import-cycle reason that file states; guarding at the export is what makes
 * the two facts compatible.
 */
export const pgUploadStore: UploadStore = guardDbStore("uploads", rawPgUploadStore);
