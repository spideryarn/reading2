# Linting

```bash
npm run lint         # Biome over everything biome.jsonc's `includes` allows
npm run lint:fix     # the same, applying the fixes Biome considers safe
```

Fast enough not to think about — around 20ms for the whole tree — so run it alongside
`npm test` and `npm run typecheck` before you commit. Or run
[`npm run check`](static-analysis.md), which is those three plus the build and the
project-wide analysis, with an honest split between what gates and what only advises.

The config is [`biome.jsonc`](../../biome.jsonc), and every rule turned off in it says there why.

> **`includes` is an allowlist, and that is the trap in it.** A path not named there is linted by
> nothing and says so nowhere — no error, no warning, no "0 files" line in ordinary output.
> `api/`, `evals/`, `styles/` and `drizzle.config.ts` were all in that hole until 2026-08-26:
> typechecked by `scripts/typecheck.ts`, linted by no one.
>
> The npm script is now just `biome lint .`, which is the fix for the second half of the trap: it
> used to repeat the path list, so the script and the config could disagree — and did. Worse, a path
> named in the script that does not exist makes Biome print an internal error and **still exit 0**.
> One list, in the config, and `.` for the scope. One more
> [silent success](../reusable/silent-success.md).

Three rules that live in Biome and are not in its `recommended` set were weighed here. **Two are
on** — import cycles and cognitive complexity. The third was switched straight back **off** after its
autofix was caught rewriting `import "./tailwind.css"` to `"./tailwind.js"`. That story, and the
tools we chose not to install at all, are in [static-analysis.md](static-analysis.md).

## A saved web page killed the linter, quietly

On 2026-08-28 every `biome lint` in this repo — the whole tree, one directory, or one
five-word scratch file — died with

```
thread 'biome::workspace_worker_8' has overflowed its stack
fatal runtime error: stack overflow, aborting
```

and **exited 0 while doing it.** Bisected down to one file:
`evals/extraction/fixtures/whatwg.html`, the HTML Standard, 772KB, nesting roughly
3,700 elements deep. Biome's HTML parser recurses once per level of nesting, and a
macOS worker thread gets a 512KB stack against the main thread's 8MB, so it runs out
of stack partway down the document. It is Biome's own long-running
[stack-overflow bug class](https://github.com/biomejs/biome/issues/10411) — the
recursion depth is the bug, the small stack is why it shows up on a Mac first.

Two things made it worse than a crash.

**It exits 0.** Lint is the one check [CLAUDE.md](../../CLAUDE.md) calls advice rather
than a gate, so nobody reads the output closely and the exit code is all anyone
consults. A crash that exits 0 is indistinguishable from a clean run, and "I ran the
linter" becomes a claim about nothing. Grep the output for `stack overflow`, or check
for the `Checked N files` summary line, before believing it.

**Scope does not narrow it.** `biome lint src` crashed too, and so did a one-line file
in `/tmp`. The scanner walks the whole `includes` allowlist whatever path you hand it,
so the only lever is the allowlist itself. `!evals/extraction/fixtures/**` is in
`biome.jsonc` for that reason.

Neither commit was wrong on its own. `evals/**` joined the allowlist on 2026-08-26,
when there was nothing there to choke on; the fourteen saved pages landed in `5ccd8ed`
on 2026-08-28. The rule to carry forward: **captured inputs are not code, and do not
belong inside the allowlist.** A fixture directory is data that happens to be shaped
like HTML.

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
  for `src/web/components/ui/**`. It isn't needed: across `button` and `toggle` the
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

**And never pass `--formatter-enabled=true` on the command line.** It overrides the decision above
without touching the config, so nothing in the tree records that it happened. Measured once: a single
`biome check --write --formatter-enabled=true` reflowed **205 lines, of which 8 were the author's**
— in a tree several agents have edits in flight in, which is the whole reason the formatter is off.
There is no undo: the recovery is `git show HEAD:<file> >` the file and re-apply your own change by
hand, which is only possible because the other 197 lines were committed. Wrap by hand instead.

## What the first run found

Twenty diagnostics on the first real run. They sorted into three piles, and the split is the useful
part — a linter's findings are not uniformly "bugs to fix".

**Fixed (12).** Five `<button>`s with no `type` (harmless today — there is no `<form>` in the app at
all — but `type` defaults to `submit`, so it is a trap laid for whoever adds one); three string
concatenations that wanted template literals; three `return fail(…), null` comma operators in
[`validate-tree.ts`](../../src/validate-tree.ts) that read as a typo and are now two statements; and
the vendored `src/web/components/ui/**` excluded rather than hand-edited, since `npx shadcn add`
overwrites those.

**False positives, suppressed one line at a time with the reason (5).** Never by switching a rule
off globally. The interesting one is
[`Spine.tsx`](../../src/web/Spine.tsx): `useExhaustiveDependencies` reports `layoutKey` as a
dependency the effect doesn't use — true, it doesn't *read* it. It is a **re-run trigger**, which is
the entire purpose of the prop. Biome marks that diagnostic `FIXABLE`, and its fix deletes
`layoutKey` from the array, which stops the spine re-measuring when the table's layout changes.

> **`npm run lint:fix` would have introduced that bug silently.** Read what a fix does before
> applying it in bulk; `FIXABLE` means "Biome can rewrite this", not "Biome is right".

The others: `<col key={i}>` — a `<col>` is positional by definition, the index *is* its identity;
two static lists rebuilt whole with no child state; and a `tabIndex={0}` on a `role="img"` span that
`noNoninteractiveTabindex` wants removed, when it is what makes the tooltip reachable without a mouse
([Tooltip.tsx](../../src/web/Tooltip.tsx) opens on focus). Removing it would take accessibility away.

On that last one there is a tidier-looking fix we deliberately didn't take: change `role="img"` to
`role="button"`, which satisfies the rule with no suppression at all, because a tabIndex on an
interactive role is expected. It was declined because the element is not a button. Nothing happens
when you press Enter on it — there is no click handler; focus reveals a tooltip and that is all. A
screen reader would announce "button" and promise an action that does not exist, to a user who
already has the whole message from the `aria-label`. That trades an accurate role for a quiet
linter, which is the wrong way round. The suppression is the honest answer: the rule is right in
general, and wrong here, and the comment says why.

**Left alone, on purpose (2 + 1).** Two `useKeyWithClickEvents` on gist cells in
[`TableView.tsx`](../../src/web/TableView.tsx): real, but making cells focusable and Enter-activated
is a design decision about [keyboard.md](keyboard.md), not a lint fix. And the one that matters —
`noDangerouslySetInnerHtml` — turned out to be a genuine way for a hostile article to run JavaScript
in the reading view. It has its own entry, [Q9](open-questions.md#q9), with the pipeline traced and
the payloads that survive Readability. **It is deliberately not suppressed.**

### Suppression syntax, since it cost us three attempts

A `biome-ignore` comment must sit **immediately** above the thing it suppresses, and "the thing" is
whatever the diagnostic points at — sometimes a JSX *attribute* rather than the element:

```jsx
<span
  className={…}
  // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the tooltip
  tabIndex={0}     // ← the diagnostic is on this attribute, so the comment goes here
```

Put explanatory prose *above* the `biome-ignore` line, never between it and the code — any line in
between and the suppression stops applying. Inside JSX children, `//` is rendered text, not a
comment; use `{/* biome-ignore … */}` there.

The saving grace is that Biome **tells you** when a suppression does nothing
(`suppressions/unused`), which is the opposite of how it treats a comment in `biome.json`. A dead
suppression is loud; a dead config is silent.

## A copy outside the repo is checked against a different config

Comparing a file against its committed version by writing it to `/tmp` and
linting that **does not compare the same thing**. Biome resolves `biome.jsonc`
by walking up from the file, so a copy outside the tree gets the defaults, and
whole classes of diagnostic appear or vanish for that reason alone.

It cost a wrong conclusion on 2026-08-30: nine `suppressions/unused` in
`SketchView.tsx` were read as newly introduced, because `git show HEAD:… > /tmp/…`
came back clean. Linted **in place** — same content, written to a throwaway path
inside `src/web/` and deleted straight after — HEAD reports the same nine. They
were pre-existing, and the "fix" would have been an edit to a file somebody else
was working in for no reason at all.

The same applies to `tsc`: a worktree without `node_modules` is not the project.
`git worktree add` and lint or typecheck there if a real before-and-after is
wanted.

## The baseline is not green yet

`npm run lint` still reports a handful, and the count moves as other agents land work. What remains
is the two `useKeyWithClickEvents` and the `dangerouslySetInnerHTML` above, plus whatever arrived
this morning.

**So `npm run lint` is not yet a gate that passes.** Don't wire it into anything that must be green
until the baseline is cleared — and don't clear the baseline by turning rules off. Suppress a single
line with a reason, or fix it, or write it down as an open question. Not the third option quietly.
