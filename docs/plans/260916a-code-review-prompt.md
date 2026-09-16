# Review the built code, and fix what you find

Repo: `spideryarn2` (the product is **Spideryarn**, a reading app). You have `workspace-write`, and
the house workflow is that **you fix what you find inside this stage** and report anything wider for
me to decide. I will read your diff, run the gates and commit.

## What this is

Commit `4c43c21f` on branch `worktree-wt-back-to-x`, answering Sentry `SPIDERYARN-READING2-41`.
The plan is `docs/plans/260916a-back-to-where-you-were-survives-a-mode-change.md` — **read it
first**, it states the design and the reasoning. You reviewed that plan earlier today and made eight
findings (`docs/plans/260916a-plan-review-sol.md`); all eight were accepted and folded in before
anything was written. **Please re-check your own earlier findings against the built code rather than
trusting that I applied them** — you have caught a still-open one that way before.

The scoped diff is at `/tmp/claude-1000/-home-greg-code-spideryarn2/1e684a4a-b24a-48b4-bcb8-7aa5cebb808f/scratchpad/scoped-diff.txt`,
or `git show 4c43c21f`.

## The two changes

1. **A jump stamp now carries a depth and rides every push that stays on the article.**
   `src/web/jump-history.ts` (`JumpStamp`, `readStamp`, `withStamp`, `oneFurtherBack`),
   `src/web/router.ts` (`stampFor`, the `pushState` wrapper, `useJumpStamp` / `useJumpOrigin`),
   `src/web/ReturnChip.tsx` (`history.go(-depth)`).
2. **A layout change re-anchors the reader to `?at=`.**
   `src/web/reader/useReadingPosition.ts`, a new `useLayoutEffect`.

## Evidence, so you are not reviewing prose

- `npm run typecheck` — exit 0.
- Every suite touching these modules, found by grepping `tests/` for the changed symbols rather than
  from the list of files I edited: `comment-jump`, `deploy-checks`, `eager-client-graph`,
  `jump-history`, `permalinks-follow-the-address`, `reading-position-holds-across-a-reflow`,
  `return-chip`, `spine-jump-origin`, `spine-marks`, `scroll-glide`, `url-state`, `doc-links`.
  **354 passed, 0 failed.** The full suite is running separately.
- **Mutation-checked rather than re-read.** `oneFurtherBack`'s `depth + 1` → `depth`: all five
  sequence tests go red. Re-anchor skipped while gliding (the design you refused): its case goes
  red. `was.at !== at` guard removed: its case goes red. `abandonScroll()` removed: its case goes
  red, and only that one once a test-isolation leak was fixed.

## What I most want you to attack

- **The depth arithmetic, again, against the code this time.** `stampFor` in router.ts. Is there a
  sequence — Back, Forward, a truncated forward stack, a second jump, a replace, a `popstate`, a
  nuqs-abandoned write, `dismissJumpOrigin` on an intermediate entry, a cross-document navigation
  and a return — after which `depth` no longer names the origin's distance? Construct it.
- **The rollback story.** `VERSION = 2`, no `from` key. Confirm the *old* `readStamp` (in
  `git show HEAD~1:src/web/jump-history.ts`) really returns `null` for what the new `withStamp`
  writes, and that the old `withStamp(state, null)` really clears it. If either is false the
  mitigation is theatre.
- **`useJumpOrigin` is now derived from `useJumpStamp`.** Does that break any
  `useSyncExternalStore` invariant, cause an extra render in `Spine.tsx`, or change the identity
  guarantees the cache comment in router.ts claims? The cache key is `JSON.stringify(stamp)`, which
  now includes the depth, so the origin object's identity changes when only the depth changes.
- **The new `useLayoutEffect`.** Is `{ layoutKey, at }` in a ref the right seam? Does it fight the
  restore effect, the spy, `watchBarVisibility`, or `swipe.ts`? Is `useLayoutEffect` correct here or
  will it cost a synchronous layout on every mode switch on a 2,000-block article (there is a real
  performance history here — see `docs/project/performance.md` and the 4.7-second mode switch)?
  Does re-anchoring on *every* layout change — a gist-column toggle included — surprise anybody?
- **What I changed in existing tests.** Two assertions in `tests/return-chip.test.tsx` and one in
  `tests/jump-history.test.ts` were deliberately reversed. Check I have not quietly weakened a
  guard while claiming to reverse a rule — particularly GPT Sol F6 of 2026-09-06, whose test I
  re-drove with `dismissJumpOrigin` instead of a same-URL push.
- **The finding I would least like to be wrong about:** that the pathname-only inheritance rule is
  *provably* right because a same-document push adds exactly one history entry. If there is any way
  for a `pushState` in this app not to add exactly one entry — or for our wrapper to be called for
  something that is not a real push — the whole design fails and I need to know now.

## House rules

- TypeScript + ESM, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Prefer boring; prefer simple over easy; simplest version first.
- Comments carry intent, not descriptions of the code. Do not add a comment restating a line.
- `npm run lint`'s baseline is not clean — the one biome error in `useReadingPosition.ts` (the spy
  effect's dependency list) is pre-existing on a line this commit does not touch.
- Never run `git checkout --`, `git restore`, `git stash`, `git reset --hard` or `git clean`.

## Output

Fix what is inside this stage, in the working tree. Then write, to the answer file: a numbered list
of what you found, what you changed, and what you deliberately did not; anything wider for me to
decide; and a one-line verdict.
