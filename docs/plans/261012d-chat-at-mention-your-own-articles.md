# Chat: @-mention one of your own articles to bring it into the conversation

**Status:** planned and reviewed, 2026-10-12; building.
**Why:** two admin inputs, one piece of work (queue item `qi-c8vnqatv`):

> I'd like to be able to @-mention another article in my shelf (including archived and public etc)
> from within a Chat. Look for whether a 3rd-party library (see third-party-library-selection.md)
> would make this easier/better. Then I guess it would have to include that article into the Chat
> context.
>
> — Greg, via Feedback, report `spya-a63vmt` (#578, `SPIDERYARN-READING2-HX`), 2026-10-12 10:06 UTC

> I was thinking it would be a way to upload my scribbles or similar or some other addendum to the
> current article. Let's keep things simple. Maybe it's local to that chat for now? (and indicates
> that) / Or better still, maybe there's a way to add attachments to an article, and this uploading
> them to a Chat would be one way. I don't have a clear sense of what we'd use this for yet, so if
> it's really complicated we should discuss. But it feels like it should be straightforward enough.
> / And ideally then I could @-mention any attachment to the current article in a chat.
>
> — Greg, reply `spya-zake3w` to [q-jzx20h](../user-feedback/questions/q-jzx20h.md), 2026-10-12 10:05 UTC

Prior work: [261011v-chat-attachments.md](261011v-chat-attachments.md) (shape A′, "attach one of
your articles as a source") and its [Sol review](261011v-chat-attachments-plan-review-sol.md). This
plan is A′ with an @-mention as the way in, and it keeps every fix that review asked for.

## What the reader gets

```
 ┌ Chat ──────────────────────────────────────────────────┐
 │ Also reading: [Smith 2024, Replication ↗]               │  ← the "indicates that" line
 │ ...                                                     │
 │ You: how does @Smith 2024, Replication treat the effect │
 │      size?                                              │
 │ AI:  It reports d = 0.21 [Smith 2024 ↗], against this   │  ← chip opens the other
 │      article's 0.45 [spya-k3m9qt].                      │    article at that passage
 │ Bringing in: [Reply to Jones ×]                         │  ← pending, before sending
 │ ┌───────────────────────────────────────────┐           │
 │ │ compare with @rep|                        │           │
 │ │ ┌──────────────────────────────────────┐  │           │
 │ │ │ Smith 2024, Replication · nature.com │  │ ← picker  │
 │ │ │ Reply to Jones · archived            │  │           │
 │ │ └──────────────────────────────────────┘  │           │
 └─────────────────────────────────────────────────────────┘
```

- Typing `@` in typed Chat's composer opens a list of **the reader's own articles**: on the shelf,
  archived, and the ones they have made public, most recently opened first, each with its site.
  Typing narrows it by title. Enter or a tap picks one. `@Title` goes into the text, and the
  article joins a **"Bringing in"** row of chips above the box. That row, not the text, is what is
  sent, and a chip's × removes it. Opus and Sol both objected to deciding by whether `@Title` is
  still in the text: editing one letter of a title would drop the mention silently.
- Sending brings those articles into **this conversation** (Greg: *"local to that chat for now?
  (and indicates that)"*). They stay in for the rest of the conversation. A line at the top of the
  thread names every article brought in, each a link, with *No longer available* where that is
  true.
- The model gets each mentioned article **whole**, with its block ids, and may cite it. A citation
  of a mentioned article's passage is a chip that opens that article at that passage.

What it does **not** do in v1, each said plainly:

- Other people's public articles. Chat reads only articles the reader owns. Widening that to
  strangers' public articles is a defence edit Greg has not said yes to; it goes in the follow-up
  question.
- Typed Chat only (`kind: "chat"`, block chats included). Not the guide, Learn, Tutorial, Explore,
  referee chats, or live conversation.
- Mentions come only with a new question. Editing or retrying a question keeps what it was sent
  with. An article cannot be taken out of a conversation once sent; start a new one.
- An article over the cap (§ 3) is refused when the question is sent, with its size and the limit,
  and the draft is kept. Measured on production 2026-10-12: of 160 articles, the median is 28k
  characters, the 95th percentile 103k, and **7 (4%) are over 120k**. Reading those in parts
  through the library tools is a follow-up.
- An article still importing, or a minimal one (not processed), is refused the same way: its
  blocks are not there yet.
- Uploading a file from the picker. Cut on review (§ Attachments).

## The library question

Greg asked whether a third-party library would make this easier or better
([third-party-library-selection.md](../reusable/third-party-library-selection.md)). Research
2026-10-12 (Sonnet, web), in short:

- **Tiptap / Lexical** give real inline chips, but only by replacing the `<textarea>` with a
  contenteditable editor. Dictation, the draft store, the Escape ladder, held-Enter and IME handling
  are all written against the textarea. Too large a migration for one feature.
- **react-mentions** is popular but forces its own markup-string value and an overlay div; its
  React 19 behaviour is unverified. **@webscopeio/react-textarea-autocomplete** is abandoned (2023).
  **cmdk** is a palette, not a textarea trigger.
- **Ariakit** is the closest fit: its official example runs a real `<textarea>` as the combobox
  with `@` triggers, React 19 peers, released 2026-10-05. Cost: a second positioning system beside
  `@floating-ui/react`, and a new dependency for one listbox.

**Decision: no library for v1.** The repo already has a hand-rolled ARIA combobox to copy
(`src/web/TagEditor.tsx`: `role="combobox"`, a `listbox`, `aria-activedescendant`) and
`@floating-ui/react` for placement. The picker is one component. **Ariakit is the named fallback**
if phones or screen readers prove flaky. Prefer boring
([vision.md § Principles](../project/vision.md#principles)).

## Design

### 1. The picker (client)

- A `MentionPicker` beside `Composer` in `src/web/ChatPanel.tsx`, copying the ARIA combobox in
  `src/web/TagEditor.tsx` and placed with `@floating-ui/react`.
  - Opens when `@` is typed at a word start.
  - Closes on Escape (the first rung of the existing ladder, and not while an IME is composing),
    on blur, or on a pick.
  - Arrow keys move, Enter or Tab picks, and while it is open Enter does **not** send.
- Its list comes from the existing owner-scoped `GET /api/library` and `GET /api/library?archived=1`,
  fetched once when the picker first opens. No new route. Filtered client-side for the reader's
  convenience (the server is the guard): not the open article, not `processing: "minimal"`.
- No size field and no greying. The size check is the server's alone (Sol F5), so it stays true
  after a re-extraction.

### 2. The send (server)

- `POST /api/chat/:slug` gains `mentions?: string[]` (slugs).
  - Refused on a retry **and on an edit**. Sol F4: copying `visible` would have allowed it on an
    edit.
  - Must be an array of `isSlug`, at most 3 per question, and on a chat-kind thread only.
- Each slug is checked, and refused if any check fails:
  - it resolves through `ownedSlug`, which is owner-scoped, so another reader's slug is "not
    found", as today;
  - it is not the open article;
  - it can be loaded, so not minimal or still importing;
  - it is under the per-article cap;
  - the thread would hold no more than 3.

  Each refusal is a 400 with words the composer shows, and the draft is kept. Nothing is silently
  dropped.
- Stored as rows of a new table, because a mention points at another row and
  [sql.md](../project/sql.md) wants that to be a foreign key (Sol agreed over jsonb):

  ```
  chat_mentions(
    article_id, thread_id, message_id   → chat_messages(article_id, thread_id, id) ON DELETE CASCADE
    position smallint                    -- order within the question
    mentioned_article_id uuid null       → articles(id) ON DELETE SET NULL
    title text not null                  -- snapshot at send, for "No longer available"
    created_at timestamptz not null default now()
    primary key (article_id, thread_id, message_id, position)
  )
  ```

  - **`mentioned_article_id`, not the slug:** slugs can be reused and articles can change owner.
  - **`SET NULL`, not `CASCADE`** (Sol F3): a deleted article leaves the mention and its title, and
    the line says *No longer available*.
  - **Written inside `chatStore.begin`'s existing transaction**, with the user message. `edit` and
    `retry` write none.
  - **Edit and delete-a-question already delete the later messages**, and those messages' mentions
    cascade with them.

### 3. What the model sees

- **One resolver, run per turn on the stored thread, never on the request.**
  - It takes the mentions on the thread's user messages up to this turn, ordered by first mention,
    without duplicates.
  - Each one is re-checked against the current owner on every turn, and re-measured against the
    cap.
  - An article that has been transferred, deleted or left unprocessed, or that is now too long, is
    left out. The model is told by title that it is no longer available, rather than left to wonder.
  - **It never runs an unscoped join.** An unavailable mention yields its stored title only: no slug
    and no block ids.
  - Send, retry, edit, the thread GET and the citation allowlist all go through this one function.
- **Where:** a second text part in the first user message, after the open article's part, with its
  own `cache_control` breakpoint. Sol confirmed this placement, and that no simpler one keeps both
  prefixes:

  ```
  system │ open article [bp1] │ mentioned articles [bp2] │ ack │ history … │ question
  ```

  - **What caching does:** adding a mention leaves bp1 alone and rewrites from bp2 once. The next
    turn reads it from cache.
  - **How it is checked:**
    - a unit test proves the bp1 part is byte-identical with and without mentions;
    - **one live two-call check through OpenRouter** reads the cache-read token counts. Sol F6: a
      unit test proves the request, not the cache.
  - **Other models:** the breakpoints are Anthropic's. For a `SPIDERYARN_CHAT_MODEL` override to
    another provider, answers are unchanged and nothing is promised about caching.
- **How:** each mentioned article is rendered with `articleWithIds` inside `untrusted()`, title
  included, since its author wrote it. A sentence outside the fence says it is another article the
  reader chose to bring in, and gives its title. A PDF the reader chose was still written by
  somebody else, and the hidden-instruction scan does not read PDFs.
- **Prompt rules** in `src/converse.ts`, worded per [prompting-guide.md](../project/prompting-guide.md):
  - the fence rule, which today says fenced text is a *tool result*, is widened to any fenced
    document or tool text (Sol F8);
  - "the article" always means the open one; a mentioned one is called by its title (Opus);
  - `CLAIM_ORIGINS` / `CITING_IDS`: a mentioned article's block ids may be cited, and the answer
    says which article a claim comes from. Ids from `search_library` / `read_library_passage` on
    any *other* article stay uncitable, as today.
- **The cap:**
  - **120,000 characters of serialized block text per article.** That is about 42,000 tokens at
    this repo's measured 0.35 tokens a character ([prompt-caching.md](../project/prompt-caching.md)).
  - **At most 3 articles per thread.**
  - It is per article rather than a thread total (Opus), so a second paper is never refused because
    of the first.
  - Each limit is one constant.
- **Cost, known and not fixed here:** a first turn with a mention costs up to about 42k more input
  tokens per article, cached after that. Typed chat still has no per-reader spend fuse (recorded in
  261011v).

### 4. Citations that open another article

- The thread's GET response and the stream's opening event carry
  `mentioned: {title, available, slug?, blockIds?}[]`, from the resolver. `slug` and `blockIds` are
  sent only when the article is available.
- **A block id identifies its article only if it is unique.** Sol F1: ids are unique within an
  article, and an import can carry an existing `spya-…` id ([block-ids.md](../project/block-ids.md)).
  - The client builds `blockId → source` over the open article and the mentioned ones.
  - An id found in exactly one becomes a chip for that one. An id found in two stays plain text.
  - The server's `unknownCitedIds` log counts mentioned ids as known, and logs collisions as
    ambiguous.
- **A cross-article chip is its own small component, not `BlockRef`.** `BlockRef` treats an id
  absent from the open article as missing, and builds a same-article address. The new chip:
  - takes an already-built `href`, `/read/<slug>?at=<id>`, from `readHref` + `addressAt`;
  - carries the article's short title;
  - never calls the open article's `onJump`.
- **The href is built from the server's slug, never from the model's text.** A model's bracket only
  ever selects among ids the server listed (security-map item 3).

### 5. Export and delete

- `chat_mentions` joins the owner-scoped snapshot and the reader ZIP (`src/store/article-rows.ts`).
  It records the reference and the title snapshot, not the mentioned article's text.
- It is **deliberately left out of the legacy rollback export**, with the reason written in
  `ARTICLE_TABLE_COVERAGE`. Sol F10: that format is byte-pinned, and a relation table cannot ride in
  `chat.json` as a field.
- Deleting the open article cascades its chats and their mentions. Deleting the mentioned article
  sets the reference to null; the title snapshot stays with the conversation it belongs to.
- [privacy.md](../project/privacy.md) gets one sentence, if the privacy page's existing words about
  chat do not already cover "chat may read another of your articles when you mention it".

### 6. Docs

- [chat-tools.md](../project/chat-tools.md): a section on mentioned articles, and its Security
  section says what changed (below).
- [security-map.md](../project/security-map.md): the `src/routes.ts` / `src/chat-tools.ts` rows
  name the mention check; the citation allowlist names the cross-article chip.

## Security: what changes, said plainly

- **No new outbound channel, and no new reader.** Chat could already read every one of the
  reader's unarchived articles through `search_library` / `read_library_passage`, owner-scoped.
  What is new:
  - an **archived** own article becomes readable when named, which is consistent with direct links,
    since those open archived articles;
  - its text arrives whole rather than by passage.
- **Defences edited**, all within what Greg asked for (his own articles, archived and public
  included, brought into chat's context):
  - `src/routes.ts` gains an ownership-checked field, re-checked every turn;
  - the prompt gains a fenced block. A mentioned article is fenced as untrusted, which is
    **stricter** than today's library tools;
  - the client's citation renderer gains a second allowlist, built from the server's list, and a
    collision makes no link.
- **The existing leak channel gets more to carry** (Sol F2).
  - A hostile passage in a mentioned article could try to steer `read_web_page` into carrying the
    open article or the reader's question out.
  - The caps are 256 characters of query and fragment a call, and up to 2,048 across the whole URL
    with a model-chosen path.
  - That is the same channel, with the same caps, as a hostile open article today, and as
    `reader_notes`
    ([chat-tools.md § Security](../project/chat-tools.md#security-a-tool-result-is-data-and-one-of-them-is-a-strangers)).
  - The reader chose the mentioned article, as they chose the open one.
  - A test puts an instruction to call `read_web_page`, and a fake closing delimiter, in a mentioned
    article.

## Attachments (the other half of Greg's reply): a follow-up question, not built

Greg's preferred shape is *"a way to add attachments to an article"*. A chat would be one place to
upload them, and any attachment to the current article could be @-mentioned in its chats. The draft
of this plan proposed an "Upload a file…" row in the picker, sending the file through the ordinary
upload flow. **Opus and Sol each cut it on review** (Sol F9):

- **It is not what he asked for.** It makes a shelf article that costs a slot and takes minutes. It
  is not tied to this article, and it puts scribbles on the shelf. Shipping it risks reading as an
  answer when it is not one.
- **Every shape of "an attachment belongs to an article" needs decisions** about a new
  relationship, lifecycle, export, delete and UI. Greg said *"if it's really complicated we should
  discuss"*.

What v1 already gives: a file uploaded the ordinary way is an article, so it can be @-mentioned
once it is ready. The rest goes to Greg as a follow-up question (q-jzx20h, rewritten), with these
options (Opus's list):

- **(a) An attachment is an article row tied to this one.**
  - Hidden from the shelf, takes no slot, and is deleted with its parent.
  - Listed first in the picker, under "Attached to this article".
  - Reuses the importer, block ids, citations, export and delete.
  - A few days.
- **(b) A text-only addendum**, pasted or dictated onto the article, with block ids,
  @-mentionable. The cheapest; it covers "addendum", not files.
- **(c) Photos or scans of handwritten scribbles, read as images.** Needs a model that reads images
  and a spend fuse. Much bigger.
- **(d) Nothing new**: upload as an article, then @-mention it.

The risk, said plainly: a private draft held beside a chat that has web tools carries the leak risk
from q-jzx20h B.

## Stages

1. **Server.**
   - The work:
     - the migration and the `chat_mentions` store;
     - `mentions` on the send route, with its refusals;
     - the resolver;
     - the second cache part in `buildConverseMessages`, and the prompt rules;
     - `mentioned` on the thread GET and the stream's opening event;
     - snapshot and ZIP coverage.
   - Tests, red first:
     - refused: another reader's slug, the open article, a minimal article, an over-cap article, a
       fourth article, and `mentions` on a retry or an edit;
     - ownership is re-checked per turn, so a transfer drops the article and leaves its title only;
     - a deleted mentioned article leaves its title and `available: false`;
     - a re-extraction past the cap drops the article, with a reason;
     - the bp1 part is byte-identical with and without mentions;
     - the mentioned title and text arrive fenced, and a fake delimiter is broken;
     - retry and edit read mentions from the store;
     - an edit to the first question of a thread that has mentions.
   - Then the live two-call cache check.
2. **Client.**
   - The work: the picker, the "Bringing in" chips, the "Also reading" line, and the cross-article
     chip.
   - Tests:
     - Enter picks rather than sends while the picker is open;
     - Escape closes it, but not during IME composition;
     - a chip is drawn only for an id unique to one listed article, and a colliding id stays text;
     - the href comes from the server's slug.
   - One browser pass (Sonnet subagent) at 1440 and 390, the phone keyboard included.
3. **Docs and bookkeeping.**
   - chat-tools.md, security-map.md, and privacy if needed;
   - q-jzx20h rewritten with the attachments question;
   - the user-feedback notes, and feedback-endings.

Each stage gets a Sol code review, write-capable, then is committed and pushed.

## Reviews

- **Opus consult (product), 2026-10-12.** Its advice:
  - whole text only in v1, with a per-article cap;
  - mentions that last for the whole thread, with no removal;
  - explicit chips rather than matching the text;
  - "the article" means the open one;
  - cut the upload row and ask Greg instead.
- **Sol plan review**: [prompt](261012d-chat-at-mention-plan-review-prompt.md),
  [answer](261012d-chat-at-mention-plan-review-sol.md). *Sound with fixes*, no P0. All ten findings
  were checked against the code and taken:
  - F1, a collision-safe citation map;
  - F2, the real URL caps;
  - F3, `SET NULL` with a title snapshot;
  - F4, mentions only on a new send;
  - F5, a server-only size check, re-measured each turn;
  - F6, a live cache check;
  - F7, explicit chips;
  - F8, the widened fence rule;
  - F9, the upload row cut;
  - F10, the rollback export left out, with a reason.
- **Where the two disagreed.** Opus wanted a size field on the shelf so that a too-long article
  could be greyed out in the picker. Sol's server-only check won: it is one fewer field to keep
  true, and it covers a re-extraction.

## The simpler option passed over

**Telling the reader that chat can already search their shelf.** True, but `search_library`
excludes archived articles, depends on the model guessing words that are in the article, and its
answers about another article cannot be cited. Greg asked for exactly the thing it cannot do: *this*
article, into *this* chat.

**Tool-only reading** would put only the mentioned article's title in the prompt and let the model
read it with `read_library_passage`. It is cheaper per turn and handles long articles. But the model
reads a few passages and answers as if it had read the whole, which is the failure this product
exists to avoid. Whole text under a cap is the honest v1; tool reading for over-cap articles is the
follow-up.
