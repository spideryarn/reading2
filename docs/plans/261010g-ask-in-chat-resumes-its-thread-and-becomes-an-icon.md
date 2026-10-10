# 261010g — Ask in chat resumes its thread, shows one exists, and becomes an icon

Up: [plans.md](../project/plans.md) · reports spya-pdpnjf (#526, SPIDERYARN-READING2-G6) and
spya-fy05y6 (#527, SPIDERYARN-READING2-G7) · queue item `qi-brd4e34k` · builds on
[261009k](261009k-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md) · the
checklist is [chat-from-a-mode.md](../project/chat-from-a-mode.md) · folds in `qi-bd6h2fnd`
(Timeline and Quotes; FAQ stays queued) and Ask in chat's row of `qi-zkt2mtf9`

**Status: Stage 1 built and on `dev`, not deployed. Stage 2 (Quotes and Timeline) deferred to
`qi-bd6h2fnd`, with GPT Sol's three findings on it (§ Stage 2).**

## What Greg asked for

> I was looking at a citation in the bibliography submode, and I clicked Ask in Chat. It triggered
> a chat. I had a conversation. Great. And there's a button to take me back to the citation in
> bibliography submode. Great. Firstly, when I went back to the bibliography submode, I think I was
> hoping that it would somehow show that there was a chat to see, and maybe even better still, a
> short summary of the chat. Perhaps it could get generated as needed. And then, like I say, there
> should be a way to get back to the chat that we've already created for that citation. I tried
> clicking Ask in Chat again. I think for the same citation, and I'm 99% sure it somehow created a
> new chat rather than resuming the existing one for that citation.
>
> And then beyond just this case, look for anywhere else where we have an Ask in Chat button […]
> And any time we want this kind of same idea of Ask in Chat takes you to a chat thread, there's a
> way to get back. Ideally then there's a summary of the chat thread in that caller mode, and then
> you can also go from the caller mode to the chat, and it sort of indicates that there is an
> existing chat. And maybe we make a minimal note in the docs for mode.md or wherever about this
> pattern.
>
> And if you think there's other places that would benefit from an ask in chat button, add them.
>
> One more thing, don't we have a policy to prefer icons rather than text labels? Can we get rid of
> the words Ask in Chat and just show the chat icon with a rich tooltip?
>
> — Greg, 2026-10-09 (spya-pdpnjf)

> I think I might have been accidentally looking at the wrong citation in the UI, so it may be that
> some of that is already implemented. I think some of that report still is worth considering, but
> maybe the missing functionality and UI machinery is mostly there after all...
>
> — Greg, 2026-10-09 (spya-fy05y6), a minute later

## What is there already (read on `262f9f674`)

- **The way back from the chat**: built by 261009k. *Back to "…" in Bibliography* above the
  transcript.
- **A sign the item has a chat**: built. `OriginChatMark` (OriginChat.tsx) on a Glossary entry, a
  Bibliography row, an open idea and a claim: Chat's two bubbles, the number of questions, and how
  the latest answer begins, in the model's face. A press opens the chat beside the mode. That last
  line is the nearest thing to the "short summary"; #527 is probably this.
- **What is not built, and is the bug**: pressing *Ask in chat* again on an item that has a chat
  starts a second chat. Every item sender goes straight to `handToChat`, which always makes a fresh
  thread (Reader.tsx, `askGlossaryEntryInChat`, `askCitedWorkInChat`, `askIdeaInChat`,
  `checkClaimInChat`). The gutter's passage chat already does the right thing (`chatAboutBlock`
  reopens `threadFor(chatSummaries, blockId)`), so this is the item senders catching up.
- **The words**: the band's `AskInChatButton` says *Ask in chat* beside its icon; the two hover
  cards' buttons do too. A claim's button is already icon-only.

## The change

### Stage 1 — one chat per item, one control per item, an icon

**D1. The item senders resume.** Each of the four senders first looks for the item's chat with
`threadForOrigin(chatSummaries, origin)`, the lookup the mark already uses. Found: open it, and send
nothing. Not found: today's fresh chat, sent. One helper in Reader (`askOrReopen`) so the four do
not each grow the branch. This covers the band's buttons, both prose hover cards and Skim's term
chip, because they all call these senders.

Where the reopened chat appears is where the mark opens it: beside the mode, through
`openClaimChat` (`?thread=`, the floating or docked card). In Chat and Learn the floating card is
suppressed, so there it goes into Chat's band, `openAskedFromDrawer`'s rule. So an item's *existing*
chat has one destination, whichever control reached it. **A first press is different, on purpose**:
it goes to Chat's band, as it always has, because the reader is starting a conversation and is
about to read an answer. Reopening from the item keeps them in the mode they were in. (GPT Sol's F3
asked for this asymmetry to be chosen rather than slipped past.)

**And a chat begun moments ago** (Sol's F1, High). `chatSummaries` are re-read when the reader
leaves Chat or a turn settles, so a second press inside that window found nothing and began a
second chat. The band already reports the thread it began (`onHandoffThread`, again with the
server's id if that is corrected); Reader keeps those in a ref, consults them after the summaries,
and drops each once the summaries carry its id. Test: summaries frozen, a band press, then a hover
card press while still in Chat.

"One chat per item" is a rule of these buttons, not of the database (Sol's F2): two tabs can still
make two. The mark then shows the newest, as before.

*Not* the lens (Sources › Reception's angle box): that is the reader's typed words, and a second
angle is a second question. Not Summary's paragraph button, which has no origin
([chat-from-a-mode.md](../project/chat-from-a-mode.md) § Which modes have it).

**D2. One control per item in the band.** With no chat, the item shows the icon-only *Ask in chat*.
With a chat, it shows only the mark, which is the same two bubbles plus the count and the latest
answer's opening, and whose press opens that chat. Drawing both would be two chat icons side by side
that now do the same thing. Applies to Glossary, Bibliography, Ideas and a claim's heading.

Given up: a second, fresh chat about the same item from the item. A reader who wants one starts a
plain chat in Chat. The simpler option passed over is keeping both controls (Ask reopening, the mark
opening); it costs a duplicate icon on every row with a chat.

**D3. Icon only, with a rich tooltip.** `AskInChatButton` drops the words: an `icon-sm` ghost
`Button` with `MessagesSquare`, the label as `aria-label`, and a `ControlTip` card (head: *Ask about
this work in chat*; what: one question about it, answered from the article and the web; press:
*Opens a new chat and asks straight away.*). icons.md § Navigation already says this (a control that
takes you somewhere is an icon), and Greg's report is the say `qi-zkt2mtf9` was waiting for on this
button.

The two prose hover cards' buttons drop the words too, and get the same `ControlTip` card, not a
`title` (Sol's F4: tooltips.md calls `title` a regression, and it does not exist on a touch device).
Its second line says the press reopens the chat if there is one, since a card draws no mark.

**D4. The summary: the gist that is already there.** The first draft deferred this as a new model
call, a cache and a column. Sol's F5: every chat already has one. Since plan 261008e a small model
writes `chat_threads.gist` after each finished answer, one line on what the whole conversation
covered, for the reader's *other* conversations to read; it was "never shown on screen *in this
version*". This shows it: `summarise` (src/routes.ts) puts it on the thread summary, and
`OriginChatMark` draws it in place of the latest answer's opening, over two lines, falling back to
the opening until the first gist lands or after an edit clears it. No new call, no new cost. It is
the reader's own conversation shown to the reader, drawn as text in the model's face.

**D5. The docs.** chat-from-a-mode.md gets the rule (*an item has at most one chat reached from it;
Ask reopens it*) and the D2 control swap. mode.md gets one line pointing at it, as Greg asked.

### Stage 2 — Ask in chat on Quotes and Timeline (deferred)

**Deferred to `qi-bd6h2fnd`, not built here.** Sol's review found it larger than the paragraph
below says, and one part of it collides with work already queued:

- **F7, the migration.** `chat_threads_origin_mode` and `chat_threads_origin_item` still admit the
  retired `debate` and `citations` until plan 261009w's contract migration (`qi-mzfxw3q2`, queued)
  narrows them. Whichever of the two lands second must keep the other's words. Two sessions
  editing one CHECK in parallel is the thing to avoid.
- **F6, landing on the row.** `?quote=` alone does not land: a quote under the threshold bar has its
  selection cleared unless `reveal()` lowers the bar (useQuoteMarks.ts). Timeline rows have no
  `data-event-id` and no focus. Each needs an `openOrigin` arm and a `useLandOnItem` focus, tested
  on a hidden quote and an off-screen event.
- **F8, ids.** Both inherit ids only on an exact match (a quote's block and normalised words; an
  event's cited blocks and date), so the stale-origin fallback (open the list, land on nothing) has
  to be tested for both.

What follows was the plan, kept for that session.

Greg: *"if you think there's other places that would benefit from an ask in chat button, add
them."* `qi-bd6h2fnd` already chose them: Quotes and Timeline both inherit ids across re-runs
(`src/quotes.ts` § `inheritIds`, `src/timeline.ts` § `inheritIds`), which is what a chat needs to
find its item again. FAQ stays queued: its ids are minted fresh each run.

Each is the twelve steps of [chat-from-a-mode.md § Adding it to another mode](../project/chat-from-a-mode.md#adding-it-to-another-mode),
with one additive migration widening `chat_threads_origin_mode` and `chat_threads_origin_item` to
`quotes` and `timeline`. The question: a quote is the article's words (fenced) and *why does this
passage matter to the argument?*; an event is its label and date (fenced) and *what happened here,
and how does it bear on the piece?* The way back opens the mode with `?quote=` / `?event=` and lands
on the row, as Ideas does.

Stage 2 lands separately, after Stage 1, so a problem in one does not hold the other.

## Tests

- Stage 1, red first: in `tests/glossary-and-bibliography-ask-in-chat.test.tsx`, an item whose
  summary already carries its origin: pressing the hover card's Ask opens `?thread=<that id>` and
  posts nothing; the band row draws the mark and no Ask button. The same for a claim.
- Stage 2: the lists in step 11 of the checklist, with `quotes` and `timeline` added and seen red.
- Browser: a Sonnet subagent on the box, on Bibliography: ask, go back, see the mark and no Ask,
  press a cited-work hover card's icon and land on the same chat.

## Review

GPT Sol on this plan (read-only), and on each stage's code.
