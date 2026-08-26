# Chat as the gateway — selections and paragraphs start conversations

Status: **built, 2026-08-26/27.** Written 2026-08-26 from Greg's brief and four design
calls he made the same day, then rewritten after a GPT-5.6 Sol review
([chat-as-gateway-sol-review.md](chat-as-gateway-sol-review.md)) that found four blocking problems.
The review is kept beside this file; where the two disagree, this file is what was built.

**What is not built yet**, so nobody has to reverse-engineer the gap: the hover tooltip on a chat
mark (the summary carries `title`, `turns` and `lastLine` for it, and nothing reads them yet); a
`docs/project/chat.md`, which chat still does not have; and the browser pass. The `?summary=1`
endpoint, the anchor, the cancel route, the floating panel, the ask box, the paragraph button and
the marks are all in.

Today, letting go of the mouse over a sentence in the prose column spends a model call. The answer
lands in a floating "Explanation" panel, and that panel is the end of the road: one question, one
answer, and a follow-up box that hands you off to chat mode.

This turns that around. **A selection starts a conversation, and nothing is bought until you ask
for something.** The explanation panel stops being a thing you can create; what a selection opens is
a small chat, floating over the article, anchored to the words you selected. Paragraphs get the same
door — a chat button beside every block id — anchored to the block rather than to a selection.

See [comments.md](../project/comments.md) for what exists today,
[chat-mode.md](chat-mode.md) for how chat was built, and
[chat-tools.md](../project/chat-tools.md) for what chat can reach for.

## Intent

Greg, 2026-08-26:

> Currently, when I select some text, it automatically pops up a Questions panel.
>
> - Can you add an easy-to-press Stop button (the cross in the top-right keeps moving as the text
>   streams in).
> - Rather than automatically kicking off the LLM, perhaps it should first show a text input box, so
>   I can ask something more specific about what's been selected, or cancel if I change my mind. If I
>   ask something specific, it should kick off a Chat with the first message set to the block-id plus
>   user input. In other words, I think I'm trying to turn the "Questions" interface into more of a
>   gateway to the general "Chat" interface. But we want to keep the selection in the text, so that
>   in future I can hover to see a bit about the Chat, and click to be taken to the full Chat, i.e.
>   that some chats are tied to a block-id and/or selection. (And this should be represented in the
>   database somehow)
> - Relatedly, let's add a "Chat" button next to each paragraph in the text (perhaps underneath the
>   block-id), that opens up the Chat with the block-id pasted into the message, ready for the user
>   to ask more about it. So that would be an example of a Chat that's tied to a block-id, but not to
>   a selection in this case.

### The four calls he made

Asked as four questions with diagrams, 2026-08-26. Each one closed a fork that would otherwise have
cost a rewrite.

1. **Everything goes to chat.** The explanation panel becomes a museum — it can still show the ones
   you already made, and still retry and deepen them, but there is no way to make a new one. An
   empty ask box plus Enter sends *"Explain this passage."* on your behalf.
2. **The chat floats over the article.** Not chat mode, which replaces the reading columns. Greg
   picked the more expensive of the two options with the cost stated in front of him: the panel is
   what he keeps reading behind.
3. **Stop on a first answer bins the lot**; stop on a later one keeps the words. See
   [§ Stop, and the two things it means](#stop) — this is the one call with a trap in it.
4. **The paragraph button pre-fills the id *and* the opening words.** Not the bare id: a
   six-character code in a text box is not something you can check you clicked correctly.

## What a reader sees

```
   BEFORE                                   AFTER
   ──────────────────────────────────       ──────────────────────────────────
   select text                              select text
        │                                        │
        ▼                                        ▼
   ┌────────────────────────┐              ┌────────────────────────────┐
   │ EXPLANATION            │              │ "…qualia realism debate…"  │
   │ "…qualia realism…"     │              │ ┌────────────────────────┐ │
   │ ⟳ reading the article… │              │ │ Ask something about…   │ │
   │                        │              │ └────────────────────────┘ │
   │  ~$0.01, unasked-for   │              │   [Ask in chat] [Cancel]   │
   └────────────────────────┘              └────────────────────────────┘
   one model call, already spent            nothing spent yet
```

Press **Ask in chat** and the box becomes a conversation in the same slot, still floating over the
prose, still anchored to the words you selected:

```
   ┌────┬────┬─────────────────────────────────────────────┐
   │gist│gist│ PROSE                                       │
   │    │    │                                             │
   │    │    │  …the ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ has never really…     │
   │    │    │        ↑ the mark stays, and is clickable   │
   │    │    │              ┌────────────────────────────┐ │
   │    │    │              │ ✎ "…qualia realism…"  [✕]  │ │  ← header pinned
   │    │    │              ├────────────────────────────┤ │
   │    │    │              │ you: what does he mean by  │ │
   │    │    │              │      qualia realism?       │ │  ← only this
   │    │    │              │ model: The phrase refers▌  │ │    scrolls
   │    │    │              ├────────────────────────────┤ │
   │    │    │              │ [ ask something…  ] [Send] │ │  ← composer pinned
   │    │    │              │ open in full chat          │ │
   │    │    │              └────────────────────────────┘ │
   └────┴────┴─────────────────────────────────────────────┘
```

And every paragraph grows a door of its own, under the id in the gutter:

```
   ┌──────────┬──────────────────────────────────────────┐
   │  k3m9qt  │  The qualia realism debate has never     │
   │   [💬]   │  really been about whether experiences   │
   │          │  exist, but about what kind of thing…    │
   └──────────┴──────────────────────────────────────────┘
        │
        ▼ opens the floating chat with the composer already saying
          `About block k3m9qt ("The qualia realism debate has never…"):`
          and the cursor waiting on the next line
```

## The three things this changes, in order of how far they reach

### 1. A thread can have an anchor <a id="anchor"></a>

This is the database half of Greg's *"some chats are tied to a block-id and/or selection … this
should be represented in the database somehow"*, and it is the piece everything else hangs off.

**A union, not three optional fields.** The first draft wrote `{ blockId, quote?, start? }`, which
has four inhabitants when only three are legal — and the illegal one, a quote with no offset, is a
mark drawn at the wrong place rather than an error anybody sees. Sol's correction:

```ts
/**
 * The passage a conversation is about, when it was started from one.
 *
 *   absent                    — an ordinary chat, started from the chat panel
 *   { blockId }               — started from a paragraph's chat button
 *   { blockId, quote, start } — started from a selection
 *
 * A union rather than optional members, so "a quote with no offset" is not a
 * value the type can hold. `exactOptionalPropertyTypes` is on: write `anchor`
 * by conditional spread (`...(anchor ? { anchor } : {})`) and never as
 * `anchor: undefined`, which is a different thing to the roundtrip test.
 */
export type ChatAnchor =
  | { blockId: BlockId }
  | { blockId: BlockId; quote: string; start: number };
```

`ChatThread` gains `anchor?: ChatAnchor`.

**The same anchor shape a `Comment` already has**, deliberately, because
[`resolveMark`](../../src/web/annotate.ts) is what draws both and it takes `{ quote, start }`. A
different spelling here would mean a second resolver, and the two would drift.

#### Postgres, and the foreign key I was wrong about

A new migration, `drizzle/0012_chat_thread_anchor.sql` — **0011 is `reader_profile`**, which the
first draft of this plan did not check.

The first draft argued *against* a foreign key onto `block_identities`, on the grounds that a
conversation must outlive a re-extraction that loses its block. **That premise is simply false**, and
the code says so in two places:

> THE SPINE. A block id, once minted, **is never deleted from this table.**
> — [`blockIdentities`](../../src/db/schema.ts)

> Points at the IDENTITY. This is the whole design: the block's text can vanish in a re-extraction
> and this row survives, because identities are never deleted.
> — [`comments_identity_fk`](../../src/db/schema.ts)

A re-extraction replaces *revision blocks*. Identities are the permanent layer underneath, and
pointing at them is exactly what already lets a comment outlive the paragraph it was about. So the
anchor gets the same composite key comments have, and **no `on delete set null`** — there is no
delete to react to.

```sql
alter table spideryarn.chat_threads
  add column anchor_block_id text,
  add column anchor_quote    text,
  add column anchor_start    integer;

-- A quote is meaningless without the block it sits in.
alter table spideryarn.chat_threads
  add constraint chat_threads_anchor_quote_needs_block
  check (anchor_quote is null or anchor_block_id is not null);

-- Both or neither: half an anchor is a mark drawn a few characters to the left
-- of the words it belongs to, which reads as a styling glitch rather than as
-- bad data. Same rule, same reason, as `chat_messages_attempt_both`.
alter table spideryarn.chat_threads
  add constraint chat_threads_anchor_both
  check ((anchor_quote is null) = (anchor_start is null));

alter table spideryarn.chat_threads
  add constraint chat_threads_anchor_start
  check (anchor_start is null or anchor_start >= 0);

-- The spine. Same shape, same reason, as comments_identity_fk.
alter table spideryarn.chat_threads
  add constraint chat_threads_anchor_identity_fk
  foreign key (article_id, anchor_block_id)
  references spideryarn.block_identities (article_id, block_id);
```

**The checks are necessary and nowhere near sufficient**, and it is worth being exact about the
division of labour, because a check constraint that looks thorough is a good way to stop thinking:

| what could be wrong | who catches it |
|---|---|
| quote without offset, negative offset | the checks above |
| a block id that is not a real block of this article | the foreign key |
| a malformed id (`isSpideryarnId`) | route validation |
| an empty quote, or an offset past the end of the block | route validation |
| a quote that is not actually the text at that offset | route validation, against the rendered block |

#### Filesystem

`data/<slug>/chat.json` grows the same optional field, **omitted** when absent rather than written
as `null`. `tests/store-roundtrip.test.ts` compares the two stores with `canonical()` + `toEqual` —
structural rather than byte equality, so this plan's first draft overstated it, but it does still
catch `null` against absent, which is the mistake actually available here.

#### The seams the first draft missed

Sol found four, all of them silent:

- [`src/store/export.ts`](../../src/store/export.ts) builds a thread from named fields and would
  simply not export the anchor.
- [`src/store/import.ts`](../../src/store/import.ts) inserts a thread from named fields and would
  discard it on the way back in.
- **Import must mint the `block_identities` row** an anchor names, exactly as it already does for
  comments — otherwise, with the foreign key above, importing an archive whose anchored block is not
  in the current revision fails the whole transaction.
- [`pg-chat.ts`](../../src/store/pg-chat.ts) needs conditional reconstruction in `threadsFor`, and
  the anchor columns must be **insert-only** in `upsertThread` — a later upsert must not blank them.

#### Set once, and *refused* rather than ignored

The first draft said a later turn carrying an anchor is "ignored rather than refused". That is wrong,
and the failure it produces is nasty: a user message about passage B, appended to a thread the
database says is anchored to passage A, with nothing anywhere disagreeing.

- `withTurn` sets the anchor **only** on the branch that builds a new thread.
- `POST /api/chat/:slug` **409s** an `anchor` sent for a thread that already exists, unless it is
  byte-identical to the stored one (which makes a retried send harmless).
- `retry` and `edit` do not go through `withTurn` at all — they use `withRetry`/`withEdit` — so the
  route must reject `anchor` alongside `retry` or `edit` rather than silently dropping it.

### 2. The reading view gets thread *summaries*, not the thread list <a id="summaries"></a>

The first draft proposed lifting `useChat` out of `ChatBand` into `Reader`, and offered a lighter
endpoint as an escape hatch for later. **Sol was right that this is backwards**, and the reason is
not the payload — it is two concrete bugs.

**The race, which is already documented in the code that would break.** `useChat`'s `send` inserts
optimistic rows; the initial GET, if it has not landed, then replaces the whole `threads` array with
the older server result. `ChatBand` waits for `loaded` before consuming a handoff precisely because
of this. Lift the hook to `Reader` and the reader can now beat the GET by hand:

```
   t0  article mounts, GET /api/chat/<slug> goes out
   t1  reader selects a sentence and presses Ask
   t2  send() inserts the anchored thread, POST goes out
   t3  the t0 GET returns — without the new thread — and overwrites `threads`
   t4  every delta lands on a thread that no longer exists, and is dropped
       on the floor with no error anywhere
```

**The render storm.** Every token calls `setThreads`. With that state in `Reader`, every token
re-renders the reading view, and `TableView` maps every block and calls `annotateHtml` during
render. A long article re-parses and re-annotates every paragraph, hundreds of times, while an
answer streams.

So the summaries endpoint is built **now**, and the streaming state stays below the `TableView`
render boundary:

```
   Reader
     ├── useChatAnchors(slug)   ← GET /api/chat/<slug>?summary=1
     │      id, title, anchor, updatedAt, turns, lastLine        (no messages)
     │      cheap, stable, changes only when a thread is created or deleted
     │
     ├── TableView  ← reads anchors only. Does NOT re-render per token.
     │
     └── ChatDialog ← owns useChat(slug). Mounted only when a panel is open,
                      so the transcript fetch and every setThreads stay in here.
```

One rule keeps them honest: **`ChatDialog` tells `useChatAnchors` when it creates or deletes a
thread**, so the summary list is patched locally rather than re-fetched. The two-sources-of-truth
worry the first draft used to argue against this is real, and it is answered by making mutations
flow one way rather than by having one source.

`ChatBand` keeps `useChat` too — the full view genuinely wants every transcript — and its doc
comment stays *almost* true: the boundary still exists, it just no longer exists alone.

**The auto-start effect is narrowed.** Today, arriving in chat mode with no threads opens an empty
one. That must not fire merely because an article-level hook loaded, and it must not create an
unrelated empty chat when an anchored draft is open or a shared link names a thread that has been
deleted. It stays inside `ChatBand`, where "arriving in chat mode" is still exactly what mounting
means.

### 3. The prose gets a second kind of mark <a id="marks"></a>

`MarkKind` in [`annotate.ts`](../../src/web/annotate.ts) becomes `"cmt" | "chat" | "term" | "hit"`.
Everything the file already says about overlap holds unchanged — a chat mark and a comment mark over
the same words produce one `<mark>` carrying both classes, which is the whole point of cutting text
nodes at every boundary in one pass.

Drawn from summaries whose anchor has a `quote`. **A block-only anchor draws no mark** — there is
nothing to underline, and washing a whole paragraph would claim the conversation was about all of
it. The paragraph's chat button gets a "there are conversations here" state instead: the 💬 turns
solid and carries a count. **The count is every chat anchored to the block**, selection-anchored ones
included; counting only the block-only ones would make the number contradict the marks beside it.

Resolution is `resolveMark(renderedText(block.html), anchor)`, the same call comments make, and it
fails the same way — the paragraph was edited and the quote is gone — with the same consequence: no
mark, but the conversation is still in the list and still openable.

**Index the blocks by id first.** The existing comment path does `blocks.find(…)` plus DOM parsing
per comment, which is O(comments × blocks); adding every anchored thread to that path amplifies a
cost that was already the expensive half of the memo. One `Map<BlockId, Block>` built once fixes
both.

#### When a chat mark and a comment mark cover the same words

`annotateHtml` producing one element with both classes is not the same as both artefacts being
reachable, and Sol is right that the first draft stopped one step short. Concretely: `TableView`'s
delegated handler looks for `mark.cmt` and opens the first comment it finds, and the ✳ marker is a
single `::after` on that element — there is only one of each to go round.

The answer here is **not** a chooser popup, and this is a deliberate deviation from the review:

- A click on a mark carrying both prefers the **chat**. It is the living artefact; comments are now
  closed to new arrivals, so the overlap can only ever be a pre-existing explanation.
- The comment stays reachable, because it already is by another route: the Dock's drawer lists every
  comment for the article and opens it (`onOpenComment` in App.tsx). Nothing becomes unreachable —
  it loses a shortcut, not its only door.
- The combined mark gets its own marker so the reader can see it is both, rather than silently
  looking like one of them.

A chooser is the right upgrade if overlaps turn out to be common. They should be rare and getting
rarer, which is why it is not worth the UI today.

**Clicking a mark opens the floating panel**, not chat mode — Greg's brief said "click to be taken to
the full Chat", and he confirmed the deviation on 2026-08-26: *"floating chat is probably better,
with an easy way to open the full chat."* So "open in full chat" is a line inside the panel.

**Hovering a mark** shows a tooltip: the thread title, how many turns, and the first line of the
latest answer — all of which the summary already carries, which is part of why the summary carries
them.

## The floating chat panel

A new `ChatDialog.tsx`, in the same fixed slot `CommentDialog` occupies, and **only one of the two is
ever open** — enforced by the overlay controller in [§ URL state](#url-state) rather than by two
components each trying to notice the other.

It is not `ChatPanel` shrunk. `ChatPanel` is 1,339 lines and most of that is the thread list, the
rename row and the suggestions grid — none of which belongs in a panel about one passage. What it
does need is `Conversation` and `Composer`, which are already separate components inside that file
and become exports of it. Nothing about them changes; they are given a narrower container.
`Composer` already takes `busy` and `onStop`, so the pinned stop control has a home without
touching chat's internals.

Structure, and **the layout rule is the whole answer to Greg's first bullet**:

```
   ┌────────────────────────────────────┐
   │ ✎ "…qualia realism…"       [✕/⏹]  │   header    ← flex: 0 0 auto
   ├────────────────────────────────────┤
   │ you: …                             │
   │ model: The phrase refers to the ▌  │   transcript ← flex: 1 1 auto
   │                                    │               overflow-y: auto
   ├────────────────────────────────────┤
   │ [ ask something…        ] [ Send ] │   footer    ← flex: 0 0 auto
   │ open in full chat                  │
   └────────────────────────────────────┘
```

Today `.cmt-dialog` sets `overflow-y: auto` on the *whole box*, and the box is pinned by its
**bottom** edge:

```css
.cmt-dialog {
  position: fixed;
  bottom: calc(var(--dock-h) + 0.75rem);   /* ← pinned by the BOTTOM */
  max-height: min(34rem, calc(100vh - 8rem - var(--dock-h)));
  overflow-y: auto;                        /* ← the WHOLE box scrolls */
}
```

Two separate things move the ✕, and fixing either one alone leaves the bug:

1. **The box grows upward.** Bottom-pinned, height following its content. Every paragraph the model
   writes pushes the header — and the ✕ in it — a line further up the screen.
2. **Then the header scrolls away.** Once the content passes `max-height` the whole box scrolls, and
   the header is content, so it leaves out of the top.

```
   text arrives ──▶      ──▶      ──▶      ──▶ past max-height
   ┌────────┐      ┌────────┐             ┌────────┐
   │EXPL [✕]│      │EXPL [✕]│  ← moved    │…refers │  ← gone
   │The ph▌ │      │The phr │             │to the  │
   └────────┘      │ase re▌ │             │view t▌ │
    ▲ bottom       └────────┘             └────────┘
      edge fixed    ▲ same                 ▲ same
```

So the fix is both halves:

- **Three parts, and only the middle one scrolls.** `header` and `footer` become
  `flex: 0 0 auto`; a new `.cmt-body` wrapper takes `flex: 1 1 auto; overflow-y: auto; min-height: 0`
  and the `overflow-y` comes off the `aside`. (`min-height: 0` is load-bearing — a flex item's
  default `min-height: auto` refuses to shrink below its content, so without it the box grows past
  `max-height` and nothing scrolls at all. It is the classic silent one.)
- **A constant height while an answer is arriving.** `.cmt-dialog.busy { height: <the same
  expression as max-height> }`, dropped the moment the answer settles. Not a permanently constant
  height, which would put a two-line explanation in a 34rem box; and the relax-to-fit happens at the
  end, when the reader is no longer aiming at a button.

**The same fix goes onto `CommentDialog`** in the same change. It is the panel he complained about,
old explanations still stream into it on a retry or a deepen, and leaving the bug in the museum
because the museum is closing would be a strange thing to do.

`ChatDialog` takes the stable height **once there is a transcript** — a conversation wants a steady
frame — but not for the ask box, which is three controls and should not open as a 34rem rectangle.

### URL state <a id="url-state"></a>

**One id, not two.** The first draft added `?chat=<threadId>` beside the existing `?thread=`. Sol's
objection is that it carries no information `mode` does not already carry, and two ids that can
disagree is a bug waiting to be written. So:

| `?thread=` | `mode=chat` | what you see |
|---|---|---|
| set | yes | the conversation in the band, full width |
| set | no | the same conversation, floating over the article |
| unset | either | no conversation open |

"Open in full chat" is therefore `setMode("chat")` and nothing else — the id is already right. And
leaving chat mode leaves the panel floating where it was, for free.

`replace`, not `push` — `threadParam` already is, matching the documented rule for `?note=`. Back
does not step through floating panels, which is the existing deliberate behaviour rather than a new
compromise.

**A shared link naming a deleted thread** must, once the load confirms it is absent, clear `?thread=`
with `replace` and say *"that conversation no longer exists"*. It must specifically **not** fall into
the auto-start effect, which would silently point the URL at an unrelated new chat.

**One overlay controller.** `note` (a comment) and `thread` (a chat) are independent parameters and
can both be present in a pasted URL, so "opening one closes the other" is a statement about clicks
and not about state. One piece of state — `none | comment | chat-draft | chat-thread` — decides what
is in the slot, and a URL carrying both resolves deterministically (chat wins, as with marks).

### The ask box

Before there is a thread, the same slot holds the ask box — the quote, one text input, and two
buttons. It is not a separate floating thing; it is what `ChatDialog` renders when it has an anchor
and no thread yet.

- **Enter with text** → send it.
- **Enter with an empty box** → sends `Explain this passage.` Greg's call, and it means the old
  behaviour is still one keystroke away rather than gone.
- **Escape** → cancel. First Escape clears a half-typed question, second closes the box — the rule
  `CommentDialog`'s follow-up input already follows, and for the reason written there.
- **Nothing is spent** until one of those sends.

`MIN_SELECTION_CHARS` (8) stays. Its stated job was to stop a skidded double-click costing a model
call, and it no longer costs one — but a box appearing over the prose on every stray drag is its own
kind of annoying.

**The browser's own selection highlight stays put**, and this is a change: `onSelect` currently calls
`window.getSelection()?.removeAllRanges()`, because the mark it had just drawn was underneath it.
There is now no mark to reveal — nothing is persisted until you ask — so clearing it would leave the
reader looking at a quote in a box with no idea which words on the page it came from. It is dropped
when the thread is actually created and the mark exists.

**Dodging belongs to the shell, not to either panel.** `CommentDialog` owns its own pointer
listeners and hides itself while a drag is happening in the prose. A freshly mounted `ChatDialog`
never saw that drag's `pointerdown`, so it cannot hide for the drag that is about to replace it. One
piece of selection state in the floating shell instead: hide whatever is open while a drag is live,
restore it on `pointercancel` or an unusable selection, and swap it atomically for the anchored ask
box on a good mouseup.

### What the first message says, and what the model is actually told

Greg's call: the composer is pre-filled with the id **and** the opening words, so you can see which
paragraph you clicked rather than trusting a six-character code. That is what the reader types into
and what the transcript shows afterwards:

```
About block k3m9qt ("The qualia realism debate has never really…"):

what does he mean by qualia realism?
```

**But that text is not how the model learns where the reader is pointing**, and the first draft of
this plan thought it was. Two ways it breaks:

1. **The anchor falls out of the window.** `converse` sends the most recent `HISTORY_TURNS = 20`
   turns. On turn 21 the first message is gone, and the model is answering about a passage nobody
   has mentioned for a while — while the UI and the database both still say the thread is anchored
   to it.
2. **A reader can edit the first message.** `withEdit` allows it, and the thread's anchor does not
   follow.

So **the structural anchor is canonical**. The request sends `{ anchor, question }` as separate
fields; the anchor is validated against the real block; and `converse` is handed the anchor on
**every** turn and renders it into the final variable user block — after the article cache
breakpoint, so `articleWithIds` stays byte-identical and
[prompt-caching.md](../project/prompt-caching.md)'s three caches are untouched.

The visible prefix in the first message stays, because Greg asked for it and because it is what
makes *"as you said in k3m9qt"* resolvable when the reader reads the transcript back. It costs a few
dozen duplicated tokens on turn one and buys a conversation that reads correctly. The model's
authority is the structural anchor; the text is for the human.

#### The quote is untrusted content

The anchor quote is **the article's words, not the reader's**, and copying it into what looks like
the reader's own instruction is how an article's prompt injection gets promoted into an instruction
the model is inclined to follow. [security.md](../project/security.md) already names the article as
one of the two untrusted parties here. So the rendered anchor is fenced and labelled as quoted
article data that is not an instruction — the same treatment `fetch_url` output already gets in
[chat-tools.md](../project/chat-tools.md).

#### Two limits, not one

`MAX_QUESTION_CHARS` is 4000 and the route 413s past it. A selection can trivially exceed that — it
is a paragraph of somebody else's prose — so selecting a long passage would open a thread
optimistically and then take a 413 with the panel already on screen. The anchor gets its own,
larger limit, checked separately, and the client refuses over-long selections **before** it mints a
thread.

#### The quote must never reach a log

`logging.md`'s rule — never article prose in a log — now has a new way to be broken, because the
quote travels in a request body and lands in a database column. Specifically:

- no quote in a validation error message (`httpError` messages are logged as `reason`, and redaction
  is path-based and cannot reach a string — the rule `answer()` already states for `deep`)
- no quote in structured log fields, tooltip diagnostics, or SQL parameter logging
- a canary test that runs an anchored chat with a distinctive quote and asserts the string appears
  nowhere in the captured log output

### The paragraph button

In [`TableView.tsx`](../../src/web/TableView.tsx), under the existing
`<BlockRef className="block-id" …>` in the prose gutter. Lucide `MessageSquare`, size 12, the one
stroke weight everything uses ([icons.md](../project/icons.md)).

- **Hidden until the row is hovered**, and **always present for the keyboard** — `opacity: 0` plus
  `:focus-visible { opacity: 1 }`, never `display: none`, which would take it out of the tab order
  and hand a keyboard reader nothing. `pointer-events: none` goes with the `opacity: 0`, or the
  gutter grows an invisible mouse target that eats clicks meant for the id above it.
- **Solid, with a count, when the block already has conversations.** That is the only affordance a
  block-only anchor gets in the prose, since it draws no mark.
- Opens the floating panel with a **new** thread (`begin()`, local only until you send) and the
  composer pre-filled, cursor at the end.

## Stop, and the two things it means <a id="stop"></a>

Greg's call: *"first answer: bin the lot. Later: keep the words."*

```
   FIRST ANSWER OF A CHAT YOU JUST STARTED     LATER ANSWER IN A REAL CONVERSATION
   ───────────────────────────────────────     ──────────────────────────────────
   ┌───────────────────────────────┐           ┌───────────────────────────────┐
   │ "…qualia realism…"    [ ✕ ]   │           │ you: and what about Dennett?  │
   │ you: Explain this passage.    │           │ model: Dennett's reply is ▌   │
   │ model: The phrase refers ▌    │           │                      [ ⏹ ]   │
   └───────────────────────────────┘           └───────────────────────────────┘
              │                                            │
              ▼                                            ▼
   panel gone, mark gone, nothing in         the words stay, marked "you stopped
   the chat list. As if you had never        this". Earlier turns untouched. This
   selected the text.                        is chat's existing Stop, unchanged.
```

**Two behaviours must not share one word.** Chat's existing stop is `⏹ Stop`, and it keeps things on
purpose — `ChatMessage.stopped` exists precisely so an answer ending mid-sentence does not read as a
bug. Labelling a destructive control "Stop" next to a non-destructive one called "Stop" is how a
reader loses a conversation. So:

- first answer of a thread with exactly one turn → **`✕ Cancel`**, titled *"stop and throw this chat
  away"*
- everywhere else → **`⏹ Stop`**, unchanged

Both live in the pinned header, in the same place, so neither moves while text arrives.

### How cancel is implemented

The first draft sequenced two existing endpoints — `stop`, then `DELETE`. **Sol showed that is a
destructive race**, and the demonstration is short enough to keep:

```
   Tab A                             Tab B
   ─────                             ─────
   POST …/stop
     aborts the writer,
     awaits live.done, returns
                                     sends a second question
                                     (thread now has 2 turns)
   DELETE …/<threadId>
     removes BOTH turns — it has
     no expected-tail guard and
     does not call settleThread
```

`await live.done` genuinely does what its doc comment says: the *named* writer has finished. What it
does not do is make the pair atomic, and there are four more ways through:

- **Before the `begin` frame.** `useChat`'s existing `stopWanted` sends the provisional id first and
  fires the real stop later without awaiting it. A `cancelAndDiscard` that awaited the first request
  would read `{stopped:false}` and delete while the real stream was still running.
- **`{stopped:false}` means three different things** — already finished, wrong attempt, or the writer
  is in another process. Only the first is safe to treat as settled.
- **Two filesystem servers** can interleave `A load → B delete+save → A stale save` and resurrect the
  thread. (Postgres is safe from resurrection, via the FK and the attempt fence, but still cannot
  abort a model call running in another process.)
- **A concurrent sweep** is not a cancellation fence and can clear the attempt underneath it.

So cancel is **one server operation**, `POST /api/chat/:slug/:threadId/cancel`, taking
`{ messageId, attempt, expectedTailId }`:

1. Check this is still exactly the first turn, and the named attempt.
2. Abort and await any matching writer in this process.
3. Re-check under the same lock the store already takes.
4. Delete only if the tail is unchanged.
5. `409` if another turn or another attempt appeared — the client then refreshes rather than
   destroying something.

Cross-process abort remains **best-effort and is stated as such**: another server's model call cannot
be reached, so it finishes and pays, and its `finish` then updates zero rows. Deletion is still safe,
which is the property that matters.

On the client, cancel puts a **reversible `cancelling` tombstone in immediately** — the panel closes
and the mark goes at once — and suppresses further SSE frames for that thread from that moment,
because the reader's stream reader will happily go on draining frames that were already buffered
when the response returned. It commits on success and restores on 409.

## What happens to comments

The explanation feature is not deleted. It is closed to new arrivals.

| | before | after |
|---|---|---|
| a fresh selection creates one | yes, automatically | **no** |
| existing ones show in the prose | yes | yes |
| existing ones open, retry, deepen | yes | yes |
| the follow-up box | hands off to chat **mode** | opens the **floating** chat, carrying the comment's anchor |
| `POST /api/comments/:slug` | creates and answers | **requires an existing id**; retry and deepen still use it |
| `useComments.ask` | called by `onSelect` | **unreferenced; deleted** |

`ask` and `SelectionAnchor`'s route into it go; `readSelection` itself stays, because that is what
builds the anchor the chat now carries. `MIN_SELECTION_CHARS` stays.

**And the server has to mean it.** Deleting `useComments.ask` closes the React path and nothing else:
`POST /api/comments/:slug` still calls `commentStore.create` for any id it has not seen, so a stale
tab left open in another window, or a direct request, can still make a new explanation. "There is no
way to make a new one" is a contract or it is a convention about the current build. It is a contract:
the retained POST **requires that the comment id already exists** and 404s otherwise, which is all
retry and deepen ever needed.

## Files

| file | what changes |
|---|---|
| [`src/types.ts`](../../src/types.ts) | `ChatAnchor` union; `ChatThread.anchor?`; `ThreadSummary` |
| [`src/db/schema.ts`](../../src/db/schema.ts) | three columns, three checks, and the identity FK on `chatThreads` |
| `drizzle/0012_chat_thread_anchor.sql` | the migration (0011 is `reader_profile`) |
| [`src/chat.ts`](../../src/chat.ts) | `withTurn` sets the anchor on creation only |
| [`src/converse.ts`](../../src/converse.ts) | the anchor rendered into the final user block, every turn, fenced as article data |
| [`src/store/contracts.ts`](../../src/store/contracts.ts) | `begin`'s turn grows `anchor?`; `summaries()`; `cancelFirstTurn()` |
| [`src/store/fs.ts`](../../src/store/fs.ts), [`src/store/pg-chat.ts`](../../src/store/pg-chat.ts) | read/write the anchor (insert-only columns); the conditional delete |
| [`src/store/export.ts`](../../src/store/export.ts), [`src/store/import.ts`](../../src/store/import.ts) | carry the anchor; **import mints the identity row** |
| [`src/routes.ts`](../../src/routes.ts) | `?summary=1`; anchor validation and its own length limit; `409` on a re-anchor; the `cancel` endpoint; comments POST requires an existing id |
| [`src/web/useChat.ts`](../../src/web/useChat.ts) | `send(…, anchor?)`; `cancelAndDiscard`; frame suppression after cancel |
| `src/web/useChatAnchors.ts` | **new** — the summary fetch, and local patching on create/delete |
| [`src/web/App.tsx`](../../src/web/App.tsx) | the overlay controller; `onSelect` opens the ask box; `ChatBand` keeps `useChat` |
| `src/web/ChatDialog.tsx` | **new** — the ask box, the floating conversation, and `useChat` |
| [`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx) | export `Conversation` and `Composer` |
| [`src/web/chat-handoff.ts`](../../src/web/chat-handoff.ts) | `askAboutBlock` replaces `askAboutQuote` |
| [`src/web/annotate.ts`](../../src/web/annotate.ts) | `MarkKind` gains `"chat"` |
| [`src/web/TableView.tsx`](../../src/web/TableView.tsx) | chat marks; blocks indexed by id; the 💬 gutter button; chat wins a shared mark |
| [`src/web/CommentDialog.tsx`](../../src/web/CommentDialog.tsx) | pinned header/footer; follow-up opens the floating chat |
| [`src/web/styles.css`](../../src/web/styles.css) | `.chat-dialog`; the flex fix on `.cmt-dialog`; chat marks; the gutter button |
| [`src/web/params.ts`](../../src/web/params.ts) | unchanged — `?thread=` already does the job |

Docs: [comments.md](../project/comments.md), [url-state.md](../project/url-state.md),
[database.md](../project/database.md), [web-client.md](../project/web-client.md),
[prompt-caching.md](../project/prompt-caching.md), [logging.md](../project/logging.md),
[security.md](../project/security.md), and a new `docs/project/chat.md` with its line in
[CLAUDE.md](../../CLAUDE.md) — chat has no project doc at all today, which is starting to show.

## Tests

Reproduce first, in the spirit of the working agreement — most of these are for behaviour that does
not exist yet, so they go red on purpose before anything is written.

**The change itself**

- **A selection spends nothing.** Letting go of the mouse fires no `fetch`. This is the regression the
  whole change is about, and the one that would come back silently.
- **The comments POST refuses an id it has not seen** — the museum is a contract, not a convention.

**The anchor**

- Store roundtrip, all three anchor forms, filesystem against Postgres (`null` vs absent).
- Store parity: `begin` with an anchor produces the same thread from both stores.
- **Export → import → export** keeps the anchor, and import mints a `block_identities` row for a
  block the current revision no longer has.
- `upsertThread` does not blank an anchor on a later write.
- The route 409s an anchor for an existing thread, and refuses `anchor` with `retry` or `edit`.
- Half an anchor, a bad id, an empty quote, an offset past the end, and a quote that is not the text
  at that offset are each a JSON 400 with nothing written.
- **A selection longer than the anchor limit** is refused before a thread is minted — no optimistic
  thread, no 413 with the panel already up.

**The prompt**

- Turn 21 still tells the model the anchor. (The `HISTORY_TURNS` bug, pinned so it cannot come back.)
- `articleWithIds` is byte-identical with and without an anchor — the cache breakpoint is untouched.
- The anchor is fenced as article data rather than as the reader's instruction.
- **Canary: the quote appears in no log line**, at any level, for a full anchored turn.

**Cancel**

- Cancel removes the thread; stop on a later turn keeps the text and sets `stopped`.
- Cancel pressed **before the `begin` frame** cancels once the real id arrives, and does not delete
  on the provisional one.
- A second turn arriving between the abort and the delete → **409, nothing destroyed**.
- A stale attempt → 409.
- Buffered SSE frames arriving after cancel are dropped, not applied.

**The prose**

- `annotateHtml` with a chat mark and a comment mark over the same words: one `<mark>`, both classes,
  and a click opens the chat while the comment stays reachable from the drawer.
- A chat whose block was re-extracted away still loads, still opens, draws no mark.
- The gutter count counts every chat anchored to the block.

A browser pass ([browser-testing.md](../project/browser-testing.md)), in a Sonnet subagent, for what
a test cannot see: the ✕ genuinely not moving while text streams, the gutter button reachable by
keyboard (and not an invisible mouse target when hidden — `opacity: 0` alone leaves one), and the
selection still visible under the ask box.

## What the review settled <a id="questions"></a>

The five open questions the first draft carried, answered by
[the Sol review](chat-as-gateway-sol-review.md) and checked against the code before being accepted:

1. **Foreign key on `anchor_block_id`?** **Yes**, composite onto `block_identities`, no
   `on delete set null`. The draft's reason for skipping it was factually wrong — identities are
   never deleted.
2. **Lift `useChat`, or build the summaries endpoint now?** **Summaries now.** The full lift has a
   documented race and a per-token re-render of every paragraph.
3. **A `?chat=` of its own?** **No.** `?thread=` plus `mode` already says everything.
4. **Stop-then-delete?** **No** — a destructive race across tabs. One conditional server operation.
5. **Can a comment still be created?** **Yes, through the route**, until the route requires an
   existing id. Now it does.

### Still open

- **Cross-process abort is best-effort.** A model call running in another server process cannot be
  reached; it finishes, it is paid for, and its `finish` writes nothing. Deletion is safe. Worth
  revisiting if we ever run more than one writer in earnest.
- **A chooser for overlapping marks** is deliberately not built — see
  [§ When a chat mark and a comment mark cover the same words](#marks). Revisit if overlaps turn out
  to be common, which they should not, since comments are closed.
- **RLS is still deferred project-wide.** The new columns inherit `chat_threads`' ownership and need
  nothing of their own, but the new `summary` and `cancel` endpoints must sit behind the same owner
  boundary as everything else.
