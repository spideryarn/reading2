## Findings

Continuing from F6.

**F7 — P2 — established: `declaresNumericStatus` has several false-positive shapes.**

[`declaresNumericStatus`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/routes-status-classes-survive-the-store-guard.test.ts:175) treats any `ClassProperty` with a `number` annotation, or any numeric-literal initializer, as proof of an instance property. It does not reject:

- `static readonly status = 409`
- `declare readonly status: number`
- `readonly status!: number`
- `readonly status?: number`
- `abstract readonly status: number`

The first is only on the constructor; the others can leave `new X().status` undefined. I compiled the `declare` and definite-assignment forms under strict TypeScript and emitted them with esbuild; both instances had `status: undefined` while the candidate predicate accepts them.

There is a second false positive in the same function: `walkAst(node.body, …)` recursively examines method bodies, so a nested class with `status = 409` can certify an outer class that has no status.

Before landing:

- Inspect only direct class members.
- Reject `static`, `declare`, `definite`, `optional`, and `abstract` properties.
- Add red controls for at least `static status`, `status!`, and a nested class.

The current two classes are genuinely safe: `CommentIdTaken` has an instance initializer, and `NotAnExplanation` has an ordinary declared property assigned on every constructor path.

**F8 — P2 — established: `allowlisted` can certify an entry that `mayPassThrough` rejects.**

[`allowlisted`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/routes-status-classes-survive-the-store-guard.test.ts:133) collects every `instanceof X` anywhere below `mayPassThrough`, without checking the left operand, control flow, or return value. All of these would wrongly put `Unsafe` on the allowlist:

```ts
if (err instanceof Unsafe) return false;
if (!(err instanceof Unsafe)) return true;
const inspect = () => err instanceof Unsafe;
if (err.cause instanceof Unsafe) { /* … */ }
```

It also compares only the local spelling at [`allowed.includes(klass)`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/routes-status-classes-survive-the-store-guard.test.ts:217). Therefore `import { Unsafe as ChatConflict } …` in `routes.ts` would be certified by the unrelated real `ChatConflict` branch in the guard.

Before landing, recognize only the present positive form—`if (err instanceof X) return true`—without descending into nested scopes, and compare resolved import identities rather than identifier text. Add negative-branch and same-name/different-binding controls.

**F9 — P3 — established: the Stage 3 comments overstate the signature’s guarantee.**

[`noteJsonRepair`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/json-repair-log.ts:71) accepts `source: string`, so its type does not make payload passage impossible: `noteJsonRepair(raw, …)` typechecks. The module boundary does ensure that raw and repaired text are unavailable inside the logging module, which is still worthwhile.

All 13 `src/` call sites currently pass string literals. Across the wider tree, three more calls pass literals and one eval passes `` `judge answer for ${label}` ``; that label is a slug plus repeat number and is permitted log metadata, but it is not a project-authored constant.

Change “the signature cannot carry the payload” to the narrower truth: the signature does not accept the raw/span, while `source` remains the documented safe-label promise. A closed source union would be needed for a type-level guarantee.

## Stage 2 answers

The `status`-name heuristic has these evasions:

- Renaming or wholly replacing the current chain with a direct return or `switch` goes red because the `KNOWN_MAPPED` positive control loses all three known classes.
- Adding a new direct-return, `switch`, helper-based, namespace-qualified (`Errors.X`), or later-assignment mapping while leaving the existing chain intact slips past.
- `let status; status = err instanceof X ? …` slips past because only the initializer is walked.
- A wholesale restructure could pass only if some other `status` initializer still contains the three known spellings.

Those are limitations of the deliberately chosen scope, not additional findings.

Status forms classify as follows:

| Form | Result |
|---|---|
| Constructor assignment without a property declaration | False negative; safely red |
| Inherited numeric property | False negative; safely red |
| Numeric getter | False negative; safely red |
| `status = 409 as const` | False negative; safely red |
| Numeric enum | False negative; safely red |
| String enum | Correctly red |
| `static`, optional, `declare`, or definite-assignment property | False positive; F7 |
| Nested class’s property | False positive; F7 |

Import handling:

- Re-export: follows only to the barrel, finds no direct declaration, and goes red.
- Non-relative/node_modules import: returns unresolved and goes red.
- Class declared in `routes.ts`: unresolved and goes red.
- Aliased import: generally goes red because it searches the target for the local alias.
- `import type`: not explicitly rejected; it can go green if the target declaration has numeric status, although the production source then fails TypeScript because the symbol is used by `instanceof`.
- Any mapped spelling already found in the allowlist bypasses resolution entirely, producing F8’s binding-identity hole.

## Stage 3 answers

The ordinary-input behavior is semantically unchanged:

| Path | Before and after |
|---|---|
| Clean object or array | Initial strict parse returns immediately |
| Preamble/sign-off, valid extracted object, no comma removed | Extracted value returned; no log |
| Unambiguous trailing-comma repair succeeds | Same value returned; now one `accepted` line |
| Repair removes commas but parsing still fails | Same `parseJsonFrom(text, source)` call and same sanitized error; now one `still-invalid` line |
| Extraction is ambiguous or incomplete | Same fallback to `parseJsonFrom` |
| Malformed array-rooted answer | Still deliberately not repaired; same fallback and no repair line |

The only literal control-flow difference is that `dropTrailingCommas` itself moved outside the old `try`. It has no ordinary throw path for a string; only resource-exhaustion failures would differ, which is not a material P1 here. The logger’s wrapped `warn` swallows failures, so telemetry cannot discard a repaired answer.

The counting gate is correct: every invocation that actually removes one or more commas reports exactly once, including unsuccessful repairs; `removed === 0`, ambiguous extraction, and deliberately excluded array-rooted input report nothing.

No model prose reaches the line. `removed` and `outcome` reveal structural metadata about the answer, intentionally; counts and statuses are permitted by the logging policy.

The separate logging module is justified. It keeps the logger—and therefore arbitrary logging capability—out of the parsing module’s lexical scope. F9 only requires narrowing its claimed guarantee, not deleting the module.

## Verdict

**Land with F7 and F8 fixed, plus the F9 wording correction.** Stage 3’s implementation can otherwise land unchanged. There is no established P0 or P1.

The two requested test files pass: **14/14 tests**.