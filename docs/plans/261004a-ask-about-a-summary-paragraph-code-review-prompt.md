# Code review: 261004a — Ask about a summary paragraph in Chat

You are reviewing **code**, and you may fix what you find, inside this stage only.

**Candidate.** The single commit `99a1290e4` at `HEAD` on branch
`worktree-fbr9nbkt-ask-about-a-summary-paragraph` (`git show HEAD`); its parent is the base. The
tree is clean apart from this file.

Read `docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md` (the plan, with your own plan
review F1-F4 folded in), then the diff, then the code around it:

- `src/web/chat-handoff.ts` § `askAboutSummaryParagraph`
- `src/web/SimplePanel.tsx` § `Paragraph`, `src/web/modes/summary/SummaryMode.tsx`,
  `src/web/reader/Reader.tsx` § `handToChat`, `src/web/styles/summary.css` § `.simple-ask`
- `src/web/modes/conversation/ConversationModes.tsx` (the effect that takes a `ChatHandoff`),
  `src/web/ChatPanel.tsx` (`seed`, `draftFor`, Send)
- `src/converse.ts` — how the user's message reaches the model
- `tests/chat-handoff.test.ts`, `tests/simple-panel.test.tsx`, `tests/summary-ask-in-chat.test.tsx`
- `docs/project/summaries.md` § Ask about a paragraph, `src/web/help/help-modes.tsx`

**Run these yourself** (jsdom only, no network or database needed):

```
npx vitest run tests/chat-handoff.test.ts tests/simple-panel.test.tsx tests/summary-ask-in-chat.test.tsx
```

Raw results I ran and you cannot: `npm run typecheck` all five lines green; `npm test` 1504 files
passed, 5 failed, all five for a missing `api-dist/` or fleet client build in a fresh worktree
(`fleet-decisions-route`, `fleet-reports-route`, `fleet-composed-access`, `pdf-bundle-trace`,
`cold-start-lazy-imports`), none touching this change.

## What to do

Make an independent pass first. Look for wrong behaviour a reader would meet, a visitor who could
reach the button or the handoff, a press that spends or sends, a way the quoted paragraph can close
its own fence or read as the reader's instruction, a test that could not fail, and a doc or help
sentence the code does not bear out. Check that the plan's F1-F4 were actually done, not only
written down.

**Fix what is inside this stage, narrowly and red-first** (a failing test before the fix). **Report,
do not fix, anything wider.** Do not commit; leave your changes in the working tree and list them.
Do not run `npm test`, `npm run check`, any git command that changes state, or anything that needs
the network.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (CR-1, CR-2, …), a severity, the file and line, and whether you fixed it.
End with a one-line verdict: land, or not, and what blocks it.

## My own suspicions (already mine, worth less)

- The cut at 2,000 characters can split a surrogate pair.
- `.simple-ask`'s negative block margin and the 40px coarse-pointer size together: does the button
  overlap the next paragraph on touch? (A browser check is running separately.)
- The heading is the same for every such conversation, so Chat's list cannot tell them apart.
- Whether `Paragraph`'s `key={p.text}` plus the new button changes anything about focus after
  *Write it again*.
