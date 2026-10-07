# The command bar's *Run again* row honours the rewrite hold

Up: [plans.md](../project/plans.md) ·
umbrella: [261006m](261006m-seventh-codebase-sweep-depth-umbrella.md) § Where this stands, item 5 ·
the cluster that found it: [261007b](261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one.md)
§ Left (GPT Sol's C4) ·
postmortem: [261007h](../postmortems/261007h-a-typed-entry-point-skips-the-hold-the-button-has.md)

## What

A forced re-run pressed in a mode holds every forced control there until a fresh read shows its
result ([`rewrite-hold.ts`](../../src/web/rewrite-hold.ts)), so the old result on screen cannot buy a
second paid run. Thirteen mode hooks use it. The command bar's *Run again* rows
(`CommandBar.tsx` § `rerunRows`) posted `{ force: [step] }` straight to the queue and never asked,
so typing `rerun faq` over a held FAQ bought a second run. Reproduced and pinned in 261007b.

## The fix

The row asks the same hold before it posts. `rewrite-hold.ts` exports `rewriteHeld(slug, step)`,
which is the check `run` already makes on its first line (`holdAt(keyOf(slug, step))`), and the row
refuses with a sentence when it is true:

> FAQ was just run again and hasn't loaded yet. Open it to see the result first.

`RERUN_LABEL[step]` supplies the name. **A new reader-facing sentence, for Greg to veto.** It says
how to clear the hold because a hold whose job ended with no band mounted stays up until a band
reads again; opening the mode does that.

## What it does not do

**The row does not take a hold of its own.** Taking one needs the identity of the artefact on
screen, which only the mode hook has, and the row leaves for Metadata anyway, where `RerunRow`
shows the job. That is the position Metadata's own re-runs are already in (excluded from the guard
with their reason). Making the bar take a hold would mean a registry of mounted identities: a
second mechanism, which this brief rules out.

## The simpler option passed over

**Hide the row while held**, as `quotesFindMoreOffered` hides *Find more*. The list is memoised
without a subscription to the hold (CommandBar.tsx § `commands`), so a hidden row could stay hidden
after the hold released until another dependency changed, and the reader would be told nothing.
Refusing at the press reads the hold at the moment it matters and says why.

## Red first

`tests/rewrite-hold.test.tsx` § *the command bar's Run again refuses while the mode's rewrite is
held (C4)*, formerly *pins C4*: same setup (FAQ held, the rewrite finished, its GET in the air),
now asserting a `stay` with the sentence, no navigation, and one POST. Against the unfixed row it
failed: `expected { kind: 'close' } to deeply equal { kind: 'stay', … }`. Green after: 373 passed,
18 skipped in the file.

## Gates and review

`npm run typecheck` clean (3,384 files). `rewrite-hold`, `command-bar-rerun-and-find`,
`find-more-commands`, `command-match-rerun-and-find`, `command-match-mode-aliases`,
`command-bar-sub-modes` and `doc-links`: 528 passed, 18 skipped. Every `useRewriteHold` call's
`step` was checked against `METADATA_RERUN_STEPS`: all match, Illustrated has no row.

**GPT Sol's code review: PASS**, two P3 doc corrections applied by the reviewer (this section's
memoisation sentence; the postmortem's window, which is longer than the completion GET when a read
fails or the mode is left closed). [Prompt](261007i-command-bar-run-again-row-honours-the-rewrite-hold-code-review-prompt.md),
[answer](261007i-command-bar-run-again-row-honours-the-rewrite-hold-code-review-sol.md).
No browser pass.
