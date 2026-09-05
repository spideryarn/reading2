/**
 * The Postgres chat store, held to `src/chat.ts`'s semantics.
 *
 * Every assertion here has a one-line way to make it red, and the list is
 * deliberately the design's: a retry that keeps the previous attempt's
 * citations, an edit that deletes `>=` instead of `>`, a rename that bumps
 * `updatedAt`, a `finish` that skips the thread's clock when the message did
 * not match, and messages ordered by `created_at` instead of `ordinal`. The
 * last one is the sharpest: it looks right, and **a test that only ever writes
 * one turn cannot tell the two clauses apart**, because a question and its
 * empty answer are written in one call with one timestamp.
 *
 * ## Why it builds its own article
 *
 * An `articles` row with **no `current_revision_id`**, so `listArticles` cannot
 * see it and tests/store-parity.test.ts cannot be made flaky by it. Same trick
 * as tests/store-comments.test.ts.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ChatConflict } from "../src/chat.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articles, chatMessages, chatThreads } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId } from "../src/owner.js";
import { pgChatStore } from "../src/store/pg-chat.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "store-chat-fixture";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000e0";
const THREAD = "spya-thread";
/* A second thread, and every character of it is in the id alphabet — which
   excludes `i`, `l`, `o` and `1` so they cannot be confused when read aloud.
   `spya-other0` looks like a thread id, is not one, and gets silently replaced
   by a minted id: `withTurn` accepts the client's guess only if
   `isSpideryarnId` likes it. That cost twenty minutes here. */
const OTHER = "spya-secnd2";
const NONE: ReadonlySet<string> = new Set();

await pgReady({
  suite: "tests/store-chat-pg.test.ts",
  tables: ["spideryarn.chat_messages"],
  max: 4,
});

/** A clock the test drives, one second per call. */
function clockFrom(iso: string, stepMs = 1000): () => string {
  const start = Date.parse(iso);
  let n = 0;
  return () => new Date(start + stepMs * n++).toISOString();
}

/** The stored ordinals, straight out of SQL — the array cannot hide a mistake. */
async function ordinals(threadId = THREAD): Promise<{ id: string; ordinal: number }[]> {
  return getDb()
    .select({ id: chatMessages.id, ordinal: chatMessages.ordinal })
    .from(chatMessages)
    .where(and(eq(chatMessages.articleId, ARTICLE_ID), eq(chatMessages.threadId, threadId)))
    .orderBy(asc(chatMessages.ordinal));
}

describe("the Postgres chat store", () => {
  beforeAll(async () => {
    await getDb()
      .insert(articles)
      // No `currentRevisionId`, so the library cannot see it. See the header.
      .values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG })
      .onConflictDoNothing();
  });

  afterEach(async () => {
    // Messages cascade from the thread; delete threads and both go.
    await getDb().delete(chatThreads).where(eq(chatThreads.articleId, ARTICLE_ID));
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(chatThreads).where(eq(chatThreads.articleId, ARTICLE_ID));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await closeDb();
  });

  it("starts a turn: the question, an empty pending answer, and the thread's name", async () => {
    const { thread, user, reply } = await pgChatStore.begin(
      SLUG,
      { threadId: THREAD, question: "What is a spandrel?" },
      clockFrom("2026-08-01T00:00:00.000Z"),
    );
    expect(thread.id).toBe(THREAD);
    // The first question names the thread. Later ones do not.
    expect(thread.title).toBe("What is a spandrel?");
    expect(user.status).toBe("done");
    expect(reply.status).toBe("pending");
    expect(reply.text).toBe("");
    expect(await ordinals()).toEqual([
      { id: user.id, ordinal: 0 },
      { id: reply.id, ordinal: 1 },
    ]);
  });

  it("names a thread that exists but has never been asked anything", async () => {
    /* An empty thread is not something the app makes, and it is something the
       importer can: `chat.json` is whatever was on disk. `withTurn` titles a
       thread from the first question whenever it has no messages, so the
       conflict branch of the upsert has to carry the title through — and
       nothing else in these tests exercises that branch, because every other
       thread here is named at the moment it is created. Found by breaking the
       line and watching the parity sequence stay green. */
    await getDb().insert(chatThreads).values({
      articleId: ARTICLE_ID,
      id: THREAD,
      ownerId: currentOwnerId(),
      title: "New chat",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    const { thread } = await pgChatStore.begin(SLUG, {
      threadId: THREAD,
      question: "What is a squinch?",
    });
    expect(thread.title).toBe("What is a squinch?");
    expect((await pgChatStore.load(SLUG))[0]?.title).toBe("What is a squinch?");
  });

  /**
   * **A spoken exchange survives the round trip, pointers and all.**
   *
   * The assertion that matters is `passages`, and it matters because of how it
   * fails. `messageRow` and `toMessage` each enumerate columns by name, so a
   * field named in one and not the other is written and never read, or read and
   * never written — and both are optional on `ChatMessage`, so the compiler is
   * perfectly happy and every spoken answer quietly loses the passages it
   * pointed at. That is exactly how `tools` came to be missing once already.
   *
   * Only a real database can catch it: the pure `withSpokenTurn` tests pass
   * either way, because they never cross the column mapping.
   */
  it("appends a finished spoken exchange, with its pointers and its interruption", async () => {
    const { thread, user, reply } = await pgChatStore.appendSpoken(
      SLUG,
      {
        threadId: THREAD,
        question: "Does he ever use the word qualia?",
        answer: "He does not, and the search comes back empty.",
        passages: [{ blockIds: ["spya-aaa111", "spya-bbb222"], why: "the assumption" }],
        tools: [
          {
            name: "search_article_words",
            label: "searched",
            detail: "nothing found",
            /* Stored runs are finished; `running` is a live-panel state only. */
            status: "done" as const,
          },
        ],
        interrupted: true,
        expectedTailId: null,
      },
      clockFrom("2026-08-31T00:00:00.000Z"),
    );

    /* Both done. Nothing is pending, because nothing is still coming. */
    expect(user.status).toBe("done");
    expect(reply.status).toBe("done");
    expect(thread.title).toBe("Does he ever use the word qualia?");
    expect(await ordinals()).toEqual([
      { id: user.id, ordinal: 0 },
      { id: reply.id, ordinal: 1 },
    ]);

    /* Read back through the store rather than asserting on what we just
       returned — the return value never went near a column. */
    const [reloaded] = await pgChatStore.load(SLUG);
    const answer = reloaded?.messages.at(-1);
    expect(answer?.passages, "passages did not survive the column mapping").toEqual([
      { blockIds: ["spya-aaa111", "spya-bbb222"], why: "the assumption" },
    ]);
    expect(answer?.interrupted).toBe(true);
    expect(answer?.tools).toHaveLength(1);
  });

  it("refuses a spoken append whose expected tail has moved", async () => {
    /* The guard is also the idempotency — there is no exchange-id column, so a
       replayed request is caught by presenting a tail the first one moved. */
    await pgChatStore.appendSpoken(
      SLUG,
      { threadId: THREAD, question: "one", answer: "first", expectedTailId: null },
      clockFrom("2026-08-31T00:00:00.000Z"),
    );
    await expect(
      pgChatStore.appendSpoken(
        SLUG,
        { threadId: THREAD, question: "one", answer: "first", expectedTailId: null },
        clockFrom("2026-08-31T00:00:01.000Z"),
      ),
    ).rejects.toThrow(ChatConflict);
    /* And nothing was written by the refused call. */
    const [reloaded] = await pgChatStore.load(SLUG);
    expect(reloaded?.messages).toHaveLength(2);
  });

  it("leaves passages and interrupted off an ordinary answer", async () => {
    /* Absent, not null and not `[]` — the filesystem store omits the keys and
       tests/store-roundtrip.test.ts compares the two byte for byte. */
    const { reply } = await pgChatStore.appendSpoken(
      SLUG,
      { threadId: THREAD, question: "plain", answer: "also plain", expectedTailId: null },
      clockFrom("2026-08-31T00:00:00.000Z"),
    );
    const [reloaded] = await pgChatStore.load(SLUG);
    const stored = reloaded?.messages.find((m) => m.id === reply.id);
    expect(stored).not.toHaveProperty("passages");
    expect(stored).not.toHaveProperty("interrupted");
  });

  it("orders messages by ordinal, not by the clock", async () => {
    /* **The clock is made to disagree with the order on purpose, and the first
       version of this test did not do that.**

       Writing two turns under one fixed timestamp is the obvious way to catch
       `order by created_at`, and it does not: with every row carrying the same
       instant, Postgres is free to return any order and in practice returns
       insertion order, so the broken clause passes. Verified by breaking it —
       the test stayed green.

       So the second turn is written EARLIER than the first. Now the two clauses
       give genuinely different answers, and the wrong one puts the second
       question above the first. Timestamps that run backwards are not exotic:
       an import replays whatever the file said, and `retry` moves a reply's
       clock forward under a question whose clock does not move. */
    const late = () => "2026-08-01T12:00:00.000Z";
    const early = () => "2026-08-01T09:00:00.000Z";
    const first = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "One?" }, late);
    await pgChatStore.finish(SLUG, THREAD, first.reply.id, { status: "done", text: "A1" }, {
      now: late,
      attempt: first.attempt,
    });
    const second = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Two?" }, early);

    const stored = (await pgChatStore.load(SLUG))[0]?.messages ?? [];
    expect(stored.map((m) => m.id)).toEqual([
      first.user.id,
      first.reply.id,
      second.user.id,
      second.reply.id,
    ]);
    // Said twice, because the roles alone are the readable failure: a
    // conversation that starts with an answer is obviously wrong.
    expect(stored.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("finishes a turn without letting the patch change whose turn it was", async () => {
    const { reply, attempt } = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Q?" });
    await pgChatStore.finish(
      SLUG,
      THREAD,
      reply.id,
      { id: "spya-zzzzzz", role: "user", status: "done", text: "an answer" } as never,
      { attempt },
    );
    const messages = (await pgChatStore.load(SLUG))[0]?.messages ?? [];
    const stored = messages.find((m) => m.id === reply.id);
    expect(stored?.text).toBe("an answer");
    expect(stored?.role).toBe("assistant");
    expect(messages.some((m) => m.id === "spya-zzzzzz")).toBe(false);
  });

  it("bumps the thread's clock even when the message matched nothing", async () => {
    /* The filesystem rebuilds the thread object — and so its `updatedAt` —
       whenever the THREAD matches, whether or not a message inside it does.
       The panel sorts threads by that, so an `if (rowCount)` guard here would
       look like an optimisation and be a real difference in what the reader
       sees. */
    const started = await pgChatStore.begin(
      SLUG,
      { threadId: THREAD, question: "Q?" },
      clockFrom("2026-08-01T00:00:00.000Z"),
    );
    const before = (await pgChatStore.load(SLUG))[0]?.updatedAt;
    await pgChatStore.finish(SLUG, THREAD, "spya-absent", { status: "done" }, {
      now: () => "2026-08-02T00:00:00.000Z",
      attempt: started.attempt,
    });
    const after = (await pgChatStore.load(SLUG))[0]?.updatedAt;
    expect(after).not.toBe(before);
    expect(after).toBe("2026-08-02T00:00:00.000Z");
  });

  it("retries an answer in place, and takes the last attempt's sources with it", async () => {
    const clock = clockFrom("2026-08-01T00:00:00.000Z");
    const { reply, attempt } = await pgChatStore.begin(
      SLUG,
      { threadId: THREAD, question: "Q?" },
      clock,
    );
    await pgChatStore.finish(
      SLUG,
      THREAD,
      reply.id,
      {
        status: "done",
        text: "the first answer",
        citations: [{ url: "https://example.com/one" }],
        searches: 3,
        model: "a-model",
      },
      { attempt },
    );

    const retried = await pgChatStore.retry(SLUG, THREAD, reply.id, clock);
    // Same row, same id — that is what a retry is.
    expect(retried.reply.id).toBe(reply.id);
    const stored = (await pgChatStore.load(SLUG))[0]?.messages.at(-1);
    expect(stored?.status).toBe("pending");
    expect(stored?.text).toBe("");
    /* Every one of these would otherwise survive: a retry that runs no web
       search would keep the old answer's sources, sitting under text that
       never mentions them. */
    expect("citations" in (stored ?? {})).toBe(false);
    expect("searches" in (stored ?? {})).toBe(false);
    expect("model" in (stored ?? {})).toBe(false);
    /* And `createdAt` MOVES — opposite to a search run, where it is the
       question's clock. Leave it and the sweep reads the retry the reader is
       watching as an abandoned message and errors it. */
    expect(stored?.createdAt).not.toBe(reply.createdAt);
    expect(await ordinals()).toHaveLength(2);
  });

  it("edits a question, discards only what came after it, and keeps the question itself", async () => {
    const clock = clockFrom("2026-08-01T00:00:00.000Z");
    const one = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "First?" }, clock);
    await pgChatStore.finish(SLUG, THREAD, one.reply.id, { status: "done", text: "A1" }, {
      attempt: one.attempt,
    });
    const two = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Second?" }, clock);
    await pgChatStore.finish(SLUG, THREAD, two.reply.id, { status: "done", text: "A2" }, {
      attempt: two.attempt,
    });

    const edited = await pgChatStore.edit(SLUG, THREAD, two.user.id, "Second, rewritten?", {
      now: clock,
    });
    expect(edited.discarded).toBe(1);

    /* `>=` instead of `>` deletes the edited question itself, and the reply is
       then anchored to nothing. Reading the ordinals out of SQL rather than
       trusting the returned array is what makes that visible. */
    const rows = await ordinals();
    expect(rows.map((r) => r.ordinal)).toEqual([0, 1, 2, 3]);
    expect(rows[2]?.id).toBe(two.user.id);
    expect(rows[3]?.id).toBe(edited.reply.id);

    const stored = (await pgChatStore.load(SLUG))[0]?.messages ?? [];
    expect(stored[2]?.text).toBe("Second, rewritten?");
    expect(stored[2]?.editedAt).toBeTruthy();
    // The first turn is untouched, and the old answer to the edited question is gone.
    expect(stored[1]?.text).toBe("A1");
    expect(stored.some((m) => m.text === "A2")).toBe(false);
  });

  it("renames the thread when the FIRST question is edited, and not otherwise", async () => {
    const clock = clockFrom("2026-08-01T00:00:00.000Z");
    const one = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "First?" }, clock);
    await pgChatStore.finish(SLUG, THREAD, one.reply.id, { status: "done", text: "A1" }, {
      attempt: one.attempt,
    });
    const two = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Second?" }, clock);
    await pgChatStore.finish(SLUG, THREAD, two.reply.id, { status: "done", text: "A2" }, {
      attempt: two.attempt,
    });

    await pgChatStore.edit(SLUG, THREAD, two.user.id, "Not the first", { now: clock });
    expect((await pgChatStore.load(SLUG))[0]?.title).toBe("First?");

    await pgChatStore.edit(SLUG, THREAD, one.user.id, "Renamed by the first", { now: clock });
    expect((await pgChatStore.load(SLUG))[0]?.title).toBe("Renamed by the first");
  });

  it("refuses a stale tab's edit, which would otherwise delete turns it never saw", async () => {
    /* The sequence that loses an answer with nothing reporting it:
         1. tab A appends Q2/A2
         2. stale tab B edits Q1 — and takes Q2 and A2 with it
         3. A's model finishes, matching nothing; the reader still saw success
         4. reload, and the answer is gone
       The mutex orders those writes. It does not make the result correct. */
    const clock = clockFrom("2026-08-01T00:00:00.000Z");
    const one = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "First?" }, clock);
    await pgChatStore.finish(SLUG, THREAD, one.reply.id, { status: "done", text: "A1" }, {
      attempt: one.attempt,
    });
    const staleTail = one.reply.id; // what tab B last saw

    const two = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Second?" }, clock);
    await pgChatStore.finish(SLUG, THREAD, two.reply.id, { status: "done", text: "A2" }, {
      attempt: two.attempt,
    });

    await expect(
      pgChatStore.edit(SLUG, THREAD, one.user.id, "rewritten", {
        expectedTailId: staleTail,
        now: clock,
      }),
    ).rejects.toBeInstanceOf(ChatConflict);
    // Nothing was discarded.
    expect((await ordinals()).length).toBe(4);

    // An up-to-date client naming the real tail is allowed through.
    await expect(
      pgChatStore.edit(SLUG, THREAD, one.user.id, "rewritten", {
        expectedTailId: two.reply.id,
        now: clock,
      }),
    ).resolves.toBeTruthy();
  });

  it("lets a conflict out as itself, so the route can still answer 409", async () => {
    const { reply } = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Q?" });
    // Still `pending` — the client is a step behind.
    await expect(pgChatStore.retry(SLUG, THREAD, reply.id)).rejects.toBeInstanceOf(ChatConflict);
    await expect(pgChatStore.retry(SLUG, "spya-absent", reply.id)).rejects.toBeInstanceOf(
      ChatConflict,
    );
  });

  it("renames without touching the clock the panel sorts by", async () => {
    /* "Touch `updated_at` on every write" is a habit rather than a decision,
       and here it would jump a renamed conversation to the top of the reader's
       list for no reason they could see. */
    await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Q?" }, clockFrom("2026-08-01T00:00:00.000Z"));
    const before = (await pgChatStore.load(SLUG))[0]?.updatedAt;
    await pgChatStore.rename(SLUG, THREAD, "A better name");
    const after = (await pgChatStore.load(SLUG))[0];
    expect(after?.title).toBe("A better name");
    expect(after?.updatedAt).toBe(before);
  });

  it("deletes a thread and its messages together", async () => {
    await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Q?" });
    expect(await pgChatStore.remove(SLUG, THREAD)).toEqual([]);
    expect(await ordinals()).toEqual([]);
  });

  it("sweeps an old attempt, spares a young one, and spares this process's own", async () => {
    /* **Age comes from the ATTEMPT, not from the message.** An earlier version
       of this test backdated the message's `createdAt` with a fake clock and
       expected a sweep — which is what the store used to do and is wrong:
       `createdAt` is the reader's clock, arrives from an import, and is moved
       by a retry. The lease is the server's, so it is `attempt_started_at`
       that has to be old, and it is set by the database itself. */
    const stale = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Old?" });
    const fresh = await pgChatStore.begin(SLUG, { threadId: OTHER, question: "New?" });
    await getDb()
      .update(chatMessages)
      .set({ attemptStartedAt: new Date(Date.now() - 600_000) })
      .where(and(eq(chatMessages.articleId, ARTICLE_ID), eq(chatMessages.id, stale.reply.id)));

    const after = await pgChatStore.sweepPending(SLUG, { keep: NONE, graceMs: 150_000 });
    const byId = new Map(after.flatMap((t) => t.messages).map((m) => [m.id, m]));
    expect(byId.get(stale.reply.id)?.status).toBe("error");
    // Young enough that some other process may still be on it.
    expect(byId.get(fresh.reply.id)?.status).toBe("pending");
  });

  it("spares an answer this process is still streaming, however old the attempt", async () => {
    const mine = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Slow?" });
    await getDb()
      .update(chatMessages)
      .set({ attemptStartedAt: new Date(Date.now() - 600_000) })
      .where(and(eq(chatMessages.articleId, ARTICLE_ID), eq(chatMessages.id, mine.reply.id)));

    /* Asserted on the message that is IN `keep`, which the previous version of
       this test got wrong: it put the stale id in `keep` and then checked a
       different, fresh message, so deleting `keep` handling entirely would have
       left it green. GPT Sol found that, 2026-08-26. */
    const after = await pgChatStore.sweepPending(SLUG, {
      keep: new Set([mine.reply.id]),
      graceMs: 150_000,
    });
    expect(after.flatMap((t) => t.messages).find((m) => m.id === mine.reply.id)?.status).toBe(
      "pending",
    );
  });

  it("sweeps a message that has no attempt at all — an imported one", async () => {
    // `chat.json` never recorded an attempt, so a `pending` message from an
    // import has nothing to lease and is stale by definition.
    const started = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Q?" });
    await getDb()
      .update(chatMessages)
      .set({
        attemptId: null,
        attemptStartedAt: null,
        createdAt: new Date(Date.now() - 600_000),
      })
      .where(and(eq(chatMessages.articleId, ARTICLE_ID), eq(chatMessages.id, started.reply.id)));
    const after = await pgChatStore.sweepPending(SLUG, { keep: NONE, graceMs: 150_000 });
    expect(after.flatMap((t) => t.messages).find((m) => m.id === started.reply.id)?.status).toBe(
      "error",
    );
  });

  it("serialises two turns on the article, not on the thread", async () => {
    /* **Two plain concurrent calls do not test this**, as the comment store
       found out: each transaction is short enough that Node runs them end to
       end and the assertion passes either way. So the losing side is held open
       by hand — an uncommitted lock on the article row, which is exactly the
       window the bug lives in.

       And the lock is taken on the ARTICLE, not the thread, because `taken()`
       mints against every id in the article: two writers on DIFFERENT threads
       would otherwise share one stale snapshot and could mint the same message
       id. A same-thread test cannot see that, which is why the second half of
       this uses a second thread. */
    const db = getDb();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const holder = db.transaction(async (tx) => {
      await tx
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.id, ARTICLE_ID))
        .for("update");
      await held;
    });

    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
    await settle();

    let landed = false;
    const blocked = pgChatStore
      .begin(SLUG, { threadId: THREAD, question: "Q?" })
      .then((out) => {
        landed = true;
        return out;
      });

    await settle();
    // The lock is the mutex. If this is already true, nothing is serialising.
    expect(landed, "begin did not wait for the article lock").toBe(false);

    release();
    await holder;
    const first = await blocked;

    const second = await pgChatStore.begin(SLUG, { threadId: OTHER, question: "Q2?" });
    expect(await ordinals(THREAD)).toHaveLength(2);
    expect(await ordinals(OTHER)).toHaveLength(2);
    // Four distinct ids across two threads, minted against one article-wide set.
    const ids = new Set([first.user.id, first.reply.id, second.user.id, second.reply.id]);
    expect(ids.size).toBe(4);
  });

  it("refuses a late answer from an attempt the sweep already buried", async () => {
    /* **The search store's race, in chat, and it was left in.**

         1. process A starts an answer
         2. process B's sweep declares it dead
         3. the reader retries — a NEW attempt, and `retry` REUSES the message id
         4. A's model call finally returns and calls finish

       Fenced on article + thread + message id alone, step 4 lands: the reader
       watches their retry be replaced by the answer that already failed, and
       nothing reports it. Reusing the id is exactly what makes a retry a retry,
       so identity cannot be the fence. GPT Sol found this on 2026-08-26, having
       had the identical fault fixed for searches an hour earlier. */
    const started = await pgChatStore.begin(SLUG, { threadId: THREAD, question: "Q?" });
    await getDb()
      .update(chatMessages)
      .set({ attemptStartedAt: new Date(Date.now() - 600_000) })
      .where(and(eq(chatMessages.articleId, ARTICLE_ID), eq(chatMessages.id, started.reply.id)));
    await pgChatStore.sweepPending(SLUG, { keep: NONE, graceMs: 150_000 });

    const retried = await pgChatStore.retry(SLUG, THREAD, started.reply.id);
    expect(retried.reply.id).toBe(started.reply.id); // same row — that is a retry
    expect(retried.attempt).not.toBe(started.attempt);

    await pgChatStore.finish(
      SLUG,
      THREAD,
      started.reply.id,
      { status: "done", text: "the answer that was already dead" },
      { attempt: started.attempt },
    );
    const stale = (await pgChatStore.load(SLUG))[0]?.messages.at(-1);
    expect(stale?.status, "a buried attempt wrote over the live retry").toBe("pending");
    expect(stale?.text).toBe("");

    // And the live attempt still lands.
    await pgChatStore.finish(
      SLUG,
      THREAD,
      started.reply.id,
      { status: "done", text: "the real answer" },
      { attempt: retried.attempt },
    );
    expect((await pgChatStore.load(SLUG))[0]?.messages.at(-1)?.text).toBe("the real answer");
  });

  it("does not let a rename be overwritten by a turn that began before it", async () => {
    /* `begin` reads the thread under the article lock and upserts the title it
       read. If `rename` does not take that lock, it can land in between — and
       `begin` then writes the old title back over it. Impossible under the
       filesystem mutex, which serialises every write in the process.

       Held open by hand, because two concurrent calls are too short to overlap
       on their own. */
    const db = getDb();
    await pgChatStore.begin(SLUG, { threadId: THREAD, question: "First?" });

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await tx
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.id, ARTICLE_ID))
        .for("update");
      await held;
    });

    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
    await settle();

    let renamed = false;
    const rename = pgChatStore.rename(SLUG, THREAD, "Chosen by the reader").then((r) => {
      renamed = true;
      return r;
    });
    await settle();
    expect(renamed, "rename did not wait for the article lock").toBe(false);

    release();
    await holder;
    await rename;
    expect((await pgChatStore.load(SLUG))[0]?.title).toBe("Chosen by the reader");
  });

  it("sweeps a quiet article without a syntax error", async () => {
    await expect(
      pgChatStore.sweepPending(SLUG, { keep: NONE, graceMs: 1000 }),
    ).resolves.toEqual([]);
  });

  it("404s for an article that is not there, and 400s for a non-slug", async () => {
    await expect(pgChatStore.load("no-such-article-at-all")).rejects.toMatchObject({ status: 404 });
    await expect(pgChatStore.load("../etc/passwd")).rejects.toMatchObject({ status: 400 });
  });

  /* ----------------------------------------------------- Remember mode ----
     The two fields the mode added, against the two ways Postgres could lose them
     that the filesystem store cannot. Both are silent failures: no error, no
     visible symptom, and a transcript that still reads as one conversation.
     docs/plans/260827ah-review-mode.md, and GPT Sol's review of it (findings 5 and 6). */

  it("keeps a thread's kind across a second turn that does not mention it", async () => {
    /* A client continuing a conversation sends no kind — the thread already has
       one. This checks the **column**, not the loaded object, because
       `threadsFor` normalises anything unexpected to `"chat"` and would hide a
       write that had blanked it.

       Be exact about what this does NOT catch, because the first version of
       this comment claimed otherwise and was wrong: naming `kind` in
       `upsertThread`'s `set` clause does not make it red. `withTurn` derives
       the value from the existing thread, so the upsert writes `"remember"`
       over `"remember"`. The omission from `set` is defence in depth against a future
       caller that supplies a kind from somewhere else; the test below is the
       one that catches a kind actually changing. */
    await pgChatStore.begin(SLUG, { threadId: THREAD, question: "what I took", kind: "remember" });
    await pgChatStore.begin(SLUG, { threadId: THREAD, question: "and also" });
    const rows = await getDb()
      .select()
      .from(chatThreads)
      .where(and(eq(chatThreads.articleId, ARTICLE_ID), eq(chatThreads.id, THREAD)));
    expect(rows[0]?.kind).toBe("remember");
  });

  it("refuses a second turn that contradicts the thread's kind", async () => {
    /* **The one that matters.** Remove the guard in `withTurn` and this goes
       red — and a Remember thread's second question is then answered with
       chat's prompt,
       its list tag changes, and the transcript still reads as one
       conversation. Nothing else in the suite notices. */
    await pgChatStore.begin(SLUG, { threadId: THREAD, question: "what I took", kind: "remember" });
    await expect(
      pgChatStore.begin(SLUG, { threadId: THREAD, question: "sneaky", kind: "chat" }),
    ).rejects.toBeInstanceOf(ChatConflict);
    expect((await pgChatStore.load(SLUG))[0]?.kind).toBe("remember");
  });

  it("defaults a thread with no kind to chat", async () => {
    await pgChatStore.begin(SLUG, { threadId: THREAD, question: "an ordinary question" });
    expect((await pgChatStore.load(SLUG))[0]?.kind).toBe("chat");
  });

  it("stores the stance on the pending answer, before a word of it exists", async () => {
    const { reply } = await pgChatStore.begin(SLUG, {
      threadId: THREAD,
      question: "what I took",
      kind: "remember",
      stance: "socratic",
    });
    expect(reply.status).toBe("pending");
    const stored = (await pgChatStore.load(SLUG))[0]?.messages.at(-1);
    expect(stored?.stance).toBe("socratic");
    // and never on the reader's own row — the check constraint agrees
    expect((await pgChatStore.load(SLUG))[0]?.messages[0]).not.toHaveProperty("stance");
  });

  it("keeps the stance through a failed answer, which is when it matters most", async () => {
    /* An answer that errored still has to say which instruction produced it,
       because the retry of that row inherits from it. Writing the stance in
       `finish` rather than on the pending row would lose exactly this case. */
    const { reply, attempt } = await pgChatStore.begin(SLUG, {
      threadId: THREAD,
      question: "what I took",
      kind: "remember",
      stance: "respond",
    });
    await pgChatStore.finish(SLUG, THREAD, reply.id, { status: "error", error: "nope" }, { attempt });
    expect((await pgChatStore.load(SLUG))[0]?.messages.at(-1)?.stance).toBe("respond");
  });

  it("carries the stance across a retry rather than dropping it", async () => {
    const { reply, attempt } = await pgChatStore.begin(SLUG, {
      threadId: THREAD,
      question: "what I took",
      kind: "remember",
      stance: "signposts",
    });
    await pgChatStore.finish(SLUG, THREAD, reply.id, { status: "done", text: "a" }, { attempt });
    const again = await pgChatStore.retry(SLUG, THREAD, reply.id);
    expect(again.reply.stance).toBe("signposts");
    expect((await pgChatStore.load(SLUG))[0]?.messages.at(-1)?.stance).toBe("signposts");
  });
});
