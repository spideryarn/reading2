Stage 1 is not solid yet. The main blocker is a privacy/user-control bug: the New Session panel can hide a microphone that is still recording.

## Findings

1. **P1 — Closing New Session can leave dictation running invisibly.**  
   The hook remains mounted when `open` becomes false, while the text box and Stop control disappear. If Close is pressed while recording—or while microphone permission is pending—the microphone can continue without any visible way to stop it. See [NewSessionPanel.tsx:153](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/web/src/NewSessionPanel.tsx:153), [NewSessionPanel.tsx:187](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/web/src/NewSessionPanel.tsx:187), and [NewSessionPanel.tsx:196](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/web/src/NewSessionPanel.tsx:196). Close must either stop/abandon dictation first or be unavailable while dictation is active or opening.

2. **P2 — The paid route has no rate or concurrency limit.**  
   After the Origin check, every accepted request can immediately open a paid upstream request; unlike steering, there is no per-client or global admission control. Tailnet reachability remains the primary boundary, but this route adds unbounded spend and sockets for any compromised/same-origin client. See [routes-transcribe.ts:167](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/routes-transcribe.ts:167).

3. **P2 — Client cancellation does not cancel the OpenRouter request.**  
   The browser aborts its fetch, but the fleet server supplies no abort signal to `transcribeForFleet`, so the paid call continues after navigation, a replacement recording, or unmount. See [routes-transcribe.ts:200](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/routes-transcribe.ts:200). The product route already has the appropriate `res.on("close")` pattern at [routes.ts:5649](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/src/routes.ts:5649).

4. **P2 — The outer error boundary logs an unclassified exception message.**  
   [routes-transcribe.ts:216](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/routes-transcribe.ts:216) interpolates `err.message`. The currently anticipated provider failures are sanitized earlier, so I did not find a present ordinary path that logs audio or transcript. Nevertheless, this boundary breaks the stated invariant: a future thrown request/provider error can leak body-derived material. Log a fixed internal reason instead.

5. **P2 — The parser permits the exact “sent, then quietly dropped” failure class.**  
   The current fields—audio, format, and context—are all carried correctly. However, [routes-transcribe.ts:95](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/routes-transcribe.ts:95) reconstructs those fields while silently ignoring surplus keys. A future optional field or an untyped caller could therefore send data that the server drops without complaint. The product endpoint rejects unknown keys at [routes.ts:5602](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/src/routes.ts:5602); fleet should do the same. It should also apply the product’s canonical-base64 validation so arbitrary nonempty strings cannot trigger paid calls.

6. **P2 — The submit rule is implemented only in the DOM, not at the action boundary.**  
   All three buttons include `sendBlocked` in `disabled`, which is good. Their handlers do not guard it: [NewSessionPanel.tsx:166](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/web/src/NewSessionPanel.tsx:166), [SessionDetail.tsx:480](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/web/src/SessionDetail.tsx:480), and [SessionDetail.tsx:543](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tools/fleet/web/src/SessionDetail.tsx:543). Present pointer clicks are blocked, but programmatic invocation or a later keyboard path would bypass the invariant.

7. **P2 — The import enforcement is sound for today’s graph but syntactically bypassable.**  
   [fleet-imports.test.ts:89](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/tests/fleet-imports.test.ts:89) detects multiline imports, type-only static imports, exports, and quoted dynamic imports. It misses `require("../../src/...")`, template-literal dynamic imports, and computed dynamic imports. An AST-based walker—or explicit rejection of `require` and non-string-literal dynamic imports—would make the architectural rule real rather than conventional.

8. **The microphone codes should share one global namespace.**  
   These are the same feature and same operator-facing diagnostic vocabulary, even though fleet is independently deployable. At reviewed HEAD, the code test only scans `src/`; extending it to `tools/fleet` is worthwhile. A concurrent uncommitted expansion of that test already exposed differing sentences for codes including `[mic-format]`, `[mic-offline]`, `[mic-upstream]`, and `[mic-unexpected]`. The scanner also matched a code in a comment, so that false-positive case needs handling.

## Claims checked

- The generic seam preserves the important context behavior. `Session<C>.where` captures `whereRef.current` at press time; initial upload and retry both use that stored value. Current callers pass fresh objects containing primitive values, so opaque generics have not weakened the snapshot. Technically it is a reference snapshot, not a deep clone; a future caller must not mutate the object after passing it.
- The OpenRouter request has no shallow-spread/provider collision. `provider` is constructed once, and the vocabulary reaches `provider.options.openai.keywords`.
- The `transcribeWith` spend conclusion is correct: used standalone, it creates no collection scope or database row, so `npm run cost` would not see it. The explanation is slightly off: there is no process-global sink waiting to be installed. A sink belongs to `collectSpend`’s async scope. Outside one, the call increments an in-memory unscoped counter and logs a warning, then drops the record.
- Rendering an explanatory insecure-context sentence is the right UI. A disabled button implies an action the reader might be able to unlock locally; the actual remedy is HTTPS/Tailscale Serve or the SSH forward.
- I found no ordinary success or failure route that leaves the reader with literally no feedback. The hidden-running-microphone case is the important exception in practical terms.
- The documentation does not overstate microphone verification: the real capture-to-transcript path remains unverified on this machine.

## Measurement corrections

An independent AST import walk produced:

| Root | Files | Lines |
|---|---:|---:|
| `src/web/dictation-upload.ts` | 22 | 16,215 |
| `src/web/useDictation.ts` | 8 | 2,931 |
| `src/transcribe.ts` | 162 | 118,171 |
| `src/ai-call.ts` | 21 | 20,505 |

The published numbers are therefore stale, though none of the architectural conclusions changes.

Focused fleet transcription, import, and control tests passed. Typechecking passed. A fleet build to a temporary output directory passed, with no Supabase/Sentry strings and all three expected dictation markers present. The only observed code-test failure came from the concurrent, uncommitted expansion described above.