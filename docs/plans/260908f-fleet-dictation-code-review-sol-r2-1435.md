Stage 1 is still not solid. The original P1 is fixed, including permission-pending, but four P2 issues remain.

## Findings

1. **P2 — New Session’s action guard is stale.**  
   `start` reads `dictate.sendBlocked`, but its dependency list contains only `prompt`. While opening or dictating without changing the prompt—especially Safari/Firefox—the callback retains `false`; the DOM remains protective, but the intended action-boundary guard is ineffective. The scoped linter independently reports this exact stale closure. Use the same ref pattern as `SessionDetail`, or depend directly on `dictate.sendBlocked`. See [NewSessionPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/web/src/NewSessionPanel.tsx:191).

2. **P2 — An abort can still lead to a socket write.**  
   The ordinary `transcribeForFleet` abort path returns `499`, after which line 330 correctly returns. But if the transcriber rejects after the abort, the outer catch cannot see `hangup` and writes a 500 whenever `headersSent` is false—which it normally is on a disconnected, previously unanswered response. See [routes-transcribe.ts](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/routes-transcribe.ts:320) and [the catch](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/routes-transcribe.ts:341).

   I reproduced it through the public seam:

   ```text
   aborted: true
   writes: writeHead(500), end(...), both after closed=true
   ```

   Put the catch inside the controller’s scope and return when aborted; also remove the listener in `finally`, matching the product route.

3. **P2 — A free request consumes a paid-call slot.**  
   The limiter records before `transcribeForFleet` performs its free exits. A valid short recording therefore returns an empty 200 without reaching OpenRouter, yet an immediate second request gets 429. I reproduced exactly that: upstream calls `0`, first response `200`, second response `429`. See [routes-transcribe.ts](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/routes-transcribe.ts:294) and the short-audio exit in [transcribe.ts](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/transcribe.ts:232).

   The route flood test does not prove the global burst ceiling: all twelve requests use the same key at essentially the same timestamp, so requests 2–12 hit the three-second per-key floor. Use distinct session IDs or an injected clock to exercise ten accepted records.

4. **P2 — The import rule remains syntactically bypassable.**  
   Refusing unsupported syntax is a reasonable trade, but the regex does not implement the stated ban. These valid shapes are neither followed nor refused:

   ```ts
   import ("../../src/routes.js")
   import("../../src/" + "routes.js")
   import /* comment */ ("../../src/routes.js")
   require /* comment */ ("../../src/routes.js")
   ```

   See [fleet-imports.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tests/fleet-imports.test.ts:99) and [unfollowableImports](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tests/fleet-imports.test.ts:127). Given that this is the second regex-bypass round, I recommend the AST walk.

## Direct answers

- **The original P1 is closed.** `armed` includes `opening`; `startedAt` is irrelevant. Stopping finishes the session, and when pending `getUserMedia` eventually resolves, `stillWanted()` is false and the returned track is immediately stopped. See [useDictation.ts](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/src/web/useDictation.ts:1136), [beginCapture](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/src/web/useDictation.ts:1620), and the `armed` definition at [line 1374](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/src/web/useDictation.ts:1374).

- **The microphone test is meaningful, but narrow.** It genuinely proves the panel calls the raw toggle when closed while armed; removing the effect makes it fail. It does not prove the permission-pending state machine—the mock reports `listening`, never `opening`, and assumes `toggle` performs the right transition. A deferred-`getUserMedia` hook test would pin that second half.

- **`SessionDetail`’s ref is correct.** Reading the latest committed value at invocation is preferable to a stale callback dependency. The New Session implementation is the one that failed to use that pattern.

- **The fakes can conceal real failures.** `fakeRes.hangUp()` does not make writes fail or record them as writes-after-close; `headersSent` never changes; and the abort test neither awaits handler settlement nor asserts that no response was written. `fakeTranscribe` resolves on abort and records only vocabulary/signal, so broken audio or format wiring would also pass. Type it as `TranscribeDeps["transcribe"]`, retain all arguments, and give the fake a real closed/writable state.

- **The base64 check is syntactically reasonable but does not meet the stated spend goal.** `"A".repeat(60_000)` passes—and is already the test fixture’s fake audio. Adopting the product regex would not change that: arbitrary bytes can be valid base64. If the requirement is “nonsense must not open a paid call,” decode and validate the claimed container, not merely the encoding. Also, only top-level surplus keys are tested; I found no test for surplus context keys.

- **The code-namespace changes look sound.** Skipping generated `dist/` is correct. Line-start-only `//` stripping is defensible because an unresolved occurrence enters `skipped` and fails rather than disappearing silently.

- **Your HTTPS reasoning is right.** Secure Contexts explicitly trusts `127.0.0.0/8`, not arbitrary private or CGNAT addresses; insecure documents do not receive `navigator.mediaDevices`. Tailscale Serve provides an HTTPS `*.ts.net` endpoint, provided MagicDNS/HTTPS certificates are enabled. [W3C Secure Contexts](https://www.w3.org/TR/secure-contexts/), [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

The plan is honest about the missing human verification at lines 772–774. It does overstate “all fixed” and “the import rule holding,” and stale closure figures remain below the corrected table. The old, incorrect async-sink explanation also remains in [tools/fleet/transcribe.ts](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/transcribe.ts:21).

Verification: focused tests passed, 60/60; typechecking passed; fleet production build passed. The complete suite could not start because this sandbox cannot reach local Postgres. No files were changed.