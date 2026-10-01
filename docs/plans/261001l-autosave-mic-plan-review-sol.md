The `ProfileBox` reuse and conditional draft write-back are sound. I found five issues:

1. **P1 — Concurrent saves can show “Saved” while the server holds older text.**  
   [plan:52](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md:52), [useProfile.ts:93](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/src/web/useProfile.ts:93), [Metadata.tsx:585](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/src/web/Metadata.tsx:585)  
   The generation guard only ignores an old response; it cannot stop request A from writing after newer request B. Autosave makes overlapping PATCHes normal, so B can be acknowledged, the UI can say Saved, then A can overwrite it server-side.  
   **Fix:** allow one mutation per field at a time and coalesce one queued latest value. If `pagehide` may bypass that queue, add server-side optimistic concurrency/versioning or preserve the latest draft locally. Test reversed server application order, not merely reversed response order.

2. **P2 — `SaveState` does not identify which draft is saving.**  
   [plan:27](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md:27), [useProfile.ts:52](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/src/web/useProfile.ts:52)  
   While A is saving, the reader can type B. A boolean `saving` makes the status say Saving even though B is not in that request; if the timer runs only for `dirty`, B may also miss autosave.  
   **Fix:** track `inFlightText`, and define `saving` only when `draft === inFlightText`; otherwise the current state is `dirty`. Keep the leave-warning predicate separate from the display union. “Saved” must mean the current draft’s exact request was acknowledged.

3. **P2 — Dictation’s “commit when words land” is racy, and `armed` does not cover transcription.**  
   [plan:39](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md:39), [useDictationField.ts:223](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/src/web/useDictationField.ts:223), [useDictationField.ts:229](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/src/web/useDictationField.ts:229)  
   `onTranscript` schedules the React state change and `onEnd` immediately calls `onCommit`; React may batch them, so `useProfile.latest` and `commitPurpose` can still see the pre-transcript value. On iOS that can be a no-op because there were no live words. Also, `armed` is false during `transcribing`, so a two-second timer can save Chromium’s rough text while a 2.7-second transcript is pending.  
   **Fix:** pass the final value explicitly to `onCommit(next)` or commit from an effect after the controlled value renders; suspend autosave while `armed || transcribing`. Test no-live-text dictation and transcription lasting beyond two seconds.

4. **P1 — The microphone diagnosis is too certain, and label equality is not device identity.**  
   [plan:85](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md:85), [mic-devices.ts:83](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/src/web/mic-devices.ts:83), [useDictation.ts:2031](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/src/web/useDictation.ts:2031)  
   Current standards say IDs must persist after an origin has attached a live track, and WebKit’s old refresh-rotation bug was marked fixed; a fresh permission prompt does not establish ID rotation. The cause is therefore unproven. AirPods routing is plausible: iOS routes can change, and WebKit has an open report where `{audio:true}` selects the iPhone mic despite connected AirPods. [W3C device-ID rules](https://www.w3.org/TR/mediacapture-streams/#device-info), [WebKit persistence bug](https://bugs.webkit.org/show_bug.cgi?id=179220), [WebKit AirPods/default-input bug](https://bugs.webkit.org/show_bug.cgi?id=282939), [Apple route changes](https://developer.apple.com/documentation/avfaudio/responding-to-audio-route-changes).  
   Labels are descriptive, not guaranteed unique, so equal labels can silently bless the wrong one.  
   **Fix:** describe the cause as “the stored ID no longer resolved.” Suppress the warning/update the ID only when the remembered label uniquely matches an enumerated input and the fallback track’s `getSettings().deviceId` is that input. Otherwise warn. Say “couldn’t use” rather than “isn’t connected.”

5. **P2 — Metadata still lacks a durable last-chance save.**  
   [plan:42](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md:42), [Metadata.tsx:585](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/src/web/Metadata.tsx:585), [useProfile.ts:168](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/src/web/useProfile.ts:168)  
   `visibilitychange` is the right mobile signal, but Metadata’s ordinary fetch can be terminated with the document; `beforeunload` is unreliable on mobile. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)  
   **Fix:** give both fields a keepalive/pagehide path or locally recover the unsaved draft. Attach `beforeunload` only while pending. Keepalive is specifically intended to outlive document unload. [Request keepalive](https://developer.mozilla.org/en-US/docs/Web/API/Request/keepalive)

For the legacy ID-only preference: forgetting it after a confirmed exact-ID failure is reasonable, but the current fallback must still warn once, and both local storage and React’s `deviceId` state must be cleared together.

I made no file changes.