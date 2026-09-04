# Building the hierarchy failed on MN10

**[SPIDERYARN-READING2-S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-S)** · reported
2026-09-03 13:22 UTC · resolved 2026-09-04 · *already fixed, undeployed at the time*

## What the reader saw

Adding `https://www.dhammatalks.org/suttas/MN/MN10.html` stopped part-way with the message the app
gives when a step throws:

> Building the hierarchy did not finish. What went wrong has been recorded for whoever supports this
> app, and a step that stops like this often comes out differently on a second attempt — so trying
> again is worth a go. [jb-step-again]

## What we did

Nothing to the code. The bug was real and is already gone: the article hit `MalformedJson` in
`parseJsonFrom`, and `parseJsonAnswer`
([260903k](../plans/260903k-model-json-answer-extraction-in-the-shared-parse-seam.md), commit
`e04e879d`) fixes exactly that.

**The interesting part is the timing**, and it is why this report needed checking rather than
believing:

- the build serving the failure was `edfa8fb`, committed 2026-09-03 11:15 UTC;
- the failure was at 13:22 UTC;
- the fix was committed at 16:25 UTC — three hours *after* the failure, five after the build.

`git merge-base --is-ancestor e04e879d edfa8fb` says no, and `--is-ancestor e04e879d origin/main`
says yes. So the reader met the bug in the window before the fix shipped, and it is live now.

Sentry has the linked error that proves the chain rather than merely suggesting it:
`SPIDERYARN-READING2-R`, `MalformedJson` at `parseJsonFrom`, 13:19:49 UTC, tagged `step:hierarchy`
and `slug:mn10-spya-np5eep`, on release `edfa8fb` — three minutes before he pressed Feedback.

**Verified by running it, not by reading it.** The whole pipeline against that exact URL on a tree
containing the fix: fetch 92.6 KB → extract 70,536 chars → 195 blocks → hierarchy exit 0, 235 nodes,
194/194 blocks labelled in 3 calls, 2 misaligned boundaries repaired, $0.25 → `validate-tree` says
`✓ structure is sound`. A doc claiming a fix is not evidence; a run is.

## What this says about the reports generally

A report is a photograph of a moment, and the moment has a build id on it. `build_commit` is on
every feedback event — check it against the fix before assuming a bug is live, or you will spend an
afternoon re-fixing something that shipped while the reader was typing.

No postmortem: the bug already has one home in `260903k`, and a second account of it would be a
second place for the story to drift.
