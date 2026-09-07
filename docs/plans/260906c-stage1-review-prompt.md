# Review: eight mode controllers moved out of a 5,920-line React file

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition`, branch
`worktree-a1-a3-reader-composition`. TypeScript + ESM + React 19 + Vite + vitest/jsdom.
`strict` and `noUncheckedIndexedAccess` are on.

## The candidate

Committed, two commits:

```
f103698b  Four mode controllers leave App.tsx for homes of their own
1360ec84  The last four list-shaped modes leave App.tsx, and a guard that had stopped guarding
```

```sh
git diff f103698b~1..1360ec84
git diff --stat f103698b~1..1360ec84   # the complete manifest
```

Start with `src/web/App.tsx`, `src/web/modes/*/`, and
`tests/referee-copy-is-about-the-model.test.ts`. That is where to begin, not the limit of scope —
the manifest above is.

The plan is `docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md`
(§ "Stage 1"), and you reviewed it twice: your answers are
`docs/plans/260906c-plan-review-sol.md` (F1–F8) and `260906c-plan-review-sol-2.md` (F9–F13).
The authority above both is `docs/plans/260905e-main-app-architecture-review.md` §§ A1, A3.

## What it is meant to do

**A pure relocation, with no interface change and no behaviour change.** Eight mode controllers,
their visitor twins and their private hooks move from `src/web/App.tsx` into
`src/web/modes/<feature>/<Feature>Mode.tsx`, following the shape
`src/web/modes/ideas/IdeasMode.tsx` set on 2026-09-05. `App.tsx` goes 5,920 → 4,150 lines and now
exports only `App`, `RememberBand` and `ConversationBand` — the last two are stage 2's job and
deliberately stay.

The only licensed edit to moved text is `function X` → `export function X` on bands that `Reader`
renders and that were module-private. Both commits carry a script proving each moved region is
byte-identical to what left `App.tsx`; the second one requires a **contiguous, unique** substring
match, so ordering and adjacency are pinned too.

**Nothing else may have changed**: no refactor, no rename, no reformat, no comment improvement, no
merging of the deliberately-duplicated passage-mode effects (that is stage 4a).

The invariant most at risk is the one your F4 named: **a dozen tests read `App.tsx` as a string and
slice it with `indexOf`.** When a subject leaves the file, `indexOf` returns `-1`, the slice runs
from the end, and the assertion passes against an empty string — green while checking nothing
(`docs/reusable/silent-success.md`).

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run test files
(`npx vitest run tests/<one>.test.ts`) and build throwaway harnesses under `/tmp`. No network.

I ran, on this exact tree: `npm run typecheck` clean (1,406 files, three projects); the 26 test
files touched by these commits plus their neighbours — 379 tests, all passing. Pre-existing
failures on this worktree, established **before** these commits and none of them in this area:
`admin-store` ×2, `hierarchy-deepen-wave`, `pdf-source-parsed-once`, `store-export-fails-closed`,
`chat-web-links` (a linear-growth timing assertion), and four in `shelf-action-tooltips` (another
agent's in-flight work). All are timeouts or timing under a load average of ~100.

## Attack it

Independently, before you read my questions below.

The invariant to break: **is there anything in these two commits that is not a pure relocation, or
any check that used to bite and now does not?** Two specific shapes to hunt:

1. **A source-text test that has quietly stopped checking.** Every `readFileSync` of a `src/web`
   file in `tests/`, and whether its anchors still resolve. A guard that names its file only in a
   comment is not a guard.
2. **Moved text that is not byte-identical**, or a moved region whose *order* changed. Verify this
   yourself against `git show f103698b~1:src/web/App.tsx` rather than trusting my scripts — and if
   my scripts are wrong, that is the finding.

Also worth your attention: whether any import that only the moved code used is still in `App.tsx`
(dead) or was dropped while something else still needed it; whether the new files' relative
specifiers (`../../`) all resolve; and whether `tests/eager-client-graph.test.ts`'s static closure
still covers what it claims now that four directories are new.

For each finding: an ID (**numbering continues above F13**), a severity, established or reasoned,
(a) the input or mutation that shows the failure, (b) the smallest change that closes it.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

A finding with no (a) goes last. Refuse only on an **established** P0 or P1, and name what
established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. `tests/referee-copy-is-about-the-model.test.ts` got three structural changes for your F4:
   recursive discovery, seeding the surface set with `RefereeMode.tsx` itself, and resolving
   specifiers from the importing file. Is the seed actually load-bearing, is the recursion complete,
   and is there a fourth way for a surface to leave that set silently?
2. `src/web/modes/referee/RefereeMode.tsx` is 531 lines holding a band, a chip row, two `Record`s
   and a switch. I deliberately did not split it further in a relocation stage. Right call?
3. Several moved docblocks now say "the branch above", "`SearchBand` below", "the shortest band in
   this file" — cross-references that were true inside one file and are now merely resolvable by
   name. I left them verbatim on purpose. Where is that actually misleading rather than just less
   local?
4. `docs/project/search.md` has an ASCII pipeline diagram whose column alignment was adjusted by
   hand. Does it still line up?

Do not change any file.
