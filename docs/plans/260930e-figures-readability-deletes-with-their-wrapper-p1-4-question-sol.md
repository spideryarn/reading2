Created [sol-p1-4.html](/home/greg/code/spideryarn2/.claude/worktrees/feedback-6a-article-images/scratch-6a/sol-p1-4.html) and [sol-p1-4.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-6a-article-images/scratch-6a/sol-p1-4.ts).

| Arm | `kept` | Sections 0–3 | Image |
|---|---|---|---|
| Shipping | `{"a-figure-its-wrapper-would-take-rolled-back":1}` | all survive | no |
| Protection disabled | `{}` | all survive | no |

The exact original used one caption paragraph containing 47 sentence repetitions—141 commas—and one short link. The built gate therefore never fired: it rejects wrappers with ten or more commas, and the link density was also below 0.2. The saved page is the smallest reproducer I found in the same topology: four comma-free caption paragraphs, two linked, and the accidental positive-weight `story-*` classes removed. Its unshipped treatment loses all four sections and keeps the image, so the shipping fallback correctly rolls Rule C back. `npx tsx` itself was blocked by the sandbox’s IPC restriction; the same script completed successfully with `node --import tsx scratch-6a/sol-p1-4.ts`.