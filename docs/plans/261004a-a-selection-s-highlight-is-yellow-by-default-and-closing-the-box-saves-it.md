# 261004a — A selection's highlight is yellow by default, and closing the box saves it

Report: spya-ur8kum (Greg, admin, 2026-10-03, suggestion). Overseer queue: qi-2ahmfzqy. It builds on
[261003e](261003e-span-highlights-with-a-colour.md) (a highlight is a comment with a colour) and
[261003i](261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md) (no way out
silently discards a draft).

> I like the new human highlights when I select text - can we default to the yellow colour, and
> default to saving it, so that it requires fewer clicks?
>
> — Greg, 2026-10-03 (spya-ur8kum)

## What happens today

Select words in the article and a box opens: the quote, a place to write, a colour row with **no
colour** picked, and `Discard … [Ask AI] [Save]`. To make a yellow highlight a reader presses the
yellow dot and then Save: two presses after the selection. A box nobody touched stores nothing,
whichever way it is closed.

## What changes

1. **Yellow is picked when the box opens.** The colour row shows it selected. Not in Referee mode
   (see below).
2. **Closing the box saves the highlight.** The ×, Escape and Save all store what the box shows,
   which is now a yellow highlight even if nothing was touched. **Discard** is the one way to make
   nothing, as it already is the one way to throw words away.

So a yellow highlight is: select, then Escape (or ×, or Save). One press, or one key with no pointer
travel, instead of two presses.

```
   before   select → ● yellow → Save            2 presses
   after    select → Esc | × | Save             1
            select → Discard                    nothing kept
```

The hint under the buttons changes to say so: *"Closing this saves the highlight. Discard throws it
away. Nothing is asked unless you press Ask AI."*

## Three places where the default does not apply, each by name

- **An untouched box that goes away without the reader closing it stores nothing**, as today:
  another selection in the prose, leaving the article, a reload or closed tab. Only the explicit
  closes (×, Escape, Save, Ask AI) store an untouched box. A *touched* box (words, a colour press, a
  placement) is still stored on every way out, exactly as 261003i built.

  Why: with a mouse, letting go of a drag opens the box. A reader who mis-selects and drags again
  would otherwise leave a yellow highlight behind for every attempt. It also keeps React
  StrictMode's simulated unmount (mount, cleanup, mount) from storing a highlight in development
  and killing the box's latch.

- **Copy, then close, stores nothing** if nothing else was touched. Greg, 2026-09-05, is why the
  Copy button exists: *"When I select some text in the article to copy it to the clipboard, it
  automatically pops up the Comment panel"*. A reader who selects, presses Copy and closes wanted
  the sentence, not a highlight. Pressing Save after Copy still saves.

- **Referee mode keeps "no colour" as its default.** A selection there is for placing a passage on
  a criterion; a default colour would turn every placement into a highlight and a row in Quotes.
  Nothing about that box changes.

## A consequence to know about

**Ask AI on a selection now also leaves a yellow highlight**, unless "no colour" is picked first.
The box stores what it shows, and it shows yellow. A coloured comment on a selection is a row in
Quotes ("yours"), so a word a reader asked about now appears there. The alternative (Ask AI quietly
dropping a colour the reader did not press) would make the box store something other than what it
shows. Question `[Q-ask-ai-colour]` below.

## The simpler option passed over, and the bigger one

- **Simpler: only preselect yellow**, leaving "an untouched box stores nothing" whole. Then ×
  and Escape would throw away a box showing a yellow dot, and Save would be the only way. It is one
  press too, but it does not do the second thing he asked for ("default to saving it"), and a box
  that shows a colour and then keeps nothing when closed is the surprise 261003i removed.
- **Bigger: save at the moment of selection**, with no press at all, and the box (or a small menu)
  only for changing it. That is the fullest reading of his words. Not built here: every selection
  made to copy, and every mis-drag, would write a highlight that then has to be deleted, and the box
  would have to become an editor of a stored comment (three PATCH paths instead of one create).
  It is the still-open `[Q-highlight-menu]` from 261003e seen from the other side. Question
  `[Q-save-on-select]` below; queue entry made before the note says shipped.

## The code

All in `src/web/AnnotateDialog.tsx`, plus its tests and docs.

- `colour` starts at `placing ? null : DEFAULT_HIGHLIGHT` (`"yellow"`, a named constant beside the
  swatches).
- Two questions that were one (`isDirty`) become two:
  - **`isTouched`**: the reader did something. Words, a placement, or a press on the colour row
    (a boolean set by the row's `onChange`, so pink-then-yellow is still touched). This gates the
    implicit exits: unmount and `pagehide`, as `isDirty` does now.
  - **`hasSomethingToStore`**: words, a colour, or a placement. This gates the explicit closes (×
    and Escape), together with the Copy rule: `copied && !isTouched` stores nothing.
- `CopyQuote` gets an `onCopied` callback, called when the write is asked for (not when it
  resolves: the intent is the press).
- `flush(leaving, explicit)` picks the gate. The latch, the draft id, `send`, Reader's `onSave` and
  `useComments.create` are untouched. No server change, no migration.
- Picking "No colour" and closing an otherwise empty box stores nothing, as today (a bare bookmark
  is made by Save).

## Tests (red first)

In `tests/annotate-dialog-keeps-a-draft.test.tsx`:

- The box opens with Yellow checked; in Referee mode, with No colour checked.
- Untouched, ×: one draft, `colour: "yellow"`, empty body, `ask: false`. Escape: the same.
- Untouched, unmount / another selection / `pagehide`: nothing. StrictMode mount: nothing, and the
  box still stores afterwards.
- Untouched, Save: yellow. Ask AI: yellow, `ask: true`.
- Copy then ×: nothing. Copy then Save: yellow. Copy, type, ×: stored.
- No colour picked, ×: nothing (the colour press is a touch, but there is nothing to store).
  No colour picked, unmount: nothing.
- Pink then yellow, unmount: stored (touched).
- Discard: nothing, as now.
- Referee, untouched, ×: nothing, as now.

The existing cases "untouched: the ×, Escape and an unmount all store nothing" and the
another-selection case that ends with `press("Close")` change to match. Any other test that mounts
the box and reads `colour` is checked.

## Docs

`comments.md` § The box a selection opens (the rule and its table), the header of
`AnnotateDialog.tsx`, the iPad steps in the 261003_0929 note are history and stay. `quotes.md` if
it says how a highlight is made.

## Stages

One stage. GPT Sol reviews this plan, then the code. Browser check by a Sonnet subagent: mouse at
desktop width, an iPad profile, a phone width; the cases above plus the wash appearing in the prose
after Escape.

## Questions for Greg

**[Q-save-on-select]** Should selecting words save the highlight with no press at all?

Background: as built here, a selection opens the box with yellow picked, and one press or Escape
saves it. The step further is to save the moment you let go of the mouse (or tap *Highlight or
comment* on an iPad), and show the box only to change it.

- **A (as built): one press saves.** Select, then Escape, × or Save. Selecting to copy, or dragging
  again because you missed a word, leaves nothing behind.
- **B: saved the moment you select.** No press. The words turn yellow at once; a small box offers
  colours, a comment, Ask AI and *Remove*. Cost: about a day. It gives up clean copying: every
  selection, including one made only to copy a sentence or made by a slip of the mouse, becomes a
  highlight until you remove it.
- **C: on a finger only.** On an iPad you already press *Highlight or comment*, which is a clear
  intent, so that press could save at once; a mouse keeps A. About half a day. It gives up the two
  behaving alike.

Recommendation: **A, then C if one press still feels like one too many on the iPad.** What would
make B right: if you rarely select text for any other reason and removing a stray highlight does
not bother you.

**[Q-ask-ai-colour]** When you select a word and press Ask AI, should the word also become a yellow
highlight (and so a row in Quotes)?

- **A (as built): yes.** The box shows yellow, so it stores yellow. Pick "no colour" first to avoid
  it.
- **B: no.** Ask AI stores the comment without a colour unless you pressed one. A word you only
  asked about stays out of Quotes. An hour's work. It gives up the box storing exactly what it
  shows.

Recommendation: **A** until it annoys; B is cheap to switch to.

## GPT Sol's plan review, 2026-10-04: build with changes

[261004a-yellow-default-plan-review-sol.md](261004a-yellow-default-plan-review-sol.md). No P0, one
P1, five P2. All accepted. **Where this section and the text above disagree, this section wins.**

- **D1 the gates, exactly.** An implicit exit needs both: something to store, and the reader having
  done something.

  ```
  hasSomething   = words || colour !== null || placement
  intent         = words || placement || the colour was changed
  implicit exit  : hasSomething && intent
  × and Escape   : hasSomething && !(copyPressed && !intent)
  ```

  The gate is tested before `fate` is changed, as `flush` does now.
- **D2 "touched the colour" means changed it.** `HighlightSwatches` calls `onChange` only when the
  pressed colour differs, and must stay that way (`CommentDialog` would PATCH on every press).
  So pressing the already-picked Yellow and then selecting elsewhere stores nothing. Taken as the
  smaller of Sol's two options; an `onPress` callback is the other if this ever matters.
- **D3 the Copy rule is said on screen.** After Copy is pressed the hint reads: *"Copied. Closing
  leaves no highlight; press Save to keep it."* The callback is `onCopyPressed`.
- **D4 the Help page.** `src/web/help/help-topics.tsx` says an untouched box saves nothing; it is
  updated with its test.
- **D5 the Referee reason, corrected.** Quotes already leaves out any comment with a placement. The
  reason to keep "no colour" there is that a selection in Referee mode records evidence against a
  criterion, and silently adding a reading highlight mixes two meanings. The default is chosen at
  mount and does not change if the mode does.
- **D6 tests added:** untouched `pagehide` then `pageshow` does nothing, and a later × stores one
  yellow highlight; type, first Escape clears, second Escape stores yellow; Copy with its clipboard
  promise unresolved, then ×, stores nothing; a press on the already-picked Yellow, then unmount,
  stores nothing. Every "stores nothing" case sits beside a case where the same exit does store.

What changes downstream, with no code change (Sol's answer 6): more rows say *Highlight* in the
drawer; every coloured selection outside Referee is a "yours" row in Quotes; a visitor on a shared
link sees the wash; a wordless highlight has no ✳.

## Landed, 2026-10-04

Built as the review section says. The deferred half, `[Q-save-on-select]` with `[Q-ask-ai-colour]`,
is queue item `qi-tymfbk48`, waiting on Greg. The note is
[261003_1807](../user-feedback/261003_1807-highlight-defaults-to-yellow-and-closing-saves-it.md).

**GPT Sol's code review: land after fixes (made)** —
[261004a-yellow-default-code-review-sol.md](261004a-yellow-default-code-review-sol.md).

- **C1 (P1).** `flush` read the last render's fields, so two presses inside one frame could store
  the wrong thing: Copy then × stored Yellow, Green then × stored Yellow. Every field writer now
  updates the ref as well as the state (`remember`). Tests were red first.
- **C2.** The draft test left a fake `navigator.clipboard` behind for later cases; it is removed.
- **C3.** Header comments in `Reader.tsx` and `useComments.ts` still said a selection opens a
  conversation. Rewritten; I checked the routes they name.

**Browser check** (Sonnet subagent, Playwright on the box, `/read/fowler-phrenology`): 14 of 14.
Yellow picked on open; Escape, × and Save each leave a yellow wash that survives a reload; Discard,
a second selection, Copy then ×, and No colour then × leave nothing; pink then Escape is pink;
Referee opens on No colour; an iPad profile's chip opens the box on Yellow; no overflow at 390px.
Two limits: the iPad selection was set by script, not by a long press, and WebKit was not run. One
thing it noticed that is not new: with the caret in the text field, the first Escape clears typed
words and the second closes (and saves).
Shots: [the box](261004a-shot-desktop-box.png), [the wash](261004a-shot-yellow-wash.png),
[a phone](261004a-shot-phone-box.png).

**The full suite, after merging dev** (`npm test` through `scripts/tmux-job.ts`, pushed on the fast
gates first as `2720ea9e9`): 32,377 passed, 4 tests in 5 files failed, none of them this change.
All five are the fresh-worktree reds that ask for a build this worktree never made
(`cold-start-lazy-imports` and `pdf-bundle-trace`: "has a build to inspect";
`fleet-composed-access`, `fleet-decisions-route`, `fleet-reports-route`: the fleet client build).
Not re-run after a build; `npm run typecheck` and the box's own suites are green.
