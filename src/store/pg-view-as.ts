/**
 * **The administrator's view-as sessions** — the audit table
 * `view_as_sessions` (src/db/schema.ts) and the three things done to it.
 * docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md § Part 3.
 *
 * Every function here runs **as the administrator**, never under the view-as
 * marker: the three `/api/admin/view-as` routes call `start` and `end`, and the
 * gate in src/routes.ts calls `live` before it switches anything. Under the
 * marker the pool is read-only (src/db/client.ts), so a write here from inside
 * a view-as handler would be refused anyway.
 *
 * **The nonce is never stored.** `start` mints 32 random bytes, returns them
 * base64url-encoded exactly once, and keeps their sha256. The nonce alone opens
 * nothing — the gate also needs the administrator's own token and checks the
 * row's `actor_id` against it — but a hash is all a lookup needs, so a copy of
 * the table names no live session.
 */

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { viewAsSessions } from "../db/schema.js";
import type { OwnerId } from "../types.js";
import { guardDbStore } from "./db-errors.js";

/** Absolute, from the start, and never extended. Plan 261019n § Server, item 1. */
export const VIEW_AS_MINUTES = 30;

/** The reason's bounds, in characters (code points), as the table's check counts them. */
export const VIEW_AS_REASON_MAX = 300;

/** 32 bytes, base64url without padding: always 43 characters of this alphabet. */
const NONCE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** What `live` answers for a session that is this actor's, not ended and not expired. */
export interface LiveViewAs {
  readonly sessionId: string;
  readonly subjectId: OwnerId;
  readonly expiresAt: Date;
}

export interface StartedViewAs {
  /** The only copy there will ever be. Handed to the administrator's browser and forgotten. */
  readonly nonce: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

export interface ViewAsStore {
  start(actor: OwnerId, subject: OwnerId, reason: string): Promise<StartedViewAs>;
  live(nonce: string, actor: OwnerId): Promise<LiveViewAs | null>;
  /** Idempotent: an unknown, already-ended or somebody else's nonce changes nothing. */
  end(nonce: string, actor: OwnerId): Promise<void>;
}

function hashOf(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

/** Whether a header value is the shape a nonce has. Anything else matches no row. */
export function isNonceShaped(value: string): boolean {
  return NONCE_SHAPE.test(value);
}

const rawPgViewAsStore: ViewAsStore = {
  async start(actor, subject, reason) {
    const nonce = randomBytes(32).toString("base64url");
    const [row] = await getDb()
      .insert(viewAsSessions)
      .values({
        nonceHash: hashOf(nonce),
        actorId: actor,
        subjectId: subject,
        reason,
        /* From the database's clock, the one `live` compares against, so the
           two cannot disagree by the skew between this process and Postgres. */
        expiresAt: sql`now() + make_interval(mins => ${VIEW_AS_MINUTES})`,
      })
      .returning({ id: viewAsSessions.id, expiresAt: viewAsSessions.expiresAt });
    if (!row) throw new Error("starting a view-as session wrote no row. See src/store/pg-view-as.ts.");
    return { nonce, sessionId: row.id, expiresAt: row.expiresAt };
  },

  async live(nonce, actor) {
    if (!isNonceShaped(nonce)) return null;
    const [row] = await getDb()
      .select({
        sessionId: viewAsSessions.id,
        subjectId: viewAsSessions.subjectId,
        expiresAt: viewAsSessions.expiresAt,
      })
      .from(viewAsSessions)
      .where(
        and(
          eq(viewAsSessions.nonceHash, hashOf(nonce)),
          /* **This actor's.** Another administrator's nonce is somebody else's
             session, and is answered exactly as an ended one is. */
          eq(viewAsSessions.actorId, actor),
          isNull(viewAsSessions.endedAt),
          gt(viewAsSessions.expiresAt, sql`now()`),
        ),
      )
      .limit(1);
    return row ? { sessionId: row.sessionId, subjectId: row.subjectId as OwnerId, expiresAt: row.expiresAt } : null;
  },

  async end(nonce, actor) {
    if (!isNonceShaped(nonce)) return;
    await getDb()
      .update(viewAsSessions)
      .set({ endedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(viewAsSessions.nonceHash, hashOf(nonce)),
          eq(viewAsSessions.actorId, actor),
          /* The first Stop is the one recorded; a second changes nothing. */
          isNull(viewAsSessions.endedAt),
        ),
      );
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgViewAsStore: ViewAsStore = guardDbStore("view-as", rawPgViewAsStore);
