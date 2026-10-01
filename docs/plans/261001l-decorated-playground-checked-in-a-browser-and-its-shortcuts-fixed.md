# Decorated playground: checked in a browser, and what it found fixed

Feedback report spya-ptyszp (SPIDERYARN-READING2-8B), Greg, 2026-10-01, Overseer queue item
qi-34246zwk:

> Have a look at decorated.html in a browser, and check that everything is still working correctly,
> inspect for errors, test the keyboard shortcuts if you can, take screenshots, etc. Fix any issues.

The page is `experiments/decorated/decorated.html`, the Decorated-mode playground
([README](../../experiments/decorated/README.md)). It sits outside `src/`, and nothing in the app
imports it.

## What the check found

Before the browser check:

- `node experiments/decorated/verify.mjs` passes.
- `build.mjs` rebuilds the committed `decorated.html` byte for byte, but only after copying
  `data/noema-mythology-of-conscious-ai/comments.json` across from the primary checkout (see the
  last section).

The browser check used Playwright against system Chrome, at 1440×900 and at 390×844 with touch.

On load there were no console errors and no uncaught exceptions at either width. The checks that
worked:

- the panel, all 24 layer switches and the four presets
- hold-`x` and hold-`s`
- Escape
- tooltips, cards and their pins
- the section gates
- copying a single paragraph

Defects, each confirmed with measurements or a screenshot:

| # | Defect | Cause |
|---|---|---|
| 1 | **Copying across paragraphs puts our role labels in the clipboard**, glued to the author's text: "…against our interests.implicationPerhaps most of all…". There were 22 labels in a 30-paragraph selection. This breaks the page's own promise, and `verify.mjs` stays green. | `.role-tag` is `user-select: none` in CSS, but the copy handler's strip list in `page.js` leaves it out, and `cloneContents()` ignores `user-select`. `verify.mjs` only checks the CSS list. |
| 2 | **A held key gets stuck on.** Hold `s` or `x`, Alt-Tab away and let go: skim or x-ray stays on, because the keyup never arrives. | Nothing listens for `blur`. |
| 3 | **Modifier combos fire the shortcuts.** Ctrl/Cmd+L (the browser's address bar) toggles the panel, and Ctrl+S flashes the skim path. Caps-lock `S` does nothing on keydown, and a keyup that arrives as `S` is ignored. | The keydown handler never looks at modifiers, and compares `e.key` case-sensitively. |
| 4 | **Phone: "all on" or "everything Greg asked for" makes the page 414px wide on a 390px screen.** Prose is clipped at the right edge, and the fixed **layers** button can end up off-screen. Close the panel after "all on" and there is no way to reopen it without a keyboard. | The L-gravity layer shifts paragraphs sideways by up to 1.5rem. With no margin column on a narrow window, that pushes them past the edge. |
| 5 | **Phone: the prose runs edge to edge**, at x = 0 and 390, while the masthead and section titles have about 24px of padding. | The narrow-window block sets `--gutter` and `--margin` to 0 and adds nothing back. |
| 6 | **Phone: a card can be wider than the screen.** Its left edge sits at −8 to −24px. | `max-width: 26rem` is 416px, and the left clamp in `showCard` loses to the right clamp. |

Things it found that are not defects, and what happens to each:

- **The article's embedded YouTube video makes network requests**, and one stats ping fails. That
  is the author's own embed, and the page renders it as stored. No change.
- **On a phone, x-ray and skim can't be *held*.** The panel's checkboxes switch both on and off,
  and fixing defect 4 means the panel can always be reached. Deferred: a touch version of "hold"
  is a design question, not a bug.

## The fixes (simplest first)

1. **Copy.**
   - Add `.role-tag` to the copy handler's strip list.
   - Add `.role-tag` to `verify.mjs`'s `MUST_BE_UNSELECTABLE` list.
   - Make `verify.mjs` also check that every selector in that list is in `page.js`'s strip list. It
     reads the strip list out of `page.js`'s source, the same way it reads the CSS.
   - Add a control for the new check: drop a selector from the strip list and watch it fail.

   Red first: add the verify check before the `page.js` change, and watch it go red on `.role-tag`.
   The strip list will name `.seam-title` and `.seam-gist` explicitly rather than relying on
   `.seam`, so the check compares like with like.
2. **Keys.**
   - Ignore keydown when Ctrl, Meta or Alt is held.
   - Compare `e.key.toLowerCase()`, so caps lock works.
   - A keyup with any modifiers still releases, so a release is never lost.
   - Add `blur` and `visibilitychange` listeners that release both held states. The release leaves
     x-ray on if its checkbox is on, matching the existing keyup rule.
3. **Narrow windows (≤1180px).**
   - Turn L-gravity's lean off, the way reduced-motion already does: it has no margin to lean
     into.
   - Give the prose side room by keeping `--gutter` and `--margin` at 1.5rem rather than 0. The
     columns' contents are still hidden, so the empty tracks become the page's side padding.
4. **Card.** Set `max-width: min(26rem, calc(100vw - 16px))`.

Then rebuild, run `verify.mjs`, and re-run the browser check at both widths, including the copy
probe and the phone "all on" overflow.

**Tests.** `verify.mjs` is this directory's test, and it is not wired into `npm test`. The new copy
check lives there, with its control. Keys, CSS and the card have no automated check: this is a
playground, and a browser re-check is proportionate. Run `npm test` and `npm run typecheck` anyway,
as the gates.

## Considered and passed over

**One shared apparatus list, imported by `page.js`, `page.css` and `verify.mjs`.** It removes the
drift class entirely. But CSS cannot import a JS list, so it would mean generating the CSS rule in
`build.mjs`. That is more machinery for a playground than the check-the-copies route, which catches
the same drift.

## Deferred, and why

- **A touch way to hold x-ray and skim.** This is a product question for when Decorated leaves the
  playground.
- **`build.mjs` only runs where the old filesystem store's `data/` snapshot is complete.** That
  snapshot is gitignored, and a fresh worktree lacks `comments.json`. The committed
  `decorated.html` is the built artefact, so the page itself is unaffected. Rebuilding it from the
  database instead is a rewrite of `build.mjs`'s inputs, out of scope here. The README will say
  where the inputs come from.

## Outcome (2026-10-01)

Built as planned, with changes from the two GPT Sol reviews and the browser re-check.

From the plan review, all four points were taken:

- `verify.mjs` reads the strip list out of the **built** `decorated.html`, not out of `page.js`. A
  stale build can't pass on a fixed source.
- `.seam` stays in the strip list as the ancestor that covers `.seam-title` and `.seam-gist`.
- A selection that strips down to nothing writes an empty clipboard, rather than falling through to
  the browser's own copy.
- `l` ignores auto-repeat.

From the code review: the narrow-window `translate: none` lost on specificity to the
`[data-connective]` rules, so the lean was still on. It is now `!important`, the same as the
reduced-motion rule. Sol fixed it inside the stage.

From the browser re-check, two more copy fixes:

- A selection that sits inside a single seam title clones to a bare text node, with no element to
  strip, so it copied the title. The handler now asks whether the selection's common ancestor is
  apparatus.
- Paragraphs pasted glued together ("rights.It matters"), because blocks have no whitespace between
  them in the markup. They are now joined by a blank line.

Copying out of a gate's textarea is left to the browser.

To let `verify.mjs` find the strip list, it is now one named constant, `APPARATUS`, in `page.js`.
Its control drops `.gate` from that constant and checks the omission is caught.

Final browser check: Playwright, system Chrome, at 1440, 800 and 390. Everything passed:

- `scrollWidth` equals `clientWidth` in every preset.
- Prose has a 24px margin on a phone.
- Cards stay on-screen.
- Copy is author-only, with paragraphs kept apart.
- The keys behave, including blur, modifiers and auto-repeat.
- No console errors. The only warnings are two from the article's own YouTube embed.

Screenshots were taken in the session scratchpad, not committed.
