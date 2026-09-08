# Review: Stage 3 of the environment-variable inventory — branding the reporter's argument

You are reviewing **built code**, not a plan. Weight this higher than a plan-stage review.

Repo root for this review: `/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal`
(a git worktree of the Spideryarn repo, branch `dev`). Read files with absolute paths under it.

The scoped diff is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/404961e7-a9af-47c9-bf9e-38918ba8ffc4/scratchpad/envlitS3-diff.txt`
(715 lines, five files, nothing else changed).

## The context you need

- The plan: `docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md`.
  Read § *Stage 3 — the reporter's third door, and the corrections* and § *Stage 3 — what actually
  landed* (new, written by me, and itself in scope — if it claims something the code does not do,
  say so).
- Stages 1 and 2 are already on `dev` and you reviewed both (six verdicts). `tests/helpers/env-reads.ts`
  is the sweep, `tests/env-reads-are-literal.test.ts` and `tests/env-names-are-inventoried.test.ts`
  are the two gates. **They are out of scope except where Stage 3 touches or leans on them.** Do not
  re-litigate the package-bridge boundary.

## The seam Stage 3 closes

`src/vercel-health.ts`'s `value()` does `process.env[name]` — a computed read the sweep cannot see
into, so the sweep **pins** the function by AST checksum and declares it yields no names. The sweep's
own header named the resulting hole: a pin covers what is inside it, and `value`'s names come from
its **callers**. `value("NEW_ONE")` would read a variable neither the sweep nor any inventory door
has ever seen.

Stage 3 makes the argument a type derived from the table:

- `EXPECTED` is now `[…] as const satisfies readonly Expected[]` (was `: readonly Expected[]`).
- `type ReportedEnvName = ExpectedRow["name"] | Extract<ExpectedRow, { or: string }>["or"]`.
- `function value(name: ReportedEnvName)`.
- A new `ROWS` binding views the same array through the `Expected` interface for iterating, and its
  annotation is what states at the type level that a `with` names a variable the table also
  declares.

Two checks hold it, deliberately covering different halves:

- the sweep's **checksum pin** on `value` catches the annotation being widened back to `string`;
- `tests/env-names-are-inventoried.test.ts` reads three facts syntactically — `value` declared once,
  its single parameter annotated `ReportedEnvName`, and that alias still reaching `typeof EXPECTED`
  through any number of alias hops — because the pin cannot see the alias, which lives outside it.

Stage 2's `EXPECTED` locator explicitly refused a `TSAsExpression` wrapper rather than unwrapping on
a guess, so it had to be taught the new shape: `TSSatisfiesExpression` → `TSAsExpression` (`as
const`) → `ArrayExpression`, with **both** wrappers required.

## The two corrections that came with it

1. **`VITE_VERCEL_ENV` moved out of `EXPECTED` onto the platform allowlist.** Your Stage 2 review
   said its `EXPECTED` justification rested on a false platform claim and that it belongs in a
   platform/build-metadata group. Half of that was settled from the docs (`vercel.json` declares
   `"framework": "vite"`; framework env vars add `VITE_`-prefixed copies to the **build**). The other
   half — whether such a name is also present in the serverless function's `process.env` at
   *runtime* — was settled by fetching production: `https://www.spideryarn.com/api/health`, commit
   `0f221810`, 2026-09-08, returns `"ok": true`, no warnings, and `"VITE_VERCEL_ENV": false`. Raw
   capture at `.../scratchpad/envlit-health-prod.txt`.
2. **`SPIDERYARN_OWNER_ID`'s stated consequence was false** and is rewritten, along with the block
   comment that said "there is no test holding this line".

## Evidence

Every new assertion was watched failing. Mutations were applied to the finished code and reverted by
editing the text back:

| mutation | what went red |
| --- | --- |
| `value(name: ReportedEnvName)` → `value(name: string)` | the brand assertion **and** the sweep's pin, whose checksum reverted to `dbe16bbe3e6dc3d4` — exactly its pre-Stage-3 value, which is also the proof the new checksum was computed rather than pasted |
| `ReportedEnvName` rewritten as a hand-typed union of two literal names | the `derivedFromExpected` assertion only; the pin stayed green, which is why that assertion exists |
| `as const satisfies …` → `satisfies …` | the locator refused: "a satisfies expression around a ArrayExpression, not around `as const`" — thrown in `beforeAll`, all 8 tests skipped |
| `as const satisfies …` → `as const` | the locator refused: "a TSAsExpression, not a satisfies expression" |

`npm run typecheck` clean. `tests/env-reads-are-literal.test.ts` 53 passed;
`tests/env-names-are-inventoried.test.ts` 8 passed; `tests/doc-links.test.ts` 14 passed.

## What I want you to attack, in this order

1. **Does the brand actually constrain anything, or does it typecheck by accident?** Specifically:
   is there a call path into `value` that reaches it with a widened `string` — through `ROWS`,
   through `names.map(value)`, through the `Expected` interface's own `string` fields? `ROWS` is
   annotated `readonly (Expected & { name: ReportedEnvName; or?: ReportedEnvName; with?:
   ReportedEnvName })[]` and assigned `EXPECTED`; if that intersection is satisfiable in a way that
   lets a plain `string` through, the whole stage is decoration.
2. **Is the `with` guarantee real?** I claim `ROWS`'s annotation states it at the type level
   independent of `checkEnv`'s call site. Check that a `with: "NOT_A_ROW"` would actually fail to
   compile, and say which construct catches it.
3. **Are the three syntactic facts in the gate each necessary and each sufficient for what they
   claim?** In particular the alias walk: it follows `TSTypeReference` names transitively from
   `ReportedEnvName` looking for a `TSTypeQuery` of `EXPECTED`. Can that reach `typeof EXPECTED`
   through a path that does not actually derive the union from the table — a union that *mentions*
   the alias but is widened, say, or `string & {}`? A false green there is the whole point of the
   assertion.
4. **Is the locator's new shape-check too narrow or too loose?** It requires both wrappers. Is there
   a spelling that keeps both guarantees and is refused, or one that loses a guarantee and is
   accepted?
5. **Is the `VITE_VERCEL_ENV` move right, and is my evidence sufficient for it?** One production
   fetch is one data point. Say if it is not enough, and what would be.
6. **Is anything in the new prose factually false about the tree?** Especially the
   `SPIDERYARN_OWNER_ID` paragraph in `src/vercel-health.ts` and the 260827b item 1 update, both of
   which make claims about call sites I checked by grep. `docs/postmortems/260827b-health-check-green-while-uploads-dead.md`
   item 1 is now marked built, and the limit I attached to it is: *it inventories names, not
   consequences, and would not have caught the incident it was written for.* Is that limit stated
   accurately, and is it the right limit?

Severity P0–P3. If you think the stage should not land, say so plainly.
