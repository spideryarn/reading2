/**
 * The live-conversation journal as a file — a JSON object keyed by session id.
 *
 * ## Why this exists, given that the store is moving to Postgres
 *
 * Because `SPIDERYARN_STORE` is unset on most machines and unset means `files`
 * (src/store/live.ts), and live conversation already works there. The
 * alternative was a filesystem *refusal*, the shape `AdminStore`,
 * `VisibilityStore` and `FeedbackStore` take — and it is right for those,
 * because there is genuinely no user list, no visibility column and no feedback
 * table on a filesystem. It would be wrong here: there is nothing about a
 * session journal that a file cannot hold, and refusing would mean **turning
 * off a working feature** on every default checkout in exchange for nothing.
 *
 * The rule the refusal is really enforcing is *do not release a usable token
 * with nowhere to record what it spends*, and a file records it perfectly well
 * for the one-laptop case files mode is (index.ts refuses `files` in production
 * outright, so this is never what a reader is served).
 *
 * ## Not append-only, unlike the ledger beside it
 *
 * [ai-calls-fs.ts](ai-calls-fs.ts) is JSONL because a finished call is a fact
 * about the past and nothing ever amends a row. A session is the opposite: it is
 * issued, then it connects, then it closes, and each of those is an update to
 * one row. So this is a single JSON object read, modified and written back,
 * serialised through a promise chain — the same shape `jobs-fs.ts` uses, and for
 * the same reason `ai-calls-fs.ts` gives about its own chain: Node's
 * promise-based filesystem API is not synchronised, and two overlapping
 * `writeFile`s would lose one of them.
 *
 * **Two processes writing at once is still unguarded**, exactly as it is for the
 * ledger, and it is written down rather than assumed away: `files` mode is one
 * laptop.
 *
 * ## What it does not do
 *
 * **Nothing prunes it.** Sessions accumulate for the life of the checkout. That
 * is fine at the scale files mode exists for — a handful of conversations a day
 * on one machine — and it is stated here rather than discovered, because a file
 * that only grows is the kind of thing that is obvious in the code and invisible
 * in operation. Postgres is where this data is meant to live.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RealtimeSession, RealtimeSessionStore } from "./contracts.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * Underscore-prefixed like `data/_ai-calls.jsonl`, so it can never collide with
 * a slug — and a **different file under test**, for the reason that one gives at
 * length: several suites drive real requests through `handleApi`, and a journal
 * a test can write to is a journal nobody can trust.
 *
 * **Resolved per call, not once at load**, which is the trap that file also
 * records: ESM hoists static imports, so a module-level constant is decided
 * before any test body runs, and a suite setting `NODE_ENV` in its own
 * `beforeAll` would already have been handed the shared path.
 */
function journal(): string {
  return (
    process.env.SPIDERYARN_REALTIME_JOURNAL ??
    path.join(
      ROOT,
      "data",
      process.env.NODE_ENV === "test"
        ? "_realtime-sessions.test.json"
        : "_realtime-sessions.json",
    )
  );
}

/** The tail of the write chain. Each update waits for the one before it. */
let writing: Promise<void> = Promise.resolve();

async function readAll(): Promise<Record<string, RealtimeSession>> {
  let text: string;
  try {
    text = await readFile(journal(), "utf8");
  } catch (err) {
    /* No file yet is no sessions yet, which is an answer rather than a failure —
       a fresh checkout has to be able to start a conversation. Any other error is
       real and is not swallowed. */
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, RealtimeSession>;
  } catch {
    /* **A damaged file is not an empty one, and this returns empty anyway.**

       The honest alternative is to throw, and it was the first version. It is
       wrong here: the only caller that reads is deciding whether to accept a
       usage report, and a throw turns a corrupt local file into a 500 on every
       report for the rest of the session. Returning `{}` makes those reports
       bounce as "no such session", which is the same outcome and a legible one.

       The writes below are what matter, and they do not depend on this: a lost
       journal loses the sessions in it, and files mode is a laptop. */
    return {};
  }
}

/**
 * Read, change, write back — with the whole thing serialised, so two concurrent
 * updates to different sessions cannot lose one of them.
 *
 * `mutate` returns nothing and edits the map in place; a returned copy would
 * invite a caller to build one from stale state read outside the chain.
 */
function update(mutate: (all: Record<string, RealtimeSession>) => void): Promise<void> {
  const at = journal();
  const mine = writing.then(async () => {
    const all = await readAll();
    mutate(all);
    await mkdir(path.dirname(at), { recursive: true });
    await writeFile(at, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  });
  /* Chained but not poisoned: a rejection reaches *this* caller and is swallowed
     for the chain, so one bad write does not fail every later one. Same shape as
     `fsCostStore.record`. */
  writing = mine.catch(() => undefined);
  return mine;
}

export const fsRealtimeSessionStore: RealtimeSessionStore = {
  issue(session: RealtimeSession): Promise<void> {
    return update((all) => {
      /* **Refuses rather than overwrites**, matching the Postgres adapter, which
         has no `on conflict do nothing` for the same reason: a collision would
         mean two sessions given one identity, and silently keeping the newer one
         would make the older session's reports land on a row that describes a
         different conversation. */
      if (all[session.id]) {
        throw new Error(`realtime session ${session.id} already exists in the journal`);
      }
      all[session.id] = session;
    });
  },

  async find(id: string, ownerId: string): Promise<RealtimeSession | null> {
    const found = (await readAll())[id];
    /* **The owner is part of the answer, not a check the caller makes.** Files
       mode is one reader, so this can never actually refuse anything today —
       which is exactly why it has to be written now rather than when it can. The
       two adapters must not disagree about what `find` means. */
    if (!found || found.ownerId !== ownerId) return null;
    return found;
  },

  markConnected(id: string, ownerId: string, at: string): Promise<void> {
    return update((all) => {
      const found = all[id];
      if (!found || found.ownerId !== ownerId) return;
      /* **The earliest time wins**, like the `is null` predicate in the Postgres
         adapter — a usage report backfills this in case the connected event was
         lost, and it arrives later by definition. */
      if (found.connectedAt !== null) return;
      found.connectedAt = at;
    });
  },

  close(id: string, ownerId: string, at: string, reason: string | null): Promise<void> {
    return update((all) => {
      const found = all[id];
      if (!found || found.ownerId !== ownerId) return;
      /* First close wins: a `pagehide` beacon and an explicit hang-up both fire
         on the ordinary way out, and the reason should be the first one. */
      if (found.closedAt !== null) return;
      found.closedAt = at;
      found.closeReason = reason;
      /* A session that reached its own end certainly connected. Weaker than the
         real event, so it never overwrites one. */
      found.connectedAt ??= at;
    });
  },
};
