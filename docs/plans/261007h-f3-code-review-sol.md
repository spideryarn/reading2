# F3 review — candidate e7ac789ee

Findings recorded before fixes. No commits will be made.

- **L1 — P2, in scope: shared `aria-disabled` hover behaviour only covers outline.**
  `src/web/components/ui/button.tsx` dims every variant but only outline suppresses
  its enabled hover. Default still brightens; destructive and secondary change
  background; ghost changes background and ink; link gains an underline. The current
  shadcn consumers of `aria-disabled` are Criteria's run, Citations' investigation,
  and CommandBar's Ask, all outline. Other `aria-disabled` controls use plain buttons
  or IconButton, so they do not acquire these classes. This is a shared-component
  contract gap rather than an established P1. Fix narrowly by gating every variant's
  hover on absence of `aria-disabled="true"`; keep focus, pointer events and guards.
- **L2 — P2, recommendation: paired actions have inconsistent sizes.** Glossary's
  entry action is 32px beside its existing 28px Ask in chat; Citations' action is
  24px beside its existing approximately 25px Ask in chat. Prefer a common outline/sm
  pair in both modes, with wrapping at narrow widths. However, plan R10 explicitly
  excludes Ask in chat, and its shared component is outside this commit. Recommend
  a small follow-up that changes both pairs together; do not widen this review fix.
- **L3 — P2, in scope: the new CSS test overstates its cascade coverage.** Its fold
  only recognises exact selector strings and takes source order without specificity,
  media conditions or shorthand resolution. A later `:root .quiz-answer` background
  override can escape while the test says nothing redraws the field. Search's
  intentional filled/busy right-padding exceptions are also invisible. Tighten the
  test or its stated contract and explicitly protect the padding exceptions.

No established P0 or P1. L1 and L3 are fixed; L2 is a recommendation.

## Fixes and evidence

- **L1 fixed:** all six variants now gate their hover utilities with
  `tw:not-aria-disabled:hover:`. This compiles to
  `:not([aria-disabled="true"]):hover`; absent and false attributes retain the
  enabled hover. No change to event forwarding, focus, opacity, cursor or guards.
  Updated the Criteria assertion and added actual Tailwind-resolution coverage
  across all variants. The six new variant tests failed before the fix.
- **L3 fixed:** retained direct-declaration checks, added a guard against competing
  rules naming a box, and protected Search's filled/busy right-padding exceptions
  (28px/46px). The test now also sees logical property names and background images.
  Corrected the test header and mode-band.css comment: this is a source-rule guard,
  not a browser cascade simulator. More-specific and logical-padding regressions
  were observed red before their respective fixes. Generic ancestor/element rules,
  rendered geometry and media-query behaviour still need browser evidence.
- **Rollback sensitivity:** `/tmp/f3-mutation.mjs` exercises the actual test helpers
  against parent-commit source copies and in-memory CSS mutations. All ten run-site
  reversions fail; removing the common box/focus rules fails all nine selectors;
  restoring each of the six local field sheets fails. No source files were reverted
  for this experiment.

## Independent pass

- **Current Button consumers:** Criteria, Citations and CommandBar all use outline
  with `aria-disabled`. Chat, Quiz, Diagram, Dock, citation retry and IconButton use
  native/custom controls, so these new Button classes do not change their styling.
  Outline's original disabled hover suppression did work: its override had greater
  specificity, and hover ink equalled its base ink. L1 completes the shared contract.
- **Activation and tooltip:** Criteria remains a submit button with `aria-disabled`
  and a guarded form `onSubmit`. Button forwards the Tooltip's event props and ref
  to the native button, and no aria-disabled pointer-events rule was introduced.
  Click/keyboard submission still reaches the form guard. Source inspection supports
  keyboard and touch tooltip reachability; this review did not measure it in a browser.
- **Moved actions:** types, handlers, icon identities, tooltip/title content,
  busy/disabled expressions and structural placement are preserved. Criteria,
  Claims, Mirror and Candidates' send keep `align-self: flex-start`; Candidates'
  start keeps full width; Search keeps `margin-left: auto`. Icons now receive
  shadcn's normal size utilities. Candidates' start and Ask are distinct paid
  actions, both explicitly included in F3. Glossary's Find more/Write a new list,
  Look up and Dig deeper retain their different handlers and guards.
- **Paired actions (L2):** a shared outline/sm pair in both modes would improve
  consistency. This also makes every Citation action row taller and leaves its
  Scholar link smaller; that density trade-off makes it less than an unambiguous
  correction. R10 explicitly retains `.gloss-btn` for Ask in chat. Recommend changing
  both pairs together in a small follow-up with a 288px wrapping check; no partial
  row conversion in this fix.
- **Fields:** the shared rule is a plain selector list, so each selector retains
  its own specificity. No remaining local rule redraws the common values apart
  from Search's deliberate padding reservation. `:root`-prefixed coarse-pointer
  font-size rules and voices.css reader-face rules still win; the common rule sets
  neither font-size nor font-family. Resize modes, autosizing code, widths and line
  heights survive. Skim's former raised ground is an explicit F3 outlier to remove,
  with no separate requirement found to retain it. All nine selectors have the
  same 2px `--highlight-text` focus outline and 1px offset in both themes by source.
  Search's matcher bar has `min-width: 0` and horizontal overflow, while find does
  not shrink; larger input padding has no fixed row-height constraint. No new
  overflow defect was established, but geometry/contrast at 288px remain unmeasured.
- **Docs:** controls.md's rows, five Referee actions and three-local-edits count
  agree with the implementation. Citations' xs exception is documented. Referee's
  explanation of `aria-disabled`, tooltip access and form-level guard remains true.

## Validation limits

Initial requested suite: **96 tests passed**. Final requested suite plus
`tests/tailwind-utilities-resolve.test.ts`: **7 files, 110 tests passed**.
Scoped Biome lint and the four-project typecheck **passed** after the fixes;
`git diff --check` is clean.
`npm run typecheck` itself hits the sandbox's forbidden tsx IPC socket; running
the same script with `node --import tsx scripts/typecheck.ts` avoids that wrapper.

`npm test` cannot initialise its database lanes: local connection EPERM and missing
database/Supabase configuration. A unit-only sweep was also attempted and interrupted
before a verdict; it is not counted as passing. The prescribed Sonnet browser
subagent could not connect and timed out, so no visual pass is claimed. These are
environment limits rather than established candidate failures. An independent
read-only reviewer checked the fix and passed both changed suites (44 tests before
the final additional logical-property test).

VERDICT: ready with these fixes

Files changed (no commit):

- `src/web/components/ui/button.tsx`
- `src/web/styles/mode-band.css` (comment only)
- `tests/referee-criteria-explained.test.tsx`
- `tests/run-buttons-and-text-boxes-agree.test.ts`
- `docs/plans/261007h-f3-code-review-sol.md` (this answer)
