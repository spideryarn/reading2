# Final narrow check: one fix, and whether it opened anything

The repo is at `/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal`, base `7981430a`.

**This is not a review round.** You have given three verdicts on this stage
(`docs/plans/260908a-stage1-review-sol-1.md`, `-2.md`, and your scoped check of four fixes, saved as
`-3.md`). Discovery has been closed for two rounds. Your scoped check found **one** in-scope escape
still open — the `@/` alias — and the house rule is that an established P1 whose fix was not in an
earlier snapshot gets a narrow check *of that fix*. That is all this is.

**Judge one thing: is the `@/` fix correct, and did it open anything?** Please do not range wider. If
you trip over a P0, say it; otherwise answer this and stop.

## What you found

`@` is aliased to `./src/web` in `vite.config.ts:477` and `src/web/tsconfig.json:27` (13 files under
`src/` import through it). `checkSpecifierValue` returned immediately for every non-relative
specifier, so `import { bridged } from "@/../../scripts/env-bridge.js"` was a repo-written outward
bridge that never looked relative — no name, no refusal. I verified the alias config myself before
acting.

## What was done

`checkSpecifierValue` now resolves an `@/` prefix against `<swept root>/web` and puts it through the
same containment arithmetic relative specifiers already get. **Hard-coded, deliberately** — it is not
a resolver and must not become one; a second alias appearing in the config has to be added here by
somebody who decided to, rather than silently inheriting the treatment. It is written relative to the
swept root so the controls can exercise it against a fixture directory.

Controls, both directions:

- `alias-outward.ts` — your fixture — is red, and asserted specifically as `outward-import` rather
  than merely red.
- `alias-inward.ts` — `@/components/ui/button.js` — is green with its own assertion, because
  refusing the prefix outright would have closed the bridge and taken every shadcn import with it.

All 13 real `@/` imports still green; 532 files, zero refusals, 52 names.

## The three P2 controls you flagged

Each is fixed and verified by mutation rather than by reading:

- `unpinned-loader.ts` — `nodeRequire("some-pkg").env.LOADER_ESCAPE`, with a specifier that is *not*
  a forbidden string, so the require-identifier rule is the only thing that can refuse it. Removing
  `nodeRequire` from `REQUIRE_NAMES` now fails this control; before, the suite stayed green.
- `destructured-create-require.ts` — the previously unproven twin narrowing.
- `omitted-extension.cts` beside the `.mts` one, both asserting collection.

And your underlying point — *a control that is red for an unrelated reason does not prove its rule* —
is generalised: a new `REFUSED_BY` table pins five controls to the **shape** that must refuse them,
so the next instance is caught by construction rather than by a reviewer noticing.

## What I want

1. **Is the `@/` resolution correct**, including that hard-coding it (rather than reading the Vite or
   tsconfig alias map) is the right call? Say if you think it must read the config instead.
2. **Did closing it open anything** — a legitimate import now refused, or a new escape created by the
   resolution arithmetic itself?
3. **Is there another specifier form that is repo-local but does not look relative?** That is the
   exact shape of what you found; if there is a second instance of it, this is the moment.
4. Does `REFUSED_BY` actually prevent the class, or only the five instances listed?

## Severity, ID on every finding

P0 data loss / security / charging / service unusable · P1 user-visible wrong behaviour or an
authoritative contract violated · P2 design risk with no wrong behaviour today · P3 prose.

End with **land as is / land with these changes / do not land**. If "do not land", say whether what
remains is in scope or is the documented package boundary, because that decides whether this goes to
a human tonight or lands with the limit stated.

`npx vitest run tests/env-reads-are-literal.test.ts` — 47 assertions. Note the `npm run typecheck`
wrapper could not open its sandboxed IPC socket for you last time; `node --import tsx
scripts/typecheck.ts` worked.
