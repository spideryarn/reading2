Verdict: **do not land**. No P0s. The runtime refactors look behaviour-preserving, but Stage 1’s authoritative guarantee still has several fail-open paths.

## Findings

### P1-1 — Ordinary environment reads still disappear completely

The recogniser only handles imports, dynamic imports, bare `process` identifiers, and `import.meta`. Several executable, type-correct routes bypass all of those branches around [env-reads.ts:501](../../tests/helpers/env-reads.ts:501):

```ts
globalThis["process"].env.SEVENTEENTH;

const p = process.getBuiltinModule("node:process");
p.env.EIGHTEENTH;

// process-bridge.ts
export { env as bridgedEnvironment } from "node:process";
// another file
import { bridgedEnvironment } from "./process-bridge.js";
bridgedEnvironment.NINETEENTH;
```

I wrote and swept these through the exported `sweepEnvReads` entry point. All four files were parsed, but the result was:

```json
{ "names": [], "refusals": [] }
```

They also pass TypeScript checking. The first is the requested seventeenth spelling. The second directly contradicts the claim at [env-reads.ts:42](../../tests/helpers/env-reads.ts:42) that non-`env` process properties are not doors; this Node version confirms `process.getBuiltinModule("node:process") === process`. The third exists because `ExportNamedDeclaration` is not checked.

Fixtures remain in [/tmp/env-reads-seventeenth](/tmp/env-reads-seventeenth/seventeenth.ts:1).

### P1-2 — “Every `.ts`/`.tsx` file” excludes hidden directories

[sourceFiles](../../tests/helpers/env-reads.ts:282) skips every directory beginning with `.`. I put this in `.hidden/read.ts`:

```ts
export const hiddenDirectoryRead = process.env.HIDDEN_DIRECTORY_NAME;
```

The result was:

```json
{ "filesParsed": [], "names": [], "refusals": [] }
```

A hidden module can still be imported by a visible module. The production assertion at [env-reads-are-literal.test.ts:78](../../tests/env-reads-are-literal.test.ts:78) would not notice one omitted file because it only requires more than 400 of the current 532.

### P1-3 — Every one of the five mechanism contracts can be bypassed

I exercised the contracts against a temporary mirror whose paths were exactly `src/...`. The sweep returned zero refusals, all expected permitted-site counts, the sanitizer’s expected three names, and twelve valid-looking model names—while omitting every injected name below.

| Mechanism | Passing mutation |
|---|---|
| `applyEnvFile` | Shadow `name` in an inner block and read `env[name]`; or read `env.HIDDEN` in a nested closure, which `fnAt` excludes. |
| `sanitize-policy.ts` | Read `env?.HIDDEN_SANITIZER` inside a nested closure. The exact three-name assertion still passes. |
| `jsdom-lazy.ts` | `const r = nodeRequire; r("node:process").env.HIDDEN_JSDOM`; the rule only examines direct `nodeRequire(...)` calls. |
| `models.ts` | Change `envVar`’s initializer to `"HIDDEN_MODEL"` while leaving `MODEL_ENV_VAR` intact. The contract inventories the unrelated record. |
| `vercel-health.ts` | Shadow parameter `name` in an inner block before `process.env[name]`. A future branded parameter does not prevent this. |

The common cause is [usesOf](../../tests/helpers/env-reads.ts:675): binding identity is approximated using textual name plus innermost-function name. So yes, the suspected shadowed `name` in `applyEnvFile` is readily reachable.

For `sanitize-policy.ts`, I would pin the complete normalized AST—or even a checksum—of `ownOrigins`, and yield the three hard-coded names. Because it is a defence nobody may casually edit, making every change require an explicit contract update is appropriate and substantially safer than partial alias reasoning.

### P2-1 — Several positive assertions can remain green over broken coverage

- `filesParsed.length > 400` does not establish the claimed 532-file set.
- Mechanism counts sometimes compare against `m.expected`, which originates in the contract table being tested.
- The constant table at [env-reads-are-literal.test.ts:198](../../tests/env-reads-are-literal.test.ts:198) is hand-maintained. `toHaveLength(4)` cannot discover a fifth exported `*_ENV` constant.
- Its reverse check only proves that the literal appears somewhere in the same file, not that the function paired with the constant reads it. An unrelated read can mask a divergence.
- The controls correctly use the directory entry point, but they only protect their enumerated syntax. The attacks above demonstrate the missing independent backstop.

Compare the exact discovered file list against an independently enumerated expected list, including hidden directories. For constants, either derive the exported `*_ENV` set independently or stop claiming the table covers every surviving constant.

### P2-2 — The implementation has regrown past the design’s complexity limit

The helper and gate are about 1,358 physical lines, plus 164 tracked insertions: roughly 1,522 added lines against the plan’s 250–400-line estimate. The new helper also produces nine Biome errors, including cognitive complexity 35.

What I would cut:

- Delete the `gitNames.size !== 4` block at [env-reads.ts:751](../../tests/helpers/env-reads.ts:751). It contributes no inventory names and does not prove those names are actually deleted. If that behaviour needs protection, give `withoutGitVars` a focused behavioural test.
- Cut most repeated historical prose from the source files and tests.
- Replace the three per-file pseudo-scope walkers with exact pinned function-shape contracts. Do not simply delete `usesOf`; without a replacement, real whole-environment mechanisms would again be unguarded.
- Keep the adversarial controls and add the new families: computed global access, `getBuiltinModule`, process re-exports, hidden directories, binding shadowing, and loader alias escape.

### P3-1 — The prose overstates or misstates what was built

- The plan says four mechanisms at [the plan:4](../../docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md:4) and [the plan:208](../../docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md:208); the code and test have five, including `jsdom-lazy.ts`.
- “No alias-following” and “no scope analysis” at [env-reads.ts:21](../../tests/helpers/env-reads.ts:21) are false: `fnAt`, `usesOf`, and the sanitizer rule perform approximate scope and alias analysis.
- “A flat rule cannot be got wrong by a spelling nobody thought of” at [env-reads.ts:81](../../tests/helpers/env-reads.ts:81) is disproved by computed properties, re-exports, and the `nodeRequire` alias.
- The plan says `DATABASE_URL` gets a separate module-load snapshot at [the plan:153](../../docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md:153). The implementation retains the whole `INHERITED` snapshot and indexes it later.
- Multiple new comments say `SPIDERYARN_ENV_PINNED` hid “for months,” for example [jobs.ts:405](../../src/jobs.ts:405). Git shows it was introduced on 2026-09-04, four days ago.
- Deleting `CONCURRENCY_ENV` was correct, but [worktrees.md:456](../../docs/project/worktrees.md:456) still names it.

## Behaviour changes

The `src/` refactors themselves are fine:

- `chooseTargetUrl` retains the same shell-wins/file-wins truth table and evaluation timing.
- The sole runtime `applyEnvFile` caller parses the same `SPIDERYARN_ENV_PINNED` value at the same point.
- The fetch, hierarchy, jobs, and Supabase changes preserve their previous value tests.
- Deleting `CONCURRENCY_ENV` while retaining the three deepening constants is the right asymmetry: nothing imported the former; evals/tests import the latter.

Checks run:

- Focused Vitest gate: **28/28 passed**
- Adversarial generic and mechanism probes: reproduced the omissions above
- Attack snippets: TypeScript clean
- `git diff --check`: clean
- Biome: nine new helper errors, plus pre-existing advice in `src/jobs.ts`

**Final verdict: do not land.**