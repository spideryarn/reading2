# Second pass: review the BUILT code for "a comment is free"

You reviewed the plan for this a few hours ago and said **"build B, but not as written"**, with
three blocking findings. It is now built. **This review matters more than the plan review** — a
plan-stage review cannot find a `PATCH` that writes one field and then rejects the request.

**Work from the code pasted below. Do not go exploring the repo** — an earlier run of a review here
spent 45 minutes reading files and produced nothing. If you must, read only
`docs/plans/260828a-comments-and-bookmarks.md`. **Budget your time and answer.**

TypeScript + React + Postgres (drizzle), `exactOptionalPropertyTypes: true`. Two storage adapters
(filesystem JSON and Postgres) that must stay behaviourally identical — there is a parity test and
an archive round-trip test that compare them structurally, so `null` vs an absent key is a real
difference.

## What you asked for, and what was done

1. **"Creation and answering cannot share `CommentStore.create`"** — and specifically that reopening
   POST makes an id collision destructive. Done: `create` is free-only and returns the stored row
   only when the anchor *and* body match, else throws `CommentIdTaken` → 409. `beginAnswer` is the
   legacy retry path, takes an id and nothing else, and refuses `status: "none"`. Postgres `create`
   went from `on conflict do update` to `do nothing` + read-back-and-decide.
2. **"`Save & ask` cannot populate `threadId` as planned"** — you were right that the client's
   thread id is a guess. Done differently from your five-step choreography: **there is no client
   link call and no link route at all.** The chat request carries `sourceCommentId`, and the chat
   stream calls `linkThread` server-side at the moment it has the real `thread.id`.
3. **"The archive import order is broken"** — fixed: identities (union of comment and chat anchors),
   then threads and messages, then comments. And **the foreign key on `thread_id` was dropped
   entirely** — reasoning below; tell me if this is wrong.
4. **Field mutability rules** — written into the store contract as a table, and each operation
   writes a named allowlist.
5. **`status: 'none'` kept**, and you were right that `sweepOrphaned` needs no change and that the
   test I proposed for it could never go red. It was replaced.
6. **Anchor validation** written out in the comment route rather than borrowed from `checkAnchor` —
   you were right that `checkAnchor` never verifies the offset and would accept `""` on its own.
7. **Double mark**: the click rule flipped — the comment wins when its `threadId` names the
   overlapping chat.
8. **UI**: a checkbox, Enter inserts a newline, ⌘/Ctrl+Enter saves, button renames itself.

## The one place I deliberately went against you: no foreign key on `thread_id`

You said `on delete set null`. I dropped the FK entirely. The argument:

- The link is **advisory** — a comment whose conversation was deleted is still the reader's mark,
  and the "Open the conversation this started" button checks the live summary list anyway.
- `on delete set null` covers a delete that goes through Postgres. An archive written by the
  **filesystem** store can contain a link to a thread `chat.json` no longer has, and that arrives as
  a raw FK violation with no useful message.
- The filesystem adapter has no constraints and cannot cascade, so an FK would make the two stores
  behave differently — which is precisely what the parity test exists to catch.

**Is that reasoning sound, or am I talking myself out of integrity I should want?**

## What I want from you, worst first

1. **Anything that is wrong in the code below** — races, a field silently dropped or blanked, an
   error mapped to the wrong status, a validation that can be walked round, an `exactOptional`
   `null`-vs-absent mistake, a log line that could carry the reader's prose (that is a hard rule
   here: no quote and no body may ever reach a log or an `httpError` message, because those are
   logged as `reason` and redaction is key-name-based).
2. **`pgCommentStore.create` specifically.** It is now insert-`do nothing`, then read, then compare
   four fields, then either return or throw. Walk the concurrent cases. Is there a state where two
   simultaneous Saves both succeed, or where a legitimate retry gets a 409, or where the read-back
   sees a row from a different article?
3. **`beginAnswer` in Postgres** is one `UPDATE … WHERE status <> 'none' RETURNING`, then a second
   read to tell "missing" from "free" apart. Is the second read a race — could it report the wrong
   one, and does that matter?
4. **The server-side link.** It runs inside the chat stream after `beginTurn`, before the `begin`
   frame, and swallows its own failure with a warn. Is that the right place and the right failure
   mode? Can `sourceCommentId` be used to link a comment on a *different* article, or somebody
   else's comment? (Note the store's `articleIdFor(slug)` scoping and that comments are owner-scoped.)
5. **The client.** `useComments.create` is optimistic and removes its row on failure;
   `send`'s `pending` now spreads the stored comment rather than naming fields. Did I break the
   deep-search "keep the old answer on screen" behaviour, or leave a way for an edit to blank the
   answer in memory?
6. **The tests I have.** Which of them would pass against broken code? I have deliberately watched
   four of them go red by breaking the source and putting it back. What is untested that should not
   be?

## How to answer

Ordered findings, worst first, each with **severity (blocking / should-fix / minor)**, the file, why
it breaks, and the concrete fix. Then a one-paragraph verdict: ship, ship with the changes you name,
or do not ship. Be blunt.

## The code

### `src/types.ts` lines 1293-1343

```ts
export interface Comment {
  id: string;
  blockId: BlockId;
  quote: string;
  /** Where `quote` sat in the block's rendered text when the comment was made. */
  start: number;
  createdAt: string;

  /**
   * The reader's own words about this passage.
   *
   * Absent on a bare bookmark — the reader marked the words and wrote nothing —
   * and absent on every explanation made before 2026-08-28, when a comment was
   * a question you paid for rather than a mark you made.
   *
   * **Absent, never `""`.** The route trims once and drops an empty string, so
   * "they wrote nothing" has one representation rather than two that compare
   * unequal across the two stores. Reader prose: never logged, never in a URL,
   * rendered as text. docs/plans/260828a-comments-and-bookmarks.md.
   */
  body?: string;
  /** ISO. Present only once the body has been edited since it was made. */
  updatedAt?: string;
  /**
   * The conversation this comment started, if the reader ticked the box.
   *
   * **Advisory, and deliberately not a foreign key** — see the plan for why the
   * reflex to add one is wrong here. A thread the reader has since deleted
   * leaves this pointing at nothing, which is benign: the comment is still
   * their mark on the passage, and whoever offers "Open chat" checks the thread
   * is really there first, exactly as `?thread=` already has to.
   */
  threadId?: string;

  /**
   * How the *model call* went, and only that.
   *
   * `none` is every comment made from 2026-08-28: no call was ever attempted,
   * which is what a bookmark is. The other three keep the meaning they had —
   * `pending` is written before the call, so a crash is visible rather than
   * silent. A separate "kind" field would be worse: a body, a legacy answer and
   * a linked chat are independent properties, not exclusive kinds.
   */
  status: "none" | "pending" | "done" | "error";
  answer?: string;
  citations?: Citation[];
  /** How many web searches the model chose to run. 0 means it was sure. */
  searches?: number;
  model?: string;
  error?: string;
}
```

### `src/db/schema.ts` lines 586-656

```ts
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
    /**
     * The reader's own words. Null on a bare bookmark and on every explanation
     * made before 2026-08-28. `comments_body_nonempty` below is what keeps
     * "wrote nothing" from having two spellings.
     */
    body: text("body"),
    /** Set when the body is edited, and only then. Null means never edited. */
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    /**
     * The conversation this comment started. **No foreign key, on purpose** —
     * see docs/plans/260828a-comments-and-bookmarks.md § There is deliberately no
     * foreign key. The short version: the link is advisory, a deleted thread
     * leaves a comment that is still the reader's mark, and a constraint
     * Postgres can keep and the filesystem store cannot is exactly what
     * tests/store-parity.test.ts exists to catch.
     */
    threadId: text("thread_id"),
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
    /**
     * `none` is every comment made from 2026-08-28: the reader marked a passage
     * and no model call was ever attempted. The other three keep their meaning,
     * and `sweepOrphaned` in src/routes.ts still filters on exactly `pending`,
     * so a bookmark is invisible to it without that function changing at all.
     */
    check("comments_status", sql`${t.status} in ('none','pending','done','error')`),
    check("comments_start", sql`${t.start} >= 0`),
    /**
     * An empty body is a different value to no body, and the client cannot be
     * trusted to keep that straight across two stores and an archive
     * round-trip. `exactOptionalPropertyTypes` makes `""` and absent different
     * shapes in TypeScript; this makes them impossible in the database.
     */
    check("comments_body_nonempty", sql`${t.body} is null or length(btrim(${t.body})) > 0`),
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

### `src/comments.ts` lines 118-376

```ts
export interface NewComment {
  blockId: string;
  quote: string;
  start: number;
  /**
   * The reader's own words, already trimmed by the route.
   *
   * Absent for a bare bookmark. **Never `""`** — the route drops an empty
   * string rather than passing one down, so there is one representation of
   * "they wrote nothing" and not two that compare unequal.
   */
  body?: string;
  /**
   * Minted by the client, so the dialog and `?note=` have a real id from the
   * first frame and nothing has to be swapped when the answer lands. Refused if
   * it collides with a *different* comment, and re-minted here if absent.
   */
  id?: string;
}

/** Thrown when a client-minted id is already taken by a different comment. */
export class CommentIdTaken extends Error {
  constructor(readonly id: string) {
    super(`A different comment already has the id ${id}`);
    this.name = "CommentIdTaken";
  }
}

/** Thrown by `beginAnswer` for an id that is not there, or is a bookmark. */
export class NotAnExplanation extends Error {
  constructor(readonly id: string, readonly why: "missing" | "free") {
    super(
      why === "missing"
        ? `No comment with the id ${id}`
        : `Comment ${id} was never a question, so there is nothing to answer`,
    );
    this.name = "NotAnExplanation";
  }
}

/** Is this the same passage? The three fields that may never be rewritten. */
function sameAnchor(a: Comment, b: NewComment): boolean {
  return a.blockId === b.blockId && a.quote === b.quote && a.start === b.start;
}

/**
 * Store a free comment — the reader's mark on a passage. **No model call, ever.**
 *
 * `status: "none"` says exactly that, and it is what keeps a bookmark out of
 * `sweepOrphaned`, which turns an abandoned `pending` row into an error: a
 * bookmark is not an answer that never arrived.
 *
 * ## Idempotent means *return the one you have*, not *overwrite it*
 *
 * This function used to reset the row a colliding id named, because the only
 * caller was a retry of the model call and resetting was the point. Reopening
 * creation makes that destructive: a new bookmark carrying an id that already
 * exists is indistinguishable from a retry, so the reset would silently
 * overwrite a comment the reader made earlier in another tab, anchor and all.
 * Found by GPT Sol reviewing this plan, 2026-08-28.
 *
 * So: same id and the same anchor and the same body ⇒ hand back the stored row,
 * which makes a double-clicked Save and a retried POST harmless. Anything else
 * under that id ⇒ `CommentIdTaken`, which the route turns into a 409.
 */
export async function createComment(
  slug: string,
  input: NewComment,
  now: () => string = () => new Date().toISOString(),
): Promise<Comment> {
  let stored!: Comment;
  let repeat = false;
  await update(slug, (comments) => {
    const existing = input.id === undefined ? undefined : comments.find((c) => c.id === input.id);
    if (existing) {
      // The body is compared too, so re-sending a *changed* body under a stored
      // id is refused rather than quietly ignored. Editing goes through
      // `patchBody`, which is the operation allowed to move that field.
      if (!sameAnchor(existing, input) || (existing.body ?? undefined) !== input.body) {
        throw new CommentIdTaken(existing.id);
      }
      stored = existing;
      repeat = true;
      return comments;
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
      ...(input.body === undefined ? {} : { body: input.body }),
      status: "none",
    };
    return [...comments, stored];
  });
  // After the write, so the line means "this is on disk" rather than "this was
  // attempted". Ids and a flag only — the quote and the body are the reader's
  // and never go to stdout.
  log("store").info({ slug, id: stored.id, blockId: stored.blockId, repeat }, "comment created");
  return stored;
}

/**
 * Reset a *legacy explanation* for another attempt at the model call.
 *
 * The other half of what `createComment` used to be, and split from it because
 * one function cannot safely mean both "make this" and "redo this" once making
 * one is free — see the note on `createComment`.
 *
 * **It takes an id and nothing else.** The anchor is read from the stored row
 * rather than accepted from the request, which closes the hole where a retry
 * could quietly move a comment to a different passage. Everything the reader
 * owns survives: the anchor, `createdAt`, `body`, `updatedAt`, `threadId`. Only
 * the answer fields go, because they belong to the attempt being replaced.
 *
 * Refuses `status: "none"`. A bookmark was never a question, and the retired
 * explanation path must not be reachable from one.
 */
export async function beginAnswer(slug: string, id: string): Promise<Comment> {
  let stored!: Comment;
  await update(slug, (comments) => {
    const existing = comments.find((c) => c.id === id);
    if (!existing) throw new NotAnExplanation(id, "missing");
    if (existing.status === "none") throw new NotAnExplanation(id, "free");
    stored = {
      id: existing.id,
      blockId: existing.blockId,
      quote: existing.quote,
      start: existing.start,
      createdAt: existing.createdAt,
      ...(existing.body === undefined ? {} : { body: existing.body }),
      ...(existing.updatedAt === undefined ? {} : { updatedAt: existing.updatedAt }),
      ...(existing.threadId === undefined ? {} : { threadId: existing.threadId }),
      status: "pending",
    };
    return comments.map((c) => (c.id === id ? stored : c));
  });
  log("store").info({ slug, id: stored.id, blockId: stored.blockId }, "comment answer begun");
  return stored;
}

/**
 * The reader edited their words. Sets `body` and `updatedAt`, and nothing else.
 *
 * `null` clears the body — a comment becoming a bare bookmark again — and is
 * how the dialog's box empties. There is no third state: `""` never reaches
 * here, because the route trims once and turns it into `null`.
 */
export async function patchCommentBody(
  slug: string,
  id: string,
  body: string | null,
  now: () => string = () => new Date().toISOString(),
): Promise<Comment> {
  let stored!: Comment;
  await update(slug, (comments) =>
    comments.map((c) => {
      if (c.id !== id) return c;
      const { body: _old, ...rest } = c;
      stored = { ...rest, ...(body === null ? {} : { body }), updatedAt: now() };
      return stored;
    }),
  );
  if (!stored) throw new NotAnExplanation(id, "missing");
  // Length rather than the text. Whether somebody wrote three words or three
  // hundred is a fact about the app; what they wrote is theirs.
  log("store").info({ slug, id, chars: body?.length ?? 0 }, "comment body edited");
  return stored;
}

/**
 * Point a comment at the conversation it started. **Compare-and-set from absent.**
 *
 * A second call with the same id is a no-op, which is what makes the link
 * survivable when the client retries; a call with a *different* id is refused,
 * because a comment starts one conversation and re-pointing it would silently
 * orphan the first.
 *
 * The id must be the one the **server** confirmed. `useChat.send` mints an
 * optimistic id and the store may hand back a different one, so linking the
 * guess is a link to a thread that does not exist.
 */
export async function linkCommentThread(
  slug: string,
  id: string,
  threadId: string,
): Promise<Comment> {
  let stored!: Comment;
  let already = false;
  await update(slug, (comments) =>
    comments.map((c) => {
      if (c.id !== id) return c;
      if (c.threadId !== undefined && c.threadId !== threadId) {
        throw new CommentIdTaken(c.id);
      }
      already = c.threadId === threadId;
      stored = { ...c, threadId };
      return stored;
    }),
  );
  if (!stored) throw new NotAnExplanation(id, "missing");
  if (!already) log("store").info({ slug, id, threadId }, "comment linked to a conversation");
  return stored;
}

/**
 * Replace one comment's fields, leaving the rest of the file alone.
 *
 * `quiet` suppresses the failure line below, for a caller patching a *batch* of
 * comments to `error` at once — the orphan sweep in src/routes.ts, which can
 * touch every pending comment on an article in one request. One line each is
 * bounded by nothing, and Vercel allows 256 for the whole request. The sweep
 * says it once, with a count. Raised by GPT/Codex in review.
 */
export async function patchComment(
  slug: string,
  id: string,
  patch: Partial<Comment>,
  opts: { quiet?: boolean } = {},
): Promise<Comment[]> {
  const next = await update(slug, (comments) =>
    comments.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)),
  );
  /* A question that failed to get an answer. The reader sees this — the comment
     shows as errored — so it is not silent to them; it is silent to whoever is
     running the server.

     **The stored `error` string is deliberately NOT logged**, and the reasoning
     is worth keeping because the first version did log it and it looked
     harmless. That string is whatever `explain` threw, and one of the things
     `explain` throws is `OpenRouter ${status}: ${body.slice(0, 400)}` — four
     hundred characters of a provider's response body. A provider that echoes
     the request back in an error puts the reader's selected quote, and the
     article prose around it, into that string. It would have arrived here as a
     field called `reason` on a line that reads like a status code.

     Nothing is lost by dropping it: src/explain.ts logs its own failure line
     with the model, the HTTP status, the elapsed time and whether the deadline
     fired, which is what actually tells a bad key from a slow model. Found by
     GPT/Codex reviewing this change.
     **The throw site is fixed now (2026-08-26).** `src/explain.ts` no longer puts any of
     the provider's body in the message — see `ProviderRefused` in
     src/ai-call.ts — so the string this line declines to log is safe
     today. The line still declines to log it, because a rule that holds only
     while six call sites stay careful is not a rule; and because what a reader
     of this log line needs is the status and the model, which are already on
     it. */
  if (patch.status === "error" && !opts.quiet) {
    log("store").warn({ slug, id }, "comment answer failed");
  }
  return next;
}

export async function deleteComment(slug: string, id: string): Promise<Comment[]> {
```

### `src/store/pg-comments.ts` lines 62-363

```ts
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
      const same =
        stored.blockId === input.blockId &&
        stored.quote === input.quote &&
        stored.start === input.start &&
        stored.body === input.body;
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
      })
      .where(
        and(
          eq(commentsTable.articleId, articleId),
          eq(commentsTable.id, id),
          ne(commentsTable.status, "none"),
        ),
      )
      .returning();
    if (!row) {
      /* Nothing updated: either there is no such comment, or it is a bookmark.
         Told apart with one more read, because the two are different errors to
         the reader — 404 against 409 — and guessing would make a missing
         comment read as "you cannot answer that". */
      const [found] = await db
        .select({ status: commentsTable.status })
        .from(commentsTable)
        .where(and(eq(commentsTable.articleId, articleId), eq(commentsTable.id, id)));
      throw new NotAnExplanation(id, found ? "free" : "missing");
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
  async linkThread(slug: string, id: string, threadId: string): Promise<Comment> {
    const db = getDb();
    const articleId = await articleIdFor(slug);
    const [row] = await db
      .update(commentsTable)
      .set({ threadId })
      .where(
        and(
          eq(commentsTable.articleId, articleId),
          eq(commentsTable.id, id),
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
    // Already linked. The same thread is the retry; a different one is a
    // comment being re-pointed, which would orphan the first conversation.
    if (existing.threadId !== threadId) throw new CommentIdTaken(id);
    return toComment(existing);
  },

  async patch(
```

### `src/routes.ts` lines 464-624

```ts
function tidyBody(body: string | null | undefined): string | null {
  if (typeof body !== "string") return null;
  const trimmed = body.trim();
  if (!trimmed) return null;
  /* A limit, because this is the reader's own text going into a `text` column
     and a JSON file and every archive of both. Generous enough that nobody
     writing a note about a paragraph meets it. The message says the limit and
     **never the text** — an `httpError` message is logged as `reason`, and
     redaction here is path-based and cannot reach a string. */
  if (trimmed.length > MAX_BODY_CHARS) {
    throw httpError(400, `A comment can be at most ${MAX_BODY_CHARS} characters [cmt-long]`);
  }
  return trimmed;
}

/** Room for a few paragraphs of thinking about one passage, and no more. */
const MAX_BODY_CHARS = 4000;

/**
 * Store a **free** comment — the reader's mark on a passage. No model call.
 *
 * This is what selecting text does since 2026-08-28. Until then, selecting text
 * bought an explanation, and this route was `answer` below; the two split
 * because a colliding id means opposite things to them (a retry to one,
 * somebody else's comment to the other) and one function could not safely be
 * both. docs/plans/260828a-comments-and-bookmarks.md.
 *
 * ## The anchor is checked against the article, here
 *
 * `checkAnchor` exists for chat and is **weaker than it looks**: it verifies the
 * quote is *somewhere* in the block, not that it is at the offset given, and on
 * its own it would accept an empty quote because every string contains `""`.
 * GPT Sol pointed that out reviewing this plan. So the checks are written out
 * rather than borrowed, and `start` is bounded as well as non-negative — a
 * `start` past the end of the block draws the mark in the wrong place, which
 * reads as a styling glitch rather than as bad data.
 *
 * **No message built here may contain the quote or the body.** Both are the
 * reader's, `httpError` messages are logged as `reason`, and redaction matches
 * key names rather than values, so the only thing keeping prose out of the log
 * is not putting it in. Same rule as the top of src/comments.ts.
 */
async function createFree(slug: string, body: unknown): Promise<Comment> {
  const {
    id,
    blockId,
    quote,
    start,
    body: text,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof blockId !== "string" || typeof quote !== "string" || typeof start !== "number") {
    throw httpError(400, "Expected { blockId, quote, start }");
  }
  if (!isSpideryarnId(blockId)) throw httpError(400, "blockId must be a block id");
  if (id !== undefined && (typeof id !== "string" || !isSpideryarnId(id))) {
    throw httpError(400, "id must be a block id");
  }
  if (!quote.trim()) throw httpError(400, "quote must not be empty");
  if (quote.length > MAX_QUOTE_CHARS) {
    throw httpError(400, `A quote can be at most ${MAX_QUOTE_CHARS} characters [cmt-quote]`);
  }
  if (!Number.isInteger(start) || start < 0) {
    throw httpError(400, `start must be a non-negative integer, got ${start}`);
  }
  const tidied = tidyBody(text as string | null | undefined);

  // Before anything is written, so a slug that is not an article is a clean 404
  // with nothing left behind.
  const article = await loadArticle(slug);
  const block = article.blocks.find((b) => b.id === blockId);
  if (!block) throw httpError(400, "blockId is not a block of this article");
  if (start > block.text.length) throw httpError(400, "start is past the end of that block");
  /* Folded, because `quote` came from a DOM selection and `block.text` from the
     extractor, and the two disagree about runs of whitespace — the same fold
     `checkAnchor` uses, for the same reason. */
  if (!foldSpace(block.text).includes(foldSpace(quote))) {
    throw httpError(400, "quote is not in that block");
  }

  return commentStore.create(slug, {
    blockId,
    quote,
    start,
    ...(tidied === null ? {} : { body: tidied }),
    ...(typeof id === "string" ? { id } : {}),
  });
}

/** A selection, not an essay. Long enough for a run-on sentence and no more. */
const MAX_QUOTE_CHARS = 2000;

/**
 * Collapse runs of whitespace, for comparing a selection against a block.
 *
 * **One of these, used by both anchor checks.** A quote comes from a DOM
 * selection and `block.text` comes from the extractor, and the two disagree
 * about runs of whitespace — see the note in src/blocks.ts. `checkAnchor` had
 * its own copy of this line; two copies of a normaliser is how a chat anchor
 * and a comment anchor end up disagreeing about the same passage.
 */
const foldSpace = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * Answer a **legacy explanation** a few words at a time, and store the answer.
 *
 * Reached only as `POST /api/comments/:slug/:id/answer`, and only by *Try
 * again* and *Search the web properly* on a comment that already has an answer
 * or an error. Since 2026-08-26 a selection opens a conversation rather than
 * buying one of these, and since 2026-08-28 it makes a free comment; nothing
 * creates a new explanation, and this route cannot.
 *
 * **It takes an id and no anchor.** `beginAnswer` reads the stored passage
 * rather than accepting one, which closes the hole where a retry could quietly
 * move a comment to different words — and it refuses a `status: "none"` row,
 * so a bookmark cannot be dragged into the retired path.
 *
 * **Validation happens before a single header is written**, so a bad request is
 * still an ordinary JSON 400 — the thrown `httpError` never reaches a
 * half-opened stream. Everything after `sse(res)` is frames, including failure.
 *
 * Three writes, deliberately: `pending` lands before the model call so a crash
 * leaves evidence, and the terminal state is written before the last frame so
 * the disk and the reader can never disagree. A model failure is a `done` frame
 * carrying a comment whose status is `error` — the request *did* succeed at what
 * it was for; the dialog shows the failure and offers a retry.
 *
 * Frames: one `begin`, then any number of `delta`, then exactly one `done`.
 */
async function answer(
  slug: string,
  id: string,
  body: unknown,
  res: ServerResponse,
): Promise<void> {
  const { deep, useProfile } = (body ?? {}) as Record<string, unknown>;
  /* Anything other than `true` is not deep. A 400 here would be a validation
     message built from the request body, which is the one thing `httpError`
     messages must never be — they are logged as `reason`, and redaction is
     path-based and cannot reach a string. */
  const deeper = deep === true;
  /* `!== false`, the mirror of the line above and deliberately not the same
     rule. Deep search is an extra the reader asks for, so absent means no; the
     profile is the default this app now writes with, so absent means yes and
     only an explicit refusal turns it off. */
  const wantsProfile = useProfile !== false;

  // Before the row is touched, so a slug that is not an article is a clean 404.
  const article = await loadArticle(slug);
  if (!isSpideryarnId(id)) throw httpError(400, "id must be a comment id");

  /* Throws `NotAnExplanation` for an unknown id and for a bookmark, which
     `serveApi`'s error mapping turns into a 404 and a 409. The anchor comes
     back off the stored row — the request never gets to name one. */
  const comment = await commentStore.beginAnswer(slug, id);
  const { blockId, quote } = comment;
  const key = `${slug}/${comment.id}`;
  const release = beganAnswering(key);

  const { frame } = sse(res);
  frame("begin", comment);
```

### `src/routes.ts` lines 323-342

```ts
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

### `src/web/useComments.ts` lines 417-535

```ts
  const create = useCallback(
    async (input: NewCommentInput): Promise<Comment | null> => {
      const id = mintId();
      const optimistic: ClientComment = {
        id,
        blockId: input.blockId,
        quote: input.quote,
        start: input.start,
        createdAt: new Date().toISOString(),
        ...(input.body ? { body: input.body } : {}),
        status: "none",
      };
      put(optimistic);
      setError(null);
      try {
        const r = await apiFetch(`/api/comments/${encodeURIComponent(slug)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            blockId: input.blockId,
            quote: input.quote,
            start: input.start,
            ...(input.body ? { body: input.body } : {}),
          }),
        });
        if (!r.ok) throw await failure(r);
        const { comment } = await readJson<{ comment: Comment }>(r);
        /* The server may have minted a different id. Drop the row we invented
           before putting the real one, or `put` appends it and the reader has
           two marks over one passage. */
        if (comment.id !== id) setComments((prev) => prev.filter((c) => c.id !== id));
        put(comment);
        return comment;
      } catch (e) {
        setComments((prev) => prev.filter((c) => c.id !== id));
        setError(describeFetchFailure(e as Error));
        return null;
      }
    },
    [slug, put],
  );

  /**
   * Change the reader's words on a comment they already made.
   *
   * **The response is merged over the stored row, never substituted for it.**
   * The server answers with the whole comment, so substituting would be
   * harmless today — but the shape this must never take is "build an optimistic
   * comment out of the body alone", which blanks the answer, the citations and
   * the linked conversation in memory until the next reload. GPT Sol's review
   * named this as the client half of the field-mutability rules.
   */
  const edit = useCallback(
    async (id: string, body: string | null): Promise<void> => {
      setError(null);
      try {
        const r = await apiFetch(
          `/api/comments/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
          },
        );
        if (!r.ok) throw await failure(r);
        const { comment } = await readJson<{ comment: Comment }>(r);
        setComments((prev) => prev.map((c) => (c.id === id ? { ...c, ...comment } : c)));
      } catch (e) {
        setError(describeFetchFailure(e as Error));
      }
    },
    [slug],
  );

  /**
   * Record that this comment started that conversation.
   *
   * Called with the id the **server** confirmed, not the one the chat client
   * guessed — `useChat.send` mints an optimistic id and may be handed a
   * different one back, and linking the guess is a link to nothing.
   *
   * A failure here is deliberately quiet in the UI: the comment is stored and
   * the conversation is stored, and all that is missing is the arrow between
   * them. Shouting about it would tell the reader something has gone wrong with
   * work that plainly succeeded.
   */
  const link = useCallback(
    async (id: string, threadId: string): Promise<void> => {
      try {
        const r = await apiFetch(
          `/api/comments/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/thread`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId }),
          },
        );
        if (!r.ok) return;
        const { comment } = await readJson<{ comment: Comment }>(r);
        setComments((prev) => prev.map((c) => (c.id === id ? { ...c, ...comment } : c)));
      } catch {
        /* Ignored on purpose — see the note above. */
      }
    },
    [slug],
  );

  /**
   * Re-ask a question whose model call failed.
   *
   * Reads `comments` from the closure rather than from a `setComments` updater.
   * An updater must be pure — React StrictMode invokes it twice — and the first
   * version of this fired the POST from inside one, which sent two requests,
   * spent two model calls, and left the dialog watching an id neither of them
   * came back with. The server is idempotent on the id as well (src/comments.ts),
   * so a duplicate would now be harmless; this is the belt.
   */
  const retry = useCallback(
```

### `src/web/TableView.tsx` lines 526-553

```ts
          /* **One `<mark>` can carry both classes, and which one wins a click
             changed on 2026-08-28.**

             The old rule was chat first, and it was right for the reason it
             gave: comments had been closed to new arrivals since 2026-08-26, so
             an overlap was always an older explanation sitting under a living
             conversation. Both halves of that stopped being true when a comment
             became the reader's own free mark — and worse, **every "Save & ask"
             now creates this overlap deliberately**, so the old rule would hide
             the reader's own note behind the chat it started, every time. GPT
             Sol's review of docs/plans/260828a-comments-and-bookmarks.md, finding 7.

             So the comment wins when it is *this* conversation's comment — the
             two are linked, the reader made them in one gesture, and the note
             is the thing they wrote. The chat is one button away inside the
             dialog. An overlap with an *unrelated* chat keeps the old
             preference, because there the conversation really is the more
             recent thing and the note has its own mark elsewhere.
             See annotate.ts § MarkKind. */
          const chatMark = (e.target as Element).closest?.("mark.chat");
          const chatId = chatMark?.getAttribute("data-chat")?.split(" ")[0];
          const mark = (e.target as Element).closest?.("mark.cmt");
          const first = mark?.getAttribute("data-comment")?.split(" ")[0];
          if (chatId) {
            const own = first ? comments.find((c) => c.id === first) : undefined;
            if (!own || own.threadId !== chatId) return onOpenChat(chatId);
          }
          if (first) onOpenComment(first);
```

### `drizzle/0020_comment_body.sql` (whole file)

```sql
ALTER TABLE "spideryarn"."comments" DROP CONSTRAINT "comments_status";--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_body_nonempty" CHECK ("spideryarn"."comments"."body" is null or length(btrim("spideryarn"."comments"."body")) > 0);--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_status" CHECK ("spideryarn"."comments"."status" in ('none','pending','done','error'));
```

### `src/store/import.ts` identity minting, lines 634-656

```ts
    /* **Every block either kind of mark names, minted in one statement.**
       A comment and an anchored conversation both point at the block IDENTITY,
       and both foreign keys are just as unforgiving: import an archive whose
       marked paragraph is no longer in this revision and the insert takes the
       whole transaction down with it. That is the design — the paragraph can
       go, the mark stays — so the identity has to exist first, whether or not
       this revision still contains the block.

       One statement over the union of the two, rather than two lists
       maintained in parallel: the comments used to mint theirs separately a few
       lines earlier, which is the shape that lets one of them fall behind. */
    const anchoredBlocks = [
      ...new Set([
        ...storedComments.map((c) => c.blockId),
        ...chat.flatMap((t) => (t.anchor ? [t.anchor.blockId] : [])),
      ]),
    ];
    if (anchoredBlocks.length) {
      await tx
        .insert(blockIdentities)
        .values(anchoredBlocks.map((blockId) => ({ articleId, blockId })))
        .onConflictDoNothing();
    }
```

### `src/store/import.ts` the comment insert, lines 715-751

```ts
    /* **Comments last, and that is a rule rather than a tidy-up.**
       `Comment.threadId` names a conversation, so an archive's comments can
       only be read against threads that are already in. There is deliberately
       no foreign key on that column (docs/plans/260828a-comments-and-bookmarks.md § no
       foreign key), so nothing *fails* if this runs first — which is exactly
       why the order is written down here rather than left to a constraint to
       enforce. GPT Sol found this block sitting before the chat inserts,
       2026-08-28.

       The identities these anchor to were minted with the chat anchors' above,
       in one statement over the union: the paragraph can go, the mark stays. */
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
          /* The reader's own three. `?? null` on each, because absent in the
             archive and null in the column are the same fact, and leaving
             `undefined` would let the column default decide instead. */
          body: comment.body ?? null,
          updatedAt: comment.updatedAt === undefined ? null : new Date(comment.updatedAt),
          threadId: comment.threadId ?? null,
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

### `src/store/export.ts` lines 367-394

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
        /* The reader's own three. `compact` drops the nulls, so a bookmark
           exports without a `body` key rather than with a null one — which is
           what the filesystem store writes and what the round-trip compares. */
        body: row.body,
        updatedAt: row.updatedAt?.toISOString() ?? null,
        threadId: row.threadId,
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

### `src/routes.ts` the server-side link, lines 1316-1340

```ts
    /* **The link is written here, with the id the server settled on.**
       This is the first moment a real thread id exists, and it is the only
       place that has one — which is the whole reason this is not done from the
       browser. A failure is logged and swallowed: the comment is stored and the
       conversation is stored, and all that is missing is the arrow between
       them, so failing the request would throw away work that plainly
       succeeded. `linkThread` is compare-and-set from absent, so a repeat of
       the same link is a no-op and a *different* one is refused. */
    if (typeof sourceCommentId === "string") {
      try {
        await commentStore.linkThread(slug, sourceCommentId, thread.id);
      } catch (err) {
        log("store").warn(
          { slug, id: sourceCommentId, threadId: thread.id, ...errorFields(err) },
          "could not link the comment to its conversation",
        );
      }
    }

    /* The ids first, before a single word of the answer. The client minted the
       thread id optimistically and beginTurn may have overruled it (a collision,
       or an id that was not one of ours), so this frame is what the client
       believes rather than its own guess. It also gives the panel the message id
       to render the incoming text into. */
    frame("begin", {
```
