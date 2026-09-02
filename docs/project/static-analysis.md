# Static analysis

What the machine can tell you about this codebase without running it, and — more usefully — the
several tools that look perfect for this repo and are quietly wrong about it.

```
npm run check          # everything below, gates first, ~20s (--fast skips the build)
npm run check -- --offline   # the same, minus the database suites — NOT the real gate
npm run knip           # unused files, exports, dependencies
npm run cycles         # import cycles
npm run complexity     # the functions worth looking at
npm run dupes          # copy-paste
```

Its neighbours: [linting.md](linting.md) is Biome as a *linter* (why not ESLint, which rules are off
and why), [typechecking.md](typechecking.md) is `tsc` and the three projects, and
[testing.md](testing.md) is what we run rather than what we read.

## The one fact that decides everything here

This repo is on **TypeScript 7**, whose Go-based compiler does not expose a public API until 7.1.
Almost every static-analysis tool in the JavaScript ecosystem drives the TypeScript compiler API.
So the usual advice is not merely stale here, it is *broken*, and it breaks in the worst way — by
returning a confident answer about a codebase it could not read.

That single fact is why the list below is so short, and why two obvious names are missing from it.

## What we run

| Tool | What it finds | Gate? |
|---|---|---|
| **[Knip](https://knip.dev) 6.32.2** (`npm run knip`) | unused **files**, **exports**, **dependencies** | advisory |
| **Biome `noImportCycles`** (`npm run cycles`) | import cycles | **gate** |
| **Biome `noExcessiveCognitiveComplexity`** (`npm run complexity`) | functions worth a second look | advisory |
| **[jscpd](https://github.com/kucherenko/jscpd) 5.0.16** (`npm run dupes`) | copy-paste | advisory |

Only Knip and jscpd are new dependencies. The other two were already inside the Biome we had
installed, switched off — which is worth remembering next time a tool is proposed: **mine the tool
you already have before adding one.**

### Knip is the project-wide layer, and only that

`tsconfig.base.json` already sets `noUnusedLocals` and `noUnusedParameters`, so unused *locals* are
the typechecker's job. Knip's job is the layer above: a whole file nobody imports, an `export`
keyword nobody needed, a dependency nobody requires. The two do not overlap, and Knip's own docs ask
to be run alongside a linter rather than instead of one.

It survives TypeScript 7 by not caring about it: Knip v6 removed the TypeScript compiler API and
parses with Rust `oxc-parser`. `typescript` is not among its dependencies at all.

Two things in [`knip.jsonc`](../../knip.jsonc) are load-bearing and both are commented there:
the **CSS in `project`** (without it the three font/Tailwind packages read as unused, because their
only import is in `tailwind.css`), and the **root-level globs** (without them a stray `.mts` at the
repo root is not in the project at all, so it is never reported — a file that falls out of scope
looks exactly like a file with nothing wrong with it).

The `api/` and `src/vercel.ts` entries are there because the deploy is reachable only through
`vercel.json`, which no tool here reads. Delete those entries and four live files start reporting as
dead.

### Cycles gate; nothing else does

There are **zero** import cycles, confirmed independently by four tools, which is exactly why this
one gates: it is green, so a failure means something is newly wrong today. Biome parses with its own
parser, so it is untouched by the TypeScript 7 problem, and it checks 183 files in 14ms.

It was **proved red against a two-file fixture before being switched on**. A check nobody has watched
fail is not yet a check — [silent-success.md](../reusable/silent-success.md).

### Complexity is triage, not a target

`maxAllowedComplexity` is **25**, not the default 15, and the severity is `info`. At 15 it reports 41
functions, which buries the ones that mean something — the same argument that turned
`noNonNullAssertion` off in [linting.md](linting.md). At 25 it reports about 16.

Read a high score as *go and look*, never as *this is wrong*. The metric punishes a long flat
`switch` about as hard as genuinely nested logic, and the worst score in the repo is a route
dispatcher that is fine as it is. Do not ratchet the number down automatically; lower it when the
monsters are gone, if anyone still cares.

## The gate/advisory split

[`scripts/check.ts`](../../scripts/check.ts) runs everything and fails on **gates** only.

> A check that always fails is a check nobody runs.

The lint baseline is deliberately not clean, and Knip has real findings that are queued rather than
fixed. If `npm run check` exited non-zero for those, its exit code would be ignored — and the day a
*test* broke, that would be ignored too. So gates are things that are green **today**: typecheck,
tests, the production build, and cycles.

`npm run build` is a gate because a typecheck does not prove Vite can resolve, bundle and parse the
CSS. Before it was here, that class of failure was only ever discovered by a deploy.

A check earns promotion from advisory to gate on the day its findings reach zero, and not before.

**The test gate runs under `REQUIRE_POSTGRES=1`.** About seventy test files turn themselves into
`describe.skip` when Postgres is unreachable, so `npm test` is green having run none of them — and
this is the command whose green result gets quoted as evidence, which is the run that flag exists
for ([testing.md](testing.md#when-a-skip-is-not-acceptable-require_postgres1)). `npm run check --
--offline` drops it, so the other checks still work on a machine with no Docker; it prints in the
summary that the database suites were free to skip and that this is not the real gate.

**The counted steps.** `complexity` and `dupes` both exit 0 while holding findings — Biome because
`info` is not a failure, jscpd because it only fails above a `--threshold` we do not set. So
`check.ts` counts their output rather than trusting their exit code. It printed "✓ clean" over
seventeen findings before it did, which is the house bug in its purest form.

## The tools that look right and are not

Written down because each cost real time to disprove, and each will look attractive again.

**dependency-cruiser** — the best tool for this by every criterion, and it cannot read this codebase.
Its supported range is `typescript >=2 <7`; without the compiler it parses with `acorn-loose`, and
every `./arc.js` specifier that means `arc.ts` fails to resolve. A `webpackConfig` resolve shim
*does* fix resolution — verified, 0 unresolved over 534 dependencies — and that is the trap:
**resolution is not extraction.** The resolver happily resolves every import the loose parser
managed to see, while saying nothing about the ones it missed. A confident, complete-looking,
possibly-incomplete graph is worse than no graph. Revisit when TypeScript 7.1 ships a public API and
[issue #1069](https://github.com/sverweij/dependency-cruiser/issues/1069) closes.

**Biome's `useImportExtensions`** — looks tailor-made: this repo writes `./arc.js` meaning `arc.ts`,
which is exactly what `forceJsExtensions: true` is for. It finds zero real problems, because every
TypeScript import already complies. What it finds is `import "./tailwind.css"`, which is correct, and
it marks itself **FIXABLE**:

```
- import "./tailwind.css";
+ import "./tailwind.js";
```

That points the only stylesheet entry point at a file that does not exist. Anyone running
`npm run lint:fix` would have shipped an unstyled app and a green linter. Off, with the reasoning
kept in [`biome.jsonc`](../../biome.jsonc) so it is not adopted again.

**skott** — works today, and is the only graph tool that does. Rejected anyway: pre-1.0, one
maintainer, no declarative rule engine, and it silently stops at three files if one `.css` import
fails to resolve, exiting 0. Adopting it would also have been throwaway by design.

**madge** — works today by luck. Last real commit August 2024, which fails
[the selection criteria](../reusable/third-party-library-selection.md) outright.

**type-coverage** — crashes on this repo: `Cannot read properties of undefined (reading 'Unknown')`,
walking the compiler API TypeScript 7 removed. Two open upstream issues, no fix.

**SonarJS** needs ESLint, which [linting.md](linting.md) explains we cannot have. **code-complexity**
crashes on a dead transitive dependency. **purgecss** cannot see class names composed by `clsx`/`cva`
and would report live CSS as dead. **publint/attw** have nothing to check — nothing is published.

**rollup-plugin-visualizer** is *deferred*, not rejected: it is the right tool (7.1.1 is the version
that understands Vite 8's rolldown), but it only runs on `npm run build`, and bundle size does not
matter until there is a deploy to make it matter.

## Ways this lies to you

- **A path in no allowlist is checked by nothing, and says so nowhere.** `biome.jsonc`'s `includes`
  is an allowlist; `api/`, `evals/`, `styles/` and `drizzle.config.ts` sat outside it — typechecked,
  linted by no one — until 2026-08-26. Adding a path to the `lint` **script** alone does nothing;
  it has to go in the config too. The same shape as `knip.jsonc`'s `project`.
- **dependency-cruiser exits 0 with "0 modules"** when pointed at a directory, because without a
  usable `typescript` it will not glob `.ts`. Not our problem while we do not use it; it is here
  because it is the thing you would hit first if you tried.
- **`git ls-files` omits untracked files.** Any file list built that way silently misses new work,
  which in this tree is most of it. [counting-lines.md](counting-lines.md) takes that trade
  deliberately — it counts from git so that `.gitignore` is the only exclusion list — and its
  `--untracked` flag is the way out.
- **A tool that reports findings and exits 0.** See the counted steps above.

## Sources

- [knip.dev](https://knip.dev) · [Knip v6 announcement](https://knip.dev/blog/knip-v6) ·
  [plugins](https://knip.dev/reference/plugins)
- [Biome `noImportCycles`](https://biomejs.dev/linter/rules/no-import-cycles/) ·
  [`noExcessiveCognitiveComplexity`](https://biomejs.dev/linter/rules/no-excessive-cognitive-complexity/)
- [jscpd](https://github.com/kucherenko/jscpd)
- [dependency-cruiser #1069](https://github.com/sverweij/dependency-cruiser/issues/1069) — the
  maintainer on TypeScript 7
- Chosen by the process in
  [third-party-library-selection.md](../reusable/third-party-library-selection.md), with the
  candidates researched three ways and reviewed by GPT Sol and Fable. Every compatibility claim above
  was established by running the tool against this repo on 2026-08-26, not from documentation.
