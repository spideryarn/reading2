/**
 * **The Luna summary's cache, and the claim that stops two hovers both paying.**
 *
 * One row per `(owner, article, target)`, validated against the four things that
 * change the answer — the destination's text, the article context, the reader's
 * profile, and the prompt and model that wrote it. src/db/schema.ts §
 * `linkSummaries` has the argument for the key and for those four; this file is
 * the mechanical half.
 *
 * ## Why it looks so much like pg-link-previews.ts
 *
 * Because it is the same protocol, deliberately copied: one advisory lock, a
 * `pending` row carrying a lease, a `claim_id` that fences the two destructive
 * writes, and no network inside the transaction. `LinkSummaryStore` in
 * ./contracts.ts says why this is a second copy rather than a generic over both
 * — the protocol is shared and the *data* is not, and a generic taking the
 * columns, the validity test and the key builder as parameters would be more
 * machinery than the copy and harder to read than either.
 *
 * What differs is the stake. A duplicate preview costs one extra metadata fetch;
 * a duplicate summary costs a model call, so `claim` is the difference between
 * "fetch once" being a nicety and being the point.
 *
 * **`pg_advisory_xact_lock` and never the session form**, for the reason
 * src/store/pg-feedback.ts gives: Supabase's transaction pooler silently does
 * nothing with session advisory locks.
 *
 * ## What may be logged from this file
 *
 * Nothing. It knows a URL, an article, an owner and a model's answer about a
 * reader — four things this app never logs — so it says nothing at all.
 */

import { randomUUID } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { linkSummaries } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import { guardDbStore } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";
import { articleIdForOwned } from "./pg.js";
import type {
  LinkSummaryStore,
  SummaryClaim,
  SummaryInputs,
  SummaryKey,
} from "./contracts.js";

/**
 * Its own advisory-lock namespace, beside the preview cache's 5281 and the
 * limiter's 5282, so three features cannot collide on one hash space.
 *
 * The second half is `hashtext` of the whole key joined, for the reason
 * pg-link-previews.ts gives about `hashtext`: it needs only to agree with itself
 * in one database between two concurrent transactions, and two keys that hash
 * alike serialise with each other, which is slower and never wrong.
 */
const LINK_SUMMARY_LOCK_NAMESPACE = 5283;

/** A key, resolved: the three columns that address a row. */
interface Address {
  ownerId: string;
  articleId: string;
  target: string;
}

/**
 * **The slug resolved to a row, owner-scoped.**
 *
 * `articleIdForOwned` throws the owner-filtered not-found, so a slug belonging
 * to somebody else never reaches a query here at all — the same resolution
 * `pgGlossaryLookupStore` does, and for the same reason: whose article this is
 * has one answer, and it is the database's. A caller that assembled its own
 * `ownerId` and article id would be a second answer to that question.
 */
async function addressOf(key: SummaryKey): Promise<Address> {
  return {
    ownerId: currentOwnerId(),
    articleId: await articleIdForOwned(key.slug),
    target: key.target,
  };
}

/** The address as one string, for the lock and for nothing else. */
function lockKey(at: Address): string {
  return `${at.ownerId}\n${at.articleId}\n${at.target}`;
}

/** The three columns that address a row. */
function addresses(at: Address) {
  return and(
    eq(linkSummaries.ownerId, at.ownerId),
    eq(linkSummaries.articleId, at.articleId),
    eq(linkSummaries.target, at.target),
  );
}

/**
 * **Is this row still an answer to the question being asked?**
 *
 * Four comparisons, and every one of them is a prompt input: leave any out and
 * the summary is stale for ever in exactly the case where it matters — the
 * reader edited their profile, or the article was re-extracted, or the prompt
 * changed, or the model did. GPT Sol, 2026-09-05, P1-3.
 *
 * A mismatch is a *miss*, not an error: the row is rewritten in place by
 * whoever wins the claim.
 */
function matches(
  row: { destHash: string; contextHash: string; profileHash: string; promptVersion: number; model: string },
  inputs: SummaryInputs,
): boolean {
  return (
    row.destHash === inputs.destHash &&
    row.contextHash === inputs.contextHash &&
    row.profileHash === inputs.profileHash &&
    row.promptVersion === inputs.promptVersion &&
    row.model === inputs.model
  );
}

const SUMMARY_COLUMNS = {
  status: linkSummaries.status,
  summary: linkSummaries.summary,
  destHash: linkSummaries.destHash,
  contextHash: linkSummaries.contextHash,
  profileHash: linkSummaries.profileHash,
  promptVersion: linkSummaries.promptVersion,
  model: linkSummaries.model,
};

/**
 * **How many dead rows one fill takes with it.**
 *
 * `sweepABatch` in pg-link-previews.ts, and its argument: a retention that
 * nobody runs is not a retention, and an expiry stops a row being *served*
 * rather than deleting it. Small, and on the rare path — one per cold summary —
 * so it is many times faster than rows arrive, which is all a background sweep
 * has to be. It never throws: housekeeping must not fail an answer a reader is
 * waiting for.
 */
const RETENTION_BATCH = 50;

/** How long past its expiry a row is kept. The previews' thirty days, halved is
    no better a guess, so it is the same number for the same reason: a row just
    past its expiry is refreshed in place by the next hover. */
const SUMMARY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function sweepABatch(): Promise<void> {
  try {
    const db = getDb();
    await db.execute(sql`
      delete from ${linkSummaries}
      where (${linkSummaries.ownerId}, ${linkSummaries.articleId}, ${linkSummaries.target}) in (
        select ${linkSummaries.ownerId}, ${linkSummaries.articleId}, ${linkSummaries.target}
        from ${linkSummaries}
        where ${linkSummaries.expiresAt} < now() - make_interval(secs => ${SUMMARY_RETENTION_MS / 1000})
        limit ${RETENTION_BATCH}
      )`);
  } catch {
    /* See above. Nothing here is worth a reader's request. */
  }
}

const rawPgLinkSummaryStore: LinkSummaryStore = {
  async read(key, inputs) {
    const at = await addressOf(key);
    const db = getDb();
    /* `expires_at > now()` in the WHERE rather than compared in TypeScript, for
       `pgLinkPreviewStore.read`'s reason: an expired row must read as nothing at
       all, so that no caller can serve a stale answer by forgetting a date. */
    const [row] = await db
      .select(SUMMARY_COLUMNS)
      .from(linkSummaries)
      .where(and(addresses(at), gt(linkSummaries.expiresAt, sql`now()`)));
    if (row?.status !== "ready" || row.summary === null) return null;
    return matches(row, inputs) ? row.summary : null;
  },

  async claim(key, inputs, leaseMs) {
    const at = await addressOf(key);
    const db = getDb();
    /**
     * **`read committed`, said in the code and not only here** — the same trap
     * pg-feedback.ts records. Under `repeatable read` the lock statement can
     * establish a snapshot before it starts waiting, so the read after the wait
     * would come from before the winning transaction committed: this
     * transaction would see no row and take a second claim on a summary somebody
     * is already paying for.
     */
    return db.transaction(async (tx): Promise<SummaryClaim> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${sql.raw(String(LINK_SUMMARY_LOCK_NAMESPACE))}, hashtext(${lockKey(at)}))`,
      );
      const [row] = await tx
        .select(SUMMARY_COLUMNS)
        .from(linkSummaries)
        .where(and(addresses(at), gt(linkSummaries.expiresAt, sql`now()`)));
      if (row) {
        /* A live claim, whatever it was taken for. Not compared against the
           inputs: somebody is generating *something* for this key right now and
           will overwrite the row when they are done, so a second generation
           would be two calls to write one row. The loser asks again shortly. */
        if (row.status === "pending") return { kind: "pending" };
        if (row.summary !== null && matches(row, inputs)) {
          return { kind: "hit", summary: row.summary };
        }
        /* A ready row whose inputs have moved on. Falls through, and the upsert
           below takes the claim over the top of it — the stale answer stays
           readable to nobody, because `read` compares the same four things. */
      }

      const claimId = randomUUID();
      await tx
        .insert(linkSummaries)
        .values({
          ...at,
          status: "pending",
          summary: null,
          claimId,
          ...inputs,
          expiresAt: sql`now() + make_interval(secs => ${leaseMs / 1000})`,
        })
        .onConflictDoUpdate({
          target: [linkSummaries.ownerId, linkSummaries.articleId, linkSummaries.target],
          set: {
            status: "pending",
            summary: null,
            claimId,
            destHash: inputs.destHash,
            contextHash: inputs.contextHash,
            profileHash: inputs.profileHash,
            promptVersion: inputs.promptVersion,
            model: inputs.model,
            createdAt: sql`now()`,
            expiresAt: sql`now() + make_interval(secs => ${leaseMs / 1000})`,
          },
        });
      return { kind: "claimed", claimId };
    }, READ_COMMITTED);
  },

  async fill(key, claimId, summary, expiresAt) {
    const at = await addressOf(key);
    const db = getDb();
    /* **Only this caller's own claim.** A claimant that stalled past its lease
       and woke up would otherwise write its stale answer over the row its
       successor has already filled — which is a summary about an older profile,
       or an older version of the article, presented as current. The claim token
       is what tells the two apart; `link_previews`' `claim_id` carries the same
       argument at greater length. */
    const written = await db
      .update(linkSummaries)
      .set({ status: "ready", summary, claimId: null, expiresAt })
      .where(and(addresses(at), eq(linkSummaries.claimId, claimId)))
      /* **`returning` so the caller can be told, not merely so the row is
         right.** A `rowCount` would do the same job; this is the shape the rest
         of the file uses and it cannot be confused with "the statement ran". */
      .returning({ target: linkSummaries.target });
    await sweepABatch();
    return written.length > 0;
  },

  async release(key, claimId) {
    const at = await addressOf(key);
    const db = getDb();
    await db
      .delete(linkSummaries)
      .where(
        and(addresses(at), eq(linkSummaries.status, "pending"), eq(linkSummaries.claimId, claimId)),
      );
  },
};

/**
 * **Guarded at the export**, like every other adapter here — `pgLinkPreviewStore`
 * carries the argument, and it is sharper for this one: a failed Drizzle query
 * puts every bound parameter into `Error.message`, and the bound parameters here
 * are a URL somebody hovered and a model's answer about what they are reading.
 * `tests/store-guarded.test.ts` is what keeps it true.
 */
export const pgLinkSummaryStore: LinkSummaryStore = guardDbStore(
  "link-summaries",
  rawPgLinkSummaryStore,
);
