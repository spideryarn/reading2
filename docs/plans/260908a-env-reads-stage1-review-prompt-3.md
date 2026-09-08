# Narrowly scoped check of four fixes — NOT a third round of discovery

The repo is at `/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal`, base `7981430a`.

**Discovery is closed.** You reviewed this twice — `docs/plans/260908a-stage1-review-sol-1.md` and
`docs/plans/260908a-stage1-review-sol-2.md`. The house rule is two rounds and then the author
settles, with one exception: **an established P1 whose fix was not in the round-two snapshot gets a
narrowly scoped check *of that fix*.** That is this, and only this.

Please do **not** hunt for new findings in unrelated code. If you happen to trip over a P0 say it,
but otherwise judge exactly the four items below: is each one closed, and does its control prove it?

## Item 1 — P1-1, object destructuring

Was: `const { process: p } = globalThis; p.env.TWENTIETH` swept to nothing, because every
non-computed property key named `process` was treated as inert.

Now: only *type* members (`TSPropertySignature`, `TSMethodSignature`) are skipped; `process` as any
`ObjectProperty` key is refused — literal and pattern alike, because telling them apart is analysis
and refusing both is not. The same one-line narrowing was applied to `checkRequireIdentifier`, where
`const { createRequire: cr } = await import("node:module")` was inert for the identical reason.

Control: `destructured-key.ts`. **Check: is refusing an object-literal key spelled `process`
survivable in this tree, and did the `createRequire` twin actually need the same treatment?**

## Item 2 — P1-4, `.mts` / `.cts`

Was: `/\.tsx?$/` written separately in the sweep and in the test's "independent" enumeration, so both
missed `.mts` and agreed with each other while doing it.

Now: one exported `SOURCE_EXTENSION = /\.(?:m|c)?tsx?$/` used by both. The author's argument, which I
accepted and want you to attack if it is wrong: what must be *independent* is the traversal, which is
the part that was broken; sharing the extension pattern is safer than duplicating it, because
duplication is what let them agree while both wrong.

Control: `omitted-extension.mts`, asserted green with `OMITTED_MTS` collected.

## Item 3 — P1-2, the pin roster and `nodeRequire`

Was: `sweep.pins` and `declaredPins()` both derived from `PINS`, so deleting a row removed it from
both sides and stayed green. And `nodeRequire`'s pin covered only the declarator, so
`nodeRequire("std-env").env.X` in an unpinned function passed.

Now: the expectation is a literal twelve-line list written in the test — file, kind, name, declared
yields — compared against `declaredPins()`. Verified live: deleting the `withoutGitVars` row turns it
red naming that row. `nodeRequire` is refused at **every** use, like `require` and `createRequire`,
with its one legitimate call site separately pinned (`src/jsdom-lazy.ts`, function `jsdom`).

**Check: can a pin still be made to cover nothing while its row survives? Can the literal roster and
`PINS` drift apart in a direction the assertion does not see?**

## Item 4 — P1-3, the package bridge: NOT closed, deliberately, and now a control

This is the one I need you to judge as a **decision** rather than a defect.

`import { env as bridged } from "std-env"` is now refused by a flat rule on the *imported binding
name*. That closes your fixture. It does **not** close the class: `import * as m from "pkg";
m.env.X` remains invisible, and I measured 189 `.env` member accesses under `src/` outside the two
doors, so refusing `.env` generally would need 189 exemptions.

I took this to a second model, which argued — and I accepted — that this is the class the postmortem
excluded on the day it was written: `ANTHROPIC_API_KEY` sits in `EXPECTED` while nothing under `src/`
reads it by name, *because the SDK takes it from the environment itself*. A package bridge is that,
with the last hop lexically inside `src/`. And your own design answer
(`docs/plans/260908a-design-prompt-sol.md` § 3), written before any code existed, said a finite AST
recogniser cannot prove the absence of every possible environment read, listing *"an imported
module"* among the ways.

So instead of closing it:

- the header's false sentence is gone. It said *"You cannot obtain the process object without naming
  it, and every naming is refused."* It now says *"…without naming it **in this tree**. A package can
  name it for you — and that is the boundary, not an oversight."* It claims a syntax policy with a
  named boundary and explicitly never claims soundness.
- the limit is an **executable documented-green control**, `package-bridge-boundary.ts`:
  `import { anything } from "some-pkg"` asserted to be parsed, unrefused, and contributing no name —
  so anyone who later closes the hole must come and flip it. The author verified it is load-bearing
  rather than vacuous: renaming the import to `env` turns it red.
- `value`'s open seam is named at the seam: its pin freezes the reporter but its names come from its
  callers, and Stage 3's `ReportedEnvName` branding is what closes it.

**Check exactly this: does anything that is genuinely *in scope* hide under that boundary sentence?**
That is the line between an honest limit and a hidden one, and it is the only thing I am worried
about. If an in-scope escape is now being excused by the boundary rather than refused, that is a P1
and I want it.

## Run it

`npx vitest run tests/env-reads-are-literal.test.ts` — 40 assertions. `npm run typecheck` clean,
biome clean.

## Severity, ID on every finding

P0 data loss / security / charging / service unusable · P1 user-visible wrong behaviour or an
authoritative contract violated · P2 design risk with no wrong behaviour today · P3 prose.

End with: **land as is / land with these changes / do not land** — and if "do not land", say which of
the four items is still open, because that decides whether this goes to a human rather than round
four.
