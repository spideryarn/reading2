# Sweep clusters 13 and 18: two lint rules become gates, a census test, and a client tidy

Two clusters of the fifth codebase sweep
([umbrella](261003f-fifth-codebase-sweep-umbrella.md) § The clusters, rows 13 and 18), run together
because both are small and their file sets do not overlap. One commit each.

Up: [plans.md](../project/plans.md).

## What this is for

- **Cluster 13** turns two Biome rules that already find real bugs into checks that fail, adds one
  test that holds a rule written only in prose, and stops Knip reporting documented research
  scripts as dead files.
- **Cluster 18** removes five small duplications in the reader's client code, each of which has
  already drifted or is one edit away from it.

## The audit re-run against today's tree (2026-10-04, on `9b66d76e1`)

The audit's tree is behind. What the same commands say now:

| Item | The audit said | Today |
|---|---|---|
| KN-D1 `useExhaustiveDependencies` | 13 diagnostics, 11 files | **11 diagnostics, 8 files**, whole tree (3573 files, 2 s): `BlockGutter.tsx:445`, `ChangelogPage.tsx:731`, `DesignPage.tsx:484` and `:1284`, `DiagramPanel.tsx:901` and `:1048`, `reader/measure.ts:50` and `:160`, `reader/useReadingPosition.ts:148`, `useCriteria.ts:113`, `useShelf.ts:618` |
| DF-F8 `noFloatingPromises` | a baseline of 1 | **3** (5 s): `scripts/changelog/release-notes.ts:303`, and two new ones, `src/web/useComments.ts:847` and `src/web/useReadingTime.ts:324`, both a bare `leavingFetch(…)` |
| KN-F1 `parseJsonAnswer` importers with no adapter | 3 files | the same 3: `citation-find.ts`, `search.ts`, `json-repair-log.ts` |
| DF-F9 Knip unused files | 14 scripts + 3 configs | **15 scripts + 3 configs**: cluster 9 deleted the `260930a` pair, and three new `scripts/eval/skim-*` CLIs arrived |
| WC-W3 step 1 | Glossary `GateSlider`, Citations `BarSlider` | still there (`GlossaryPanel.tsx:1156`, `CitationsPanel.tsx:1142`) |
| WC-W7 | `ago()` with 3 callers; a private `withPanel` | the same (`Metadata.tsx:3764`, `:3785`; Dock's at `Dock.tsx:2592`) |
| WC-W8 | `ViewportProbe.tsx:482` optional chain | the same, line 483 |
| WC-W13 dictation | 7 (the review: 8) copies in 5 files | **11 copies in 7 files**: the five named, plus `CommandBar.tsx:1587` and `FeedbackDialog.tsx:700` |
| WC-W5 | `bandCovers` declared after two re-derivations | the same: `Reader.tsx:570`, `:633`, declared `:691`, `:2932`; five bare `fit.modeW === 0` |

## Stage A — cluster 13

**A1. `useExhaustiveDependencies` reaches zero and becomes a gate (KN-D1).** Sol's plan review
read all 11 and found no live bug: eight are deliberate (suppress, with the reason), and three name
a dependency that cannot change and is simply removed — `DiagramPanel.tsx:901` and `:1048`
(`collapsed` is a module-level constant) and `useShelf.ts:618` (`setTagging` is a state setter).
The implementer re-reads each rather than taking that table on trust. For each of the 11:
read the hook. If the extra dependency is a deliberate re-run trigger, or the missing one is
harmless, add `// biome-ignore lint/correctness/useExhaustiveDependencies: <the reason, specific to
this hook>`. If the diagnostic is *right* (a stale closure, or a dependency that does nothing), fix
the code instead, and say which. No behaviour change is expected; any that is found is reported
before it is made.

**A2. `noFloatingPromises` reaches zero and becomes a gate (DF-F8).**
- `release-notes.ts:303`: handle the rejection — print it and exit 1. Red-first is the rule itself:
  it flags the line before and not after.
- The two `leavingFetch(…)` calls: `leavingFetch` swallows its own failures by design
  (`src/web/lib/api.ts:1151`), so the promise carries nothing. Mark each `void leavingFetch(…)`.
  `api.ts` is outside this cluster's files, so its return type stays.

**A3. The gate.** Two npm scripts beside `cycles`, each one rule over the whole tree:
`lint:hook-deps` and `lint:promises`. Two `gate: true` steps in `scripts/check.ts` beside `cycles`.
And, because `npm run check` takes 26 minutes and `npm test` is what agents actually run, a test
(in `tests/biome-config-is-live.test.ts`) that:

1. runs each rule over the whole tree with the pinned binary and expects exit 0, **and** a
   `Checked N files` line with N above a floor — silence from zero files is not a pass;
2. **a red control for each rule**: a file with a floating promise, and one with a missing hook
   dependency, must each be flagged *by name*. The control is a file **on disk in a scratch
   directory outside the repo**, written by the test, the way this test file's existing negative
   control already works — linted with the repo's own config (`--config-path`) if Biome will apply
   it there, and otherwise with a scratch config that sets the same rule to `error`. Nothing
   violating is tracked, so the raw `biome lint --only=…` commands stay the gates and zero means
   zero.

   **Stdin does not work** (Sol's plan review, S1, measured): `noFloatingPromises` does not fire on
   `--stdin-file-path` input at all, and the hook rule's diagnostic is not printed by name. The
   tracked-fixture fallback this plan first named is dropped: it would make the raw commands exit 1
   for ever and need a wrapper that expects exactly the fixture's diagnostics — more machinery than
   a scratch directory.

The simpler option passed over: a test only, no `check.ts` steps. Rejected because `cycles` is the
precedent and `check.ts`'s header says a check that is green becomes a gate.

**A4. A census test for structured output (KN-F1).** New `tests/structured-output-census.test.ts`.
`prompting-guide.md` § What the model writes back says *"every exception is named"*; nothing holds
the list. It is a **file-level census**: every `src/**/*.ts` file that *calls* `parseJsonAnswer`
(a call, not a mention in a comment) must also *call* one of the two decorators that attach a
schema to a request — `withMessagesJsonSchema` or `withChatJsonSchema` — or appear in a
`Record<file, reason>` of named exceptions.

- **The audit's three exceptions were wrong** (Sol, S2): its grep matched commentary. `search.ts`
  and `json-repair-log.ts` do not call the parser. The three files that call it with no decorator
  are `citation-find.ts` (web search on the same call), `labels.ts` (its answer is tuples, which a
  schema cannot express) and `structure-expand.ts` (the deepening wave is off by default) — the
  reasons [261001s](261001s-structure-answer-writes-code-to-correct-an-id.md) already records.
- **Only the two decorators count** (Sol, S3). The module's validators
  (`validateAnthropicJsonSchema` and friends) attach nothing to a request, so a file that calls
  only a validator must still go red — that is one of the test's negative controls.
- A stale exception fails too: a named file that no longer calls the parser, or now decorates.
- The header says what it cannot see: a second unschematised request in a compliant file; a plain
  `JSON.parse`; a parser reused from another file; a decorator whose result is not the body sent.
  The umbrella's "every model call" wording is narrowed to match when its row is updated.
- Seen red by: removing an exception; a scratch source with a bare call; a scratch source with a
  validator only. The scan is a pure function over `(path, text)` pairs so those controls need no
  file in `src/`.

**A5. Knip (DF-F9).** Add `scripts/eval/*.ts` and `scripts/probes/*.ts` to `knip.jsonc`'s `entry`,
with the reason. Not `scripts/**/*.ts`: that would also make `scripts/changelog/release-paths.ts`
and any future helper module an entry, which hides a genuinely dead one. Expect the unused-files
list to drop from 18 to the 3 root config files. Those three are investigated and reported, not
"fixed" by guesswork; **Knip's files check is not made a gate here** — that is its own decision
once the three are understood.

**Docs:** `linting.md` and `static-analysis.md` gain the two gates (signposting plus the facts);
`code-quality-overview.md` if it lists gates.

## Stage B — cluster 18

**B1. Glossary and Citations use `ThresholdSlider` (WC-W3 step 1).** First a characterisation test
of the two sliders as rendered today (label, `min`/`max`/`step`/`value`, `aria-valuetext`, the
note, the reset control and what it calls) — proved able to fail — then the swap, and the same test
green. Each panel keeps its own `visible…`/`note` pass. Any difference the shared component does
not carry is a finding, not something to drop
([261003a](../postmortems/261003a-consolidating-duplicate-controls-keeps-the-survivors-omissions.md)).
Then both bands are checked in a real browser. Step 2 (Search, Quotes, Debate) is not in this run.

**B2. `Metadata.tsx` loses two private helpers (WC-W7).** `ago()` goes; its three callers use the
shared `relative-time.ts` with `useNow`. Neither shared function is a drop-in (Sol, S4): the callers
put a verb in front (*"ran …"*, *"last wrote …"*, *"fetched …"*), `relativeAgo` returns `undefined`
past 30 days and `timeAgo` then returns a bare date, which would read *"ran Aug 20, 2026"*. So: the
shared relative wording while it is recent, **"on <date>"** once it is absolute, and today's
behaviour for an invalid date. `now` joins `pipelineLine`'s memo dependencies. What the reader
gains: a clock a few seconds ahead no longer says *"in 4 seconds"*, and the labels tick. What
changes: *"4 seconds ago"* becomes *"just now"*, *"last week"* becomes *"10 days ago"*, *"last
month"* becomes a date. Red first: the future time; also tested, an old time and the clock
advancing. `withPanel` is exported from `Dock.tsx` (Metadata passes `"questions"`) and the private
copy deleted.

**B3. `ViewportProbe` says when there is no clipboard (WC-W8, the guard only).** The optional chain
short-circuits the whole `.then`, so the probe says nothing. Red first: with no
`navigator.clipboard`, the probe reports the refusal. The statement-form guard the other five
writers carry. No shared `copyText` — that is cluster 20.

**B4. Dictation `busy` (WC-W13, that item only).** A `busy` boolean on `useDictationField`'s result
(`readOnly || dictation.armed`), with a unit test, and every written-out copy replaced: 11 sites in
7 files. **Two of those files are outside the row's "5 callers"**: `CommandBar.tsx` (no other
cluster names it) and `FeedbackDialog.tsx` (cluster 20's, which runs after this one). Leaving two
copies written out would defeat the field, so both are included, one line each, and the debrief
tells cluster 20.

**B5. `bandCovers` is declared once, before its first use (WC-W5, hoist only).** Move the
declaration above line 570 and use it at the four full derivations (`showCrumbs`, `bandOverProse`,
its own, `covered`). The five bare `fit.modeW === 0` checks are **not** the same expression — they
are true with no band open. Four sit in the Skim arms, which prove a band is open, and become
`bandCovers` / `bandBack`. The fifth, the wrapper's `band-covers` class, **stays**: CSS uses it in
Plain too (`narrow-window.css` hides the small-screen banner under narrow Marginalia with it), and
the comment beside it, which says every consumer names `.mode-band`, is corrected (Sol, plan
review). No `bandCoverage()` helper: Sol's audit
review said it does not earn its indirection. Behaviour-preserving; the existing Reader and layout
tests are the check, and they are run before and after.

## Sol's plan review (2026-10-04, read-only)

Stage A ready with changes S1–S3, Stage B with S4; all four accepted and written in above. S1: the
stdin red control does not work. S2: the census's three exceptions were the wrong three. S3: only
the two decorators attach a schema. S4: the date grammar. It also confirmed `ThresholdSlider` lacks
nothing either copy has, and that `void leavingFetch(…)` is right and accepted by the rule.

## Not doing

- W3 step 2, W8's shared `copyText`, W13's other extractions, W5's helper — all outside the row.
- Making whole `lint` or whole `knip` a gate — rejected by earlier sweeps and by DF-F8 itself.
- Changing `leavingFetch`'s return type.

## Done looks like

Both rules at zero and failing on a seeded violation; the census test red on a seeded stage; Knip's
files list at 3; the five client items landed with their tests; `npm test` and `npm run typecheck`
green; a Sol code review per stage; the umbrella's two rows updated with the commits.

## What landed

**Stage A, cluster 13 — `6d22232d0`, review fixes `91c303fd8`.** As planned, with these differences:

- **The red control copies the repo's own config.** The first build used a scratch one-rule config,
  because `--config-path` at the repo's file makes Biome ignore every path outside the repo. Sol's
  code review (C1) showed the hole: with the rule configured *off*, `--only=` still runs it, at
  `info`, and exits 0 — so a weakened `biome.jsonc` would have hidden behind the control. The
  control now copies `biome.jsonc`, `.gitignore` and `package.json` into the scratch directory and
  must fail under both the gate command and ordinary lint.
- **The census is by AST, with a floor rather than an exact count** (15 callers, plus named
  anchors), so a new compliant stage does not turn it red. Sol's C2 closed four bypasses (a cast, a
  non-null assertion, a static computed property, a computed variable miscounted as a call).
- **Knip reaches zero unused files in a full run.** `vitest.witness.config.ts` is an entry too (a
  string handed to a spawned vitest). The two Vite configs are reported only by `--include files`,
  not by a full run; the cause of that mode difference is not established, and `knip.jsonc` says so.
  **Not done, on purpose:** making Knip's files check a gate.
- `release-notes.ts` already exited 1 on a rejection, through Node's default; the handler makes it
  explicit. Biome treats any function named `use…` as a hook, which the census helper tripped over.

**Stage B, cluster 18 — `d7a6e64bf`, review fixes `b32e23b88`.** As planned, with these differences:

- **Twelve dictation pairs, not eleven.** One on Quiz's Answer button was written across several
  lines, so the single-line grep missed it (Sol, D1).
- **Exporting `withPanel` broke ten tests** that mock Dock with a factory naming only `Dock`; they
  now spread the real module. **Thirteen tests hand-build the dictation hook's result** and gained
  `busy`; the next field on that hook meets the same stubs.
- `GateSlider` and `BarSlider` survive as thin wrappers that hold each panel's own max, noun, title
  and note. Nothing differed between either copy and the shared component.
- An invalid date draws nothing, as before: the callers refuse it before formatting.

**Reviews.** One plan round and one code round per stage; no P0 or P1 in either code review, so no
second round. **Browser check:** a Sonnet subagent drove Chrome through
Playwright against `d7a6e64bf`, at 1400px and 400px, on an article with 10 glossary terms and 8
citations. Both sliders pass: label, value and count, arrow keys, the foot note, reset, the focus
ring, and the same markup in both bands. Metadata's times read as sentences on four articles
("fetched on Aug 26, 2026", "ran 29 days ago"); no console errors. **Not checked:** the FAQ band's
slider beside them (that article's FAQ has none), and Sol's one-line Quiz fix, which landed after
the server started. **One oddity, not from this change:** a stamp between 29.5 and 30 days old reads
"30 days ago", because the shared `relativeAgo` rounds the label and cuts over on the exact age. It
is the same everywhere that helper is used.

