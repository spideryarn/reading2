# Comments and bookmarks — marking a passage without spending a model call

Status: **written 2026-08-27**, not built. Successor to
[chat-as-gateway.md](chat-as-gateway.md), which closed the explanation panel to new arrivals
yesterday and made every selection a door into chat. This one adds the door that leads nowhere:
a mark you make for yourself.

See [comments.md](../project/comments.md) for what the explanation panel was,
[chat-mode.md](chat-mode.md) for how chat was built, and
[block-ids.md](../project/block-ids.md) for the anchoring contract everything here obeys.

## Intent

Greg, 2026-08-27:

> I'm thinking that someone might want to simply add bookmarks or comments to the text, without
> wanting an AI response. Perhaps the easiest way to do this would be to rename Questions →
> Comments, i.e. you can select some text, and that bookmarks it. You can optionally add a comment.
> And you can request (when you do so) whether you want an AI response (in which case it kicks off
> a Chat).

This sits squarely inside the vision — *"we help the user get what they need from it, help them
read efficiently, but deeply, help them internalize and interrogate"*. Underlining a sentence and
writing "this is the bit that's wrong" beside it is internalising. It is also the one reading
gesture this app currently cannot do at all.

## The problem, stated exactly

Right now there are two things a stretch of prose can carry, and **both of them cost a model call**:

```
   TODAY
   ─────
   select text ──▶ ask box ──▶ [Ask in chat] ──▶ chat thread, anchored     ($, and a mark)
                       └────▶ [Cancel]      ──▶ nothing at all             (no $, no mark)

   legacy: a `Comment` — one question, one streamed answer. Closed to new
           arrivals 2026-08-26. Still openable, still retryable. A museum.
```

There is no way to leave a mark on the page. Cancel is the only free action and it leaves nothing
behind. So the reader's choices are *spend money* or *forget where you were*.

## What is proposed

**A comment is the reader's mark on a passage. The AI half is optional and separate.**

```
   PROPOSED
   ────────
   select text ──▶ ┌────────────────────────────────────┐
                   │ "…the qualia realism debate…"  [✕] │
                   │ ┌────────────────────────────────┐ │
                   │ │ Add a comment (optional)       │ │
                   │ └────────────────────────────────┘ │
                   │  [Save]  [Save & ask]     [Cancel] │
                   └────────────────────────────────────┘
                        │           │
                        │           └─▶ comment saved AND a chat thread opened
                        │               on the same anchor, first message = the
                        │               comment's text (or "Explain this passage.")
                        │
                        └─▶ comment saved. Nothing spent. A mark in the prose.
                            Empty box = a bare bookmark; typed text = a comment.
```

Everything else the reader can already do to a comment — click the mark, step between them with
the drawer, delete it, follow it to a chat — keeps working, because it is the same artefact.

## Which artefact should carry it — four options, and why the answer is the boring one

This is the decision worth arguing about. There are already **two** anchored things (`comments`,
`chat_threads.anchor`) and the cost of getting this wrong is a third.

### A. A new `notes` table beside the other two

Clean in isolation: `notes(article_id, id, owner_id, block_id, quote, start, body, …)`, a new
`note` mark kind, a new dialog, a new hook, a new store contract, a new pair of adapters, a new
pair of export/import seams.

**Rejected.** Three anchored artefacts and three mark kinds, where a reader sees one idea. The
schema even predicts this mistake — `blockIdentities`'s doc comment says *"Everything the reader
creates — comments, and later highlights and notes — points here"* — but "points at the same
spine" is not an argument for "is a different table". And it forces a fourth concept immediately:
what is the relationship between a note and the comment sitting on the same words?

### B. The `comments` table becomes the reader's mark, and the answer becomes optional ✅

The user-facing rename Greg asks for costs **nothing in the code**, because the code's word is
already `comments`; only labels say "Questions". And every mechanism this feature needs already
exists and is already tested:

| what this feature needs | what already does it |
|---|---|
| an anchor that survives re-extraction | `comments_identity_fk` onto `block_identities` |
| a mark in the prose, overlap-safe | `MarkKind = "cmt"`, `resolveMark`, `annotateHtml` |
| a dialog with prev/next over the article | `CommentDialog` + `comment-nav.ts` |
| a drawer listing them | `Dock`'s "Questions" drawer |
| a deep link to one | `?note=<id>` + `arrivalTarget` |
| counts on the card, the metadata page, admin | `LibraryEntry.comments`, `AdminUser.questions` |
| "ask the model about this one" | already there — the follow-up box opens a chat carrying the comment's anchor (`App.tsx` ~1320) |
| both stores, export, import, parity tests | `CommentStore`, `pg-comments.ts`, fs adapter |

What changes is **one field and one meaning**: comments gain `body` (the reader's own words), and
the `status` column stops implying that a model call was made.

The legacy explanations are not a museum any more — they become the special case they always
were: *a comment that happens to carry an answer from before 2026-08-26*.

**The honest cost.** The `comments` table carries a one-model-call state machine — `status`,
`attemptId`, `leaseExpiresAt`, `citations`, `searches`, `model`, `error`. On every comment made
from now on, all seven are null forever. That is dead weight in a table, which is cheap; the
alternative (option A) is dead weight in the reader's head, which is not.

### C. Put the note on the chat thread — a bookmark is a conversation nobody has started

Tempting, and it is the option that most literally matches "the mark is the thing and the AI is
optional": one artefact, one mark, and "ask" is just sending the first message.

**Rejected**, because a thread with no messages is a lie everywhere else it appears: the chat
list, the `chats` count on the metadata page and the admin table, the auto-start effect in
`ChatBand` that opens an empty conversation when there are none, title generation (which reads the
first message). Every one of those would need "…except the empty ones", and the first one anybody
forgets is a silent bug.

### D. Move the anchor out of `chat_threads` into a new `annotations` layer that both hang off

The conceptually cleanest: one anchored thing, which may carry a note and may carry N
conversations. **Rejected on timing, not on merit** — `chat_threads.anchor` was designed,
reviewed and built yesterday ([chat-as-gateway.md § anchor](chat-as-gateway.md#anchor)), and
unpicking it costs a migration, both adapters, both seams and the summaries endpoint to buy
tidiness no reader can see. Worth revisiting if a third kind of anchored thing ever appears; it
should not, if B holds.

**Chosen: B.**

## What the review changed

GPT-5.6 Sol reviewed this plan on 2026-08-28 and its verdict was **"build B, but not as
written"** — three blocking problems, kept beside this file in
[comments-and-bookmarks-review-sol.md](comments-and-bookmarks-review-sol.md). Where the two
disagree, this file is what gets built.

1. **Creation and answering cannot share `CommentStore.create`.** Not merely because the upsert
   would blank the new fields — I had that — but because *reopening POST makes an id collision
   destructive*: a new bookmark carrying an id that already exists is indistinguishable from
   retrying an explanation, so the upsert overwrites somebody's anchor and answer. The two
   meanings get two routes and two store operations.
2. **`Save & ask` cannot populate `threadId` the way the plan said.** Insert the comment first and
   the foreign key fails, because the thread does not exist yet; insert it without one and there
   is no operation that can ever add it. And the id the client mints for a thread is a *guess* —
   the server may return a different one.
3. **The archive import inserts comments before chat threads**, so the foreign key would fail the
   whole transaction on any archive with a linked comment.

And one thing I had simply got wrong: the plan claimed a "the sweep does not touch a bookmark"
test would go red first. **It would not.** `sweepOrphaned` already filters on exactly
`status === "pending"`, so `'none'` is excluded the day it is introduced — the check could never
fail, which is the thing [silent-success.md](../reusable/silent-success.md) is about. It is
replaced below with one that can.

## The data model

### `Comment` gains three fields

```ts
export interface Comment {
  id: string;
  blockId: BlockId;
  quote: string;
  start: number;
  createdAt: string;

  /**
   * The reader's own words about this passage. Absent on a bare bookmark, and
   * absent on every explanation made before 2026-08-28.
   *
   * Reader prose. Never logged, never put in a URL, rendered as text.
   */
  body?: string;
  /** ISO. Set only when the body has been edited since it was made. */
  updatedAt?: string;
  /** The conversation this comment started, if the reader asked for one. */
  threadId?: string;

  /* ---- the answer half: `none` on everything made from 2026-08-28 ---- */
  status: "none" | "pending" | "done" | "error";
  answer?: string;
  citations?: Citation[];
  searches?: number;
  model?: string;
  error?: string;
}
```

**`status: "none"` stays**, and Sol agreed with the reasoning while correcting the claim made for
it: `none → pending → done/error` is a coherent answer-state machine, a separate "kind" would be
worse because a body, a legacy answer and a linked chat are *independent* properties rather than
exclusive kinds, and a nullable status makes "no attempt" indistinguishable from "the field was
omitted". What it does **not** need is any change to `sweepOrphaned`.

**Empty body vs absent body.** A bare bookmark writes **no** `body` key — not `""`, not `null`.
`exactOptionalPropertyTypes` is on and `tests/store-roundtrip.test.ts` compares the two stores
structurally, so `""` on one side and absent on the other is a real failure. The route trims once
and drops an empty string, in one place.

### Who may write what

Sol's fourth finding: *"insert-only" is too blunt*. Three of these fields have three different
lifetimes, and the contract has to say so rather than leaving each adapter to guess.

| field | may be written by |
|---|---|
| `blockId`, `quote`, `start`, `createdAt` | creation only |
| `body` | creation, and the body PATCH |
| `updatedAt` | the server, when the body changes |
| `threadId` | one successful link, from absent. Never overwritten |
| `answer`, `citations`, `searches`, `model`, `error`, `status` | the legacy answer path only |

Every operation writes a **named allowlist**, never a spread of whatever it was handed. That
applies to the client too: the PATCH response is *merged over* the optimistic comment, because
replacing it with a body-only object would blank `threadId` and the answer in memory.

### The store contract, split by meaning

`CommentStore.create` is doing two jobs today and one of them is now dangerous. It becomes four:

```ts
/** A free comment. `status: "none"`, no model call, ever. */
create(slug, input: NewComment): Promise<Comment>;
/** The legacy answer path. Refuses `status: "none"` — a bookmark is not a question. */
beginAnswer(slug, id: string): Promise<Comment>;
/** The reader edited their words. Sets `body` and `updatedAt` and nothing else. */
patchBody(slug, id: string, body: string | null): Promise<Comment>;
/** Compare-and-set from absent. Returns the comment; a second call is a no-op. */
linkThread(slug, id: string, threadId: string): Promise<Comment>;
```

`create` is still idempotent on the client-minted id, but idempotent now means **"return the row
you already have, if it is the same one"**: same anchor, same body ⇒ return it, which makes a
double-clicked Save harmless. Anything else ⇒ **409**, because the alternative is silently
overwriting a comment the reader made earlier from another tab.

`beginAnswer` takes an id and *nothing else*. It reads the stored anchor rather than accepting one,
which closes the hole where a retry could quietly move a comment to a different passage.

### Migration `drizzle/0020_comment_body.sql`

**0019 is `chat_messages.stance` + `chat_threads.kind`** (review mode), which was untracked in the
working tree when this plan was written and is exactly the check the anchor plan's author forgot to
make. Look at `drizzle/meta/_journal.json` again before generating, not at the last commit.

```sql
alter table spideryarn.comments
  add column body       text,
  add column updated_at timestamptz,
  add column thread_id  text;

-- A bookmark is a comment with nothing written on it, so `body` is nullable —
-- but an *empty* body is a different value to no body, and the client cannot be
-- trusted to keep that straight. One rule, in the database, forever.
alter table spideryarn.comments
  add constraint comments_body_nonempty
  check (body is null or length(btrim(body)) > 0);

-- `none` is the state of every comment made from 2026-08-28: no model call was
-- ever attempted for it. The three older values keep their meaning exactly.
alter table spideryarn.comments
  drop constraint comments_status;
alter table spideryarn.comments
  add constraint comments_status
  check (status in ('none','pending','done','error'));
```

#### There is deliberately no foreign key on `thread_id`

This reverses what the first draft said, and the reasoning is worth keeping because "add the FK"
is the reflex this schema has earned everywhere else.

A foreign key onto `chat_threads` would buy referential integrity for a link whose absence is
**benign** — a comment whose conversation has been deleted is still the reader's mark on the
passage, and the button that opens the chat simply is not offered. And it would cost three things
that are not benign:

- **Import ordering**, which is Sol's third blocking finding: comments are inserted before threads
  today, so the constraint would fail the whole transaction on any archive with a linked comment.
- **A dangling id becoming a crash.** `on delete set null` handles the delete that goes through
  Postgres; an archive written by the filesystem store can contain a link to a thread that
  `chat.json` no longer has, and that arrives as a raw FK violation with no useful message.
- **The two stores behaving differently**, which is the one thing `tests/store-parity.test.ts`
  exists to prevent. The filesystem adapter has no constraints and cannot cascade. Give Postgres a
  rule the filesystem cannot keep and the archive round-trip is where you find out.

So `thread_id` is a plain column, and **the link is advisory**: whoever offers "Open the chat"
checks the thread is in the summary list first, exactly as it already has to for a `?thread=`
naming a deleted conversation. The import still needs its order fixed — identities, then threads,
then comments — because that is the right order regardless, but nothing now fails if it is not.

### The `Save & ask` choreography

Sol's second blocking finding, written out as the sequence it has to be. **The free thing is
stored before the paid thing starts**, which is the whole ordering principle.

```
   1. POST /api/comments/:slug          the comment, status "none".  FREE, and it
      ──────────────────────────▶       lands first, so a chat that fails leaves
                                        the reader's words on disk.

   2. the chat draft opens, prefilled with the body (or "Explain this passage.")
      and carrying the same anchor. The reader is now in the existing flow.

   3. the server confirms a thread id — the `begin` frame, NOT the id the client
      guessed. `useChat.send` already reports it back through its callback.
                                        │
   4. POST /api/comments/:slug/:id/thread ◀┘   compare-and-set from absent.
      A second call with the same id is a no-op; a different id is refused.
```

Step 4 uses the **server's** id and not the guess, which is the trap in this sequence: the client
mints an id for the optimistic row and `commentStore` may hand back a different one.

## What the reader sees

### The selection box

`ChatDialog`'s `draft` branch is today an ask box with one action. It becomes a comment box with
a checkbox — **Sol's eighth finding, and it overrode my two-button proposal**:

```
   BEFORE (chat-as-gateway)              AFTER
   ┌──────────────────────────┐          ┌────────────────────────────────┐
   │ "…qualia realism…"   [✕] │          │ "…qualia realism…"         [✕] │
   │ ┌──────────────────────┐ │          │ ┌────────────────────────────┐ │
   │ │ Ask something about… │ │          │ │ Add a comment…             │ │
   │ └──────────────────────┘ │          │ │                            │ │
   │  [Ask in chat] [Cancel]  │          │ └────────────────────────────┘ │
   └──────────────────────────┘          │ ☐ Also ask the AI about it     │
                                         │        [Save comment] [Cancel] │
   Enter = ask (a model call)            └────────────────────────────────┘
                                          Enter = a newline. ⌘/Ctrl+Enter = Save.
```

Three calls, and the reasoning for each is Sol's:

- **A checkbox, not a second button.** It is what Greg described — *"you can request (when you do
  so) whether you want an AI response"* — and it makes the paid outcome something the reader
  *opted into* rather than something they picked out of two similar-looking buttons. Ticking it
  changes the primary button to **Save & ask AI**, so the button always says what pressing it
  costs.
- **Enter inserts a newline.** Rebinding Enter from "spend a model call" to "save for free" is
  financially safe and still a trap: it silently changes what a box the reader has used before
  does. A comment is also the first text in this app somebody might want two paragraphs of. So the
  box becomes a `textarea`, Enter is a newline, and ⌘/Ctrl+Enter presses the visible primary
  button.
- **An empty body with the box ticked** sends *"Explain this passage."*, which is what the ask box
  already does with an empty composer.

The paragraph 💬 button is untouched: it goes straight to chat, it says so, and nobody presses it
to bookmark a paragraph.

### The dialog

`CommentDialog` grows an editable body at the top, above the answer if there is one. Legacy
explanations look exactly as they do now, with an empty body box added. New comments show the
reader's words, prev/next, delete, and **Ask about this** — the button that already exists.

### The labels

Every user-facing "Questions" becomes "Comments". **Ids and URL parameters do not change** —
`?note=`, the library column id `questions`, the admin column id `questions` — because those are
in shared links and saved sort state, and renaming them buys a reader nothing.

| file | today | becomes |
|---|---|---|
| `src/web/Dock.tsx` | `label="Questions"`, `function Questions` | `label="Comments"` |
| `src/web/library-columns.tsx` | `header: "Questions"`, hint | `"Comments"`, "How many you have made on it" |
| `src/web/admin-columns.tsx` | `"Questions"` ×3 | `"Comments"`, "Comments made on a passage" |
| `src/web/Metadata.tsx` | `"Questions asked"` | `"Comments"` |
| `src/web/Tweets.tsx` | comment only | comment only |

## The seams, named

Every one of these is a place a field gets silently dropped. Sol confirmed both of the ones I
found and added the rest.

1. **`src/store/pg-comments.ts` — `toComment`** builds the client shape from named columns and
   would simply not return `body`, `updatedAt` or `threadId`. `null` → absent, not `null`.
2. **`src/store/pg-comments.ts` — `create`'s `onConflictDoUpdate`.** The `set` rebuilds from
   `fields`, so the *old* create would blank a body on every retry. Fixed by construction, because
   retry no longer goes through `create` at all — it goes through `beginAnswer`, whose allowlist
   is the answer fields and nothing else.
3. **`src/comments.ts` — `createComment`'s reset branch** has the identical bug for the identical
   reason, and the same fix.
4. **`src/store/export.ts`** — `compact({...})`, named fields, three of them missing.
5. **`src/store/import.ts`** — `.values({...})`, named fields, three of them missing. And the
   **insert order**: identities (the union of comment anchors *and* chat anchors), then threads,
   then comments. Right regardless of whether there is a foreign key.
6. **`src/routes.ts`** — one route becomes three (create / answer / patch) plus the link. The
   route validation is the subject of its own section below.
7. **`src/web/useComments.ts`** — `create`, `edit` and `link`, all optimistic. **The PATCH
   response is merged over the stored comment**, never substituted for it, or an edit blanks the
   answer and the thread id in memory.
8. **Counts** — `LibraryEntry.comments` and `AdminUser.questions` now count bookmarks too. That is
   correct, and it changes what the number means, so the hint text changes with it.

### Validating a free comment

Sol's sixth finding, and it starts by correcting me: **`checkAnchor` is weaker than I said.** It
verifies the quote is *somewhere* in the block, not that it is at the offset given — and on its
own it would accept an empty quote, because every string contains `""`. (`parseAnchor` is what
actually refuses an empty quote today, upstream of it.) So the comment route validates for itself,
before it writes anything:

- the client id is a well-formed spideryarn id;
- the block belongs to *this* article;
- the quote is non-empty and within a size limit;
- `start` is an integer, non-negative, and not past the end of the block;
- the quote occurs in the block, whitespace-folded;
- the body is a string, trimmed once, dropped when empty, size-limited.

**No error message and no log line may contain the body or the quote.** `httpError` messages are
logged as `reason` and redaction is path-based, so it cannot reach a string built from a body —
the rule `src/comments.ts` already states at the top of the file, applied to a second kind of
reader prose.

## Tests, written before the code

Per [silent-success.md](../reusable/silent-success.md) — each has to be seen red first, and the
first draft of this list contained one that could not be.

- **The value that crosses the seam**: create a comment with a body through the route, read it
  back through both stores, assert the body survives. One minting helper used by the route test
  and by the store test, so the two cannot agree with each other while both are wrong.
- **`""` is not a body**: post `{ body: "   " }`, assert the stored comment has **no** `body` key.
- **An id collision cannot mutate an existing comment** — same id, different anchor ⇒ 409, and the
  stored row is untouched.
- **`beginAnswer` preserves the annotation**: retry a legacy comment that has a body and a linked
  thread, assert both survive the answer being rewritten. *(This is the one Sol's finding 1 is
  about, and it fails today.)*
- **A bookmark cannot be answered**: `POST …/:id/answer` on a `none` comment is refused.
- **The link is compare-and-set**: link twice with different ids; the second is refused and the
  first stands.
- **A failed chat leaves the comment**: Save & ask where the chat call throws still leaves a
  readable comment on disk.
- **Store parity and round-trip** carry `body`, `updatedAt` and `threadId`, with absent ≠ `null`.
- **Export/import round-trip** keeps all three, and import inserts threads before comments.
- **The dialog renders a comment with no answer** — no empty answer region, no spinner.

**Struck out**: *"the sweep does not touch a bookmark"*. `sweepOrphaned` filters on exactly
`status === "pending"`, so this passes the moment `'none'` exists and would have passed against a
completely unbuilt feature. Its replacement is the route test above — that a free create produces
`status: "none"` and never enters the answer path — which fails today, because today the only way
to create a comment is to buy an answer for it.

## What the code review found

The built code went back to GPT-5.6 Sol on 2026-08-28
([comments-and-bookmarks-code-review-sol.md](comments-and-bookmarks-code-review-sol.md)). Verdict:
**"do not ship this build"** — thirteen findings. This is the review the working agreement weights
higher than the plan review, and it earned that: a plan-stage review could not have found any of
the four real blockers, because they are all in code the plan described correctly.

**Fixed:**

1. **`beginAnswer` was not a claim.** `status <> 'none'` excludes bookmarks and nothing else, so a
   row already `pending` passed it — two presses of *Try again* would both succeed, buy two model
   calls, and race each other's terminal writes. The comment in the code asserting that two
   requests could not both pass was simply false. Now `in ('done','error')`: only a *terminal* row
   is answerable, and an abandoned `pending` becomes `error` through the sweep first.
2. **`patchComment` still took `Partial<Comment>`** and put back only the id, so the one generic
   patch left could rewrite the anchor, `createdAt`, the reader's body and the linked conversation
   — the exact shape the named allowlists were introduced to remove. Now `AnswerPatch`, six fields,
   enforced at the type *and* at the write.
3. **`sourceCommentId` could name any of the reader's own comments on the article.** Neither
   `status` nor the anchor was checked, so a stale id from another tab would attach the
   conversation to an unrelated mark. `linkThread` now takes the passage and does the whole thing
   as one compare-and-set.
4. **The idempotent create would adopt a legacy explanation.** Anchor-and-body is not enough — an
   old explanation usually *has* no body — so a reused id handed an answered row back as a freshly
   made bookmark. It now also requires `status === "none"`.
5. **The client minted a new id on every Save**, so a reader whose response was lost would store a
   *second* comment on the same words. The id is now minted once per passage in `AnnotateDialog`,
   with a synchronous latch against a double click (`disabled` only takes effect next render).
6. **An edit could not clear a body.** `{ ...c, ...comment }` cannot express a removal, so emptying
   the box put the old words straight back. The server returns the whole row, so it replaces.
7. **The optimistic rollback deleted by id**, which in the one case that matters — a collision —
   removed the *legitimate* comment. It now restores whatever it displaced.
8. **The click rule read only the first id** of each space-separated list, so a linked pair further
   along either list was invisible.
9. **`tidyBody` coerced a non-string to `null`**, so `{ body: {…} }` silently meant "bookmark this".
   Now a 400.
10. **The dead `useComments.link`** — left behind when linking moved to the server, calling a route
    that no longer exists — is gone.

**Two findings I did not accept, and why.**

- **"`sourceCommentId` can put reader prose into logs" (blocking).** Already guarded:
  `isSpideryarnId` runs before any write and the 400 carries no value. Sol could not see it because
  the excerpt I sent started below the check. My fault in preparing the review, not a defect.
- **"The anchor offset is still not validated" (blocking).** Real in general, and **not fixable on
  the server here.** `start` is measured in the concatenated *text nodes of `block.html`* — not in
  `block.text`, which collapses whitespace and inserts a space at every nested block boundary
  ([§ the offset space](../project/comments.md#offset-space)). The server has no DOM, and the
  hand-rolled tokenizer this would need is precisely the drift that section warns about. What makes
  it safe instead is that **`start` is a hint, not the anchor**: the client re-finds the quote and
  uses the offset only to choose between repeats, so a wrong one draws the mark on another
  occurrence of the same words rather than corrupting anything. The bound stays as a sanity check.

**Left undone, and named rather than quietly dropped**: the diagnostic race in `beginAnswer`'s
second read (it can report 409 where 404 is truer, and cannot cause a wrong write), and Sol's list
of further tests — a real-Postgres concurrent-create matrix over separate connections, and a
stale-attempt fence. Both are worth doing and neither blocks this.

## What the browser pass found

Run in a Sonnet subagent against `localhost:5273`, 2026-08-28, on the real reading view. Seven
checks: the panel's appearance, Enter inserting a newline, the checkbox renaming the button, a free
save, the mark, the drawer's label, and the console. **All seven passed** — the console was clean,
the dark-theme colours were readable, and saving with the box unticked spent nothing.

It found one thing no unit test would have: **the drawer listed a comment's quoted sentence and not
the words the reader wrote.** The state line fell through to `firstLine(c.answer)`, which is empty
on a comment with no answer — so a row you had written a note on showed only the sentence it was
about, sitting next to AI-answered rows that did preview their content. It told you where you had
stopped and not what you had thought.

Fixed with the ordering principle this whole feature has: **the reader's own words beat the
model's.** `previewOf` returns the body, then the pending/failed state, then the answer — and for a
bare bookmark it returns nothing at all, so the row is the quote alone rather than an empty line
that reads as a preview which failed to load.

## Open questions for Greg

1. **Does a bare selection auto-save?** This plan says no — the box opens, and Save stores it.
   Auto-saving every selection turns "I dragged across a line while reading" into permanent
   furniture with no undo. It does mean a bookmark costs one click.
2. **Should the mark look different when there is no body?** A bookmark and a comment are drawn
   identically here. A lighter wash for a bare bookmark is easy to add later and easy to get wrong
   now, on top of the existing four-kind overlap matrix.
3. **`?note=` stays as the parameter name** for the open comment, and the library and admin column
   ids stay `questions`. They are in shared links and saved sort state, and renaming them buys a
   reader nothing.

## The double mark, and why the click rule flips

A comment made with **Save & ask** has a `cmt` mark and a `chat` mark over identical words.
`annotateHtml` already merges them into one `<mark class="cmt chat">`; what changes is which one a
click opens.

Today chat wins, and `MarkKind`'s doc comment justifies it: chat *"is the living artefact, and
comments can no longer be created"*. **Both halves of that stop being true here.** Sol's seventh
finding: the overlap was a rare legacy accident and becomes something every Save & ask creates on
purpose, so the standing rule would hide the reader's own note behind the conversation, every
time.

So: **a click opens the comment when the comment's `threadId` names the overlapping chat**, and
the comment dialog carries an "Open chat" button — the link is what makes that unambiguous rather
than a guess from matching anchors. An overlap between a comment and an *unrelated* chat keeps the
old preference, because there the chat really is the more recent thing and the note has its own
mark elsewhere.
