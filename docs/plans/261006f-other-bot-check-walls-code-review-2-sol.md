**F8 — P2, established; fixed uncommitted.** The helper dropped the old `tagName === "SCRIPT"` check. Its CSS selector also accepts SVG and MathML scripts, so behavior changed even with unique IDs.

1. **F4 remains intact:** later valid scripts still win. Restoring the element check makes duplicate-ID handling the first shape’s only change.
2. **No lost refusal was found for parsed HTML.** Directly constructed Documents containing uppercase foreign `SCRIPT` elements did lose their previous refusal; the fix restores it. Four constructed articles were newly refused by the candidate. No captured real-article collision was established.
3. **261006k remains accurate.** I added the F8 cause, evidence and fix.

Validation: original **82 passed**; four new regressions failed before the fix; **86 passed** afterward. A 192-case comparison found no remaining first-shape differences with unique IDs. Typechecking and scoped lint passed. Full `npm test` was blocked by database access.

Files changed, uncommitted:

- [src/challenge-page.ts](/var/tmp/spideryarn-worktrees/bot-check-walls/src/challenge-page.ts:79)
- [tests/extract-challenge-page.test.ts](/var/tmp/spideryarn-worktrees/bot-check-walls/tests/extract-challenge-page.test.ts:364)
- [261006k postmortem](/var/tmp/spideryarn-worktrees/bot-check-walls/docs/postmortems/261006k-a-first-id-match-hid-a-later-valid-script.md:32)

With these fixes: *land it*.