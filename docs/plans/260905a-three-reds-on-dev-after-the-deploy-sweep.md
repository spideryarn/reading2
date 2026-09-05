# Three reds on `dev` after the deploy sweep

A [get-ready-to-deploy.md](../reusable/get-ready-to-deploy.md) run on 2026-09-05 pulled ten commits
into the shared primary — a fast-forward, so nothing here was caused by a merge I made. `npm run
check` came back with typecheck, build, cycles and chain green and **three test files red out of
663**. All three are in committed code, which makes them mine to fix.

## What is red, and why

| File | Cause | Verdict |
|---|---|---|
| `tests/fixture-ids.test.ts` | uuid `…0000ed` claimed by `public-dispatch.test.ts` (twice) and `public-visibility-pg.test.ts` (`NEIGHBOUR_ID`) | real |
| `tests/shared-notice-hides-with-the-masthead.test.tsx` | asserts a hardcoded substring of `SHARED_WITH_YOU`, whose copy changed under it | real |
| `tests/pdf-bundle-trace.test.ts` | the `@vercel/nft` trace takes 441s and the budget was 120s | real, but the clock and not the bundle |

All three reproduce alone, so none of them is the parallelism flake I expected — but they want
different fixes, and the third wanted measuring before it wanted touching.

### 1. Two test files, one uuid

`fixture-ids.test.ts` exists precisely to catch this: vitest runs files in parallel against one
database, so whichever file tears down first deletes the other's fixture row and every test in the
other 404s — **while passing when either file is run alone**. That is
[silent-success.md](../reusable/silent-success.md) in its nastiest form, and the guard firing is the
system working.

Two branches each reached for the same low id and merged without meeting.

The fix goes to **`public-dispatch.test.ts`**, not to `NEIGHBOUR_ID`, and which side matters:
`public-visibility-pg.test.ts` really does insert and tear down an article under that id, while
`public-dispatch.test.ts` only builds an impostor user in memory to watch it be refused, and never
reaches Postgres. So the file with no row gets the new id.

Not the guard's `NOT_A_ROW` exemption either, which was my first thought: **that key is the uuid**,
so exempting it would have excused the neighbour row too and left the guard blind to exactly the
collision it exists to catch. Its own docs say to reach for it "only when nothing in the suite
creates the row at all", and something does.

### 2. A copy change that walked past its test

`SHARED_WITH_YOU` now reads *"This article was shared publicly…"*; the test asserts the old
*"shared this article with you"*. The test's own comment says why the assertion is there: so that
"a component that rendered nothing but the right class could not pass".

The simpler option I am passing over is editing the string in the test to match the new copy. It
would go green and it would break again the next time anybody touches the wording. Asserting
against the imported constant keeps the stated intent — the notice really rendered its text — and
cannot go stale.

### 3. A check that got honestly slower

I expected the box, at load 60–90 on 16 cores. It is not: the file timed out run alone too. So I
ran the same `nodeFileTrace` call outside vitest, against the same `api-dist/vercel.js`, and timed
it — **441s, and every assertion the test makes passed**: all six `MUST_SHIP` files traced, both
`MUST_NOT` absent, no `.node` binary, no unresolved warning.

That is the difference between raising a timeout to silence a red and raising it because the work
is genuinely long. Every property this test checks passed; the budget was the only thing that did
not. Raised to 600s, with the measurement in the file so nobody has to take it on faith — and the
raised test then ran green, 2/2.

**What that measurement does not establish is *why*.** It is one timing under load ~85 with no
controlled comparison, so "it got slower because the bundle grew" is a candidate, not a finding —
contention may be most of it. GPT Sol was right to push on this and the wording in both places now
says only what was measured.

**Worth somebody's attention separately:** the trace collected **4,413 files**. The comments in that
test record 2470 when it was written and 3,031 after the 2026-09-03 lazy-import change — so the
function bundle has grown about 45% since. Nothing the test forbids is in there, so it is not a
failure, and chasing it is not a deploy sweep's job. But it is the number that turned a 120s budget
into a 441s run, and it will do it again. By file count alone, though — no byte figure, no declared
ceiling, no failing deployment constraint — so it is a thing to look at, not a reason to hold this
up. Sol agreed on that.

## Stages

1. **Both fixes, with the reds reproduced first.** Watch each go red alone, fix, watch it go green.
   Then confirm `pdf-bundle-trace` alone, and say plainly which of the three were real.
2. **GPT Sol on the diff**, then commit and push to `dev`.

## Done looks like

`npm run check` green on the three files that were red, the rest of the suite no worse than the
12136 that passed, and a report that says what was real and what was the box.
