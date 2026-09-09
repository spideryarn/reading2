# Questions mode Stage 2 — GPT Sol review

The normal `scripts/run-codex.ts` route could not initialise its in-process app-server client in
this sandbox: it failed with `EROFS` while creating its local client state. The same review brief
was therefore run through a `gpt-5.6-sol` review agent against the live scoped diff.

## First verdict

**Refuse: one established P1.** A malformed but retained `dialog` item could still expose answer
buttons when its current row had lost `paneId` or `claudeSessionId`, or when the item's target
contradicted the row. The parser correctly downgraded the view to `partial` and supplied a
`dialog-source-inconsistent` gap, but kept the item so the observation would not disappear. The
panel then treated the retained item as answerable because its action boundary checked the global
answering state and question gate, but not the current row's addressability or agreement with the
item target. It also used the item's untrusted session name as the card heading.

The smallest fix was to require a current `paneId`, current `claudeSessionId`, a conversation gate,
and exact target id/name agreement before supplying `onAnswer`; the current row's name should own
the heading. A parser-to-DOM regression was requested for both the missing-address and mismatched-
target cases.

## Fix and narrow follow-up

The regression failed before the fix with two enabled answer buttons on the missing-address case.
The action boundary now includes all four checks above, and both dialog headings backed by a row use
`row.name`. The regression then passed.

The narrow follow-up verdict was: **F1 is closed.** The reviewer found no residual for the finding;
the focused Questions panel suite passed 13/13.
