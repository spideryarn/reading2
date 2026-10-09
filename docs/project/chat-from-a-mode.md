# A chat started from a mode

Up: [reading-view-overview.md](reading-view-overview.md)

A button on one item in a mode (a claim, a glossary entry, a cited work) starts a fresh chat about
that item. The chat stores its **origin**: the mode, and the item by the most durable name it has.
The item then shows a mark that reopens the chat beside the mode, and Chat's list shows the row
with the mode's icon. It is an ordinary chat in every other way: same prompt, same tools.

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
just replace it with the ask in chat button"* (Greg, 2026-10-09, [261009i](../plans/261009i-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md)). Until 2026-10-09
(plan 261009i) Dig deeper was beside it; kept Dig deeper answers still show, and its server half
remains.

## Which modes have it

| Mode | The button is on | Component | Owning section |
|---|---|---|---|
| Debate | each claim's heading (icon only) | [`DebatePanel.tsx`](../../src/web/DebatePanel.tsx) § `ClaimsList` | [debate.md § Check a claim in chat](debate.md#check-a-claim-in-chat) |
| Debate | the angle box (a *lens*: the reader's words, no item) | [`DebatePanel.tsx`](../../src/web/DebatePanel.tsx) § `Angles` | [debate.md § Look at the debate from an angle](debate.md#look-at-the-debate-from-an-angle) |
| Glossary | the open entry, in Dig deeper's place | [`OriginChat.tsx`](../../src/web/OriginChat.tsx) § `AskInChatButton` | [glossary.md § Asking about an entry in chat](glossary.md#asking-about-an-entry-in-chat) |
| Glossary | a term's hover card in the prose, and Skim's term chip (which draws the same card), in Dig deeper's place | [`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx) § `TermCard` (`onAskTerm`) | [glossary.md § The hover card](glossary.md#the-hover-card) |
| Citations | the open row, in Dig deeper's place | [`OriginChat.tsx`](../../src/web/OriginChat.tsx) § `AskInChatButton` | [citations.md § Ask in chat](citations.md#ask-in-chat-a-conversation-about-one-work) |
| Citations | a cited work's hover card in the prose, in Dig deeper's place | [`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx) § `CiteCard` (`onAskCitedWork`) | [citations.md § Marked in the prose](citations.md#marked-in-the-prose-in-every-mode) |

The rows and the angle box draw the way back with `OriginChatMark` from the same file; a hover card
draws no mark (it has no room, and the entry or row it opens has one). **A hover card's button is
the band's own sender** (`askGlossaryEntryInChat`, `askCitedWorkInChat` in `Reader.tsx`), so a chat
started from a card records the same origin as one started in the band, and finds the same mark.
Owner only: a visitor has no chat.

Timeline, Ideas, Quotes, FAQ and Skim have no such button (checked 2026-10-07: none of their panels
imports `OriginChat.tsx` or `chat-handoff.ts`). Nobody has asked for one there.

Three things look like this and are not: Summary's *Ask about a paragraph*
([summaries.md](summaries.md#ask-about-a-paragraph-since-2026-10-04)) goes to Chat and stores no
origin (`summary` is reserved in the database CHECK and not built); a chat about a passage has an
*anchor*, not an origin; and a comment's question is linked from the comment's side
([comments.md](comments.md#asking-the-model-and-the-link-back)).

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
   lists the allowed words (today `debate`, `summary`, `glossary`, `citations`). **Loud**: a word
   not listed is refused on insert, which the reader sees as a failed first question.
   `chat_threads_origin_item` names `glossary` and `citations` one by one. **Silent**: a new
   id-shaped mode left out of it may store half a shape, which then reads back as no origin
   (step 5). Both are a migration: [database.md § A new migration, in five lines](database.md#a-new-migration-in-five-lines);
   copy `drizzle/20261006042012_chat_thread_origin_item.sql`.
5. **The columns, both ways.** [`src/thread-origin.ts`](../../src/thread-origin.ts).
   `originColumns` is **loud** (`never`). **`originFromColumns` is silent, and this is the one to
   remember**: it reads a string out of the database, tests for `glossary`, `citations` and
   `debate` by hand, and returns no origin for anything else (the `return {}` at line 70). Miss it
   and the chat is saved with its origin, reads back as a plain chat, and the item never shows its
   mark. Nothing fails. The export ([`src/store/export.ts`](../../src/store/export.ts)) and the
   test seeder call this file, so they need no edit and inherit the same hole. The check that
   catches it is the round trip in step 11.
6. **The route.** [`src/routes.ts`](../../src/routes.ts) § `parseOrigin`, and § `parseItemOrigin`
   for an id-shaped one (its `mode` parameter is typed to the two modes). **Loud** once step 2 is
   done. Only a claim's block is checked against the article; an `itemId` is never looked up.
7. **The title and the list.** [`src/chat-title.ts`](../../src/chat-title.ts) § `titleFromOrigin`
   and [`src/web/thread-source.ts`](../../src/web/thread-source.ts) § `threadSource`. Both
   **loud** (`never`). The row's icon needs nothing: it is the mode's own.
8. **The filter word.** [`src/web/params.ts`](../../src/web/params.ts) § `CHAT_FROM_WORDS`, then
   `CHAT_FROM_LABEL` in `thread-source.ts`. **Loud**: `ThreadSource.from` will not take a word
   that is not listed, the label is a `Record`, and `tests/thread-source.test.ts` pins the list.
   The `chatfrom` row in [url-state.md](url-state.md) lists the words too. **Silent**.
9. **The question.** [`src/web/chat-handoff.ts`](../../src/web/chat-handoff.ts): a function beside
   `askAboutGlossaryEntry`, using `fencedQuote`, and `itemOrigin` (its `mode` is typed, so
   **loud**). The item's words are the article's or a model's, so they go inside the fence.
10. **The reader and the panel.** [`src/web/reader/Reader.tsx`](../../src/web/reader/Reader.tsx):
    a sender beside `askGlossaryEntryInChat`, and a bundle beside `entryChats`. **Silent**: build
    the bundle from the raw `chatSummaries`, not `chats`, which holds only passage chats, or the
    mark never appears. In the panel, `AskInChatButton`, `threadForOrigin`
    ([`useChatAnchors.ts`](../../src/web/useChatAnchors.ts)) and `OriginChatMark`, passed through
    the owner's arm of `access`. The icon rule is [icons.md § A chat is two bubbles](icons.md#a-chat-is-two-bubbles).
11. **The tests to copy.** `tests/thread-origin-way-back.test.ts` (the `describe.each` over
    `glossary` and `citations`: `sameOrigin`, and **the columns round trip that covers step 5**);
    `tests/chat-origin-route.test.ts` (the route, the CHECKs, the export);
    `tests/thread-source.test.ts`; `tests/glossary-and-citations-ask-in-chat.test.tsx` (the press,
    the mark, the way back, in a rendered reader). Add the new mode to each list and watch it go
    red first.
12. **The docs.** A section in the mode's own doc, a row in the table above, and the `chatfrom`
    row from step 8.

## See also

- [mode.md](mode.md): the general checklist for a mode. This doc is only the chat hand-off.
- [chat-tools.md § Chat's list shows every conversation about the article](chat-tools.md#chats-list-shows-every-conversation-about-the-article):
  the icons, the filter, and what a press on a row does.
- [debate.md](debate.md#check-a-claim-in-chat), [glossary.md](glossary.md#asking-about-an-entry-in-chat),
  [citations.md](citations.md#ask-in-chat-a-conversation-about-one-work): what each mode's button
  does for the reader.
- [comments.md](comments.md) and [export.md](export.md): the neighbours that link to a chat or
  carry one out.
- Plans: [261005i](../plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md)
  (the design, D1 to D5, and Greg's answers to its four questions),
  [261005k](../plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md)
  (the lens), [261006d](../plans/261006d-glossary-and-citations-ask-in-chat-with-origin.md)
  (Glossary and Citations), [261006j](../plans/261006j-ask-in-chat-sends-the-question.md) (the
  press sends).
