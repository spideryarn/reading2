# Review: the second pass on cost tracking, at the plan stage

You are reviewing a **plan revision, before any code is written**. Attack the plan, not my prose.

## The tree

Repository `spideryarn2`, branch `worktree-cost-tracking-price`, base commit `966513bf` (this
worktree is `96c6db9b`, a merge of `origin/dev` into it). Everything you need is committed and
readable; nothing is pasted below.

**Read first, in this order** (this is a starting point, not a limit on scope):

1. `docs/plans/260902g-cost-tracking-that-can-set-a-price.md` — the plan. **§ Second pass, 2026-09-07
   is the only new part** and is what you are reviewing; everything above it describes work that
   landed on 2026-09-02 and is not up for re-litigation.
2. `src/cost-categories.ts` — the categoriser Stage 6 changes.
3. `scripts/ai-cost.ts` and `src/store/ai-calls-spend-pg.ts` — the report and its SQL, which Stage 7
   changes.
4. `src/db/schema.ts` around line 2626 — the `provider_account` column and what it already claims.
5. `src/models.ts` — `AiJob`, `AI_JOB_WIRE`, `TASK_TIER`.
6. `docs/project/ai-gateway.md` § What stops a reader spending our money — Greg's 2026-09-06 decision
   to decline a per-reader cap.

`git diff 966513bf -- docs/plans/260902g-cost-tracking-that-can-set-a-price.md` is the whole of the
change so far. No untracked files.

## What the job is

Greg's goal, 2026-09-02: *"I want to know how much cost is being incurred … so that we can optimize
that pricing model."* Real paying readers since 2026-09-03. **Measurement and visibility only** — a
cap, quota or throttle is explicitly out of scope and has been declined twice.

The plan was written 2026-09-02, its Stages 1–3 were built the same day, and its status header still
said "planned, not built" five days later — so it was re-dispatched as greenfield work. My first job
was to check whether its three claimed gaps survive. I found all three closed, and the second-pass
section records how each was checked. Stages 6 and 7 are what I propose to build instead.

## Evidence, so you do not have to take my word

`npm run cost -- --owners --all` on the shared dev Postgres, verbatim:

```
UNCLASSIFIED — 9 call(s), $0.0030 ledger, 0.0% of the money
  request / link-summary / —                        9 call(s)  $0.0030
```

`grep -n "providerAccount\|provider_account" scripts/ai-cost.ts src/cost-report.ts
src/store/ai-calls-spend-pg.ts` returns **no matches at all**.

The coverage header prints exactly one credential line: `Paid with 66c3cdfc178e — 1224 call(s),
$45.7218 in credits`.

Live-session coverage line: `0 issued, 0 connected, 0 connected and reported nothing`.

**You have no network and no Postgres.** `tests/cost-categories.test.ts` and `tests/cost-report.test.ts`
need nothing outside the tree — run them if you want. Anything touching Postgres is mine to run; ask
and I will paste raw output rather than have you assume it.

## Independent pass — do this first

Read § Second pass and decide, on your own reading of the code:

- Is the verification table honest? I claim all three original gaps are closed. Find one that is not,
  or a fourth that this pass should have found and did not. Especially: is there a way the ledger's
  numbers are still wrong that neither the original plan nor I have named?
- **Stage 6.** Is a compile-or-test-time guard over `AI_JOB_WIRE` the right mechanism, or does it
  encode a fact that will be wrong (e.g. a job that is legitimately both request-scope and a pipeline
  step)? What should the guard do about `env-proposal`, `eval`, `illustrate`, `pdf-frontmatter` —
  jobs I believe are not request-scope but have not proved so from the ledger?
- **Stage 7.** Is grouping the coverage header by `provider_account` the right shape for "say what
  the cap does not cover"? Is there a way this makes the report *more* misleading — e.g. implying the
  OpenRouter figure is capped-and-safe when the cap is monthly and the report's window is arbitrary?
- Is anything in Stages 6 or 7 over-building against the brief's explicit "no dashboard, no charts,
  no billing UI, no alerting, no forecasting"?
- Is there a **simpler** version of either stage that gets most of the value?

## Severity

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an **ID** (`F1`, `F2`, …), a severity, the file and line, and the smallest fix you
would accept. Grade by consequence, not by which file it is in. End with a one-line verdict: *approve
as written* / *approve after these revisions* / *do not build this*.

## My own suspicions — read these last, and spend most of the run elsewhere

These are already mine and are worth less than anything you find independently.

1. Stage 6's guard may be the wrong altitude. The honest statement might be about `ai_calls` rows
   that exist rather than about the type union — a job in `AI_JOB_WIRE` that never runs in request
   scope is not a problem, and a guard that demands a decision about it is ceremony.
2. Stage 7 risks implying that "inside the OpenRouter cap" means "safe". The cap is a monthly account
   ceiling; a report over an arbitrary `[start, end)` cannot say how close to it anything is. I think
   the report should say what it *cannot* see about the cap rather than gesture at safety, but I may
   be talking myself into a paragraph nobody reads.
3. I decided **not** to run a real live conversation to close Stage 2B's outstanding proof — no audio
   device on this box, and it spends real money on a third billing account in an unattended run. Tell
   me if leaving that outstanding makes the rest of the pass not worth landing.
