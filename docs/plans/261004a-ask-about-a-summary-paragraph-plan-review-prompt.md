# Plan review: 261004a — Ask about a summary paragraph in Chat

You are reviewing a **plan**, read-only. Change no file.

**Candidate (live, pre-commit).** Base `f3fe8128d` on branch
`worktree-fbr9nbkt-ask-about-a-summary-paragraph`. Untracked files are the whole candidate:

- `docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md`
- `docs/plans/261004a-ask-about-a-summary-paragraph-plan-review-prompt.md` (this file)

Read the plan, then the code it rests on:

- `src/web/chat-handoff.ts` (all of it)
- `src/web/reader/Reader.tsx` — `chatHandoff`, `askInChat`, `handoffTaken`, the effect that clears
  the handoff when the mode is not chat, and the `case "summary"` mount
- `src/web/modes/conversation/ConversationModes.tsx` — `ChatHandoff` and the effect that takes it
- `src/web/ChatPanel.tsx` — `seed`, `draftFor`, and the caret-to-the-end effect
- `src/web/modes/summary/SummaryMode.tsx` and `src/web/SimplePanel.tsx` (`Paragraph`)
- `src/chat.ts` § `titleFrom`; `src/routes.ts` § `streamChat`, `MAX_QUESTION_CHARS`
- `src/converse.ts` — how a user message reaches the model, and whether anything there would
  misread a message that opens with a quoted summary paragraph
- `docs/project/summaries.md`, `docs/project/security-map.md` (the untrusted parties),
  `tests/glossary-ask-in-chat.test.tsx`, `tests/conversation-band-handoff.test.tsx`

## What to do

Make an independent pass first. Attack the plan: where will it produce wrong behaviour, mislead a
reader, or cost more than a simpler version that gets most of the value? Where does it describe the
existing code wrongly? Greg asked for the simplest useful version, so "this should be smaller" is a
welcome finding. Say whether deferring the way back is right, and whether any of the three options
is described wrongly or a cheaper sound one exists.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (F1, F2, …), a severity, the file and line it rests on, and the change you
would make to the plan. End with a one-line verdict: ready to build, or not, and what blocks it.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The model's paragraph going into the reader's own message: is "the reader sees it before
  sending" enough, or should the message mark it as quoted content more firmly?
- Whether the seed's trailing blank line survives to the composer, and whether the send path trims
  it.
- Mode switch from Summary to Chat on a phone, where the band is a sheet: does the handoff effect
  still fire in the same commit?
- Whether a summary rewritten while the reader is in Chat matters at all (I think not: the text is
  copied).
