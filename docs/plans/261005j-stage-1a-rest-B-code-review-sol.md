Found and fixed one functional defect. Nothing committed; Stage C’s files were untouched.

Findings:

- **B1 — P1, established, fixed:** a root transport rejection after its cap could start another ask and report success if the timeout callback had not run yet. The failing tests observed four total calls and `rootAskedTwice: true`. The rejection path now checks `Date.now() >= expiresAt` before clearing the timer.
- **B2 — P2, established, fixed:** the new `onAsked` callback introduced a lint error through assignment inside an expression. Changed it to a plain block body.
- **B3 — P3, established, fixed:** corrected the test header’s stale behaviour count, the fallback description’s omission of immediate root refusal/truncation, and A1’s wording that called a batch unaskable when only its re-draw would not fit.

Root endings, assuming checkpoint misses and one transport attempt per call:

| Ending | Root calls | Latch and result | `rootAskedTwice` |
|---|---:|---|---|
| Transport failure, then success | 2 | Neither latch; success | true |
| Invalid answer and invalid re-ask, then success | 3 | Neither latch; success | true |
| Second chance fails | 2–3 | `gaveUp`; `root-call-failed` | true |
| First answer refused or cut short | 1 | `gaveUp`; `root-call-failed` | false |
| First call reaches its cap, including the rejection race | 1 | `outOfTime`; `out-of-time` | false |
| Second call reaches its cap | 2–3 | `outOfTime`; `out-of-time` | true |
| First/second admission denied | 0 / 1–2 | `outOfTime`; `out-of-time` | false |
| Checkpoint hit on first/second ask | 0 / 1–2 | Success without another transport | false |
| Good first answer arrives late | 1 | Saved, counted, but `out-of-time` | false |

Stop before the root starts, during its first call, between asks, or during its second call permits respectively **0, 1, 1, or 2–3** root calls. It throws cancellation after settling started work; no `SlicesOutcome` is returned. Every returned message contributes usage before validation, including invalid, refused, truncated and late answers. Transport attempts are counted separately; thrown calls have no returned-message usage, while the wire ledger records their spend.

**Keep the `why === "failed"` guard.** Removing it in a scratch copy let the first ask’s saved late answer turn `out-of-time` into success. `ask` reads checkpoints before checking admission latches, so the guard does behavioural work. Earlier terminal slice failures still prevent reaching the root. The root’s `second-chance` need neither halves it nor increments slice-only `secondPass`.

Both asks use the same checkpoint key. The late-answer test also verifies that a later run reuses the saved answer without buying calls.

The four detail strings passed exactly: no suffix, `(1 asked for twice)`, `(the top line asked for twice)`, and `(2 and the top line asked for twice)`.

A1’s functional fix passes. Both planner admission and the re-draw read `LABEL_RETRY_HEADROOM`. Default plans budget the retry’s 32,000 tokens, window offending sections, and repack; the resulting bounded batches fit. Caller-supplied oversized caps remain outside the documented default guarantee.

Validation: **279 tests passed across seven files in the committed snapshot**, followed by **93 tests in the final requested pair** after additional boundary coverage. These required no network. Snapshot typechecking passed for 3,260 files; scoped lint passed with two complexity advisories. Full `npm test` was blocked by sandbox access to Postgres.

Verdicts:

- **`b18de4c3b`: land with the fixes made.**
- **`dcb5f6cc1`: land with the prose fixes made; its functional fix is sound.**

Files changed:

- [src/structure-slices.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/structure-slices.ts)
- [tests/structure-slices-second-pass.test.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/tests/structure-slices-second-pass.test.ts)
- [docs/project/structure-step.md](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/docs/project/structure-step.md)