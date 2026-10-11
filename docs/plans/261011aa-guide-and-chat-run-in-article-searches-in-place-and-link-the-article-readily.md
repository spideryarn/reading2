# 261011aa — The guide and Chat run in-article searches in place, and link the article readily

Owned by [plans.md](../project/plans.md). Overseer queue item `qi-zwddnfs9`; reports `spya-mpg67x`
(#569, SPIDERYARN-READING2-HK) and `spya-ma72mx` (#572, SPIDERYARN-READING2-HP), both Greg's
(`feedback-reporter.ts` exit 0). Session `fbmpg67x-guide-block-links-and-searches`.
**Status: built; GPT Sol on the plan ([review](261011aa-plan-review-sol.md), "build with these changes") and the code ([review](261011aa-code-review-sol.md), "ship after my fixes"); seen in a browser; on `dev`, not deployed.**

## What Greg asked for

> Can you have a look at the guide chat for this? As you can see, the response from the Live AI was
> a bit frustrating. It didn't seem to understand what I meant about show me links. I meant links
> within the article, usually. And though, you know, sometimes one might ask for links on the web,
> but I think people will be more explicit. But the main thing is it didn't produce block links to
> the article readily, which is a big part of what we want the guide chat to do, or any other
> tools. I mean, it could have offered to create a search for me or something like that.
>
> — Greg, 2026-10-11, `spya-mpg67x`

> In this guide chat, I asked it to run some searches for me, and it said it couldn't. I want it to
> be able to. In an ideal world, it would rather, yeah, I think I wanted a little bit of UI that
> would show, okay, this is the search text that I'm about to run. Click this button to initiate
> it, or something. I mean, or maybe it would start them automatically and provide a link to them.
> It shouldn't take me to the search mode because that's really disorienting, and I might want to
> search for multiple things, and it should be able to initiate searches.
>
> — Greg, 2026-10-11, `spya-ma72mx`

## What the thread shows

Greg asked us to look at the thread (`spya-sv7rg7` on the Rhizome article), so it was read, inside
`begin read only`. Six answers, four spoken (GPT-Live) and two typed (Opus):

| # | Greg said | The guide did | What went wrong |
|---|---|---|---|
| 1 | why he is reading | spoke, `show_passage` on map-vs-tracing | fine |
| 3 | "Can you provide links to them" | asked: highlighted passages, or external links? | asked instead of pointing |
| 5 | "No, to this article within this article" | called `article_links`: "There aren't links inside the article" | read "links" as the article's own hyperlinks |
| 7 | "I mean block links" | `show_passage` on the same two blocks: "Here are the block links" | one passage, the same one again |
| 9 | (typed) "Show me block links to the article." | three block links, then *"I've taken you to the first of the three"* and a `jump-first` button | gave links; then claimed a move it never made |
| 11 | (typed) "Can you create some searches as well, please?" | *"I can't save searches for you"*, a `quick-search` and a `find` button, and next-step searches | the buttons existed, but every one of them **leaves the chat for Search mode**, and the first sentence reads as a refusal |

So two things are true at once. The typed guide could already *offer* a search, as a button
(`[cmd:quick-search:…]`, and `search` in `offer_next_steps`). But pressing it does what the
command bar's row does — puts the words in Search's box and switches the band to Search mode
(`quickSearchPress`, `src/web/command-runners.ts`) — which is exactly what Greg calls
disorienting, and with which he can't keep several going while staying in the conversation. And
the model's words around it said it could not.

## What we will build

### 1. A search button in a chat answer runs the search there, and shows what it found there

The proposal stays a proposal: the button shows the words, the reader presses it (Greg's first
shape — *"this is the search text that I'm about to run. Click this button to initiate it"*), and
it goes through `chipFor` at the draw and again at the press, as now. What changes is what the
press does **in a chat surface** (Chat, the guide, the passage chat dialog, and the guide's next
steps): it starts the search without leaving the conversation, and the button's place becomes a
small result:

```
  Quick search “centred versus acentred systems” ✳          ← the button, as today
        │ press
        ▼
  ⌕ “centred versus acentred systems” · searching…
        │ ~1 s
        ▼
  ⌕ “centred versus acentred systems” · 6 passages · Open in Search ↗
     [¶ 12] [¶ 14] [¶ 15] [¶ 31] [¶ 33] [¶ 40]               ← block links, the same chips as
                                                               an answer's citations (BlockRef):
                                                               hover shows the paragraph, press
                                                               jumps the article, chat stays
```

- **Quick search, as the button already says.** `POST /api/search/<slug>` with `kind: "quick"` —
  the same route, the same saved row (`search_runs`), the same cost category. So the search is in
  Search mode's list afterwards, and *Open in Search* opens it there (`?mode=search&runs=<id>`):
  the link Greg's second shape asks for, which the reader follows only if they want to.
- **Several at once**: each button is its own card with its own request; nothing is shared but the
  route, which already takes several (`search.md § Several searches at once`).
- **An exact-words `find` button** in a chat answer does the same, and costs nothing: the blocks
  holding those words, counted and chipped in place (`findLiteral`, `src/web/search-hits.ts`, the
  matcher Search's words box uses), with *Open in Search* to the `?find=` view it opened before.
- **A reload keeps the answer.** A card looks for a finished saved search with the same words and
  kind in the article's list (one `GET /api/search/<slug>` per article per page, shared by every
  card) and draws it as found. That read spends nothing and writes nothing, so the rule that a
  model's words never run anything still holds; without it, every reload would put the button back
  and a second press would pay again for a saved answer.
- **The command bar's own *Quick search* row is unchanged**: there the reader asked for Search
  mode.

Code: a new `src/web/ChatSearchCard.tsx` (the card and its tiny client: POST, read `begin`/`hit`/
`done` with the shared `readEvents`, draw), and a per-slug list read beside it. `CommandChip.tsx`
draws the card for a `quick-search` or `find` chip when it is inside a chat surface that provided
the card's context (Reader.tsx, around chat and the dialog). **`chat-commands.ts` and
`command-proposal.ts` are not touched**: they are a defence (security-map.md), and nothing here
widens what a token may become.

### 2. The prompts: "links" means block links, and you can start searches

- **Typed guide** (`GUIDE_SYSTEM`, `src/converse.ts`): when the reader asks for links, they mean
  places in this article — cite the blocks, without asking which kind; the article's own
  hyperlinks only when they say so, the web only when they say so (Chat for that). When they ask
  for searches, offer them as buttons: *pressing one runs it here and lists what it finds*. Never
  say you cannot search the piece, and never say you have taken them anywhere — a jump is a button
  they press.
- **Chat's `COMMAND_CHIPS`**: the `find` and `quick-search` lines say what the press now does
  ("shows them here, under your answer").
- **The spoken guide** (`SPOKEN_GUIDE`, `src/live.ts`): asked for links, or to show them where, call
  `show_passage` with every passage that answers — up to its limit — rather than asking which kind
  of link or looking at the article's own hyperlinks; the article's hyperlinks only when they say
  so. Asked to search, use the article search tool it already has (`GUIDE_TOOLS`) and point at
  what it finds with `show_passage`. A voice has no buttons, so it does the looking itself; that
  costs what a guide tool call already costs and saves nothing.

### 3. Docs

chat-tools.md (§ Command buttons, § The guide), search.md (a short section: searches started
from chat), live-conversation.md (the spoken guide's links and searches), the user-feedback note.

## Simpler options passed over

- **Prompt only** — tell the guide to offer search buttons more readily. It already offered them;
  the press is what Greg objects to. Not enough.
- **Auto-run the searches** (Greg's second shape). Every model-written button is pressed by the
  reader (261011m reversed the last exception, on Greg's report), and a search spends. A press is
  one click and shows the words first, which is his first shape.
- **Keep the press, but open Search mode in a new tab or split.** Still leaves the conversation.

## Deferred — all three are Overseer queue item `qi-dhy8q2nq`

- **The thorough search after the quick one, in the chat card.** Search mode runs it by itself
  (`auto-thorough.ts`, Greg 2026-10-04). In chat the card offers *Open in Search*, where the
  row's *thorough* button is. Wiring the upgrade into the card is a second lane of state; worth it
  if the quick results in chat prove thin.
- **One search client for Search mode and chat** (Sol's F1), so a Search band already on screen
  hears of a chat's search at once.
- **Marks in the article for a chat search.** The chips jump; the bars down the matched paragraphs
  are Search mode's (it owns `Found[]` for the prose).

## GPT Sol's plan review, and what we did with it

[The review](261011aa-plan-review-sol.md) ([prompt](261011aa-plan-review-prompt.md)): *"build with
these changes"*.

- **F1 (high) — two search clients, the card's and Search mode's `useSearch`.** True, and narrower
  than it reads: one mode band is on screen at a time, so the two meet only when the passage chat
  dialog is open over Search, or when the reader opens Search in the second a quick search takes.
  Then Search does not show the chat's search until it next loads its list. Lifting one `useSearch`
  into Reader for both is a refactor of Search mode (its auto-thorough lane, renames, colours) out
  of proportion to that window. **Not done; written down in search.md § Searches started from a
  chat, and deferred below.** The card's own state does not have the late-GET erasure problem:
  the saved list only fills in for a search this tab has not started.
- **F2 — the stream protocol.** Covered: the id is minted per press, the link uses `done`'s id,
  `done` replaces what streamed, a `done` with an error is shown as an error, the request is bound
  to the reader at the press (`useMadeFor`), and the request lives in a store outside the card
  (`chat-searches.ts`), so a redraw neither loses nor repeats it. A deletion that ends the stream
  without `done` shows "The search stopped arriving" and the button again.
- **F3 — reusing a saved answer, and staleness.** The saved list sends no fingerprint, and the
  client cannot compute one (`hashBlocks` is `node:crypto`). Adding it to the GET would also
  change Search mode's own stale labels, an open item of its own. So: reuse only a `done`, `quick`
  run with the same words (case and spacing aside — the result is the same search), the newest;
  only while every passage it found is still in the article; and say the day it was found.
- **F4 — prompts.** Taken: the typed guide is told its own search tools do not make a search the
  reader can see and are no substitute for the buttons; the spoken lines name no tool; the chat
  card's hover text no longer says "Search mode" (overridden in the card, so `command-proposal.ts`
  is untouched).
- **F5** — agreed, nothing to change. **F6** — find's hits are one per block, counted once, and
  the quick link carries `match=quick`. **F7** — the tests below take the cases that apply to
  what was built.

## Tests

- A failing test first: a `quick-search` chip pressed in a chat surface does not change the mode
  and posts to the search route (the old press switched to Search).
- The card: begin/hit/done drawn as chips; an error drawn as a line with a retry; a finished saved
  run with the same words drawn without a press; two cards in one answer run independently.
- `find` in place: the count and chips match `findLiteral`.
- The prompt tests: `tests/chat-command-chips-prompt.test.ts` still passes every token through the
  parser; a guide prompt test pins the "links means blocks" and "the press runs it here" lines.
