# Sixth sweep, S7 and S8: the deploy's robots.txt check, and the Readiness panel's polling interval

Up: [the sixth sweep's umbrella](261006j-sixth-codebase-sweep-umbrella.md), § For Greg item 10 and
the U10 paragraph of § "What the review changed".

Two small fixes to tooling that runs on a higher standard than the app: the deploy script, and the
fleet dashboard. Each was a behaviour change, so each was red first. No deploy was run and the
dashboard was not restarted.

## S7: the deploy judged robots.txt with the weak check

**What was wrong.** `scripts/deploy.ts` § `verifyRobots` asked `hasDisallowAll`: is there a
`Disallow: /` line anywhere in the file? A crawler reads groups. A bot obeys the group that names it
and inherits nothing from `*`. So this file passed, and it leaves every crawler but one unrestricted:

```
User-agent: *
Allow: /

User-agent: Twitterbot
Disallow: /
```

**Which case it was: the same file, the same intent.** `verifyRobots` fetches `/robots.txt` from
`TARGET_HOST`, which is production, or the host given to `--verify-only --host`. Either way the
file is the static `public/robots.txt`. `judgeRobotsTxt` in `scripts/check-public-shell.ts` is
written for that same file: the `*` group and the preview-bot group, each ending `Disallow: /`,
each with exactly the `Allow:` lines it is meant to have, and one `Sitemap:` line. Nothing here
wants a host to disallow everything, so the swap was right.

**What landed.**

- `judgeServedRobots(status, contentType, body)` in `scripts/deploy-checks.ts`: the status, then
  every reason `judgeRobotsTxt` gives. `verifyRobots` calls it and prints each reason.
- `hasDisallowAll` is deleted, with its three tests (eight assertions). Nothing else called it.
- Four tests in `tests/deploy-checks.test.ts`. Two were red before the swap: the Twitterbot-only
  file, and the shipped file with the `*` group's own `Disallow: /` taken out. The comments-only
  control from the postmortem is kept.
- The check's name in the deploy's output now says what it checks.
- `docs/project/deployment.md` says a deploy now runs this one judge, and the
  [postmortem](../postmortems/261005j-keyword-checks-accept-comments-as-restrictions.md) says its
  second remedy is built.

**The simpler option passed over:** importing `judgeRobotsTxt` straight into `scripts/deploy.ts`.
`verifyRobots` makes a request, so nothing could have tested it; the pure function in
`deploy-checks.ts` is the seam the red test needed. That module is where the deploy's other pure
judges already live.

**How we know the real file still passes.** A stricter gate that rejected the shipped file would
block every deploy. `judgeServedRobots(200, "text/plain; charset=utf-8", <public/robots.txt read
from disk>)` returns no problems, and that is now a test. The checker's own `--self-test` (124
cases, no network) passes too, and its shipped-file fixture is written out by hand rather than read
from disk, so the two agree from different sources.

**Importing the checker does not run it.** `scripts/check-public-shell.ts` runs `main()` only when
it is the file that was started (`RUN_DIRECTLY`). `npx tsx scripts/deploy.ts --verify-onyl` still
stops at the unknown argument with nothing run, and `npm run cycles` is clean.

**A consequence to know about.** A change to `public/robots.txt` that the judge does not expect now
fails the deploy's verification, after the deploy has shipped. Change `PREVIEW_ALLOWS` and its
neighbours in the same commit. `tests/site-pages.test.ts` already holds the file to the page list
before a deploy.

**Left alone, and why.**

- The author-facing page (`src/web`, not this cluster's) says only that the deploy checks the file
  answered as plain text. That is now less than the deploy does. It is not false, so it stays.
- `tests/public-readable-sharing-page.test.tsx` asserts `scripts/deploy.ts` does not name
  `check-public-shell`. It still passes, and what it guards is still true: the deploy does not run
  that script's requests, so the `X-Robots-Tag` header is still checked by hand.

## S8: the Readiness panel ignored the server's refresh interval

**What was wrong.** One effect in `tools/fleet/web/src/ReadinessPanel.tsx` both fetched and set the
timer, and left the interval out of its dependencies. It ran before the first answer, set the
120-second fallback, and never ran again. The server's `refreshMs` went unused until Refresh was
pressed. Nobody saw it because the server's default is also 120 seconds
(`tools/fleet/server.ts` § `READINESS_REFRESH_MS`); it shows only when
`FLEET_READINESS_REFRESH_MS` is set.

The old comment justified leaving the interval out by a timer leak. There was none: the cleanup
clears the timer, and a number re-runs an effect only when its value changes.

**What landed.**

- The fetch and the timer are two effects, in a small `useReadinessView` hook in the same file.
  The first fetches on mount and on Refresh. The second sets the timer and depends on the interval.
  A new interval restarts the timer and fetches nothing.
- The clamp is the one that was already there: 15 seconds to 10 minutes, and 120 seconds when the
  answer is not a readiness answer. No new policy.
- The `biome-ignore` on the first effect stays, with a shorter reason: `refreshNonce` is a
  re-run trigger the effect does not read, and `npm run lint:hook-deps` fails without it. The second
  effect needs none.
- `tests/fleet-readiness-poll.test.tsx`, seven tests with fake timers. Four were red before the fix.

**The simpler option passed over:** adding the interval to the one effect's dependency list, which
is the shape `UsageHistory.tsx` has. That effect also fetches, so it fetches again every time the
number changes. Tried as a mutation: six of the seven tests fail against it, including the one
where every answer names a different interval, which becomes a loop as fast as the server answers.

**Sibling panels.** `UsageHistory.tsx` § `useUsageHistoryView` is the only other panel that takes
its interval from the server. It does not share this bug: it keeps the number in state and depends
on it. It does make one extra fetch when the first answer names an interval other than 60 seconds,
and it keeps the last good number, so a failing answer does not change it. Reported, not changed.
Every other fleet panel polls on a constant.

**One behaviour changed besides the fix.** Refresh used to restart the timer as well as fetch. Now
it only fetches, so the next poll can land sooner after a Refresh than a full interval.

## Claims that turned out false

- The umbrella says the swap "deletes `hasDisallowAll` and its six tests". There were three tests
  holding eight assertions.
- The brief suggested `verifyRobots` might be a "must disallow everything" check for a
  non-production host. It is not; see the case above.

## Gates

- `npm run typecheck`: clean, all five projects.
- `npx vitest run` on `tests/deploy-checks.test.ts`, `tests/deploy-refuses-flags.test.ts`,
  `tests/public-readable-sharing-page.test.tsx`, `tests/site-pages.test.ts`,
  `tests/check-public-shell-head-headers.test.ts`, the four `tests/fleet-readiness*.test.ts`,
  `tests/fleet-readiness-poll.test.tsx` and `tests/doc-links.test.ts`: all pass.
- `npx tsx scripts/check-public-shell.ts --self-test`: 124 of 124.
- `npm run cycles`, `npm run lint:hook-deps`: clean. `npm run build:fleet`: builds.
- `npx biome lint` on the touched files: three complexity notes on functions this work did not
  change, nothing new.
