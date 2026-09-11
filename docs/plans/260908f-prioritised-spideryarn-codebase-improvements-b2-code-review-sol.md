No unresolved findings. I found and fixed two containment defects.

## Findings

1. High — [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/contain-modes-inventory/src/web/reader/Reader.tsx:1746), [PublicChrome.tsx](/home/greg/code/spideryarn2/.claude/worktrees/contain-modes-inventory/src/web/PublicChrome.tsx:201)

   `VisitorBand` was rendered beside `band()`. For eight visitor paths—owner-only modes and absent public artefacts—a throw still reached `AppBoundary` and removed the article. I moved the visitor-band choice inside `band()` before `ModeBoundary`, added a render witness, and derived a completeness check from `visitorGap`. A manual mutation returning it before the boundary made all eight witnesses fail through `AppBoundary`.

2. Low — [ModeBoundary.tsx](/home/greg/code/spideryarn2/.claude/worktrees/contain-modes-inventory/src/web/reader/ModeBoundary.tsx:114), [test](/home/greg/code/spideryarn2/.claude/worktrees/contain-modes-inventory/tests/a-broken-mode-leaves-the-article-readable.test.tsx:1539)

   Visitor reset identity included sub-mode parameters visitors ignore. Changing `?diagram=` retried and re-reported a broken visitor Diagram even though visitors remain pinned to Sketch; Referee and Remember visitor bands had the same identity error. Sub-modes now enter the reset key only for owners. The new test failed with two additional render failures before the fix.

3. Low — documentation accuracy — [plan inventory](/home/greg/code/spideryarn2/.claude/worktrees/contain-modes-inventory/docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md:313), [new-mode.md](/home/greg/code/spideryarn2/.claude/worktrees/contain-modes-inventory/docs/project/new-mode.md:43), [web-client.md](/home/greg/code/spideryarn2/.claude/worktrees/contain-modes-inventory/docs/project/web-client.md:153)

   The inventory omitted `VisitorBand`, used stale test/mode counts, and said no test pinned the chat handoff despite two existing suites doing so. I corrected those claims and made the parent-owned passage/mark computations explicit.

   `new-mode.md` rule change:

   - Before: one `WITNESS` entry naming the mode controller.
   - After: witnesses for every composition path—owner band, distinct available visitor band, and `VisitorBand` wherever `visitorGap` can replace it.

## Checked and sound

- `key={mode}` does not discard meaningful healthy state: every real mode arm already changes top-level component type. The only reused component was the stateless `VisitorBand`. Chat and Remember remain distinct compositions, and the glossary → chat handoff tests pass.
- `ModeBoundary`’s `useQueryStates` call is read-only and performs no history write. URL changes can rerender the wrapper, but retain the same child element; a healthy reset-key change does not remount the band.
- `bandTarget` matches the arming seams and defaults:
  - fixed mode targets come from `MODE_TARGET`;
  - Diagram uses the same parsed Sketch default/degradation;
  - Referee uses `REFEREE_TARGET`;
  - Remember arms only Quiz;
  - visitors retire nothing.
- Plain and Hierarchy are legitimate exemptions because neither has a band.
- `ideas.md` and `logging.md` were accurate after the containment fix.

Validation:

- Focused containment plus doc links: 81/81 passed, including 67/67 containment cases.
- Healthy adjacent suites: 191/191 passed.
- Typecheck: all 2,107 covered source files passed. The normal `tsx` launcher hit the sandbox socket restriction, so I ran the same script with `node --import tsx`.
- Targeted lint: no errors; two advisory Reader complexity notices.
- Import-cycle check and `git diff --check`: passed.
- I did not run the mutation script, full suite, commit, or push.