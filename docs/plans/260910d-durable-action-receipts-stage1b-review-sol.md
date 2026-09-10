# Stage 1b review — GPT Sol, 2026-09-10, reconstructed

**This file was not written by the reviewer.** The run (`run-codex.ts --model gpt-5.6-sol --effort
high --timeout-minutes 30 --sandbox workspace-write`, prompt
[260910d-durable-action-receipts-stage1b-review-prompt.md](260910d-durable-action-receipts-stage1b-review-prompt.md))
hit its 30-minute cap — the cap the Overseer's budget notice of 09:35Z set — during its final
hygiene check, after its last gate and before writing its answer, so `run-codex.ts` exited 1 and no
answer file was produced. What follows is reconstructed by the implementing session from the run's
activity log (`…-stage1b-review-sol.md.activity.log`, not committed: 50,000 lines of tool output) and
from its edits to the worktree, which were read and kept. The reviewer's own sentences are quoted;
the finding IDs are the implementing session's, continuing the chain's numbering.

## What it said, in its own words

> The baseline is green: 14 files, 921 tests. I've found a candidate restart-loss path outside the
> supplied suspicions: if `holds.jsonl` cannot open but `receipts.jsonl` is healthy, the composition
> currently abandons the healthy receipt store too. … if confirmed, it is a P1 because acknowledged
> queued work vanishes from both restoration and the receipt API.

> The fixes are green in 4 focused files (133 tests). The two supplied suspicions about startup
> ordering and null generation are safe as implemented; I added end-to-end restart guards for both
> the null-then-real generation sequence and the mixed restored/stale `clear` list. The mixed list is
> refused atomically with `other-instance`, leaving the restored item and its accepted receipt
> unchanged.

> One wider contract gap remains outside the permitted Stage 1b surface: the broadcast queue wrapper
> discards the queue's durability bit, so an immediate crash can turn a successful broadcast response
> into silently lost queued work.

> The exact 14-file gate is green: 14 files, 926 tests. The two supplied edge suspicions also pass
> dedicated restart tests; the startup source guard places store opening at line 210 and listener
> creation at line 959. I'm doing the final no-index/diff hygiene check now.

## Findings, as reconstructed from the edits

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| F32 | P1, established (its word) | A hold ledger that would not open made the composition abandon a healthy receipt journal too, so acknowledged queued work vanished from restoration and from the receipt route | Fixed by the reviewer in `action-stores.ts`: the two stores share one claim, not one fate; receipts open, holds are memory-only and say so. Test in `fleet-action-stores.test.ts` |
| F33 | P1 (reconstructed) | A durable receipt whose `returned` failed to land stays `attempted` on disk while memory says `returned`; the next `attempted`, or a cancel's `withdrawn`, would then be an illegal transition read back after a restart — so a cancel answered 200 could come back `recovery-blocked` | Fixed in `receipt-journal.ts`: an unlanded return is tracked, and `attempted`/`withdrawn` first compact so the disk catches up, refusing if it cannot. Tests in `fleet-receipt-journal.test.ts` and `fleet-receipt-restart.test.ts` |
| F34 | P2 (reconstructed) | The receipt and queue item sequences could reach `Number.MAX_SAFE_INTEGER` and stop advancing — F31's shape, one step on | Fixed in `receipt-journal.ts` and `queue.ts`: the mint wraps, and the reservation check keeps a wrapped id from colliding |
| F35 | P1 (reconstructed) | `durable()` said true while a volatile non-terminal receipt or an unlanded return existed, so the page could be told `volatile: false` over work a restart would not restore | Fixed in `receipt-journal.ts` |
| F36 | P1, reasoned (its words, outside the stage) | `enqueueSharedMessage` returns only `{ok, position}`, so the broadcast's queued half answers *queued* even when the queue's receipt is not durable | **Not fixed — Stage 3**, where the broadcast is in scope. Added to its checklist |

Suspicions 1–3 of the prompt: all three checked and found safe, two with new restart tests.

## Verdict

Not delivered. Its last three messages report a green gate and name only the out-of-stage F36, which
is the shape of "land with the fixes above". The implementing session treats it as that, and the
attack items the run may not have reached are carried into Stage 2's review.
