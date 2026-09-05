/**
 * **The shared link-preview cache, and the claim that makes "once" true.**
 *
 * One row per exact request target, no owner on it, and every reader who hovers
 * the same address gets the same row — src/db/schema.ts § `linkPreviews` has the
 * disclosure argument, which is the interesting half of this table. This file is
 * the mechanical half: five outcomes flattened into columns and read back as a
 * union, one alias hop, and a lease.
 *
 * ## Why `claim` is a transaction and `read` is not
 *
 * `read` is the steady state — a cache hit on a card the reader is already
 * looking at — and it takes no lock, follows one alias hop and answers. It must
 * not queue behind anybody.
 *
 * `claim` is the cold path, and it is one transaction holding an advisory lock
 * on the target because the read, the staleness test and the write of the
 * `pending` row have to be one step. With them apart, two simultaneous cold
 * hovers of one URL both see nothing, both fetch, and both spend — a unique row
 * stops the duplicate *storage* and never the duplicate *traffic*. GPT Sol,
 * 2026-09-05, finding P1-4.
 *
 * **It is not "exactly once", and `LinkPreviewStore` in ./contracts.ts spells
 * out what it is instead.** A claimant that stalls past its lease still comes
 * back and fetches. The property that is guaranteed — and the only one a reader
 * would ever have noticed going — is that **a loser cannot destroy a winner**:
 * `release` is fenced on the claim's own token, and `fill` will not turn a live
 * `ok` row into a failure.
 *
 * **`pg_advisory_xact_lock` and never the session form**, for the reason
 * src/store/pg-feedback.ts gives: Supabase's transaction pooler silently does
 * nothing with session advisory locks, and a lock that silently does nothing is
 * the worst possible kind (src/db/client.ts).
 *
 * **No network inside the transaction.** The claim is taken, the transaction
 * commits, and only then does the winner fetch — a `fetchDocument` with a
 * twenty-second deadline held inside a transaction would pin a pooled connection
 * for twenty seconds per cold hover. The lease on the `pending` row is what
 * covers the gap: a process that dies mid-fetch costs the URL one lease, not
 * for ever.
 *
 * ## What may be logged from this file
 *
 * Nothing about a URL, ever — not the target, not its host. A hovered URL is a
 * fact about what somebody was reading, and this file has no reason to say
 * anything at all, so it does not log.
 */

import { randomUUID } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { linkPreviews } from "../db/schema.js";
import { guardDbStore } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";
import type { PagePreview } from "../types.js";
import type { CachedPreview, LinkPreviewStore, PreviewClaim } from "./contracts.js";

/**
 * The advisory lock's namespace — its own, so this feature's lock cannot
 * collide with feedback's (4919) on a shared hash space.
 *
 * The second half of the key is `hashtext(target)`. `hashtext` has no
 * cross-version stability guarantee and that costs nothing here: the only thing
 * the value has to do is agree with itself, in one database, between two
 * transactions running at the same moment. Two targets that hash alike
 * serialise with each other, which is slower and never wrong.
 */
const LINK_PREVIEW_LOCK_NAMESPACE = 5281;

/** The columns a read wants. `fetched_at` is deliberately not among them. */
const PREVIEW_COLUMNS = {
  target: linkPreviews.target,
  finalTarget: linkPreviews.finalTarget,
  outcome: linkPreviews.outcome,
  failure: linkPreviews.failure,
  claimId: linkPreviews.claimId,
  title: linkPreviews.title,
  siteName: linkPreviews.siteName,
  description: linkPreviews.description,
  firstParagraph: linkPreviews.firstParagraph,
  words: linkPreviews.words,
};

/**
 * The row shape, written out rather than inferred, so that a column dropped
 * from `PREVIEW_COLUMNS` is a compile error here rather than an `undefined`
 * on a card months later. Same reasoning as `ReportRow` in pg-feedback.ts.
 */
interface PreviewRow {
  target: string;
  finalTarget: string | null;
  outcome: string;
  failure: string | null;
  claimId: string | null;
  title: string | null;
  siteName: string | null;
  description: string | null;
  firstParagraph: string | null;
  words: number | null;
}

/**
 * A row, as the union above the store speaks in — or `null` for a row whose
 * `outcome` is not one this build knows.
 *
 * The `null` is not defensive decoration. The CHECK constraint is a closed set
 * and a deploy that removes a member from it would leave rows nothing can read;
 * answering `null` makes that a cache miss — one extra fetch — rather than a
 * throw in a request a reader is waiting on.
 */
function toPreview(row: PreviewRow): CachedPreview | null {
  switch (row.outcome) {
    case "pending":
      return { kind: "pending" };
    case "alias":
      return row.finalTarget === null ? null : { kind: "alias", finalTarget: row.finalTarget };
    case "ok":
      return { kind: "ok", page: toPage(row) };
    case "transient":
      return { kind: "transient", why: row.failure ?? "failed" };
    case "permanent":
      return { kind: "permanent", why: row.failure ?? "failed" };
    default:
      return null;
  }
}

/**
 * The four things a card can show, with absent fields **absent** rather than
 * `undefined`-valued.
 *
 * `exactOptionalPropertyTypes` is on, so `{ title: undefined }` is not the same
 * type as `{}` — and the difference is visible on the wire, where an explicit
 * `null` would reach a React render as a child.
 */
function toPage(row: PreviewRow): PagePreview {
  return {
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.siteName === null ? {} : { siteName: row.siteName }),
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.firstParagraph === null ? {} : { firstParagraph: row.firstParagraph }),
    ...(row.words === null ? {} : { words: row.words }),
  };
}

/**
 * The union, flattened back into the table's columns.
 *
 * `claimId` is only ever non-null on a `pending` row, and the CHECK constraint
 * says so — see src/db/schema.ts § `linkPreviews`. Every other arm writes it
 * back to null, which is what stops an answer inheriting the fencing token of
 * the claim that produced it.
 */
function toColumns(entry: CachedPreview, claimId: string | null = null): Omit<PreviewRow, "target"> {
  const empty = {
    finalTarget: null,
    failure: null,
    claimId: null,
    title: null,
    siteName: null,
    description: null,
    firstParagraph: null,
    words: null,
  };
  switch (entry.kind) {
    case "pending":
      return { ...empty, outcome: "pending", claimId };
    case "alias":
      return { ...empty, outcome: "alias", finalTarget: entry.finalTarget };
    case "transient":
      return { ...empty, outcome: "transient", failure: entry.why };
    case "permanent":
      return { ...empty, outcome: "permanent", failure: entry.why };
    case "ok":
      return {
        ...empty,
        outcome: "ok",
        title: entry.page.title ?? null,
        siteName: entry.page.siteName ?? null,
        description: entry.page.description ?? null,
        firstParagraph: entry.page.firstParagraph ?? null,
        words: entry.page.words ?? null,
      };
  }
}

/**
 * **Take a small bite out of the dead rows, on the way past.**
 *
 * The retention has to actually run, and this is where it does — see
 * `sweepLinkPreviews` below for the argument. Called from `fill`, which is the
 * rare path (one per cold URL) rather than the hot one, and bounded to
 * `RETENTION_BATCH` rows so that no reader ever waits on a long delete.
 *
 * **It never throws.** Housekeeping that fails must not turn a preview a reader
 * is waiting for into a 500; the worst case of swallowing it is a table that
 * stays large, which is what the script is for.
 */
async function sweepABatch(): Promise<void> {
  try {
    const db = getDb();
    await db.execute(sql`
      delete from ${linkPreviews}
      where ${linkPreviews.target} in (
        select ${linkPreviews.target} from ${linkPreviews}
        where ${linkPreviews.expiresAt} < now() - make_interval(secs => ${PREVIEW_RETENTION_MS / 1000})
        limit ${RETENTION_BATCH}
      )`);
  } catch {
    /* See above. Nothing here is worth a reader's request. */
  }
}

const rawPgLinkPreviewStore: LinkPreviewStore = {
  async read(target) {
    const db = getDb();
    /* `expires_at > now()` in the WHERE rather than compared in TypeScript: an
       expired row must read as *nothing at all*, so that no caller can serve a
       stale answer by forgetting a date comparison. It also means the two
       clocks that could disagree — this process's and the database's — never
       both matter. */
    const [row] = await db
      .select(PREVIEW_COLUMNS)
      .from(linkPreviews)
      .where(and(eq(linkPreviews.target, target), gt(linkPreviews.expiresAt, sql`now()`)));
    if (!row) return null;
    const entry = toPreview(row);
    if (entry === null) return null;
    if (entry.kind !== "alias") return entry;

    /* **One hop and no more.** An alias points at where a fetch ended up, and a
       final target is by construction not itself a redirect — so a chain would
       mean something wrote one, and following it would be trusting a loop we
       have no reason to believe in. A missing or stale destination is an
       ordinary miss: the next request refetches and rewrites both rows. */
    const [followed] = await db
      .select(PREVIEW_COLUMNS)
      .from(linkPreviews)
      .where(
        and(eq(linkPreviews.target, entry.finalTarget), gt(linkPreviews.expiresAt, sql`now()`)),
      );
    if (!followed) return null;
    const answer = followed.outcome === "alias" ? null : toPreview(followed);
    return answer;
  },

  async claim(target, leaseMs) {
    const db = getDb();
    /**
     * **`read committed`, said in the code and not only here** — PostgreSQL's
     * default, and the argument depends on it. Under `repeatable read` the lock statement can
     * establish a snapshot before it starts waiting, so the read after the wait
     * would come from before the winning transaction committed: this
     * transaction would see no row and take a second claim on a URL somebody is
     * already fetching. The same trap pg-feedback.ts records, and a
     * `default_transaction_isolation` set on the role would spring it silently.
     */
    return db.transaction(async (tx): Promise<PreviewClaim> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${sql.raw(String(LINK_PREVIEW_LOCK_NAMESPACE))}, hashtext(${target}))`,
      );
      const [row] = await tx
        .select(PREVIEW_COLUMNS)
        .from(linkPreviews)
        .where(and(eq(linkPreviews.target, target), gt(linkPreviews.expiresAt, sql`now()`)));
      const existing = row ? toPreview(row) : null;
      if (existing) {
        if (existing.kind === "pending") return { kind: "pending" };
        /* An alias is followed by `read` and never by the claim: the claim is
           always on what the caller asked for, so a stale destination behind a
           fresh alias refetches from the requested address and rewrites both
           rows. Anything else would have this transaction taking a lock on one
           target and a claim on another. */
        if (existing.kind !== "alias") return { kind: "hit", entry: existing };
        const [followed] = await tx
          .select(PREVIEW_COLUMNS)
          .from(linkPreviews)
          .where(
            and(
              eq(linkPreviews.target, existing.finalTarget),
              gt(linkPreviews.expiresAt, sql`now()`),
            ),
          );
        const answer = followed && followed.outcome !== "alias" ? toPreview(followed) : null;
        if (answer && answer.kind !== "pending") return { kind: "hit", entry: answer };
      }

      /* Nothing usable, so this caller is the one fetching. The lease is the
         only thing standing between a killed process and a URL nobody ever
         previews again, and `claimId` is what tells this claim from the next
         one — see the header, and `claim_id` in src/db/schema.ts. */
      const claimId = randomUUID();
      await tx
        .insert(linkPreviews)
        .values({
          target,
          ...toColumns({ kind: "pending" }, claimId),
          expiresAt: sql`now() + make_interval(secs => ${leaseMs / 1000})`,
        })
        .onConflictDoUpdate({
          target: linkPreviews.target,
          set: {
            ...toColumns({ kind: "pending" }, claimId),
            fetchedAt: sql`now()`,
            expiresAt: sql`now() + make_interval(secs => ${leaseMs / 1000})`,
          },
        });
      return { kind: "claimed", claimId };
    }, READ_COMMITTED);
  },

  async fill(rows) {
    if (rows.length === 0) return;
    const db = getDb();
    /* One statement, so a redirect's two rows — the answer under the final
       target and the alias under the requested one — land together or not at
       all. An alias pointing at a row that is not there is a miss on every
       later hover, which is the failure that looks exactly like the cache
       working. */
    await db
      .insert(linkPreviews)
      .values(
        rows.map((row) => ({
          target: row.target,
          ...toColumns(row.entry),
          expiresAt: row.expiresAt,
        })),
      )
      .onConflictDoUpdate({
        target: linkPreviews.target,
        set: {
          finalTarget: sql`excluded.final_target`,
          outcome: sql`excluded.outcome`,
          failure: sql`excluded.failure`,
          claimId: sql`excluded.claim_id`,
          title: sql`excluded.title`,
          siteName: sql`excluded.site_name`,
          description: sql`excluded.description`,
          firstParagraph: sql`excluded.first_paragraph`,
          words: sql`excluded.words`,
          fetchedAt: sql`now()`,
          expiresAt: sql`excluded.expires_at`,
        },
        /**
         * **A write may never turn a live answer into a failure.**
         *
         * This is the half of the fencing that a claim token cannot do, because
         * the two writers need not hold the same claim — or any claim on the
         * same target. GPT Sol, 2026-09-05, P1-2, and the sequence is real: A
         * stalls past its lease on the requested address, B reclaims and fills a
         * good preview, A wakes up with a timeout and writes it over. Or the
         * redirect version, which no per-target lock can cover: a request for
         * `R` that redirects to `F` and a direct request for `F` hold *different*
         * advisory locks and both write `F`, so a slow direct failure can land on
         * top of a good `R → F` result.
         *
         * The rule is one-directional on purpose. A good answer replacing a good
         * answer is a refresh and is allowed; a good answer replacing a failure
         * is the recovery that makes a short negative expiry worth having; a
         * failure replacing an *expired* row is an ordinary re-cache. Only
         * *downgrading a live answer* is refused, and what is left when it is
         * refused is the older, still-good row — which is the outcome a reader
         * wants either way.
         */
        setWhere: sql`not (
          ${linkPreviews.outcome} = 'ok'
          and ${linkPreviews.expiresAt} > now()
          and excluded.outcome in ('transient', 'permanent')
        )`,
      });
    await sweepABatch();
  },

  async release(target, claimId) {
    /* **Only this caller's own claim**, matched on the fencing token as well as
       on `outcome = 'pending'`.

       `outcome = 'pending'` alone was the first version and it is not enough:
       it stops a slow loser deleting a good *answer*, and it does not stop one
       deleting a *successor's claim*. A stalls past its lease, B reclaims, A is
       refused allowance and releases — and without the token that delete lands
       on B's row, so a third caller starts a third fetch of a URL somebody is
       already fetching. GPT Sol, 2026-09-05, P1-2. */
    const db = getDb();
    await db
      .delete(linkPreviews)
      .where(
        and(
          eq(linkPreviews.target, target),
          eq(linkPreviews.outcome, "pending"),
          eq(linkPreviews.claimId, claimId),
        ),
      );
  },
};

/**
 * **Guarded at the export**, like every other adapter here, and not only in
 * `src/store/index.ts`.
 *
 * `guardDbStore` translates a failed Drizzle query on the way out, and a failed
 * Drizzle query puts **every bound parameter into `Error.message`** — which here
 * is a URL somebody hovered. Wrapping it at the export rather than at the
 * selection means the guard travels with the store: a future caller that
 * imports this file directly, as `src/jobs.ts` does with the job store, cannot
 * get the raw one. `tests/store-guarded.test.ts` is what keeps that true.
 */
export const pgLinkPreviewStore: LinkPreviewStore = guardDbStore(
  "link-previews",
  rawPgLinkPreviewStore,
);

/**
 * **How long past its expiry a row is kept before it is deleted.**
 *
 * Thirty days, and the margin is the point rather than the number: a row whose
 * expiry has just passed is *refreshed in place* by the next hover, so deleting
 * it the moment it goes stale would trade a cheap update for a delete and an
 * insert, and would lose the one thing worth keeping — that somebody once
 * wanted this URL.
 */
export const PREVIEW_RETENTION_DAYS = 30;

/** `PREVIEW_RETENTION_DAYS`, in ms, because that is what the callers want. */
export const PREVIEW_RETENTION_MS = PREVIEW_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * **How many dead rows one fill takes with it.**
 *
 * Small, because this runs on a request a reader is waiting on: the point is
 * that retention *happens* rather than that it happens all at once. Fills are
 * themselves rare — one per cold URL — so this is many times faster than rows
 * arrive, which is all a background sweep has to be.
 */
const RETENTION_BATCH = 50;

/**
 * **The retention sweep.**
 *
 * An ownerless row must not live for ever by default — that is the retention
 * half of GPT Sol's finding P1-7, and src/db/schema.ts § `linkPreviews` carries
 * the argument. An expired row is not an answer to anybody, so once it is past
 * its expiry by the grace period there is nothing left in it to keep.
 *
 * **This runs on its own, a batch at a time, from `fill`** (`sweepABatch`
 * above). The first version left it to `scripts/link-previews-sweep.ts` and the
 * review was right that a documented retention nobody runs is not a retention:
 * `expires_at` stops a row being *served*, it does not delete it, so the URL and
 * the extracted content would in fact have lived for ever by default. GPT Sol,
 * P1-4. The script is still here for a bigger, on-demand pass with a report; it
 * is no longer the only thing that would ever delete anything.
 *
 * **Nothing schedules the script**, and that is honest rather than a gap: a row
 * costs one outbound fetch to create and the limiter bounds those per reader, so
 * the table cannot grow quickly. Housekeeping nobody runs leaves a growing table
 * rather than a broken one.
 *
 * @returns how many rows went — or, on a dry run, how many would.
 */
export async function sweepLinkPreviews(
  graceMs: number,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<number> {
  const db = getDb();
  const stale = sql`${linkPreviews.expiresAt} < now() - make_interval(secs => ${graceMs / 1000})`;
  if (dryRun) {
    const [counted] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(linkPreviews)
      .where(stale);
    return counted?.n ?? 0;
  }
  const gone = await db
    .delete(linkPreviews)
    .where(stale)
    .returning({ target: linkPreviews.target });
  return gone.length;
}
