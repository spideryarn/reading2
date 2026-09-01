/**
 * The reader's global profile **and their settings** — the Postgres half. src/store/fs.ts's
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
 * That still holds now the row carries two things: **each write names one
 * column** and leaves the other where it was, so a profile save and a settings
 * change cannot overwrite each other. The filesystem half has to merge by hand
 * to get the same property — src/profile.ts § `patchReaderFile`.
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

  async readExperimental(): Promise<string | null> {
    const [row] = await getDb()
      .select({ since: readerProfiles.experimentalSince })
      .from(readerProfiles)
      .where(eq(readerProfiles.ownerId, currentOwnerId()))
      .limit(1);
    // ISO on the way out, because that is what the contract says and what
    // crosses the wire. Drizzle hands back a `Date` for a `timestamptz`, and a
    // `Date` reaching `JSON.stringify` would produce the same string by
    // accident rather than by decision — and a different one the day a caller
    // formats it first.
    return row?.since ? row.since.toISOString() : null;
  },

  async writeExperimental(on: boolean): Promise<string | null> {
    const ownerId = currentOwnerId();
    const [row] = await getDb()
      .insert(readerProfiles)
      /* The **database's** clock rather than a `Date` from this process, so
         both branches of the upsert read the same one: a server whose clock has
         drifted would otherwise stamp a date the `coalesce` below could never
         have produced.

         `clock_timestamp()`, not `now()`. `now()` is the *transaction's* start
         time, so an "on" that waited on the row lock held by an "off" would
         stamp itself before that "off" committed — a switch recorded as turned
         on before it was turned off. GPT Sol, 2026-08-31. The reading is
         narrow, and so is the fix. */
      .values({ ownerId, experimentalSince: on ? sql`clock_timestamp()` : null })
      .onConflictDoUpdate({
        target: readerProfiles.ownerId,
        set: {
          /* **`coalesce` is what keeps the first date.** Switching on something
             already on must not move it — the column answers *since when*. In a
             `DO UPDATE`, an unqualified column name means the existing row, so
             this reads the value that is there and only `now()` when there is
             none. Doing the same with a read, a comparison and a write would be
             two statements with a gap, and two tabs either side of the gap
             would both mint a date.

             Off is `null` outright rather than coalesced, so on-off-on is a new
             date. That is the honest answer: the first spell ended.

             `clock_timestamp()` rather than `now()` for the same reason as the
             insert branch above — `now()` is the transaction's start, and this
             statement may have spent that time waiting for the row lock. */
          experimentalSince: on
            ? sql`coalesce(${readerProfiles.experimentalSince}, clock_timestamp())`
            : sql`null`,
          updatedAt: sql`now()`,
        },
      })
      // The row as it now is, rather than what we asked for — the `coalesce`
      // above means those are different values whenever the switch was already
      // on, and the caller is told what is stored.
      .returning({ since: readerProfiles.experimentalSince });
    return row?.since ? row.since.toISOString() : null;
  },
};
