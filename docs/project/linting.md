# Linting

```bash
npm run lint         # Biome over src/, tests/, scripts/
npm run lint:fix     # the same, applying the fixes Biome considers safe
```

Fast enough not to think about — around 20ms for the whole tree — so run it alongside
`npm test` and `npm run typecheck` before you commit.

The config is [`biome.jsonc`](../../biome.jsonc), and every rule turned off in it says there why.

## Why Biome and not ESLint

ESLint with `typescript-eslint` was the obvious choice, and the type-aware rules are the ones worth
having — `noFloatingPromises` and its relatives catch exactly the failures this project keeps
finding ([silent-success.md](../reusable/silent-success.md)). It was ruled out on a fact about the
TypeScript we run, not on taste.

This repo is on TypeScript 7, the native compiler. TS 7 no longer exports the classic compiler API
from the package root:

```json
// node_modules/typescript/package.json
"exports": {
  ".": "./lib/version.cjs",          // ← the whole root export. Just the version string.
  "./unstable/sync":  "./dist/api/sync/api.js",
  "./unstable/ast":   "./dist/ast/index.js",
  …
}
```

`import ts from "typescript"` now gets you a version number. `ts.createProgram` and the AST types
moved to `typescript/unstable/*`, and `@typescript-eslint/typescript-estree` is built on the old
root API. So type-aware ESLint would mean pinning a second, TS 5 copy of TypeScript purely to lint
with — a second compiler, disagreeing with the real one, out of step with it forever.

Biome brings its own parser and type inference in Rust and never loads the `typescript` package at
all, so it is simply not exposed to this. That is the whole argument. It also happens to be one
dependency and very fast, which is a bonus rather than the reason.

The cost is real and worth stating: Biome's type inference is shallower than a full
`tsc`-backed program, so its type-aware rules catch less than `typescript-eslint` would. We take
that trade because the alternative is two TypeScripts.

## The file is `biome.jsonc`, and the extension is load-bearing

Biome parses `//` comments only in a file named `.jsonc`. Put a comment in `biome.json` and it
**drops the rest of the config** — no error, no warning, exit code unchanged, and every rule you
carefully configured quietly reverts to its default.

Found here the hard way. The config looked right, `npm run lint` ran, and 83 warnings the config
switched off kept appearing:

```
biome.json  with a comment above the rule:  83 hits   ← config silently ignored
biome.json  with the comment removed:        0 hits   ← config applied
```

The tell was that a *deliberately invalid* rule name produced a loud `unknown key` error, while a
valid config with a comment produced nothing at all. A config that is ignored and a config that has
nothing to do look identical from the outside. Seventh entry in
[silent-success.md](../reusable/silent-success.md).

If you edit `biome.jsonc` and a rule doesn't seem to apply, check for a config error before
anything else — and don't pipe it through `tail`, which is how this was missed for half an hour:

```bash
npx biome lint src 2>&1 | grep -i 'unknown key\|deserialize'
```

## What's turned off, and why

- **The formatter, entirely.** See [§ Tabs or spaces](#tabs-or-spaces) below — the short version
  is that it was measured rather than assumed, and it isn't worth the churn. Same for
  `organizeImports`, which would reorder imports across every file.
- **`noNonNullAssertion`**, 83 hits, all `x!`. The count is climbing on purpose:
  `tsconfig.base.json` turns on `noUncheckedIndexedAccess`, so every `blocks[i]` now needs a real
  check or a `!`. Whether a given `!` is a lie is a question about that line's logic, which the rule
  cannot see — so it flags all of them and buries the findings that mean something.
- **[`src/web/tailwind.css`](../../src/web/tailwind.css) is excluded from linting entirely.** Biome's
  CSS parser does not know Tailwind v4's import modifiers: `layer()` it accepts, `prefix(tw)` and
  `source(none)` it does not, and it reports **9 parse errors** rather than lint findings. Parse
  errors also rule out an inline `biome-ignore` — the suppression is never reached, because the file
  never parses. Both modifiers are load-bearing
  ([web-client.md § Four guards](web-client.md#four-guards-all-in-tailwindcss)), so the exclusion is
  the only lever. Everything else under `src/` is still linted; this one file is not linted at all.
  Revisit when Biome learns the v4 syntax.
- **Generated shadcn components get no exception.** The migration plan expected an `overrides` entry
  for `src/web/components/ui/**`. It isn't needed: across `button`, `toggle` and `collapsible` the
  whole crop is one fixable `useImportType` warning on `toggle.tsx`'s `import * as React`. A
  generated component is **our** code the moment it lands — that is the entire shadcn model — so fix
  the file rather than carving out the directory. Add an override only when a rule turns out to be
  wrong about generated code as a class, and scope it to `src/web/components/ui/**`.
- **`noFocusedTests`, in [`tests/layout.test.ts`](../../tests/layout.test.ts) only.** The rule looks
  for bare calls to `fit` and `fdescribe`, which are Jasmine's focused-it. That file has a local
  helper genuinely named `fit`, wrapping `fitView` from
  [`src/web/layout.ts`](../../src/web/layout.ts) — 19 hits, all wrong. Scoped to the one file rather
  than switched off globally, so a real `it.only` left behind anywhere else still fails the build.

`noFloatingPromises` is switched **on**, at error. It lives in Biome's `nursery` group because it
needs type inference, which is also why `@biomejs/biome` is pinned to an exact version in
`package.json`: nursery rules move between releases.

## Tabs or spaces

**Spaces, two of them.** Settled, and settled by counting rather than by preference:

| | |
|---|---|
| space-indented lines in the repo | 10,151 |
| tab-indented lines | 0 |
| files mixing the two | 0 |

There was nothing to reconcile. [`.editorconfig`](../../.editorconfig) now states it, so editors and
agents pick it up without being told.

### Why the formatter is still off

The obvious follow-on is "so configure Biome to space/2 and turn the formatter on". We measured what
that would actually do, at three line widths:

| lineWidth | files touched | lines rewritten |
|---|---|---|
| 80 | 47 / 56 | 1,935 (19.3%) |
| **100** | **39 / 56** | **1,239 (12.3%)** |
| 120 | 43 / 56 | 1,420 (14.2%) |

Even at its best setting that is an eighth of the codebase rewritten for no behaviour change. And
the changes are a wash rather than an improvement. It collapses some genuinely over-wrapped calls,
which is nice; it also takes the tag list in [`src/blocks.ts`](../../src/blocks.ts) — four lines,
grouped so the headings sit together and the block elements sit together — and explodes it into
fifteen lines, one tag each, destroying the grouping that made it readable:

```
-  "P", "H1", "H2", "H3", "H4", "H5", "H6",
-  "LI", "PRE", "BLOCKQUOTE", "FIGURE", "TABLE", "IMG", "HR",
+  "P",
+  "H1",
+  … eleven more lines
```

A formatter earns its churn by ending arguments nobody wants to have. There is no argument here to
end: the indentation is already unanimous, and hand-formatting in this codebase is carrying meaning
a formatter can't see. So it stays off.

### The trap if anyone turns it on

Biome's own default indent is **tabs**, and it **ignores `.editorconfig` unless you ask it to**.
Verified: with `useEditorconfig` unset, a tab-indented file next to an `.editorconfig` saying
`indent_style = space` is reported as already-clean; set `useEditorconfig: true` and the same file
is reformatted to spaces.

So `biome.jsonc` sets `"useEditorconfig": true` even though the formatter is off. It costs nothing
today, and it means that whoever eventually flips `enabled` to `true` gets space/2 from
`.editorconfig` rather than silently converting all 10,151 lines to tabs on the first run.

## The baseline is not green yet

`npm run lint` currently reports around 20 errors, and they are real — mostly accessibility
(`useButtonType`, `useKeyWithClickEvents`), a couple of React correctness ones
(`useExhaustiveDependencies`, `noArrayIndexKey`), and one `dangerouslySetInnerHTML`.

They were left alone deliberately. Nearly every file involved is being edited by another agent right
now, and a lint sweep across someone else's in-flight work is how you lose their changes. Fixing
them is a separate piece of work, best done per-file by whoever owns that file.

**So `npm run lint` is not yet a gate that passes.** Don't wire it into anything that must be green
until the baseline is cleared — and don't clear the baseline by turning rules off.
