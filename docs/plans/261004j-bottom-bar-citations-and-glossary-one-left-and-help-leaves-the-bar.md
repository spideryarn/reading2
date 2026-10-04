# Bottom bar: Citations and Glossary one place left, and Help leaves the bar

Up: [plans.md](../project/plans.md)

Two suggestions from Greg, filed 2026-10-04 on the reading view, batched because both change the
bottom bar (`src/web/Dock.tsx`). Reports `spya-tnqt2t` (Sentry SPIDERYARN-READING2-C4) and
`spya-dev7pf` (C5); queue entry `qi-xp2ab9hh`.

> Move the citations mode one to the left in the bottom bar and move the glossary one to the left.
>
> — Greg, 2026-10-04 10:27 UTC, `spya-tnqt2t`

> We don't need to show the help icon in the bottom bar of reading view. We should perhaps show it
> at the top of each mode, maybe. I don't know if that makes sense. Basically, I'm trying to avoid
> cluttering that bottom bar, but of course we also want to make sure that if people need help,
> they can get to it. I guess where I want to get to is that if they need help, they can just click
> on the command bar and ask questions, but that that's probably further away and out of scope for
> now.
>
> — Greg, 2026-10-04 10:33 UTC, `spya-dev7pf`

Prior-work check, 2026-10-04: nothing on `origin/dev`, in `docs/plans/` or in `docs/user-feedback/`
does either; the only mention of these ids is 261004h naming this session as a neighbour.

## 1. The order

Each mode swaps with its left-hand neighbour. Both swaps stay inside one run, so no separator
line moves.

```
guides run    before:  Skim  Quotes  FAQ       Glossary  Ideas  Timeline
              after:   Skim  Quotes  Glossary  FAQ       Ideas  Timeline

critical run  before:  Referee    Citations  Debate
              after:   Citations  Referee    Debate
```

With the experimental switch off, FAQ, Timeline and the whole critical run are hidden, so that
reader's bar does not change at all.

The edit is two row swaps in `MODES_UI`, the comments on those rows, and
`tests/dock-mode-order.test.ts`, which writes the order out by hand and so goes red first.

## 2. Help

### What is already there

The Help page has four ways in ([help-page.md § The ways in](../project/help-page.md#the-ways-in)):

1. the site footer, on pages that have one (the reading view does not);
2. the command bar's **Help** row (⌘K or the ⌘ button, then *help*), which opens at the section
   for the mode you are in;
3. the **Help** link in the bottom bar, the one Greg wants gone;
4. **every mode's (i)**, in the top-right corner of its panel, whose card ends in
   *More in Help →* to that mode's section.

So "at the top of each mode" already exists, as number 4. Nothing has to be built for it.

### What removing number 3 leaves

Corrected after the plan review: not every panel has an (i). A visitor's panel for a mode that is
not shared (`VisitorBand`), a panel that failed (`FeatureBoundary`'s fallback) and Marginalia's
column have none.

| Where | Owner | Visitor (signed in or out) |
|---|---|---|
| A mode's normal panel | the (i), and the command bar | the (i) |
| Plain, or Marginalia's column alone | the command bar | **nothing** |
| The Metadata page | the command bar | **nothing** |
| A mode that is not shared | (cannot happen) | **nothing** |
| A panel that failed | the command bar | **nothing** |

A visitor has no command bar: `useCommandBarChord(!isVisitor, …)`, `DockCommands` and
`DockCommandBar` all stand down on the same `isVisitor`. That is anyone reading somebody else's
shared article, **signed in or not**. So taking the link away from everybody would leave a
stranger on a shared link with no route to Help in four of five rows. That is the reader who
knows least about what the buttons do, and Greg's own condition is *"we also want to make sure
that if people need help, they can get to it"*.

### Decision: the link goes for anyone who has the command bar, and stays for a visitor

The bar draws Help only when `isVisitor` is true, which is exactly the condition the command bar
stands down on, so nobody is without both. A signed-out visitor's bar is the short one (no ⌘
button, no quick search, no Experimental switch, no Feedback). A signed-in visitor's still has the
switch and Feedback, but not the ⌘ button or quick search. On the Metadata page the same rule
applies, because it is the same component and the same gate; no `mode` reaches the bar there, so
the link opens at the reading view's section, as it did before.

The simpler option passed over: **remove it for everybody.** One line fewer, and no visitor
branch. Passed over because of the empty cell in the table above.

Also passed over: **a separate help glyph in each panel's corner**, beside the (i). The corner
already holds the (i) and the profile icon, and the (i) card already ends in the Help link, so a
third icon would move clutter rather than remove it. If Greg finds *More in Help →* too hidden
inside the card, that is the next step, and it is his call.

Out of scope, in Greg's words: asking the command bar a question. That is
[261003k](261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md).

### The edits

- `src/web/Dock.tsx`: draw the Help `DockLink` only for a visitor; rewrite its comment.
  `helpHrefFor` and `helpLink` stay, because the command bar's Help row reads the same value.
- `src/web/CommandBar.tsx`: the comments that say the Dock's link and the row agree.
- `src/web/styles/dock-fit.css`: `.dock-help` rules stay (the visitor's link still needs them);
  the comment says who sees it.
- `src/web/help/help-topics.tsx`: the sentence listing what the bottom bar holds names Help. Make
  it true, and say where Help is from the reading view.
- Tests: `tests/dock-help-link.test.tsx` (the owner has no Help control; the visitor's follows the
  mode, on both pages; the landing test runs as a visitor), `tests/dock-mode-tooltips.test.tsx`
  (`NOT_MODES` holds Help's card to shape, so that case renders as a visitor),
  `tests/dock-fit.test.ts` (comment only), `tests/command-bar.test.tsx` (comment only).
- Docs: `help-page.md § The ways in`.

## Checks

- `tests/dock-mode-order.test.ts` red before the swap, green after.
- A new assertion "an owner's bar has no control named Help", red before the gate, green after.
- `npm run typecheck`, the touched test files, `npm test` if the box has room, lint on touched
  files.
- A browser look at the bar as owner (no Help, new order) and as a visitor (Help present).

## Questions for Greg

None blocking. One thing he may want to overrule: Help stays in a **visitor's** bar. If he would
rather it went there too, it is deleting one condition.

## Reviews

**Plan, GPT Sol, 2026-10-04: ready with changes.** Prompt and answer:
[prompt](261004j-bottom-bar-order-and-help-plan-review-prompt.md),
[answer](261004j-bottom-bar-order-and-help-plan-review-sol.md). It confirmed that `isVisitor` is
exactly the command bar's stand-down condition, that keeping Help for visitors is the smallest
safe reading, and that nothing else derives the bar's order by hand (the command bar reads
`visibleModes`; Help's table uses `MODES` order on purpose). Four findings, all taken:

- P2, the (i) is not in every panel. The table above is rewritten, and `help-page.md` now says
  which panels lack one. `tooltips.md` says "every band's (i)" of the component, which is still
  what it is called, and is left.
- P2, a signed-in visitor's bar is not the short one. Said above, and a test covers a signed-in
  visitor through the real `drawer.visitor` path: Help present, Commands absent.
- P3, on the Metadata page the link cannot follow the mode. The test says reading-view section
  there, for a visitor, signed in and out.
- P3, the `ModeGroup` comment lists the runs in order. Updated with the rows.

**Code, GPT Sol, fixing, 2026-10-04: ready after its fixes.**
[prompt](261004j-bottom-bar-order-and-help-code-review-prompt.md),
[answer](261004j-bottom-bar-order-and-help-code-review-sol.md). No P0 to P2. It found the two
gates complementary on every real mount of the bar. Four P3s, all fixed by it and read by me: a
visitor's Metadata bar is now asserted to have no Commands (so a gate keyed on sign-in would go
red there too); the Help page's sentence says Commands is the owner's before it says how to use
it, and calls the icon a mode's (i); the comment on Ideas' row; a test comment in
`tests/command-bar.test.tsx`.

**Browser, a Sonnet subagent with Playwright, 2026-10-04, all six checks passed.** Owner with the
switch on at 1500px: `… Skim, Quotes, Glossary, FAQ, Ideas, Timeline, Citations, Referee, Debate
…`, Commands present, no Help. The command bar's Help row from Glossary goes to
`/help#mode-glossary`, and so does *More in Help →* in Glossary's (i). Owner on Metadata: no Help,
Commands present. Signed-out visitor on a public article: Help present, no Commands, opening at
`/help#the-reading-view` in Plain and `/help#mode-glossary` in Glossary. At 390px the bar scrolls
and has no Help. Not checked in a browser: a signed-in visitor, which the unit test covers.

`npm run typecheck` is red on `origin/dev` in `src/backfill-registry-facts.ts` (six errors), a
file this work does not touch; nothing else is reported.

## Deferred

Nothing. A help glyph of its own in each mode's corner was weighed and not built (above); it is
an option for Greg, not a promise.
