The ranking and one-shot hand-off are workable: ranked rows already precede argument rows, and an atomic take can remain StrictMode-safe. The plan still has four P1 gaps.

### F1 — P1 — established

The eligibility predicate is not actually “only if Find more is what the band is offering.” It omits both `starting` and `failed`.

The plan checks only “no job” ([plan:78](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md:78>)). In both bands, however:

- `starting` replaces the button with “Starting…” ([JobProgress.tsx:288](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/JobProgress.tsx:288>)).
- A retryable failure offers `Retry`, not a fresh run; a non-retryable failure offers no button ([JobProgress.tsx:303](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/JobProgress.tsx:303>)).
- Glossary routes all three states through that progress control ([GlossaryPanel.tsx:2295](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/GlossaryPanel.tsx:2295>)); Quotes does likewise ([QuotesPanel.tsx:828](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/QuotesPanel.tsx:828>)).
- `useStepJob.start` deliberately has no in-flight latch ([useStepJob.ts:575](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/useStepJob.ts:575>)).

As written, the command can therefore send a fresh POST while the visible band says “Starting…”, bypass a cheaper retry that skips completed work, or restart after a failure for which the band offers no action. Add `!starting && failed === null` to both eligibility definitions, or better, make the band expose one shared “fresh Find more is offered” predicate that both its control and the hand-off use. Test starting, retryable failure, POST failure, and non-retryable failure separately.

### F2 — P1 — established

“Not `rewrites`” is insufficient to guarantee that Glossary appends.

When `panelRun` is absent, the panel falls back to:

```ts
owner.stale || owner.outdated
```

([GlossaryPanel.tsx:388](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/GlossaryPanel.tsx:388>)). But the authoritative server decision also compares the stored profile hash with the current profile hash ([glossary.ts:565](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/glossary.ts:565>)). A profiled list whose profile changed or was cleared can therefore appear non-rewriting under the fallback while the forced run will rewrite it.

`panelRun` is explicitly optional for older cached responses ([types.ts:823](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/types.ts:823>)), even though current responses supply it ([routes.ts:9025](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/routes.ts:9025>)).

For a command promising never to replace the list, require `owner.panelRun === "append"`; treat an absent verdict as ineligible. Add a test with absent `panelRun`, a profiled list, and a changed or cleared current profile.

### F3 — P1 — established

The rows are deliberately offered when pressing them cannot perform the named action.

The plan offers them to every eligible owner reading view ([plan:69](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md:69>)), then drops the press for no list, rewrite, running job, or cap ([plan:78](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md:78>)). Thus a row labelled *Find more*, marked as generating, can open a band and silently generate nothing.

That conflicts with the command bar’s existing rule: unavailable commands produce “no row, never a row that fails,” while explicit refusals stay open with a reason ([CommandBar.tsx:709](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/CommandBar.tsx:709>)).

The simpler truthful design is to use the always-mounted read state to omit the row unless a list is appendable/current and under the cap, while still rechecking transient job state after opening. If the product intentionally keeps unavailable rows, the command needs an explicit refusal result explaining why it did not run; merely displaying a differently labelled band button is not acknowledgement of the dropped press.

### F4 — P1 — established

The interface-model catalogue will omit the new rows unless its synthetic owner is changed.

The planned visibility condition requires an owner reading-view executor ([plan:69](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md:69>)). Production supplies one ([Reader.tsx:2331](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/reader/Reader.tsx:2331>)), but `rowsIn()` constructs its owner article without `executor` ([command-pick-catalogue.test.ts:90](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/tests/command-pick-catalogue.test.ts:90>)).

Consequently, the catalogue test can regenerate successfully without either action row. At runtime, the server silently discards browser row keys that are absent from that checked-in catalogue ([command-pick-call.ts:66](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/command-pick-call.ts:66>), [command-pick-call.ts:83](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/command-pick-call.ts:83>)). Literal matching would work, but a sentence requiring the fast model could never select *Find more*.

Update the synthetic owner with the executor capabilities and assert the two exact IDs are present in the `owner-article` slice—not merely that the catalogue serialises.

### F5 — P2 — established

The proposed aliases contradict the existing argument-collision invariant.

Both `find more` and `find more terms` parse as Find arguments because `find` owns that verb ([command-match.ts:575](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/command-match.ts:575>), [command-match.ts:631](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/command-match.ts:631>)). The collision matrix currently requires every row label and alias to parse as no argument command ([command-match-arguments.test.ts:203](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/tests/command-match-arguments.test.ts:203>)).

The desired ranking itself works: ranked rows are appended before argument rows ([CommandBar.tsx:1400](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/CommandBar.tsx:1400>)). The plan should therefore document these two rows as deliberate collision exceptions and test that they precede *Find “more…” in this article*. Do not weaken the parser or let the synthetic `everyRow()` omit executor-gated rows and accidentally preserve a false green matrix.

### F6 — P2 — reasoned

The drop tests do not prove that an ineligible hand-off was consumed.

The existing hand-off expires after ten seconds and is removed atomically only by `take` ([glossary-ask-handoff.ts:49](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/glossary-ask-handoff.ts:49>), [glossary-ask-handoff.ts:74](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/glossary-ask-handoff.ts:74>)). A test that merely observes “no immediate POST” passes even if an implementation returns before taking it; a running job finishing within the window could then trigger a late paid run.

For every dropped state, transition the mounted band to eligible before expiry and assert that no POST occurs. Also mount both consumers under `StrictMode`, as the existing ask integration test does ([glossary-ask-from-the-command-bar.test.tsx:169](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/tests/glossary-ask-from-the-command-bar.test.tsx:169>)).

### F7 — P2 — reasoned

“Sample aliases per mode” is too weak for a large ranking change.

Ranking is tiered and ties retain command-list order ([command-match.ts:412](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/command-match.ts:412>), [command-match.ts:451](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/command-match.ts:451>)). The existing catalogue tests establish uniqueness and canonical spelling, not that an alias ranks its owner first ([mode-catalog.test.ts:71](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/tests/mode-catalog.test.ts:71>)). Sampling permits one bad alias among the new hundred or so to select another mode.

Generate tests for every full alias. For label prefixes, test every prefix that uniquely identifies one label; ambiguous prefixes such as `re` cannot make both Referee and Remember first and need a small explicit expected-order table.

The proposed rule “must not be another row’s label” also needs “unless both lead to the same default destination”: Diagram intentionally aliases `sketch`, and Remember intentionally aliases `recall` ([mode-catalog.ts:318](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/mode-catalog.ts:318>), [mode-catalog.ts:363](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/mode-catalog.ts:363>)); both are sub-mode labels ([sub-modes.ts:71](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/sub-modes.ts:71>), [sub-modes.ts:101](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/sub-modes.ts:101>)).

### F8 — P2 — established

The plan changes the measured model catalogue but schedules no new measurement.

Every new mode alias also expands the corresponding *Run again* row through seven phrase templates ([rerun-commands.ts:146](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/rerun-commands.ts:146>), [rerun-commands.ts:156](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/rerun-commands.ts:156>)). This is a substantial change to the vocabulary shown to the picker, not just local matching.

The picker explicitly says changing its option wording or order is a new measurement ([command-pick.ts:207](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/command-pick.ts:207>)), and the catalogue test warns that regenerated files leave saved results measured against the old words ([command-pick-catalogue.test.ts:23](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/tests/command-pick-catalogue.test.ts:23>)). Add representative Find-more and new-alias sentences, regenerate, and rerun the documented picker eval.

### F9 — P3 — established

Several “What exists” claims are factually wrong:

- Aliases are not “two to four a mode”; Structure already has seven ([mode-catalog.ts:492](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/mode-catalog.ts:492>)).
- The alias test has four rules, not three ([mode-catalog.test.ts:127](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/tests/mode-catalog.test.ts:127>)).
- Glossary does not append only to an up-to-date list; explicitly compatible older versions are appendable ([glossary.ts:494](</home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/glossary.ts:494>)).

Read-only verification: the five relevant standalone test files passed, 75 tests passed and 2 skipped, using Vitest’s runner config loader.

VERDICT: build with the changes above