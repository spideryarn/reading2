# Sixth sweep, cluster S3: lint hygiene

One cluster of the [sixth codebase sweep](261006j-sixth-codebase-sweep-umbrella.md). Its job: take
the noise out of `npm run lint` that costs nothing to remove, so the findings that mean something
are easier to see. **Nothing is promoted to an error and nothing is gated** (the umbrella's review,
U4): lint stays advice, as [linting.md](../project/linting.md) says.

Nothing a reader sees changes. No rule was switched off.

## Totals

`npm run lint`, whole tree, 2026-10-06, before and after:

| | before | after |
|---|---|---|
| files checked | 3986 | 3930 |
| errors | 174 | 89 |
| warnings | 166 | 138 |
| infos | 5326 | 5239 |

Per rule, every rule whose count moved (`npx biome lint --max-diagnostics=none --reporter=summary .`):

| rule | before | after | why |
|---|---|---|---|
| `suppressions/unused` | 17 | 0 | item 1 |
| `suspicious/noArrayIndexKey` | 15 | 6 | 9 suppressions in `SketchView.tsx` now take effect |
| `a11y/noNoninteractiveElementToInteractiveRole` | 1 | 0 | suppression in `SketchView.tsx` now takes effect |
| `a11y/useSemanticElements` | 9 | 5 | 1 in `SketchView.tsx`; 3 were captured pages |
| `suspicious/noDuplicateProperties` | 8 | 0 | suppressed with the reason; no declaration removed |
| `complexity/noUselessFragments` | 9 | 1 | 3 removed, 5 suppressed; the 1 left is in `tests/` |
| `suspicious/noImplicitAnyLet` | 4 | 1 | 3 annotated; the 1 left is `src/store/pg-jobs.ts`, S5's |
| `style/useImportType` | 3 | 0 | biome's safe fix |
| `complexity/useRegexLiterals` | 4 | 0 | `tools/fleet/pane.ts` |
| `correctness/noVoidTypeReturn` | 2 | 0 | |
| `suspicious/noControlCharactersInRegex` | 19 | 18 | `routes-new.ts`'s is now suppressed in biome's syntax |
| `suspicious/useBiomeIgnoreFolder` | 2 | 0 | `biome.jsonc` |
| `a11y/useAltText` 47→3, `useAnchorContent` 2→0, `useHtmlLang` 3→1, `useValidAnchor` 3→2, `suspicious/noDoubleEquals` 8→0, `correctness/noUnusedVariables` 4→2, `style/useTemplate` 59→53, `complexity/useLiteralKeys` 4795→4723 | | | all from no longer linting the captured pages (item 3) |

The deprecation notice that opened every run is gone too.

## What landed

**1. The 17 dead suppressions.** Removing each and re-running lint on the file sorted them into
three kinds.

- *In the wrong place (10).* Nine `noArrayIndexKey` suppressions in `SketchView.tsx` were JSX
  comments above the `.map(` line; biome reports the `key` two lines further down and did not
  connect them, so nine errors were being reported next to nine comments explaining why they were
  fine. Each moved to the line above its `<Shape key=…>`, the one position in that file where an
  identical suppression already worked. The reasons are unchanged.
- *Naming the wrong rule (2).* The `<svg role="listbox">` carried a suppression for
  `useSemanticElements`, and what fires there is `noNoninteractiveElementToInteractiveRole`; same
  reason, right rule now, and placed on the `role` attribute, which is where it takes effect. The
  region `<g role="button">` carried one for `useKeyWithClickEvents`, which cannot fire (it has a
  key handler); what fires is `useSemanticElements`, now suppressed with the true reason, that SVG
  has no `<button>`. **This one is a new suppression rather than a moved one**, and is the only
  such case.
- *Simply dead (5).* The rule does not fire there at all: two hook-deps suppressions
  (`SketchView.tsx`'s zoom effect and `StructurePanel.tsx`'s measuring effect, both of whose
  dependency lists are complete), `useSemanticElements` on the scene radiogroup and on
  `ScoreBars.tsx`'s `role="img"`, and two on the node `<g role="option">`. The directive went and
  the reasoning stayed as an ordinary comment. `StructurePanel.tsx`'s said the effect never reads
  the rows it depends on; it does, so that sentence was corrected rather than kept. The radiogroup's
  reason was the "see above" a live suppression pointed at, so it moved onto that one.

**2. The two ESLint comments.** `tools/fleet/routes-new.ts`: removing it surfaced biome's
`noControlCharactersInRegex` on the same line (it was already in the count); the regex strips ANSI
colour on purpose, so it is suppressed in biome's syntax with that reason.
`tools/fleet/web/src/ReadinessPanel.tsx`: the effect already had a working `biome-ignore` at its
top, so the ESLint line was redundant. Removed; the hook-deps gate is still green; the biome
suppression's reason now names the omitted dependency as well as the extra one. No behaviour
changed.

**3. Captured pages.** `tests/fixtures/data-root/data` and `tests/fixtures/data-root/output` are
out of the allowlist: 56 files, 140 findings in four HTML files plus the inline scripts inside them.
`build-corpus.ts` in the same folder is our code and is still linted, which is why the two
subfolders are named rather than the folder.

**4. Small counts.** Three fragments removed where the result is the same tree (`Tweets.tsx`,
fleet `SchedulePreview.tsx` and `SessionsPanel.tsx`). Five left and suppressed: `head={<></>}` in
Citations, Glossary, Ideas, Quotes and Timeline is an empty node on purpose, so the head row keeps
its place, and the comment above each already said so. Three `import type` fixes. Three `let`
annotations in `scripts/`. Two `return f()` in a `void` function split into a call and a return
(`evals/simple/new-reader.ts`) or left as a bare call to a `never` function (`scripts/gjd-remote.ts`).
`tools/fleet/pane.ts`'s four `new RegExp("…")` are now literals, each with a
`noControlCharactersInRegex` suppression; the string form existed only to keep the escape character
out of that rule's sight. Old and new were compared on a million generated strings and on every
character after an ESC: no difference.

**5. `annotations.css`.** Biome's CSS suppression comment works, so each of the eight fallback pairs
carries one with the reason. No declaration was removed.

**6. `biome.jsonc`.** `"recommended": true` is `"preset": "recommended"` (what `biome migrate`
proposes, and the only thing it proposes). The complexity comment no longer says "~16"; it names the
command that prints today's count (452). The two older exclusions lost their trailing `/**`, which
is the form biome 2.5 asks for; the file count is the same with either spelling.

**7. Four unlisted dependencies.** All four are real imports and all are development-only: one
script (`scripts/trace-scroll.ts`) and three tests. Added to `devDependencies` at the installed
versions with the same `^` the neighbouring entries use, so each still moves with the package that
brought it (`@supabase/auth-js` with `supabase-js`, and so on) rather than splitting into a second
copy. The lockfile changed by those four lines and nothing else.

## Review

GPT Sol reviewed commit `b09f88aac` ([prompt](261006j-sixth-sweep-s3-code-review-prompt.md),
[answer](261006j-sixth-sweep-s3-code-review-sol.md)). **Verdict: ship**, no changes. It re-ran lint
and got the same 89 / 138 / 5,239, the same per-rule findings under the old and new `biome.jsonc`,
the four lockfile lines, and no shipped runtime import of the four packages.

- **C1, reported, not fixed here.** `tools/fleet/web/src/ReadinessPanel.tsx`'s polling effect
  installs the 120-second default while `view` is still null, and never re-runs when the response
  supplies `refreshMs`. Sol reproduced it with a fake-timer test. It predates this commit and gets
  its own red-first fix as **cluster S8** of the umbrella. The comment there that justifies the
  dependency list by a timer leak is inaccurate: the cleanup clears the timer, and a numeric
  dependency changes only when its value does.
- **C2, a scope caveat.** The fixture exclusion covers more than captured pages: also generated
  artefacts and hand-written reader-state JSON under `tests/fixtures/data-root/`
  (`writes/comments.json`, `writes/chat.json`). It excludes no executable source. The
  `biome.jsonc` comment now says so.
- **The index-key reason was overstated.** The suppression said an index could not come to mean a
  different primitive. It can; the keys are safe because `Shape` is stateless and renders from its
  props. The comment in `SketchView.tsx` now says that.

## Claims that turned out false

- *"The hits are in `src/` and `tools/`."* Three of the four `noImplicitAnyLet` and one of the two
  `noVoidTypeReturn` are in `scripts/`, and the other `noVoidTypeReturn` and the `noUnsafeFinally`
  are in `evals/`. The type-only ones were fixed there; no other cluster owns those files.
- *"`noChildrenProp` and `noShadowRestrictedNames` if single digits."* Both are entirely in
  `tests/`, which is S4's. Untouched.
- *"ReadinessPanel may be hiding a real hook-deps finding."* It was not hidden by the ESLint line;
  a biome suppression above the effect was already doing the job.
- *"15 dead JSX comments that suppress nothing" to delete.* Eleven of the fifteen sat beside the
  very error they described. Deleting them would have left eleven reported errors with their
  explanations gone.

## Left, and why

- `evals/declared-spend.ts`'s `throw` inside `finally`: on purpose, and guarded so it cannot mask
  an earlier throw. Not mine to reword; one error stays.
- The other fixtures under `tests/fixtures/` (bylines, latexml, figure-wrappers, `structures.html`;
  13 findings): trimmed or hand-written test inputs, not whole captured pages, so by the brief they
  stay linted. `evals/live/gpt-live-spike/spike-page.html` (9) is ours.
- `tools/fleet/routes-new.ts:299` reports two more `noControlCharactersInRegex` on a deliberate
  control-character check. Not one of the listed items.
- **One thing worth a look, not changed.** `ReadinessPanel.tsx`'s polling effect reads
  `view.refreshMs` to choose its interval, and the note beside it says "the first answer's interval
  is good enough for the life of the mount". But the effect runs before the first answer arrives,
  when `view` is still null, so the interval it picks is the 120-second default, and the server's
  number is only used after somebody presses Refresh. That is a reading of the code, not a
  measurement; it wants a test before anyone changes it.

## Gates

`npm run typecheck`: clean. `npm run lint:hook-deps`: clean. `npm run cycles`: clean.
`npm run knip`: no unlisted dependencies, no unused files. `npm run build` and
`npm run build:fleet`: both succeed. The 129 test files that name anything touched here, plus
`doc-links`: 4837 passed, 27 skipped.
