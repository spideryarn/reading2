Reviewed HEAD `66b001ae4`. No files changed. I ran only the offline trace summaries.

The alongside approach is sound, but the proposed exchange rules can silently corrupt saved history. Both suspicions deserve attention; the settle rule is a definite blocker, while `localStorage` itself is not the engine-choice problem.

1. **F1 — P0 — “Turning fragments into chat rows”: interleaving is not question/answer ownership.**

   Consider: Q1 → companion starts A1 → reader interrupts with “But what about the other example?” → companion continues A1. The interruption exceeds four words, so the plan opens Q2 and assigns the remaining A1 words to it. Sorting by `start_ms` preserves chronology, not which question those words answer.

   Conversely, “Why?”, “That’s wrong”, or “Don’t continue” can satisfy the four-word rule and disappear from saved history. WhatNext’s helper joins the assistant’s message across a short interjection; the plan additionally discards the interjection.

   **Change:** retain ordered speaker segments as the authoritative record, with pairs as a conservative projection. Preserve meaningful interjections and mark ambiguous/interrupted pairs explicitly. Do not promise faithful history from this heuristic alone. This affects Stage 2’s storage contract, not just Stage 3’s reducer.

2. **F2 — P0 — “Turning fragments into chat rows”: settling can freeze an unfinished answer.**

   Backend completion is not voice completion. In `spike-out-allow.json`, the final backend response completes at **5,010 ms**, while the answer’s transcript continues through **8,538 ms**. `allowmin` completes both backend rounds without any output transcript.

   Thus “a few seconds and no delegation outstanding” can save only the preamble before a delayed answer begins. Likewise, “the next exchange has begun” can save Q1 while its delegation remains active.

   **Change:** distinguish backend completion, expected voice delivery, provisional segmentation, and irreversible persistence. Silence must not establish successful completion. Preserve late fragments in the authoritative record.

   `expectedTailId` protects a retry carrying its original tail. It does **not** prevent the segmenter from emitting the same exchange again after the first append advances the tail. Require stable exchange identity, event deduplication, and a once-only handoff; freeze the payload and tail across transport retries.

3. **F3 — P1 — “Turning fragments into chat rows”: delegation evidence can become detached from the spoken answer.**

   `offset_ms` gives a delegation’s position on the timeline, not an output-transcript response id. After an interruption, the plan may file the delegation’s passages on Q1 while filing its eventual spoken answer under Q2. If Q1 has already been appended, late tool receipts have nowhere to go through the existing append-only path.

   **Change:** retain `(delegation_id, offset_ms)` independently of the mutable “open exchange”; resolve ownership against retained timeline segments, including delayed input fragments. Keep unresolved or late receipts until projection is safe. Test a delegation spanning a substantial interruption, with tools completing after the next reader run begins.

4. **F4 — P1 — “The server” / “The meter”: pre-create journalling is right, but it does not record the creation charge.**

   On the plan’s stated billing rule, successful creation followed by cancellation or failed connection costs **at least 15 seconds: $0.0125**. The proposed browser-only meter leaves that session at zero reported seconds with no priced `ai_calls` row.

   Pre-create insertion also introduces a new distinction: an attempted create that fails versus a successfully created session that never connects. The existing journal cannot express that distinction explicitly.

   **Change:** keep journal-before-create. After confirmed success, record the known 15-second minimum server-side and advance the same high-water mark atomically, so a browser report of 15 adds nothing. Record create success, failure, or uncertain outcome and the provider session id. Keep `connected_at` unset until there is connection evidence; creation charges must not trigger Realtime’s usage-implies-connected backfill.

5. **F5 — P1 — “The meter” / Stage 2: the stated migration cannot store the new event kinds.**

   [`schema.ts:3174`](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/live-conversation-realtime-upgrade/src/db/schema.ts:3174) restricts `ai_calls.event_kind` to `response` and `transcription`; `RealtimeEventKind` has the same restriction. Adding only the two session columns leaves `voice` and `backend` rows rejected. There is also no distinct voice-duration column.

   **Change:** specify the complete ledger mapping, migration, types, and store projections. Preserve voice seconds as auditable quantities, rather than silently calling them transcription seconds.

   The high-water-mark approach is otherwise correct **if** its read, advance, and cost-row insert occur under one row lock in one transaction. Test concurrent reports, reordered reports, retries, and rollback after an insert failure. Stage 2 needs a real Postgres persistence check; fetch stubs cannot catch these constraints.

6. **F6 — P1 — “Lifecycle and stalls”: several reused behaviors depend on missing Realtime events.**

   The existing hook gets `hearing`, open-utterance state, idle activity, interruption handling, and hang-up settling from `input_audio_buffer.speech_started/stopped`. It gets `speaking` from `output_audio_buffer.started/stopped/cleared`. None appears in the proposed GPT-Live allowlist.

   **Change:** explicitly define GPT-Live’s replacements and their limitations. Transcript activity can support estimates, but cannot establish exactly when capture or playback starts and stops. Specify microphone release, transcript draining, interruption flags, and the bounded close sequence before reusing the lifecycle claims. Keep channel handlers and the meter alive through the close grace period.

7. **F7 — P1 — “Lifecycle and stalls”: filler can clear debt for an answer that never arrives.**

   The rule catches `allowmin` because that run has no companion transcript. It misses another valid ordering: tool finishes → companion says “One moment” → backend final response completes → no answer is spoken. The filler pays the debt, and backend completion creates no new debt. Speech for another delegation can also clear a global debt.

   **Change:** track pending delivery per delegation and renew debt when its final backend answer becomes available. A preamble must not settle that obligation. Test filler followed by silence, a delegation with no tools, and overlapping delegations.

8. **F8 — P1 — “One conversation, two engines”: preference and active-session ownership need separate rules.**

   A stored GPT-Live preference can safely coexist with a server-backed experimental switch: evaluate the switch when starting each call. The danger is changing which hook supplies `LiveApi` while the old hook is still connecting, speaking, or flushing. That can hide the controls for a live microphone or send Stop to the wrong engine.

   **Change:** distinguish remembered preference, effective engine for the next start, and the engine owning the current call. Pin ownership until Stop finishes. Turning Experimental off must stop an active GPT-Live call before returning the controls to Realtime; Reconnect must reevaluate eligibility.

9. **F9 — P2 — “Stages”: Stage 3 enables the default before Stage 4 proves the real integration.**

   Stage 1 is independently useful. Stage 2 can stand alone with the accounting fixes above. Stage 3 currently selects GPT-Live by default, while the first real application-wire verification is deferred to Stage 4.

   **Change:** keep Realtime as the default until that verification passes, and update accounting documentation alongside Stage 2. Expand provider evidence to include overlapping delegations and continuations completing in reverse order: the supplied traces prove one delegation, not concurrent routing. Stage 4’s typed input also bypasses input transcription; add synthetic spoken-input coverage without claiming physical acoustic validation.

The three passed-over recommendations:

- **R5, segment storage:** **yes, passing it over as written will cost a stage.** The full-duplex behavior requires retaining interleaving information before reducing it to pairs. This need not replace the entire Chat renderer.
- **R2, server execution receipts:** **no, not a stage-costing mistake today.** Read-only tools make repeated execution tolerable. Retain synchronous client deduplication and once-only continuation handling.
- **R8, physical acoustics:** **no, not a stage-costing mistake for this experimental release.** Keep physical microphone, echo, and audible playback acceptance explicitly outstanding. Synthetic spoken-input testing remains achievable.

**Verdict: build with the P0-P1 changes.**

