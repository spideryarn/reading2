# Code review: cluster B stage 2 — every mode band contained (Spideryarn)

You are reviewing, and fixing within scope, one implementation stage in the worktree you are running
in (`/home/greg/code/spideryarn2/.claude/worktrees/contain-modes-inventory`). It is uncommitted. The
house rule: fix what you find inside this stage's files; report anything wider for me to decide. Do
not commit, push, or run `git` commands that change the tree state (no checkout/restore/stash/reset).
Do not touch `.env.local`, infra, or any database.

## What the stage is for

docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md § B ("a broken mode should leave
the article readable"), the stage "extend containment with an honest inventory" — read the whole of
§ B, including the new "Built 2026-09-11" paragraph and inventory table. Until now only Ideas and
Debate had a `FeatureBoundary` (src/web/FeatureBoundary.tsx); a throw in any other mode band's render
reached `AppBoundary` and replaced the whole reader.

## What I did, and my conclusion

- Moved the boundary out of the band switch: `Reader` § `modeBand()` is the old switch (Ideas and
  Debate's per-case wrappers removed); `Reader` § `band()` wraps its answer in the new
  `ModeBoundary` (src/web/reader/ModeBoundary.tsx) with `key={mode}`, unless
  `MODE_CONTAINMENT[mode]` is `exempt` (Plain, Hierarchy — no band).
- `ModeBoundary` reads `?diagram=`, `?referee=`, `?remember=` itself (nuqs), passes
  `bandTarget(mode, sub)` (new, src/web/activation.ts) as the target when the reader owns the article,
  and puts the sub-mode in the reset key.
- `bandTarget` answers from `MODE_TARGET` (fixed/delegated/none), `REFEREE_TARGET` for Referee, and
  `"quiz"` for Remember's Quiz half.
- Added `useRenderCount` to `RememberBand` and `QuizSubBand` so the tests can inject a throw there.
- Tests: tests/a-broken-mode-leaves-the-article-readable.test.tsx, last three describe blocks — a
  completeness check derived from `MODES` (with a synthetic mode that must fail), pinned exemptions,
  16 behavioural throw witnesses (throw injected via a mocked `useRenderCount`), 6 press-retirement
  cases, and a "does not follow into another mode" case.

**My conclusion: a throw inside any band's component tree now leaves the article, the spine and the
dock; the press it would have claimed is retired; and nothing about healthy behaviour changed.**

**The finding I would least like to be wrong about:** that wrapping every band changed nothing for a
healthy reader. In particular: (a) `key={mode}` on the boundary now remounts per mode — check nothing
relied on a band element surviving a mode switch (Chat's `ConversationBand key={mode}` comment, the
Remember/Chat pair, the glossary → chat handoff in `Reader` that is set and consumed in one commit);
(b) that `ModeBoundary`'s own `useQueryStates` for three params cannot cause extra renders or history
writes that change behaviour; (c) that `bandTarget` agrees with what each press actually arms in
every case — `Dock.tsx` `armActivationForMode` with `diagramInSearch`, `DiagramPanel.tsx`'s chip
(`armActivation(slug, k)`), `RefereeMode.tsx`'s chip (`armActivationForRefereeView`), `QuizPanel.tsx`'s
toggle — including the default sub-modes; (d) that a reset-key change when a *healthy* band's
sub-mode changes costs nothing.

Also check honestly: does the inventory table in the plan claim protection for anything that runs in
the parent? Is anything in it false? Are the docs (docs/project/web-client.md § A mode that breaks,
docs/project/new-mode.md table row, docs/project/ideas.md, docs/project/logging.md) accurate?

## Evidence

- Scoped diff: `logs/stage.diff` in this worktree (also readable via `git diff HEAD` plus the new
  untracked file src/web/reader/ModeBoundary.tsx).
- Red run before wiring `Reader`: `logs/red.log` — 22 new cases failed, all on "the fallback does not
  name X" (or the Timeline button hidden behind the experimental switch, since fixed in the test),
  with the throwing mock having run.
- Green after: the file passes 57/57; the four sibling boundary suites pass.
- Mutations: `logs/mutations.log`, produced by `logs/mutate.mjs` — eight mutations, each caught.
- `npm run typecheck` exit 0. Full `npm test` is running separately; I will read it myself.

Run `npx vitest run tests/a-broken-mode-leaves-the-article-readable.test.tsx` and anything else you
need — but **do not run `logs/mutate.mjs`** (it rewrites source files in place while a full suite is
reading them) and do not start a full `npm test` (the box allows three at once). If you want to
test a mutation, do one by hand and put the text back. Write your answer as: findings (severity, file:line, the failing scenario, what you changed or
why you did not), then what you checked and found sound.
