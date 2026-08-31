# Review a plan: making a comment free — bookmarks and notes on a passage

TypeScript + React + Postgres (drizzle) reading app. Review a plan **before it is built**.

**Work from the code pasted below. Do not go exploring the repo** — a previous run of this review
spent 45 minutes reading files and produced nothing. Read exactly two files if you want more:
`docs/plans/260828a-comments-and-bookmarks.md` (the plan) and `docs/plans/260826ab-chat-as-gateway.md` (what shipped
yesterday). Everything else you need is inlined here. **Budget your time and answer.**

## The user's ask, verbatim

> I'm thinking that someone might want to simply add bookmarks or comments to the text, without
> wanting an AI response. Perhaps the easiest way to do this would be to rename Questions →
> Comments, i.e. you can select some text, and that bookmarks it. You can optionally add a comment.
> And you can request (when you do so) whether you want an AI response (in which case it kicks off
> a Chat).

## Today

Two things can anchor to a stretch of prose, and both cost a model call.

1. **`Comment`** — the reader selected a sentence and the model explained it. **Closed to new
   arrivals 2026-08-26**: the client call was deleted and `POST /api/comments/:slug` refuses an id
   it has not already stored. Existing ones still open, retry and deepen. Anchored
   `{blockId, quote, start}` onto `block_identities` (a permanent id spine; identities are never
   deleted). Drawn as a `cmt` mark. Labelled **"Questions"** in the UI, `comments` in the code.
2. **`ChatThread.anchor`** — a selection now opens a floating ask box; typing and pressing Ask
   starts a conversation anchored to the same words. Drawn as a `chat` mark.

You (as GPT-5.6 Sol) reviewed that anchor plan and found four silent seams: export, import,
identity minting on import, and "the anchor columns must be insert-only in `upsertThread`". The
same class of mistake is what I most want you hunting here.

## What the plan proposes

Option **B** of four: make `comments` the reader's *free* mark on a passage.

- `Comment` gains `body?` (their own words — an empty box is a bare bookmark), `updatedAt?`,
  `threadId?`.
- `status` gains `'none'`, so a comment that never had a model call cannot be seen by
  `sweepOrphaned`.
- `POST /api/comments/:slug` reopens as *create, with no model call*; the old "answer this" meaning
  still has to serve `retry` and `deepen`.
- A new `PATCH /api/comments/:slug/:id { body }` edits one.
- `comments_thread_fk (article_id, thread_id) → chat_threads (article_id, id) on delete set null`.
- Labels become "Comments"; **no id or URL parameter is renamed** (`?note=`, column id
  `questions`), because those are in shared links and saved sort state.
- The selection box gets `[Save] [Save & ask] [Cancel]`: Enter = Save (free), ⌘/Ctrl+Enter = Save
  & ask. Today Enter in that box = Ask, which costs money.

Rejected: **A** a new `notes` table; **C** a bookmark is a chat thread with no messages; **D** move
the anchor into a new `annotations` layer both hang off (rejected on timing — `chat_threads.anchor`
shipped yesterday).

## The questions, in priority order

1. **The seams.** Walk `body` / `updatedAt` / `threadId` from browser to Postgres and back out
   through an archive export/import, and name every place one is silently dropped, coerced to
   `null`, or blanked by a later write. I have already found two — say if they are right and what
   else is there:
   - `pgCommentStore.create`'s `onConflictDoUpdate` `set: fields` would **blank `body`** on every
     retry/deepen, because those send only `{id, blockId, quote, start}`. Fix: make `body`,
     `threadId`, `updatedAt` insert-only, exactly as you told me to do for the chat anchor columns.
     Same bug in the filesystem `createComment`, whose reset branch rebuilds the object from named
     fields and would drop `body`.
   - `import.ts` inserts **comments before chat threads** (line ~640 vs ~684), so a
     `comments_thread_fk` would fail the whole transaction on any archive with an anchored comment.
2. **`status: 'none'`** — right, or a mistake? It mixes "what kind of comment this is" with "how the
   model call went". Is a nullable status or a separate discriminator better? Whatever you pick,
   say exactly what `sweepOrphaned` and `pgCommentStore` must do about it.
3. **Reopening `POST /api/comments/:slug`** so one route means both "create a bookmark, spend
   nothing" and "answer this passage, spend money". One route with two meanings, or two routes?
   What must the validation be — the chat route has `checkAnchor`, which verifies the quote really
   is the text at that offset in that block, and the comment route has **no** such check today.
4. **Is B the right call at all?** Argue against it. Is my objection to C (a zero-message thread
   lying to the chat list, the `chats` counts, `ChatBand`'s auto-start, title generation) actually
   true? Is D really as expensive as I claim?
5. **The double mark.** A comment that started a chat has both a `cmt` and a `chat` mark over
   identical text; `annotateHtml` merges them into one `<mark class="cmt chat">` and the click
   handler prefers chat. Does the reader then lose the ability to reach their own note?
6. **The UI call.** Is silently changing what Enter costs — from "spend a model call" to "save for
   free" — a trap? Two buttons, or a "get an AI response" checkbox (closer to what the user said)?

## How to answer

Ordered findings, worst first, each with **severity (blocking / should-fix / minor)**, where it
breaks, why, and the concrete fix. Then a one-paragraph verdict: build as written, build with the
changes you name, or do something else. Be blunt. A plan-stage review that says "looks good" is
worth nothing.

## The code

### `src/types.ts` lines 1281-1308

```ts

/**
 * A reader's question about a stretch of prose, and the model's answer.
 *
 * Stored in `data/<slug>/comments.json` — reader state, so it lives beside the
 * article rather than in it. See docs/project/comments.md.
 *
 * The anchor is `blockId` plus the exact `quote`; `start` only picks between
 * repeats of the same words within the block. That ordering matters: an offset
 * alone would silently drift the moment the paragraph changed, which is the
 * failure random block ids exist to prevent (docs/project/block-ids.md).
 */
export interface Comment {
  id: string;
  blockId: BlockId;
  quote: string;
  /** Where `quote` sat in the block's rendered text when the comment was made. */
  start: number;
  createdAt: string;
  /** `pending` is written to disk *before* the model call, so a crash is visible rather than silent. */
  status: "pending" | "done" | "error";
  answer?: string;
  citations?: Citation[];
  /** How many web searches the model chose to run. 0 means it was sure. */
  searches?: number;
  model?: string;
  error?: string;
}
```

### `src/db/schema.ts` lines 571-625

```ts
/* ------------------------------------------------------------- comments -- */

/**
 * A reader's question about a stretch of prose, and the model's answer.
 *
 * Anchored to the block IDENTITY, not to the current revision's rows. The
 * anchor is `blockId` plus the exact `quote`; `start` only picks between
 * repeats of the same words inside one block. An offset alone would drift
 * silently the moment the paragraph changed.
 *
 * `id` is client-minted so that creating one is idempotent on retry.
 * `attemptId` and `leaseExpiresAt` replace the in-process `answering` Set in
 * src/routes.ts, which cannot survive more than one server process.
 */
export const comments = spideryarn.table(
  "comments",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    /** `auth.users(id)`. FK in the custom migration. */
    ownerId: uuid("owner_id").notNull(),
    blockId: text("block_id").notNull(),
    quote: text("quote").notNull(),
    start: integer("start").notNull(),
    status: text("status").notNull(),
    answer: text("answer"),
    citations: jsonb("citations").$type<Citation[]>(),
    /** How many web searches the model chose to run. 0 means it was sure. */
    searches: integer("searches"),
    model: text("model"),
    error: text("error"),
    /** Fences every write, so a stale attempt cannot overwrite a newer answer. */
    attemptId: uuid("attempt_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.id] }),
    check("comments_status", sql`${t.status} in ('pending','done','error')`),
    check("comments_start", sql`${t.start} >= 0`),
    /**
     * Points at the IDENTITY. This is the whole design: the block's text can
     * vanish in a re-extraction and this row survives, because identities are
     * never deleted. src/web/comment-nav.ts already sorts such a comment to the
     * end rather than dropping it — "it is still the reader's question".
     */
    foreignKey({
      name: "comments_identity_fk",
      columns: [t.articleId, t.blockId],
      foreignColumns: [blockIdentities.articleId, blockIdentities.blockId],
    }),
  ],
);
```

### `src/db/schema.ts` lines 1099-1205

```ts
  completionTokens: integer("completion_tokens"),
  /** Micro-dollars, so this stays an integer and never a drifting float. */
  costMicros: integer("cost_micros"),
  latencyMs: integer("latency_ms"),
  finishReason: text("finish_reason"),
  error: text("error"),
  rawResponse: jsonb("raw_response"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ chat -- */

/**
 * One conversation about one article. Reader state, so it hangs off the
 * ARTICLE and not off a revision — a re-extraction must not delete a
 * conversation, for the same reason it must not delete a comment.
 *
 * Keyed `(article_id, id)` like comments, because thread ids are minted per
 * article by the same `mintId()` and are not promised to be globally unique.
 */
export const chatThreads = spideryarn.table(
  "chat_threads",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    /** `auth.users(id)`. FK in the custom migration. */
    ownerId: uuid("owner_id").notNull(),
    /** Derived from the reader's first message rather than demanded up front. */
    title: text("title").notNull(),
    createdAt: createdAt(),
    /** Bumped on every stored message, so the list can show recent first. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * **The passage this conversation was started from**, as three columns.
     *
     * A selection in the prose sets all three; a paragraph's chat button sets
     * only the block; an ordinary chat sets none. See `ChatAnchor` in
     * src/types.ts for why that is a union there and not three optional fields.
     *
     * **Points at the IDENTITY**, exactly as `comments.blockId` does, and the
     * plan this came from argued against that key on a premise that was simply
     * false: a re-extraction replaces *revision blocks*, and identities are
     * never deleted (see `blockIdentities` above). Pointing here is the whole
     * reason a comment survives losing its paragraph, and a conversation has
     * strictly more to lose than a comment does. Hence no `on delete set null`
     * — there is no delete to react to.
     *
     * Written **on insert only**: `upsertThread`'s conflict clause does not
     * name them, for the same reason it does not name `created_at`.
     */
    anchorBlockId: text("anchor_block_id"),
    anchorQuote: text("anchor_quote"),
    anchorStart: integer("anchor_start"),

    /**
     * A question about the article, or the reader saying what they took from
     * it — which chooses the system prompt the whole conversation is answered
     * with. See docs/plans/260827ah-review-mode.md.
     *
     * **Written on insert only**, and `upsertThread`'s conflict clause does not
     * name it, for a sharper version of the reason it does not name the anchor
     * columns: every later turn of a review thread comes through that upsert,
     * so a stale tab sending `kind: "chat"` would turn a review into a chat on
     * its second question. The prompt would change, the list tag would change,
     * and the transcript would still read as one conversation.
     *
     * `default 'chat'` is what makes the migration additive: every thread that
     * existed before review mode is a chat, and no backfill is needed.
     */
    kind: text("kind").notNull().default("chat"),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.id] }),
    check("chat_threads_id_format", sql`${t.id} ~ ${sql.raw(`'${SPIDERYARN_ID_REGEX}'`)}`),
    /* A quote is meaningless without the block it sits in. */
    check(
      "chat_threads_anchor_quote_needs_block",
      sql`${t.anchorQuote} is null or ${t.anchorBlockId} is not null`,
    ),
    /* Both or neither. Half an anchor is a mark drawn a few characters to the
       left of the words it belongs to — wrong, and wrong in a way that looks
       like a styling glitch. Same rule, same reason, as
       `chat_messages_attempt_both`. */
    check(
      "chat_threads_anchor_both",
      sql`(${t.anchorQuote} is null) = (${t.anchorStart} is null)`,
    ),
    check(
      "chat_threads_anchor_start",
      sql`${t.anchorStart} is null or ${t.anchorStart} >= 0`,
    ),
    /* These checks are necessary and nowhere near sufficient, which is worth
       saying next to them: a malformed id, an empty quote, an offset past the
       end of the block, and a quote that is not the text at that offset all
       pass every one of them. Format and existence are the foreign key's job;
       the rest is route validation against the rendered block. */
    foreignKey({
      name: "chat_threads_anchor_identity_fk",
      columns: [t.articleId, t.anchorBlockId],
      foreignColumns: [blockIdentities.articleId, blockIdentities.blockId],
    }),
    check("chat_threads_kind", sql`${t.kind} in ('chat','review')`),
  ],
);
```

### `src/comments.ts` lines 118-128

```ts
export interface NewComment {
  blockId: string;
  quote: string;
  start: number;
  /**
   * Minted by the client, so the dialog and `?note=` have a real id from the
   * first frame and nothing has to be swapped when the answer lands. Refused if
   * it collides, and re-minted here if absent.
   */
  id?: string;
}
```

### `src/comments.ts` lines 122-189

```ts
  /**
   * Minted by the client, so the dialog and `?note=` have a real id from the
   * first frame and nothing has to be swapped when the answer lands. Refused if
   * it collides, and re-minted here if absent.
   */
  id?: string;
}

/**
 * Store a comment as `pending`, **before** the model is called.
 *
 * That ordering is the point. If the process dies mid-answer, the record is
 * still there and still says `pending`, so the reader sees a question that never
 * got answered and can retry — rather than a selection that quietly evaporated.
 *
 * **Idempotent on `input.id`.** A retry sends the id it already has, and that
 * must reset the existing comment rather than append a second one: a new row
 * would leave the failed original in the file, drawing a second mark over the
 * same words that nothing can clear. It also makes a duplicated POST — React
 * StrictMode double-invoking an effect, a reader double-clicking — harmless
 * instead of a way to spend two model calls and orphan one of them.
 */
export async function createComment(
  slug: string,
  input: NewComment,
  now: () => string = () => new Date().toISOString(),
): Promise<Comment> {
  let stored!: Comment;
  let reset = false;
  await update(slug, (comments) => {
    const existing = comments.find((c) => c.id === input.id);
    reset = existing !== undefined;
    // Reset in place: the answer, citations, searches and error all go, because
    // they belong to the attempt being replaced. `createdAt` stays — the reader
    // asked the question once.
    if (existing) {
      stored = {
        id: existing.id,
        blockId: input.blockId,
        quote: input.quote,
        start: input.start,
        createdAt: existing.createdAt,
        status: "pending",
      };
      return comments.map((c) => (c.id === stored.id ? stored : c));
    }
    const taken = new Set(comments.map((c) => c.id));
    stored = {
      id:
        input.id !== undefined && isSpideryarnId(input.id)
          ? input.id
          : mintUniqueId(taken),
      blockId: input.blockId,
      quote: input.quote,
      start: input.start,
      createdAt: now(),
      status: "pending",
    };
    return [...comments, stored];
  });
  // After the write, so the line means "this is on disk" rather than "this was
  // attempted". `reset` is worth a field: a duplicate POST and a genuine retry
  // look identical from here, and both land as a reset rather than a second
  // row, so a run of them is the signal that something upstream is repeating
  // itself. Ids only — the quote is the reader's, and it never goes to stdout.
  log("store").info({ slug, id: stored.id, blockId: stored.blockId, reset }, "comment created");
  return stored;
}
```

### `src/store/pg-comments.ts` lines 61-76

```ts
/** A row as the client sees it. Absent, not null — `exactOptionalPropertyTypes`. */
function toComment(row: typeof commentsTable.$inferSelect): Comment {
  return {
    id: row.id,
    blockId: row.blockId,
    quote: row.quote,
    start: row.start,
    createdAt: row.createdAt.toISOString(),
    status: row.status as Comment["status"],
    ...(row.answer === null ? {} : { answer: row.answer }),
    ...(row.citations === null ? {} : { citations: row.citations }),
    ...(row.searches === null ? {} : { searches: row.searches }),
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.error === null ? {} : { error: row.error }),
  };
}
```

### `src/store/pg-comments.ts` lines 83-205

```ts
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
  async create(slug: string, input: NewComment): Promise<Comment> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const supplied = input.id !== undefined && isSpideryarnId(input.id) ? input.id : undefined;

    const fields = {
      blockId: input.blockId,
      quote: input.quote,
      start: input.start,
      status: "pending",
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
        .onConflictDoUpdate({
          target: [commentsTable.articleId, commentsTable.id],
          set: fields,
        })
        .returning();
      // `row!`: an insert with `returning()` yields exactly the row it wrote,
      // and `do update` yields the row it updated. `noUncheckedIndexedAccess`
      // cannot know that either branch always produces one.
      return toComment(row!);
    };

    if (supplied) {
      const stored = await write(supplied);
      /* `reset` is read off `createdAt` rather than off which branch ran,
         because with one statement there are no branches to read. A row whose
         `created_at` predates this call is a row that already existed. The
         second is slack for clock skew between the app and the database; this
         is a log field, and being approximately right about a retry is worth
         more than a second round trip to be exactly right. */
      const age = Date.now() - new Date(stored.createdAt).getTime();
      logger.info(
        { slug, id: stored.id, blockId: stored.blockId, reset: age > 1000 },
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
        logger.info(
          { slug, id: stored.id, blockId: stored.blockId, reset: false },
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
```

### `src/routes.ts` lines 453-541

```ts
}

/**
 * Create a comment, answer it a few words at a time, and store the answer.
 *
 * **Validation happens before a single header is written**, so a bad request is
 * still an ordinary JSON 400 — the thrown `httpError` never reaches a
 * half-opened stream. Everything after `sse(res)` is frames, including failure.
 *
 * Three writes, deliberately: `pending` lands before the model call so a crash
 * leaves evidence, and the terminal state is written before the last frame so
 * the disk and the reader can never disagree. A model failure is a `done` frame
 * carrying a comment whose status is `error` — the request *did* succeed at what
 * it was for, which was recording the question; the dialog shows the failure and
 * offers a retry.
 *
 * Frames: one `begin`, then any number of `delta`, then exactly one `done`.
 *
 * **`begin` carries the whole comment, and that is the point of it.**
 * `commentStore.create` re-mints the id when the client's is malformed or
 * collides, and with a stream there is no response body to carry the real one
 * back. Without this frame the client would stream an answer into a row the
 * server has never heard of, and a reload would show a different comment.
 * src/web/useChat.ts § Begun is the write-up of that exact bug happening in
 * chat, weeks after the ids stopped matching.
 */
async function answer(slug: string, body: unknown, res: ServerResponse): Promise<void> {
  const { id, blockId, quote, start, deep, useProfile } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof blockId !== "string" || typeof quote !== "string" || typeof start !== "number") {
    throw httpError(400, "Expected { blockId, quote, start }");
  }
  // `start` indexes into the block's rendered text, so anything that is not a
  // whole non-negative number is meaningless. A negative one is worse than
  // meaningless: `resolveMark`'s fast path returns it unchanged, and the mark is
  // drawn a few characters to the left of the words it belongs to — wrong, and
  // wrong in a way that looks like a styling glitch rather than bad data.
  if (!Number.isInteger(start) || start < 0) {
    throw httpError(400, `start must be a non-negative integer, got ${start}`);
  }
  /* Anything other than `true` is not deep. A 400 here would be a validation
     message built from the request body, which is the one thing `httpError`
     messages must never be — they are logged as `reason`, and redaction is
     path-based and cannot reach a string. See the note on `httpError` below. */
  const deeper = deep === true;
  /* `!== false`, the mirror of the line above and deliberately not the same
     rule. Deep search is an extra the reader asks for, so absent means no;
     the profile is the default this app now writes with, so absent means yes
     and only an explicit refusal turns it off. */
  const wantsProfile = useProfile !== false;

  // Before the comment is created, so a slug that is not an article is a clean
  // 404 with nothing written, rather than a stored comment whose only content is
  // the error we could have known about first.
  const article = await loadArticle(slug);

  /* **This route no longer creates explanations.**
   *
   * Since 2026-08-26 a selection opens a chat rather than buying an answer
   * (docs/plans/260826ab-chat-as-gateway.md), and Greg's call was that the explanation
   * panel becomes a museum: it can show the ones you already made, and retry
   * and deepen them, but there is no way to make a new one.
   *
   * Deleting `useComments.ask` closes the React path and **nothing else**. A
   * stale tab left open in another window, or a direct request, would still
   * land here and `create` would happily mint a row. "There is no way to make a
   * new one" is then a fact about the current build rather than a rule, which
   * is the kind of thing that quietly stops being true. So the rule lives here,
   * where the writing happens.
   *
   * Retry and deepen both send the id they already have, so requiring one costs
   * them nothing. `create` stays idempotent on that id and is still what resets
   * the row — see the note on `CommentStore.create`. */
  if (typeof id !== "string") throw httpError(400, "Expected { id }");
  const known = (await commentStore.load(slug)).some((c) => c.id === id);
  if (!known) {
    throw httpError(
      404,
      "Selecting text starts a conversation now; there is no explanation to answer",
    );
  }

  const comment = await commentStore.create(slug, { blockId, quote, start, id });
  const key = `${slug}/${comment.id}`;
  const release = beganAnswering(key);

  const { frame } = sse(res);
```

### `src/routes.ts` lines 310-341

```ts
  };
}

/**
 * Turn abandoned `pending` comments into `error`, so they can be retried.
 *
 * Run on read rather than at startup: it is the same answer either way, and a
 * read is the only moment anyone cares. Anything `pending` that this process is
 * not working on has no answer coming — the server restarted, or the request
 * was cut off — and saying so out loud is the whole point. The retry path for
 * `error` already exists, so nothing in the client changes.
 */
async function sweepOrphaned(slug: string, comments: Comment[]): Promise<Comment[]> {
  const orphans = comments.filter(
    (c) => c.status === "pending" && !answering.has(`${slug}/${c.id}`),
  );
  if (orphans.length === 0) return comments;
  const patch = {
    status: "error" as const,
    error: "The server stopped before this was answered.",
  };
  let latest = comments;
  // `quiet`, then one line for the batch. Every orphan gets the same patch for
  // the same reason, so a line each would say one thing N times — and N is
  // unbounded while Vercel allows 256 lines for the whole request.
  for (const orphan of orphans) latest = await commentStore.patch(slug, orphan.id, patch, { quiet: true });
  log("store").warn(
    { slug, orphans: orphans.length },
    `swept ${orphans.length} abandoned comment(s) for ${slug}`,
  );
  return latest;
}
```

### `src/routes.ts` lines 1629-1661

```ts

/**
 * The anchor against the article it claims to be part of.
 *
 * Three things the schema cannot check, in the order they matter:
 *
 *  - **the block is one of this article's.** The foreign key would catch it too,
 *    but as a 500 out of a transaction rather than as a 400 anybody can read;
 *  - **the offset is inside the block**, rather than past the end of it;
 *  - **the quote is really the text at that offset.** Not required to match —
 *    the client measures in the *rendered* offset space and the server has the
 *    block's `text`, and the two can differ by whitespace — so a mismatch is
 *    allowed through. `resolveMark` re-finds the quote in the rendered text
 *    rather than trusting the offset, exactly as src/quote-match.ts does for a
 *    search hit, so a drifted offset costs nothing. What is refused is a quote
 *    that is not in the block **at all**, which is the case that means the
 *    client is anchoring to something else entirely.
 */
function checkAnchor(anchor: ChatAnchor, blocks: Block[]): void {
  const block = blocks.find((b) => b.id === anchor.blockId);
  if (!block) throw httpError(400, "anchor.blockId is not a block of this article");
  if (!("quote" in anchor)) return;
  if (anchor.start > block.text.length) {
    throw httpError(400, "anchor.start is past the end of that block");
  }
  /* Whitespace-folded on both sides, because the rendered text the client
     measured collapses runs of space that `block.text` may keep. Comparing them
     literally rejected perfectly good selections. */
  const fold = (t: string) => t.replace(/\s+/g, " ").trim();
  if (!fold(block.text).includes(fold(anchor.quote))) {
    throw httpError(400, "anchor.quote is not in that block");
  }
}
```

### `src/store/export.ts` lines 367-388

```ts
  const commentRows = await db
    .select()
    .from(commentsTable)
    .where(eq(commentsTable.articleId, article.id))
    .orderBy(asc(commentsTable.createdAt), asc(commentsTable.id));
  if (commentRows.length) {
    const comments: Comment[] = commentRows.map((row) =>
      compact({
        id: row.id,
        blockId: row.blockId,
        quote: row.quote,
        start: row.start,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
        answer: row.answer,
        citations: row.citations,
        searches: row.searches,
        model: row.model,
        error: row.error,
      }) as Comment,
    );
    await put("comments.json", { comments });
```

### `src/store/import.ts` lines 627-659

```ts
    await tx.delete(searchRuns).where(eq(searchRuns.articleId, articleId));
    await tx.delete(glossaryLookups).where(eq(glossaryLookups.articleId, articleId));

    // Comments anchor to the identity, so any block id they name has to exist
    // as an identity even if this revision no longer contains it. That is the
    // whole design: the paragraph can go, the question stays.
    if (storedComments.length) {
      const named = [...new Set(storedComments.map((c) => c.blockId))];
      await tx
        .insert(blockIdentities)
        .values(named.map((blockId) => ({ articleId, blockId })))
        .onConflictDoNothing();

      for (const comment of storedComments) {
        await tx
          .insert(commentsTable)
          .values({
            articleId,
            id: comment.id,
            ownerId,
            blockId: comment.blockId,
            quote: comment.quote,
            start: comment.start,
            status: comment.status,
            answer: comment.answer ?? null,
            citations: comment.citations ?? null,
            searches: comment.searches ?? null,
            model: comment.model ?? null,
            error: comment.error ?? null,
            createdAt: new Date(comment.createdAt),
          })
          .onConflictDoNothing();
      }
```

### `src/store/import.ts` lines 676-713

```ts
      await tx
        .insert(blockIdentities)
        .values(anchoredBlocks.map((blockId) => ({ articleId, blockId })))
        .onConflictDoNothing();
    }

    for (const thread of chat) {
      await tx
        .insert(chatThreads)
        .values({
          articleId,
          id: thread.id,
          ownerId,
          title: thread.title,
          createdAt: new Date(thread.createdAt),
          updatedAt: new Date(thread.updatedAt),
          /* `"quote" in anchor` rather than `anchor.quote`: the union's
             block-only arm has no such property, so reading one off it is a
             type error rather than a silent undefined. */
          anchorBlockId: thread.anchor?.blockId ?? null,
          anchorQuote: thread.anchor && "quote" in thread.anchor ? thread.anchor.quote : null,
          anchorStart: thread.anchor && "start" in thread.anchor ? thread.anchor.start : null,
          /* A `chat.json` written before review mode has no `kind`; the column
             is `not null`, so it needs one here rather than a null. `"chat"` is
             the same default `normaliseKind` applies in src/chat.ts and the same
             one the column declares — three places, all saying chat, because
             the alternative to a default here is a failed import of every
             pre-existing file. */
          kind: thread.kind === "review" ? "review" : "chat",
        })
        .onConflictDoNothing();

      // `ordinal` from the array index, exactly as for blocks: `createdAt`
      // cannot order these because a user turn and the pending assistant turn
      // answering it are written together and collide within the millisecond.
      for (const [index, message] of thread.messages.entries()) {
        await tx
          .insert(chatMessages)
```

### `src/web/annotate.ts` lines 37-85

```ts
import { PALETTE_SLOTS } from "./hit-colours.js";
import type { Block, BlockId } from "../types.js";

/**
 * What a mark is *for*, and therefore how it is drawn and what listens to it.
 *
 * `cmt` is a comment: a persistent artefact the reader made, clickable, and it
 * carries the ✳ marker at its end. `chat` is a conversation started from that
 * selection — persistent and clickable in the same way, and since 2026-08-26 it
 * is the one a fresh selection makes (docs/plans/260826ab-chat-as-gateway.md); comments
 * are closed to new arrivals, so a `cmt` mark is now always an older one.
 * `term` is a glossary occurrence: standing —
 * every term in the list is drawn, in every mode, since 2026-08-26 — and inert
 * to the *click*, because pressing it should do what pressing the prose has
 * always done. Hovering one is not inert: it opens the term's card
 * (ProseHoverCard.tsx), which is the affordance that replaced the underline
 * appearing and disappearing. `hit` is a search result: transient in
 * the same way, inert in the same way, and the only kind whose *intensity*
 * carries information — see `strength`.
 *
 * **Any two of them can cover the same words**, and that is the case worth
 * being careful about: a reader can ask a question about a sentence that also
 * contains a term and also matches what they searched for. So the merged
 * `<mark>` carries whichever classes apply, and each kind's attributes are
 * populated from its own marks alone — a click handler that read a term's id
 * out of `data-comment` would try to open a comment that does not exist.
 *
 * **A `chat` and a `cmt` over the same words is the one overlap a reader can
 * click**, and only one of them can win. The handler in TableView.tsx prefers
 * the chat: it is the living artefact, and since comments can no longer be
 * created the overlap is always an older explanation. The comment does not
 * become unreachable — the Dock's drawer lists every comment for the article
 * and opens it — it loses a shortcut. A chooser is the right answer if these
 * turn out to be common, and they should be getting rarer.
 *
 * **This is why we did not need the CSS Custom Highlight API.**
 * docs/project/original-version/highlighting.md is emphatic that a third kind
 * of mark over the same prose is where a wrapper-span library gives up, because
 * HTML elements nest and two ranges that merely cross have no valid markup —
 * and it recommends `::highlight()` over `Range` objects instead. That
 * recommendation is right about the problem and was aimed at a different
 * solution to it: `annotateHtml` below does not wrap a range, it **cuts every
 * text node at every boundary and labels each piece with whichever marks cover
 * it**. Nothing nests, so nothing can fail to nest. The third kind cost this
 * file one entry in a union and one `if`, which is the evidence that the
 * approach holds; if a fourth ever needs per-mark *styling* that classes cannot
 * express, that is when to reconsider.
 */
export type MarkKind = "cmt" | "chat" | "term" | "hit";
```
