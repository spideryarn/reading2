# Make every environment-variable read literal, and inventory them

**Status as of 2026-09-08: Stages 1 and 2 are on `dev`; Stage 3 is built, reviewed twice and lands
with this commit, and
[260827b](../postmortems/260827b-health-check-green-while-uploads-dead.md) item 1 is marked built
with its limit stated.** Stage 1 took five GPT Sol verdicts — two refusals and three scoped checks —
and the two changes that mattered both came from *giving up on making the checker clever*: pinning
what cannot be reasoned about, and inverting the specifier rule to refuse by default. Stage 2 took
one refusal, three P1s. Stage 3 was small and closed the one hole the other two left named.

**What is true of `dev` now:** every environment read written in `src/` is `process.env.NAME`,
`import.meta.env.NAME`, or inside one of twelve checksum-pinned regions — or it is refused; every
name so collected is in exactly one of four doors; and the one pinned region whose names came from
*outside* it, `src/vercel-health.ts`'s `value()`, now takes a `ReportedEnvName` derived from
`EXPECTED`, so `value("NEW_ONE")` does not compile.

**What this still does not do, and it is the sentence to carry:** it inventories *names*, not
*consequences*. It would not have caught the incident 260827b was written about, where the name was
already in `EXPECTED` and what went stale was the truth of its `breaks` clause. Deriving the
contract — one declaration each variable's reader and this reporter both import — is the fix for
that, and is still not built.

Commits: `d403821d` (Stage 1), `ec1b2543` (Stage 2), `7b4102e7` (a false justification corrected),
`95b7f66a` (the status line), and Stage 3 below.

The route was put to GPT Sol before anything was written and came back a
**hybrid — route A for ordinary reads, plus narrow executable contracts for the five genuinely
dynamic mechanisms**. [260908a-design-prompt-sol.md](260908a-design-prompt-sol.md) is the answer and
[260908a-design-prompt.md](260908a-design-prompt.md) the question.

## Goal

Close [260827b](../postmortems/260827b-health-check-green-while-uploads-dead.md) item 1 for real: a
check that every environment variable read under `src/` is either in `src/vercel-health.ts`'s
`EXPECTED` table or in a written, deliberate exclusion — and that goes **red rather than quiet** on
any read it cannot resolve.

This is the third attempt. The postmortem asked on 2026-08-27 and again later; a check was built on
2026-09-07 and **refused twice in review** for nine established P1s, all of one class: a read that is
*silently skipped* rather than refused. It was not landed, deliberately, because a fail-open check
whose entire purpose is not to fail open would have marked the item "built" over a hole.
[260907e § Stage 4](260907e-small-uncontested-postmortem-preventions-batch.md#stage-4-built-twice-refused-and-not-landed)
is the whole story, and its § *Stage 4, as a brief for whoever picks it up* is this plan's input.

**What is different this time.** The previous attempt tried to make the *check* clever enough to
resolve the tree as written. This attempt starts from the opposite end: change the *tree* so that
almost every read is trivially resolvable, and let what remains be small enough to name.

## References

- [260827b](../postmortems/260827b-health-check-green-while-uploads-dead.md) — the postmortem, item 1.
- [260907e](260907e-small-uncontested-postmortem-preventions-batch.md) § Stage 4 — the failed attempt,
  the two reviews, and the nine attacks that are this plan's control spec.
- [260907e-stage4-candidate.ts.txt](260907e-stage4-candidate.ts.txt) — the parked 1,754-line
  candidate, non-executing. Its thirty allowlist entries and their justifications are sound work and
  are reusable verbatim; it is the *resolution machinery* that failed.
- [260907e-stage4-review-sol.md](260907e-stage4-review-sol.md) and
  [-sol-2.md](260907e-stage4-review-sol-2.md) — rounds 1 and 2.
- [silent-success.md](../reusable/silent-success.md) — the doctrine the whole item is an instance of.
- [typechecking.md](../project/typechecking.md) — **TypeScript 7 has no compiler API**, which is the
  binding constraint: a static check here parses with `@babel/parser` and can read *syntax* only,
  never a resolved type.

## The measured state of the tree

Verified in this worktree on 2026-09-08, against `origin/dev` at `fd7aa74d`. 108 lines under `src/`
mention `process.env`, `import.meta.env` or `globalThis.process`; most are comments or literal
reads. These are the ones that are **not** `process.env.LITERAL`:

| Site | Shape | What it would take to resolve |
|---|---|---|
| `src/jobs.ts:441` | `process.env[CONCURRENCY_ENV]` | `CONCURRENCY_ENV` is an exported module-level string literal (`src/jobs.ts:401`) |
| `src/hierarchy-deepen.ts:1641` | `process.env[DEEPEN_ENV]` | same (`:1638`) |
| `src/hierarchy-deepen.ts:1747` | `process.env[REASK_ENV]` | same (`:1709`) |
| `src/hierarchy-deepen.ts:1896` | `process.env[DEEPEN_RECORDS_ENV]` | same (`:1789`) |
| `src/fetch.ts:602` | `const seen = (name: string) => … process.env[name] …` | a local arrow helper; **two** call sites, both on `:603`, both string literals (GPT Sol, P3-1 — my count of three was wrong) |
| `src/web/lib/supabase.ts:34` | `import.meta.env[name]` | **the parameter is already a string-literal union**: `required(name: "VITE_SUPABASE_URL" \| "VITE_SUPABASE_PUBLISHABLE_KEY")` |
| `src/models.ts:1092` | `process.env[envVar]`, `envVar` from `MODEL_ENV_VAR[task]` | inherently computed — twelve names, all `SPIDERYARN_*_MODEL`, in a module-level object literal (`:1013`) |
| `src/vercel-health.ts:530` | `process.env[name]` inside `value(name)` | inherently computed — the reporter iterating `EXPECTED` |
| `src/env.ts:85` | `const INHERITED = { ...process.env }` | whole object |
| `src/env.ts:113` | `applyEnvFile(text, process.env, INHERITED)` | whole object, passed to a function |
| `src/env.ts:194` | `chooseTargetUrl(choice.shellWins, INHERITED, process.env)` | whole object |
| `src/env.ts:287` | `env: withoutGitVars(process.env)` | whole object |
| `src/env.ts:341/346` | `env[name]` read and write inside `applyEnvFile`, `name` from an env file's own text | genuinely dynamic by design |
| `src/env.ts:373` | `env[PINNED]`, `PINNED = "SPIDERYARN_ENV_PINNED"` (`:370`) | a literal, two hops from `process.env` |

**`src/env.ts:373` is the load-bearing piece of evidence.** `SPIDERYARN_ENV_PINNED` is a real
variable that no inventory anywhere knew about, and it was found only because something tried to
enumerate these. It is also exactly what the previous attempt's file-wide `src/env.ts` exemption
hid (Sol's F13).

### The table above was incomplete, and the omission is the whole class in miniature

**`src/sanitize-policy.ts:382` reads three variables and my survey did not see one of them.** It
binds `(globalThis as { process?: … }).process?.env` to a local `env`, then reads
`env?.SPIDERYARN_ORIGINS`, `env?.VERCEL_PROJECT_PRODUCTION_URL` and `env?.VERCEL_URL` at 384–390.
**`SPIDERYARN_ORIGINS` and `VERCEL_PROJECT_PRODUCTION_URL` are in neither inventory door**, and both
are real: `.env.example:239` ships the first, [security.md § the sanitiser's own
origins](../project/security.md) documents both, and `tests/sanitize-own-api.test.ts` exercises them.

GPT Sol found it (P2-1). It is the real-tree instance of attack F16 — the `globalThis.process`
alias — and it went unseen by a text survey written *by the person who had just read all nine
attacks*, in a session whose entire subject is reads that are silently skipped. That is the
strongest argument in this document for Sol's answer to question 3: **parse every file, accept two
shapes, and refuse everything else.** A survey that looks for what it expects finds what it expects.

The read stays as it is. `src/sanitize-policy.ts` is a **defence** —
[security-map.md § where the defences physically live](../project/security-map.md) lists it — and the
`globalThis` guard is load-bearing, because `src/web/sanitize.ts` imports the module into the browser
build where a bare `process` is a `ReferenceError` at load. It gets a *contract* rather than an edit.

### Two more facts found while verifying the table, and both change the design

1. **The four `*_ENV` consts are exported and widely used** — by tests that set the variable
   (`tests/hierarchy-deepen-wave.test.ts:1320`, `:1690`, `tests/deepen-eval.test.ts:1378`), and by
   the code's own messages (`src/hierarchy-deepen.ts:1761` interpolates `REASK_ENV` into the text a
   developer reads). So "delete the const and inline the literal" is **not** the change; the const
   stays and only the *read site* becomes literal. That duplicates a string within one file.

   **I assumed the duplication was already guarded and it was not.** The claim written here first was
   that the tests driving a read through its const go red the moment the two spellings diverge. Told
   to verify it before writing it into a source comment, the subagent found that **two of the four
   had no such test**: `DEEPEN_ENV` has no setter under `tests/` at all (its only one is
   `evals/deepen/run.ts`), and nothing sets `SPIDERYARN_JOB_CONCURRENCY`, so both spellings yield the
   default and a misspelling is invisible. `CONCURRENCY_ENV` was therefore **deleted** — after
   literalisation nothing imported it, and a constant that exists only to be quoted by comments is
   worse than no constant. The other three are held by an explicit table in
   `tests/env-reads-are-literal.test.ts` asserting the imported value against the literal the sweep
   collected from that same file, in both directions. A comment claiming a guard that does not exist
   is the failure this whole plan is about, one level up.
2. **`src/web/lib/supabase.ts:34` is already in the shape this plan wants.** Its parameter is
   annotated with a string-literal union, so the names are enumerable *from the syntax at the read
   site* and `strict` refuses any other value. That is a better answer than an inline literal: it
   costs no duplication and the closure is enforced by the compiler rather than asserted by a
   comment. It suggests a third route below.

## The design call

Put to GPT Sol before anything was built —
[260908a-design-prompt-sol.md](260908a-design-prompt-sol.md) is the answer.

**Route A — make the tree literal, not the check clever.** Rewrite the resolvable-by-const read
sites as `process.env.SPIDERYARN_…`, leaving `models.ts` and `vercel-health.ts` as two named
exemptions. Deletes the resolution problem; what remains is a small check with no alias-following,
no scope analysis, no binding resolution — the machinery every one of the nine P1s lived in.

**Route B — sign off the read sites instead.** Leave `src/` alone, inventory only the trivially
sound forms, refuse every other read, and hold the refused ones against an explicit per-site table
of the names a human verified it yields, plus a small check per row that the site really is only
called with those literals.

**Route C, which surfaced while verifying the table — annotate rather than inline.** Give every
computed read's name parameter a **string-literal union type**, the way `supabase.ts` already does.
The check then reads a type annotation at the read site: purely local syntax, no resolution, and the
typechecker — not the check — guarantees no other name can reach it. It is the only route that makes
the enumeration *sound by construction* rather than by an argument about the walker.

**`src/env.ts` is the hole in all three**, and it is asked about separately: it handles the
environment as an object, so there is nothing to make literal and no parameter to annotate. Either
it is restructured so the environment stops travelling as a value, or it gets a narrow exemption
that is itself checked — and a file-wide exemption is precisely what hid a real variable last time.

## What Sol decided, and what changed because of it

**The route is a hybrid, weighted strongly toward A.** Not the 1,754-line candidate, and not closing
the item: *"Application configuration is read only through two literal AST forms. Everything else is
refused unless it is one of a handful of individually checked mechanisms."* Roughly 250–400 lines
across 8–10 files, most of it tests, and every one of the nine attacks gets a direct red path
**without any general alias or scope analysis**.

Four things in the answer are better than what this plan had, and each is taken:

1. **Count the literal member wherever it occurs, read or write.** The check never classifies an
   access as a read or a write, so `process.env.X ||= …` and `X++` — attack F17, the thing round 2
   killed the candidate on — cannot be got wrong, because there is no classifier. It
   over-inventories deliberately.
2. **The reporter's argument gets a branded type.** `value(name)` in `src/vercel-health.ts` takes a
   `ReportedEnvName` that can only be produced by deriving it from `EXPECTED`, so `value("NEW_ONE")`
   and `value(injectedExpected.name)` become **type errors**. That closes F12 and F19 in the
   typechecker rather than in a walker — the same move Stage 1 of
   [260907e](260907e-small-uncontested-postmortem-preventions-batch.md) made for
   `componentDidCatch`.
3. **`src/env.ts` keeps its shape; two names come out at the boundary.** Do *not* restructure so the
   environment stops travelling as a value — merging and forwarding a general environment is that
   file's job, and literalising it would be dishonest or a reimplementation of `process.env`. Read
   `process.env.SPIDERYARN_ENV_PINNED` literally in `loadEnvLocal` and pass the parsed set down; and
   let `chooseTargetUrl` accept two URL strings rather than two environment records.

   **Sol's prose said to snapshot `DATABASE_URL` at module load, and that is wrong — it is not what
   was built.** A module-load snapshot is by definition equal to `INHERITED`, so the file-wins path
   would have resolved to the shell's value every time and silently stopped `db:seed-dev` and
   `db:reown` reaching the database `.env.local` names. The literal read happens at the call site in
   `resolveTargetUrl`, after `loadEnvLocal()`, which is the only point at which the question
   *"which of the two wins"* has both answers available. Found by the subagent building it, against
   the reviewer's own instruction.

   What is left is **three exact whole-object acquisitions**,
   named individually and checked as sites, not a file-wide exemption — which is what hid
   `SPIDERYARN_ENV_PINNED` last time (F13).
4. **`import.meta.env` is one sweep with three destinations**, not one. Server names go to
   `EXPECTED`; `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are **required build inputs**
   already enforced harder than health can manage by `scripts/build-stamp.ts`; `PROD` and `MODE` are
   Vite-provided constants and are not environment-variable names at all.

**And one limit stated plainly, which belongs in the postmortem rather than being quietly enjoyed:**
this inventories *names*. It would **not** have caught the incident 260827b was written about, where
the name was already in `EXPECTED` and its `breaks` consequence was wrong. Item 1 will be marked
built with that sentence attached.

### `SPIDERYARN_OWNER_ID` stays `breaks: null`

Asked as question 5 and answered against the code: `environmentOwnerId()` throws only when something
actually asks for an *environment* owner. Inside an authenticated request `currentOwnerId()`
(`src/owner.ts:237`) returns the request owner and gives the environment no vote; queued jobs carry
their own owner. The `src/` consumer is the CLI spending ledger (`src/cli-ledger.ts:108`), plus
scripts and evals. So a request-only deployment serves correctly without it, and only ownerless
CLI/stage/eval operations refuse. Promote it only if the contract becomes *"every production
deployment must support ownerless CLI operations"* — a product call, and not one a sweep is entitled
to make.

**`src/vercel-health.ts:393` is stale and says otherwise** (P3-2): it claims legacy jobs and "every
request". Corrected in Stage 3.

## Stages

Each ends with the suite green and the tree committable, and each is followed by a GPT Sol review.

### Stage 1 — the recogniser, the refusal, and making the ordinary reads literal

The check parses **every** `.ts`/`.tsx` under `src/` — no text prefilter, which is what opened 44 of
530 files last time — and refuses a file it cannot parse (`parseSource` has `errorRecovery: true`, so
a parse failure is silent unless `errors` is read). It accepts exactly two shapes and nothing else:

- `process.env.NAME` — `process` a bare identifier, `.env` and `.NAME` both non-computed;
- `import.meta.env.NAME` — the meta-property exactly `import.meta`, both members non-computed.

Everything else is a **refusal**: brackets, optionality on the roots, destructuring, aliases,
template literals, `Reflect.get`, an import of `process` or `node:process`, `globalThis.process`, and
whole-object use. Red first: on the tree as it stands this names all twelve non-literal sites plus
`sanitize-policy.ts`.

Then the ordinary reads become literal — `src/jobs.ts:441`, `src/hierarchy-deepen.ts:1641/1747/1896`,
`src/fetch.ts:602` (pass literals *into* the helper instead of letting it read), and
`src/web/lib/supabase.ts:33` (build a small object from two literal reads and let `required` index
that ordinary object) — and `src/env.ts` gets the two-name boundary extraction above. The exported
`*_ENV` consts **stay**: tests and evals import them to set the variable and the code interpolates
them into its own messages. Only two of the four had a behavioural test driving the read through the
const; `CONCURRENCY_ENV` was deleted for having no reader at all, and the surviving three are held by
a static table in `tests/env-reads-are-literal.test.ts` instead — see the correction above.

Five mechanisms get exact, individually checked site contracts rather than exemptions:
`src/env.ts` (three whole-object acquisitions), `src/sanitize-policy.ts` (`ownOrigins`, enumerating
its three literal properties and refusing an alias or computed key), `src/models.ts` (`resolveModel`),
`src/vercel-health.ts` (`value`), and `src/jsdom-lazy.ts` — the fifth, added once `createRequire` was
refused flat everywhere else, since that file legitimately needs it.

**Done looks like:** the check is green, and each of the nine attacks plus round 1's five spellings
goes red when injected — through the real file-selection path, never by calling the per-file sweep
directly.

### Stage 1 — what actually landed, and the five verdicts it took

`tests/helpers/env-reads.ts` (the sweep) and `tests/env-reads-are-literal.test.ts` (53 assertions),
plus the six `src/` reads made literal and `src/env.ts`'s two-name boundary extraction.

**GPT Sol refused this stage twice and then checked the fixes twice more.** Five verdicts in all —
[round 1](260908a-env-reads-stage1-review-sol-1.md), [round 2](260908a-env-reads-stage1-review-sol-2.md),
[scoped check of four fixes](260908a-env-reads-stage1-review-sol-3.md), and two narrower checks after that.
Every refusal was the same class the two previous attempts died of: **a read the check silently
skips rather than refuses.** What changed is that this time the answer was never a patch.

**Round 1 → the analysis layer was deleted, not fixed.** Four established P1s, including three
executed bypasses I reproduced myself (`globalThis["process"].env.X`,
`process.getBuiltinModule("node:process")` — which is `=== process` on this Node — and
`export { env } from "node:process"`), plus *all five* mechanism contracts falling to a shadowed
binding or a nested closure. Sol's own suggestion for one file became the treatment for all of them:
**pin a checksum of each permitted function's normalised AST and hard-code the names it yields.**
`usesOf`, three per-file walkers, `fnAt`, `describeContext` and `calleeName` went. The header's claim
of "no alias-following, no scope analysis" — which had been **false** — became true.

**Round 2 → the guarantee was narrowed honestly, and the limit made executable.** Four more P1s.
Three were closeable (object-pattern destructuring; `.mts`/`.cts` missed by *both* enumerators
because they spelled the same regex separately; a pin roster derived from the table it validated, so
deleting a row stayed green on both sides). The fourth was not: `import { env } from "std-env"` —
an ordinary static import from a package **already installed here** as a transitive dev dependency of
vitest — bridges to `process.env` invisibly, and closing that class would need 189 exemptions for the
`.env` accesses `src/` already has.

Fable arbitrated (§ below) and the answer was to land with the boundary **stated and controlled**
rather than park a third attempt. The decisive argument was not effort spent: this is the class
[260827b](../postmortems/260827b-health-check-green-while-uploads-dead.md) itself excluded on the day
it was written — `ANTHROPIC_API_KEY` sits in `EXPECTED` while nothing under `src/` reads it by name,
*because the SDK reads the environment itself*. A package bridge is that, with the last hop lexically
inside `src/`. So `package-bridge-boundary.ts` is a **documented-green control**: a package import
asserted to be parsed, unrefused, and contributing no name. Anyone who closes the hole must come and
flip it. *A limit written in a comment decays into folklore; a limit written as an assertion cannot.*

**The scoped checks → one inversion, which is the lesson of the stage.** The first found an in-scope
escape hiding under that very boundary: `@/` is a repo-local alias to `src/web`, not a package, so
`import { bridged } from "@/../../scripts/env-bridge.js"` was a repo-written outward bridge that
never looked relative. The second found `/scripts/…` and `/@fs/…` doing the same thing. Three
non-relative repo-local spellings in three passes.

So the specifier rule was **inverted** rather than extended: refuse by default, with the npm package
grammar as the only allowlist. That closes root-absolute, `/@fs/`, `file:`, drive letters, a package
subpath containing `..`, and any spelling nobody has thought of. It is the same move as the
recogniser's two accepted shapes, one level out — and it was verified against **all 762 module
specifiers in the tree** (51 package, 3 alias, 708 relative, 0 outside) before the suite was run at
all, which is how "did anything change status" gets an answer with a shape rather than a yes/no.

**What it guarantees, exactly.** Every environment read *written in this repo's `src/`* is
`process.env.NAME`, `import.meta.env.NAME`, or inside one of twelve checksum-pinned regions whose
yielded names are declared beside the checksum — or it is **refused**. It never claims soundness: a
read made inside a package is invisible, and that is the boundary, controlled rather than asserted.
`src/vercel-health.ts`'s `value` is a pin whose names come from its *callers*, which Stage 3's
`ReportedEnvName` closes; that seam is named in the header where somebody will meet it, not here.

**Three things went wrong on my side and are worth keeping.** I claimed the duplicated `*_ENV`
spellings were guarded when two of four were not — caught only because the subagent was told to
verify before writing it into a comment. Three source comments said `SPIDERYARN_ENV_PINNED` "hid for
months" when git says four days (`5aceccfe`); I wrote one of them, and my own grep missed a fourth
because the phrase **wrapped across a line break** — a line-based search cannot see a wrapped phrase,
which is this plan's own thesis arriving in my tooling. And the plan doc's link to
[260907e](260907e-small-uncontested-postmortem-preventions-batch.md) used the anchor GitHub would
generate rather than the one this repo's `slug()` does.

### Stage 2 — the inventory

Every name the sweep collected must be accounted for in exactly one of four doors: `EXPECTED` in
`src/vercel-health.ts`; the required client-build set in `scripts/build-stamp.ts`; a written
allowlist with a reason per group; or the Vite built-ins exclusion (`PROD`, `MODE`). Red first — 31
literal names today and most in no door. The parked candidate's thirty allowlist entries and their
justifications are sound work and are ported rather than rewritten. A name on the allowlist that
nothing under `src/` reads any more is also red, so the list cannot rot in the other direction.

`SPIDERYARN_ORIGINS` and `VERCEL_PROJECT_PRODUCTION_URL` get their door here.

### Stage 2 — what actually landed

`tests/env-names-are-inventoried.test.ts`, seven assertions, and exactly one line of `src/`: a
`SPIDERYARN_ORIGINS` row added to `EXPECTED` with `breaks: null`, after GPT Sol's review overturned
where it had been put. [The review is here](260908a-env-names-stage2-review-sol.md).

**Red first named 32.** With the allowlist and the built-ins door empty, the gate named every one of
them with its read site — the full output is in the session scratchpad as `envlitS2-red-first.txt`.
The sweep collects **52** names; 20 are in `EXPECTED` (19 rows plus `SUPABASE_ANON_KEY` as an `or`),
2 are required client build inputs, 2 are Vite constants, and the remaining 30 are the allowlist.
The doors are read rather than copied: the build door is `missingClientEnv({})` **called**, so a
third required input joins it the moment it joins the build; `EXPECTED` is parsed out of
`src/vercel-health.ts` syntactically, refusing a row it cannot read as an object literal with a
string-literal `name` — importing the module would drag in the database client and the store.

**The two homeless names went to different doors, and one of them changed in review.**
`VERCEL_PROJECT_PRODUCTION_URL` is platform-written, so it joins `VERCEL_URL` on the allowlist —
there is nothing for an operator to configure. `SPIDERYARN_ORIGINS` went to the allowlist too, on
the argument that a health report cannot tell whether this deployment needs it, which depends on
which domains are attached to the project. **GPT Sol took that apart and was right**: that is a
statement about *requiredness*, and `breaks: null` makes no requiredness claim — it reports presence
to the one party who knows whether a domain is attached that neither platform variable names, and
who is the only person who can set it. It also configures a **defence** whose server half was inert
for two days in August because nobody could see the variable was unset. So it is in `EXPECTED` with
`breaks: null`, and that is the only change Stage 2 made to `src/`.

**A two-door name is red, and the one real overlap is pinned rather than tolerated.** The two
`VITE_SUPABASE_` names are honestly in both `EXPECTED` and the build door, for different reasons, so
`EXPECTED_AND_BUILD_REQUIRED` declares exactly that pair — a third name in both goes red, and so does
either of these leaving either door. Without it, deleting an `EXPECTED` row for one of them would
have left this gate green.

**`EXPECTED` gets the reverse check with the postmortem's own exception.** An allowlisted name
nothing reads is red; an `EXPECTED` row nothing reads is red *unless* `READ_OUTSIDE_SRC` says why the
platform or an SDK reads it — the `ANTHROPIC_API_KEY` category. That map is **empty today and it is a
measured fact**: all twenty names are read by a line the sweep can point at, `NODEJS_HELPERS`
included. It exists so the next such arrival meets "declare why" rather than "delete the check".

**Three of the ported reasons were false against the current tree**, which is the failure this port
was most likely to reproduce and did not:

1. The platform group said *"a deployment cannot be missing one"*. `VERCEL_GIT_COMMIT_SHA` is absent
   whenever a `vercel deploy` runs with no git ref attached — `scripts/build-stamp.ts` says so at
   length, and that absence is why the build stamp exists. The true reason is about *who writes it*.
2. *"Only `tests/setup/*` sets `SPIDERYARN_ENV_PINNED`"* — nothing under `tests/setup/` sets it at
   all; the setters are `tests/store-boots-without-inherited-credentials.test.ts` and the child
   environments some helpers hand down.
3. The `NODE_ENV` group's *"read to ask which of those we are in"* is true of five of its eight
   reads; three use the answer as a **label** on a log line or a Sentry event.

The three GPT Sol had already corrected in the candidate — `PGAPPNAME`, `SENTRY_FORCE_LOCAL` and
`SPIDERYARN_OWNER_EMAIL` all being read by a deployment — were re-verified line by line and kept.

**Eight mutations, each verified to have applied before its result was believed** (the diff is
printed beside every run, and a non-unique match aborts rather than silently no-ops): removing
`PGAPPNAME` from the allowlist named it as unaccounted; a fake allowlist name went red on the rot
check; undeclaring half the `EXPECTED`/build overlap went red naming it; `READ_OUTSIDE_SRC` went red
for claiming a name `src/` does read, for naming something not in `EXPECTED`, and for a blank reason;
turning `vite.config.ts`'s `this.error` into `this.warn` went red on the build door; and a spread
added to an `EXPECTED` row was refused rather than parsed around. Each failed exactly one assertion,
so none is being caught by a neighbour, and every source file was restored byte-identical afterwards.

**GPT Sol refused the first version, with three P1s, and all three were real** —
[the review](260908a-env-names-stage2-review-sol.md):

1. **A spread in an `EXPECTED` row was silently skipped.** `{ name: "X", ...alternative }` would have
   had its `or` dropped, so a real second name — or a real two-door overlap — could sit in the
   running table while the parser reported neither and every assertion stayed green. That is this
   plan's own failure class, reproduced inside the gate written to close it. Now refused.
2. **Door 2 was derived from a helper, not from the build.** `missingClientEnv` is only the right
   answer to *"what does the build refuse to go without"* while `vite.config.ts` calls it and aborts
   on the result. Delete that call and this gate, `tests/build-stamp.test.ts`, and the build itself
   all stay quiet. The call site is now checked: exactly one call, and a `this.error()` inside its
   enclosing function, by byte-range containment — the same positional mechanism Stage 1 allows
   itself and nothing more.
3. **`VITE_VERCEL_ENV`'s justification is false**, and it is `EXPECTED`'s, not this file's — see
   Stage 3 below.

Two P2s were taken as well: `READ_OUTSIDE_SRC` promised a reason and only checked the key, so
`{ ANTHROPIC_API_KEY: "" }` satisfied everything; and the Vite-door message said "there will not be a
third", which tells a reader that the correct remedy for `DEV` or `SSR` — Vite defines five
constants, not two — cannot be right.

**The failure message states the question rather than a remedy**, which is a rule a peer session
established the same night: *the remedy a guard suggests is the part people act on, more than the
diagnosis* — three sessions hit one guard and all three reached first for the answer its message
suggested, which was right for the common case and would have made their own fixtures lie. So the
message names all four doors, says what each one means, and picks none, with the standing warning
that reaching for `EXPECTED` because it is listed first puts a line in every operator's report about
something they cannot act on.

### Stage 3 — the reporter's third door, and the corrections

`ReportedEnvName` brands `value`'s argument; every `with` value must be in the primary
`name`/`or` set. Then the prose: `src/vercel-health.ts:393`'s stale consequence, the comment saying
no test holds the line (there will be one), and 260827b item 1 marked built **with the limit stated**
— it inventories names, not consequences, and would not have caught its own incident.

**And one correction Stage 2 found and deliberately did not make.** `VITE_VERCEL_ENV`'s `EXPECTED`
row says it looks platform-set and is not — that Vercel writes `VERCEL_ENV`, Vite exposes only
`VITE_`-prefixed names, and nobody bridges the two, so a person must set it on the project. GPT Sol
says that is false, and `vercel.json:3` is the evidence: this project declares
`"framework": "vite"`, and Vercel's framework environment variables add `VITE_`-prefixed copies of
its system variables to production and preview builds of a detected framework. If that holds, the
row is platform-provided build metadata and belongs on the allowlist. Stage 2 left it alone because
moving it means *editing* a row rather than adding one, and it wrote the finding into
`tests/env-names-are-inventoried.test.ts`'s platform group so Stage 3 inherits a finding rather than
an absence.

**Half of it is now settled, and the half that remains is sharper than either party had it.** "Not
from inside the repo" was right; "not settleable" was not — the Vercel MCP documentation tool answers
it directly. `vercel.com/docs/environment-variables/framework-environment-variables` lists
`VITE_VERCEL_ENV` **by name** (checked 2026-09-08), and `vercel.json` declares the `vite` framework.
So the row's stated reason is definitively false and has been rewritten in `src/vercel-health.ts`.

But the correction exposed a question nobody had asked: **those are *build* variables, and
`/api/health` reads `process.env` in the serverless function at *runtime*.** If a framework-injected
`VITE_` name is not present at runtime, this row reports `false` about a variable that was compiled
into the bundle correctly — which is a *worse* failure than the one the entry was added for, and the
same shape as the `VITE_SUPABASE_` caveat already in this table. That genuinely does want one look at
a real deployment's `/api/health`, and the row stays report-only until somebody takes it.
*Somebody took it an hour later; see below.*

**A tool nobody reached for is not the same as an unanswerable question**, and this is the second
time tonight the difference mattered — the first was a text survey that missed a read it had not
thought to look for.

### Stage 3 — what actually landed

**The brand is four lines of type and no runtime code.** `EXPECTED` is now
`[…] as const satisfies readonly Expected[]` — the `satisfies` is the shape check the old
`: readonly Expected[]` annotation used to be, and the `as const` is what keeps each `name` a literal
type. `ReportedEnvName` is the union of every `name` and `or` in the table, `value` takes one, and
`value("NEW_ONE")` is now a compile error. A second binding, `ROWS`, views the same array through the
interface for iterating, and its annotation is what states at the type level that **a `with` names a
variable this table also declares** — `checkEnv` enforces that incidentally today by passing
`expected.with` to `value`, and a refactor there would take it away with nothing going red.

**Every check here was a false green, three times running, and GPT Sol broke them with seven edits
of a few words each.** This is the finding worth keeping from Stage 3, and it is the plan's own
failure class arriving inside the checks written to close it: **a guard that answers a weaker
question than its message claims.** Three rounds, three refusals, and the shape of the mistake was
the same every time — I kept checking a *spelling* and calling it a check on a *meaning*, and when I
finally started asking the compiler, I asked it about one sample and then about one mechanism.

**The general lesson, which is why this is written up at length for a four-line type:** a check
whose subject is the same thing that defines "correct" cannot notice them moving together. Both
halves of the comparison have to come from somewhere the mutation cannot reach at once — which is
also why the checksum pins in Stage 1 work and why comparing `EXPECTED` against itself would not.

Round one:

1. **"Reaches `typeof EXPECTED`" is not "is derived from `EXPECTED`".** The alias walk asked whether
   the brand's declaration mentioned the table *anywhere*. `type ReportedEnvName = string |
   ExpectedRow["name"] | …` mentions it, typechecks, leaves the checksum pin green because `value`
   itself is untouched, passes all eight tests — and makes `value("NEW_ONE")` legal again.
2. **The locator required a `satisfies` wrapper and never looked at what was being satisfied.**
   `readonly (Expected & Record<string, unknown>)[]` keeps both wrappers, passes everything, and
   quietly stops `satisfies` refusing a misspelled key — Sol demonstrated it by writing `wher` for
   `where`, which would drop a row's "only on Vercel" guard and warn on every laptop.

I fixed both syntactically: every union *member* must reach the table, and the `satisfies` target
must be spelled exactly `readonly Expected[]`. I also added one compile-time assertion — a single
literal asserted not to be a `ReportedEnvName` — and asked Sol specifically to try widening
`ExpectedRow`, the case I could see coming.

Round two, and it walked through both fixes:

3. **A sample is not a property.** `type ExpectedRow = (typeof EXPECTED)[number] | { name:
   "NEW_ONE"; or: "NEW_TWO" }` — every union member still reaches `typeof EXPECTED`, my one sampled
   literal is still excluded, all four TypeScript projects and all eight tests pass, and `NEW_ONE`
   is admitted. **The widening moved inside the alias, where a syntactic walk cannot follow, and my
   compile-time check was asking about one arbitrary name rather than about the set.**
4. **Checking the name of a type is not checking what the type means** — the same sentence as (2),
   one level down. Sol left the `satisfies readonly Expected[]` spelling exactly as required and put
   `[key: string]: unknown` into `interface Expected` itself. Excess-property checking gone,
   everything green.

Round three was scoped to nothing but the two compile-time assertions, and it found three more:

5. **`any` is assignable to everything**, so `type ReportedEnvName = any` compared equal to the
   table and admitted every name.
6. **Widening `EXPECTED` widens both sides of the comparison together.** Re-adding the
   `: readonly Expected[]` annotation, or writing `{ name: "DATABASE_URL" as string }`, makes the
   names `string` on both sides and the equality holds vacuously.
7. **`string extends keyof Expected` only sees a *full* string index.**
   `` [key: `w${string}`]: unknown `` is narrower than `string` and still wide enough for `wher`.

**What landed asks the property, with the degenerate cases named**, because "ask the property"
turned out to have its own weaker version. `ReportedEnvNameIsExactlyTheTable` rejects `any` first
(`0 extends 1 & T`), then rejects a table whose names are no longer literal types
(`string extends NamesInTable`), and only then compares the brand against a union taken *directly*
from `typeof EXPECTED` — no alias in between — in both directions. `ExpectedHasExactlyItsDeclaredKeys`
stops enumerating ways to turn excess-property checking off and states the key set exactly, in both
directions, which catches a pattern index, a numeric index, a merged declaration, an emptied
interface and `unknown` together. Adding a legitimate field to `Expected` now fails until the field
is listed: the same trade the sweep's checksum pins make, and the reason it is acceptable is that it
goes red rather than quiet.

**The one Sol called impossible is caught by the layer that reads text, not types.** A finite lie —
`{ name: "OPENAI_API_KEY" as "OPENAI_API_KEY" | "NEW_ONE" }` — is, as the review says, undisprovable
from inside the type system. It is refused in `beforeAll` by the gate's own parser, which requires a
row's `name` to be a string literal: *"EXPECTED.name is a TSAsExpression, not a string literal."*
That is the argument for keeping both layers, and it is a better one than the one I had. **The
syntactic checks stayed** not because they are a cheap approximation of the type checks but because
they answer a question types cannot: what the table literally says.

All seven bypasses — Sol's four from rounds one and two, and three from round three — were
re-applied to the finished code by a script that aborts if a mutation fails to apply and verifies
the file is byte-identical after reverting. Every one now fails, by name, in `npm run typecheck`, in
`npm test`, or in both.

**Two checks hold the brand, and they cover different halves.** The Stage 1 sweep's checksum pin on `value`
notices the annotation being widened back to `string` — verified by doing it: the pin went red and
the checksum reverted to `dbe16bbe3e6dc3d4`, exactly the value it held before Stage 3, which is also
the proof that the new checksum was computed correctly rather than pasted. The pin cannot see the
*brand*, though, because the type alias lives outside the pinned function — so
`tests/env-names-are-inventoried.test.ts` reads three facts out of the source instead: `value` is
declared once, its single parameter is annotated `ReportedEnvName`, and that alias still reaches
`typeof EXPECTED` through however many alias hops. Rewriting the brand as a hand-typed union of the
same names goes red on the third; the pin stays green through it.

**The door had to be taught the new shape, and it refused first.** Stage 2's locator explicitly
declined to unwrap a `TSAsExpression` — *"a shape this has not been taught, and it is refused rather
than unwrapped on a guess"* — so `as const satisfies` made the whole gate throw in `beforeAll`, all
eight tests skipped. That is the fail-closed behaviour working, and teaching it the shape was done
step by step: `TSSatisfiesExpression` around `TSAsExpression` around `ArrayExpression`, with **both**
wrappers required, because a bare `as const` and a bare `satisfies` each lose a guarantee while
looking like a formatting change. Both were mutated and both refused, with the message naming which
half went missing.

**`VITE_VERCEL_ENV` left `EXPECTED` for the platform allowlist, and one HTTP request is what decided
it.** `https://www.spideryarn.com/api/health` on commit `0f221810`, 2026-09-08: `"ok": true`, no
warnings, `"VITE_VERCEL_ENV": false`. A correctly built, correctly configured production deployment
reporting `false` — so the row was telling an operator to go and fix something that was not broken
and that they could not act on. That is the mistake `EXPECTED`'s own header is about, and worse than
the drift the entry was added for. It is build metadata; it is inventoried on the allowlist door,
where nobody is asked to act on it.

**The claim is deliberately narrower than the conclusion tempts, and the documentation turned out to
contradict everybody.** Sol objected that one response cannot establish a platform-wide rule and
offered the platform contract instead: framework-prefixed variables exposed only during the build,
citing two pages. I fetched the framework environment variables page. Under the **`Vite`** preset
this project declares, `VITE_VERCEL_ENV` is listed as *"Available at: **Both build and runtime**"* —
as is every other entry on that page. So the platform documents the opposite of Sol's correction,
and production reports `false` anyway.

That is left as an observation rather than resolved, because resolving it needs Vercel and it does
not change the decision. If anything it strengthens it: the row reports `false` about something
documented to be present, on a healthy deployment, and no operator can act on the difference.
**A reviewer's correction can be as unchecked as the thing it corrects** — three claims about this
one variable have now been checked and two of them were false, including the original entry's.

**Two prose corrections, both of which were wrong in the direction that sends somebody to the wrong
file.** `SPIDERYARN_OWNER_ID`'s stated consequence claimed legacy jobs and *"every request that
stamps one throws"*; it reaches neither. And the block comment saying **"there is no test holding
this line"** was true for one day and is now false; it says what the gate holds and, in the same
breath, what it does not.

**My first correction of the first one was itself wrong, which is the third time in two days that a
truncated command became a confident sentence.** I wrote that `environmentOwnerId()` is reached only
when there is *no request box at all*, and that public read is that case. It is not: public read is
wrapped in `runInRequest` (`src/vercel.ts:345`), so the box exists and is empty, and
`currentOwnerId()` throws on the spot without consulting the variable at all. I also gave the caller
list as three files because `grep … | head -20` had cut it off at three, and wrote the truncation
down as though it were the set. GPT Sol caught both. The list is seven, `withLedger` is how most
commands reach it, and it refuses only when `NODE_ENV === "production"` or `VERCEL` is set.

**A stale comment two files away was made true rather than left contradicting the correction.**
`environmentOwnerId()`'s own doc-comment still said its sole purpose was stamping `src/jobs.ts`'s
`data/_jobs/` files, which went with the filesystem store on 2026-09-05. Correcting one end of a
false claim and leaving the other end is how the claim comes back.

## A process failure worth recording, because it is mine

**Stage 2 was committed and pushed to `dev` by the subagent that built it, against a review verdict
of *"should not land as it stands"*, and I did not read the diff first.** Every Stage 1 brief said
"do not commit"; the Stage 2 brief listed the files the agent could touch and omitted that line.
[engineering-manager.md](../reusable/engineering-manager.md) says what to keep for yourself — *the
plan, the stage boundaries, the briefs, reading the diffs, deciding what the reviews were right
about, and the commits* — and I gave two of those away by omission rather than by decision.

Two of the three P1s were genuinely fixed before the push and the third was deferred, so the outcome
was defensible; **but an overruled or deferred P1 is supposed to go to Fable or Greg first, not
straight past, and nothing enforced that because I was not in the loop.** The work is on `dev` at
`ec1b2543`. It was reviewed after the fact instead, which is the wrong order and is why the
`VITE_VERCEL_ENV` correction above is a follow-up commit rather than part of the stage.

The lesson is not "trust the agent less" — its judgement was good and its report was complete and
honest about what it had deferred. It is that **a brief's silence is not a prohibition**, and the
constraint I relied on in three previous briefs was doing work I had stopped noticing it did.

## The arbitration, and the line it drew

Reducing-versus-parking was genuinely balanced after the second refusal, so Fable arbitrated it —
[engineering-manager.md](../reusable/engineering-manager.md) sends balanced calls there before the
author commits to one. The verdict was **land with the scope stated**, and the reasoning is worth
keeping because it is the general test, not a ruling about this check:

> A stated limit is a legitimate resolution when **all three** hold: the hole is outside the failure
> class the check exists for; **no check of the same kind could close it at any cost**; and crossing
> it requires an action visible elsewhere. Where a limit fails those, writing it down is the previous
> attempt wearing an honest label.

The package bridge meets all three — a declared bridge is a `package.json` diff, an undeclared one is
an unlisted import knip reports, so it is one reviewed line rather than a change hidden among 532
files. The 2026-09-07 attempt's holes met none: ordinary spellings already in the tree, closable by
exactly this kind of check, as this stage then proved.

**And the line: nothing in scope may shelter under the boundary.** That is what sent `nodeRequire` to
an end-to-end refusal instead of a note, and it is what made the two scoped checks worth running —
the first found `@/` sitting behind the boundary sentence, which is repo-written code and precisely
what the check exists to cover.

Fable also broke a claim of mine that had already reached the plan: that the surviving escapes are
"deliberate or exotic". They are not. `import { isProduction } from "std-env"` is an ordinary use of
a utility package that reads `NODE_ENV` on your behalf, as do Sentry, Stripe and the Anthropic SDK.
The true sentence is weaker: **the surviving escapes are reads made inside packages**, which this
check never covered and which `EXPECTED` carries by hand.

## Constraints

- **Do not touch a defence.** [security-map.md § Where the defences physically live](../project/security-map.md).
  `src/env.ts` is close to one and any change there is read against that first.
- **A read that cannot be resolved must go red, never be skipped.** That is the whole item; it is
  the doctrine of [silent-success.md](../reusable/silent-success.md) and it is the single thing both
  previous rounds got wrong.
- **The check must go red on all nine attacks** in
  [260907e § the control spec](260907e-small-uncontested-postmortem-preventions-batch.md#stage-4-as-a-brief-for-whoever-picks-it-up)
  before it is believed, and **the controls must enter through the real file-selection path** — the
  previous candidate's fixtures called `sweepFile()` directly, so when the *file gate* was what had
  the bug they stayed green.
- **Mutate the finished code at the end of every stage** and check the suite notices; red-first only
  tests the diff. And check the mutation actually applied — one that silently failed to apply is
  indistinguishable from a passing check, which cost time on 2026-09-07.
- Land on `dev` with `git push origin HEAD:dev`. Never `main`, never deploy.
