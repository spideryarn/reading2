You are reviewing a PLAN (read-only) for a small bug fix in this repo (Spideryarn). Do not edit files.

Plan: docs/plans/261009l-add-page-private-link-lost-reply-cannot-be-turned-off.md

Code it touches:
- src/web/add-share-link.ts (the `LinkAtAdd` controller: `turnOff`, `send`, `recheck`, `reconcile`)
- src/web/AddShareLink.tsx (draws it)
- src/store/pg-share-link.ts (server store: `turnOff` is idempotent; 404 via `ownedSlug` when no owned row)
- src/routes.ts around SHARE_LINK_PATTERN (the GET/POST/DELETE handlers)
- tests/add-share-link.test.ts
- Origin of the finding: docs/plans/261009i-add-page-sharing-clearer-plan-review-sol.md (the P2 on lost create reply)

Please check:
1. Is allowing `turnOff()` from `unknown` safe and complete? Any state-machine interaction (in-flight recheck, `asking`/`ask`/`asked`/`reconcile` from a reattachment, `held`, `settle`, `retryOnNextAlive`, `jobAlive`, `retire`) that would make the result wrong or let a create be sent by itself?
2. Is mapping the DELETE's answers from `unknown` (200 off -> off; 404 -> off; no answer/5xx -> unknown; other 4xx -> unknown) right? Is 404 truly "no link"? Could the article row exist but the 404 come for another reason (e.g. published article, sign-out 401 vs 404)?
3. Do you agree with passing over the automatic re-read on a lost reply, for the race reason given? If you'd do it differently, say how, concretely.
4. Anything missing in the tests list.

Answer with findings ranked P1/P2/P3, each with file:line, and end with a one-line verdict: BUILD AS IS / BUILD WITH CHANGES (list) / DO NOT BUILD.
