# Code review: 261020g, Marginalia's tooltips

Review the code built from `docs/plans/261020g-marginalia-tooltips-reuse-the-prose-citation-card-and-say-the-item.md`
(read it, including "GPT Sol's plan review, and what changed" — you reviewed the plan; check each
of your F1–F6 was actually done). The scoped diff is
`docs/plans/261020g-marginalia-tooltips-code-review.diff` (also `git diff origin/dev...HEAD`).

Files: `src/web/marginalia/MarginaliaColumn.tsx` (`ShutNote`, `LineCard`, `citeCard`,
`CitationNote`, `MarginCiteActions`), `src/web/BlockLinkCard.tsx` (`cutWords`, `observeAttributes`),
`src/web/Tooltip.tsx` (`ControlTip` `drawnVoice`), `src/web/voice.ts` (`isVoice`),
`src/web/reader/Reader.tsx` (`marginCiteActions`, the Provider round `TableView`),
`src/web/ProseHoverCard.tsx` (`CiteCard` exported), `src/web/marginalia/tips.ts`,
`src/web/styles/marginalia.css`, `src/web/help/pages/modes/marginalia.md`, tests
`tests/marginalia-cite-card.test.tsx`, `tests/marginalia-note-cards.test.tsx`.

Look hard for: event-order bugs in `LineCard` (mouse click while the card is open, keyboard
Enter/Space, Escape, a touch flag left set after a focus-without-click so a later mouse hover is
refused on a hybrid device), ARIA (the interactive Tooltip's dialog role and the button's own
aria-expanded/aria-controls coexisting), the delegated card still matching the Cites button (it
must not), the `cutWords` DOM read (null-safety, voice fallback, when it runs), memo stability of
the context value (are `askWork`, `checkCitedWorkInChat`, `openCitedWorkFromCard`, `jumpTo`
stable?), CSS (`.marg-cite-card` cap, `.prose-card` class on the tooltip), anything a test claims
but does not prove, and stale comments or docs.

**You may fix what you find inside this stage** (sandbox workspace-write): edit the files, keep the
house style (comment density, naming), run `npx vitest run tests/marginalia-cite-card.test.tsx
tests/marginalia-note-cards.test.tsx` and `npm run typecheck`. Do not commit, do not touch git
state, do not edit anything outside src/web, tests and docs/project. Report anything wider for me
to decide.

Write to the output file: findings F1..Fn (severity, evidence file:line, what you changed or why
you did not), then the list of files you edited, then the test and typecheck results.
