**C1 — P2: malformed-reply tests accepted an accidental exception.** Input: remove both `MalformedReply` imports. Reproduced: all 26 original rows still passed with `ReferenceError`. **Fixed** by asserting the caught error is `MalformedReply`. Red-first: 24 failures; restored imports pass.

**C2 — P3: Skim’s documentation overstated when its job ends.** Input: Quotes or Ideas fails, is stopped, or succeeds before Skim is refused. The hold already releases correctly; “not over until the route is written” was false. **Fixed** the comment and docs. Six added lifecycle cases pass, with the completion GET deliberately unresolved.

**C3 — P3: Thread’s comment overstated server compatibility.** Input: a truthy primitive stored as `thread`. Reasoned: `loadTweets` permits it; the client refuses it. **Fixed the comment**, retaining the requested object check. No such stored artefact was observed; both corpus threads pass.

No further behavioral defect found:

- Deferred presses keep one intent, and the control is unavailable before sending.
- Unchanged identity, slug navigation, and band reopening pass.
- *Plan the route for this* saves different input; the server freezes that profile onto the new job. Left unchanged.
- Empty and legacy Thread/Skim objects pass. Skim’s check matches `loadSkim`, including zero stops.
- Picture failures preserve the picture and flags; 404 clears faults too; checked-empty preserves faults. Hold identity handling is unchanged. Illustrated reads Sketch readiness through its own GET.
- The conditional-spread guard remains tested. The waiting sentence matches its siblings’ form and placement.

Files changed, all **uncommitted**:

- [Reply matrix](../../tests/read-error-matrix.test.tsx), [hold tests](../../tests/rewrite-hold.test.tsx)
- [useSkim](../../src/web/useSkim.ts), [useTweets](../../src/web/useTweets.ts) — comments only
- [Skim docs](../project/skim.md), [stage plan](261007e-seventh-sweep-skim-hold-two-unchecked-replies-and-the-picture-flags.md)

All completed Vitest runs used `--pool=threads --maxWorkers=1`:

| Run | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Original full hold suite | 367 | 0 | 18 |
| Missing-import mutation, original matrix | 26 | 0 | 64 |
| Mutation with class assertions | 2 | 24 | 64 |
| Restored full matrix | 90 | 0 | 0 |
| Final matrix, including compatibility cases | 94 | 0 | 0 |
| Skim and membership-guard cases | 50 | 0 | 341 |
| Skim panel and purpose suites | 148 | 0 | 0 |

`git diff --check` passed. Two initial combined runs were interrupted before summaries and supply no evidence.

**Verdict: ship with these fixes applied.**

Wider notes: CommandBar’s known **P1** hold bypass remains untouched. Stored Skim routes were not sampled; compatibility evidence is the server/writer/types inspection plus synthetic empty and legacy cases. No browser pass.