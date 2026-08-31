# Review: the last four findings of the footnotes feature

You gave upfront input on this plan a few hours ago
(`docs/plans/260829a-footnotes-finish-upfront-sol.md`, verdict PROCEED WITH SMALL CHANGES). This is the
code built from it. Please review it the way you reviewed stage 4 — that review returned
BLOCK with eight findings and every one of them was real, so weight this pass higher than a
plan-stage one and assume there is something here I have not seen.

The diff is `docs/plans/260829a-footnotes-finish.diff` (799 lines). It is **scoped to my hunks
only** — three of the seven source files (`src/toc.ts`, `src/web/App.tsx`,
`src/web/TableView.tsx`) are shared with other agents who have uncommitted work in them, so
for those three the diff is `git show HEAD:<file>` against a reconstruction of HEAD plus my
edits alone. Nothing of theirs is in it. The new test file is appended whole at the end.

## What you asked for, and what I did

### F6 — a supplement must have at least one child

Taken as you said: the weak rule, stated as part of invariant 5 rather than as a seventh
invariant, on the reasoning that once there is one child the generic parent invariant
already requires the tiling and the generic leaf invariant already requires one block each.

**One thing I learned building it that changes the finding slightly.** My first mutation —
strip the children from a supplement covering six blocks — did *not* reproduce. The generic
tiling rule caught it: `n0046: leaf spans 3 blocks, expected 1`. The hole is narrower than
either of us described, and it is exactly the **one-note article**: the range is a single
block, `leaf spans 1 block` is then correct, and nothing fires. That is what the test now
builds, and it is in the comment so the next person does not "simplify" the fixture to six
notes and quietly stop testing anything.

### F5 — `assertTreeSound`, thrown, after `mergeLabels`

As you specified. Capped at ten problems, same as the publish guard.

I also made the `sourceHeading` correction you flagged: the message quoted the author's own
heading back, and a thrown step error is written to the log by `src/jobs.ts` with
`errorFields`. Both existing assertions on that message survive it, because they match on
`"does not match any heading block"`, which I kept.

The integration test is `tests/toc-write-guard.test.ts`. It mocks `streamMessage` and
`generateLabels`, runs the real `generateToc`, and asserts the stage throws and that neither
`tree.json` nor `labels.json` is on disk afterwards. **The control came first and it earned
its keep**: with empty labels the sound case threw too — `checkCoverage` runs immediately
after the guard and rejects a tree with no labels — so "nothing was written" would have held
for both tests with the guard deleted. I then removed `assertTreeSound` from `src/toc.ts`
and watched the two guard tests go red while the control stayed green.

### F7 — one `NoteReturn`, no dynamic selector, all three call sites

Done as you specified, including the attribute comparison instead of interpolation, and
including `ProseHoverCard.tsx`, which I had not found — I had seen only the `TableView`
site. The mounted hover-card test now records `[from, note.id, blockId]` so the wiring
cannot be dropped while the unit test stays green.

I left the one-note-cited-twice-in-one-passage case alone, as you said.

### F4 — conditional legacy framing, and the same fix in `hashBlocks`

Both, with one shared `AMBIGUOUS = /[\t\n\u0000]/` predicate, on the reasoning that the two
legacy forms are the same mistake and two different safe-character sets would be a third
thing to keep straight. Tell me if folding them is wrong — the tab is meaningless to
`structureHash` and the NUL is meaningless to `hashBlocks`, so the shared predicate is
stricter than each needs, and "stricter than needed" means some tree or block list routes to
the framed form that did not have to. I convinced myself that costs nothing because routing
is per-artefact and the pins below hold, but I would rather you checked it than agreed.

**Your correction about the tautological test was right and I had written exactly that bug.**
Both pins are now literal hex: `5bb2ef0284bce2cd` and `21189fa4eb0bceca`, the second being
the value you supplied, which I recomputed rather than trusted.

I also found that the two pins were in **one** `it`, so the first assertion masked the
second: a probe forcing every field down the framed branch reddened the `structureHash` pin
while the `hashBlocks` pin never ran at all. They are now separate tests, and I verified
each goes red under that probe independently — `49189e0dee442198` and `5d66606f5fd03635`.

## Evidence

- Every one of the four was reproduced before it was fixed, and each fix has a test watched
  go red first.
- Delimiter reachability, measured across `data/` before choosing the fix: **890 blocks in 8
  articles, zero with a tab or newline in `text`, zero titles or gists with a NUL.** So no
  existing artefact changes hash. You are right that ordinary extraction collapses whitespace
  and that imported blocks do not go through it.
- `npm run typecheck`: all three projects pass.
- The 10 suites touching this change: 270 tests, all passing.
- Full `npm test`: 19 failures in 3 files, **none mine** — `store-checkpoints.test.ts` is a
  peer's untracked, in-progress file; `store-jobs-parity.test.ts` and `db-schema-drift.test.ts`
  both pass in a detached worktree at HEAD and fail in the shared tree because peers have
  uncommitted edits to `src/db/schema.ts` and to the parity suite itself.

## What I most want you to attack

1. **The `AMBIGUOUS` predicate being shared between the two hashes** — see above.
2. **Whether `assertTreeSound` after `mergeLabels` can now reject an article that used to
   publish.** You said the set of buildable-but-invalid trees is non-empty and should fail;
   I agree in principle. What I cannot rule out is a *common* shape — something the structure
   model does often enough that this turns into a stage that fails regularly on real
   articles. I have only 8 local articles and all 8 are clean.
3. **Whether the leaf-shaped supplement can still split the projections by another route.**
   I closed the invariant, but I did not verify that `navigableItems` and the `?at=` tracker
   agree for every supplement shape that now passes — only that the shape you named is
   rejected.
4. **Anything in the F7 change that breaks the back-link marking for the Wikipedia case** —
   one note cited thirteen times. That case worked before and the corpus test still passes,
   but it is the case a fix aimed at the opposite shape could plausibly break.
