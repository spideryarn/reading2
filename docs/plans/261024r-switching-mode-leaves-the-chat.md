# Switching mode leaves the chat

Up: [plans.md](../project/plans.md) · report `spya-mj4b56` (#696)

> If I'm in a chat mode of any kind and then switch mode, the chat appears suddenly separately as a
> kind of dialog box or panel somehow. I don't think that's helpful. If I switch modes, I've switched
> away from it.
>
> — Greg, 2026-10-24 (admin report, filed from
> `?mode=summary&summary=fuller&sources=investigate&…&margin=1`)

## What happens now, and why

`?thread=` names the open conversation and `mode` says where it is drawn
([url-state.md § One conversation id](../project/url-state.md#one-thread-id)). In Chat it is the
band; in every other mode bar Learn it is the floating chat (`ChatDialog`: docked in the right-hand
column, a card in the Marginalia column, or a floating panel), decided by `overlay` in
[`Reader.tsx`](../../src/web/reader/Reader.tsx). A mode switch writes `mode` and nothing else, so
the conversation follows the reader into the new mode. That was the design — the doc says *"leaving
chat mode puts the panel back where the reader left it, for free"* — and it is what Greg is
reporting. His URL says he was in Sources › Investigate, whose conversation *is* that floating chat,
and went to Summary; the same happens leaving Chat with a conversation open, and with any chat
opened beside a mode (a block's chat, an item's mark).

`chatDraft` (an unsent block chat, component state) also follows: `overlay` is `chatDraft ?? thread`.

## The change

**A reader's mode switch closes the floating chat, in the same pushed history entry**: `?thread=`
cleared and `chatDraft` dropped. One rule, at the two places a reader's switch is decided:

- `onDockMode` — the Dock's buttons, the command bar's mode and sub-mode rows, a chat chip's mode
  proposal (they all go through it). Every branch that actually navigates: to another mode, a
  sub-mode row, Plain, the second press that closes a band. Not a press on the mode already open
  (which only brings a stepped-aside band back). Marginalia normally changes no band; on a narrow
  window its press swaps a band out for the notes, so that branch is a mode switch and closes chat.
- `showBand(target)` when `target !== mode` — the prose cards' *open in Glossary / Quotes*, the
  search opener.

**Except when the destination is Chat**, which draws that very conversation in its band: *Open in
full chat* is `setMode("chat")` and stays so, and pressing Chat with a floating chat open shows it
full width. Every hand-off into Chat (`showBand("chat")`) is unchanged.

**Not a sub-mode change inside the mode you are in** (Investigate → Claims, Brief → Fuller),
whether from the band's own toggle or the command bar's row: the reader is still in that mode, and
the band's toggles write their own parameter directly, so a rule that reached only the command
bar's row would make the same move behave two ways (GPT Sol's F3). A sub-mode row of *another* mode
is a mode switch.

**The Skim stop cards' *open in Ideas / Timeline*, and a broken mode's *back to the article*** write
`mode` directly; they go through the same helper (F2).

Navigations that already decide `?thread=` themselves keep their one combined URL write:
`openOrigin` (every arm but the lens chooses no thread; the lens keeps its thread on purpose,
spya-nhwy3d), `openBibliographyWork`, `openFindingInSources`, `openQuizAt`, and a Learn row in Chat's
list. When one changes the top-level mode it separately closes any unsent passage target; its
chosen destination thread is left intact. A Sources sub-mode change keeps the passage target too.

**A half-typed passage question is kept** (F1). An unsent block chat's words lived only in
`ChatDialog`'s state, so closing it for a mode switch would throw them away. They now go into the
article's draft store ([`chat-draft.ts`](../../src/web/chat-draft.ts)), keyed by the block, beside
a conversation's unsent words, and the block's chat button brings them back.

**Arriving on Investigate opens its newest conversation** (`InvestigatePanel`'s arrival, when
nothing is open beside the mode). That is unchanged and is not the old chat following you: it is
Investigate's own (F4).

Back still restores the conversation with the rest of the address, so nothing is lost: the chat is
in Chat's list, an item's mark reopens it, Investigate's arrival opens its newest conversation, and
Learn's two open their own.

### What it gives up

- **Chat → another mode → Chat** now lands on Chat's list rather than the conversation, unless the
  reader left words in its box (the 261004j drafts rule reopens that one). One press on the row. A
  remembered "last chat" would keep it, at the cost of a second piece of state that can disagree
  with `?thread=`; not doing that unless Greg asks.
- **A chat chip proposing a mode** (*"open Glossary"*) now closes the chat that proposed it. Same
  rule: the reader switched mode. Back returns to it.

### Simpler option passed over

Suppressing the overlay in the new mode while leaving `?thread=` in the address. Fewer lines, but it
leaves a conversation selected and invisible, the state url-state.md defines away for Quiz, and a
pasted link with `?thread=` would no longer open its chat.

## Mechanics

`setThread(null)` in the same tick as the mode write. nuqs merges queued updates into one history
call and a `push` in the queue wins (`debounce-*.js`, `if (options.history === "push")`), so this is
one entry and one Back — the same reliance `askPassageInChat`'s caller already makes. A named
helper, `leaveTheChat(target)`, so the call sites cannot drift. Plan reviewed by GPT Sol
(F1–F4, all taken).

## Tests

Reader-level, in the `reader-reading-harness` composition (as `chat-dock-wiring.test.tsx`): an
owner with a floating chat open, then a Dock mode press → `ChatDialog` gone and `thread` absent from
the address in one history entry; Back → it returns; press Chat → still open (in the band, `thread`
kept); a press on the mode already open → still open. Red first.

## Docs

url-state.md § One conversation id (the table's "set / no" row and the *for free* sentence),
chat-from-a-mode.md (*the floating chat beside a mode*), and the comment on `overlay`.

## Built

Code review by GPT Sol (fixes made in the stage): the same close on the item modes' own
navigations, Chat → a Learn row, and the narrow-window Marginalia swap, each closing only the
passage draft where the navigation already decides `?thread=`; the passage composer keyed by its
block, so a second passage does not show the first one's words; an explicit ✕ keeps the passage
words too (a close is not a discard; a send clears them).

Browser check (Sonnet, local dev server, Playwright), all passing: a sent block chat in Summary,
then Structure → panel gone and no `thread=`, Back → it returns; unsent words survive the switch
and come back on the paragraph's chat button; Chat with a conversation → Summary, no floating chat;
*Open in full chat* → the same thread in Chat's band. Not run: Investigate in the browser (covered
by the Reader test).

- Before: [a block chat open in Summary](261024r-shot-3-chat-open-in-summary.png)
- After pressing Structure: [no chat](261024r-shot-4-after-switch-no-chat.png)
- [Chat with a conversation, then Summary](261024r-shot-6-chat-mode-to-summary.png)

The full suite (2,099 files) found two tests that asserted the old rule. `tests/command-jump-pushes-history.test.tsx` matched `showBand`'s old one-line body, and `tests/glossary-ask-in-chat.test.tsx` expected the passage draft to float back after Chat → Glossary. Both were updated to the new rule: the second now checks that the switch closes the draft, and that reopening it from the paragraph carries none of the glossary's question.
