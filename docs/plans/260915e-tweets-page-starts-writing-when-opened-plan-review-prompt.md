You are reviewing a PLAN (read-only: do not edit files) in the Spideryarn repo, the current working
directory. Answer in plain prose, findings first, each with severity (P0 blocker / P1 / P2), the
file and line, a concrete failure scenario, and the fix you'd make. End with a one-line verdict:
APPROVE, APPROVE WITH CHANGES, or BLOCKED.

The plan: docs/plans/260915e-tweets-page-starts-writing-when-opened.md. Read it first.

The reader report (Greg, product owner, 2026-09-12): "The Tweets mode should automatically start
generating (if it hasn't already generated) when opened (without having to click a button to kick
it off)".

The conclusion I would least like to be wrong about: **that a mount-driven spend on the Tweets page
(`/read/<slug>/tweets`, its own path) is acceptable where it was deliberately refused for the modes**
(src/web/activation.ts § Why a mount is not a click; GPT Sol's own 2026-09-02 finding that a Back
step must never spend). Attack that argument directly: enumerate every way an owner's tab can mount
`Tweets` with `loaded.status === "none"` without having chosen to go there, and say whether each is
a real exposure. Include: history entries, the command bar, the shelf / last-view restore
(src/web/last-view.ts), the metadata page, redirects in App.tsx/router.ts, a prefetch or
re-render that remounts ArticlePage/OwnedArticle, sign-in/out epoch changes (jobEngine.epoch,
autoAttempts cleared on epoch change around src/web/jobEngine.ts:700), and admin views.

Also check:
1. The proposed effect in the plan (`beginAutoAttempt` then `write(false)`): StrictMode double
   invocation, a status flipping none→loading→none via `refresh` after a failed job, a slug change
   within one mounted Tweets (is it keyed?), and whether `write` being omitted from deps is a bug.
2. Whether `error` status should keep the old "re-read once" behaviour useAutoRun had, given the
   page's error branch draws no button.
3. Whether removing the arming (Link.onNavigate, DockLink pass-through, command-match.ts field,
   CommandBar call, armActivationForTweets) breaks anything else — grep for all users.
4. Whether any server-side spend limit or billing defence is bypassed or needs changing
   (docs/project/billing.md, docs/project/security-map.md). If one would need to change, say so —
   that is out of scope for this change and goes to Greg.
5. Tests: is the evidence list enough to make the change's failure modes red? What is missing?
6. Anything in the plan's prose that is false against the code — there is a half-finished sentence
   under "What stays out" about reloads; say what is actually true (is module state, including
   jobEngine's autoAttempts Set, fresh after a full page reload?).

Relevant files: src/web/Tweets.tsx, src/web/useAutoRun.ts, src/web/activation.ts,
src/web/auto-run-targets.ts, src/web/jobEngine.ts, src/web/Dock.tsx (~1810-1860, ~2850-2915),
src/web/CommandBar.tsx (~270-300, ~620), src/web/command-match.ts (~134), src/web/Link.tsx,
src/web/useStepJob.ts, src/web/article/ArticlePage.tsx, src/web/article/access.ts,
tests/tweets-press-starts-it.test.tsx, tests/pressing-a-chip-arms-it.test.tsx,
tests/command-bar.test.tsx, docs/plans/260906b-opening-a-mode-starts-it-generating.md.
