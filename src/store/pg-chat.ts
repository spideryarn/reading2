/**
 * Conversations about an article — the Postgres half. src/chat.ts is the other.
 *
 * **The rules are not here.** Which ids are free, which question names a
 * thread, what may be retried, what an edit discards: all of that is
 * `withTurn`, `withRetry` and `withEdit` in src/chat.ts, which both stores
 * call. Only persistence differs. An invariant with two implementations is an
 * invariant with two behaviours, and this migration exists to make that
 * impossible rather than to make it unlikely.
 *
 * ## The article lock is the mutex
 *
 * src/chat.ts serialises every write in the process through one promise chain.
 * Here it is `select … from articles … for update`, and **every method that
 * writes takes it** — not only the three that read-then-write.
 *
 * That last part was got wrong first time and is worth stating plainly. The
 * original took the lock in `begin`, `retry` and `edit` only, on the reasoning
 * that those are the ones that decide something from what they read. But
 * `begin` upserts the *title* it read, so a `rename` landing in between is
 * silently written back to the old name — a lost update the filesystem mutex
 * makes impossible. GPT Sol found it, 2026-08-26.
 *
 * **Article-wide, not per-thread**, and that is not caution. `taken()` scans
 * ids across every thread in the article, and the schema permits the same
 * message id in two different threads — so two writers on *different* threads
 * would otherwise mint against the same stale snapshot and collide. A
 * same-thread concurrency test cannot catch that, which is exactly why it is
 * written down here.
 *
 * **The article row, not an advisory lock.** `beginTurn` may have no thread row
 * to lock — a thread is created by its first question — and the design reached
 * for `pg_advisory_xact_lock` on that basis before noticing that the parent
 * always exists.
 *
 * ## Conflicts come out as themselves
 *
 * `ChatConflict` is thrown from the pure functions, run on the thread list read
 * **inside** the locked transaction, and allowed to propagate. It must not be
 * turned into `tx.rollback()`: Drizzle replaces that with its own
 * `TransactionRollbackError` and src/routes.ts then answers 500 where it should
 * answer 409. Asserted in tests/db-transaction-errors.test.ts rather than left
 * as a paragraph.
 *
 * There is deliberately **no version column**. A `where updated_at = $expected`
 * check would 409 two concurrent *appends* that both succeed today, which is a
 * failure mode invented by the storage change. Every `ChatConflict` here is a
 * stale client, as it always was. The one real hole — a stale tab's edit
 * silently deleting turns it never saw — is closed by `expectedTailId` on the
 * destructive operation alone. See `requireTail` in src/store/fs.ts.
 *
 * **No model call happens inside any of these transactions.**
 *
 * ## What may be logged from this file
 *
 * Ids, slugs, counts, statuses. **Never a message's `text`, never a thread's
 * `title`, never the stored `error`** — src/chat.ts says why the last one
 * matters, and it is the same provider-echo reason here.
 */

import { randomUUID } from "node:crypto";

import { and, asc, eq, gt, isNull, lt, notInArray, or, sql } from "drizzle-orm";

import { titleFrom, withEdit, withRetry, withTurn } from "../chat.js";
import { getDb } from "../db/client.js";
import { articles, chatMessages, chatThreads } from "../db/schema.js";
import { log } from "../log.js";
import { currentOwnerId } from "../owner.js";
import type {
  ChatAnchor,
  Citation,
  ChatMessage,
  ChatThread,
  ReviewStance,
  ToolRun,
} from "../types.js";
import type { ChatStore, SweepOptions } from "./contracts.js";
import { CHAT_SWEPT, requireTail } from "./fs.js";
import { notFound, ownedSlug, requireSlug } from "./pg.js";

const logger = log("store");

/**
 * The database's clock at the moment the statement runs — **not this process's,
 * and not `now()`**.
 *
 * Two things are wrong with taking the time in TypeScript before the
 * transaction. It is a different clock from the one the sweep compares against,
 * so skew between two servers becomes a birth defect in the lease; and it is
 * read before the wait for the article lock, so a write that queued for four
 * seconds starts life four seconds old.
 *
 * `clock_timestamp()` rather than `now()` for the second reason again:
 * `now()` is the *transaction's* start time, which is also before the lock
 * wait. Only `clock_timestamp()` is the moment the row is actually written.
 */
const DB_NOW = sql`clock_timestamp()` as unknown as Date;

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The article's uuid, or a tagged 404 — the same shape src/api.ts throws. */
async function articleIdFor(slug: string, db: Db | Tx = getDb()): Promise<string> {
  requireSlug(slug);
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(ownedSlug(slug))
    .limit(1);
  const found = rows[0];
  if (!found) throw notFound(slug);
  return found.id;
}

/** A message as the client sees it. Absent, not null — `exactOptionalPropertyTypes`. */
function toMessage(row: typeof chatMessages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    role: row.role as ChatMessage["role"],
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    status: row.status as ChatMessage["status"],
    ...(row.citations === null ? {} : { citations: row.citations as Citation[] }),
    ...(row.searches === null ? {} : { searches: row.searches }),
    ...(row.tools === null ? {} : { tools: row.tools as ToolRun[] }),
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.error === null ? {} : { error: row.error }),
    ...(row.stopped ? { stopped: true } : {}),
    ...(row.editedAt === null ? {} : { editedAt: row.editedAt.toISOString() }),
    /* Absent, never `stance: undefined` — the filesystem store simply has no
       key on a chat answer, and tests/store-roundtrip.test.ts compares the two
       byte for byte. Same rule as every field above it. */
    ...(row.stance === null ? {} : { stance: row.stance as ReviewStance }),
  };
}

/**
 * Every thread in the article, with its messages.
 *
 * Threads by `created_at, id`; messages by **`ordinal`**. Both clauses are the
 * ones src/store/export.ts already uses and must stay identical to them.
 *
 * Ordering messages by `created_at` is the obvious clause, looks right, and is
 * wrong: a question and the empty answer beneath it are written in one call
 * with one timestamp, so they collide and sort arbitrarily. That is the whole
 * reason `ordinal` exists — and a test that only ever writes one turn cannot
 * tell the two clauses apart.
 */
/**
 * The three anchor columns, back as the union `ChatAnchor` is.
 *
 * Returns a **fragment to spread**, not a value, so that a thread with no
 * anchor gets no `anchor` key at all rather than `anchor: undefined`. The
 * filesystem store omits the key, `tests/store-roundtrip.test.ts` compares the
 * two, and an explicit undefined is not the same thing as an absent one.
 *
 * The middle case — a block with no quote — is a chat started from a
 * paragraph's chat button rather than from a selection.
 */
function anchorOf(t: {
  anchorBlockId: string | null;
  anchorQuote: string | null;
  anchorStart: number | null;
}): { anchor?: ChatAnchor } {
  if (!t.anchorBlockId) return {};
  if (t.anchorQuote === null || t.anchorStart === null) return { anchor: { blockId: t.anchorBlockId } };
  return { anchor: { blockId: t.anchorBlockId, quote: t.anchorQuote, start: t.anchorStart } };
}

/* `"quote" in anchor` rather than `anchor.quote`, because the union's first arm
   has no such property and reading one off it is a type error rather than a
   silent undefined. The check constraint `chat_threads_anchor_both` says these
   two agree; this is the code that makes sure they always do. */
function quoteOf(anchor: ChatAnchor | undefined): string | null {
  return anchor && "quote" in anchor ? anchor.quote : null;
}

function startOf(anchor: ChatAnchor | undefined): number | null {
  return anchor && "start" in anchor ? anchor.start : null;
}

async function threadsFor(articleId: string, db: Db | Tx = getDb()): Promise<ChatThread[]> {
  const [threadRows, messageRows] = await Promise.all([
    db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.articleId, articleId))
      .orderBy(asc(chatThreads.createdAt), asc(chatThreads.id)),
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.articleId, articleId))
      .orderBy(asc(chatMessages.threadId), asc(chatMessages.ordinal)),
  ]);

  const byThread = new Map<string, ChatMessage[]>();
  for (const row of messageRows) {
    const list = byThread.get(row.threadId) ?? [];
    list.push(toMessage(row));
    byThread.set(row.threadId, list);
  }

  return threadRows.map((t) => ({
    id: t.id,
    title: t.title,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    ...anchorOf(t),
    /* Normalised here, the twin of `normaliseKind` in src/chat.ts. The column
       is `not null default 'chat'` so in practice this only widens the string
       to the union — but the default lives in exactly two places on purpose,
       and this is the second. `ChatThread.kind` is required so that nothing
       downstream has to remember a fallback. */
    kind: t.kind === "review" ? "review" : "chat",
    messages: byThread.get(t.id) ?? [],
  }));
}

/** Take the article row, so nothing else in this article writes until we commit. */
async function lockArticle(tx: Tx, articleId: string): Promise<void> {
  await tx.select({ id: articles.id }).from(articles).where(eq(articles.id, articleId)).for("update");
}

/**
 * One message, as a row.
 *
 * **`ordinal` is always the index in the array the pure function produced**,
 * never `max(ordinal) + 1` worked out separately. Two derivations of one
 * position can disagree, and the unique index on `(article_id, thread_id,
 * ordinal)` then rejects a perfectly legitimate write.
 */
function messageRow(
  articleId: string,
  threadId: string,
  message: ChatMessage,
  ordinal: number,
  attempt?: string,
): typeof chatMessages.$inferInsert {
  return {
    articleId,
    threadId,
    id: message.id,
    ordinal,
    role: message.role,
    text: message.text,
    status: message.status,
    citations: message.citations ?? null,
    searches: message.searches ?? null,
    tools: message.tools ?? null,
    model: message.model ?? null,
    error: message.error ?? null,
    stopped: message.stopped ?? false,
    editedAt: message.editedAt ? new Date(message.editedAt) : null,
    /* Written with the row, which for an assistant reply is the **pending**
       row — see `ChatMessage.stance`. `finish` never touches it: an answer that
       errored, was stopped, or was swept still has to say which instruction
       produced it, and the retry of that row has to have something to inherit. */
    stance: message.stance ?? null,
    createdAt: new Date(message.createdAt),
    ...(attempt === undefined ? {} : { attemptId: attempt, attemptStartedAt: DB_NOW }),
  };
}

/** Insert the thread if it is new, or move its title and clock if it is not. */
async function upsertThread(tx: Tx, articleId: string, thread: ChatThread): Promise<void> {
  await tx
    .insert(chatThreads)
    .values({
      articleId,
      id: thread.id,
      ownerId: currentOwnerId(),
      title: thread.title,
      createdAt: new Date(thread.createdAt),
      updatedAt: new Date(thread.updatedAt),
      anchorBlockId: thread.anchor?.blockId ?? null,
      anchorQuote: quoteOf(thread.anchor),
      anchorStart: startOf(thread.anchor),
      kind: thread.kind,
    })
    .onConflictDoUpdate({
      target: [chatThreads.articleId, chatThreads.id],
      /* `created_at` is deliberately absent: a thread is created once. So are
         the three anchor columns, and for the stronger version of the same
         reason — a conversation is about what it started as, and every later
         turn of an anchored thread comes through here. Naming them in `set`
         would blank the anchor on the second question, which is a mark
         disappearing from the prose rather than an error anybody sees.

         **So is `kind`, and it is the sharpest case of the three.** Every later
         turn of a review thread comes through here. Naming `kind` in `set`
         would let a stale tab's `kind: "chat"` turn a review into a chat on its
         second question — the system prompt changes, the list tag changes, a
         new cache prefix appears, and the transcript reads as one conversation
         throughout. `withTurn` refuses a contradicting kind before we are
         reached; this is why it would not have mattered if it had not.
         docs/plans/review-mode.md § `kind` belongs to the thread. */
      set: { title: thread.title, updatedAt: new Date(thread.updatedAt) },
    });
}

export const pgChatStore: ChatStore = {
  async load(slug: string): Promise<ChatThread[]> {
    return threadsFor(await articleIdFor(slug));
  },

  async begin(slug, turn, now = () => new Date().toISOString()) {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const at = now();
    const attempt = randomUUID();

    const out = await db.transaction(async (tx) => {
      await lockArticle(tx, articleId);
      const threads = await threadsFor(articleId, tx);
      const { thread, user, reply } = withTurn(threads, turn, at);

      await upsertThread(tx, articleId, thread);
      /* The two new messages are the last two of the array the pure function
         produced, so their ordinals are its last two indices. Reading them off
         the array rather than counting rows is what keeps one definition of
         "where this message sits". */
      const base = thread.messages.length - 2;
      await tx
        .insert(chatMessages)
        .values([
          messageRow(articleId, thread.id, user, base),
          // Only the reply carries an attempt: the question is already written.
          messageRow(articleId, thread.id, reply, base + 1, attempt),
        ]);
      return { thread, user, reply, attempt };
    });

    logger.info(
      { slug, threadId: out.thread.id, messageId: out.reply.id, turns: out.thread.messages.length },
      "chat turn started",
    );
    return out;
  },

  async finish(slug, threadId, messageId, patch, opts = {}): Promise<void> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const at = new Date((opts.now ?? (() => new Date().toISOString()))());

    /* **Refused without an attempt, rather than falling back to identity.**

       A retry keeps the message id — that is what makes it a retry — so
       identity cannot say which model call is reporting. Accepting `undefined`
       here would mean a caller that simply forgot to carry the token got the
       old race back in full, with nothing anywhere saying so. That is the
       failure mode this whole migration keeps meeting, so it is an error. */
    const attempt = opts.attempt;
    if (attempt === undefined) {
      throw new Error(
        `finish("${slug}") needs the attempt that begin/retry/edit returned. ` +
          "Without it a model call the sweep already buried can overwrite the retry.",
      );
    }

    await db.transaction(async (tx) => {
      await lockArticle(tx, articleId);
      /* **The thread's clock moves whether or not the message matched.**

         The filesystem does this unconditionally — its `map` rebuilds the
         thread object with a new `updatedAt` even when no message inside it has
         the given id — and the panel sorts threads by `updatedAt`. An
         `if (rowCount)` guard around this would look like an optimisation and
         would be a real divergence in what the reader sees. */
      await tx
        .update(chatThreads)
        .set({ updatedAt: at })
        .where(and(eq(chatThreads.articleId, articleId), eq(chatThreads.id, threadId)));

      /* `id` and `role` are deliberately not settable — src/chat.ts pins both
         back after its spread, so a patch can change what an answer says but
         never whose turn it was. */
      await tx
        .update(chatMessages)
        .set({
          ...(patch.text === undefined ? {} : { text: patch.text }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.citations === undefined ? {} : { citations: patch.citations }),
          ...(patch.searches === undefined ? {} : { searches: patch.searches }),
          ...(patch.tools === undefined ? {} : { tools: patch.tools }),
          ...(patch.model === undefined ? {} : { model: patch.model }),
          ...(patch.error === undefined ? {} : { error: patch.error }),
          ...(patch.stopped === undefined ? {} : { stopped: patch.stopped }),
          ...(patch.editedAt === undefined ? {} : { editedAt: new Date(patch.editedAt) }),
          // The attempt is over. Both columns or neither — the CHECK says so.
          attemptId: null,
          attemptStartedAt: null,
        })
        .where(
          and(
            eq(chatMessages.articleId, articleId),
            eq(chatMessages.threadId, threadId),
            eq(chatMessages.id, messageId),
            // The fence. Three parts, exactly as for a search run.
            eq(chatMessages.status, "pending"),
            eq(chatMessages.attemptId, attempt),
          ),
        );
    });

    if (patch.status === "error") logger.warn({ slug, threadId, messageId }, "chat answer failed");
  },

  async retry(slug, threadId, messageId, now = () => new Date().toISOString()) {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const at = now();
    const attempt = randomUUID();

    const out = await db.transaction(async (tx) => {
      await lockArticle(tx, articleId);
      const threads = await threadsFor(articleId, tx);
      // Throws ChatConflict from inside the transaction, on purpose. See header.
      const { thread, reply, user } = withRetry(threads, threadId, messageId, at);

      await tx
        .update(chatThreads)
        .set({ updatedAt: new Date(thread.updatedAt) })
        .where(and(eq(chatThreads.articleId, articleId), eq(chatThreads.id, thread.id)));

      /* Everything the replaced attempt wrote goes, and **`created_at` moves**.

         The obvious UPDATE sets `text` and `status` and stops. That leaves the
         previous answer's citations sitting under text that never mentions
         them — and leaves a `created_at` old enough that the sweep reads the
         retry the reader is watching as an abandoned message and errors it.
         The reply's `created_at` is the attempt's clock, which is exactly
         opposite to a search run, where it is the question's. */
      await tx
        .update(chatMessages)
        .set({
          text: "",
          status: "pending",
          createdAt: new Date(at),
          citations: null,
          searches: null,
          // A retry that runs no tools must not keep the last attempt's strip.
          // Same rule, same line of reasoning, as the citations above it.
          tools: null,
          model: null,
          error: null,
          stopped: false,
          // A new attempt on the same row. This is what stops the previous
          // one's late answer landing here.
          attemptId: attempt,
          attemptStartedAt: DB_NOW,
        })
        .where(
          and(
            eq(chatMessages.articleId, articleId),
            eq(chatMessages.threadId, thread.id),
            eq(chatMessages.id, reply.id),
          ),
        );
      return { thread, reply, user, attempt };
    });

    logger.info(
      { slug, threadId: out.thread.id, messageId: out.reply.id, turns: out.thread.messages.length },
      "chat answer retried",
    );
    return out;
  },

  async edit(slug, threadId, messageId, question, opts = {}) {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const at = (opts.now ?? (() => new Date().toISOString()))();
    const attempt = randomUUID();

    const out = await db.transaction(async (tx) => {
      await lockArticle(tx, articleId);
      const threads = await threadsFor(articleId, tx);
      /* Checked against the list read INSIDE the lock. Checking a copy read
         earlier would be checking what the client saw against what the client
         saw. See `requireTail` in src/store/fs.ts for why only the destructive
         operation carries this guard. */
      if (opts.expectedTailId !== undefined) {
        requireTail(threads, threadId, opts.expectedTailId);
      }
      const { thread, user, reply, discarded } = withEdit(
        threads,
        threadId,
        messageId,
        question,
        at,
      );

      await tx
        .update(chatThreads)
        .set({ title: thread.title, updatedAt: new Date(thread.updatedAt) })
        .where(and(eq(chatThreads.articleId, articleId), eq(chatThreads.id, thread.id)));

      /* **`>` and never `>=`, and the delete comes first.**

         The edited question keeps its place, so it must survive; `>=` would
         delete the message being edited and then insert a reply pointing at
         nothing. And deleting before inserting in the same transaction is what
         keeps the unique index on `(article_id, thread_id, ordinal)` from ever
         seeing two rows in the same slot. */
      const kept = thread.messages.length - 2;
      await tx
        .delete(chatMessages)
        .where(
          and(
            eq(chatMessages.articleId, articleId),
            eq(chatMessages.threadId, thread.id),
            gt(chatMessages.ordinal, kept),
          ),
        );

      await tx
        .update(chatMessages)
        .set({ text: user.text, editedAt: user.editedAt ? new Date(user.editedAt) : null })
        .where(
          and(
            eq(chatMessages.articleId, articleId),
            eq(chatMessages.threadId, thread.id),
            eq(chatMessages.id, user.id),
          ),
        );

      await tx
        .insert(chatMessages)
        .values(messageRow(articleId, thread.id, reply, kept + 1, attempt));
      return { thread, user, reply, discarded, attempt };
    });

    logger.info(
      {
        slug,
        threadId: out.thread.id,
        messageId: out.reply.id,
        discarded: out.discarded,
        turns: out.thread.messages.length,
      },
      "chat question edited",
    );
    return out;
  },

  async rename(slug: string, threadId: string, title: string): Promise<ChatThread[]> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    /* **`updated_at` is deliberately not touched.** The file does not touch it,
       and the panel sorts by it — so "bump the clock on every write", which is
       a habit rather than a decision, would jump a renamed conversation to the
       top of the reader's list for no reason they could see. */
    /* The lock matters here even though this is one statement, because it is
       not racing with itself — it is racing with `begin`, which reads the title
       under the lock and upserts what it read. Without this, a rename that
       lands in the middle of a turn is written back to the old name. */
    await db.transaction(async (tx) => {
      await lockArticle(tx, articleId);
      await tx
        .update(chatThreads)
        .set({ title: titleFrom(title) })
        .where(and(eq(chatThreads.articleId, articleId), eq(chatThreads.id, threadId)));
    });
    logger.info({ slug, threadId }, "chat thread renamed");
    return threadsFor(articleId);
  },

  async remove(slug: string, threadId: string): Promise<ChatThread[]> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    // Messages go with it: `chat_messages_thread_fk` is `on delete cascade`.
    // Under the lock for the same reason as `rename`: a `begin` in flight would
    // otherwise re-create the thread it just read.
    await db.transaction(async (tx) => {
      await lockArticle(tx, articleId);
      await tx
        .delete(chatThreads)
        .where(and(eq(chatThreads.articleId, articleId), eq(chatThreads.id, threadId)));
    });
    const remaining = await threadsFor(articleId);
    logger.info({ slug, threadId, remaining: remaining.length }, "chat thread deleted");
    return remaining;
  },

  async sweepPending(slug: string, opts: SweepOptions): Promise<ChatThread[]> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const cutoff = new Date(Date.now() - opts.graceMs);

    /* No "is anything stale?" pre-check. The file has one to avoid rewriting
       itself for nothing; an UPDATE that matches no rows costs nothing here.

       `keep` is what this process is streaming — never swept, whatever the
       clock says, or a long answer gets killed by the server producing it.
       The age check is for every other process. */
    await db
      .update(chatMessages)
      // The attempt is declared dead, so its fence goes with it — otherwise the
      // row keeps a lease nobody holds and the CHECK's "both or neither" turns
      // into "a buried message still names a live attempt".
      .set({ status: "error", error: CHAT_SWEPT, attemptId: null, attemptStartedAt: null })
      .where(
        and(
          eq(chatMessages.articleId, articleId),
          eq(chatMessages.status, "pending"),
          /* Age from the ATTEMPT where there is one, and from the message
             otherwise. A retry moves `created_at` too, so either would work
             today — but `created_at` is the reader's clock and the attempt's is
             the server's, and only the second is the one a lease should be
             measured against. Imported messages have no attempt at all. */
          or(
            and(isNull(chatMessages.attemptStartedAt), lt(chatMessages.createdAt, cutoff)),
            lt(chatMessages.attemptStartedAt, cutoff),
          ),
          notInArray(chatMessages.id, [...opts.keep]),
        ),
      );

    return threadsFor(articleId);
  },
};
