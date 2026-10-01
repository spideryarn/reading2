# Code review: Annotations' column beside a band mode

You are reviewing built code in the Spideryarn repo (this worktree), write-capable. The plan is
docs/plans/261001i-annotations-column-beside-a-band-mode.md — read it first, including your own plan
review's table and the browser check at the end. The code is commit `eb76050d`; the scoped diff is
docs/plans/261001i-annotations-beside-a-band-code-review.diff (`git show eb76050d` for docs too).

The house rule for this review: **fix what you find inside this stage**, each fix with a test you
have seen fail first, and report anything wider for me to decide. Do not commit; I will read your
diff, run the gates and commit. Do not run the full suite (it takes ~25 minutes and other agents
share the box) — run the files you touch, and `npm run typecheck`.

Look hardest at:
1. Every path that reads or writes `?mode=` / `?margin=`: Reader's Dock `onMode` branch, the command
   bar (`useActivateMode` → `onMode`), the old-link rewrite effect in Reader (`setOldAnnotations`,
   history replace — any loop or race with nuqs or with `useLastView`'s restore?), last-view
   `rememberableSearch`, the metadata page's `modeLinkHref`, `marginInSearch`, visitors.
2. `fitBoth` in layout.ts and what reads `Fit`: `layoutKey`, `--marg-reserve`/`--marg-left` on
   `.reader`, the masthead rule in narrow-window.css (`100% - var(--marg-reserve)`), `.marg-head`
   position, `structureFace`, `band-covers`.
3. The Dock: `MarginToggle` outside the radiogroup in `.dock-modes-radios { display: contents }` —
   accessibility (does `display: contents` drop the radiogroup role in any browser we care
   about?), the fit ladder, `fitSignature`, tooltips grouping, `visibleModes(…, margin)`.
4. `marginColumn()` in Reader: the ModeBoundary with `mode="annotations"` and its way out
   (`onPlain` turns the notes off), the `covered` rule, the ideas feed's lifetime when the column is
   toggled while a band stays open.
5. Anything that still treats `annotations` as a value of `?mode=` and is now dead or wrong.

Write your answer as findings P0–P3 (file:line, what, what you did about it), then a one-line
verdict: land / land after fixes / do not land. Under 1200 words.
