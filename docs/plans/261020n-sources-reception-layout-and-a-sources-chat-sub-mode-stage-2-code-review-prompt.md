# Code review: plan 261020n, Stage 2 (the Investigate sub-mode)

You are reviewing the uncommitted working-tree diff in this worktree. Run `git diff HEAD`, and
include the untracked `src/web/InvestigatePanel.tsx`. Ignore the `docs/project/reception.md` edits:
they are Stage 1's prose. The diff builds **Stage 2** of
`docs/plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md`: a new owner-only
Sources sub-mode, built first as "Ask" and renamed **Investigate** for the reason the plan gives.

Read first:
- the plan, including § GPT Sol's plan review: F5, F6, F7 and F9 apply here;
- `CLAUDE.md`;
- `docs/project/mode.md`, the sub-mode checklist;
- `docs/project/chat-from-a-mode.md`, especially § Adding it to another mode, its silent steps;
- `docs/project/reception.md` § Look at the debate from an angle, which is the angle box this stage
  moves.

In brief, the change:
- `?sources=investigate` draws `InvestigatePanel`: a question box, five suggested questions, up to
  four claims from Claims' stored list, the top three cited works by relevance, and *Your
  questions*, which was *Your angles*.
- Suggested and typed questions are sent with a `reception` lens origin, through `askInSources`.
- Claim and work rows reuse `checkClaim` and `askWork`.
- The angle box has been removed from Reception.
- The way back lands on Investigate.
- `titleFromOrigin` now says *Question:*.
- `ReceptionAndClaimsView` is a positive union, and the SourcesMode controllers route views with an
  exhaustive switch.

**Fix what you find inside this stage.** Then run `npm run typecheck` and the touched tests:

```
npx vitest run tests/reception-lens.test.tsx tests/reception-lens-in-chat.test.tsx tests/every-mode-draws-its-surface.test.tsx tests/url-state.test.ts tests/public-network-trace.test.tsx tests/thread-source.test.ts tests/thread-origin-way-back.test.ts tests/glossary-and-bibliography-ask-in-chat.test.tsx tests/chat-handoff.test.ts tests/chat-origin-transaction.test.ts tests/reception-and-claims-panel.test.tsx tests/command-match-mode-aliases.test.ts tests/mode-catalog.test.ts tests/command-bar-sub-modes.test.tsx tests/conversation-band-origin.test.tsx tests/chat-origin-route.test.ts tests/doc-links.test.ts
```

Do not run the full suite, because the box is shared. If `npm run typecheck` fails with an `EPERM`
on a pipe, run `node --import tsx scripts/typecheck.ts` instead. Do not commit, and do not run any
git command that discards work. Report anything wider than this stage rather than building it.

Look especially for:
1. **Spend.** Arriving on Investigate, by a link, Back, a restore or the chip, must send nothing.
   One press must make exactly one chat POST, including under React StrictMode and on a double
   click. A visitor must have no senders mounted, and `?sources=investigate` must draw Bibliography
   for a visitor.
2. **Silent holes from chat-from-a-mode.md.** Do the marks on claim and work rows appear? They need
   bundles built from the raw `chatSummaries`, and the senders must be wrapped in `reopenItemChat`.
   Does a second press reopen the existing chat rather than start a new one? Does the lens origin
   round-trip, and does its way back land on Investigate, including for angle chats made before this
   change?
3. **Claims.** Claims' stored list must never be bought by opening Investigate. Is a stale list
   excluded? Are a claim's words and a work's title inside the fence in the question that is sent?
4. **The prompt text.** Read `askInSources` and its search line against
   `docs/project/prompting-guide.md`. Is there any lingering use of the old angle wording where a
   question is now sent? Is the command bar's suggested-lens row (which waits for Send) unchanged?
5. **Types and routing.** Exhaustiveness, any place that still treats `"investigate"` as Reception
   or Claims, and the help page, aliases and url-state.
6. **Accessibility and the voice rule.** Check against `docs/project/fonts.md`: the reader's words in
   the reader's face, the article's words (claim quotes and work titles) in the author's face, and
   the app's words in the UI face.
7. **Tests that cannot fail, stale comments, and anything more complicated than needed.**

Write your findings to
`docs/plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode-stage-2-code-review-sol.md`
**before** you start fixing. Number them F1, F2 and so on, give each a severity and file:line
evidence, and say per finding whether you fixed it. End with the test and typecheck results you saw.
