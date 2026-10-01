You are GPT Sol, reviewing and fixing the code built from a plan. You may edit files in this worktree.

**Fix what is inside this change**, narrowly: each finding red-first, with the test that reproduces it,
then the fix. **Report, do not fix, anything wider** you notice, so the caller decides. Do not commit
(the worktree cannot). Do not run the whole suite (it takes ~25 minutes on this box and other agents
share its Postgres); run the test files you touch with `npx vitest run tests/<file>` and
`npm run typecheck` (read its exit code; its ✗ lines go to stderr).

## What was built

Plan: docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md (read the whole
thing, including § GPT Sol's plan review, and what changed — that was your own earlier review,
docs/plans/260929f-tweets-become-a-mode-plan-review-sol.md). The change is commit 89702083 on top
of 9d2932ef; see it with `git show 89702083 --stat` and `git diff 9d2932ef 89702083 -- <path>`.
(The later merge commit ec726554 brings in other sessions' work; only
tests/dock-mode-order.test.ts was resolved by hand there.)

In short: the Tweets thread page became an ordinary mode `?mode=tweets` in a wide band; each post
now carries `blocks` (source block ids, from prompt `tweets/5`) drawn as `BlockRef` links; the old
`/read/<slug>/tweets` redirects; the band still writes the thread on arrival, through a new
`ModeActivation` kind `"arrival"` that arms no token.

## The conclusions I would least like to be wrong about

1. **No stored thread written before today reads *stale*** — through `loadTweets` (src/store/pg.ts),
   Metadata's per-step check (the `case "tweets"` arm in pg.ts), and the public read. And a new
   `tweets/5` thread is current by all of those *and* by the pipeline's `stamp` (src/pipeline.ts)
   on an article with a URL, without a URL, and with no metadata at all (the `fallbackHeadTitle`
   path). Trace `generateTweets`' `sourceHash` against each reader's recomputation, byte for byte.
2. **The redirect cannot loop or lose state**: `liftLegacyTweets` / `liftedTweetsHref`
   (src/web/router.ts) in `settleAddress`, `navigate()` and `useRoute`'s effect; `?at=`, hash,
   encoded `mode` keys, `about=1`, a visitor on a public article.
3. **Arrival writing spends only when it should**: owner only, once per page load, never for a
   visitor, never from a last-view restore (`NEEDS_AN_EXPLICIT_PRESS`), and the empty-state button
   and the automatic run are the same unforced request (`ensure`). Check `useTweets`' `answered`
   ref and error handling for a failed reload that must not blank the thread.
4. **Validation in `buildThread`** (src/tweets.ts): only ids the model was shown survive, in article
   order, ≤3, a post is never dropped for losing its ids; the prompt asks for the shape the parser
   reads.
5. **The wide band** (`bandWidth`, `wideIdeal` in src/web/layout.ts) never makes the page overflow
   and still covers the article below the crossover.
6. Anything in docs/project/mode.md's checklist this change missed.

Also look at the panel (src/web/Tweets.tsx `TweetsPanel`) for a visitor seeing an owner-only
control or sentence, and for accessibility of the per-post links.

## Output

Write your answer as: numbered findings, each with severity (must-fix / should-fix / nit),
file:line evidence, and either **fixed** (name the test you added that went red first) or
**reported** (with the change you propose). End with a one-line verdict.
