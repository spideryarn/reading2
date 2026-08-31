# Verdict: NO-SHIP as written

Review mode itself is worth building and fits Spideryarn better than ordinary chat. Reusing the thread, streaming, citation, and tool machinery is the right foundation.

Do not build the current prompt, stance semantics, or duplicated `ReviewBand` architecture unchanged.

## High findings

1. The prompt can confidently “correct” a defensible reading

The prompt says the article’s words “settle it” and Socratic should point to the passage that “would change their mind” ([review-mode.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827ah-review-mode.md:284)). That assumes the model’s interpretation is ground truth.

This discards two hard-won chat rules: mark genuine ambiguity as ambiguous, and say when the article does not resolve something ([converse.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/converse.ts:263)).

Socratic makes the failure worse: a leading question can smuggle in a false premise while denying the reader a claim they can directly dispute.

Add rules equivalent to:

- Distinguish misunderstanding the article from disagreeing with it.
- Never infer misunderstanding from omission alone.
- Before a Socratic question, verify that the article clearly supports the presumed correction.
- If the article permits both readings, say that and ask an open comparison question.
- Never put a disputed conclusion inside a question.
- The reader may be right and you may have misread the passage.
- If speech leaves their meaning uncertain, clarify rather than reconstructing it confidently.

Also, `"just tell me"` currently cannot work: Socratic promises it as an exit, but the next turn’s unchanged Socratic picker still “governs the whole reply” ([review-mode.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827ah-review-mode.md:293)). Explicit words from the reader must override the picker, or “just tell me” must be a real UI action that selects Respond.

2. Balanced asks the model to infer a mental state it cannot reliably observe

“Stuck → tell; nearly there → ask” is reasonable when the reader explicitly says they are stuck. It is not reliably inferable from one compressed, spoken paragraph. The expected failure is a false near-miss: the model mistakes omission, shorthand, transcription damage, or a defensible interpretation for “one step away,” then asks a leading question from a false premise.

The prompt should say:

- Treat someone as stuck only from explicit evidence: they say so, contradict themselves, or cannot connect the stated steps.
- Do not infer readiness from fluency, polish, or brevity.
- If their meaning is unclear, ask a neutral clarification.
- If the mismatch is clear but their readiness is not, prefer a concise direct explanation. Withholding help from a stuck reader is worse than briefly telling someone who was nearly there.
- Use Socratic treatment only when the discrepancy and the intended next step are both clear.

I would not ship Balanced as the default until a prompt eval shows this judgement working.

3. The prompt says “no grading” while inviting point-by-point grading

These instructions will produce variants of “you got three of four right”:

- “where their understanding is solid, where it is off, and what they have missed”
- acknowledge correct points “in one clause”
- “two or three points”
- “I think you’ve got this” ([review-mode.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827ah-review-mode.md:228))

The last sentence is itself a global assessment.

Replace them with:

> Do not inventory correct and incorrect points. Raise only the one or two material discrepancies the reader can act on. If none is clear, say “I don’t see a material mismatch with the article,” which is a claim about this account, not a grade of their understanding.

The ranked list should rank by consequence and confidence, not error type:

1. A clear contradiction with an explicit, central claim.
2. A collapsed distinction or missing premise that changes the conclusion.
3. A wrong causal or argumentative link.
4. An omission only when the reader presented their account as complete and the omission materially reverses it.

Currently a skipped step is always ranked above a collapsed distinction, which is often backwards.

4. Retry and edit must not inherit the global picker silently

Under the plan:

- A Socratic answer is stored.
- The reader changes the picker to Respond, perhaps for their next turn.
- They press Retry.
- The same stored question is answered as Respond.

The finished transcript can display a Respond tag, so it does not literally lie after completion. But the action called “retry” changed an unstated historical instruction. During streaming it will also be untagged or temporarily show the old stance unless the optimistic row is handled carefully.

Editing is worse. Editing an early question could inherit the picker seeded from the last answer—possibly a later Signposts turn—and then delete all later answers and their differing stances.

The correct rule is:

- New turn: use the current picker.
- Retry: preserve the answer’s stored stance.
- Edit: preserve the stance of the answer being replaced.
- Changing stance while regenerating must be an explicit “Retry as…” or editor control.
- Later discarded stances disappear with their rows.
- Store the stance when the pending assistant row is created or reset, not only in `finish`. Otherwise crashes, errors, stopped answers, and recovered pending rows can lack the instruction that produced them.

This follows the existing rule that retry rows are rebuilt field by field so attempt-specific data cannot leak ([chat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat.ts:451)).

5. `kind` needs to be authoritative in storage, not merely copied from the request

A 409 is the right status when a valid `kind` contradicts immutable thread state. The route is also the right place to explain it to the client. But:

- The check must happen before `settleThread`; otherwise it recreates the exact bug where a rejected retry aborts another tab’s live answer ([260826a-chat-mode.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260826a-chat-mode.md:864)).
- `inTurnOrder` is per-process ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:695)). The authoritative invariant must also run inside `withTurn`/the store transaction.
- Existing threads must select the prompt from `begun.thread.kind`, never from request `kind`.
- Retry and edit should not need to resend `kind`; their thread already owns it.
- A new Review request must require Review at the typed client boundary. Wire-level absence may remain backward-compatible Chat.

Prefer a required, normalized in-memory `ChatThread.kind`. Normalize old filesystem rows to `"chat"` when loading. Leaving the type optional spreads silent defaults throughout the application.

Writing `kind` twice could let an old tab turn Review into Chat, change the prompt halfway through a transcript, change its list tag, and create extra cache prefixes. Never writing it makes a Review request silently succeed as Chat.

6. Filesystem compatibility is not free: import/export are missing

`loadThreads` currently returns parsed JSON unchanged ([chat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat.ts:67)). More importantly, Postgres import and export construct thread and message rows field by field. Neither is in the plan:

- [store/export.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/export.ts:412)
- [store/import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:682)

The export comment explicitly records that `tools` was previously lost this way. Without changes, a backup/restore silently turns Review threads into Chat threads and drops their stances.

Add `kind` and `stance` to import, export, round-trip fixtures, and convergence tests.

7. The proposed two-band UI can render Review and floating Chat simultaneously

`?thread=` currently opens the floating `ChatDialog` in every mode except Chat:

```ts
mode === "chat" ? null : thread ? { kind: "thread", threadId: thread } : null
```

([App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:696))

Therefore `?mode=review&thread=<review>` would mount both ReviewBand and ChatDialog. A pasted Review-thread URL outside Review mode would also open that thread using Chat UI.

`ThreadSummary` needs `kind`, and the reading view must decide whether a thread belongs in floating Chat or Review. Either prohibit anchors on Review threads or define their marks and opening behaviour explicitly.

Do not make `ReviewBand` a near-copy with a second `useChat`. Use one conversation-band wrapper, mounted for both Chat and Review, with one hook and mode-specific panel/footer. The current unmount/remount path already has a known race that can hide a just-started conversation ([260826a-chat-mode.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260826a-chat-mode.md:1019)).

Cross-kind row selection must update `mode` and `thread` atomically. Two separate setters can reverse the intended push/replace ordering and create a Back-stack entry pairing Chat mode with a Review thread.

The existing `started` latch also checks all threads. If Chat threads exist but no Review thread does, entering Review will show the shared list rather than Review’s proposed guided empty state. Decide whether auto-start is per kind.

## Medium findings

8. Cache placement is correct; the economic claim is overstated

Verified:

- The breakpoint is on the article ([converse.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/converse.ts:520)).
- Stance below it does not invalidate the article prefix.
- Sliding `recentHistory` changes only the uncached suffix.
- The canned assistant line is also below the breakpoint.

So change the canned line for Review to something like:

> I’ve read it. Tell me what you took from it.

That costs only a few uncached input tokens per provider round and no new article write.

But “two prefixes, paid once on entering” is not literally true:

- A cold first use pays the 1.25× write premium and earns nothing unless another request arrives within the five-minute TTL.
- Concurrent cold requests can both write.
- Model/provider/tool changes create distinct entries.
- The final tool round removes the tool definitions, which are before the system prompt, and therefore creates another prefix ([chat-tools.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/chat-tools.md:549)).

The normal path is two prefixes per article, not an invariant. Add Review to the live caching eval; byte-identity tests cannot prove that the provider read the cache.

9. `Conversation` cannot currently be reused as planned

It owns both Chat suggestions and Chat’s composer ([ChatPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatPanel.tsx:821)). Exporting it does not let Review substitute either.

Extract a transcript/scroller component with injected empty content and footer. Extract shared composer behaviour, not copied handlers:

- draft and focus handling;
- auto-resize;
- Enter/Shift-Enter;
- the full Escape ladder;
- key propagation;
- busy/stop behaviour;
- `dictate.readOnly` submission gate;
- dictation button/strip;
- caret restoration;
- profile preference, or an explicit decision that Review always uses the profile.

10. Unaddressed integration work

Before implementation, the plan should cover:

- Separate Review input limit and reader-facing copy. Chat’s 4,000-character “question” limit is not an intentional spoken-review limit ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:1411)).
- A cumulative character/token budget for Review history. Twenty long spoken turns make a large uncached suffix on every request.
- `titleFrom`: the first 60 characters of a ramble will often be “Um, so I suppose what I took…”.
- Stance-picker keyboard and ARIA behaviour. Prefer a native `<select>`; a custom radiogroup needs roving tabindex and must prevent its arrows from also navigating the article.
- Additive migration ordering. The existing deploy command migrates before pushing code ([deployment.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/deployment.md:152)); require that path because new code before migration will fail.
- [page-title.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/page-title.ts:97), whose exhaustive `Record<Mode, string>` will fail typecheck when `"review"` is added.
- `ThreadSummary.kind`, prose marks, floating-dialog behaviour, import/export, project docs, prompt-caching docs, and dictation’s “four boxes” count.
- Stance on error, stop, recovery, retry, optimistic rows, and two-tab conflicts—not only successful `finish`.

## No-spoilers

Do not add a broad soft rule based on `?at=`. It is current location, not furthest-read progress: a reader may finish the article and scroll back before reviewing. Using it as a completion signal will suppress exactly the corrections Review exists to make.

A narrow rule is worthwhile:

> Honour an explicit request not to reveal later material. Do not infer reading progress from the current position alone.

## What I would build

Build Review mode after revising the plan, but:

- validate the prompt first against fixed examples before doing schema/UI work;
- ship Respond and Signposts first if necessary;
- do not ship the current absolute Socratic behaviour;
- do not make Balanced the default until tests include garbled speech, explicit confusion, terse-but-correct accounts, defensible alternative readings, disagreement with the author, and deliberately ambiguous articles;
- do not build a copied `ReviewBand` with a second chat state machine.

No files were changed and no tests were run.