# Changing the active version silently narrows validation of readable history

Caught in review on 2026-10-07, before this change was committed. The Fable-to-Opus candidate
made a malformed version-2 attention question readable; no production impact is established.
The change and its intended compatibility are in
[the plan](../plans/261007o-fable-to-opus-in-the-overseer.md).

## Root cause and introduction

[`parseAttentionMemory`](../../tools/overseer/attention-memory.ts) required a question's proposal
only when its recorded prompt version equalled `PROPOSAL_PROMPT_VERSION`. Bumping that constant
from 2 to 3 changed both which prompt was active and which historical records were validated.
The latter was unintended: version 2 remains readable, and its proposal requirement still applies.
The parser accepted a v2 question without a recipient as stale cache, allowing it to place a card
while waiting for reclassification. Staleness is not evidence that a malformed record is valid.

**Introducing change:** the currently uncommitted `PROPOSAL_PROMPT_VERSION` 2→3 candidate in this
worktree, not a landed commit. The existing equality guard was correct while 2 was active.
This is the class: **changing the active version silently narrows validation of readable history**.

## Evidence and fix

The new regression in
[overseer-attention-memory.test.ts](../../tests/overseer-attention-memory.test.ts) failed **1 of 42
tests** before the fix: the v2 record was accepted. It passes after the guard became
`(promptVersion === 2 || promptVersion === PROPOSAL_PROMPT_VERSION)`. Valid v2 records still
remain stale and are re-read; malformed v2 and v3 questions are refused.

The current fix is also the appropriate long-term fix for the two proposal versions: preserve
historical structural requirements independently of the active prompt. A future version bump
must preserve each readable version's invariant rather than merely move this equality check.

## Countermeasures, ranked by ease against value

1. **Test an old stored version independently of the current constant.** Done: the regression
   explicitly exercises version 2 and the current version, so a bump cannot move both cases together.
2. **Audit active-version comparisons at stored-data boundaries during a version bump.** Cheap;
   distinguish selecting new behavior from validating readable history. Typechecking cannot catch
   this because both comparisons remain legal TypeScript.
3. **Introduce a general versioned migration and validator registry.** Rejected here: two versions
   share one proposal shape, and an explicit guard plus the historical regression covers that
   boundary without another system.
