# Code review: 261007h F1 (one loading line for every band's wait)

**Candidate:** commit `cd1db5533` in worktree `/var/tmp/spideryarn-worktrees/fbrgq3f6-design-consistency`.
`git show cd1db5533 --stat` lists every changed path; start with `src/web/BandWaiting.tsx`,
`src/web/styles/mode-band.css` (`.band-waiting`), `docs/project/loading-spinner.md`, and the callers.
That list does not limit scope. **Other work is in progress in this worktree (tap targets, by a
builder; a review of the skip link and shadow tokens); uncommitted changes outside this commit are
theirs — ignore and do not touch them.**

**Spec:** `docs/plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md`
§ F1 and § "What GPT Sol's plan review changed" (R1–R3); `docs/project/loading-spinner.md` (its
rules: nothing before 600ms; the words are kept; the exception for a turn already sent).

## What to do

You may write. **Fix what is inside this commit's scope**, narrowly and red-first, and **report,
do not fix**, anything wider. Do not commit. Findings to the answer file first, then fixes, then
update the answer with what you changed.

Independent pass:

1. Per caller: is it really a *wait* (a read the reader did not just ask for), not a not-made-yet
   state, and not a line that answers a press? A line that answers a press must show at once
   (the orchestrator set `delayMs={0}` on Referee's two "Reading the paper…" lines for this
   reason — is that right, is it tested, and are there other press-answering lines that were
   wrongly gated, e.g. Search's first answer after pressing find, a forced re-run, Quiz, Skim?).
2. Can a wait line ever outlive its wait, or show after content has arrived (a status flip
   loading→ready→loading; StrictMode double effects; a wait remounted with a new key)?
3. Geometry: the empty box's height before 600ms vs after (no jump); `.band-waiting`'s zero
   specificity against each caller's class (gloss-quiet, quotes-quiet, summ-quiet, sk-wait,
   chat-loading, srch-working, dock-empty, Diagram's box); `as="div"` vs `p` margins.
4. Accessibility: the live region is mounted empty first so the later words are announced; the
   spinner is `aria-hidden`; nothing announces twice (a caller already inside another
   `role="status"`?).
5. Illustrated's `checking` branch shows "Nobody has painted this one yet." with a spinner at
   once; the builder left it. Right call?
6. Tests: run `npx vitest run tests/band-waiting.test.tsx tests/faq-panel.test.tsx tests/quiz-panel.test.tsx tests/ideas-read-states.test.tsx tests/mode-surface-changes-no-markup.test.tsx tests/diagram-panel-hover.test.tsx tests/referee-criteria-panel.test.tsx`.
   Does each changed assertion still fail if the behaviour it names is removed?
7. Docs: loading-spinner.md, web-client.md, the /design note — accurate?

## Severity

P0 data loss / security / charging / broadly unusable · P1 user-visible wrong behaviour or a
contract violated · P2 design or maintainability risk · P3 prose. IDs `E1`, `E2`, …. Refuse only
on an established P0 or P1.

End with `VERDICT: ready` / `VERDICT: ready with these fixes` / `VERDICT: not ready`, and a list of
files you changed.
