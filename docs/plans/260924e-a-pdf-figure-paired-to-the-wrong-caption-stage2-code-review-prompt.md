You are the code reviewer for stage 2 of docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md in the spideryarn2 repo.
You may edit files to fix what you find **inside this stage** (the files in `git diff --stat`, the new src/pdf-figure-locate.ts and
tests/pdf-figure-locate.test.ts); report anything wider rather than changing it. Do not commit, do not run git commands that change the
index or branches, do not touch any database, and **make no paid model calls** — the tests never do; do not run the scratchpad scripts.

Read first: the plan's "Stage 2 as built" and everything after it; your own plan review of this stage,
docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption-stage2-plan-review-sol.md, and the plan's table of what was done about each of
your findings. Then the diff: `git diff` plus the two new files.

The change in one breath: `interpretOperators` records every image paint (box, clip, clipExact, appearanceExact); `readPdfRasters` returns
paints, views and rotations; `judgeLocatedBox` (pure) decides whether a model's {page, box_2d} names exactly one placeable picture;
`collectPdfFigures` holds locatable refusals, runs a located route one window at a time after the bitmap and drawn routes, stores chosen
pictures through `storeOne`, and writes held refusals afterwards (or in the finaliser, instead of `out-of-time`); the job
`pdf-figure-locate` is registered (models.ts, ai-call.ts, cost-categories.ts, privacy page); the policy is `pdf-figures/5`.

Evidence already gathered: `npm run typecheck` and `npm run cycles` pass; 432 tests in the 18 affected files pass. Every new test was seen
red first, and four were also mutation-checked (rule 4 intruders, the clip rule, the finaliser's held reason, the box offset in the frame
seam test). The final run with the real model on real PDFs (the plan's table) stored all four essay figures correctly, made no call on
the two academic papers, located the misfiled ball-lightning figure, and drew a "none" for a planted foreign caption.

The conclusions I would least like to be wrong about:
1. **No held refusal can vanish or be turned into a wrong reason** — every marker still gets exactly one entry, on every path through
   the new code (the locator throwing, hanging, answering garbage, the clock running out during a render, a call or a store; two markers
   choosing one picture; a window that cannot be read).
2. **Nothing in the test suite or any other caller can reach a paid call by accident** — `locate` is required; check every call site of
   `collectPdfFigures` and `recoverPdfFigures`, and what the pipeline passes.
3. **The collector cannot store a picture `judgeLocatedBox` did not choose**, nor the raster of a different page or key than the one
   chosen, nor one picture for two captions (including against the bitmap route's own pairings).

Also look hard at: `locatedRoute`'s memory (does anything retain decoded rasters beyond the chosen ones?), the `refuse` helper's
condition (a held refusal when `options.locate` is null must be impossible), the sort by page changing which marker "wins" nothing, and
whether `pictureIdentity` hashing multi-megabyte rasters is a cost worth noting.

Run `npm run typecheck` (or `node --import tsx scripts/typecheck.ts` if tsx cannot make its pipe in your sandbox) and
`npx vitest run tests/pdf-figure-locate.test.ts tests/collect-pdf-figures.test.ts tests/pdf-figure-paint.test.ts tests/pdf-figure-read.test.ts tests/collect-assets.test.ts`
after any edit. Report: numbered findings with severity (P0/P1/P2), file:line evidence, and what you changed for each, plus anything wider
you did not change.
