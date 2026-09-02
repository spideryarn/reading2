# Code review prompt — a dev account that is ready to use on every box

You reviewed the **plan** for this earlier today; this is a review of the **built code**, which
carries more weight. Read `CLAUDE.md` first (house rules) and
`docs/reusable/silent-success.md` (most of this repo's bugs are something reporting success while
doing nothing).

- The plan, updated with a "What the review changed" section recording how your six findings were
  handled: `docs/plans/260902d-a-dev-account-that-is-ready-to-use-on-every-box.md`
- Your plan-stage review: `docs/plans/260902d-a-dev-account-that-is-ready-to-use-on-every-box-review-sol.md`

## What was built

- **`scripts/db-seed-dev.ts`** — new. `npm run db:seed-dev`.
- **`scripts/seed-dev-rules.ts`** — new, pure, the testable decisions.
- **`tests/seed-dev-rules.test.ts`** — new.
- **`scripts/setup-local.ts`** — a fourth step in `STEPS`.
- **`scripts/gjd-remote-env.ts`** — `SPIDERYARN_STORE` added to the push-env allowlist.
- **`tests/helpers/load-article.ts`** — header note only, no behaviour change.
- **`.env.example`**, `package.json`, and four docs.

## Evidence from running it, not from reasoning about it

- `npm run typecheck` clean for my files (two unrelated errors exist from another agent's in-flight
  work in `tests/store-roundtrip.test.ts` and `tests/source-scan-notice.test.tsx`).
- `npx vitest run tests/seed-dev-rules.test.ts` — 15 passed. Negative control run: breaking
  `planSlug` to skip on the row rather than the shelf turns the "RETRIES a row that never reached the
  shelf" test red, so that test is not vacuous.
- The **load** path was exercised, not just the skip path: `current_revision_id` was nulled for
  `todo`, the seed detected it as "present but not on the shelf", reloaded 4 steps, republished, and
  the article came back with its 10 blocks.
- End to end: `SPIDERYARN_BASE_URL=http://localhost:5303 npx tsx scripts/browser-sign-in.ts --at
  /read/writes` → `ok signed in as greg@gregdetre.com (f4d08b58-…) … 200 with 11 article(s)`, page
  title `Writes and Write-Nots · Spideryarn`, all 10 API calls 200.
- `GET /api/reader` on the wire returns `"experimentalSince":"2026-09-02T08:21:09.315Z"`.
- Three back-to-back seeds hold that date steady, so the `coalesce` is doing its job.
- Exit code is 1 while `SPIDERYARN_STORE` is unset on this box, as intended.

## What I most want you to attack

1. **Anything that can still report success while the shelf is unusable.** That is the whole point of
   the command. Be specific about the state and how to detect it.
2. **The `expected` bookkeeping in `db-seed-dev.ts`** — which slugs get pushed onto it, in which
   branches, and whether the archived case is right. I believe an archived article should be skipped
   and NOT expected back; check that reasoning and the code that implements it.
3. **The `postgresBlobStore(...)` fence** — is constructing-and-discarding actually sufficient, and is
   it in the right place relative to the first write?
4. **Concurrency.** Several agents share this checkout, one local Supabase and one dev server, and a
   peer `vitest run` was active during my testing (it briefly 404'd `/api/article/writes` mid-run).
   `serialise: true` takes the corpus run-lock. Is that the right lock, and is anything else racy?
5. **Exiting non-zero on the wrong `SPIDERYARN_STORE`** — you argued for this and I took it. Is the
   placement right (after the durable work), and does `npm run setup` behave sensibly given it stops
   at the first failing step?
6. **The `scripts/` → `tests/helpers/` import as built** — does the header note in `load-article.ts`
   say enough, and is there a hidden import-time cost or side effect I have missed?
7. Anything factually wrong in the four docs I changed, especially
   `docs/project/supabase-local.md` § A shelf with something on it.

Rank by severity, cite file:line, and say plainly if something should be cut rather than fixed.
