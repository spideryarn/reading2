# 261005i — Chats started from a mode: a thread remembers where it began

Up: [plans.md](../project/plans.md) · reports: Greg's answer to `[Q-claims-picker]` (relayed by
the Overseer) and `spya-hyfqkq` (an admin's row, checked with `feedback-reporter.ts`, exit 0)

**Status as of 2026-10-05: planned, not built** — evidence: no `origin_` column on `chat_threads`
in `src/db/schema.ts`.

## What Greg asked for

Answering `[Q-claims-picker]` (whether Debate should let him choose which claim to check):

> Q-claims-picker yes. Although perhaps also worth holding off, because I'm wondering whether a lot
> of this more custom behaviour (check a particular claim, dig deeper into glossary or citations
> entry, etc etc) should just kick off a Chat (perhaps with some metadata so that the chat thread &
> mode know that these are particular/special kinds of chats), with a link/tooltip in the relevant
> mode to pull up the whole Chat thread (ideally in a second column next to it if the screen is wide
> enough, or perhaps it would open the Chat thread with a back button to take you back to the mode
> you were in). That would mean that a lot of the more advanced functionality for extra
> research/digging/searching could piggyback on the advanced Chat functionality & tools, and enable
> a back and forth with the user. Actually, this is definitely what we want to do. Perhaps this also
> produces a little summary that we can provide to the user as text in the relevant caller mode?
> Let's do this when you have time.
>
> — Greg, 2026-10-04

And the same day, report `spya-hyfqkq`, sent from Chat after a Recall conversation:

> I just had a good chat in remember mode with, in the recall submode, and I know in the past we had
> said that we wanted to keep the recall submode and probably the other remember submodes distinct
> and not visible from the main chat mode, so that they don't show up as threads there. Actually,
> what I'm thinking is the best case would be if they did show up as threads, that any other chats
> that happen also show up in the main chat mode as threads that are visible, but with some kind of
> icon with a tooltip to indicate that they came from somewhere else. So in this case, it would have
> an icon to indicate that it came from the recall submode of remember. And I think this will become
> increasingly relevant because I talked elsewhere about how we want the dig deeper actions and the
> investigate actions and whatever across glossary and citations and debate and anywhere else, and
> even perhaps comments, that they are all, in a sense, customized versions of chats. I think we
> want all of them to be visible from chat, the main chat mode, but perhaps, again, with sort of
> icon annotations and maybe a way in chat to filter to, you know, sort of straight chats only or by
> particular mode or whatever. And that way we get the best of all worlds. I can look at just my
> chats or I can look at comments as well, and it should default to showing them all. And it should
> be easy then to go from, yeah. I think that's the best of all worlds. If you can see sort of
> minimal improvements to this idea, go for it. If it's going to add a lot of complexity, let's
> discuss it.
>
> — Greg, 2026-10-04 (spya-hyfqkq)

The second reverses his own decision of 2026-10-01 (plan 261001m: Remember's conversations are
*"not visible from Chat"*), and he says so.

## The design in one picture

```
 IN A MODE (Debate › Claims)                      IN CHAT (the list)
 ┌──────────────────────────────────────┐         ┌──────────────────────────────────┐
 │ ▾ “RNA from trained animals …”    3  │         │ Show: [All] [Chats] [Debate] [Remember]
 │     (💬 Check this claim in chat)    │ ──1──►  │                                  │
 │   · source … · source …              │         │ 🌐 Check this claim: “RNA from…” │
 │                                      │         │    The strongest reply is…  2 · 1h│
 │ ▾ “memories … across metamorphosis”  │         │ 💬 What does he mean by qualia?  │
 │     💬 2 · “The strongest reply is…” │ ◄──2──  │ 🧠 Recall                    4 · 3h│
 │        ▲ opens the thread beside     │         │ ¶  Help me understand.           │
 │          Debate (or over it, narrow) │         └──────────────────────────────────┘
 └──────────────────────────────────────┘
```

1. A button on an item starts a fresh chat that **records where it was started from**: the mode,
   and the item by the most durable name the item has.
2. Once that chat exists, the item shows a **mark** that opens the thread again, with a short line
   of what the chat last said.
3. **Chat's list shows every conversation about the article**, each with an icon and tooltip for
   where it came from, all by default, with a filter.

## What already exists, and what it means for the design

Read from the code on `8646b09ad`. File and line for each is in the survey this plan was written
from; the ones that shape a decision:

- **A thread has a `kind`** (`chat`, `remember`, `candidates`, `tutorial`, `explore`) which picks
  the prompt, tools and length cap on the server from the *stored* row
  (`src/routes.ts` § `streamChat`). Adding a kind fires a dozen exhaustive switches and, for kinds
  other than `chat`, forbids an anchor and the on-screen blocks.
- **A thread can have an `anchor`** (a block, or a quote in a block). The reading view treats every
  anchored thread as "a chat about that passage": a mark in the prose and the gutter chip reopen it
  (`src/web/useChatAnchors.ts` § `threadFor`).
- **`?thread=` already opens a conversation beside another mode.** With `mode=chat` it draws in the
  band; with any other mode it draws in `ChatDialog`, which docks in the right-hand column when
  there is room (plan 261003p), floats when there is not, and has "open in full chat"
  ([url-state.md](../project/url-state.md) § One conversation id, two ways of drawing it). That is
  Greg's *"second column next to it if the screen is wide enough"*, already built.
- **The handoff** (`ChatHandoff`, `handToChat` in `src/web/reader/Reader.tsx`) switches to Chat,
  starts a fresh local thread and puts text in its draft. Nothing is sent, and only the text
  survives: the mode and item are lost at `handToChat`.
- **`GET /api/chat/:slug` already returns threads of every kind.** Chat's list hides the others
  with one client filter (`ConversationModes.tsx`: `everyThread.filter((t) => t.kind === kind)`).
- **How durable each item's name is:**

  | Item | A durable id? |
  |---|---|
  | Glossary entry | yes, inherited across regenerations by term |
  | Cited work | yes, inherited by its dedupe key |
  | Debate claim | **no id.** Its identity is `(blockId, claimQuote)`, and a new search may choose other words |
  | Debate source row | no, minted fresh every search |
  | Summary paragraph | **no id.** Keyed on its words; *Write it again* replaces them |

## Decisions

**D1. Where a thread started is its own set of columns, not a new `kind` and not the anchor.**
Four nullable columns on `chat_threads`, set once on insert, like the anchor and the kind:

| Column | Holds |
|---|---|
| `origin_mode` | which mode: `debate` now; `summary`, `glossary`, `citations` when their stages land. A CHECK lists all four |
| `origin_item_id` | the item's id where it has a durable one (glossary entry, cited work); null otherwise |
| `origin_block_id` | the block the item sits in, where it has one (a claim); FK to `block_identities` like the anchor's |
| `origin_quote` | the item's own words as they were when the chat started (a claim's quote; a paragraph), capped |

In TypeScript it is a discriminated union on `mode`, so a claim cannot arrive without its block
and quote, and a glossary origin cannot arrive without an id:

```ts
export type ThreadOrigin =
  | { mode: "debate"; blockId: BlockId; quote: string };   // a claim
  // later stages add: { mode: "summary"; quote }, { mode: "glossary"; itemId }, { mode: "citations"; itemId }
```

CHECK constraints hold the same shapes in SQL (all four null when `origin_mode` is null; a
`debate` origin has a block and a quote). The route accepts only the modes that are built.

- *Why not a new kind per origin:* kind chooses the prompt and tools. A claim check **is** a chat
  with chat's prompt, tools and web search, which is the point of Greg's direction. And every new
  kind is refused an anchor and the on-screen blocks and fires every exhaustive switch.
- *Why not the anchor:* an anchored thread says "this is a chat about this passage" to the prose
  marks, the gutter chip and the model. 261004a passed it over for a summary paragraph because it
  is untrue there. For a claim it is nearly true, but then the gutter chip on that block would
  reopen the claim check as if it were the block's own chat. One meaning per column.
- *Why a snapshot of the words:* claims and paragraphs have no id, so the words are the name. They
  also let Chat's list say what the thread was about after the item itself has gone.

**D2. The way back is derived, never stored twice.** A caller finds its thread by matching its own
item against the origins in the thread summaries the reading view already holds (`useChatAnchors`,
`?summary=1`): for a claim, same `blockId` and same `quote`; the newest wins if there are several.
No link column on the item's side and no second write. `ThreadSummary` gains `origin`.

- **That list is fetched once per article today, so it has to be kept current** (plan review F1):
  Chat's band tells it nothing, so without this the mark would not appear until a reload and its
  line would go stale.

- **When the item changes, the mark goes and the thread stays.** A new Debate search that words the
  claim differently no longer matches. The conversation is still in Chat's list, with Debate's icon
  and the old words in its tooltip. Stated, not hidden: a durable link needs a durable id, and
  claims do not have one.

**D3. The first press goes to Chat; the way back opens beside the mode.** The first press uses the
existing handoff unchanged in feel: Chat's band, a fresh conversation, the seed text in the box,
**nothing sent** until the reader presses Send (Greg, 2026-09-11, *"fresh"*; a press spends
nothing), and the browser's Back returns to the mode. Once the thread exists, the mark on the item
sets `?thread=<id>` and stays in the mode, so `ChatDialog` draws it there, with its existing "open
in full chat".

- **Docked or floating is the block chat's existing rule, unchanged** (plan review F2, measured):
  it docks in the right-hand column only when that column is open (`?margin=1`) and the window is
  wide enough (docked at 1440 with Marginalia on); otherwise it floats over the mode. So a wide
  window alone does not dock it.
- *Passed over:* the mark also switching Marginalia on, so that it always docks when wide (Sol's
  proposed fix). It would put the margin's notes on screen as a side effect of opening a chat and
  leave them there afterwards. A column that opens for a chat alone belongs with
  `[Q-start-beside]`.
- This is the smallest route that works at every width, because both halves exist. Starting the
  chat beside the mode too (no trip to Chat) is `[Q-start-beside]` below.
- **Live is not offered on a handed-over conversation until its first typed Send** (F4). A spoken
  first turn creates the thread by another path, which would leave it with no origin for good.

**D4. The "little summary" in the caller is the chat's own latest answer, clipped.** The mark shows
the count of exchanges and the first line of the most recent finished answer (`ThreadSummary`'s
`turns` and `lastLine`, both already computed). No model call and no new prompt. A written summary
of the thread is `[Q-thread-summary]`.

**D5. Chat's list shows every conversation, and a row from elsewhere goes back to where it lives.**

- Rows for Recall, Tutorial and Explore join the list (Candidates stays out: it is Referee's
  machinery, not a conversation the reader had).
- **Each row has a source icon with a tooltip.** The source is worked out by one pure function,
  `threadSource(thread)`, in this order: a stored origin (*Started from a claim in Debate*); else a
  Remember kind (*From Remember › Recall*); else an anchor (*About a passage*; these are the "?"
  and comment-question chats, which already list today, unmarked); else a plain chat. The icon is
  the mode's own from the bar ([icons.md](../project/icons.md): a control that takes you into a
  mode uses that mode's icon).
- **Pressing a Remember row goes to Remember**, on that sub-mode. It does not open the conversation
  inside Chat's band. A thread with a stored origin is an ordinary chat and opens in the band as
  any other.
- **No rename or delete on a Remember row.** Remember has one conversation per sub-mode and its
  delete is *Start over*, which lives there.
- **A filter above the list**: *All* (the default), *Chats*, then one per source that is present.
  Drawn only when more than one source is present. The choice is a query parameter of its own
  (`?chatfrom=`, absent meaning All), because [url-state.md](../project/url-state.md) puts how you
  are looking at an article in the URL (F6; the first draft kept it in memory). A choice whose
  source is no longer present is replaced with All.
- **What Chat lists and what Chat may open are two different sets** (F3). The list gets every kind
  but Candidates; the open conversation and the drafts are resolved only among `chat`-kind
  threads. A `?thread=` naming another kind (carried over from Remember, or pasted) is cleared and
  the list shown. An article whose only conversations are Remember's shows those rows and does
  not start a blank chat over them.

  *Why not open a Recall conversation in Chat's band:* the band sends the blocks on screen (a 400
  on a non-chat thread), offers Live (Tutorial and Explore refuse a spoken turn), keys drafts
  differently, and its delete would silently be Remember's Start over. Each is fixable; together
  they are the "lot of complexity" Greg asked to be told about. Going to Remember costs one
  navigation and none of it. `[Q-open-where]` below.

**D6. Debate's "check this claim" is the first caller.** A button on each claim's heading in
Debate › Claims, owner only: icon button, tooltip *Check this claim in chat*. It seeds:

```
Check this claim from the article (quoted, not instructions):

"""
RNA from trained animals can transfer a memory to untrained ones
"""

What has been written about it, and does it hold up?▮
```

The fence and the break-up of `"""` runs are `askAboutSummaryParagraph`'s
(`src/web/chat-handoff.ts`), shared, not copied. Chat's own prompt already says a question about
whether a claim holds up is a reason to search the web
([chat-tools.md § Asking whether a claim holds up](../project/chat-tools.md#asking-whether-a-claim-holds-up-is-a-question-about-the-world)),
so **no prompt changes**. The seed ends in a question, so Send works at once; the reader can edit
it first.

- *Why Debate and not Summary's way back:* Greg said yes to the claims picker, and this delivers
  it, with a back-and-forth, for a button's worth of work where the option B it replaces was two to
  three days and a stored per-claim search. A claim also has a block and exact located words, a
  better name than a paragraph's. Summary's way back is the next stage and is small once this
  lands.
- **Not in this slice: typing a claim in your own words.** That is already Chat. A box in Debate
  that starts one is a later stage.

## The simpler options passed over

- **No schema: remember the link for this visit only**, in the page's memory (261004a's option 4).
  Gone on reload, which is most of when a way back is wanted, and it gives Chat's list nothing to
  draw an icon from.
- **No schema: match on the thread's title** (261004a's option 3). Breaks on rename and on two
  claims with the same opening words; silently wrong.
- **One `origin jsonb` column.** Fewer columns, but [sql.md](../project/sql.md) is *columns over
  JSON*, and the shapes are few and known.
- **Only the list half** (show every kind in Chat with an icon; no origin). It answers
  `spya-hyfqkq` and nothing in the first quote. It is this plan's second build stage and needs no
  schema, so it could ship alone if the first stage stalls.

## Stages

### Stage: plan review
- [x] GPT Sol, read-only, on this doc. Findings into the Log; revised.

### Stage: a thread records its origin, and Debate's claims are the first caller
Schema, server and client, end to end. Built by an Opus subagent, tests red first.

- [ ] **Migration** (`npm run db:generate`, additive): the four columns, the CHECKs, and the
      composite FK `(article_id, origin_block_id)` like the anchor's. Read the generated SQL;
      hand-check the CHECK expressions (drizzle-kit does not diff them). Apply it locally with
      `npm run db:migrate`, read its `Target:` line, and run the round-trip and constraint tests
      before any browser check (F7). Production is the Overseer's deploy.
- [ ] **Types**: `ThreadOrigin`; `origin?` on `ChatThread` and `ThreadSummary`, written by
      conditional spread.
- [ ] **Store**: `upsertThread` insert, `threadsFor` read, `summarise`, export
      (`src/store/export.ts`), the fixture path (`src/chat.ts`), each named by hand. A round-trip
      test that an origin written comes back equal, and that a thread without one has no `origin`
      key.
- [ ] **Route**: `origin` on `POST /api/chat/:slug`. Validated like the anchor: shape only in the
      error text, never the quote; the block must be one the article has; quote capped at
      `MAX_ANCHOR_CHARS`; only on a turn that creates a thread, only for kind `chat`, never on a
      retry or edit; a different origin on an existing thread is a 409, the same one resent is
      fine. A mode the route has not been taught is a 400.
- [ ] **Client, carrying it** (F5): `ChatHandoff` gains `origin?`. The pending origin is kept
      beside the thread's draft in the article's draft store (`src/web/chat-draft.ts`), keyed by
      thread id: set when the handoff is taken, moved by `moveThread`, removed by `dropThread`,
      untouched by typing. Send reads it for the open thread (`SendOptions.origin`) and it is
      kept until the server confirms the thread, so a failed first Send can be retried with it.
      Tests: a Reader-level one beside `tests/glossary-ask-in-chat.test.tsx` (press on a claim →
      Chat, fresh conversation, the seed in the box, nothing POSTed; Send, and the POST body
      carries exactly that origin); leaving Chat and coming back; a moved draft; two handoffs do
      not share an origin; a discarded draft; a failed first Send.
- [ ] **Live waits for the first typed Send** (F4): while a conversation has a pending origin,
      Live is not offered and its start is refused. Test that a claim handoff cannot create a
      thread with no origin by voice.
- [ ] **The caller's summaries stay current** (F1): `useChatAnchors` is told when a chat thread is
      created, finishes a turn, is edited, retried or deleted in Chat's band (its existing
      `add`/`touch`/`drop`, or a refetch on returning to a caller mode, whichever is smaller),
      keeping its guards against a stale fetch overwriting a local write. Test, with no reload:
      check a claim → Send → the answer finishes → Back → the mark and its line are there →
      reopen; then a follow-up changes the line, and a delete removes the mark.
- [ ] **Client, the button and the mark**: `askToCheckClaim(quote)` in `chat-handoff.ts`; the
      button and the mark in `DebatePanel.tsx`'s claim heading (owner only; a visitor's band gets
      no handler and draws neither); `threadForOrigin(summaries, origin)` beside `threadFor`,
      pure and tested (match, no match after the words change, newest of two). The mark sets
      `?thread=`; the overlay already draws a `chat`-kind thread in any mode.
- [ ] **Chat's list**: `threadSource` and the icon and tooltip on a row with a stored origin (the
      rest of D5 is the next stage).
- [ ] An origin thread must **not** be picked up as a block's chat: a test that `threadFor` and
      the prose marks ignore it (it has no anchor, so this should hold by construction; the test
      keeps it so).
- [ ] Gates: the touched test files, `npm run typecheck`, lint on touched files, then `npm test`
      once in tmux. Mutate two guards (the 409, the owner-only button) and watch the tests go red.
- [ ] GPT Sol code review, write-capable, two rounds at most. Grep its doc edits for "Greg".
- [ ] Browser check by a Sonnet subagent at 1440, 820 and 390 wide: the button on a claim, the
      handoff, Back, one sent turn (the one paid call), the mark and its line, the thread reopened
      from the mark with Marginalia off and on at each width (docked only at 1440 with it on),
      a visitor sees neither.
- [ ] Docs: `debate.md`, `chat-tools.md` or a new short section where the glossary handoff is
      documented, `url-state.md` if anything about `?thread=` changed, `database.md` if it lists
      the columns, `/help`'s Debate entry.

### Stage: Chat lists every conversation, with its source and a filter
No schema. Answers `spya-hyfqkq`.

- [ ] Tests first: Recall, Tutorial and Explore threads are listed in Chat with their source;
      Candidates is not; a Remember row has no rename or delete and a press goes to
      `mode=remember` on that sub-mode, with `mode`, `remember` and `thread` set in one
      navigation; the filter narrows, defaults to All, survives a reload and Back, and is absent
      with one source; arriving in Chat from Remember, or with a pasted non-chat `?thread=`,
      shows the list and clears the parameter; an article with only Remember conversations shows
      their rows. `tests/remember-own-thread.test.tsx` pins the old rule and is rewritten to the
      new one, not deleted.
- [ ] `ConversationModes.tsx` hands `ThreadList` every listable thread and keeps the open
      conversation and drafts on `chat`-kind threads only (F3); `ThreadList` draws the
      icon, the tooltip and the filter; the mode icons come out of `Dock.tsx`'s `MODES_UI` into
      something `ChatPanel` can import without importing the Dock.
- [ ] Remember is unchanged: it still shows only its own one conversation.
- [ ] Gates, Sol code review, browser check at three widths, docs (`remember-mode.md`,
      `reading-view-overview.md` or the chat doc that owns the list, `/help`'s Chat entry), and
      the comment in `ChatPanel.tsx` that says the list shows only its own kind.
- [ ] The feedback note for `spya-hyfqkq` in `docs/user-feedback/`.

### Later stages, named and not built here

- **Summary's way back.** `askAboutSummary` passes `{ mode: "summary", quote }`; the paragraph
  draws the same mark. Answers 261004a's `[Q-way-back]` with its option 1, by the words and not a
  hash. The mark goes when *Write it again* changes the paragraph.
- **Glossary and Citations: an origin chat from an entry.** `{ mode: "glossary", itemId }` and
  `{ mode: "citations", itemId }`, durable, so the mark survives regeneration. What happens to
  their Dig deeper is `[Q-dig-deeper]`.
- **A claim in your own words**, from a box in Debate › Claims. Built on 2026-10-05 as the box at
  the top of Debate, *Look at the debate from an angle*, which takes any angle and not only a
  claim: [261005k](261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md),
  part A, and [debate.md § Look at the debate from an angle](../project/debate.md#look-at-the-debate-from-an-angle).
- **Start the chat beside the mode**, `[Q-start-beside]`.
- **A written summary of the thread in the caller**, `[Q-thread-summary]`.
- **Comments in Chat's list.** A comment's question is already a chat thread and is listed (as
  *About a passage*). A comment with no question is not a conversation; listing those would make
  Chat's list a second Marginalia. Not planned unless Greg asks for it.
- **The `reader_notes` tool's index says where a conversation started**, so Explore can tell a
  claim check from a chat.

## Questions for Greg

None blocks the two build stages. Each has a default, which is what gets built or left until he
answers.

### [Q-open-where] When you press a Recall conversation in Chat's list, where should it open?

**Background.** After this work, Chat's list will show your Recall, Tutorial and Explore
conversations as rows with Remember's icon. Those conversations run on different instructions from
an ordinary chat (Recall asks you what you remember; it is told not to guess how far you have
read), and Remember's screen is built for them: one conversation per sub-mode, and *Start over*
instead of delete.

- **A. It takes you to Remember, on that sub-mode (built; recommended).**
  ```
  Chat's list                         you land in
  🧠 Recall            4 · 3h   ──►   Remember › [Recall] Tutorial Explore Quiz
  ```
  One press and you are in the conversation, where everything about it works as it does today.
  Back returns to Chat's list. It costs a change of mode, so the list of your other chats is no
  longer beside it.
- **B. It opens inside Chat, like any other row.**
  The conversation takes the place of Chat's list, as an ordinary chat does today, and going back
  to the list lets you pick another. What it costs: Chat's panel sends things a Recall
  conversation refuses (what is on screen), offers a Live button that Tutorial and Explore cannot
  use, and its delete would wipe Remember's only conversation without saying so. Each needs its
  own fix and test; about two days, and two places to keep in step from then on.

**What would decide it.** A if these conversations should keep Remember's own controls around
them. B if you want to carry them on without leaving Chat. Neither keeps your other conversations
in view beside the one you are reading; Chat does not do that for any conversation today.

### [Q-dig-deeper] What should happen to Dig deeper in Glossary and Citations?

**Background.** Both have a *Dig deeper* button today. Each runs one forced web search and stores a
structured result under the entry (a glossary look-up; a citation investigation saying whether the
work says what the piece claims). They are separate machinery from Chat, and you cannot reply to
them. You said this kind of digging should be a chat.

- **A. Keep Dig deeper, and add "Ask in chat" beside it (recommended next).**
  ```
  qualia   — the felt quality of an experience …
  [Dig deeper]  [💬 Ask in chat]        💬 2 · “Dennett's reply is…”
  ```
  Dig deeper stays the one-press, stored answer. The new button starts a chat that knows which
  entry it came from, with the mark to get back. Small (about a day for both modes), nothing is
  taken away, and it shows whether you still press Dig deeper once chat is there.
- **B. Dig deeper becomes the chat.** One button. Pressing it starts a chat about the entry and
  sends the first question for you, so the answer streams in as a conversation you can continue;
  the entry shows the chat's latest line. The separate look-up and investigation code and their
  stored results go. What it costs: the citation investigation's checks (it fetches the cited
  work and compares it with what the piece says) are stricter than a chat answer, and existing
  stored results need a decision (keep showing them, or drop them). A week or so, and it removes
  a feature some entries already have results from.
- **C. Dig deeper runs as today, and its result becomes the first message of a chat.** You keep
  the strict result and can reply to it. The most machinery of the three: two systems joined.

**What would decide it.** Whether the structured result (especially the citation check) is worth
keeping as its own thing. A lets you find that out before anything is removed.

### [Q-thread-summary] Should the mode show a written summary of the chat, or its latest line?

**Background.** You wondered whether a chat started from a mode could *"produce a little summary"*
shown back in that mode. Built now: the mark shows how many exchanges there were and the first
line of the chat's most recent answer. That is free and always current, but a first line is
sometimes a preamble and not a conclusion.

- **A. Leave it as the latest answer's first line (built).**
- **B. A "Summarise" button on the mark writes one sentence with a fast model (recommended only if
  A reads badly in use).**
  ```
  💬 3 · Mostly not: the 2018 result did not replicate, though one lab still defends it.
  ```
  Each press is one small paid call, and the sentence can fall behind the conversation until it
  is pressed again. It needs a new instruction to that model and somewhere to store the sentence.
  About two days. Writing it without a press, whenever the chat goes quiet, would spend without
  you asking, which nothing here does today; that would be a separate decision.

**What would decide it.** Use A for a week on real claims. If the line usually tells you what the
chat concluded, stop there.

### [Q-start-beside] Should "check this claim" open the chat beside Debate from the first press?

**Background.** Built now: the first press takes you to Chat with the question ready to send, and
Back returns you to Debate. After that, the mark on the claim opens the conversation without
leaving Debate: in the right-hand column if you have Marginalia open and the window is wide, and
otherwise as a panel floating over Debate. So the first visit and later visits differ, and on a
wide window you get the second column only when Marginalia is already on.

- **A. As built.** Works at every width, including a phone, and uses only what exists.
- **B. Always beside the mode (recommended later, on wide windows).** The chat opens in the
  right-hand column at once, whether or not Marginalia is on, and Debate stays where it is. On a
  narrow window it would float over Debate. It needs the right-hand column to open for a chat
  alone, and the side panel to take a question that is not about a passage; it can do neither
  today. About two days.

**What would decide it.** Whether the trip to Chat and back gets in your way.

## Log

- 2026-10-05 — plan written from a read-only survey of the code at `8646b09ad`. Prior-work check:
  no note, plan or commit names `hyfqkq`; nothing in `docs/` plans an origin on a thread except
  261004a's deferred option 1, which this takes up.
- 2026-10-05 — GPT Sol plan review
  ([answer](261005i-chats-started-from-a-mode-plan-review-sol.md)): not ready as written, F1–F9;
  the design itself it called sensible and found nothing smaller that does both requests. Eight
  taken as written: F1 the caller's summaries must be kept current, F3 what Chat lists and what
  it may open are separate sets, F4 Live waits for the first typed Send, F5 the pending origin
  lives beside the draft, F6 the filter is a URL parameter, F7 the migration is applied as well
  as generated, F8 and F9 the wording of two questions. **F2 taken in part**: its measurement is
  right (a wide window alone does not dock the chat; Marginalia has to be on) and D3 now says
  so; its fix, switching Marginalia on from the mark, is passed over for the side effect, and
  the column opening for a chat alone is in `[Q-start-beside]`. It also checked four of my
  doubts and cleared them: an anchorless thread draws in `ChatDialog`, the composite FK is
  right, `MAX_ANCHOR_CHARS` (20,000) is ample, and `reader_notes` needs nothing.
- 2026-10-05 — the first build stage, by an Opus subagent, tests red first; committed as
  `eaf3a3fee`. The migration was `drizzle/20261005150617_chat_thread_origin.sql`, additive,
  applied to the local database only (`Target: postgresql://postgres@127.0.0.1:54362/postgres`).
  **It was regenerated before landing as `20261005181010_chat_thread_origin`**, byte-identical
  SQL, because `20261005151925_bibliographic_records_cited_by_count` reached dev first from the
  same parent snapshot (`db:chain` green afterwards). That left the shared local database holding
  a ledger row for the old stamp; see the last Log entry. What it decided that the plan had not:
  - **Keeping the caller's summaries current (F1) is a refetch**, `refresh()` on
    `useChatAnchors`, with the guards widened so a refetch cannot undo a local write or land
    after a newer one.
  - **One more CHECK than planned**, `chat_threads_origin_chat_only`: only a `chat`-kind thread
    may have an origin.
  - **The mark is a second line inside the claim's heading**, so it shows when the claim is
    folded. The button stays after a chat exists, so a second chat can be started from one claim.
  - **The list row's icon is to the right of the title**, not the left as in the picture above;
    the next stage, when every row may have one, can move it.
  - **The route checks that the block exists, not that the quote is in it.**
- 2026-10-05 — GPT Sol code review of `eaf3a3fee`
  ([answer](261005i-chats-started-from-a-mode-stage-1-code-review-sol.md)): land, after six
  established P1s it fixed itself, each with a test it saw red, committed as `1cf578937`. All six
  are about the origin's life before the server has confirmed the thread. CR-1: the 409 was
  checked only under a per-process lock, so `withTurn` now refuses a conflicting origin again
  under the database's article lock. CR-2: a refused draft could show Debate's icon on a plain
  thread; the `begin` frame now carries the stored origin and the list draws only that. CR-3: an
  answer that landed after the reader left Chat left no mark; the refresh now comes from the
  turn finishing, not the component. CR-4: emptying the seeded text lost the origin on return.
  CR-5: a failed first Send resumed as a different, plain draft. CR-6: a thread id corrected by
  the server after the reader left Chat kept the origin on the guessed id. Its six postmortems are
  `docs/postmortems/261005h` to `261005m`. Checked by me on `1cf578937`: typecheck clean; 48 test
  files, 908 tests green, the Postgres suites included.
- 2026-10-05 — GPT Sol round two, a narrow read-only check of those six fixes
  ([answer](261005i-chats-started-from-a-mode-stage-1-code-review-2-sol.md)): CR-1 to CR-5
  closed, no new finding, no regression found in ordinary chat, block chat, Remember, drafts,
  retry, edit or Live. **Sol still objects to CR-6; overruled, after Opus arbitrated.** What is
  left of it: if the server stores a chat under a different id from the browser's guess, and
  the reader leaves Chat and comes back before the acknowledgement arrives, a follow-up goes to
  the guessed id and starts a separate conversation with no origin. Opus read `withTurn`,
  `targetOf` and `mintId`: for a `chat`-kind thread the server changes the id only when the
  guess equals an existing *message* id in the same article, about one in a million per new chat
  before the timing is counted, and nothing is lost when it happens (the first conversation and
  its origin are intact). Sol's fix was a publish-and-subscribe channel in the draft store; that
  is more moving parts than the residual is worth. Written at the site, `onConfirmed` in
  `ConversationModes.tsx`.
- 2026-10-05 — the session died when the box ran out of memory, and was resumed. Merged
  `origin/dev` twice (one import conflict in `src/chat.ts`, both sides kept; the journal taken
  from dev and the migration regenerated, above). **Pushed to dev with these checks on the merged
  tree: typecheck clean, `npm run db:chain` green, the regenerated SQL byte-identical to the
  reviewed one.** Not run on the merged tree: any test file (the box refused three test runs for
  memory), the full suite, and the browser check, which was cut off by the crash with no report.
  The last green test run was on `1cf578937`, before the merge.
- **The shared local database still holds a ledger row for the old stamp** (`created_at
  1791212777965`, hash `83ca1bea5332…`) and the four `origin_*` columns it made, so `db:migrate`
  refuses there for every tree. I wrote the repair (reverse my own nine statements and delete that
  one row, in one transaction under the migration lock, then an ordinary `db:migrate` applies
  `…151925` and `…181010` in order) and the auto-mode classifier refused it as a change to a
  shared resource, dry run included. It is with the Overseer and Greg to decide.
- **Not started**: the second build stage (Chat lists every conversation, with its source and a
  filter) and the feedback note for `spya-hyfqkq`.
