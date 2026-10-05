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

Code review, GPT Sol, against committed stage `11ae9db7f`:

| ID | Sev | Evidence | Finding | Fixed? |
|---|---|---|---|---|
| F6 | P2 | Established | The test claiming one Back leaves Search supplied an opener that only mounted the band, never pushed `mode=search`, and never pressed Back. The predicate test likewise did not cover Reader's rail wiring. | Yes. Renamed the stand-in test to its actual assertion; added real Reader tests through the command row, under StrictMode, pressing Back to verify the previous mode/rail and both previous matchers with their `find` words. |
| F7 | P1 | Established; regression watched red | `openQuickSearch` omitted the herald shown by the Dock's own Enter. The existing herald contract includes command-bar picks; the excluded prose/chat controls do not establish an exemption for this row. The Reader test returned an empty herald after opening Search. | Yes. Both Search arrivals now call the same Reader opener, including a fresh herald nonce. The Dock's toggle-to-close still runs first, and has a regression check. [Root cause](../postmortems/261005h-sharing-an-arrival-predicate-drops-the-rest-of-the-press.md): sharing only an arrival predicate dropped another side effect of the press. |
| F8 | P3 | Established | `search.md` described rail restoration and Back as differences from the Dock box, although both routes share them. The preceding cross plan still said the panel has no cross in the present tense immediately before saying it was built. | Yes. Corrected those descriptions without changing any quoted words or adding attribution. |
| F9 | P1 | Reasoned from CSS geometry; inherited | An empty field while a search is busy has the spinner at the right but only the ordinary input padding. A long placeholder in a narrow band can run under it. The busy padding added here only covers filled fields. The same empty/busy overlap exists in the parent stage. | No: reported as wider, inherited behavior. Needs a layout reproduction and an empty/busy padding rule in a separate fix. |

No defect established in the mount ref's StrictMode handling, the sealed handoff, row IDs or
suggestion signatures, or the clear cross's vertical target. The mounted Reader checks restore the
previous mode, matcher, words and hidden-rail choice with Back. Actual native-dialog focus restoration,
soft-keyboard behavior and computed touch geometry remain for the planned browser pass; jsdom is
not evidence for those.

**Code-review verdict: ship after these fixes**, which are applied in this worktree. Browser and
full-suite gates remain the stage owner's work; this review does not claim they passed.

**Review validation:** the six requested files passed all 178 tests before editing. After the
fix, those six plus `mode-herald-wiring.test.tsx` and `doc-links.test.ts` passed all 202 tests.
`node --import tsx scripts/typecheck.ts` passed all four projects and its coverage guard (3128
source files). Lint on the three changed TypeScript files exited 0 with two existing optional-chain
warnings and three complexity notices; `git diff --check` passed. Removing the quick row's
`generates` marker failed three tests, always replacing the matcher failed two, and removing
`session?.edit("")` from clear failed two. Removing Reader's rail restoration also failed the new
Reader test. Each mutation was restored; the final green run used the restored code. The herald
regression was watched red against the candidate, then green after F7's fix.

## Progress

- 2026-10-05: plan written.
- 2026-10-05: both parts built, with their tests, docs and Help. Not yet done: the Sol code review,
  the browser pass, the full suite.
  - **Part A.** `CommandExecutor.quickSearch`, built by `quickSearchPress` in `readingExecutor`
    from an opener the reading view hands over for the owner. `quickSearchRow` in `CommandBar.tsx`
    draws it in front of every ready `find` row, `generates: true`. `src/command-pick.ts` is
    untouched and `tests/command-pick-catalogue.test.ts` passes without regenerating.
  - **F2, differently from the ledger's wording.** The Dock's door is a closure inside Reader's
    JSX, a thousand lines below where the executor is built, so the executor cannot call it
    without moving it. Instead the arrival rule became one function, `arrivalBringsRailBack`
    (`mode-press.ts`), which the Dock's `onMode` and a new `openQuickSearch` in `Reader.tsx` both
    ask; `openQuickSearch` is `showBand("search")` plus that rule. The plan review allowed either
    ("its non-toggling activation or a shared Reader opener"). **What the Dock's door does that
    this does not:** it names the mode in the herald. Glossary's and Find more's rows do not
    either.
  - **F3 was real.** With Search open on words or meaning, a handoff's switch to quick left
    `history.length` unchanged (watched red, both matchers). `useBarHandoff` now replaces only on
    the band's first look at the handoffs after mounting, and pushes otherwise. This also changes
    the Dock box: typing there with Search open on another matcher now pushes.
  - **F4.** `quietMount` is also true when an `enter` handoff is pending at mount under
    `pointer: coarse`. With Search already mounted nothing focuses the panel's box; where the
    focus lands after the command bar's dialog closes is the browser's restore, and is for the
    browser pass, as is the real soft keyboard.
  - **Part B.** One `clear()` in `Box` for Escape and the cross. `.srch-clear` is 20px, and under
    `any-pointer: coarse` it is stretched to the field's height with a target 40px wide and no
    taller (F5). The input's right padding grows again while the spinner shows, which the plan did
    not say: without it the words ran under the spinner once it moved left.
  - **Tests watched red, then green:** the two-row draw for three verbs, Enter running the quick
    search, a model's `find` answer, `readingExecutor`'s quick search, `arrivalBringsRailBack`,
    push-when-already-open (F3), no focus on a touch screen (F4), and the panel cross (presence for
    three matchers, quick clear, words clear, the CSS, and the spinner rule's order, which caught
    a rule that lost to an equal one below it). **Green from the start**, so characterising what
    was already true: revise-not-duplicate, held-until-loaded, replace-when-just-opened, the ⚡
    and desk focus, Escape, and no quick row for a visitor or on the Metadata page.
  - **Not tested:** the wiring in `Reader.tsx` itself (no test mounts it), and focus after the
    dialog closes.
- 2026-10-05: **GPT Sol's code review** of `11ae9db7f`
  ([261005i-code-review-sol.md](261005i-code-review-sol.md)): ship after its fixes, which it applied
  (F6-F8 above; F9 is inherited and reported only). Its one change to code: the Dock's own Search
  press now goes through `openQuickSearch` too, so the herald, the band and the rail rule are one
  opener for the Search button, the bar's box and the command row
  ([postmortem](../postmortems/261005h-sharing-an-arrival-predicate-drops-the-rest-of-the-press.md)).
  Read and accepted; not re-reviewed, since it was round one and found nothing left open.
- 2026-10-05: **Browser check**, a Sonnet subagent, Playwright on system Chrome, `fowler-phrenology`,
  at 1440x900 (mouse), 820x1180 and 390x844 (touch), on `11ae9db7f`, before the review's fix. Every
  item passed at all three: the bar's box and the bolt still search; *search for*, *find* and
  *does it mention* draw the two rows, quick first with `generates`; Enter opens Search on quick
  with exactly those words; arrow-down and Enter opens the exact words and asks nothing; a sentence
  draws both rows and runs nothing until Enter; Back returns to words or meaning when Search was
  already open, and leaves Search when it was not; focus is in the panel's box at a desk and not on
  touch; a hidden rail comes back. The panel's cross: absent when empty, there in all three
  matchers, empties and focuses; on touch its target is 40px wide and exactly the field's height,
  and a press just under the field reaches the matcher buttons, at 12px and 16px roots; the spinner
  sits left of it. Shots `261005i-shot-1` to `-6`.
  **Two limits.** OpenRouter answered 403 on this box, so the search and command-pick calls were
  mocked: what was checked is the request the page sent (`kind: "quick"`, the words) and the mocked
  hits being drawn, not a real model answer. And a real soft keyboard was not observed. Not checked:
  the quick matcher's *find* button under the cross on touch.
