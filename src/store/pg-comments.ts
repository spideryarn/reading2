/**
 * Comments in Postgres. Same semantics as src/comments.ts, enforced differently.
 *
 * The interesting difference is not the storage, it is what the storage makes
 * impossible. `src/comments.ts` reads the whole file, changes one entry and
 * writes it back — so two requests answering two comments on the same article
 * at the same time can lose one of them, and nothing reports it. Here each
 * comment is a row and the two writes do not touch.
 *
 * ## The anchor is the block IDENTITY
 *
 * `comments_identity_fk` points at `block_identities`, not at the current
 * revision's blocks. That is the whole design: a re-extraction can drop the
 * paragraph and the reader's question survives, because identities are never
 * deleted. `src/web/comment-nav.ts` already sorts such a comment to the end
 * rather than dropping it — "it is still the reader's question".
 *
 * The corollary is that the identity has to exist *before* the comment. It
 * always does for a block the reader can select, because stage 3 minted it. A
 * failure here therefore means something real — stage 3 re-minted ids instead
 * of carrying them forward — and it should fail loudly rather than insert.
 *
 * ## Order
 *
 * `comments.json` is an array in insertion order; a table has no order at all
 * until you ask for one. `created_at, id` reproduces insertion order for
 * anything written chronologically, and `id` breaks the tie so the answer is
 * deterministic rather than merely usually-right — two comments created inside
 * the same millisecond would otherwise swap places between requests.
 */

import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import {
  COMMENT_SWEPT,
  CommentIdTaken,
  NotAnExplanation,
  type AnswerPatch,
  type NewComment,
} from "../comments.js";
import { getDb } from "../db/client.js";
import { EXPLAIN_TIMEOUT_MS } from "../explain.js";
import { articles, comments as commentsTable } from "../db/schema.js";
import { isSpideryarnId, mintUniqueId } from "../ids.js";
import { log } from "../log.js";
import { currentOwnerId } from "../owner.js";
import type { Comment } from "../types.js";
import type { CommentStore } from "./contracts.js";
import { ownedSlug } from "./pg.js";

const logger = log("store");

/**
 * **How long another machine leaves a comment's `pending` row alone.**
 *
 * `beginAnswer` stamps `now + this` into `lease_expires_at`; `sweepPending`
 * errors a `pending` row only once that deadline has passed. It is the same job
 * `SweepOptions.graceMs` does for chat, searches and criteria, moved onto the
 * row because `comments` has a lease column and no attempt clock — see
 * `CommentStore.sweepPending` in src/store/contracts.ts for why that means the
 * method takes no window from its caller.
 *
 * **Derived from the call's own deadline** rather than written down beside it,
 * so the two cannot drift into a sweep that fires before the model has given
 * up: `explain` aborts at `EXPLAIN_TIMEOUT_MS` and then writes `error` itself,
 * so anything still `pending` half a minute after that has no writer left. The
 * arithmetic makes the relationship unfalsifiable where
 * `CHAT_ORPHAN_GRACE_MS`'s needs an assertion; `CLAIMS_ORPHAN_GRACE_MS` in
 * pg-referee-claims.ts is the same expression for the same reason.
 *
 * Thirty seconds of margin, matching that one, because the gap has to cover the
 * store write that follows the model call, not just the call.
 */
export const COMMENT_ANSWER_LEASE_MS = EXPLAIN_TIMEOUT_MS + 30_000;

/** The article's uuid, or a tagged 404 — the same shape src/api.ts throws. */
async function articleIdFor(slug: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(ownedSlug(slug))
    .limit(1);
  const found = rows[0];
  if (!found) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  return found.id;
}

/** A row as the client sees it. Absent, not null — `exactOptionalPropertyTypes`. */
function toComment(row: typeof commentsTable.$inferSelect): Comment {
  return {
    id: row.id,
    blockId: row.blockId,
    quote: row.quote,
    start: row.start,
    createdAt: row.createdAt.toISOString(),
    /* Absent, not `null`, for all three of these — `exactOptionalPropertyTypes`
       is on and tests/store-roundtrip.test.ts compares the two stores
       structurally, so a `null` here against an absent key on the filesystem
       side is a real failure rather than a cosmetic one. */
    ...(row.body === null ? {} : { body: row.body }),
    ...(row.updatedAt === null ? {} : { updatedAt: row.updatedAt.toISOString() }),
    ...(row.threadId === null ? {} : { threadId: row.threadId }),
    /* **The referee's own mark, and the read that has to survive a minus sign.**
       Absent rather than null, like everything above. `valence` is copied
       straight off the column — no clamp, no `??`, no coalesce to zero: a `0`
       arriving here means the referee placed the passage at neither end, and a
       −80 means they placed it at the far one. Anything that turned the second
       into the first would read as "no strong feeling" and nothing would say
       so. See `Comment.valence` in src/types.ts. */
    ...(row.criterionId === null ? {} : { criterionId: row.criterionId }),
    ...(row.valence === null ? {} : { valence: row.valence }),
    status: row.status as Comment["status"],
    ...(row.answer === null ? {} : { answer: row.answer }),
    ...(row.citations === null ? {} : { citations: row.citations }),
    ...(row.searches === null ? {} : { searches: row.searches }),
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.error === null ? {} : { error: row.error }),
  };
}

async function listFor(articleId: string): Promise<Comment[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(commentsTable)
    .where(eq(commentsTable.articleId, articleId))
    .orderBy(asc(commentsTable.createdAt), asc(commentsTable.id));
  return rows.map(toComment);
}

export const pgCommentStore: CommentStore = {
  async load(slug: string): Promise<Comment[]> {
    return listFor(await articleIdFor(slug));
  },

  /**
   * **Idempotent on `input.id`, and the reset is the whole point.**
   *
   * A retry sends the id it already has. That must reset the existing comment
   * rather than add a second one: a second row leaves the failed original
   * behind, drawing a second mark over the same words that nothing can clear —
   * and turns a double-clicked POST into two model calls with one orphaned.
   *
   * `createdAt` survives the reset, because the reader asked the question once.
   * Everything from the previous attempt — answer, citations, searches, model,
   * error — goes, because it belonged to the attempt being replaced.
   *
   * ## Why this is one statement and not select-then-branch
   *
   * The first version read the row, then either updated it or inserted, inside
   * a transaction. That is correct for a retry that arrives *after* the first
   * request finished, and wrong for one that arrives *during* it: a transaction
   * cannot lock a row that does not exist yet, so both requests see nothing and
   * both insert, and the second gets a raw uniqueness error that src/routes.ts
   * turns into a 500. The reader's question fails for a reason that is not
   * about their question. GPT Sol found it in review, 2026-08-26;
   * docs/plans/260826j-postgres-storage-review-sol.md.
   *
   * `on conflict (article_id, id) do update` is the fix, and it is the same
   * statement for both cases — Postgres serialises the second writer on the
   * key it is about to insert, then hands it the update. There is no window
   * left to lose, because there is no gap between looking and writing.
   *
   * `created_at` is deliberately absent from the `set`. Leaving it out is what
   * preserves it; adding it "for completeness" would silently restart the clock
   * on a question the reader asked once.
   */
  /**
   * A **free** comment — the reader's mark on a passage. No model call, ever.
   *
   * ## Why this is no longer an upsert
   *
   * It used to be `on conflict (article_id, id) do update`, and that was right
   * while the only caller was a retry of the model call: Postgres serialises
   * the second writer on the key it is about to insert, so there was no window
   * between looking and writing to lose. GPT Sol found that fix in review on
   * 2026-08-26, and it is still the right shape for *that* problem — which is
   * why the retry path keeps it, over in `beginAnswer`.
   *
   * It is the wrong shape here. Once making a comment is free, a colliding id
   * is an ordinary event rather than a retry, and `do update` would rewrite the
   * anchor and blank the answer of a comment the reader made in another tab.
   * So: insert, and on conflict do **nothing** — then read the row back and
   * decide. Same id, same anchor, same body ⇒ hand it back, which is what makes
   * a double-clicked Save and a retried POST harmless. Anything else ⇒
   * `CommentIdTaken`, and a 409.
   *
   * `do nothing` rather than select-then-insert for the same reason the old
   * `do update` was: it closes the gap between looking and writing, so two
   * simultaneous Saves under one id cannot both insert.
   */
  async create(slug: string, input: NewComment): Promise<Comment> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const supplied = input.id !== undefined && isSpideryarnId(input.id) ? input.id : undefined;

    /* The named allowlist creation is allowed to write. Every answer column is
       explicitly null rather than left to a default: this row has had no model
       call, and `status: "none"` is the field that says so. */
    const fields = {
      blockId: input.blockId,
      quote: input.quote,
      start: input.start,
      body: input.body ?? null,
      /* The referee's own mark. Null when there is none, so the row says
         "ordinary reading note" rather than leaving it to a default — and
         `comments_valence_needs_criterion` refuses the half-made pair the route
         has already refused. */
      criterionId: input.criterionId ?? null,
      valence: input.valence ?? null,
      status: "none",
      answer: null,
      citations: null,
      searches: null,
      model: null,
      error: null,
    } as const;

    const write = async (id: string, tx: typeof db = db) => {
      const [row] = await tx
        .insert(commentsTable)
        .values({ articleId, id, ownerId: currentOwnerId(), ...fields })
        .onConflictDoNothing({ target: [commentsTable.articleId, commentsTable.id] })
        .returning();
      return row === undefined ? undefined : toComment(row);
    };

    if (supplied) {
      const written = await write(supplied);
      if (written) {
        logger.info(
          { slug, id: written.id, blockId: written.blockId, repeat: false },
          "comment created",
        );
        return written;
      }
      /* The insert hit an existing row and did nothing. Read it and decide
         whether this is the same Save arriving twice or a genuine collision. */
      const [existing] = await db
        .select()
        .from(commentsTable)
        .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, supplied)));
      if (!existing) {
        /* Inserted nothing and there is nothing there: the conflict was on some
           other constraint, or the row went between the two statements. Either
           way this is not the harmless case and must not be reported as one. */
        throw new CommentIdTaken(supplied);
      }
      const stored = toComment(existing);
      /* `status === "none"` is part of what "the same Save" means. A legacy
         explanation commonly has no body, so anchor-and-body alone would hand
         an answered row back as a freshly created free comment. GPT Sol,
         reviewing the built code, 2026-08-28. */
      const same =
        stored.status === "none" &&
        stored.blockId === input.blockId &&
        stored.quote === input.quote &&
        stored.start === input.start &&
        stored.body === input.body &&
        /* The placement is part of what "the same Save" means, for the reason
           the body is: a second POST under a stored id carrying a *different*
           valence is a re-score, not a retry, and `create` overwriting it would
           delete a judgement the referee already made. `sameMark` in
           src/comments.ts is the filesystem half of this. */
        stored.criterionId === input.criterionId &&
        stored.valence === input.valence;
      if (!same) throw new CommentIdTaken(supplied);
      logger.info(
        { slug, id: stored.id, blockId: stored.blockId, repeat: true },
        "comment created",
      );
      return stored;
    }

    /* No usable id from the client, so mint one. This half still has to look
       before it writes — you cannot ask Postgres for "an id nothing is using" —
       so it keeps the transaction, and it retries on a key collision.

       Minting needs the ids already taken FOR THIS ARTICLE. Block ids are
       unique only within an article and so are these; the primary key is
       `(article_id, id)`. Passing every comment id in the database would be
       both wrong and slower. */
    for (let attempt = 0; ; attempt++) {
      try {
        const stored = await db.transaction(async (tx) => {
          const takenRows = await tx
            .select({ id: commentsTable.id })
            .from(commentsTable)
            .where(eq(commentsTable.articleId, articleId));
          return write(mintUniqueId(new Set(takenRows.map((r) => r.id))), tx as typeof db);
        });
        /* `undefined` means the insert conflicted on an id we had just proved
           was free, which is the collision the retry below is for. */
        if (!stored) {
          if (attempt >= 2) throw new CommentIdTaken("(minted)");
          continue;
        }
        logger.info(
          { slug, id: stored.id, blockId: stored.blockId, repeat: false },
          "comment created",
        );
        return stored;
      } catch (err) {
        /* 23505 is unique_violation, and here it means two requests minted the
           same random id in the same instant — one chance in a billion, which
           at enough requests is a Tuesday. Anything else is a real failure and
           must not be swallowed: 23503 in particular is the block identity FK,
           which means stage 3 re-minted ids and has to be seen. */
        const code = (err as { code?: string }).code;
        if (code !== "23505" || attempt >= 2) throw err;
      }
    }
  },

  /**
   * Reset a legacy explanation for another attempt at the model call.
   *
   * The half of the old `create` that still needs an upsert's semantics — but
   * as an **update**, because the row must already exist. Everything the reader
   * owns is left alone by construction: the `set` names only the answer fields,
   * so the anchor, `created_at`, `body`, `updated_at` and `thread_id` are not
   * in the statement at all.
   *
   * `status <> 'none'` in the WHERE is what refuses a bookmark, and it is one
   * statement rather than read-then-check so two simultaneous requests cannot
   * both pass the check.
   */
  async beginAnswer(slug: string, id: string): Promise<Comment> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const [row] = await db
      .update(commentsTable)
      .set({
        status: "pending",
        answer: null,
        citations: null,
        searches: null,
        model: null,
        error: null,
        /* **The lease, and the reason `sweepPending` is safe on Vercel.** Every
           other machine has to be able to tell "an answer is arriving" from "a
           process died holding this row", and the only thing they all agree on
           is the database's clock. So the attempt stamps a deadline here, where
           any of them can read it — `attemptId` and `lease_expires_at` are on
           this table for exactly this, and the schema comment says so.

           `clock_timestamp()`, not `now()`: `now()` is the transaction's start
           and is frozen for its duration, which is the trap
           tests/store-jobs-parity.test.ts pins for `jobs`.

           `gen_random_uuid()` from the server too, so the fence and the clock
           on one row cannot come from two different machines. Nothing reads the
           id yet — `patch` is unfenced, as it was — but a fence that is written
           is a fence that can be checked later without a migration. */
        attemptId: sql`gen_random_uuid()`,
        leaseExpiresAt: sql`clock_timestamp() + make_interval(secs => ${COMMENT_ANSWER_LEASE_MS} / 1000.0)`,
      })
      /* **`in ('done','error')` is a claim; `<> 'none'` was not.**
         The first version excluded only bookmarks, so a row already `pending`
         satisfied it: two presses of Try again would both "succeed", buy two
         model calls, and race each other's terminal writes. Only a *terminal*
         row is answerable. An abandoned `pending` becomes `error` through
         `sweepOrphaned` and can be retried then — which is what that sweep is
         for. GPT Sol, reviewing the built code, 2026-08-28. */
      .where(
        and(
          eq(commentsTable.articleId, articleId),
          eq(commentsTable.id, id),
          inArray(commentsTable.status, ["done", "error"]),
        ),
      )
      .returning();
    if (!row) {
      /* Nothing updated: no such comment, a bookmark, or one already being
         answered. Told apart with one more read, because they are three
         different answers to the reader — 404, 409 and 409 — and guessing
         would make a deleted comment read as "you cannot answer that".

         The read is a *diagnostic* race: the row can change between the failed
         update and here, so the reported reason can be stale. It cannot cause
         a wrong write, because the update above already refused. */
      const [found] = await db
        .select({ status: commentsTable.status })
        .from(commentsTable)
        .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, id)));
      throw new NotAnExplanation(
        id,
        !found ? "missing" : found.status === "none" ? "free" : "running",
      );
    }
    const stored = toComment(row);
    logger.info({ slug, id: stored.id, blockId: stored.blockId }, "comment answer begun");
    return stored;
  },

  /** The reader edited their words. `body` and `updated_at`, and nothing else. */
  async patchBody(slug: string, id: string, body: string | null): Promise<Comment> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const [row] = await db
      .update(commentsTable)
      .set({ body, updatedAt: new Date() })
      .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, id)))
      .returning();
    if (!row) throw new NotAnExplanation(id, "missing");
    // Length, never the text. How much somebody wrote is a fact about the app.
    logger.info({ slug, id, chars: body?.length ?? 0 }, "comment body edited");
    return toComment(row);
  },

  /**
   * Point a comment at the conversation it started. Compare-and-set from null.
   *
   * `thread_id is null` in the WHERE is the compare half, so two requests
   * racing to link the same comment cannot both win. A repeat of the *same*
   * link updates nothing and is reported as success, which is what makes the
   * client's retry harmless.
   */
  async linkThread(
    slug: string,
    id: string,
    threadId: string,
    expect: { blockId: string; quote: string; start: number },
  ): Promise<Comment> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    /* The anchor and `status` are in the WHERE, not read and checked first:
       `sourceCommentId` comes off a request and on its own names any comment
       this reader owns on this article, so the link has to be a compare-and-set
       on the *passage* as well as on the thread — in one statement, with no gap
       for the row to change in. GPT Sol, reviewing the built code. */
    const [row] = await db
      .update(commentsTable)
      .set({ threadId })
      .where(
        and(
          eq(commentsTable.articleId, articleId),
          eq(commentsTable.id, id),
          eq(commentsTable.status, "none"),
          eq(commentsTable.blockId, expect.blockId),
          eq(commentsTable.quote, expect.quote),
          eq(commentsTable.start, expect.start),
          isNull(commentsTable.threadId),
        ),
      )
      .returning();
    if (row) {
      logger.info({ slug, id, threadId }, "comment linked to a conversation");
      return toComment(row);
    }
    const [existing] = await db
      .select()
      .from(commentsTable)
      .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, id)));
    if (!existing) throw new NotAnExplanation(id, "missing");
    /* Already linked to this same thread is the retry, and is success. Anything
       else that reaches here — a different thread, a comment that is not free,
       a different passage — is a link that must not be made. */
    if (
      existing.threadId !== threadId ||
      existing.status !== "none" ||
      existing.blockId !== expect.blockId ||
      existing.quote !== expect.quote ||
      existing.start !== expect.start
    ) {
      throw new CommentIdTaken(id);
    }
    return toComment(existing);
  },

  async patch(
    slug: string,
    id: string,
    patch: AnswerPatch,
    opts: { quiet?: boolean } = {},
  ): Promise<Comment[]> {
    const db = getDb();
    const articleId = await articleIdFor(slug);

    /* `id` is deliberately not settable. src/comments.ts spreads `{ ...c,
       ...patch, id: c.id }` — the trailing `id` puts it back — so a patch
       carrying an id cannot rename a comment. Building the set explicitly is
       the same guarantee without depending on key order. */
    await db
      .update(commentsTable)
      .set({
        /* The anchor is no longer settable here either. `AnswerPatch` is the
           type-level half of the same rule; this is the half that survives a
           caller with an `as never` in it. */
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.answer === undefined ? {} : { answer: patch.answer }),
        ...(patch.citations === undefined ? {} : { citations: patch.citations }),
        ...(patch.searches === undefined ? {} : { searches: patch.searches }),
        ...(patch.model === undefined ? {} : { model: patch.model }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
      })
      .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, id)));

    /* **The lease is deliberately left where it is.** A terminal row's stale
       deadline is unreadable by anything — `sweepPending` looks only at
       `pending` rows, and `beginAnswer` overwrites both fields on the next
       attempt — so clearing it here would buy nothing and would put the fence's
       lifetime in two places. `chat_messages` clears its pair because a CHECK
       constraint insists the two agree; `comments` has no such constraint.

       The stored `error` string is deliberately NOT logged. It is whatever
       `explain` threw, and one of the things `explain` throws carries 400
       characters of a provider's response body — which, for a provider that
       echoes the request back, contains the reader's selected quote and the
       prose around it. src/explain.ts logs its own failure line with the model,
       the status and the elapsed time, which is what actually diagnoses this. */
    if (patch.status === "error" && !opts.quiet) {
      logger.warn({ slug, id }, "comment answer failed");
    }

    return listFor(articleId);
  },

  async remove(slug: string, id: string): Promise<Comment[]> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    await db
      .delete(commentsTable)
      .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, id)));
    const remaining = await listFor(articleId);
    // Logged because it is destructive and there is no undo. `remaining` is the
    // count, so a delete that removed nothing — a stale id from a second tab —
    // can be told apart from one that did.
    logger.info({ slug, id, remaining: remaining.length }, "comment deleted");
    return remaining;
  },

  /**
   * Turn abandoned `pending` comments into `error`, so they can be retried.
   *
   * **Two guards, and each one alone is a bug** — the pair pg-searches.ts §
   * `sweepPending` sets out, with this store's own second half.
   *
   * `keep` is what THIS process is streaming: never swept, whatever the clock
   * says, or a two-minute answer gets killed by the server producing it. The
   * **lease** is for every other process, and it is the guard this store spent
   * four months without: `keep` is a fact about one lambda, and on Vercel a
   * `GET` lands wherever it lands. Without the lease, machine B read machine
   * A's live row, found it in nobody's set, and told the reader "the server
   * stopped before this was answered" about an answer arriving as they read it.
   *
   * A `pending` row with **no lease at all** is sweepable outright: an imported
   * comment, or one begun before this column was written, and either way the
   * process that started it is long gone. Same rule as a run with no attempt.
   *
   * `clock_timestamp()`, not `now()`, which is frozen for the transaction — the
   * distinction `leaseIsOver` in src/store/job-fence.ts makes for the same
   * reason, and the one tests/store-jobs-parity.test.ts caught by hand.
   *
   * No "is anything stale?" pre-check. The file has one to avoid rewriting
   * itself for nothing; an UPDATE that matches no rows costs nothing here.
   */
  async sweepPending(slug: string, keep: ReadonlySet<string>): Promise<Comment[]> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const swept = await db
      .update(commentsTable)
      /* The attempt is declared dead, so its fence goes with it — otherwise the
         row keeps a lease nobody holds, and the next reader of this table finds
         an `error` comment that still names a live attempt. `pg-chat.ts` clears
         its pair for the same reason. */
      .set({ status: "error", error: COMMENT_SWEPT, attemptId: null, leaseExpiresAt: null })
      .where(
        and(
          eq(commentsTable.articleId, articleId),
          eq(commentsTable.status, "pending"),
          sql`(${commentsTable.leaseExpiresAt} is null or ${commentsTable.leaseExpiresAt} <= clock_timestamp())`,
          /* **No empty-list guard.** Raw SQL `not in ()` is a syntax error
             rather than "matches everything", so a hand-written sweep would 500
             on the first read of a quiet article. Drizzle does not do that:
             `notInArray(col, [])` compiles to the literal `true` — measured by
             printing the SQL, in pg-searches.ts, rather than assumed. */
          notInArray(commentsTable.id, [...keep]),
        ),
      )
      .returning({ id: commentsTable.id });

    /* One line for the batch, never one per orphan: every one gets the same
       patch for the same reason, and N is unbounded while Vercel allows 256
       lines for the whole request. Ids and a count, never a quote. */
    if (swept.length) {
      logger.warn(
        { slug, orphans: swept.length },
        `swept ${swept.length} abandoned comment(s) for ${slug}`,
      );
    }
    return listFor(articleId);
  },

  async count(slug: string): Promise<number> {
    const rows = await getDb()
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(eq(commentsTable.articleId, await articleIdFor(slug)));
    return rows.length;
  },
};
