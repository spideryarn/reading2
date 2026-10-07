Found one unresolved approval defect, so the candidate is not ready. I fixed eight other issues without committing.

- **C1 — P1 — Fixed:** simultaneous stale-lock takeovers could violate mutual exclusion. Acquisition/takeover is now serialized by a short-lived gate at [src/mcp/session.ts:229](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/mcp/session.ts:229). Red test: “never lets a third process acquire during two simultaneous stale takeovers.”

- **C2 — P1 — Fixed:** initial binding accepted tokens without `sub`/`session_id`, or whose `sub` disagreed with the session file. Binding now rejects both at [src/mcp/session.ts:466](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/mcp/session.ts:466). Red tests cover malformed claims and a different user.

- **C3 — P1 — Fixed:** an asking tool could open its dialog while unbound, then execute after another reader signed in. Asking tools now bind before opening any dialog at [src/mcp/server.ts:51](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/mcp/server.ts:51). Red test: “binds the server to its reader before opening a dialog or allowing a write.”

- **C4 — P1 — Fixed:** voucher retry fetched the voucher again after approval, allowing a changed delivery ID to be sent. Approval now captures and runs the exact approved delivery at [src/mcp/tools.ts:481](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/mcp/tools.ts:481). Red test: “retry sends the exact delivery the person approved, even if the voucher changes afterwards.”

- **C5 — P0 — Fixed:** a rejected access token could leak after refresh, and a successful route could echo a token into the tool result. Every attempted token is now scrubbed before either parsing or reporting the response at [src/mcp/api.ts:81](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/mcp/api.ts:81). Both scenarios had red tests.

- **C6 — P1 — Reported:** the retry dialog describes the voucher’s current recipient name, articles and note at [src/mcp/tools.ts:493](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/mcp/tools.ts:493), but retry sends the original frozen email payload described at [src/store/pg-voucher-emails.ts:9](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/store/pg-voucher-emails.ts:9). After those voucher fields change, the human can approve different content from what is sent. Fixing this needs the protected route/API to expose the frozen delivery, so I did not change it.

- **C7 — P1 — Fixed:** `set_auto_modes` returned the whole reader record, including profile text. It now returns only `{ autoModes }` at [src/mcp/tools.ts:307](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/mcp/tools.ts:307). The red test includes a profile sentinel. A separate regression test confirms `whoami` was already trimmed correctly.

- **C8 — P2 — Fixed:** argument parsing silently accepted two commands and duplicate valued options, and treated another option as a missing option’s value. Parsing now rejects these cases at [scripts/spideryarn-mcp.ts:47](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/scripts/spideryarn-mcp.ts:47), with three regression tests against the candidate behavior.

- **C9 — P2 — Fixed:** the stdio test hung for 30 seconds and then threw during cleanup when its mock server could not listen. It now rejects immediately and cleans up conditionally at [tests/mcp-stdio.test.ts:83](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/tests/mcp-stdio.test.ts:83).

- **C10 — P2 — Reported:** the spike claims search isolation, but its canary is only a tag and search does not index tags. Its deliberate-break control also passes if either list assertion fails, without requiring search to fail at [scripts/spikes/261007j-mcp-local-spike.ts:143](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/scripts/spikes/261007j-mcp-local-spike.ts:143). The documented search conclusion is therefore unsupported. Per instruction, I did not run or widen the spike.

Gate results:

- Requested Vitest command: 78 tests passed. The stdio suite could not run because this sandbox rejects local `listen(127.0.0.1)` with `EPERM`; after C9 it fails immediately rather than timing out.
- `npm run typecheck`: blocked before compilation because `tsx` cannot create its local IPC socket in this sandbox. Direct `tsc` runs for all four project configurations passed.
- Biome lint on all eight touched files: passed.
- `git diff --check`: passed.
- No commit made. Unrelated feedback/generated-file changes already present in the shared worktree were left untouched.

VERDICT: not ready