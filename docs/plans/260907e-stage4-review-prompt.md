# Review: Stage 4 — every environment variable read under `src/` must be inventoried

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907`,
branch `worktree-worktree-postmortem-preventions-260907`. TypeScript + ESM, `tsx`, vitest,
TypeScript 7 (no TS compiler API — static checks parse with `@babel/parser`).

You reviewed the plan (F1–F6) and Stages 1–3 (F7–F9, twice, in two concurrent reviews — so `F7` and
`F8` have each been issued twice, by you, for different things; **number new findings from `F10`**).
**This review is Stage 4 only.** Stages 1–3 are committed and are not in scope.

## The candidate

Live pre-commit; base `3e191ee5` (Stages 1–3 are in that commit's history).

- Modified: `src/vercel-health.ts` (+73/−0 — five `EXPECTED` entries and a comment; no logic changed)
- Untracked, new, and the bulk of it: `tests/env-names-are-inventoried.test.ts` (965 lines)
- Also untracked and **context, not candidate**: `docs/plans/260907e-*.md`,
  `docs/postmortems/260827b-health-check-green-while-uploads-dead.md` (a correction I made, see
  below)

`git diff 3e191ee5 -- src/vercel-health.ts`

Not durable — I will record the resulting commit SHA in the plan doc once it lands.

## What it is meant to do

`docs/postmortems/260827b-health-check-green-while-uploads-dead.md`, § *Four things it still does
not reach* item 1 and § *What would have caught the class*. `EXPECTED` in `src/vercel-health.ts` is
a hand-maintained list of the variables a deployment needs, and **hand-maintained drift is the
entire cause of the incident that postmortem is about**. Nothing made it agree with what the code
reads. This check does.

**An important correction, which I have already written into that postmortem.** It claimed the check
"would have gone red at `2405408`". You found in the plan review (F5) that it would not:
`SUPABASE_SERVICE_ROLE_KEY` was already in `EXPECTED` at `4dcc580` and still there at `2405408`, so
a membership test stays green through the introducing commit. I verified that with `git show`. The
check is therefore built for the **drift** case it does catch — `SPIDERYARN_OWNER_ID` was read by
`src/owner.ts` and absent from `EXPECTED` — and the postmortem now says so. **Do not re-derive
this**; treat it as settled.

The safety rule I imposed, and want checked: **no entry added in this stage may be able to turn a
working deployment's health warning-red.** An `EXPECTED` entry with a `breaks` clause produces a
warning when the variable is unset. So every one of the five added is `breaks: null` (report-only).
Deciding a variable is genuinely *required* is a production judgement for Greg, not for this check.

Out of scope, deliberately: deriving requiredness from one declaration (the postmortem's *other*
recommendation, and the one that would actually have caught its own incident); `.env.prod` name
diffing; anything touching a defence.

## Evidence I already have — check it rather than repeat it

Built by a subagent; I verified the parts below myself.

- **Red first**, before any allowlist or `EXPECTED` entry: **31** names unaccounted for, including
  `SPIDERYARN_OWNER_ID` at `src/owner.ts:271`. Split 5 → `EXPECTED` (all `breaks: null`) and 26 →
  `ALLOWED` in five reasoned groups.
- It resolves **43 distinct names across 69 read sites**, including six indirect reads:
  `process.env[CONST]` for four module-local constants; `process.env[envVar]` where
  `const envVar = MODEL_ENV_VAR[task]` (`src/models.ts:1092`) yields 12 names; and `process.env[name]`
  inside the local `seen(name)` helper at `src/fetch.ts:602`, resolved from its two string-literal
  call sites.
- Anything else **fails closed** with file, line and expression.
- Eleven fixture-driven negative controls are built into the file, in `describe("the check itself")`.
- **My own independent mutation**: removing `PGAPPNAME` from an allowlist group goes red naming it,
  `src/db/client.ts:139`, and both ways to fix it. Restored.
- `npm run typecheck` exits 0 with zero `✗`; `biome check` clean on both files;
  `tests/health.test.ts` 31 passed, so the new entries do not disturb the reporter; the new file is
  15 tests green.
- Full suite: `4 failed | 804 passed | 1 skipped`. None of the four is this change —
  `cold-start-lazy-imports` and `pdf-bundle-trace` both fail on `api-dist/vercel.js is missing`
  (this worktree was never built), and `extraction-inventory` and `metadata-page-order` both pass
  when re-run alone (this box goes red from contention).

## What you can and cannot run

Tree read-only; `/tmp` and node_modules caches writable. **`tests/env-names-are-inventoried.test.ts`
needs nothing outside the tree — run it.** `tests/health.test.ts` needs Postgres and will skip; its
result above is mine, run here. No network, not even loopback.

## Attack it

Independently, before my questions.

1. **Can a real environment read escape the sweep?** This is the finding I most want. Enumerate the
   spellings it does not resolve and say, for each, whether it fails closed (red — safe) or is
   silently skipped (green — the bug). `process.env` destructured; aliased as
   `const e = process.env`; `globalThis.process.env`; a constant imported from *another* module;
   `MODEL_ENV_VAR` reached by a different expression; a computed member on `import.meta.env`; a
   template literal; optional chaining; `Reflect.get`. **A silently-skipped read is a P1 here**,
   because the whole subject is a check that agrees with the code by not looking.
2. **Is the `src/fetch.ts` helper resolution sound?** It resolves a local function's parameter from
   its call sites. The subagent hit a real bug building it — `seen` is both the helper at `:602` and
   an unrelated parameter at `:1642`, and a file-wide scan made it refuse two credentials it could
   read — and fixed it with a `scopeOf`. Check that fix rather than take it: can the wrong function's
   call sites be attributed, or a shadowed binding be confused?
3. **Is the `src/vercel-health.ts` reporter exemption too wide?** `value(name)` there reads names out
   of `EXPECTED` itself, so a name cannot be missing from the list it is being read from. It is meant
   to be scoped to that one function, not that file, and there is meant to be a control that trips if
   the exemption stops firing. Verify both.
4. **Is the `src/env.ts` whole-`process.env` exemption sound?** Four uses that name no variable
   (spread/argument). Is a one-file exemption right, and does a whole-env use anywhere else go red?
5. **Are the five `EXPECTED` entries correct and safe?** All `breaks: null`. Does adding them change
   what `/api/health` reports in any way that matters — the endpoint is public — or affect its `ok`?
6. **Is the allowlist honest?** 26 names in five groups. Is any of them actually a deployment
   setting that has been waved through, especially among the 12 `SPIDERYARN_*_MODEL` overrides?

For each finding: an ID from `F10` upward, a severity, and whether **established** or **reasoned**.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1. Verdict: land it, land with the changes you name, or do not
land it.

## My own suspicions — read these last

Worth less than anything you find independently.

- Question 1 is the one that matters. A 965-line test is a lot of surface for a check whose failure
  mode is silence, and I would rather hear "these four spellings vanish" than a tidy verdict.
- **`SPIDERYARN_OWNER_ID` has a real case for a `breaks` clause and deliberately does not have one.**
  `environmentOwnerId()` (`src/owner.ts:270`) throws when it is unset and `NODE_ENV === "production"`
  or `VERCEL` is set — I checked. Under my own safety rule the subagent left it `breaks: null` and
  flagged it as Greg's call in the entry's comment. Tell me if leaving it report-only is the wrong
  call given that it genuinely does break the deployment; I will still not add it tonight, but I want
  the recommendation recorded.
- `SPIDERYARN_BASE_URL` is the weakest of the five entries: production reads no variable at all
  (`isProductionDeployment()` answers `PUBLIC_ORIGIN` first), so it only bites on previews. It may
  belong on the allowlist instead.
- The file is long. If a third of it is ceremony that earns nothing, say so — "this is bigger than
  the thing it protects" is a conclusion I will act on.
