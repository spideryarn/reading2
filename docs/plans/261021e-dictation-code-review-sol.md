1. **P1 — [SkimPurpose.tsx:258](/var/tmp/spideryarn-worktrees/fbwc4vku-mic-on-prose-boxes/src/web/SkimPurpose.tsx:258):** a microphone press and banner arrival in the same React batch could unmount `PurposeAsk` before its layout effect reported busy, aborting the recording. I added a synchronous hold claim for both Dictate and Retry, plus a regression test that failed before the fix.

2. **P2 — [CriteriaPanel.tsx:789](/var/tmp/spideryarn-worktrees/fbwc4vku-mic-on-prose-boxes/src/web/CriteriaPanel.tsx:789), [CandidatesPanel.tsx:917](/var/tmp/spideryarn-worktrees/fbwc4vku-mic-on-prose-boxes/src/web/CandidatesPanel.tsx:917):** both boxes rendered an enabled but nonfunctional microphone on unsupported browsers. I matched the established callers by hiding it when `supported` is false and added tests for both boxes.

3. **P2 — [useDictationField.ts:409](/var/tmp/spideryarn-worktrees/fbwc4vku-mic-on-prose-boxes/src/web/useDictationField.ts:409):** wider decision needed. After a failed Chromium transcription leaves partial live words, the shared hook clears their replacement span and remembers their end position. Retry therefore appends the full transcript after the partial words instead of replacing them. In the comment note, the next `onCommit` can save that duplication. I did not change this because it is pre-existing shared-hook behavior outside this change’s files and requires a whole-app retry-semantics fix. I agree with the accepted decision to save visible rough words on failure itself; the separate Retry duplication is the concern.

Focused result: 98 tests passed; lint passed with existing advisory warnings; the full typecheck passed via `node --import tsx scripts/typecheck.ts`. The requested npm wrapper was attempted twice but its `tsx` CLI IPC socket is blocked by this sandbox.

I left chat rewrite exempt and did not block comment close/step/delete, as settled in the plan.

Verdict: local fixes are green; ready apart from the wider P2 Retry-duplication decision.