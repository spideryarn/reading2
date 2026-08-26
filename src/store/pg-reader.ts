/**
 * The reader's global profile — the Postgres half. src/store/fs.ts's
 * `fsReaderStore` (a thin wrap of src/profile.ts) is the other.
 *
 * One row per `owner_id`, upserted rather than read-modify-written, for the
 * same reason src/store/pg-lookups.ts gives for glossary lookups: a "read the
 * row, merge, write it back" here would be process-local and two servers on
 * one database can both read the old value and both write, with one reader's
 * edit lost and both writes reporting success. There is nothing to merge for
 * a single scalar, so the upsert is simply the whole fix rather than half of
 * one.
 *
 * **Never logged**, and for the same reason as the per-article half: this
 * string is the reader's own description of themselves. See
 * docs/project/logging.md.
 */

import { eq, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { readerProfiles } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import { MAX_PROFILE_CHARS, normaliseProfileText } from "../profile.js";
import type { ReaderStore } from "./contracts.js";

export const pgReaderStore: ReaderStore = {
  async readProfile(): Promise<string | null> {
    const [row] = await getDb()
      .select({ profile: readerProfiles.profile })
      .from(readerProfiles)
      .where(eq(readerProfiles.ownerId, currentOwnerId()))
      .limit(1);
    // `normaliseProfileText` even on the read: a row written before a cap or a
    // normalisation rule changed should not need a migration to agree with it,
    // and treating `null`/absent/whitespace-only as one another is exactly
    // what src/profile.ts already does for the filesystem half.
    return normaliseProfileText(row?.profile ?? null);
  },

  async writeProfile(text: string | null): Promise<string | null> {
    const next = normaliseProfileText(text);
    if (next && next.length > MAX_PROFILE_CHARS) {
      throw Object.assign(
        new Error(`Profile must be ${MAX_PROFILE_CHARS} characters or fewer`),
        { status: 400 },
      );
    }

    const ownerId = currentOwnerId();
    await getDb()
      .insert(readerProfiles)
      .values({ ownerId, profile: next })
      // `do update`, not `do nothing`: clearing the profile, or editing it a
      // second time, is the ordinary case, and a `do nothing` here would keep
      // serving the FIRST thing the reader ever typed, for ever, while every
      // write after it reported success.
      .onConflictDoUpdate({
        target: readerProfiles.ownerId,
        set: { profile: next, updatedAt: sql`now()` },
      });
    return next;
  },
};
