# Review and fix: five model-call plumbing cleanups (fifth sweep, cluster 12)

Repo: this worktree, branch `worktree-sweep5-c12-model-call-plumbing` (TypeScript, ESM, vitest).
You may edit files. Fix what is inside this change, narrowly and red-first (write or extend the
test, see it fail, then fix). Report, do not fix, anything wider you notice. Do not commit; leave
your fixes uncommitted so I can read them as a diff. Do not touch files outside the manifest below
unless a fix inside this change needs it, and say so if you do.

## The candidate

Committed: `8398d68a5` (R2), `7cc5c3cb1` (R3), `9dfdc96e5` (F11), `17ac8705e` (R6), `46b94d73f`
(X13a), in that order, on top of the plan commit `5f4201d25`.

    git diff 5f4201d25..46b94d73f
    git diff --name-only 5f4201d25..46b94d73f     # the complete manifest, 41 paths

Start with: `src/retry-after.ts`, `src/ai-call.ts` (`apiKey`, `prepare`, `meterBody`, `refuse`,
`openRouterJson`, `ProviderRefused`), `src/messages.ts` (`ANSWER_UNUSABLE`, `CODE_KINDS`),
`src/models.ts` (`pipelineEffortOverride`), and the new tests `tests/retry-after.test.ts`,
`tests/no-key-runners.test.ts`, `tests/load-env-local-census.test.ts`,
`tests/pipeline-effort-override.test.ts`. That is where to begin, not the limit.

## What it is meant to do

The plan is `docs/plans/261004c-fifth-sweep-cluster-12-model-call-plumbing.md`; your own review of
it is `docs/plans/261004c-fifth-sweep-cluster-12-plan-review-sol.md` (F1 to F4, all accepted).
Finding IDs continue from F5.

In short: one `Retry-After` parser (digits-only seconds; a date must start with a letter and is
UTC; a wait that is not positive is `null`); seven unused key pre-checks deleted, the gateway's
`apiKey()` logging the operator line once, no `loadEnvLocal()` in a request path, a census test
that pins which functions may call it; `usage` metered before the status is judged on the JSON and
streaming seams; one `[ai-unusable]` sentence in `src/messages.ts`; one checked reader of
`SPIDERYARN_PIPELINE_EFFORT`.

Invariants it must not break: one spend record per network attempt and none without one; nothing a
provider wrote reaches a message or a log; a reader gets the same sentence as before in every case
except the unified `[ai-unusable]` one.

## What I want

An independent pass first. Run the tests yourself (`node --import tsx` or `npx vitest run <file>`
for files that need no Postgres and no network; all the new ones qualify). Then mutate: for each
new test file, break the code it guards in a plausible *wrong* way (not only by deleting it) and
say whether the suite noticed. Restore every mutation.

Severity: P0 data loss, security, wrong charging, service unusable · P1 user-visible wrong
behaviour or an authoritative contract violated · P2 design or maintainability risk · P3 prose or
comment defect. Mark each *established* or *reasoned*, and each *fixed-by-me* or *reported*.

Also check the comments and docs changed here say what the code now does, and that no pointer to a
deleted name survives anywhere outside the historical folders (`docs/plans`, `docs/investigations`,
`docs/postmortems`).

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

1. `src/retry-after.ts`: the implementer went wider than the plan and appends ` GMT` to *any* date
   that names no zone, not only the asctime shape. A date ending in a named zone other than
   GMT/UT/UTC/Z (say `PST`) becomes unparseable and so `null`. Is the `SAYS_ITS_ZONE` regex right
   (does `\bZ$` or `UTC?` match something it should not, e.g. a month or weekday ending)?
2. `meterBody` is now called on every refused streaming response. Anything in a refusal body that
   `Meter.sawModel` / `sawUpstream` / `sawRoute` would record wrongly (an error body's `provider`
   field naming something other than who answered)?
3. `evals/simple/probe.ts` accepts a `max-…` arm and sets `SPIDERYARN_PIPELINE_EFFORT=max`, which
   went through the old cast and now throws in `pipelineEffortOverride`. `Effort` never included
   `max`. Should the probe's regex drop `max`, or is there evidence `max` was meant to work?
4. The census test parses source with an AST visitor. Is it worth its size, and can it be fooled by
   an aliased import or a re-export?
5. With no key, each runner now also logs its generic "no reply from <model>" failure line after
   the gateway's operator line. Acceptable, or misleading enough to fix?

End with a ledger of every finding ID (F5 onward) and a line `VERDICT: land`, `VERDICT: land after
these fixes` or `VERDICT: do not land`.
