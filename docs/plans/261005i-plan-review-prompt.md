Review this plan before it is built. Read-only: do not edit files.

Candidate: a live pre-commit plan on base b6196c587. One untracked file:
docs/plans/261005i-the-command-bar-opens-quick-search-and-the-search-panel-box-gets-a-clear-cross.md

The code it would change (start here; this does not limit scope):
- src/web/CommandBar.tsx (`findRow`, `argumentRowsFor`, `argumentCommand`, `argumentKindsHere`, `suggestedRows`)
- src/web/command-match.ts (`VERBS`, `parseArgumentQuery`), src/web/command-proposal.ts (`CommandExecutor`)
- src/web/command-runners.ts (`readingExecutor`, `chatExecutor`), src/web/reader/Reader.tsx (the `executor` memo)
- src/web/search-draft.ts, src/web/DockQuickSearch.tsx, src/web/modes/search/SearchMode.tsx (`useBarHandoff`, `useTypingSession`), src/web/quick-session.ts
- src/web/SearchPanel.tsx (`Box`), src/web/styles/search.css, src/web/styles/dock-quick-search.css
- src/command-pick.ts, src/command-pick-call.ts, tests/command-pick-catalogue.test.ts
Background: docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md,
docs/plans/261004g-quick-search-box-clear-cross.md, docs/project/search.md.

Do an independent pass first: read the code, do not take the plan's word, and look for what would
make this go wrong for a reader or leave the codebase worse. Then say for each of these whether it holds:

1. Does calling `draft.set(words); draft.handOff("enter"); <open Search mode>` from a command-bar
   row really reproduce the bar box's Enter in every state: Search closed; open on words, quick or
   meaning; a quick typing session already open with other words; the saved list not yet loaded;
   `?find=` or `?run=` in the address? Anything the bar box does around it (focus, `setBarFocused`,
   `stopWaiting`) that this path needs and lacks, or a handoff that could be dropped
   (`clearHandoffs` on unmount, StrictMode)?
2. Which opener should the executor use for Search: the plain mode setter (`showBand("search")`, as
   glossary and findMore use) or the Dock's `useActivateMode`? Does either lose `?at=` or push the
   wrong history entry? What does Back do afterwards?
3. Where focus lands after the bar closes (the panel's box focuses on mount unless `barFocused`).
   Right on desktop? On a phone, does it raise a keyboard over the results?
4. The plan leaves `ARGUMENT_OPTIONS` and the prompts untouched and says no new measurement is
   owed. True? Does anything on the server or in the catalogue test need to know about the new row?
5. No `generates` marker and `opensOnly: false` on the new row: consistent with the line Greg
   accepted (docs/project/chat-llm-help-commands-vision.md § Decided) and with `RISK`?
6. Quick first for every `find` verb, including `find X` and `does it mention X`: any collision in
   tests/command-match-arguments.test.ts, any caller that assumes one row per `find` argument
   (`suggestionSignature`, the pick tests, chat-commands.ts)?
7. Part B: one `clear()` in `Box` for Escape and the cross, across the three matchers; focus after;
   the cross and the spinner sharing the right edge; the 40px target not stealing presses from the
   matcher buttons below. Anything in the panel's blur/focus session rules (a blur longer than a
   pause ends the session) that a press on the cross would trip?
8. Is anything passed over that should be built, or planned that should not be?

Severity scale, by consequence: P0 data loss, security, wrong charging, service unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk with no wrong behaviour today; P3 prose or comment defect. Give every finding an ID (F1, F2 …),
a severity, whether you established it (ran or traced it) or reasoned to it, and file:line.

The numbered questions are my own suspicions and worth less than what you find yourself.

End with one line: `VERDICT: build as planned` / `VERDICT: build with changes` / `VERDICT: do not build`.
