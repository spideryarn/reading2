# Repair realtime chat

Status: landed on `dev` on 2026-09-06. Repair commit `7eb8f2a0`, pushed through merge `e018edee` after integrating `818ccd41` from the latest remote. The full gate is not green: unrelated job tests still report database contention. Feature checks, typecheck, builds and the final Sol reviews passed. This worktree was initially based on `28096583`, then merged `39282f8c` and `f0a614e4` before final checks.

> I should be able to use that button to start a new conversation, or resume an existing one, and when I hang up I should be able to resume or switch to typing/dictation.
>
> optimise for capability, then latency, then cost
>
> — Greg, 2026-09-06

## Evidence and choice

The provider accepted the existing production session builder against this account with synthetic article context: `gpt-realtime-2.1`, `gpt-live-transcribe`, semantic VAD, Marin, and all eight tools. No database write or reader article was involved. [Official model documentation](https://developers.openai.com/api/docs/models/gpt-realtime-2.1), read 2026-09-06, confirms speech, reasoning, and tool use; keep that model and the existing WebRTC transport.

Independent diagnosis found that Chat never renders `live.error` or the streaming `live.lines`, the Live button has no tooltip, and capture ignores the remembered input device that dictation already uses. That matters on this Mac: [dictation.md](../project/dictation.md) records a virtual default microphone delivering silence. There is no local input meter or playback rejection handling. The startup timeout misses a channel that never opens, and a seed timeout can leave phase `closing` forever.

The simpler alternative was just adding a tooltip and error sentence. Passed over because it would expose errors while leaving microphone selection, playback recovery, and startup deadlocks broken. Reuse shared microphone selection, audio-level, tooltip, chat persistence, and tool machinery; no new dependency, database schema, transport, or separate conversation store.

## Repair and prevention stage

- [x] Reproduce reachable lifecycle and UI failures with tests, watching the specific assertion fail before implementing.
- [x] Delegate runtime repair: honor the chosen microphone, meter the actual acquired stream, release all audio resources, bound/cancel startup and detect disconnection, surface actionable failure states, handle blocked playback with an explicit enable-audio action. Preserve seed-before-listen, serial transcript appends, hangup grace, and stale-session guards.
- [x] Delegate UI repair: tooltip and labelled start/hangup/resume, start on an empty chat, streaming transcript on by default, microphone device/level feedback, Auto/Headphones/Laptop placement, listening/thinking/tool/speaking status, retry and return to typing/dictation. Reuse the existing thread controller and shared components. Live state belongs only to its bound conversation; do not display its transcript in another thread.
- [x] Transfer transcript ownership when `speak` registers optimistic chat rows: exactly one visible copy while the append is pending and after it lands, with unsaved text recoverable on failure. Test with a deferred append, not only a resolved mock.
- [x] Every startup deadline belongs to one epoch and is cleared on success, stop, failure, and replacement. Explicitly test start A, stop A, start B, then A's old deadline. Include stalled ticket and microphone permission, not only seed acknowledgements.
- [x] Exercise tools including more than one tool call: return outputs once, continue only at a valid response boundary, show work in progress, and give a useful failure result. Keep existing article passage navigation and typed history behavior.
- [x] Write a subagent-rooted postmortem naming the failure class, introducing commits, and implemented prevention. The postmortem was renamed to [A working transport mistaken for a working conversation](../postmortems/260906f-a-working-transport-mistaken-for-a-working-conversation.md) so its filename names the class. Update [live-conversation.md](../project/live-conversation.md).
- [x] Run `npm test`, `npm run typecheck`, touched-file lint and `npm run check`; verify real browser UI and real provider wire where possible. Distinguish synthetic input evidence from actual microphone/speaker evidence. Results and remaining unrelated failures are in the [final validation](260906f-repair-realtime-chat-final-validation.md).
- [x] Sol review of scoped diff and recorded evidence; verify and fix findings. Both the [code follow-up](260906f-repair-realtime-chat-code-review-followup-sol.md) and [gate follow-up](260906f-repair-realtime-chat-gate-review-sol.md) returned READY with exit 0 and substantive answers.
- [x] Commit the repair stage: `7eb8f2a0`.

## Landing stage

- [x] Fetch `origin/dev` again and merge if needed: `818ccd41` changed only non-overlapping documentation; merge `e018edee` needed no conflict resolution.
- [x] Recheck integration as needed: all 14 doc-link tests passed, and the merge changed no source or test file. Push `HEAD:dev`: the remote advanced `818ccd41..e018edee` and contains repair commit `7eb8f2a0`.
- [x] Run `npm run worktree:check`: exit 0, SAFE TO REMOVE at `e018edee`, with no unique data or environment changes. Retain the worktree because the unrelated full gate is still red.

Retain this worktree while the unrelated database-contention gate remains red. Physical microphone
capture and audible speaker output could not be confirmed by the browser automation; the real
provider generated streamed words, audio events and tool results with synthetic input.

## Signposts

- [Live conversation](../project/live-conversation.md): seed, transcript, persistence and metering contracts.
- `src/web/live/useLiveConversation.ts`, `src/web/live/exchanges.ts`: runtime lifecycle and turn ordering.
- `src/web/ChatPanel.tsx`, `src/web/live/LiveButton.tsx`: actual reader UI, distinct from the preview.
- `src/web/mic-devices.ts`, `src/web/useAudioLevel.ts`: existing microphone selection and metering.
- [Browser testing](../project/browser-testing.md), [code quality](../project/code-quality-overview.md): evidence and gates.

## Plan review

[Sol review](260906f-repair-realtime-chat-plan-review-sol.md): F2 (duplicate optimistic/live transcript) and F3 (old deadline stopping a new session) accepted and made explicit above. Both get red tests. F1's premise is stale: Live was intentionally rendered with a permanent label in Remember's composer by `94ddccd42`, carried through its rename in `028676677`; `LiveButton`'s `labelled` prop records why. Removing that existing control because live-conversation.md still says it is not built would be an unrelated product regression. Preserve the existing open-thread Remember control and its current general reading-companion prompt; the new list-level create-and-start belongs to Chat only. Update that obsolete doc statement, and test the distinction. Remember-specific spoken stance behavior is outside this Chat repair.

[Bounded follow-up](260906f-repair-realtime-chat-plan-review-followup-sol.md) returned **READY** and closed F1–F3 after checking the history and amendments. Both review processes exited 0 and produced substantive verdicts. The first review's test attempt could not create its sandboxed temporary directory; no test success is claimed from that attempt.

## Verification

[Check record](260906f-repair-realtime-chat-checks.md) links the observed regression failures, final checks, and browser evidence. Root review additionally required failed responses to settle the transcript and usage before teardown, and startup-only unmount/pagehide to close their AudioContext and abort their deadline. Both were reproduced before repair.
