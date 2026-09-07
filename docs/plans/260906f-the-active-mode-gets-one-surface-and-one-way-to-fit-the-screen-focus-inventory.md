# Who owns Tab, the outside press, and the focus that comes back

The sibling of
[the escape inventory](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-escape-inventory.md),
over the escape inventory's sixteen surfaces in the same order, **plus a seventeenth it did not
have**, for the other half of
[A5's modal/modeless checkbox](260905e-main-app-architecture-review.md): *"Check true modals
separately from modeless annotations. Tab, Shift-Tab, Escape, click-away and return focus must
follow the declared contract, including nested help/lightbox/tooltips."* Escape was built and tested
in stage 3. This is Tab, Shift-Tab, click-away and return focus.

**Read the finding first, because it inverts the expected shape of the work.** Twelve of the
seventeen surfaces have no focus trap — every one that is not a native `<dialog>` — and for ten of
those it is *correct*, several arguing it in their own docstrings — the app is deliberately modeless
almost everywhere, `aria-modal` appears nowhere as an attribute, and `inert` is used nowhere in the
UI. The two exceptions are the hover cards, and even there the missing piece is not a trap.

So the job here is **not** to add traps. It is to say what each surface's contract is, and then check
each surface against its own.

## What jsdom can and cannot see, measured rather than assumed

Run on this box, 2026-09-07, before any of the work below was designed:

| | jsdom | real Chrome |
| --- | --- | --- |
| `Tab` moves focus | **no.** Dispatching a `Tab` keydown leaves `document.activeElement` where it was. jsdom implements no sequential focus navigation at all. | yes |
| `dialog.showModal` | **absent.** So are `.show()` and `.close()` — `typeof` is `undefined` for all three. Only the reflected `open` attribute exists, which is why `dialog[open]` works as stage 3's tier-4 test. | yes |
| `inert` | **absent.** `"inert" in element` is `false`. | yes |
| `input.select()` moves focus | **no** — though it does set the selection range, so it looks as if it worked | **yes** |

All three of the platform mechanisms a focus trap is built out of are missing. **A jsdom test that
claimed to prove a trap would be asserting the behaviour of a fake**, which is why the one existing
Tab test in the repo does not try — `tests/the-dock-drawer-is-not-a-modal.test.tsx` tests the two
*mechanisms* a trap would need (a swallowed keydown; `inert`/`aria-hidden` on the background) and
says so in its own comment: *"Neither is Tab traversal itself, which jsdom does not have."* That is
the model every check below follows.

## The surfaces

Census taken row for row from the escape inventory, so the two line up — **plus one that inventory
did not have, and the reason this one nearly missed it too is the finding.** `ContextPanel` is
genuinely not a surface: fixed and z-24, but with no open/close, no dismissal and no keyboard entry,
so it is a column decoration.

**`RefereeHowCard` is surface 17, and the first draft of this inventory dismissed it wrongly.** It
was excluded for being *in flow*, quoting its own docstring — "No focus trap, no backdrop, no
`role="dialog"`". As GPT Sol put it (F41): **being in flow removes the trap requirement, not the
return-focus requirement.** The exclusion applied a real rule to the wrong question, which is a
tidier way of being wrong than guessing and no more use.

| # | Surface | Native `<dialog>` | Trap | Outside press | Focus restore | Unsaved reader text |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Lightbox | **`showModal()`** | platform | backdrop `onClick`, `e.target === ref.current` | platform | no |
| 2 | FeedbackDialog | **`showModal()`** | platform | same shape | platform | **yes** — body, fields, pasted screenshot |
| 3 | Illustrated full | **`showModal()`** | platform | same shape | platform | no |
| 4 | Sketch full | **`showModal()`** | platform | same shape | platform | no |
| 5 | Tooltip | no | **none** | Floating UI `useDismiss`, `outsidePress` default `true` on `pointerdown` | **none** — no `FloatingFocusManager` at all | no |
| 6 | **Prose hover card** | no | **none** | no outside-press listener; closes on `pointerover` elsewhere, and on the touch gesture machine | **none** | no |
| 7 | **Debate hover card** | no | **none** | same hook, same behaviour | **none** | no |
| 8 | Search colour picker | no | none — `FloatingFocusManager modal={false}` | `useDismiss` `outsidePress` | **conditional** — see below | no |
| 9 | ProfilePanel | no | none — `modal={false}` | `useDismiss` `outsidePress` | **conditional** — see below | no |
| 10 | Dock drawer | no | **none, deliberately** | a real `<button class="dock-scrim">`, not a document listener | **yes** — `openerRef`, `isConnected`-guarded | no |
| 11 | CommentDialog | no (`<aside role="dialog">`) | **none, deliberately** | **none** — its `window` pointer listeners drive `dodging` only | **yes** — `openerRef`, falling back to the Comments tab | **yes** — follow-up box, and a note that commits on blur |
| 12 | ChatDialog | no (`<aside role="dialog">`) | none | **none** | **none** | **yes** — the draft, cleared by `onClose` |
| 13 | AnnotateDialog | no (`<aside role="dialog">`) | none | **none** | **none** | **yes** — the annotation, discarded by `setAnnotating(null)` |
| 14 | Masthead rename | no, in flow | none | `onBlur` → `requestSubmit()`, which **commits** rather than cancels | **yes**, and conditionally — only from `body`/`null` | yes, but committed on blur |
| 15 | BlockGutter disclosure | no | none | `document` `pointerdown`, **capture**, registered only while open | **yes** on Escape and keyboard toggle, deliberately **not** on outside press | no |
| 16 | CommandBar | **`showModal()`** | platform | backdrop `onClick` | platform | the query only — cleared on next open by design |
| **17** | **`RefereeHowCard`** | no, in flow | none, correctly | none | **none — and this is a defect.** `RefereeHowButton` toggles `how.open`; the card's own Close button calls `onClose()`, which unmounts the card **with the focused button inside it**, so a keyboard reader lands on `<body>`. `useHowCard` is `open` state and nothing else — no focus code anywhere in the file, checked by hand | no |

**All five natives use `showModal()`.** Nothing in `src/` calls `.show()`, and no JSX sets an `open`
attribute on a `<dialog>` — so all five get the platform's trap, its inert background and its focus
restore for free, and none of that needs building or testing here. Re-checked 2026-09-07, the same
claim stage 3 rests on.

## The one real defect: a card you can open with the keyboard and cannot use with it

**Rows 6 and 7.** Both hover cards are `role="dialog"` holding genuinely focusable content — a "read
it here" link, an "open in glossary" button, a `NoteCard` with a jump control — and both are
`FloatingPortal`led to the **end of `<body>`**. Nothing focuses them, nothing traps them, nothing
sequences them. `useHoverCard` is called with `focusable: true` by its real consumers, so a card
**opens when a `.prose a[href]` takes keyboard focus** — and then Tab goes to the next link in the
article, because the card's controls are at the very end of the document order, past everything.

The card is keyboard-openable and keyboard-unusable, and A5's checkbox names exactly this: *"No
footer/composer or close control may be unreachable."*

**The sharpest part is that the reasoning which created it is written in the file.** `role="dialog"`
was chosen over `tooltip` on a GPT Sol review of 2026-08-26, and the comment gives the right reason:

> `dialog`, not `tooltip`: WAI's tooltip pattern is for text describing the thing you point at, and
> says outright that a tooltip does not take focus and should not contain focusable controls. This
> one holds a link and a button.

The review made the role honest about the content. Nothing then made the content reachable. **The
fix is a design fork with a product edge and is not decided here** — see § *The fork* below.

## What no test anywhere pins

The gaps, in the order they are worth closing:

1. **The backdrop `onClick` on all five native dialogs.** Five copies of the same three-line
   handler — `if (e.target === ref.current) onClose()` — and **not one test dispatches a click whose
   target is the dialog**. The regression it would miss is the guard being dropped, at which point a
   click on any child closes the dialog: for CommandBar that discards the query, for Feedback it
   shuts the box mid-report.
2. **`tests/feedback-dialog.test.tsx`'s `reopen()` is the class the stage-3 postmortem named.** Its
   comment reads *"Shut it the way Escape or the backdrop does, then open it again"*, and its body is
   `show(false); show(true)` — flipping the `open` prop, which is neither route. It is not currently
   hiding a bug, because both routes end at the same state through `onClose`. It is
   [a fixture that arranges away the condition under test](../postmortems/260907b-a-test-blurred-away-the-condition-it-existed-to-test.md)
   waiting for the day the routes diverge, and it is the second instance of that class on this plan.
3. **Floating UI's `outsidePress` in both consumers.** `tests/profile-panel.test.tsx` and
   `tests/search-colour-picker.test.tsx` both test Escape and neither tests an outside press, so the
   default that dismisses them is unpinned in the app that depends on it. **Checked by hand rather
   than taken from the census**: the only dismissal either file dispatches is a `keydown` of
   `Escape` at `document`; neither mentions `pointerdown`, `outsidePress` or an outside click at
   all.
4. **Focus restore for AnnotateDialog, ChatDialog, `RefereeHowCard`, the Tooltip and both hover
   cards** — all "none" above, and untested. For the hover cards and the Tooltip "none" is right,
   because nothing took focus in the first place. For the other three it is a real defect — but
   **they are two shapes, not one**, and saying otherwise was an over-generalisation from two cases,
   which Sol caught on the second round:

   - **Annotate and Chat** do take focus on open (a textarea; the draft arm's composer) and unmount
     it on close, so the reader lands on `<body>`. Their opener is *dynamic* — a prose selection, or
     a gutter chip that may be gone by then — so they need the capture-and-restore pattern already
     written twice here, in `Dock.tsx` § *the drawer takes focus, and gives it back* and in
     `CommentDialog`. Chat has an extra case of its own: its focused content is unmounted when the
     `draft` arm becomes the `thread` arm, **before** the dialog closes at all.
   - **`RefereeHowCard` does not take focus on open at all.** The card appears and focus stays on the
     always-mounted toggle. The loss happens only to a reader who Tabs *into* the card and presses
     its Close button, which unmounts itself. There is no opener to capture and no fallback to
     invent — the destination is permanent, so a ref to `RefereeHowButton` is the whole fix.

   Sol F41 and F42. The first draft of this inventory named the Annotate and Chat gaps and then
   planned no repair for them, which is its own kind of finding.
5. **ChatDialog's `?thread=` arm focuses nothing** (`focusNonce={0}`, against `{1}` in the draft
   arm), so opening a thread leaves focus wherever it was. This is the shape of Sol's F5 against the
   drawer, which stage 2 of A2 fixed there and not here.

## The clean column, which is a result and not an absence

**No unsaved reader prose is lost to an outside click today.** Checked surface by surface rather
than assumed: only Feedback and CommandBar can be dismissed by an outside press at all, Feedback's
draft survives (it stays mounted and only `open` flips — pinned by its own suite), and CommandBar's
query is cleared by design and is not reader prose. Annotate, Chat and Comment's follow-up box have
**no outside-press mechanism at all**, so there is nothing to lose it to.

That is worth stating because it inverts the obvious fix: **adding a uniform click-away would create
three new loss paths**, and Annotate's would be immediate, since `setAnnotating(null)` discards. Any
future outside-press work has to carry the draft question with it. This is the same reasoning that
made stage 3 give Annotate a *lower* Escape priority rather than a louder one.

## Nested cases

| Nesting | Who owns Tab | What happens on closing the inner one |
| --- | --- | --- |
| A `<Tooltip>` inside the full-screen Sketch or Illustrated `<dialog>` | **the dialog** — the tooltip portals to the end of `<body>`, *outside* the modal, so it is inert and painted behind the top layer | nothing; the tooltip has no focus behaviour. It is a rendering bug rather than a focus one, and it is F7 of the escape inventory |
| A hover card over an open Comment/Annotate/Chat dialog (escape pairs 3–5) | **neither** — the card takes no focus and neither dialog traps | harmless today, because focus never left the dialog. This is *why* stage 3's Escape fix had to move to `document` capture: a hover moves no focus |
| BlockGutter opened under an open dialog (pair 6) | neither traps | the gutter restores to `.blk-more` on Escape and on a keyboard toggle, not on outside press, and does not know a dialog is in front of it |
| CommandBar over Annotate/Comment/Chat (pairs 13–15) | **the CommandBar**, correctly — `showModal()` makes the three modeless dialogs inert | the platform restores **the element that was focused before `showModal()`, where it is still eligible** — which in this path is inside the modeless dialog, but the guarantee is about prior focus rather than about that dialog. Corrected after Sol F47, which caught the stronger claim |
| Feedback or Lightbox over the open drawer (pair 16) | **the native dialog** — but `.dock` is z-96, above the scrim, so Feedback *can* be pressed with the drawer open | platform returns to the Feedback button; the drawer never closes, so its `openerRef` is untouched. No conflict |
| Drawer row → CommentDialog | sequential, not simultaneous | **the one case that was actually engineered.** React flushes passive cleanups before setups, so the drawer restores the Comments tab and *then* the dialog records that stable button as its opener. Pinned by `tests/opening-a-comment-moves-focus-into-its-dialog.test.tsx` |

**No lightbox-from-inside-a-dialog case exists — but not for the reason first written here.** The
platform is perfectly willing to stack two modal `<dialog>`s: `Dock.tsx`'s own comment says so, that
`showModal()` while another modal is showing *"stacks two in the top layer and traps focus in the
newer one"*. What prevents it is **the app's own reachability guards**, not a platform rule —
`Dock.tsx § useCommandBarChord` refuses while `dialog[open]` matches, and no other path opens a
second one. Corrected after Sol F47; the original claim was false, and a "cannot occur" resting on a
false platform rule is one refactor away from occurring.

## Two things this inventory does not know

Recorded rather than smoothed over, because a guess here becomes a bug in what gets built from it.

- ~~**`TitleEditor`'s focus-on-open is `ref.current?.select()`, not `.focus()`.**~~ **Settled by
  measurement, 2026-09-07, and the answer is worse than the question.** Real Chrome (system Chrome
  on this box, via Playwright): `select()` on an unfocused input **moves focus to it** — `activeElement`
  goes from the button to the input. jsdom: it **does not** — `activeElement` stays on the button,
  while `selectionStart`/`selectionEnd` are still set to `0`/`5`, so the call visibly did *something*
  and the one thing it did not do is the thing the component wants.

  So the masthead rename **is** focused in production and **is not** focused under test. Any jsdom
  assertion about that input's focus is asking about a different world from the reader's — which is
  precisely the class
  [the stage-3 postmortem](../postmortems/260907b-a-test-blurred-away-the-condition-it-existed-to-test.md)
  named, arriving this time from the harness rather than from a helper. `tests/article-rename.test.tsx`
  pins *"puts focus back on the pencil rather than on the body"*, and `EditableTitle`'s restore is
  conditional on `document.activeElement` being `body` or `null` — so under jsdom that condition is
  reached by a route production never takes.

  **Settled further, by mutation:** replacing the `select()` with a no-op leaves **all 13 tests in
  that file green.** The rename's focus-on-open can be deleted outright and nothing goes red; a
  reader would have to click the pencil and then click again before they could type. The restore
  test passes in both worlds for different reasons — jsdom because focus never left `body`,
  production because unmounting the focused input drops it there. Same assertion, same result,
  different world.
- **Floating UI's `returnFocus` on an outside press** (rows 8 and 9) was read in
  `floating-ui.react.mjs` and not run — and a second reading of the same source agrees the guard is
  real: the trigger gets focus back only where the outside press did not itself land focus on
  something eligible, so **"clicked blank space" and "clicked another control" are different
  answers** and the table's flat "yes" was wrong. Sol F46. It is now marked conditional, and it
  stays *unsettled* rather than resolved, because two readings of a bundle are still not a run.
  **Anything asserting restore for those two must observe it in Chrome**, which stage 5a step 3 now
  says.

## The fork

Making the hover cards keyboard-usable has three shapes and they are not equivalent, so it is put
here rather than decided in a commit:

1. **`FloatingFocusManager modal={false}` around the card**, as rows 8 and 9 already use. Cheapest,
   and reuses machinery that is already in the app. But its `initialFocus` would move focus into a
   card that a *mouse* opened, which is a card appearing under a moving pointer stealing the caret.
2. **Move focus into the card only when the keyboard opened it** — `useHoverCard` already
   distinguishes its open routes, so this is expressible. Correct-feeling and the most code.
3. **Render the card next to its trigger in DOM order instead of portalling it**, so Tab reaches it
   with no focus management at all. **Confirmed to work, in headless Chrome on this box,
   2026-09-07**: with a card placed directly after its trigger, Tab from the trigger goes
   `card's link → card's button → body`, and Shift-Tab from the card's first control returns to the
   trigger. No focus code, correct in both directions. The catch is unchanged and is the reason this
   is not simply the answer: `FloatingPortal` is there for stacking and overflow clipping, so this
   trades a keyboard bug for a possible visual one, and that is not a trade to make blind.

There is also a genuine product edge: **a card the reader can Tab into is a card they must Tab out
of**, on every hyperlink in the article. That is a change to what reading with a keyboard feels like,
and A5 is explicit that a refactor does not get to decide product quietly.
