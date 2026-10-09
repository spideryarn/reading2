The core approach works for comments and quiz questions, but the keeper name is not a reliable target identity for every consumer. Five findings:

**F1 — P1 — [FeedbackEarlier.tsx:1241](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/src/web/FeedbackEarlier.tsx:1241): Replies change target without changing keeper.**  
Previous/Next reuses the unkeyed `ThreadView` and `ReplyBox`, while every question uses `"feedback-reply"`. A transcript or retry from question A therefore passes the proposed check in question B. `doneKey` prevents sending, but not insertion.

**Smallest fix:** use `feedback-reply:${question.id}` and test navigation through the actual consumer.

**F2 — P1 — [ChatPanel.tsx:3047](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/src/web/ChatPanel.tsx:3047), [AnnotateDialog.tsx:438](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/src/web/AnnotateDialog.tsx:438): Recovery partitions combine distinct targets.**  
Chat uses `chat:${slug}` for every conversation and the list composer. Conversation keys protect pending deliveries by unmounting, but the next conversation can recover the previous conversation’s tape. Recording its recovery box merely blesses that wrong assignment.

Annotate similarly omits `anchor.quote`, although `annotateKey()` includes it: two selections starting at the same position share a keeper despite being different targets.

**Smallest fix:** partition Chat by conversation/list identity; use `annotate:${annotateKey(anchor)}` for annotations. Test recovery into a different conversation and a different selection with the same start.

**F3 — P0 — [useDictation.ts:1508](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/src/web/useDictation.ts:1508): A new press can erase the refused dictation’s only copy.**  
After A’s successful transcript is refused in B, pressing the microphone clears `recording`, `retryable`, and `held`. If keeping failed—or IndexedDB/Web Locks are unavailable—both A’s audio and cached words disappear. Previously those successfully transcribed words would have landed; the proposed refusal introduces this loss.

**Smallest fix:** refuse a new start while an undelivered offer lacks a verified device copy, with an explanatory sentence. Keep the field’s span/caret reset behind that acceptance check too. Otherwise preserve offers separately. Add a no-device-copy test.

**F4 — P1 — [useDictation.ts:1354](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/src/web/useDictation.ts:1354): Live delivery still crosses targets.**  
`r.onresult` calls the latest `onText` without checking the bound box. Moving before the first confirmed phrase leaves `span` null, so A’s phrase enters B. This can also happen after Stop, before the recogniser emits `onend`. Refusing the authoritative transcript later leaves those wrong words in B. The plan’s assumption that Chromium’s live words already landed in A is therefore incomplete.

**Smallest fix:** apply the identity check to live phrase delivery as well; do not increment `confirmed` for suppressed phrases. Test a first final phrase arriving after navigation.

**F5 — P0 — [useDictation.ts:1879](/var/tmp/spideryarn-worktrees/qi-cfrv4spd-dictation-lands-in-next-box/src/web/useDictation.ts:1879): Recovery can race transcription and delete the wrong held tape.**  
`finish()` clears `session.current` before awaiting transcription. Recovery consequently accepts B’s tape during A’s pending upload. A reachable sequence is:

1. Recover B; start B’s retry.
2. A’s result arrives and the proposed refusal replaces `held` with A’s tape.
3. B’s retry succeeds; `forgetHeld()` deletes A’s tape and clears A’s offer.

The retry generation guard does not exclude A’s original ending.

**Smallest fix:** recovery must publish only while idle, with no upload pending, and only if its captured artifact generation remains current. Release rejected recovery claims. Test this ordering explicitly.

Feedback, Commands, and hidden Earlier replies drop their keeper without changing their retained draft; allowing delivery through that visibility change is appropriate.

The offer mechanism itself is otherwise sound if refusal retains the tape through `holdKept()`, bypasses the usual release/clear success paths, and still runs the original session’s `done()` so `onEnd` clears span and double-press intent. Check identity both before retry work and after its await. A wrong-box retry should leave phase, artifact, cache, and locks unchanged. The cap needs no special delivery path.

The simplest correct version remains the hook guard plus the existing cached retry offer, with corrected keeper identities and refusal of new starts when preservation failed. Remounting or releasing to recovery alone loses unpersisted audio.

Read-only source review; no files edited or tests run.