# Stage 1 review prompt — the 415, the bucket check, and the swallowed error

You are reviewing **code that has already landed on a branch** (not a plan). Weight this higher than
a plan-stage review: a plan review cannot find a write that goes to the wrong project, and this
change contains a write path to production.

Working tree: `/Users/greg/dev/spideryarn/reading2/.claude/worktrees/illustrated-415-mac`
Branch: `worktree-illustrated-415-mac`. The scoped diff is at
`/private/tmp/claude-501/-Users-greg-dev-spideryarn-reading2/30d48fe1-626c-4185-80fe-248a1005b23c/scratchpad/stage1.diff`
(1383 lines, `f0a396c1..HEAD`, restricted to the files this stage touched).

Read these first: `docs/plans/260903j-illustrated-415-and-one-click-paint.md` (part one only — part
two is a later stage and is NOT in scope),
`docs/postmortems/260903f-the-bucket-allowlist-drifted-again-on-production.md`,
`docs/postmortems/260828a-the-config-file-is-not-the-bucket.md`, `AGENTS.md`,
`docs/reusable/silent-success.md`, `src/env.ts` (the `.env.local`-beats-the-shell rule).

**Please run tests yourself** — your sandbox allows it, and a finding you reproduced outranks one
you reasoned to:

```
npx vitest run tests/storage-buckets.test.ts tests/deploy-checks.test.ts tests/collect-assets.test.ts
```

Do NOT run anything with `--prod`, and do not attempt any network call to `*.supabase.co`.

## What happened

Production's Supabase `sources` bucket allowed only `application/pdf` and `text/html`.
`supabase/config.toml` has declared five types (adding `image/png`, `image/jpeg`, `image/gif`) since
2026-08-29, but nothing in this repo reconciles a bucket that already exists, so every image upload
to production 415'd.

The reported symptom was one missing illustration. The real damage: the `assets` step is in
`DEFAULT_INGEST_STEPS`, took the same 415 on every image of every article ingested since 2026-08-30,
caught it, reported success, and left the images hot-linked to the publisher — which is the reader-IP
leak that step exists to close. The only trace was one log line reading `storageErrors: ["Error"]`,
because the code recorded `(err as Error).name`.

Worse, the check built after the *previous* instance of this bug (`260828a`, one month earlier)
could not be aimed at production at all: `check-buckets.ts` calls `loadEnvLocal()`, and `.env.local`
deliberately beats the shell environment, so the invocation documented in its own header printed
`✓ every declared bucket matches the running project`, exit 0, about the local Docker container.

Production has since been repaired with the new `--apply`, with the owner's approval; a real
`image/jpeg` POST now returns 200 where it returned 415.

## What this stage changed

1. **`scripts/storage-buckets.ts` (new)** — target selection and I/O, shared by `check-buckets.ts`
   and `deploy.ts` so the gate and the repair cannot disagree about what "production" means. The
   pure judgement (`bucketDrift`, `declaredBuckets`) stays in `scripts/deploy-checks.ts`.
2. **`scripts/check-buckets.ts`** — `--prod` (via the shared `readEnvProd`), `--apply`,
   `--allow-narrowing`; prints `Target: <origin> (from <file>)` above the verdict in every mode.
3. **`scripts/deploy.ts`** — a Storage drift gate before migrations.
4. **`src/collect-assets.ts`** — `describeStorageFailure` replaces `err.name`; redacts URLs and
   JWTs, caps each message at 200 chars, and bounds the array at 5 distinct entries plus `+N more`.

## What I most want you to attack

Be adversarial and concrete. I would rather have three findings I can reproduce than twenty
observations.

1. **The write path.** `--apply` writes to production. Can any input, flag combination, argument
   ordering, or malformed `.env.prod` make it write to a project the operator did not intend — or
   make the printed `Target:` line disagree with the project actually written to? `targetLine` and
   the fetch/PUT must not be able to come apart. Is `whyNotProductionStorage`'s positive
   classification (`https://<ref>.supabase.co`) actually airtight, including for hostnames that
   `new URL` and `fetch` parse differently?
2. **The narrowing guard.** `narrowings` is what stops `--apply` silently removing a MIME type,
   lowering the size limit, or flipping `public`. Find a real state where a destructive change slips
   through without `--allow-narrowing`, or where `allowed_mime_types: null` (accepts anything) is
   mishandled. Note that `declaredBuckets` parses TOML by hand — can it produce a `DeclaredBucket`
   that makes `narrowings` under-report?
3. **The deploy gate.** Does it actually fail the deploy, or can it record a problem that nothing
   acts on? It reads `config.toml` at the sha rather than from the working tree — is that consistent
   with how its neighbours behave, and does it do the right thing when the file is absent at that sha?
4. **The redaction.** `describeStorageFailure` is now logging a message that was previously never
   logged. Can anything sensitive survive it — a signed URL, a service key, a JWT in an unusual
   shape, a publisher URL (which is reading history)? Order of the two `.replace` calls matters.
   Also: the 200-char `slice` runs *after* redaction — convince yourself that is the safe order.
5. **The bound.** `boundStorageErrors` caps distinct entries at 5. Is the cardinality genuinely
   bounded now, and is `+N more` computed correctly?
6. **Anything that reports success while doing nothing.** This whole stage exists because a check
   printed a tick about the wrong machine. Look for a second one — especially any place a test would
   pass whether or not the code under it ran.

## Known and NOT findings

- `npm run check` fails `test` and `cycles` in this tree. Both are peers' work in a shared checkout:
  `cycles` is 16 parse errors on markdown-fenced JSON under `evals/results/`, and the test failures
  are `fixture-ids` (a UUID collision between `admin-page.test.tsx` and a peer's new
  `pricing-page-current-plan.test.tsx`), `paid-cli-ledger`, `store-jobs-parity` and
  `store-shelf-reads`. None touch storage or assets. Don't report these; do tell me if you think I
  have misattributed any of them.
- Part two of the plan (the one-click Sketch→Illustrated chain) is not built yet. Out of scope.
- The reader-facing sentence `Storage put failed (415): …` is deliberately unchanged.

If you find nothing serious in an area, say so plainly rather than manufacturing a finding. If you
think a design decision is wrong rather than a bug, say that separately and say what you would do.
