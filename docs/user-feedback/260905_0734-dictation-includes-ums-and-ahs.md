# The microphone leaves the ums in

**[SPIDERYARN-READING2-1J](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1J)** · reported
2026-09-05 07:34 UTC · **shipped** on `dev` 2026-09-05

## What the reader said

> The microphone input (eg for Feedback dialog box) sometimes includes superfluous ums and ahs. Can
> we tweak the prompt or otherwise to ignore/remove these? Use Sonnet to search the web for best
> practices.

## What we did

**Or otherwise.** [`src/dictation-fillers.ts`](../../src/dictation-fillers.ts) removes a closed list
of hesitation sounds — `um`, `uh`, `er`, `erm`, `ah` and their stretched spellings — from the
transcript on the server, after `tidy()` and before it reaches the box. It can only *delete*: never
add a word, never reorder one, never choose a different one, and a test asserts that rather than a
comment claiming it.

**Not the prompt**, which was the report's own first suggestion. The reasoning, the web research the
report asked for, and GPT Sol's disagreement with the call are in the plan doc — as is the
experiment that would settle it, which needs an audio corpus that does not exist yet.

Handled together with [-1K](260905_0737-mic-offline-error-in-feedback.md), because both are
dictation and two agents would have fought over the same six files.

→ [260905c-dictation-filler-words-and-mic-offline.md](../plans/260905c-dictation-filler-words-and-mic-offline.md)
