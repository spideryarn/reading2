**Verdict: ship with these fixes applied.** Fixes are uncommitted. The budgets and token sizes remain as reviewed.

- **C1 — P1; input: Illustrated starting in a fresh claim; reasoned; not fixed, wider scope.** Its brief’s full-token estimate is 948 s against a nominal 740 s claim, before up to four image calls. The 700 s reservation reduces late starts but cannot make the whole step fit. This remains a pre-existing risk.

- **C2 — P2; input: brief allowance temporarily raised 32,000→33,000 tokens; reproduced; fixed.** The original tripwire stayed green as the estimate worsened to 961 s. I separated the reservation guard from an exact `PINS AN OPEN DEFECT` witness, following the house convention. The new pin failed on that mutation; the mutation was removed.

- **C3 — P2; input: Opus, slow streams, provider waits or transport retries; reasoned; wording fixed, wider timing limitations unchanged.** `deadlineFor` is reasonable reuse for estimating one Sonnet attempt, including thinking tokens. It is not a time ceiling. Non-streaming still takes generation time, but Debate adds unbounded searches and whole-call retries. Its 360 s is honest only as an estimate with **unmeasured** 42 s slack. Comments and docs now say this.

- **C4 — P2; inputs: a 30 s Sketch and the reported 739.3 s Illustrated duration; reasoned; fixed.** A 30 s Sketch leaves 710 s, so Illustrated still starts in the same claim. “Every real Sketch” is now limited to the measured sample. Also, 739.3 s is step runtime—not proof of finishing inside a 740 s claim. Thresholds now refer to total elapsed claim time, including overhead.

- **C5 — P3; input: ordinary and manually composed jobs; reasoned; accepted, no budget fix needed.** Newly deferred starts are:

  | Next step | Total claim time already spent | Trade |
  |---|---:|---|
  | Ideas | >140 through 620 s | Right: the quoted Quotes sample adds no handoff; slower paths avoid starting Ideas late. |
  | Tweets | >140 through 650 s | Right: ordinary jobs start it first; only composed jobs change. |
  | Sketch | >40 through 500 s | Right: ordinary jobs start it first; only composed jobs change. |
  | Debate | >380 through 620 s | Right as a conservative estimate; ordinary jobs start it first. |
  | Illustrated | >40 through 140 s | Right: one extra claim is preferable to discarding and repeating a paid run. Slower chains already deferred. |

  Release spends **no retry window**. The browser immediately advances again; busy-capacity responses cause retries after 1 s, backing off to 8 s. Queue delay can be longer, but the measured sample does not establish its frequency.

- **C6 — P3; input: all five request builders; reasoned; no defect found.** Every moved token size is used by its production call site. Ideas uses the article’s body-word count, with `suggestedIdeas` capped at 10; threads cap at 15 posts. The four streamed calls use default 40,000-token thinking headroom. The resulting estimates—587, 561, 685 and 948 s—and Debate’s maximum three-call estimate of 318 s are correct.

Files changed: comments in [jobs.ts](/var/tmp/spideryarn-worktrees/sweep7-five-more-budgets/src/jobs.ts), `ideas.ts`, `tweets.ts`, `sketch.ts`, `illustrated.ts`; [jobs-lease-budget.test.ts](/var/tmp/spideryarn-worktrees/sweep7-five-more-budgets/tests/jobs-lease-budget.test.ts); plans `261007g`, `261007h`; and `docs/project/ingest-queue.md`.

Ran only the authorised Vitest pair and `git diff --check`. All five reservation cases failed with the old budgets restored temporarily. Final result: **37 tests passed**, diff check clean. No Postgres, full suite, commit or push. Production measurements were assessed as supplied, not independently queried.