# Review: sixth sweep cluster S3 — lint hygiene (dead suppressions, cheap counts; nothing gated)

## The candidate

Your working directory is the cluster's own git worktree. The candidate is the single commit
`b09f88aac`: `git show --stat b09f88aac`, `git diff b09f88aac~1 b09f88aac`.
The plan: `docs/plans/261006j-sixth-codebase-sweep-umbrella.md` § S3 and § "What the review
changed" (U3, U4). The builder's record: `docs/plans/261006j-sixth-sweep-s3-lint-hygiene.md`.

## What it is meant to do

Lint cleanup with **no behaviour change**: dead or misplaced `biome-ignore` comments fixed
(17 → 0), two ESLint-syntax comments replaced or removed, captured fixture pages excluded from
lint, a few small rule counts cleared by mechanical fixes, eight CSS fallbacks suppressed (none
removed), two `biome.jsonc` lines, and four transitively-installed packages declared in
`devDependencies`. Whole-tree lint went 174/166/5326 → 89/138/5239 (errors/warnings/infos).

## What you can run, and what you may change

No network, no database. Run `node --import tsx scripts/typecheck.ts`, `npx biome lint <paths>`,
and database-free tests for the touched components. **You may fix narrowly inside this commit's
files, red-first where behaviour is involved.** Do not commit. Report anything wider.

## Attack it

1. **Every non-comment change in `src/` and `tools/` must be semantically identical.** Go through
   each: removed fragments (did one carry a `key`, or change what a parent sees as `children` —
   an array versus a single element, a `React.Children` count?), `let x;` given a type, `import`
   → `import type` (does the module have side effects that the import was keeping alive? is
   `verbatimModuleSyntax` / the bundler's handling such that a type-only import drops a needed
   runtime import?), `new RegExp("…")` → a regex literal in `tools/fleet/pane.ts` (escapes,
   flags, `lastIndex` state if a literal is now shared where a fresh object was made per call —
   check for the `g`/`y` flags), `return f()` splits in void functions (was the returned promise
   being awaited or chained by a caller?).
2. **SketchView.tsx**: nine `noArrayIndexKey` suppressions moved, one renamed, one new
   `useSemanticElements` suppression on `<g role="button">`. Are the stated reasons true? Is any
   of these hiding a real accessibility or key-stability defect rather than a deliberate choice?
   Report, do not redesign.
3. **`tools/fleet/web/src/ReadinessPanel.tsx`**: the ESLint comment was removed as redundant. Is
   the effect's dependency list actually right? The builder suspects, from reading, that the
   polling effect chooses its interval while `view` is still null so the server's `refreshMs` is
   unused until Refresh is pressed. Establish whether that is a real defect (trace it; a test if
   you can write one without a browser). **Report it; do not fix it here** — the fleet dashboard
   takes behaviour changes only with their own test and plan.
4. **`biome.jsonc`**: `"preset": "recommended"` — is that the right replacement for the
   deprecated field in the installed biome version, and are the same rules on as before? Compare
   the per-rule counts in the builder's doc against a run of your own for three rules NOT touched
   by this commit: they should be unchanged, except for files newly excluded. Two older
   exclusions lost a trailing `/**`: same files excluded?
5. **The fixture exclusion**: only captured third-party pages, nothing we author?
6. **Dependencies**: `git diff b09f88aac~1 b09f88aac -- package.json package-lock.json`. Four
   lines in the lockfile, as claimed? Does anything under `src/` (shipped to Vercel) import one of
   the four at runtime, which would make `devDependencies` wrong? The builder used `^` ranges to
   match neighbours rather than exact pins: right call?
7. The builder edited four files outside its stated set (`scripts/gjd-remote.ts`,
   `scripts/gjd-remote-host.ts`, `scripts/probes/261006f-bot-wall-probe.ts`,
   `evals/simple/new-reader.ts`) and one line of `docs/project/linting.md`. `gjd-remote` is the
   box's session tool: are those edits type annotations only?

## Format

Verdict line first: **ship**, **ship with these fixes (applied)**, or **do not ship**. Findings
with ids (C1, …), severity P0–P3, `file:line`, reproduced or reasoned, fixed (name files) or
reported. Under 900 words.
