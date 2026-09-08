# Make every environment-variable read literal, and inventory them

**Status as of 2026-09-08: Stage 1 built and landed. Stages 2 and 3 not started.** Stage 1 took five
GPT Sol verdicts — two refusals and three scoped checks — and the two changes that mattered both came
from *giving up on making the checker clever*: pinning what cannot be reasoned about, and inverting
the specifier rule to refuse by default. See § Stage 1 — what actually landed.

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
[round 1](260908a-stage1-review-sol-1.md), [round 2](260908a-stage1-review-sol-2.md),
[scoped check of four fixes](260908a-stage1-review-sol-3.md), and two narrower checks after that.
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

### Stage 3 — the reporter's third door, and the corrections

`ReportedEnvName` brands `value`'s argument; every `with` value must be in the primary
`name`/`or` set. Then the prose: `src/vercel-health.ts:393`'s stale consequence, the comment saying
no test holds the line (there will be one), and 260827b item 1 marked built **with the limit stated**
— it inventories names, not consequences, and would not have caught its own incident.

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
