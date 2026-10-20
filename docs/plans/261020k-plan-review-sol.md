The direction is sound, and `before` is the smallest bounded design that handles future long conversations. I found no high-severity issue, but the plan should address four medium findings before implementation is accepted.

F1 — Medium: The caps are the likely cause, but the plan claims causation without identifying Adrian’s target thread.

The code proves that `threadTranscript` currently cuts every turn at 700 characters, keeps at most ten exchanges, and limits the rendered result to 8,000 characters ([reader-notes.ts](/var/tmp/spideryarn-worktrees/fb-sfpcmm-read-other-chats/src/reader-notes.ts:89)). Given the production figures, this is a strong explanation—but “That is what the model told Adrian” is not established unless the exact Recall thread was checked.

Nothing else in the direct-read path currently truncates that transcript:

- `chatStore.load` loads every message without a row limit ([pg-chat.ts](/var/tmp/spideryarn-worktrees/fb-sfpcmm-read-other-chats/src/store/pg-chat.ts:247)).
- `HISTORY_TURNS = 20` affects the current Chat/Explore thread, not the conversation loaded by `reader_notes` ([converse.ts](/var/tmp/spideryarn-worktrees/fb-sfpcmm-read-other-chats/src/converse.ts:429)).
- Explore’s 8,000-character digest contains notes and the conversation index/gists, not the opened transcript.
- `converse` appends `outcome.content` unchanged; there is no tool-result clipping ([converse.ts](/var/tmp/spideryarn-worktrees/fb-sfpcmm-read-other-chats/src/converse.ts:3872)).
- Failed, pending and interrupted exchanges, and unopened Recall hints, remain intentionally omitted.

Suggested change: run the current formatter over the actual Recall thread Adrian referred to and record what was clipped. If it cannot be identified, change the diagnosis to “the caps are the likely cause and necessarily prevent a full read whenever…” rather than asserting the incident is proved.

F2 — Medium: Invalid `before` values must not silently return the newest page.

The proposed behavior treats a non-integer or a value greater than `total + 1` as absent, returning the newest page ([plan](/var/tmp/spideryarn-worktrees/fb-sfpcmm-read-other-chats/docs/plans/261020k-reading-another-conversation-in-full.md:58)). That is a dangerous fallback: a typo while paging produces plausible duplicate content instead of saying the cursor was invalid. Likewise, `{ before: 10 }` without `thread` is unspecified and would naturally fall into the notes/index shape.

A manually supplied valid `before` also omits newer exchanges. A heading that only announces whether exchange 1 was reached can leave the model unaware that exchanges after the requested boundary are absent.

Suggested change:

- Reject non-integers, `before < 2`, `before > total + 1`, and `before` without `thread` with explicit sentences.
- Every successful page should say its exact range: “Showing exchanges 12–19 of 47.”
- If `before` was supplied, also state that exchanges 20–47 are newer and are not in this result.
- Only say the conversation has been fully covered when the result reaches exchange 1 and no newer range was omitted.

F3 — Medium: “Comes back whole” and “a conversation of any length” are stronger than the mechanism.

The proposed prompt says a conversation “comes back in full” ([plan](/var/tmp/spideryarn-worktrees/fb-sfpcmm-read-other-chats/docs/plans/261020k-reading-another-conversation-in-full.md:60)), but:

- Any individual question or answer over 6,000 characters is still clipped and cannot be recovered by paging.
- Only settled exchanges are shown.
- Three sequential pages are the practical maximum in one turn because `MAX_TOOL_ROUNDS` is three ([converse.ts](/var/tmp/spideryarn-worktrees/fb-sfpcmm-read-other-chats/src/converse.ts:245)). A fourth page cannot be requested after the final tool-disabled round.
- Tool results are not stored as future thread history, so continuing paging on the next reader turn is not automatic.
- “When … you need them” still lets the model stop early when the reader explicitly asked it to read or resume the whole conversation.

Suggested change: avoid “whole” as an unconditional promise. Say that the tool returns numbered pages, that every omission or clipped turn is labelled, and that the model must follow `before` until exchange 1 when the reader explicitly asks for the full conversation or to resume from it. Replace “a conversation of any length can be read whole in a few calls” with the actual three-page-per-turn limit.

F4 — Medium: The owner boundary is unchanged, but the security exposure is not merely unchanged quantity.

Owner isolation, eligibility checks, fencing, and the tool-kind gate remain intact. No new defence needs adding to `security-map.md`.

However, the change makes older private messages that are currently unreachable available to a prompt-injected model, and raises one call’s exposed text fourfold. The old transcript caps were also a data-minimisation/context bound, even though they were not an ownership defence. Saying “It does not change a defence” understates that change ([plan](/var/tmp/spideryarn-worktrees/fb-sfpcmm-read-other-chats/docs/plans/261020k-reading-another-conversation-in-full.md:81)).

Suggested change: say explicitly: “The owner boundary and outbound URL caps are unchanged; the amount and historical reach of private conversation available to an injected model increase.” Update the arithmetic in `chat-tools.md`’s existing `reader_notes` risk section; `security-map.md` itself does not need a new mechanism row.

F5 — Low: The new limits are reasonable, but two size claims need exact evidence.

6,000 per turn is comfortably above the measured maximum, while 32,000/40 is proportionate. But raw stored-message lengths do not prove that every production conversation fits a 32,000-character rendered result: timestamps, labels, exchange numbers, clipping notices, fences, and delimiter escaping add characters.

Likewise, 32,000 characters is roughly 8,000 tokens for ordinary English, not “8,000 tokens at the most.” Code, punctuation-heavy text, or unusual Unicode can tokenize more densely.

There is no application-wide or cumulative tool-result cap. Results accumulate across rounds, and `MAX_TOOL_ROUNDS` limits rounds, not calls within a round. Three ordinary paged reads could retain about 96,000 characters, while a model can request multiple calls in one batch. This is unlikely to threaten the current model—Sonnet 5.5 has a 1M-token context window—but it remains an uncapped sum. OpenRouter documents that context compression is opt-in for models with more than 8K context; without it, an over-context request fails rather than being silently trimmed. [OpenRouter message transforms](https://openrouter.ai/docs/guides/features/message-transforms), [Sonnet 5.5 model page](https://openrouter.ai/anthropic/claude-sonnet-5.5).

Suggested change: run the proposed formatter over production rows and report the maximum final `content.length`; replace “at the most” with “about 8,000 tokens for ordinary English”; and acknowledge the existing cumulative-result risk.

F6 — Low: The tests need to cover the tool plumbing, not only the pure formatter.

The proposed tests focus on `threadTranscript`. That can pass while the schema omits `before`, `readReaderNotes` fails to forward it, or the prompt/tool description still misstates completeness.

Suggested change: add integration assertions that:

- `READER_NOTES_TOOL` exposes `before` as an integer associated with `thread`.
- `runTool("reader_notes", { thread, before }, …)` returns the requested earlier page.
- Invalid and missing-thread cursors return explicit sentences.
- A manually requested older page identifies the newer omitted range.
- Prompt text does not claim “full” when a turn is clipped.
- Paging through budget-limited pages returns every exchange exactly once.

On simplicity: raising the caps alone is the simplest fix for all present production conversations. If the requirement is only this incident, that is enough. If the requirement is a bounded tool that can continue through future longer threads, `before` paging is the minimal sensible addition once the wording and cursor behavior above are corrected.

I made no file changes. The source and test files became modified by another process during this read-only review; I reviewed the plan against the HEAD baseline and used the arriving diff only to corroborate the identified edge cases.