# The command bar opens quick search, and the Search panel's box gets a clear cross

Owned by [plans.md](../project/plans.md). Two small jobs in the same few files, from two answers
Greg gave on 2026-10-04. Session `bar-opens-quick-search`; the bar half is the quick-search part of
queue item `qi-7mpz6n48` (its other two parts, answers about the app from Help and two commands
from one sentence, are **not** built here).

## What Greg decided

**Part A.** The question put to him ([Q-bar-3]): *"You said quick search should eventually live in
the bar. How far should we go? A: keep the quick-search icon, change nothing. B: keep the icon, and
make 'search for X' typed into the bar open quick search (today it opens Search in exact-words
mode). C: remove the icon, so the bar is the only way in."*

> Q-bar-3 C
>
> — Greg, 2026-10-04

and a few minutes later:

> Q-bar-3 actually I'm not 100% sure what's best. If you recommend B, I'm open to that
>
> — Greg, 2026-10-04

The Overseer recommended B. So **B is built: the icon stays**, and removing it (C) is still open.

**Part B.** Asked whether the Search panel's own box should get the clear cross the bar's box got in
[261004g](261004g-quick-search-box-clear-cross.md):

> Q-panel-box-cross yes
>
> — Greg, 2026-10-04

## What is there today

- The bar's verb table (`src/web/command-match.ts § VERBS`) turns *search for X*, *search X*,
  *find X*, *does it mention X*, *do they talk about X* and four *find mentions of …* forms into
  one `find` argument. A sentence that names no row goes to Jev, which may answer `find`, and Luna
  copies the words out (261003k). Both end in one row, *Find “X” in this article*, which is an
  address: `?mode=search&match=words&find=X` (`CommandBar.tsx § findRow`). Exact words only.
- Quick search is started from the bar's box or the ⚡ (`DockQuickSearch.tsx`). Its Enter does three
  things: write the words to the article's shared draft, leave an `enter` handoff, open Search mode
  (`search-draft.ts`). The band takes the handoff, switches itself to *quick* if it is on another
  matcher, and asks (`SearchMode.tsx § useBarHandoff`). That works with Search mode closed or open.
- The Search panel's box (`SearchPanel.tsx § Box`) clears on Escape only. A phone has no Escape.

## Part A — the design

```
 bar:  "search for the limits of free will"        (typed verb, or a sentence a model read)
          │
          ▼  one `find` argument, as today
   ┌──────────────────────────────────────────────┐
   │ ⚡ Quick search “the limits of free will”     │ ← new, first, so Enter runs it
   │   Find “the limits of free will” — exact words│ ← today's row, unchanged, second
   └──────────────────────────────────────────────┘
          │ Enter on the first
          ▼
   draft.set(words) · draft.handOff("enter") · open Search mode     (the bar box's own Enter)
```

1. **One new row, in front of the row that is there.** Every `find` argument draws *Quick search
   “X”* first and the exact-words row second. No new argument kind, no new verb, no new proposal
   id: the model's options and prompts (`src/command-pick.ts § ARGUMENT_OPTIONS`) are untouched, so
   the 261003e measurement still stands and no eval is owed.
2. **It runs the bar box's Enter, not a second path.** The reading view's executor
   (`command-runners.ts § readingExecutor`, built in `Reader.tsx`) gains one optional member,
   `quickSearch(words)`, which does exactly the three steps above. It is the bar's own, like
   `findMore`: chat's chips do not get it (`chatExecutor`), and a chat *Find “X”* chip still goes to
   the exact-words address.
3. **Absent means not offered.** `quickSearch` is handed over under the same cut as the bar's box
   (`Dock.tsx § hasQuickSearch`): the owner's reading view. On the Metadata page there is no
   executor, so the bar draws the exact-words row alone, as today.
4. **It always waits for Enter and carries no `generates` marker.** Argument rows never run at once
   (261003k F2), so a sentence's answer is drawn and pressed. No marker because the same search
   already fires from the bar's box on a 600 ms pause with no confirmation; a marker here would
   say this way in is heavier than that one.
5. **The exact-words row keeps its words** (*Find “X” in this article*), because chat's chip shares
   them (`command-proposal.ts § proposalWords`).

**Passed over:**

- *Only `search for` opens quick search; `find X` stays exact.* Closer to the letter of the
  question, but it is a rule a reader has to learn (which verb means which search), and the second
  row already gives exact words one arrow-key away. **A [Q] for the debrief**: this changes what
  Enter does after *find X* and *does it mention X*.
- *A new `quick-search` proposal id*, so chat could offer it too. Seven switches and the token
  grammar for something nobody asked for.
- *A new argument kind for the model* (`arg:quick-search`). Changes the measured prompt.

**The line** (chat-llm-help-commands-vision.md § Decided): quick search spends a Jev call and saves
a search row, so it is *proposed and pressed*, never run from a model's answer. Design point 4 is
that.

## Part B — the design

A cross inside the panel's box, shown while the box has words in it, on every device and for all
three matchers.

- **One clear path.** `Box` gets a `clear()` that is today's Escape body (words: `onFind(null)`;
  quick and meaning: empty the draft and tell the session). Escape and the cross both call it.
- **The cross then focuses the box**, as the bar's cross does: the only reason to wipe is to type
  the next words. On a phone the tap is a gesture, so the keyboard may rise. A mouse press does not
  take the focus off the input first (`preventDefault` on mousedown).
- **Not `.close-x`** (261004f: a clear cross is not a close). A class of its own, `.srch-clear`,
  shaped like `.dock-qs-clear`: about 20px to look at, a 40px finger target under
  `any-pointer: coarse`, out of the flow. The input gains right padding so words do not run under
  it, and the spinner (`.srch-spin`, also at the right) moves left of it while both show.

**Passed over:** drawing it only on touch screens. One more media query, and a desktop reader with
a mouse in hand gains from it too.

## One stage

Small enough for one: both parts, their tests, the docs and Help, one Sol code review, one browser
pass.

**Tests, red first**

- `tests/command-bar-arguments.test.tsx` (or beside it): a `find` query with a `quickSearch` on the
  executor draws two rows, quick first; Enter calls `quickSearch` once with the cleaned words and
  closes the bar; with no `quickSearch` only the exact-words row is drawn; a model's `find` answer
  (`command-bar-pick.test.tsx`) draws both and runs nothing until a fresh Enter.
- `readingExecutor`: `quickSearch` writes the draft, leaves an `enter` handoff sealed with those
  words, and opens Search — and is absent for a visitor.
- The collision matrix (`tests/command-match-arguments.test.ts`) still passes.
- `tests/quick-search-panel.test.tsx` (or the panel's own file): no cross in an empty box; the
  cross empties the draft and calls the session's `edit("")`; in words mode it clears `find`;
  focus is in the box afterwards; Escape still does the same.
- `tests/command-pick-catalogue.test.ts` says whether the generated list changed. Expected: no.

**Docs, same stage**

- [search.md](../project/search.md): the bar route, and the panel's cross.
- `/help` (`src/web/help/help-modes.tsx` Search topic, `help-topics.tsx` keyboard topic): *search
  for …* in the command bar opens a quick search; the panel's ×.
- [interface-vision.md § Decluttering the bottom bar](../project/interface-vision.md#decluttering-the-bottom-bar):
  one line: B done, the icon stays, C open.
- [reading-view-overview.md](../project/reading-view-overview.md) § the command bar, if it lists
  the argument rows.
- [261004g](261004g-quick-search-box-clear-cross.md) § Where it does not appear: Greg's answer.

**Done is:** the tests above red then green; `npm test`, `npm run typecheck`, lint on touched files;
Sol's code review; a Sonnet browser pass at desktop (1440), iPad (820, touch) and phone (390) that
both ways in work (the icon or box, and the bar by a typed verb and by a sentence) and that the
panel's cross clears at phone and iPad width.

## Review ledger

Plan review, GPT Sol, [261005i-plan-review-sol.md](261005i-plan-review-sol.md), against b6196c587:
**build with changes**. All five taken; where a finding changes the design above, this table wins.

| ID | Sev | Finding | Taken |
|---|---|---|---|
| F1 | P1 | The accepted rule says a proposal that spends carries `generates`; the bar box's pause is no exception for a command row | The quick row is `generates: true`, `opensOnly: false`. Design point 4's "no marker" is withdrawn. `RISK.find` stays `navigate` (the exact-words row and chat's chip) |
| F2 | P1 | The plain mode setter leaves a hidden search rail hidden; the Dock's quick search goes through the arrival rule that clears `?spine=0` (Reader.tsx, near line 4244) | The executor opens Search the way the Dock's quick search does, not with `showBand`. Search arms no generation, so glossary's reason for the plain setter does not apply |
| F3 | P1 | Inherited: `useBarHandoff` always *replaces* the history entry when it switches the matcher, assuming the opener just pushed one. With Search already open on words or meaning nothing was pushed, so Back skips that view | Fixed here, red first: replace when the opening was just pushed, push when Search was already open |
| F4 | P2 | A search handed over from the bar skips the panel's `putKeyboardAway`, and a newly mounted box takes focus | Desktop: the panel's box has focus afterwards, as now. A touch screen (`pointer: coarse`): a submitted search (`enter` handoff) does not focus the box on mount, so no keyboard rises over the hits. The ⚡ (`quick` handoff) still focuses |
| F5 | P2 | A centred 40px finger target reaches about 6px below the panel's 28px input, into the matcher buttons 5px under it; the Dock's bar clipped its copy, this field clips nothing | The target is held inside the field vertically (its height, not 40px tall; 40px wide), and the browser check presses near the controls below at 12px and 16px roots |

Also from the review, as tests: an existing quick session with other words is *revised*, not
duplicated; a search sent before the saved list loads is held and asked; Back afterwards; the
hidden rail; focus after the bar's dialog closes.

## Progress

- 2026-10-05: plan written.
