# Review the BUILT code, not the plan

You reviewed this plan twice (`docs/plans/260903e-glossary-delete-in-postgres.md`, and your reviews
at `-review-sol.md` and `-review-sol-2.md`, the second of which said **ready to build**). It is now
built. **This review is weighted higher than the plan reviews** — a plan-stage review cannot find a
method that writes one field and then rejects the request.

Repo root is the working directory. **Please run test files yourself** — your sandbox allows it, and
a finding you reproduced outranks one you reasoned to.

## What to read

- **The scoped diff of the source changes** is at
  `/tmp/claude-1000/-home-greg-code-spideryarn2/a0d058f6-5374-4445-87f8-3a2351133856/scratchpad/built.diff`
  (615 lines). Read it first.
- The two new store files in full: `src/store/pg-glossary.ts`, `src/store/require-slug.ts`.
- The two new tests: `tests/store-glossary-delete-pg.test.ts` (10 store-level cases),
  `tests/glossary-delete-then-rebuild.test.ts` (the integration test you asked for).

## What you asked for, and where it went

1. **The 409 predicate** — implemented as a typed Drizzle join in `liveJobHoldingADraftQuery`
   (`src/store/pg-glossary.ts`) rather than the raw SQL you wrote, using the existing `leaseIsLive`
   from `src/store/job-fence.ts`. **Check it is the same rows and the same semantics.** This is the
   single thing I most want re-checked, because a subtly wrong predicate either refuses readers who
   should be allowed or lets the race back in.
2. **The integration test through the real claim/session path** — `glossary-delete-then-rebuild.test.ts`.
   It stubs only `STEPS.glossary.run`. Is it actually exercising the real coordinator, or has the
   stubbing hollowed out the thing it claims to test?
3. **`FOR UPDATE` asserted in rendered SQL** — a case in the store-level test.
4. **`requireSlug` extracted to a leaf** plus `pgVisibilityStore.set` fixed and both added to
   `tests/store-slug-guard.test.ts`.
5. **The stale comments** — `src/db/schema.ts`, `src/store/pg-revisions.ts`, `src/store/pg.ts`,
   `src/web/useGlossary.ts`. Are the replacements *true*? I have already shipped one wrong comment
   in this area and would rather not ship its replacement.

## Specific things to attack

- **`result.rowCount === 1`.** The implementer used this rather than the `rowsOf` helper I named,
  arguing `rowsOf` reads `.rows` off a raw `execute` and does not fit a Drizzle `.update()`. Is
  `rowCount` reliable here with this driver, and is `=== 1` right rather than `>= 1`?
- **Transaction scope.** Is anything done inside the transaction that should be outside it, or vice
  versa? Is the lock held longer than it needs to be?
- **The 409 message reaches the reader verbatim** via `guardDbStore` and `useGlossary`'s catch.
  Confirm `guardDbStore` really does pass a tagged 409 through unscrubbed, and that the wording is
  right for somebody who is not a developer.
- **`{ deleted: false }` when `currentRevisionId` is null** — right, or should that be a 404?
- **Anything the tests assert that is not actually true**, or that would pass for a bad reason.
- **Anything I have missed entirely.**

## Known and deliberately not fixed here

The browser check found the reader's panel does not refresh after the job finishes. That is a
pre-existing bug — `trimFinished` deletes a success in the same call that marks it done once an
owner holds 50 failures, so no job is ever polled as `done`, for any mode. Written up in
`docs/postmortems/260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md`.
**Do not review the glossary work as though that were its fault**, but do say if you think the
postmortem's reasoning or its ranked fixes are wrong.

## What I want back

A verdict — **ship** or **do not ship** — then findings, most serious first, each naming what is
wrong and what it should be. Say which findings you reproduced and which you reasoned to. Be blunt.
