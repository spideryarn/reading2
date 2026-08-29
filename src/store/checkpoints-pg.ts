/**
 * The checkpoint store in Postgres — one row per finished piece of work.
 *
 * [checkpoints.ts](checkpoints.ts) has the contract and every decision;
 * [checkpoints-fs.ts](checkpoints-fs.ts) is a genuine second implementation
 * rather than a fallback. The `checkpoints` table is in
 * [../db/schema.ts](../db/schema.ts).
 *
 * ## Four things this file must not be edited into
 *
 * **`getDb()`, never a transaction, and never an optional `tx` parameter.**
 * Preserving the work of a *failed* attempt is the entire point of a
 * checkpoint, and a checkpoint that rolls back with the attempt is worthless.
 * The pool hands out a connection of its own, so a write here survives the
 * coordinator's rollback. An optional `tx` would make joining the transaction —
 * the one thing this must not do — the easy call to write.
 *
 * **No `revision_id`.** A retry is a new job and a new draft revision, so a
 * checkpoint keyed on the revision is written on every run and read on none.
 * The word does not appear below and must not start to.
 *
 * **`read` writes.** It is one `update … returning`, which stamps `last_used_at`
 * and returns the values in a single statement — so a hit cannot be recorded
 * without being served, or served without being recorded. checkpoints.ts
 * § Retention says why the column has to exist from the first migration.
 *
 * **The last write wins**, and `onConflictDoUpdate` must keep setting `value`.
 * An earlier version set only `last_used_at`, on the argument that two answers
 * to one content-addressed question are interchangeable. They are — but `write`
 * is only ever called *after a failed read*, so the incoming value is never a
 * second opinion about a good entry; it is somebody reporting that what was
 * stored could not be used, and paying to find out. Keeping the older one threw
 * away exactly those answers, and the caller paid again on every attempt for
 * ever. GPT Sol found it, 2026-08-29. checkpoints.ts § Concurrency.
 *
 * ## What may be logged from this file
 *
 * Nothing at all, today. A checkpoint value is a transcription of the reader's
 * own document, and the key is a digest of it. Ids and counts would be fine;
 * there is nothing here that needs them. The store is wrapped in
 * `guardDbStore` below — see the note there for why that is not deferred.
 */

import { and, eq, inArray, lt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { checkpoints } from "../db/schema.js";
import { guardDbStore } from "./db-errors.js";
import {
  assertCheckpointRequest,
  type CheckpointArticleRef,
  type CheckpointNamespace,
  type CheckpointStore,
  checkpointJson,
} from "./checkpoints.js";

/**
 * **Wrapped in `guardDbStore` here, not left for landing D.**
 *
 * An earlier version of this file carried a comment saying D must do it. That
 * is a protection which expires the moment somebody wires the store up, and the
 * person wiring it up reads the call site rather than this header — so it was a
 * note where a line of code belongs. [ai-calls.ts](ai-calls.ts) and
 * [index.ts](index.ts) both wrap at the point of export for the same reason.
 *
 * It is not cosmetic. A failed Drizzle query puts every bound parameter into
 * `Error.message`, and the bound parameter here is a transcription of the
 * reader's own document. [db-errors.ts](db-errors.ts) has the argument;
 * `tests/store-checkpoints.test.ts` § *the database refuses a key the code
 * refuses* shows the unscrubbed leak, which is why that test reads the
 * constraint name off the `cause`.
 *
 * Wrapping is idempotent (`db-errors.ts` marks a guarded store non-enumerably),
 * so D wrapping it again would be harmless rather than a second layer.
 */
export function createPgCheckpointStore(ref: CheckpointArticleRef): CheckpointStore {
  return guardDbStore("checkpoints", {
    async read<T>(
      slug: string,
      namespace: CheckpointNamespace,
      keys: readonly string[],
    ): Promise<Map<string, T>> {
      assertCheckpointRequest(ref, slug, namespace, keys);
      const found = new Map<string, T>();
      /* `inArray` with an empty list compiles to `false` in Drizzle, which is
         correct — but the round trip is not, and this is the ordinary case for
         a first run. */
      if (keys.length === 0) return found;
      /* One statement, not a select and then an update. A hit that was served
         and not stamped would be swept as though nothing had asked for it. */
      const rows = await getDb()
        .update(checkpoints)
        .set({ lastUsedAt: new Date() })
        .where(
          and(
            eq(checkpoints.articleId, ref.articleId),
            eq(checkpoints.namespace, namespace),
            inArray(checkpoints.key, [...keys]),
          ),
        )
        .returning({ key: checkpoints.key, value: checkpoints.value });
      for (const row of rows) found.set(row.key, row.value as T);
      return found;
    },

    async write(
      slug: string,
      namespace: CheckpointNamespace,
      key: string,
      value: unknown,
    ): Promise<void> {
      assertCheckpointRequest(ref, slug, namespace, [key]);
      /* The shared refusal, so this adapter and the filesystem one cannot
         disagree about what is writable. It was a local `value === undefined`
         check, which caught less than `JSON.stringify` returning `undefined`
         does (a bare function, a symbol, a `toJSON` that returns nothing) and
         which the filesystem side did not have at all. The returned JSON is
         discarded here — Drizzle wants the object for `jsonb` — and one
         stringify of at most a few hundred KB is nothing beside the paid model
         call that produced it. */
      checkpointJson(value);
      await getDb()
        .insert(checkpoints)
        .values({ articleId: ref.articleId, namespace, key, value })
        .onConflictDoUpdate({
          target: [checkpoints.articleId, checkpoints.namespace, checkpoints.key],
          /* **`value` as well, and that is the fix for the worst bug review
             found.** Omitting it meant a stored entry the caller could not use
             — the wrong shape, an older writer's mistake — was kept, while the
             answer that had just been paid for was thrown away, on every
             attempt for ever. `write` is only ever called after a failed read,
             so the incoming value is always the better-informed one.
             checkpoints.ts § Concurrency. */
          set: { value, lastUsedAt: new Date() },
        });
    },
  });
}

/**
 * Delete every checkpoint last used before `before`, and say how many.
 *
 * Global rather than per-article and per-owner, because a dead row is dead
 * whoever owns it — and the removal that does have a deadline, an article being
 * deleted, is already automatic (`on delete cascade`). See checkpoints.ts
 * § Retention.
 *
 * `dryRun` is the default. A sweep that deletes on its first run is a sweep
 * whose cutoff nobody has ever seen the effect of.
 */
export async function sweepPgCheckpoints(
  before: Date,
  opts: { dryRun?: boolean } = {},
): Promise<{ swept: number; bytes: number }> {
  const dryRun = opts.dryRun ?? true;
  if (dryRun) {
    const [row] = await getDb()
      .select({
        swept: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(pg_column_size(${checkpoints.value})), 0)::int`,
      })
      .from(checkpoints)
      .where(lt(checkpoints.lastUsedAt, before));
    return { swept: row?.swept ?? 0, bytes: row?.bytes ?? 0 };
  }
  const rows = await getDb()
    .delete(checkpoints)
    .where(lt(checkpoints.lastUsedAt, before))
    .returning({ bytes: sql<number>`pg_column_size(${checkpoints.value})::int` });
  return { swept: rows.length, bytes: rows.reduce((n, r) => n + (r.bytes ?? 0), 0) };
}
