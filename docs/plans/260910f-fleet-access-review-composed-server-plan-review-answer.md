Review written to [260910f-fleet-access-review-plan-review-findings.md](/tmp/260910f-fleet-access-review-plan-review-findings.md).

Verdict: refuse pending plan changes. I found 10 findings: one reasoned P0 harness hazard, seven established/reasoned P1s, and one P2.

The main blockers are:

- The final origin expectations contradict the new pre-routing Host rejection.
- Host coverage only names `/api/state`, leaving `/api/messages`, SSE, static, and fallback paths unproved.
- The bind test can pass vacuously without another interface.
- Production queue/drainer composition is explicitly left source-level despite the roadmap requiring proof.
- Peer-address logging does not prove action/speaker attribution.
- Two parts of roadmap checkbox 4 disappear.
- Positive same-origin controls are not explicitly constrained to side-effect-free bodies.
- The Host policy may break the legitimate MagicDNS short name.
- Blanket HEAD support is wrong for SSE.
- A temporary-cwd child cannot resolve bare `--import tsx`; I reproduced that failure.

The DNS-rebinding diagnosis itself is sound, subject to browser private-network behavior. A global pre-routing authority check is the right fix shape. `421` is defensible; the exact status is less important than consistent rejection before routing.

I ran `npx vitest run tests/fleet-origin.test.ts`: 7 tests passed. I changed only the requested `/tmp` findings file. Concurrent worktree modifications appeared during the review; I did not touch them.