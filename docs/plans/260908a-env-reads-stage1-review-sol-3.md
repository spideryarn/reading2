No P0s. Items 1–3 are implemented correctly, but several controls are incomplete. Item 4 still contains an in-scope escape.

### P1-1 — Item 4 misclassifies the existing `@/` alias as a package boundary

[checkSpecifierValue](../../tests/helpers/env-reads.ts:531) treats every non-relative specifier as a package. In this tree, `@/` is instead a repo-local alias rooted at `src/web` ([Vite config](../../vite.config.ts:476), [TypeScript config](../../src/web/tsconfig.json:24)).

I checked the real Vite resolver:

```text
@/../../scripts/build-stamp.js
→ ../../scripts/build-stamp.ts
```

Therefore this works as the already-refused relative outward bridge, without looking relative:

```ts
// scripts/env-bridge.ts
export const bridged = import.meta.env;

// src/web/example.ts
import { bridged } from "@/../../scripts/env-bridge.js";
export const hidden = bridged.VITE_HIDDEN;
```

The import and final read are under `src/`, the bridge is repo-written, and the sweep reports neither a name nor a refusal. This is not the accepted external-package boundary. The package-boundary control at [line 475](../../tests/env-reads-are-literal.test.ts:475) cannot detect it.

Item 4 remains open. Resolve the known `@/` alias—or at minimum refuse parent traversal through it—and add an outward-alias control. Genuine package imports can remain documented-green.

### P2-1 — Item 1’s `createRequire` twin has no load-bearing control

The implementation is correct, and the conservative `process`-key rule is survivable: the production sweep parsed 532 files with zero refusals. The `createRequire` twin genuinely needed the same change because destructuring it from `await import("node:module")` otherwise bypasses every later identifier check.

However, [destructured-key.ts](../../tests/env-reads-are-literal.test.ts:298) exercises only `checkProcess`. There is no destructured-`createRequire` fixture. The existing `created-require.ts` is in `MUST_BE_GREEN` and has no file-specific behavioral assertion, so it does not prove this narrowing.

### P2-2 — Item 2’s control proves `.mts`, not `.cts`

Sharing `SOURCE_EXTENSION` is reasonable: traversal is independently enumerated, while the explicit fixture independently guards the extension set. The current regex correctly accepts both extensions.

But only `omitted-extension.mts` is exercised. A future pattern accepting `.mts` while dropping `.cts` remains green. Add the symmetric `.cts` fixture and collection assertion.

### P2-3 — Item 3’s roster is sound, but the `nodeRequire` use rule is uncontrolled

The literal roster catches additions, removals, identity changes, yield changes, duplicate rows, omitted files, missing regions and ambiguous regions. A surviving row cannot silently match nothing: [applyPins](../../tests/helpers/env-reads.ts:867) reports `found !== 1` and `matched === false`. Checksum and explanatory-text changes are appropriately outside roster equality.

The `nodeRequire` implementation also correctly refuses every executable occurrence. Its control does not prove that, though:

- `loader-alias.ts` remains red because it contains the independently forbidden `"node:process"` string.
- The real `nodeRequire` occurrences are all suppressed by pins.
- `created-require.ts` and `late-bind.ts` have no assertion about their refusal behavior.

Removing `nodeRequire` from `REQUIRE_NAMES` can therefore leave the suite green. Add an unpinned `nodeRequire("std-env").env.X` fixture and assert a `require-identifier` refusal at that use.

Checks: focused gate 40/40; direct sweep 532 files, zero refusals, twelve pins; all typecheck projects clean; Biome clean. The normal `npm run typecheck` wrapper could not open its sandboxed IPC socket, so I ran the same script via `node --import tsx`.

**do not land — Item 4 is still open.**