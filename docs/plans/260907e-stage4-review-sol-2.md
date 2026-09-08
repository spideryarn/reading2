## Verdict

**Do not land.** F11, F12, and F13 retain established P1 fail-open paths. F10’s omission is closed, but it introduces a P2 false positive.

## Findings

- **F16 — P1 — established (F11): recognised process roots still disappear.** The current tree already demonstrates this. [sanitize-policy.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/sanitize-policy.ts:382) reaches `globalThis.process?.env` through a `TSAsExpression`, then reads `SPIDERYARN_ORIGINS`, `VERCEL_PROJECT_PRODUCTION_URL`, and `VERCEL_URL`. `isProcessRoot()` does not unwrap the assertion, so the alias and all three reads vanish. The first two names are in neither inventory door, yet the suite stays green. Adding `SPIDERYARN_ORIGINS` to `KNOWN_READS` made the positive control fail.

  There is a second direct hole: `rootAsValue()` handles only `MetaProperty` and bare `Identifier("process")`, not the `MemberExpression` that `isProcessRoot()` itself accepts ([implementation](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:986)). This produced zero reads and zero refusals:

  ```ts
  const { env } = globalThis.process;
  const x = env.HIDDEN_VARIABLE;
  ```

  Unwrap transparent TypeScript nodes, refuse/follow the complete recognised process-root expression, and add the real `sanitize-policy.ts` shape as a control.

- **F17 — P1 — established (F13): read-modify-write is classified as write-only.** Every assignment target and update argument enters `writeTargets`, regardless of operator ([collection](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:556), [skip](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:943)). This returned no read or refusal:

  ```ts
  env.DATABASE_URL ??= "fallback";
  ```

  The same applies to `||=`, `+=`, and `++`. Only pure assignment and deletion are write-only; compound assignments and updates must inventory the old value. Destructured write targets also need recursive lvalue classification to avoid the inverse false positive.

- **F18 — P1 — established (F12): `EXPECTED` can carry an ignored field spelling.** `fieldsOfEntry()` silently skips spreads and keys not written as identifiers ([parser](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:1097)). Changing the fixture to this made `STRIPE_SECRET_KEY` disappear without being inventoried:

  ```ts
  { name: "STRIPE_WEBHOOK_SECRET", ["with"]: "STRIPE_SECRET_KEY", breaks: "x" }
  ```

  Runtime still evaluates `expected.with`. An object spread can introduce the same hole. Recognise static string keys and refuse unexpanded spreads or other unhandled ways of supplying `name`, `or`, or `with`.

- **F19 — P1 — established (F12): premise tracing follows names, not lexical bindings.** `expectedRoots()` stores only the spelling `expected`, and `derived()` accepts that spelling everywhere ([roots](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:1173), [derivation](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:1211)). This produced zero premise failures:

  ```ts
  function injected(expected: { name: string }) {
    value(expected.name); // arbitrary caller input
  }
  ```

  The inverse filter has the same weakness: a block-local `const value` elsewhere in an enclosing function caused a real outer `value("NEW_VARIABLE")` call to be ignored by [referencesTheFunction()](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:1262). Track binding identity or refuse shadowed/ambiguous names.

- **F20 — P1 — established (F13): alias propagation can select the wrong same-named function.** The target is the first file-wide function whose textual name matches the callee ([resolver](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:876)). With two scoped `inspect` functions, the attack reported `NOT_ENV`, missed the actual `HIDDEN_VARIABLE`, and produced no refusal. If the wrongly selected function has no property read, the omission is wholly silent. Resolve the lexical callee binding, or refuse whenever the textual name is ambiguous.

- **F21 — P2 — established (F10): every `MetaProperty` is treated as `import.meta`.** `envKind()` checks only `object.type === "MetaProperty"` ([implementation](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:460)). The attack:

  ```ts
  function F() {
    return new.target.env.NOT_AN_ENV;
  }
  ```

  was reported as an environment read. Match the `import.meta` identifiers exactly.

- **F22 — P2 — established (F13): the claimed fixed point stops after eight rounds.** A reverse-ordered ten-hop chain stopped before the final read and emitted a spurious whole-object refusal ([cap](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:854)). It fails closed, but it is a false-red hazard. The alias set is finite and deduplicated, so iterate until no growth.

## Closure summary

- **F10:** P1 omission closed; F21 remains as a P2 false positive.
- **F11:** not closed — F16, including real uninventoried reads currently in `src/`.
- **F12:** not closed — F18 and F19.
- **F13:** not closed — F17 and F20; F22 is an additional false-red problem.

The candidate test passes 27/27. All attacks above were run against temporary copies and then removed; the worktree was not changed.