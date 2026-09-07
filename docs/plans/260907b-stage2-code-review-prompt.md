# Review the built code for stage 2

You reviewed the plan for this job earlier and returned no P0; your finding **P2-R4** is what this
stage became. This is the **built code** review — weight it higher than the plan review, because a
plan-stage review cannot see what the implementation actually did.

## What to read

Working tree `/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain`, branch
`worktree-api-dispatch-by-domain`.

- **The change**: commit `3fd9e5c1`, one file, +68 lines. `git show 3fd9e5c1`.
- **The file**: `tests/cacheable-covers-artefact-routes.test.ts`.
- **The plan**: `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md`, § *Stages*
  (stage 2) and constraint **8** in § *The constraints anything here must respect*.
- **Your plan review**: `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain-review-sol.md`.

`src/routes.ts` is unchanged by this stage — `git diff HEAD -- src/routes.ts` is empty. Confirm that.

## What the stage claims

The test derived every artefact route by grepping `src/routes.ts`, and a miss was `filter`ed away,
so a route that stopped matching silently vanished from the test's universe rather than failing.
The change adds `ROUTELESS_KINDS` (the eight `SHAPE` kinds that are pipeline stages, not URLs) and
one assertion that the kinds which failed to resolve are **exactly** that set — bidirectional, so a
lost route is named and a gained one has to leave the list deliberately.

The implementer also reported a finding that changed the plan: **a pure rename of a binding
(`timeline` → `timelineRoute`) does not break the test**, because `bindingOf` captures the name out
of the declaration rather than assuming it. What goes quiet is the *declaration form* changing —
rewriting one matcher as `TIMELINE_PATTERN.exec(path)`, which is exactly the module-scope hoist a
later stage contemplates, dropped that route entirely: 19 tests instead of 20, with both
pre-existing controls still green.

## What I want from you

1. **Is the new assertion actually bidirectional, and does it fail for the right reasons?** Or is it
   a restatement of what the grep already returned — a check that agrees with the code because it
   shares an assumption with it?
2. **Is `ROUTELESS_KINDS` a hardcoded list that will rot?** Eight kinds are named as having no URL.
   If one gains a route, does the test fail helpfully or confusingly? If a *ninth* kind is added to
   `SHAPE` with no route, what happens?
3. **Verify the implementer's rename finding.** If a pure rename really is behaviour-neutral here,
   then the plan's earlier claim (and my own review's framing) was wrong about where the silence
   lives, and I want that confirmed rather than taken on trust.
4. **Does this stage leave the file in a state that survives stage 3?** Stage 3 extracts per-domain
   functions and may hoist regex literals to module scope. Say plainly whether this test will fail
   loudly or quietly when that happens.
5. **Anything the implementer reverted that it should not have.** It had also edited
   `owner-isolation.test.ts`, `source-store.test.ts` and `embedding-route-failures.test.ts` and
   reverted all three on your P2-R4. Check those three really are unmodified and really did not need
   the change.

## Ground rules

- **Do not modify any file.** Read and reason only.
- You can run this test file — it needs nothing outside the tree. `npx vitest run
  tests/cacheable-covers-artefact-routes.test.ts`. A result you reproduced outranks one you reasoned
  to. Anything needing Postgres is mine to run.
- Severity and an ID on every finding: **P0** breaks security or correctness, **P1** a real bug,
  **P2** a judgement call, **P3** a nit.
- If the change is fine, say so briefly rather than manufacturing findings. A short review is a
  valid outcome here.
