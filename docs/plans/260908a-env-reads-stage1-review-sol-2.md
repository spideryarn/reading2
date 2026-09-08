No P0s. Four demonstrated P1s remain, including a continuation of round-one P1-3.

## Findings

### P1-1 — Object destructuring is a twentieth invisible spelling

[checkProcess](../../tests/helpers/env-reads.ts:582) treats every non-computed property key named `process` as inert. That is false for an `ObjectPattern`:

```ts
const { process: p } = globalThis;
export const twentieth = p.env.TWENTIETH;
```

I wrote and swept [/tmp/env-reads-twentieth/read.ts](/tmp/env-reads-twentieth/read.ts:1). Result:

```json
{
  "filesParsed": ["../../../../../../../tmp/env-reads-twentieth/read.ts"],
  "names": [],
  "refusals": [],
  "pins": []
}
```

It passes strict NodeNext TypeScript checking. Refuse `process` as an object-pattern key—or conservatively refuse it as every `ObjectProperty` key.

### P1-2 — Round-one P1-3 remains open: pins cover declarations, not mechanisms

This is explicitly carried forward.

Two pins depend on code outside their checksummed regions:

- The `value` pin covers only [the function body](../../tests/helpers/env-reads.ts:279), not callers supplying the names it reads.
- The `nodeRequire` pin covers only [the variable declarator](../../tests/helpers/env-reads.ts:287), despite claiming every call names a literal specifier.

I built a minimal mirror containing the exact pinned declarations plus:

```ts
export function hiddenThroughUnpinnedCaller(name: string) {
  return value(name);
}

export function hiddenThroughPinnedLoader() {
  return nodeRequire("std-env").env.PINNED_LOADER_ESCAPE;
}
```

The exported sweep returned:

```json
{
  "names": [],
  "refusals": [],
  "pins": [
    { "name": "node:module", "matched": true },
    { "name": "nodeRequire", "matched": true },
    { "name": "value", "matched": true }
  ]
}
```

The reproduction is under [/tmp/env-reads-pin-repro](/tmp/env-reads-pin-repro/run.ts:1), and both files typecheck. Direct checksum probes also showed:

```text
valueBefore      dbe16bbe3e6dc3d4
valueAfterCaller dbe16bbe3e6dc3d4
loaderBefore     6158746bdcf2299b
loaderAfterUse   6158746bdcf2299b
```

The planned `ReportedEnvName` work would address `value`; it needs to land with Stage 1 or the Stage-1 guarantee must be narrowed. `nodeRequire` still needs an end-to-end contract—probably refusing every use of that identifier except separately pinned calls.

There is also no independent pin roster. [The assertion](../../tests/env-reads-are-literal.test.ts:111) compares `sweep.pins` with `declaredPins()`, both derived from `PINS`. Deleting the `applyEnvFile` or `withoutGitVars` row removes it from both sides, while their alias-based environment operations trigger no flat refusal.

Renaming/deleting a pinned declaration while retaining its row does fail correctly. Deleting the row itself does not.

### P1-3 — Bare packages remain an unchecked bridge across `src/`

The boundary check returns immediately for every non-relative specifier at [env-reads.ts:457](../../tests/helpers/env-reads.ts:457). This installed tree already contains `std-env`, which exports its `env` binding as the actual `process.env`.

Fixture:

```ts
import { env as bridged } from "std-env";
export const packageBridge = bridged.TWENTY_FIRST;
```

[/tmp/env-reads-package-bridge/read.ts](/tmp/env-reads-package-bridge/read.ts:1) typechecks and executes. Its sweep result was:

```json
{
  "filesParsed": ["../../../../../../../tmp/env-reads-package-bridge/read.ts"],
  "names": [],
  "refusals": [],
  "pins": []
}
```

Thus the claim that the boundary makes unswept modules harmless is not true. This is not runtime string construction or `eval`; it is an ordinary static import from an existing package.

### P1-4 — File-set equality shares the sweep’s extension omission

Both enumerators use `/\.tsx?$/`, at [env-reads.ts:393](../../tests/helpers/env-reads.ts:393) and [the test:83](../../tests/env-reads-are-literal.test.ts:83). Therefore they agree while omitting `.mts` and `.cts`, both valid TypeScript source included by the project configuration.

I swept this type-correct fixture:

```ts
// read.mts
export const omittedExtension = process.env.OMITTED_MTS;
```

Result:

```json
{
  "filesParsed": [],
  "names": [],
  "refusals": [],
  "pins": []
}
```

The fixture is [/tmp/env-reads-mts/read.mts](/tmp/env-reads-mts/read.mts:1). Include `.mts`/`.cts`, or independently assert that `src/` contains no executable source extension outside the supported set.

## Other observations

### P2-1 — The constant assertion is not repo-wide

[The test](../../tests/env-reads-are-literal.test.ts:172) imports only `hierarchy-deepen.ts` and `env.ts`. A new duplicated exported constant in any other module remains invisible. Using one `Record` also collapses equal export names from two modules.

The current four constants are genuinely protected; the broader assertion title and future guarantee are not.

### P2-2 — The forbidden-string trade is acceptable today, but its escape hatch is costly

The exact-string ban is safely fail-closed and currently costs nothing. I accept the `PROCESS_PROPERTIES` allowlist trade: changing any of those established Node properties to return `process` would itself be a severe Node compatibility break.

The maintenance risk is that a harmless future `"env"` string can only be admitted by pinning a surrounding region, enlarging the area whose refusals are suppressed. An exact-literal pin would be safer than a function-sized pin when that first happens.

## Checksum answers

- Rename, deletion, duplication, or normalized-AST edits are detected when the pin row remains.
- I found no practical executable-AST collision. The 64-bit SHA-256 truncation is not a realistic accidental-collision concern.
- Comments, whitespace, quote style and some punctuation can be edited without moving the hash by design.
- Consequently, the prose claiming “the bytes inside” are identical is false; the guarantee is about normalized AST, not bytes.
- Declared names can drift whenever they originate outside the pinned node, as the `value` reproduction demonstrates.

## P3-1 — Prose still disagrees with the tree

- [supabase.ts:38](../../src/web/lib/supabase.ts:38) still says the variable was unnoticed “for months.”
- [jobs.ts:407](../../src/jobs.ts:407) says three days, despite the stated four-day correction.
- [hierarchy-deepen.ts:1649](../../src/hierarchy-deepen.ts:1649) says a divergence remains silent; the new constant-table assertion now catches it.
- [The plan:223](../../docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md:223) says the tests drive every retained constant through its read, which remains false for `DEEPEN_ENV`.
- [The plan:227](../../docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md:227) says five mechanisms but lists only four, omitting `jsdom-lazy.ts`.
- [The helper:26](../../tests/helpers/env-reads.ts:26) says any region change moves the checksum and that pinned “bytes” are identical; its own checksum test proves otherwise.

Checks completed: focused gate 35/35, `tests/env.test.ts` 20/20, all typecheck projects clean, Biome clean on both new test files, and all adversarial fixtures passed strict TypeScript checking.

**do not land.**