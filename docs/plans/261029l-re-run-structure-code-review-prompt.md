# Code review: Structure on Metadata's re-run list, a command-bar row for Start again, and the arc that no longer fits (261029l)

You reviewed the plan already: `docs/plans/261029l-re-run-structure-from-metadata-and-start-again-from-the-command-bar.md`, with your findings in `docs/plans/261029l-re-run-structure-review-sol.md` and my responses in the plan. This is the code built from it, uncommitted in this worktree. `git diff HEAD` shows all of it. The two generated files (`src/command-pick-catalogue.generated.json`, `src/feedback-endings.generated.ts`) and `evals/command-pick/bar-answers.generated.json` come from their generators.

What changed:

1. **`src/rerun-steps.ts`**: `structure` is first in `METADATA_RERUN_STEPS`. **`src/web/rerun-commands.ts`**: it gets a cost note and a mode. This puts a row on Metadata › AI processing and a *Structure › Run again* row in the command bar. The press is a slug-only forced job, `useStepJob`, the same as Structure's own Try again.
2. **`src/arc.ts` `fitsTree`** and **`src/store/pg.ts` `loadArticle`**: an arc whose entry ranges do not all match a top-level part of the current tree is left out of the payload. The owner's client (`useArc`) then makes it again. This is your plan finding 1.
3. **`src/web/article-commands.ts` `RESET_SECTION_ROW`** and **`src/web/CommandBar.tsx`**: a "Start this article again" row (re-import, reset, start over, …). It shows only while the experimental switch is on, like the reset row it leads to, and it opens `?section=ai-processing`. It does not press anything.
4. Comments and docs were updated (`useStepJob.ts`, `StructureNotice.tsx`, `structure-step.md`, `structure.md`, `experimental-features.md`), and the tests were updated.

Please review for correctness above all:

- `fitsTree` in the load path. Can it drop an arc that is fine? For example, the root has a single child, the tree has no parts, or the arc was built against a different level. Can it keep one that isn't fine? What does a reader who is *not* the owner see (public shelf, shared read), and does dropping the arc there cause a paid regeneration attempt by someone who should not trigger one? Check `useArc` and the `/api/arc` route.
- Does the Structure row's press really force structure, and then labels via the published pending manifest? Check `cascadeForce` and `FORCE_ONLY_WHEN_NAMED`. Does anything in the Metadata rerun row (busy state, the mode link, `RERUN_MODE`) assume a step that has a mode in the band, in a way that Structure breaks?
- The `experimentalOn` param threading in `besideTheModes` and `metadataRows`: are there any call sites missed, and could the row leak when the switch is off?
- Tests that would pass with the code wrong.

The house rule: **fix what you find, inside this stage**, in the worktree. Report anything wider for me to decide. Do not commit. Do not run anything that calls a paid model or touches a remote database. Write your findings, and what you changed, to the output file.
