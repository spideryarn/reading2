/**
 * The live-conversation journal in Postgres — one row per issued session.
 *
 * The filesystem half is [realtime-sessions-fs.ts](realtime-sessions-fs.ts),
 * and it is a genuine second implementation rather than a fallback, like every
 * other pair in this directory: the store flag picks one at boot and the other
 * is never consulted. [index.ts](index.ts) explains why that distinction
 * matters.
 *
 * ## What may be logged from this file
 *
 * Nothing is, and there is very little that could go wrong that way: the row
 * carries no prose at all — no transcript, no instructions, no article text. The
 * transcript of a live conversation is stored, but as ordinary chat rows
 * elsewhere (`withSpokenTurn` in src/chat.ts). That is a schema decision rather
 * than a discipline one, which is the stronger kind.
 *
 * The queries still go through `guardDbStore` at the wiring in
 * [index.ts](index.ts), for the reason [db-errors.ts](db-errors.ts) gives: a
 * failed Drizzle query puts every bound parameter into `Error.message`, and an
 * owner id and a slug are bound parameters.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles, realtimeSessions } from "../db/schema.js";
import type { OwnerId } from "../owner.js";
import type { RealtimeSession, RealtimeSessionStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { ownedSlug } from "./owned-slug.js";

type Row = typeof realtimeSessions.$inferSelect;

/**
 * The article's uuid for a slug, or `null`.
 *
 * **Never throws**, for the same reason `articleIdFor` in
 * [ai-calls-pg.ts](ai-calls-pg.ts) does not: this runs while a reader is waiting
 * for a token, and a slug that no longer resolves must cost the row its
 * `article_id` and nothing else. `article_slug` is written either way, and it is
 * the historical fact anyway.
 */
async function articleIdFor(slug: string, ownerId: string): Promise<string | null> {
  try {
    const rows = await getDb()
      .select({ id: articles.id })
      .from(articles)
      /* `ownedSlug`, never a bare slug match: the column is globally unique, so
         an unfiltered lookup finds anybody's article. tests/owner-isolation.test.ts
         greps this directory for the unsanctioned spelling. */
      .where(ownedSlug(slug, ownerId as OwnerId))
      .limit(1);
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

function toSession(r: Row): RealtimeSession {
  return {
    id: r.id,
    ownerId: r.ownerId,
    articleSlug: r.articleSlug,
    threadId: r.threadId,
    model: r.model,
    transcriptionModel: r.transcriptionModel,
    issuedAt: r.issuedAt.toISOString(),
    acceptsUntil: r.acceptsUntil.toISOString(),
    connectedAt: r.connectedAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    closeReason: r.closeReason,
  };
}

const rawPgRealtimeSessionStore: RealtimeSessionStore = {
  async issue(session: RealtimeSession): Promise<void> {
    const articleId = session.articleSlug
      ? await articleIdFor(session.articleSlug, session.ownerId)
      : null;
    await getDb().insert(realtimeSessions).values({
      id: session.id,
      ownerId: session.ownerId,
      articleId,
      articleSlug: session.articleSlug,
      threadId: session.threadId,
      model: session.model,
      transcriptionModel: session.transcriptionModel,
      issuedAt: new Date(session.issuedAt),
      acceptsUntil: new Date(session.acceptsUntil),
      connectedAt: null,
      closedAt: null,
      closeReason: null,
    });
    /* **No `on conflict do nothing` here, unlike `ai_calls`.** There, the id is
       minted before a request that may be retried, so a collision is an ordinary
       retry of the insert. Here the id is freshly generated for this one call and
       nothing retries it — a collision would mean two sessions had been given one
       identity, which is a bug worth hearing about rather than absorbing. And it
       must throw, because the caller's whole contract is that a failure here
       stops the token reaching the browser. */
  },

  async find(id: string, ownerId: string): Promise<RealtimeSession | null> {
    const rows = await getDb()
      .select()
      .from(realtimeSessions)
      /* **The owner is part of the lookup, not checked afterwards.** A check the
         caller has to remember is a check the next caller will not. */
      .where(and(eq(realtimeSessions.id, id), eq(realtimeSessions.ownerId, ownerId)))
      .limit(1);
    const row = rows[0];
    return row ? toSession(row) : null;
  },

  async markConnected(id: string, ownerId: string, at: string): Promise<void> {
    await getDb()
      .update(realtimeSessions)
      .set({ connectedAt: new Date(at) })
      /* **`is null` in the WHERE, so the earliest time wins.**

         Two things can set this: the small `connected` event the browser posts
         when the data channel opens, and a usage report, which backfills it in
         case that event was lost. They arrive in either order and the second one
         is later by definition — so an unconditional `set` would quietly replace
         the moment the channel really opened with the moment somebody finished
         talking, and a "how long before the first word" figure would be silently
         wrong with nothing to compare it against.

         `coalesce(connected_at, $1)` would work too and is what
         `reader_profiles.experimental_since` uses (docs/project/sql.md); a
         predicate is used here instead because it also means the statement
         reports zero rows when there was nothing to do, which is the truth. */
      .where(
        and(
          eq(realtimeSessions.id, id),
          eq(realtimeSessions.ownerId, ownerId),
          isNull(realtimeSessions.connectedAt),
        ),
      );
  },

  async close(id: string, ownerId: string, at: string, reason: string | null): Promise<void> {
    await getDb()
      .update(realtimeSessions)
      .set({
        closedAt: new Date(at),
        closeReason: reason,
        /* **Closing backfills `connected_at` too.** A session that reached its
           own end certainly opened its data channel, and the `connected` event
           is the one thing here that nothing retries — it fires once, on a
           channel that has just become usable, and a dropped request loses it
           for good. `coalesce`, so a real connected time is never overwritten by
           this weaker inference. */
        connectedAt: sql`coalesce(${realtimeSessions.connectedAt}, ${new Date(at)})`,
      })
      .where(
        and(
          eq(realtimeSessions.id, id),
          eq(realtimeSessions.ownerId, ownerId),
          /* **First close wins.** A `pagehide` beacon and an explicit hang-up
             both fire on the ordinary way out of a conversation, and the second
             one would otherwise rewrite the reason with whichever arrived last
             rather than whichever happened first. */
          isNull(realtimeSessions.closedAt),
        ),
      );
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgRealtimeSessionStore: RealtimeSessionStore = guardDbStore("realtime-sessions", rawPgRealtimeSessionStore);
