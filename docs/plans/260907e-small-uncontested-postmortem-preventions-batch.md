# Small, uncontested postmortem preventions — a batch

**Status as of 2026-09-07: planned, nothing built yet.** Evidence for each item's "still unbuilt"
verdict is in § Verification below, gathered before any edit.

## Goal

An audit of all 89 files in `docs/postmortems/` on 2026-09-06 found roughly ninety prevention
recommendations still unbuilt out of about 230 extracted. Most are habits, or are too big for one
sitting. This batch takes the ones that are **small, mechanical, and turn a habit into a check** —
the argument of [260905b § T2.1](260905b-improve-the-codebase-third-sweep.md), and its reason for
preferring a check to a sentence every time.

Each item is its own stage: a red test, then the fix, then a GPT Sol review. They touch disjoint
files.

**A deferral is a claim, and it decays.** On 2026-09-06 six of about forty such claims turned out to
be already done, already deliberate, or aimed at code that had since been deleted. So every item is
verified against the tree before it is built, and § What turned out to be already built or stale
records the ones that were not real — that list is worth as much as the ones built, and is the input
to the next [improve-the-codebase.md](../reusable/improve-the-codebase.md) sweep
([260906i](260906i-sweep-for-missed-work-across-feedback-reports-worktrees-and-sessions.md) records
why).

## References

- [260906c](../postmortems/260906c-the-safe-helper-was-private-so-three-boundaries-wrote-the-unsafe-spelling.md)
  — Stage 1's postmortem.
- [260901d](../postmortems/260901d-a-409-and-a-404-arrived-as-500.md) — Stage 2's, § *What would
  have caught the whole class* item 4.
- [260906b](../postmortems/260906b-asking-a-model-to-omit-a-field-makes-it-emit-the-comma-anyway.md)
  — Stage 3's.
- [silent-success.md](../reusable/silent-success.md) — why every stage ends by mutating the finished
  code and checking the suite notices.
- [logging.md](../project/logging.md) — Stage 3's constraint: server code logs through `src/log.ts`,
  the CLI uses `console.log`, and no article prose or model output is ever logged.
- [static-analysis.md](../project/static-analysis.md) — what `npm run check` is, for Stage 2's
  question of where the check should live.

## Constraints on this run

- Own worktree; land on `dev` with `git push origin HEAD:dev`. Never `main`, no deploy.
- Several sessions are live tonight in `src/jobs.ts`, `src/routes.ts`, `src/web/styles.css`,
  `src/web/App.tsx` and the extraction path. Edits stay targeted, files are re-read immediately
  before editing, and no shared file is rewritten.
- The conflict-marker / `db:chain` guard is being built tonight by another session, so it is not
  available as a Stage 4 candidate.
- Stage 4 must not touch a defence ([security-map.md](../project/security-map.md) § Where the
  defences physically live) — an unattended run does not edit one. Anything found there is written
  up instead.
- No question can be asked on this run. Decisions and assumptions are recorded here rather than in
  chat.

## Verification — is each item still unbuilt?

### Stage 1 — `componentDidCatch(error: unknown)` · UNBUILT (partly built)

All three boundaries still declare `error: Error`: `src/web/AppBoundary.tsx:52`,
`src/web/LazyPage.tsx:107`, `src/web/FeatureBoundary.tsx:186`.

**The main class fix already landed.** `nameOfThrown` is exported at `src/web/log-buffer.ts:407`,
all three handlers already call it, and two tests already hold the line —
`tests/no-boundary-reads-the-caught-value.test.ts` (an AST sweep of every `componentDidCatch` under
`src/web/`) and `tests/every-boundary-contains-a-throw-that-is-not-an-error.test.tsx`.

So this stage is belt-and-braces, and its value is worth stating precisely: **the parameter's type
is currently a lie, and while it stays a lie the compiler is on the wrong side.** `error: Error`
makes `error.name` compile in a handler where the runtime value need not be an `Error` at all.
Retyping to `unknown` moves the guarantee from a sweep that has to be kept in sync to `strict`
refusing the read outright.

Scope: retype three parameters, and fix whatever the compiler then objects to using the existing
helper. `captureClientFailure` already takes `unknown` (`src/web/monitoring.ts:162`), so it is not
expected to object anywhere. **No general refactor of error handling.**

**Spiked before the review, and the answer is clean.** The obvious risk was that widening a
parameter React's own declarations type as `Error` would need a cast, an `@ts-expect-error` or a
signature nobody wants — which would have collapsed the stage's argument, since the whole point is
to let the compiler do the work. It does not: all three retyped, `npm run typecheck` exits 0 with no
errors, and no call site objects. The spike was then reverted so the review below sees the tree the
review prompt describes.

### Stage 2 — the `mayPassThrough` cross-check · UNBUILT

[260901d](../postmortems/260901d-a-409-and-a-404-arrived-as-500.md) § *What would have caught the
whole class*, item 4, in its own words:

> **A static check that the two lists agree.** Every class `src/routes.ts` matches with `instanceof`
> in its error handler must either be named in `mayPassThrough` or declare a numeric `status`. That
> is `npm run check`-shaped (`docs/project/static-analysis.md`) and it is the only one of the three
> that cannot be forgotten. Not built; it would need a thrown-from-a-store list as well, and the
> table above is currently that list.

Nothing in the tree implements it: the only hits for `mayPassThrough` outside
`src/store/db-errors.ts` are prose in `src/routes.ts:6435` and `src/comments.ts:138`, three test
comments, and plan/postmortem text.

**How the two can disagree**, as the tree stands:

| class matched by `instanceof` in `src/routes.ts` | where | does the guard pass it? |
|---|---|---|
| `ChatConflict` | 6424 | yes — named in `mayPassThrough` |
| `CommentIdTaken` | 6439 | yes — `readonly status = 409` |
| `NotAnExplanation` | 6444 | yes — `status` computed from `why` |
| `ArticleNotFound` | 768 | **no** — no `status`, not on the list |
| `EmbeddingFailure` | 920 | **no** — `status` is `number \| null`, and `null` is not `"number"` |

The last two are the postmortem's two *latent* rows, and both are currently unreachable, because
neither class is thrown from inside a guarded store. `ArticleNotFound` is thrown by `walk()` in
`src/store/article-rows.ts:642`, reached through the free function `readArticleRows` rather than
through a store method, so `guardDbStore` never sees it. `EmbeddingFailure` is converted by
`embeddingHttpError` before the generic handler.

`EmbeddingFailure` is the interesting one, and the reason the check has to be sharper than the
postmortem's sentence: **declaring a `status` is not the same as declaring one the guard will
accept.** `mayPassThrough`'s last line is `typeof err?.status === "number"`, so a `number | null`
declares the field and still fails. A check written to the loose wording would pass
`EmbeddingFailure` and would therefore be blind to exactly the way this bug next recurs.

**Design.** A parsed static check — a vitest test using the existing `tests/helpers/ts-ast.ts`, the
way `tests/no-boundary-reads-the-caught-value.test.ts` does. For every `instanceof X` in
`src/routes.ts` — all of them, not only the ones a heuristic thinks sit in an error handler, because
over-broad is the safe direction here — resolve `X` to its declaration and require one of:

1. `X` is named in `mayPassThrough`'s `err instanceof X` list; or
2. `X` declares a `status` property that is **non-nullable and numeric**; or
3. `X` is on a short, named, reasoned list in the test of classes **not thrown from inside a guarded
   store** — the "thrown-from-a-store list" the postmortem says is missing. Today that is
   `ArticleNotFound` and `EmbeddingFailure`, and the reason for each is the paragraph above.

Plus a positive control naming the classes it expects to find, so a sweep that quietly stopped
finding anything goes red instead of passing over nothing
([silent-success.md](../reusable/silent-success.md)).

**The honest limit, written down rather than glossed:** clause 3 is an assertion the check cannot
verify. It does not notice the day `ArticleNotFound` starts being thrown from inside a guarded
store — that is the call-graph analysis the postmortem shied away from, and it stays unbuilt. What
the check *does* close is the failure that actually happened: a class added to `routes.ts`'s status
chain with neither a `status` nor a place on the allowlist, silently answering 500. Adding a third
exemption becomes a deliberate line with a reason next to it, rather than an omission nobody sees.

Where it lives: `npm test` rather than `npm run check`. The postmortem says "`npm run check`-shaped",
and `npm run check` runs the suite anyway; the sibling check of exactly this kind is already a vitest
test using the same AST helper, and a second home for one idea is the thing this codebase keeps
saying not to do.

### Stage 3 — count when the JSON repair fires · UNBUILT, and deliberately so

`src/parse-json.ts:358` `dropTrailingCommas` already says it, in its own docstring:

> **Nothing records that it fired**, and that is a known cost rather than an oversight: this module
> has no logger on purpose (see the header — a bare `JSON.parse` here must not be able to write the
> model's answer into a line), and `parseJsonAnswer` returns the value alone. So a model that starts
> emitting these on every answer gets quietly accommodated instead of noticed. The place to count
> them, if that ever matters, is the caller that has a logger — which needs a signature change
> nobody needs yet.

So the module's own note names both the constraint and the obvious fix, and rejects the obvious fix.
It is right to: `parseJsonAnswer` has **37 call sites** across `src/`, so a signature change is not a
small stage.

**Design.** `parse-json.ts` keeps no logger and gains no import of one. It gains:

- a module-level tally, keyed by the `source` string `parseJsonAnswer` is already handed (`"the
  quotes response"`, `"the nav labels"`, …) — our own fixed constants, never content; and
- an observer seam, so the module reports the *event* and whoever is running decides the
  destination. That is also what [logging.md](../project/logging.md) requires: the same repair
  happens in a request path, where it must go through `src/log.ts`, and in a pipeline stage run from
  a CLI, where it must not.

Reported fields: the `source`, and how many commas were removed. **Never the payload, the span, or
any part of the model's answer** — the whole point of this module.

Counted only when the repair *mattered*: `removed > 0` **and** the repaired parse then succeeded.
`removed === 0` is the same call it always was, and a repair that still failed to parse is a broken
answer rather than an accommodated one.

**The second item in that postmortem — quarantine the raw answer on parse failure — is judged and
declined here.** It is not small: the raw answer is the model's writing about the article, so
quarantining it means choosing a store, a retention window, an access rule and a redaction posture,
and `src/parse-json.ts`'s header exists precisely to stop that text reaching a durable line. That is
a product and privacy decision for Greg ([privacy.md](../project/privacy.md)), not an uncontested
mechanical prevention, and it is the opposite shape from the rest of this batch. The third item — a
comma warning in every prompt's schema section — is prompt-wide and out of scope by the brief.

### Stage 4 — every `process.env.X` under `src/` must appear in the health check · UNBUILT

**Chosen.** From
[260827b](../postmortems/260827b-health-check-green-while-uploads-dead.md), which asks for it twice
— once in § *Four things it still does not reach* item 1, with a dated re-check, and again in §
*What would have caught the class*:

> A test that walks `src/` for `process.env.` reads and asserts every one appears in `EXPECTED`
> would close this, and is the cheapest of the four. *Checked 2026-09-03: `ANTHROPIC_API_KEY` left
> `EXPECTED` on 2026-08-31 — by hand, which is the point — and `SPIDERYARN_OWNER_ID` is still read
> by `src/owner.ts` and still absent from it. **The test is still not built.***

**Verified in the tree**, not taken from the doc. `EXPECTED` (`src/vercel-health.ts:198`) names 13
variables plus one `or`. A sweep of `src/` finds 28 distinct `process.env.X` reads. The postmortem's
own named example is still exactly true: `SPIDERYARN_OWNER_ID` is read at `src/owner.ts:271` and is
absent from `EXPECTED`. So **red-first is free** — the check goes red on the tree as it stands,
before anything is fixed, which is the strongest form of the evidence this batch is about.

Why this one over the alternatives:

- It is the same shape as the other three — a hand-maintained list that nothing makes agree with the
  code — and the postmortem is explicit that hand-maintained drift *is the entire cause* of the
  original incident. A check rather than a sentence, exactly.
- Red-first costs nothing and cannot be faked.
- It touches `src/vercel-health.ts` and one new test file. Nobody else is likely to be in either
  tonight, and neither is on the do-not-touch list. **`vercel-health.ts` is not a defence** —
  `security-map.md` does not mention it.

**And it has already justified the choice of a parser over a regular expression**, before a line of
it is written. My own first pass was `grep -rhoE "process\.env\.[A-Za-z_]*"`, and it returned a
28th name, `SPIDERYARN_`, that no code reads: it comes from a **comment** at `src/models.ts:1084`
describing `process.env.SPIDERYARN_*_MODEL`. That is the failure `tests/helpers/ts-ast.ts`'s header
was written about — a needle matched inside a comment, producing a complaint about code that does
not exist. The check parses.

**Scope, and the one risk to be careful of.** The stage is the test, plus a named allowlist with a
reason per entry, plus entries for the genuinely-missing names. The risk is that
`EXPECTED` is not merely documentation: an entry with a `breaks` clause **warns**, and a warning on
a deployment that legitimately does not set a variable is the noise the list's own header argues
against. So a name only gets a `breaks` clause where absence really does break something;
everything else is `breaks: null` (report-only, the existing idiom for exactly this) or is
allowlisted. **No entry added in this stage may be able to turn a working deployment's health
warning-red.** The candidates, on a first read, split as:

- *Report-only or a real entry:* `SPIDERYARN_OWNER_ID`, `SPIDERYARN_OWNER_EMAIL`,
  `SPIDERYARN_BASE_URL`, `SENTRY_DSN`, `DATABASE_POOL_MAX`, `SPIDERYARN_PIPELINE_EFFORT`.
- *Allowlisted, with the reason beside each:* `NODE_ENV`, `VITEST`, `PGAPPNAME`,
  `SENTRY_FORCE_LOCAL`, and the platform's own `VERCEL`, `VERCEL_ENV`, `VERCEL_REGION`,
  `VERCEL_URL`, `VERCEL_GIT_COMMIT_SHA` — a deployment cannot be missing the variables the platform
  itself sets, and demanding them would be the `NODEJS_HELPERS` mistake in reverse.

Each is decided at build time by reading the call site, not by this list.

#### The candidates rejected, and why

- **A `scripts/check-cloud-init.ts` rule flagging early-exit pipeline members under `pipefail`**
  ([260831f](../postmortems/260831f-the-match-that-still-failed.md)). Genuinely unbuilt and a good
  check. Rejected because there are 26 `grep -q` occurrences under `infra/` and the rule lands red
  on real config until each is judged — so the evening is the triage, not the check, and a rule
  whose first act is to be silenced is worse than no rule.
- **Stripe fixtures captured from the vendor rather than cast**
  ([260904a](../postmortems/260904a-four-billing-faults-and-the-witnesses-that-agreed-with-the-code.md)).
  Ten live `as unknown as Stripe.X` casts across five test files. Rejected on two grounds: the
  honest fix needs a real sandbox read from Stripe to capture payloads, which is vendor I/O in an
  unattended run, and five test files plus captured fixtures is a stage and a half. Worth doing;
  not tonight, and not without Greg awake.
- **A deploy-time probe making one real embedding call**
  ([260828d](../postmortems/260828d-the-deployed-key-was-never-asked-to-do-anything.md)). Still
  open, and confirmed unbuilt — `scripts/deploy.ts` probes only `/api/health`. Rejected because it
  is **blocked on Greg rather than on effort**:
  [260828z](260828z-embedding-endpoints-refused.md) says it needs a shared secret only Greg can put
  on the Vercel project, and building it half-way leaves a gate that skips itself — which is the
  precise failure this batch exists to stop shipping.
- **`sweepAbandonedDrafts` has no callers at all** (`src/store/pg-revisions.ts:2196`; `npx knip`
  agrees, in an advisory nobody reads). Real, and worth fixing. Rejected because it is a *fix*, not
  a prevention, and with no scheduler ([cron-scheduler.md](../project/cron-scheduler.md)) the
  deliverable is a command somebody has to remember to type — the shape this batch is trying to
  replace.
- **A cross-reference guard for file paths named in code comments**
  ([260826e](../postmortems/260826e-converse-stall-misfiled-as-incomplete.md)). `doc-links.test.ts`
  already does this for Markdown; extending it to TS comments finds ~30 dead paths. The test is
  small and the 30 judgement calls are the evening — several are deliberate past-tense references
  to deleted code. Rejected on the same ground as the `pipefail` rule.
- **A two-overlapping-transaction test for `articles` by slug**
  ([260901f](../postmortems/260901f-a-for-update-that-locks-nothing.md)). Partly built already (the
  `raw_sources` case exists). Rejected because it needs Postgres — contention-prone on this box,
  where a red suite is usually the machine — and its sibling case, `block_identities`, is in the
  extraction path, where other sessions are live tonight.

#### Excluded because they touch a defence — written up, not built

Recorded here so the next sweep has them, per the brief's instruction not to edit a defence on an
unattended run:

- **[260828f](../postmortems/260828f-admin-id-was-the-local-one.md)** — comparing
  *(project, id)* rather than id alone in `isAdmin` (`src/auth.ts`), and a deploy-time check that
  the administrator resolves to a real account on the project being deployed to. The postmortem
  says *"Not done, and recorded here rather than left implicit."* Still not done.
- **[260902e](../postmortems/260902e-a-comment-that-named-the-latent-hole-and-left-it-latent.md)** — an AST
  gate on `(await readBody(req)) as` and on direct destructuring of a request body. Unbuilt, with a
  live instance at `src/routes.ts:7856` — but `src/routes.ts` is both a defence and on tonight's
  do-not-rewrite list, and the gate would go red with the fix landing there.

## Stages

Each stage: verify unbuilt → write the failing test and watch it go red → fix → suite and typecheck
→ **mutate the finished code and check the suite notices** → GPT Sol review → act on the findings →
update this doc → commit.

1. **`componentDidCatch(error: unknown)`** — `src/web/AppBoundary.tsx`, `src/web/LazyPage.tsx`,
   `src/web/FeatureBoundary.tsx`, and a case in `tests/no-boundary-reads-the-caught-value.test.ts`.
   *Done looks like:* all three parameters typed `unknown`, `npm run typecheck` green, and a test
   that goes red if a boundary declares the parameter as `Error` again.
2. **The `mayPassThrough` cross-check** — a new test file; no source change expected.
   *Done looks like:* the check is green on the tree as it stands, and goes red when the two lists
   are made to disagree — proven by actually making them disagree, both ways: removing
   `ChatConflict` from the allowlist, and removing `CommentIdTaken`'s `status`.
3. **Count the JSON repair** — `src/parse-json.ts` and its one registration point.
   *Done looks like:* a repair that fires is counted and classified by `source`, nothing of the
   payload is reported, and a test pins both halves.
4. **Every `process.env.X` under `src/` appears in the health check's `EXPECTED`** — a new test
   file, and entries plus an allowlist in `src/vercel-health.ts`.
   *Done looks like:* the check is red on the tree as it stands (naming `SPIDERYARN_OWNER_ID` among
   others), green once each name is either an `EXPECTED` entry or an allowlisted omission with a
   reason, and no entry added can turn a working deployment's health warning-red.

## The plan review, and what changed because of it

GPT Sol, round 1, on the plan before anything was built:
[260907e-plan-review-sol.md](260907e-plan-review-sol.md). Verdict: *build it with the changes
below; Stage 1 is sound, Stages 2–4 need design corrections.* Every finding was checked against the
tree rather than taken on trust. Five of six stand, one is wrong, and two of them changed the shape
of a stage.

- **F1 (P1) — Stage 3's tally and observer registry violate the process-state contract.** Upheld in
  substance. `architecture.md` § *Process-wide mutable state must have process lifetime* is real,
  and Vite re-evaluates server modules in place, so a module-level tally can split into two.
  **Adopted, and further than asked:** the tally and the observer both go. There is no state at all
  now, so the contract does not apply rather than being satisfied.
  **Not adopted as written:** Sol's smallest design imports the logger straight into
  `src/parse-json.ts`. Instead the call goes through a **stateless one-function module**,
  `noteJsonRepair(source, removed, outcome)`. That is not the registration Sol objected to — no
  state, no mutation, nothing to duplicate — and it keeps the discipline the `dropTrailingCommas`
  docstring is protecting: a seam typed `(string, number, Outcome)` **cannot carry the model's
  answer across it**, where a logger in scope makes `logger.warn({ text })` a one-liner for the next
  person. Types catching it beats a comment asking for it.
  **And F1 caught a real error of mine:** I wrote "37 call sites", which was a grep over lines, not
  calls. There are **13**. The corrected number does not change the decision — it removes the
  argument that a signature change is *too big*, but the seam is better on its own merits.
- **F2 (P1) — an observer could throw and turn a repaired answer back into a failed one.** Upheld,
  and dissolved by F1's fix rather than patched. `src/log.ts:36` rule 5 is explicit: *"A log call
  never throws, and never has to be wrapped in a `try`. This is rule 5, and it is structural."* So
  the notifier inherits that guarantee, and wrapping it in a `try` would contradict the documented
  rule rather than add safety. A test still pins it.
- **F3 (P2) — Stage 2's exemption list is an artefact of sweeping too widely.** Upheld, and this is
  the finding that improved the stage most. `ArticleNotFound` and `EmbeddingFailure` are **local**
  translations (`sendExport` at `routes.ts:763`, `embeddingHttpError` at `:919`) and were never part
  of the generic catch's class-to-status map at all. Scoping the check to **the generic catch's
  status chain** deletes the exemption list outright — the part of my own design I said I was least
  happy with, gone, and with it the "third list to synchronise" objection.
  **Half declined, deliberately.** Sol goes on to propose giving `ChatConflict` a `status`, removing
  its `mayPassThrough` branch, and deleting the three now-unreachable branches from the catch. That
  is the right end state and I am not doing it tonight: it edits `src/routes.ts`, which is on this
  run's do-not-rewrite list, and the postmortem's own instruction is *"Delete them when somebody is
  next in that function for another reason"* — I am not, and an unattended run is the wrong time to
  become so. Recorded here as the next step for whoever is.
- **F4 (P2) — Stage 3 does not count what it claims to count.** Upheld and adopted. The repair
  removes commas even when another syntax error remains (Sol probed `{"a": nope,}`: `removed: 1`,
  then `MalformedJson`), and one model answer can be parsed more than once — stored expansions are
  re-parsed on resume, and a refused expansion is parsed twice. So the metric is named honestly as a
  **parse-repair invocation**, carrying `outcome: "accepted" | "still-invalid"`, and the failed
  repair is counted too. "Model answers repaired" would need instrumentation at the model-call seam
  and is a larger stage.
- **F5 (P2) — Stage 4 would not have caught its own named incident.** Upheld, **and this is the most
  valuable thing the review produced.** I checked the history myself: `SUPABASE_SERVICE_ROLE_KEY` is
  present in `EXPECTED` at both `4dcc580` and `2405408`, so a membership test stays green straight
  through the introducing commit. The bug was a *reported* variable becoming required without
  gaining a `breaks` consequence — not a missing name.
  **So the postmortem's own recommendation contains a false claim about itself**, and it has been
  read as evidence twice. The stage is still worth building, as the narrower "source environment
  reads must be inventoried" guard that catches the drift case — `SPIDERYARN_OWNER_ID` is real and
  still absent — but the claim is corrected here **and in the postmortem**, because a postmortem
  that overstates its own fix is exactly what sends the next sweep down a blind alley.
- **F6 (P2) — Stage 4 misses 16 names read through computed expressions.** Upheld and adopted.
  Confirmed in the tree: `MODEL_ENV_VAR` (`src/models.ts:1013`) is a record of 12 literal env-var
  names read as `process.env[envVar]`, and `CONCURRENCY_ENV`, `DEEPEN_ENV`, `REASK_ENV` and
  `DEEPEN_RECORDS_ENV` are module-local constants read the same way. The check therefore resolves
  string-literal constants and record values, and **fails closed** on anything it cannot enumerate,
  per `tests/helpers/ts-ast.ts`'s own doctrine — a guard that cannot see an edge must go red, not
  quiet. The two generic helpers that take a name as a parameter (`src/fetch.ts:602`,
  `src/vercel-health.ts:420`) are handled by enumerating their callers, not by exempting a file.
  Also adopted: every new `breaks` value is decided **here**, before building, rather than at build
  time.

**One finding is wrong.** Sol's closing note says *"The supposedly reverted Stage 1 spike is still
present as working-copy modifications in the three boundary files."* It is not: `git diff HEAD` is
empty and all three files read `error: Error`. The review began while the spike was applied, so it
read the tree mid-window. Worth recording as a property of live pre-commit reviews rather than a
mistake — **a candidate that names a tree rather than bytes can change under the reviewer**, which is
what `review-prompt-template.md` warns about, observed here for real.

## What landed

### Stage 1 — built, landed as `cd3b1343`

- `src/web/AppBoundary.tsx:52`, `src/web/FeatureBoundary.tsx:186`, `src/web/LazyPage.tsx:107`:
  `componentDidCatch(error: unknown, …)`.
- `tests/no-boundary-reads-the-caught-value.test.ts`: a third case, *"declares what it caught as
  `unknown`, so the compiler refuses the read"*, plus a `declaredType` helper.
- The three handlers' comments rewrote the sentence that said *"the parameter is typed `Error` and
  the runtime value need not be one"* — true before this stage and false after it. A comment that is
  wrong about a guarantee is worse than none.

**Evidence.** Red first: the new case failed naming all three files with the spelling it found.
Green after; `npm run typecheck` exits 0 across 1,527 files. **Mutation, and it is the one that
matters:** adding `void error.name;` to `AppBoundary`'s handler now fails to compile —
`src/web/AppBoundary.tsx(58,21): error TS18046: 'error' is of type 'unknown'.` That is the stage's
whole claim, demonstrated rather than asserted. A second mutation, reverting one signature to
`Error`, failed the new case naming exactly that file. Both reverted.

**One thing worth recording:** my first version of the test had a type error (`unknown` returned
where `string | null` was declared) and **vitest was green anyway** — it does not typecheck. Only
`npm run typecheck` found it. That is the same class as everything else in this batch: a check that
agreed with the code because it never looked.

**Review** — [260907e-stage1-review-sol.md](260907e-stage1-review-sol.md). *"Land it with the small
test and comment corrections below. No behavioural defect."* Sol confirmed the three files emit
**byte-identical JavaScript**, that `FeatureBoundary` still retires the activation before any
diagnostic, and that `unknown` is sound against React's declaration without relying on method
bivariance. Two findings, both acted on:

- **F7 (P2) — the test enforced a spelling and claimed a guarantee.** Sol demonstrated two live
  bypasses: `(error as Error).name`, which is *the* thing a reader reaches for the moment the
  parameter becomes `unknown`, and a one-step alias (`const caught = error; caught.name`). Both were
  reported clean. Also invisible: a quoted or computed method key, and an arrow-property handler's
  parameters. All four closed — `unwrap` sees through casts, `!` and parentheses; `aliasesOf` follows
  one assignment; the key match accepts a string literal; and a class-property handler's params and
  body are now read off the arrow. **Verified by mutation with Sol's own two examples**: both now go
  red naming the file and the read. Deliberately *not* closed: anything needing real data-flow. The
  assertion's comment now says so instead of claiming otherwise.
- **F8 (P3) — my rewritten comments overstated.** `error.name` *can* throw, not does — on a real
  `Error` it is simply fine, which is why the pattern survives review. And `FeatureBoundary`'s said a
  diagnostic "skipped the retirement above", which is impossible in the current ordering; it now says
  it once did, before retirement was moved ahead of diagnostics. The test's claim that the
  typechecker owns the scalable half was also wrong: both assertions run off the same sweep, so a
  handler the sweep cannot see is one neither says anything about. Corrected to say what actually
  holds.

### Stage 2 — built

`tests/routes-status-classes-survive-the-store-guard.test.ts`. No source change: the tree already
agrees, which is the point.

The check finds every class matched by an `instanceof` **inside the initialiser of a variable named
`status`** — that being what "maps a class to a status" means — and requires each one to be either
named in `mayPassThrough` or to declare a numeric, **non-nullable** `status`. Keying on the variable
rather than on "every `instanceof` in the file" is F3's fix, and it is what removed the exemption
list.

**Evidence, and the design changed to get it.** The check is green the day it is written, so
"it passes" says nothing; the file therefore has a second `describe`, *the check itself*, that feeds
the same functions crafted source text and asserts they go red. The helpers take source **text**
rather than paths for exactly this reason. Five controls: the 2026-08-28 bug reconstructed
(a mapped class on neither list); the `EmbeddingFailure` shape (`status: number | null`, which
declares the field and still fails the guard); an unresolvable class (fails closed rather than
passing); both doors staying green; and a local translation being correctly ignored.

Then one **real-file** mutation, because the controls prove the logic and not the wiring: removing
`readonly status = 409` from `CommentIdTaken` produced
`src/routes.ts:6439 — CommentIdTaken (src/comments.ts): not in mayPassThrough, and no numeric
non-nullable status`. Reverted, `git diff` clean.

**Review** — [260907e-stage23-review-sol.md](260907e-stage23-review-sol.md), covering Stages 2 and 3
together because they are disjoint. *"Land with F7 and F8 fixed, plus the F9 wording correction. No
established P0 or P1."* Both findings against Stage 2 were **false positives in the check itself**,
which is the worst kind of defect a check like this can have — it certifies something the guard would
actually scrub, wearing the check's own badge. Both fixed:

- **F7 (P2) — `declaresNumericStatus` accepted five shapes that are not on the instance.**
  `static readonly status = 409` lives on the constructor; `declare`, `!`, `?` and `abstract` each
  assert or permit a value the emitted JavaScript never assigns. Sol compiled the `declare` and
  definite-assignment forms and emitted them: both instances came out with `status: undefined` while
  the predicate said they were fine. It also walked into method bodies, so a class nested inside a
  method could certify its enclosing class. Now it reads the class's own members directly and rejects
  all five modifiers, with a control per shape and one for the nested case.
- **F8 (P2) — `allowlisted` read the allowlist as names that appear near it.** It collected every
  `instanceof` under `mayPassThrough` regardless of the left operand, the control flow, or the return
  value — so `if (err instanceof Unsafe) return false;` (a refusal), `if (!(err instanceof Unsafe))
  return true;`, an arrow function that never returns, and `err.cause instanceof Unsafe` would all
  have certified `Unsafe`. And it compared identifier *text*, so `import { Unsafe as ChatConflict }`
  in `routes.ts` would have been vouched for by the guard's genuine `ChatConflict`. Now the shape is
  matched exactly — the function's own parameter, an `if`, a `return true`, no nested scopes — and a
  name on the allowlist must also **resolve to the same binding** in both files, compared as
  `module#exportedName`. Six new controls.

**And the fixes were themselves checked for discrimination**, not just for going green: removing the
`static` clause turned the new control red, which is what says the control is testing the fix rather
than passing for its own reasons.

Sol also enumerated the evasions this check's deliberate scope leaves open, and they are recorded
rather than closed: a *new* mapping written as a direct return, a `switch`, a helper, a
namespace-qualified class, or `let status; status = …` slips past, because only a `status`
initialiser is walked. A wholesale restructure does not, because `KNOWN_MAPPED` then loses all three.
Every other status form it classified — a constructor-only assignment, an inherited property, a
getter, `as const`, a numeric enum — is a false *negative*, which is red and therefore safe.

**Left for whoever is next in that function**, per F3 and the postmortem's own follow-up: give
`ChatConflict` a `readonly status = 409`, drop its `mayPassThrough` branch, and delete the three
now-unreachable `instanceof` branches from the chain. That is the one-mechanism end state. Not done
here — it edits `src/routes.ts`, which this run is not rewriting.

### Stage 3 — built

- `src/json-repair-log.ts` (new): `noteJsonRepair(source, removed, outcome)`, and a `RepairOutcome`
  of `"accepted" | "still-invalid"`.
- `src/parse-json.ts`: the repair site now takes the attempt as a value rather than returning from
  inside the `try`, so the report happens on both paths, exactly once, and **outside** the `catch` —
  inside it, a throw from the reporting would be indistinguishable from the answer being
  unparseable, which is this module's own class of bug.
- `tests/json-repair-is-counted.test.ts` (new).
- `dropTrailingCommas`'s docstring, which said *"Nothing records that it fired"* — now false, and it
  says what replaced it and why this function is still not the place that does it.

**The seam is the signature.** `parse-json.ts` still imports no logger. `noteJsonRepair` takes a
label, a count and a two-valued outcome, so the model's answer **cannot cross it** — the header's
rule kept by the types rather than by everybody remembering it.

**Evidence.** Written green, so the red came from mutation instead: removing the `noteJsonRepair`
call turned 4 of 6 cases red; changing the `removed > 0` gate to `>= 0` turned the "says nothing
when the answer parses cleanly" control red. Both reverted; `tests/parse-json.test.ts`'s own 65
tests still pass (71 total with the new file); `npm run typecheck` exits 0 and `npm run cycles`
finds no new cycle.

One of the six cases is there for the leak rather than the count: it feeds an answer whose *key and
value* are both a prose-shaped needle and asserts the needle appears nowhere in what was logged. A
test that only counted would be green over a payload leak.

**Review.** Sol walked all six paths through the restructured repair site and confirmed the
behaviour is **semantically unchanged** for every input — same value returned, same error thrown,
same fallback — with the one literal difference being that `dropTrailingCommas` now runs outside the
old `try`, which has no ordinary throw path for a string. It confirmed the counting gate is exactly
right (every invocation that removes a comma reports once, including the failures; nothing else
reports), that no model prose reaches the line, and that the separate module is justified: *"It keeps
the logger — and therefore arbitrary logging capability — out of the parsing module's lexical
scope."*

One finding, and it was against my prose rather than the code:

- **F9 (P3) — I claimed more than the signature delivers.** I wrote that it "cannot carry the
  payload". `source` is a `string`, so `noteJsonRepair(raw, …)` would typecheck. The true and
  narrower statement — now in both files — is that the raw text and the span are not among the things
  it asks for, that the logger is not in `parse-json.ts`'s scope at all, and that `source` rests on
  the same caller's-promise the module header has always relied on. A type-level guarantee would need
  `source` to be a closed union across thirteen call sites: a different stage.
  Sol also checked the wider tree: three more calls outside `src/` pass literals, and one eval passes
  a slug-plus-repeat label — permitted log metadata, but not a project-authored constant, so worth
  knowing.

## Assumptions and decisions, for the record

- **No question can be asked on this run**, so where a call was genuinely open it was settled here
  and the reasoning written down rather than deferred. The two that came closest to being product
  calls — quarantining raw model answers (Stage 3) and anything touching a defence (Stage 4) — were
  both declined rather than guessed at.
- **Stage 1 is knowingly belt-and-braces.** It would be reasonable to skip it as already fixed. It
  is kept because the argument of this batch is *a check rather than a sentence*, and moving a
  guarantee from a sweep to the typechecker is that argument's cleanest instance.

## What turned out to be already built or stale

*(Filled in as each item is verified — see the note on decaying deferrals at the top.)*

- **260906c's main recommendation — the shared `nameOfThrown` helper — is BUILT**, along with both
  its tests, as of `src/web/log-buffer.ts:407`. Only the parameter types remain.
- **260901d's items 1 and 3 are BUILT.** The guard moved to the store's own export on 2026-09-03 by
  [260903e](260903e-sweep-recorded-rather-than-fixed-defects.md) § Stage 1 item 2, and the
  per-class guard test is `tests/db-error-scrub.test.ts` § *a refusal the comment store makes*. The
  postmortem records item 1's landing itself. Item 2 — a refusals parity test on every parity file —
  is still open and is bigger than one stage.
- **260906b's own recommendation is genuinely unbuilt, but was a deliberate omission**, argued in the
  `dropTrailingCommas` docstring rather than forgotten. Building it therefore means overturning a
  written decision rather than filling a gap — which is why the design above keeps the constraint
  that decision was protecting (no logger in the module) instead of ignoring it.

### Deferrals found to have decayed, from the Stage 4 trawl

Six recorded-as-unbuilt items across `docs/postmortems/` were checked against the tree and are not
worth a future sweep's time. This is the list the brief asks for, and it is the direct input to the
next [improve-the-codebase.md](../reusable/improve-the-codebase.md) run.

- **BUILT** — [260903e](../postmortems/260903e-three-attempts-to-build-a-control-for-recorded-not-fixed.md)'s
  *"`biome.jsonc` → `biome.json` silently discards the whole lint config … wired into nothing"*:
  `tests/biome-config-is-live.test.ts` now wires it.
- **BUILT** — [260828c](../postmortems/260828c-export-never-wrote-the-readers-purpose.md)'s *"Nothing
  equivalent guards the five shelf columns"*: `tests/store-export-covers-tables.test.ts:843` diffs
  `getTableColumns` against what the bundle emitted, with a `COLUMNS_LEFT_OUT` allowlist.
- **BUILT** — [260904d](../postmortems/260904d-a-presentation-rule-inside-the-sanitiser-broke-the-one-policy-invariant.md)'s lint rule
  forbidding `addHook` outside `src/sanitize-policy.ts`:
  `tests/the-sanitiser-has-one-policy.test.ts` source-scans for it.
- **BUILT** — [260903f](../postmortems/260903f-the-bucket-allowlist-drifted-again-on-production.md)'s
  item 2, *"wire `bucketDrift` into `scripts/deploy.ts`"*: live at `scripts/deploy.ts:892` §
  `storageBuckets`, and it runs before the migrations.
- **BUILT at the site that prompted it** —
  [260906e](../postmortems/260906e-a-timeout-that-bounded-the-child-and-not-the-wrapper.md)'s
  *"report the measured one, with the limit alongside it"*: `scripts/run-claude.ts:644` already
  prints `elapsedSeconds(startedAt)` beside `--timeout-minutes`.
- **HALF-BUILT, and the remaining half is smaller than recorded** —
  [260830d](../postmortems/260830d-a-constant-that-dragged-in-the-shelf.md)'s *"cut the chain at
  `params.ts`"*: `ADMIN_DEFAULT_BY` has moved into `src/web/params.ts`, and
  `tests/eager-client-graph.test.ts` now pins the client closure by AST. Only `DEFAULT_BY` remains.
  Its second item — `onAuthStateChange` at module load, `src/web/lib/api.ts:1140` — is still
  unbuilt.
- **PARTLY DELIBERATE, PARTLY OBSOLETE** — [260830d](../postmortems/260830d-a-constant-that-dragged-in-the-shelf.md)'s
  *"a guard on the count — did the number of collected test files or tests fall"*:
  `vitest.config.ts:69` already has a manifest floor, and `scripts/check.ts:28` records that the
  `describe.skip` class this came from was closed on 2026-09-05 when the second store went.

**The pattern worth carrying forward:** of roughly a dozen deferrals examined closely tonight, five
were already built and two had been overtaken by a change elsewhere. A postmortem's "not built" is
a claim about the day it was written, and several of these carry a *dated re-check* line — which is
the habit that made them cheap to verify. Re-checks are worth writing.
