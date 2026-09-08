# Review 2: Stage 3 — the fixes for your two P1s

Round two. You reviewed Stage 3 and refused it: two P1s, both reproduced with working mutations,
both real. Your review is at `docs/plans/260908a-env-brand-stage3-review-sol.md`.

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal`. The full diff against
`origin/dev` is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/404961e7-a9af-47c9-bf9e-38918ba8ffc4/scratchpad/envlitS3-diff-2.txt`.

**Discovery is closed except where these fixes opened something new.** Do not raise findings about
parts of Stage 3 you already passed, and do not re-open Stages 1 and 2. What I want is whether each
fix below actually closes the hole you found, and whether the fix itself introduced one.

## P1-1 — "reaches `typeof EXPECTED`" did not prove derivation

Your mutation: `type ReportedEnvName = string | ExpectedRow["name"] | Extract<…>["or"]` — reached
the table, typechecked, kept the pin green, passed all eight tests, made `value("NEW_ONE")` legal.

Two changes:

1. **The walk now asks the question of every union member, not of the declaration.**
   `unionMembers()` flattens the alias body; `reachesExpected()` is called on each member with a
   fresh `seen` set; the assertion is `derivedMembers === members`, and `members > 0`. A bare
   `string`, a hand-typed literal, `string & {}` — each is a member that reaches nothing.
   Your exact mutation now fails with *"1 member(s) of ReportedEnvName do not reach `typeof
   EXPECTED`… expected 2 to be 3"*.
2. **The compiler is asked directly**, because a syntactic check cannot evaluate a type and you said
   so. In `src/vercel-health.ts`:

   ```ts
   type MustBeOk<T extends "ok"> = T;
   export type ReportedEnvNameIsNotWidened = MustBeOk<
     "SPIDERYARN_NOT_A_REPORTED_NAME" extends ReportedEnvName ? "widened" : "ok"
   >;
   ```

   Under your mutation this fails with `TS2344: Type '"widened"' does not satisfy the constraint
   '"ok"'` — verified. `npm run typecheck` runs it; vitest never type-checks, so the gate also
   asserts the alias is still declared (`facts.sentinel`), verified by renaming it and watching that
   assertion go red.

   It is `export`ed only because `noUnusedLocals` rejects it otherwise. Nothing imports it.

**Attack this specifically:** is there a widening that (a) leaves every union member reaching
`typeof EXPECTED` *and* (b) leaves `"SPIDERYARN_NOT_A_REPORTED_NAME" extends ReportedEnvName` false,
while still admitting a name `EXPECTED` does not carry? A widening inside `ExpectedRow` is the case
I expect you to try; say what it does to each of the two checks. Also: is the sentinel's single
literal the right shape of question, or does it need to be a property of the type rather than one
sample?

## P1-2 — the locator never checked what was being satisfied

Your mutation: `satisfies readonly (Expected & Record<string, unknown>)[]` with `where` misspelled as
`wher` — both wrappers present, excess-property protection gone, everything green.

`expectedArrayLiteral()` now requires the `TSSatisfiesExpression`'s type annotation to be exactly
`TSTypeOperator("readonly")` → `TSArrayType` → `TSTypeReference("Expected")` with no type arguments.
Your mutation is refused by name; verified.

**Attack this specifically:** a spelling that keeps both guarantees and is wrongly refused, or one
that loses a guarantee and is still accepted. `Expected[]` without `readonly`, an interface named
`Expected` that has itself been widened, a type argument — say which of those matter.

## P2s

- **P2-3, the owner path — you were right and I was twice wrong.** Public read *is* wrapped in
  `runInRequest`, so the box exists and is empty and `currentOwnerId()` throws without consulting
  `SPIDERYARN_OWNER_ID`; only a call with no box at all reaches `environmentOwnerId()`. My caller
  list was three files because `grep | head -20` truncated it and I wrote the truncation down as the
  set; it is seven, `withLedger` is the common route, and the refusal is conditional on
  `NODE_ENV === "production" || VERCEL`. All rewritten in `src/vercel-health.ts`. I also corrected
  `environmentOwnerId()`'s own doc-comment in `src/owner.ts`, which still claimed the deleted
  legacy-jobs case was its sole purpose — **the only change to a file outside Stage 3's scope, and a
  comment only.** Check it says something true.
- **P2-4, the Vercel claim — I could not confirm your correction, so I narrowed mine instead.** You
  said the platform documents framework-prefixed variables as build-only, citing `/docs/limits` and
  the Vite page. I searched the documentation and could not find that statement; the framework
  environment variables page's Redwood section says those are available "during build and runtime".
  So I have dropped the platform-wide claim from my side *and* not adopted yours. The prose now says
  only what the measurement supports: this row reported `false` about *this* correctly-configured
  deployment, which is enough to disqualify it from a door whose job is reporting on that
  deployment. **If you can cite the line that settles it, do — otherwise tell me whether the narrow
  claim carries the door on its own.**
- **P2-5, "on `dev`"** — the status line now says Stages 1 and 2 are on `dev` and Stage 3 lands with
  this commit.

## Evidence

`npm run typecheck` clean. 75 tests green across `tests/env-reads-are-literal.test.ts` (53),
`tests/env-names-are-inventoried.test.ts` (8) and `tests/doc-links.test.ts` (14). `npx biome check`
clean on all four changed source files. Every mutation above was applied to the finished code and
reverted by editing the text back.

Severity P0–P3, and say plainly whether it should land.
