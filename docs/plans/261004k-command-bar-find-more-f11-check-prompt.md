# Narrow check: the fix for F11 (round two; discovery is closed)

Your code review of this work
(`docs/plans/261004k-command-bar-find-more-code-review-sol.md`) ended `do not land` on **F11**: a
loaded but stale job snapshot let the command bar's *Find more* press start a paid run beside a job
this tab had not heard of. You fixed F10 yourself; that fix is committed as `3ee0e0f` or its
successor (see `git log --oneline -4`). F11's fix was written afterwards by someone else and is
**unreviewed code**.

## The candidate

Commit `b01b5a2ef` only: `git show b01b5a2ef`. Paths: `src/web/jobEngine.ts`
(`afterFreshList`), `src/web/find-more-handoff.ts`, `src/web/useFindMoreHandOff.ts`,
`tests/find-more-waits-for-a-fresh-job-list.test.tsx` (new),
`tests/find-more-from-the-command-bar.test.tsx`, `tests/find-more-commands.test.tsx`, and three
docs. Other uncommitted files in the tree (`evals/`, `docs/investigations/`, `docs/user-feedback/`)
are a separate job in progress; ignore them and do not edit them.

## What to do

Check **this fix and nothing else**: does it close F11 as you stated it? Specifically: can a job
list whose request started before the press release the press; can the waiter fire the press late
(after the ten-second ceiling, after a session change, after the band unmounts); does
`afterFreshList` change anything for the engine's existing subscribers; is a waiter leaked when
the hand-off is replaced, taken or expires. Run
`npx vitest run tests/find-more-waits-for-a-fresh-job-list.test.tsx tests/find-more-from-the-command-bar.test.tsx tests/find-more-commands.test.tsx`
and the job engine's own tests (`tests/job-engine*`).

You may fix a defect in this fix, narrowly and red-first. Do not commit. Do not open new discovery
on the rest of the change.

Known and accepted, not a finding: a run that starts elsewhere between the fresh list being fetched
and the band's POST can still double up, because the server does not dedupe across profiles. That
window is one round trip and is the same one the band's own button has.

## Output

`F11: closed` or `F11: still open`, with evidence (file:line), then any defect in the fix itself as
`F13`, `F14`, … with severity (P0–P3, by consequence) and established/reasoned, and whether you
fixed it. End with one line: `VERDICT: land` / `VERDICT: land with my fixes` / `VERDICT: do not land`.
