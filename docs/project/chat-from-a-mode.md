# A chat started from a mode

Up: [reading-view-overview.md](reading-view-overview.md)

A button on one item in a mode (a claim, a glossary entry, a cited work, an idea) starts a chat
about that item. The chat stores its **origin**: the mode, and the item by the most durable name it
has. The item then shows a mark in the button's place that reopens the chat beside the mode, and a
second press from anywhere reopens it rather than starting another
([§ One chat per item](#one-chat-per-item)). Chat's list shows the row with the mode's icon, and
the open chat has a line that goes back to the item
([§ The way back from the chat](#the-way-back-from-the-chat)). It is an ordinary chat in every other
way: same prompt, same tools.

> That would mean that a lot of the more advanced functionality for extra
> research/digging/searching could piggyback on the advanced Chat functionality & tools, and enable
> a back and forth with the user. Actually, this is definitely what we want to do.
>
> — Greg, 2026-10-04, in [261005i](../plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md)

> I think we want all of them to be visible from chat, the main chat mode, but perhaps, again, with
> sort of icon annotations and maybe a way in chat to filter to, you know, sort of straight chats
> only or by particular mode or whatever.
>
> — Greg, 2026-10-04 (spya-hyfqkq), same plan

Both are quoted in full at the top of that plan. Three later answers shape what is built. On
Glossary and Citations the chat came first as a second button beside Dig deeper: *"let's start with
adding the "Ask in chat" button"* (Greg, 2026-10-06, [261006d](../plans/261006d-glossary-and-citations-ask-in-chat-with-origin.md)).
The press is the Send: *"When I click "ask in Chat" anywhere, automatically submit the input"*
(Greg, 2026-10-06, [261006j](../plans/261006j-ask-in-chat-sends-the-question.md)). And then Dig
deeper went, and the chat stands in its place: *"I'm tempted to get rid of the dig deeper button and
just replace it with the ask in chat button"* (Greg, 2026-10-09, [261009k](../plans/261009k-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md)). Until 2026-10-09
(plan 261009k) Dig deeper was beside it; kept Dig deeper answers still show, and its server half
remains.

## Which modes have it

| Mode | The button is on | Component | Owning section |
|---|---|---|---|
| Sources › Claims | each claim's heading (icon only) | [`ReceptionAndClaimsPanel.tsx`](../../src/web/ReceptionAndClaimsPanel.tsx) § `ClaimsList` | [reception.md § Check a claim in chat](reception.md#check-a-claim-in-chat) |
| Sources › Reception | the angle box (a *lens*: the reader's words, no item) | [`ReceptionAndClaimsPanel.tsx`](../../src/web/ReceptionAndClaimsPanel.tsx) § `Angles` | [reception.md § Look at the debate from an angle](reception.md#look-at-the-debate-from-an-angle) |
| Glossary | the open entry, in Dig deeper's place | [`OriginChat.tsx`](../../src/web/OriginChat.tsx) § `AskInChatButton` | [glossary.md § Asking about an entry in chat](glossary.md#asking-about-an-entry-in-chat) |
| Glossary | a term's hover card in the prose, and Skim's term chip (which draws the same card), in Dig deeper's place | [`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx) § `TermCard` (`onAskTerm`) | [glossary.md § The hover card](glossary.md#the-hover-card) |
| Sources › Bibliography | the open row, in Dig deeper's place | [`OriginChat.tsx`](../../src/web/OriginChat.tsx) § `AskInChatButton` | [bibliography.md § Ask in chat](bibliography.md#ask-in-chat-a-conversation-about-one-work) |
| Sources › Bibliography | a cited work's hover card in the prose, in Dig deeper's place | [`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx) § `CiteCard` (`onAskCitedWork`) | [bibliography.md § Marked in the prose](bibliography.md#marked-in-the-prose-in-every-mode) |
| Ideas | the open idea, under its passages (since 2026-10-09) | [`OriginChat.tsx`](../../src/web/OriginChat.tsx) § `AskInChatButton`, drawn by [`IdeasPanel.tsx`](../../src/web/IdeasPanel.tsx) § `IdeaRow` | [ideas.md § Asking about an idea in chat](ideas.md#asking-about-an-idea-in-chat) |

The rows and the angle box draw the way back with `OriginChatMark` from the same file; a hover card
draws no mark (it has no room, and the entry or row it opens has one), and its button reopens the
item's chat instead ([§ One chat per item](#one-chat-per-item)). **A hover card's button is
the band's own sender** (`askGlossaryEntryInChat`, `askCitedWorkInChat` in `Reader.tsx`), so a chat
started from a card records the same origin as one started in the band, and finds the same mark.
Owner only: a visitor has no chat.

Timeline, Quotes, FAQ and Skim have no such button (checked 2026-10-09: none of their panels imports
`OriginChat.tsx` or `chat-handoff.ts`). Greg asked for it *"in a citation or perhaps even the
glossary or the ideas or anything like that"* (plan 261009k); the other three wait on a queue item,
and FAQ first needs an id that survives a re-run.

Three things look like this and are not: Summary's *Ask about a paragraph*
([summaries.md](summaries.md#ask-about-a-paragraph-since-2026-10-04)) goes to Chat and stores no
origin (`summary` is reserved in the database CHECK and not built, and since 2026-10-09 the CHECK
`chat_threads_origin_summary` lets it carry none of the shape columns); a chat about a passage has an
*anchor*, not an origin; and a comment's question is linked from the comment's side
([comments.md](comments.md#asking-the-model-and-the-link-back)).

## One chat per item

> I tried clicking Ask in Chat again. I think for the same citation, and I'm 99% sure it somehow
> created a new chat rather than resuming the existing one for that citation. […] Can we get rid
> of the words Ask in Chat and just show the chat icon with a rich tooltip?
>
> — Greg, 2026-10-09 (spya-pdpnjf), in [261010g](../plans/261010g-ask-in-chat-resumes-its-thread-and-becomes-an-icon.md)

Since 2026-10-10:

- **The button is Chat's two bubbles**, its words in a `ControlTip` card (`AskInChatButton`, and the
  hover cards' own). icons.md § Navigation is the rule.
- **The item shows the button or the mark, never both.** With no chat, the button. With one,
  `OriginChatMark` in its place: the same bubbles, the number of questions, and **the chat's gist**
  (`ThreadSummary.gist`, the one line a small model writes after each answer,
  [chat-tools.md](chat-tools.md); the latest answer's opening until there is one), over two lines.
  A press opens the chat beside the mode. A claim's heading button follows the same rule.
- **Every sender reopens before it starts** (`reopenItemChat` in `Reader.tsx`, used by `askEntry`,
  `askWork`, `askIdea`, `checkClaim`): the item's chat is found with `threadForOrigin`, the lookup
  the mark uses, then among the chats the band has begun that the summaries have not heard of yet
  (`handedItemChats`, fed by `onHandoffThread`). A server-corrected id replaces the guess; a refused
  or deleted optimistic thread, and a change of article, removes it. Found: it opens where the mark opens it, or in
  Chat's band from Chat or Learn, and nothing is sent. This is what the hover cards and Skim's chip
  reach, since they draw no mark.
- **A first press still goes to Chat's band**, as before. Reopening keeps the reader in their mode.
- **"One" is a rule of the buttons, not of the database.** Two tabs can still make two chats about
  an item; the mark shows the newest. A reader who wants a fresh one starts a plain chat in Chat.
- **Not the lens** (Sources › Reception's angle box, the reader's own words, where a second angle is
  a second question) and not Summary's paragraph button, which has no origin.

Tests: `has one chat`, `a prose hover card's Ask in chat, on an item that already has a chat`, and
`reopens a chat begun moments ago` in `tests/glossary-and-bibliography-ask-in-chat.test.tsx`.

## The way back from the chat

> The only way to improve this, though, would be if such chats had a way to go back to the mode
> that generated them. … I want to be able to go back to the citations mode, and also sort of
> highlight the, you know, block or whatever that the chat is relevant to.
>
> — Greg, 2026-10-09 (spya-tv6wn5), in [261009k](../plans/261009k-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md)

An open chat in Chat's band that has an origin draws one line above its transcript: the mode's own
icon and *Back to "the item's name" in Mode* (an angle reads *Back to your angle in Sources › Reception*),
clipped on one line. The origin is the stored one, or, before the server has named a fresh thread,
the one waiting beside its draft (`ConversationBand`, `pendingOrigin`). The words are
[`thread-source.ts`](../../src/web/thread-source.ts) § `originBack`; the line is
[`ChatPanel.tsx`](../../src/web/ChatPanel.tsx) § `OriginBack`. Not in Learn, not in the guide, and
not in the floating chat beside a mode, which was opened from the item's own mark.

A press calls `openOrigin` in [`Reader.tsx`](../../src/web/reader/Reader.tsx), one `switch` with a
`never` arm:

| Origin | The press | What the reader sees |
|---|---|---|
| Glossary | `openTermInGlossary` (`?term=`, the gate lowered if it hides the entry) and a focus | the entry open, its row scrolled into view |
| Bibliography | the focus (`citeFocus`) and `showBand`, on Bibliography | the row scrolled into view, the bar lowered if needed |
| Ideas | one push of `mode=ideas&idea=`, and a focus | the idea open, its row in view; not the row press, which jumps the prose |
| Sources › Claims, a claim | one push of `mode=sources&sources=claims` that clears `?bears=` and `?receptionthread=`, and a focus | the claim's row in view, an older search's claim unfolded |
| Sources › Reception, an angle | one push of `mode=sources&sources=reception` | the angles box |

**The way back lands on the item, and the item is one press from its block.** No arm jumps the
prose: on a phone the band lies over it, and the flash would be held until the band moved (GPT
Sol's F4 on the plan). The row's own block link does that, with the phone handling it already has.

**Every arm clears `?thread=` in the same entry.** Left in place, the chat followed the reader into
the mode as the floating card, and on a phone it covered the row the press had gone back to (seen
in the browser pass). Back restores the chat with the rest of the address, and the item's own mark
reopens it beside the mode.

**A focus** is the one-shot that Citations had first (`CiteFocus`), now
[`item-focus.ts`](../../src/web/item-focus.ts) § `ItemFocus` and `useLandOnItem`, one piece of
state per band in `Reader`. The band scrolls the row (`data-term-id`, `data-citation-id`,
`data-idea-id`, `data-claim-key`) into view once it is drawn and hands the request back. **An item
the band no longer has** (an idea paraphrased into a new id, an entry the owner hid) is handed back
at once, and the mode opens on its list. That is best effort and said so: the chat itself is still
in Chat's list.

Tests: the `the way back from a chat to its item` block in
`tests/glossary-and-bibliography-ask-in-chat.test.tsx`, one per origin, a plain chat, a pending
origin, and an item that has gone.

## Adding it to another mode

**Loud** means the compiler, a test or a CHECK constraint stops you. **Silent** means nothing does.
In the order you would do them:

1. **The shape.** [`src/types.ts`](../../src/types.ts) § `ThreadOrigin`: add an arm. An item with a
   durable id copies `GlossaryOrigin` (`itemId` and a name snapshot cut by `originName`). An item
   without one is named by its block and words, like `ClaimOrigin`. **Loud** from here on: steps
   3, 5 and 7 stop compiling; step 6 follows once step 2 is done.
2. **`ORIGIN_MODES`**, same file. **Silent at compile time**: `satisfies` checks what is listed, not
   what is missing. Miss it and the first press gets a 400 from the route.
3. **`sameOrigin`**, same file: how the item finds its chat again. **Loud** (`never`).
4. **The database.** [`src/db/schema.ts`](../../src/db/schema.ts) § `chat_threads_origin_mode`
   lists the allowed words (today `debate`, `summary`, `glossary`, `bibliography`, `ideas`, and
   `citations`, Bibliography's word until 2026-10-09, still admitted until plan 261009w's contract
   migration). **Loud**:
   a word not listed is refused on insert, which the reader sees as a failed first question.
   `chat_threads_origin_item` names `glossary`, `bibliography` (and `citations`) and `ideas` one by
   one. **Silent**: a new
   id-shaped mode left out of it may store half a shape, which then reads back as no origin
   (step 5). Both are a migration: [database.md § A new migration, in five lines](database.md#a-new-migration-in-five-lines);
   copy `drizzle/20261009085926_chat_thread_origin_ideas.sql`, which is the latest.
5. **The columns, both ways.** [`src/thread-origin.ts`](../../src/thread-origin.ts).
   `originColumns` is **loud** (`never`). **`originFromColumns` is silent, and this is the one to
   remember**: it reads a string out of the database, reads a retired word as its successor
   (`RETIRED_ORIGIN_MODES` in src/types.ts), tests for `glossary`, `bibliography`, `ideas` and
   `debate` by hand, and returns no origin for anything else (the `return {}` near its end). Miss it
   and the chat is saved with its origin, reads back as a plain chat, and the item never shows its
   mark. Nothing fails. The export ([`src/store/export.ts`](../../src/store/export.ts)) and the
   test seeder call this file, so they need no edit and inherit the same hole. The check that
   catches it is the round trip in step 11.
6. **The route.** [`src/routes.ts`](../../src/routes.ts) § `parseOrigin`, and § `parseItemOrigin`
   for an id-shaped one (its `mode` parameter is typed to the id-shaped modes). **Loud** once step 2
   is done. Only a claim's block is checked against the article; an `itemId` is never looked up.
7. **The title, the list and the way back.** [`src/chat-title.ts`](../../src/chat-title.ts) §
   `titleFromOrigin`, [`src/web/thread-source.ts`](../../src/web/thread-source.ts) §
   `threadSource` and `originBack`, and `openOrigin` in
   [`Reader.tsx`](../../src/web/reader/Reader.tsx). All **loud** (`never`). The row's icon needs
   nothing: it is the mode's own. **The band's `focus` is silent**: a band that never lands on its
   row still opens the mode, so the rendered-reader test in step 11 has to assert the scroll
   ([§ The way back from the chat](#the-way-back-from-the-chat)).
8. **The filter word.** [`src/web/params.ts`](../../src/web/params.ts) § `CHAT_FROM_WORDS`, then
   `CHAT_FROM_LABEL` in `thread-source.ts`. **Loud**: `ThreadSource.from` will not take a word
   that is not listed, the label is a `Record`, and `tests/thread-source.test.ts` pins the list.
   The `chatfrom` row in [url-state.md](url-state.md) lists the words too. **Silent**.
9. **The question.** [`src/web/chat-handoff.ts`](../../src/web/chat-handoff.ts): a function beside
   `askAboutGlossaryEntry`, using `fencedQuote`, and `itemOrigin` (its `mode` is typed, so
   **loud**). The item's words are the article's or a model's, so they go inside the fence.
10. **The reader and the panel.** [`src/web/reader/Reader.tsx`](../../src/web/reader/Reader.tsx):
    a sender beside `askGlossaryEntryInChat`, wrapped in `reopenItemChat` as `askEntry` is
    (**silent**: an unwrapped sender starts a second chat every press,
    [§ One chat per item](#one-chat-per-item)), and a bundle beside `entryChats`. **Silent**: build
    the bundle from the raw `chatSummaries`, not `chats`, which holds only passage chats, or the
    mark never appears. In the panel, `AskInChatButton`, `threadForOrigin`
    ([`useChatAnchors.ts`](../../src/web/useChatAnchors.ts)) and `OriginChatMark`, one or the
    other, passed through the owner's arm of `access`. The icon rule is [icons.md § A chat is two bubbles](icons.md#a-chat-is-two-bubbles).
11. **The tests to copy.** `tests/thread-origin-way-back.test.ts` (the `describe.each` over
    `glossary`, `bibliography` and `ideas`: `sameOrigin`, and **the columns round trip that covers
    step 5**); `tests/chat-origin-route.test.ts` (the route, the CHECKs, the export);
    `tests/chat-origin-transaction.test.ts`'s `describe.each` (a renamed snapshot, another item,
    another mode); `tests/chat-handoff.test.ts` (the fence, and a long name cut);
    `tests/thread-source.test.ts`; `tests/glossary-and-bibliography-ask-in-chat.test.tsx` (the press,
    the mark, the line back and where it lands, in a rendered reader). Add the new mode to each
    list and watch it go red first.
12. **The docs.** A section in the mode's own doc, a row in the table above, and the `chatfrom`
    row from step 8.

## See also

- [mode.md](mode.md): the general checklist for a mode. This doc is only the chat hand-off.
- [chat-tools.md § Chat's list shows every conversation about the article](chat-tools.md#chats-list-shows-every-conversation-about-the-article):
  the icons, the filter, and what a press on a row does.
- [reception.md](reception.md#check-a-claim-in-chat), [glossary.md](glossary.md#asking-about-an-entry-in-chat),
  [bibliography.md](bibliography.md#ask-in-chat-a-conversation-about-one-work),
  [ideas.md](ideas.md#asking-about-an-idea-in-chat): what each mode's button does for the reader.
- [comments.md](comments.md) and [export.md](export.md): the neighbours that link to a chat or
  carry one out.
- Plans: [261005i](../plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md)
  (the design, D1 to D5, and Greg's answers to its four questions),
  [261005k](../plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md)
  (the lens), [261006d](../plans/261006d-glossary-and-citations-ask-in-chat-with-origin.md)
  (Glossary and Citations), [261006j](../plans/261006j-ask-in-chat-sends-the-question.md) (the
  press sends).
