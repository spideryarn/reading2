# Stage 5a code review: Tab, click-away, and the focus that comes back

You reviewed this plan's stages 1–4 (F1–F48) and stage 5's plan. **Stage 5a is now built and
committed.** This is a code review of what landed. Weight it higher than the plan reviews, as you
have argued before.

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface`. Everything below is
committed (`3381e700`, `38a7cca6`) and on `dev`; nothing is untracked — verified with
`git ls-files --error-unmatch`, since you caught that misdeclaration twice (F27, F30).

**5a is explicitly preparatory and does NOT tick A5's modal/modeless checkbox.** 5b — the hover
cards, which are `role="dialog"` with a link and a button inside, portalled to the end of `<body>`,
keyboard-openable and keyboard-unusable — is unbuilt and waiting on a product decision from Greg.
That split was your F43. **Please check I have not quietly widened 5a into "done enough".**

## What to read

The plan's § *Stage 5* and the review-log entries at the end;
`...-focus-inventory.md`; then the code:

- `src/web/ChatDialog.tsx` — focus restore, and the `?thread=` arm's focus target
- `src/web/RefereeCard.tsx` + `src/web/modes/referee/RefereeMode.tsx` — surface 17
- `tests/chat-dialog-gives-focus-back.test.tsx`, `tests/referee-how-card.test.tsx`
- `tests/tab-traversal-in-chrome.test.ts` — the new real-Chrome traversal check
- `tests/lightbox-backdrop.test.tsx` and the backdrop describes added to
  `tests/feedback-dialog.test.tsx`, `tests/illustrated-view.test.tsx`,
  `tests/sketch-zoom-and-peek.test.tsx`, `tests/command-bar.test.tsx`
- `tests/profile-panel.test.tsx`, `tests/search-colour-picker.test.tsx` — outside-press
- `tests/article-rename.test.tsx` § *the editor takes the keyboard when it opens*
- `docs/project/keyboard.md` § *Tab, and the surfaces it walks through*

## The four things I most want attacked

1. **`tests/tab-traversal-in-chrome.test.ts` is a new kind of test here and I may have got its
   epistemics wrong.** It renders the real components with `renderToStaticMarkup` and walks Tab in a
   real Chrome. Effects do not run under SSR. I argued that costs nothing because focus navigation is
   a property of the DOM and the top layer — **is that actually true for these two components?** And
   is the modeless assertion (`seen` must contain `after`) strong enough, or does it pass for reasons
   other than the absence of a trap? Both directions were watched red, but a mutation I chose is not
   the same as one you would.

2. **The `ChatDialog` focus restore had two bugs its own tests found, and I want to know if there is
   a third.** The opener is captured during first render (because child effects run before parent
   effects, so an effect would capture the composer instead of the reader's control), and the cleanup
   asks "was the focus I am about to destroy inside this panel" (because React runs cleanup before
   detaching, so a `body` test never fires). Both are subtle enough that I doubt my own coverage. In
   particular: `useState`'s initialiser can run more than once under StrictMode — does that break the
   capture, and is `[opened]` the right dependency?

3. **I decided NOT to build Annotate's focus restore**, which was half of your F42. The reason: it is
   reachable only via `onMouseUp` after a drag across the prose, and I measured in real Chrome that a
   drag across non-focusable text blurs the previously focused element to `BODY` — so it opens from
   body and returns to body, losing nothing, and there is no keyboard route in at all. **Is that
   reasoning sound, or have I missed a route in?** Touch, a screen reader, `Select All`, a
   `selectionchange` path, anything. If there is one, this is a defect I have argued away.

4. **`keyboard.md` § *Tab, and the surfaces it walks through* is a rule doc now.** Is anything in it
   false, and is the modal/modeless split the right way to cut it? It claims twelve of seventeen
   surfaces have no trap and ten of those are correct — check the count and the claim.

## Two things I recorded rather than fixed

Say if either should have been built instead:

- **Chat loses the caret when a draft becomes a thread** — the composer is unmounted by the swap,
  before the dialog closes at all. You noticed this too. I left it, on the grounds that the right
  destination is the thread's own composer and choosing it changes what happens after the reader
  presses Enter, which is product rather than repair. A test pins only the half that is this stage's
  business (that the close control does not steal the caret on that swap).
- **An inside press on the two Floating UI popovers is protected by two independent mechanisms** —
  `getFloatingProps()`'s capture handler and a native containment check — and removing either alone
  leaves the suite green. Only removing both reddens the test. Recorded in the test rather than
  worked around.

## And the standing question

**Name a mutation that should be caught and is not.** That has been the most useful thing you have
produced on this plan three times running — the CLI exit code, the clipped head, the missing
rectangle. Assume I have not thought of the one you are about to name.

## How to answer

A table: severity, what is wrong, what you would do. Say plainly whether 5a is honestly scoped or
whether it has crept. If a decision recorded above is wrong rather than merely unargued, say so in
those terms.
