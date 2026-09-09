## Verdict

**Not fit to build.**

The revision genuinely fixes P1-1, P1-3, and P1-5, and substantially improves the rest. But P0-1 rests on a false source reading, and the completeness contract still has unrepresented silences.

## Finding-by-finding

| Finding | Round-two result |
|---|---|
| P0-1 join identity | **Not fixed; blocking.** `AttentionItem.id` is not `dialogFingerprint`. |
| P0-2 prose safety | **Partly fixed.** Draft targeting needs more definition; residual risk is understated; the local status check buys essentially nothing as specified. |
| P0-3 empty list | **Shape fixed, causes incomplete; blocking.** |
| P1-1 impossible dialog text/rewrite | **Fixed.** |
| P1-2 invalid Cartesian product | **Improved, not fully fixed.** The proposed arms still contain contradictions and missing states. |
| P1-3 permission dialogs | **Fixed.** |
| P1-4 duplicates | **Visibility fixed, reconciliation not yet fixed.** Per-member observation identity is still absent. |
| P1-5 queue pointer | **Fixed.** |
| P2-1 payload duplication | **Direction fixed.** Reference-only reconciliation is achievable, but needs an explicit contract. |
| P2-2 tests | **Much improved, but several cannot be written at the stated boundary.** |

### P0-1: the join argument is unsound

The plan says `AttentionItem.id` is `group.key` is `dialogFingerprint(q)` ([plan](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md:237)). Only the first equality is true.

The actual path is:

- `dialogFingerprint(q)` is attached to temporary classification material and used as the classifier cache key ([attention-pass.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/overseer/attention-pass.ts:169)).
- It is then discarded when `AttentionObservation` is built. The observation carries the classifier’s `topic`, or the prompt as fallback, but no fingerprint ([attention-pass.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/overseer/attention-pass.ts:250)).
- `group.key` is produced by `attentionQuestionKey`: SHA-256 over the evidence kind and normalized `topic` ([attention.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/overseer/attention.ts:113)).
- `AttentionItem.id` is that group key ([attention.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/overseer/attention.ts:269)).

Therefore:

- For classified dialogs, an input to the ID—the model-produced canonical `topic`—is unavailable in `tools/fleet/`.
- For fallback dialogs, the ID is still a topic/prompt hash, not `dialogFingerprint`.
- For prose, the ID is also a model-topic hash, not the tail fingerprint.
- The no-material fingerprint is re-derivable from prompt and labels, but it still is not the value in `AttentionItem.id`.

There is a second problem: even the private `dialogFingerprint` is weaker than `sameQuestion`. With readable material it hashes only `material.fingerprint`; with no material it uses prompt and labels. It omits option consequences and keys, while `sameQuestion` compares prompt, material, every label, consequence, and key ([steer.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/steer.ts:1399)). This permits false matches, not merely safe mismatches. The “drift fails safe” argument therefore does not hold.

The smallest repair is to preserve the semantic group ID, but add a separate producer-published observation identity for the primary and every duplicate, computed by one shared pure function over exactly `sameQuestion`’s fields. An unreadable material must not produce a matchable identity.

### P0-3: the three-arm outer union is sufficient, but the gaps are not

`complete | partial | not-observed`, with a non-empty `partial.gaps`, is the right outer shape. The enumerated causes are incomplete.

These silences still need homes:

- `AttentionFeed.kind === "not-asked"`.
- A published attention list with `sessionsUnreadable > 0`. This can be non-empty, so `list === unknown` does not cover it.
- An absent `questions` field from an older server, distinct from a present-but-unreadable field.
- `error !== null` after the latest fleet collection failed. The server deliberately retains the previous snapshot, which can still be younger than the normal stale threshold ([server.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/server.ts:487)).
- A `needs-you` row whose pane capture or question parse failed. `readPanes` leaves the row present but its question unavailable, so this is not “rows dropped” ([collect.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/collect.ts:478)).
- A reconciliation reference whose source row or attention item cannot be resolved after browser parsing. A malformed question can become `question: null` without dropping the row ([types.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/web/src/types.ts:1284)).

The planned composer signature cannot currently establish all its promised conditions: `composeQuestions(rows, attentionFeed, collectedAt)` has neither the collection `error`, attempt/freshness information, nor browser-only `unreadableRows` ([plan](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md:577)). The browser must perform a final completeness downgrade after parsing.

### P1-3: the predicate is correct

Yes: admit a row-only dialog only when `question.gate.kind === "conversation"`.

`grantsPermission` is exactly `gate.kind !== "conversation"` ([pane.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/pane.ts:212)), so it excludes both `permission` and `unknown`. `classifyGate` positively earns `conversation`; missing material and unrecognized dialogs become `unknown` ([pane.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/pane.ts:276)).

A malformed gate is a browser-boundary test: the client parser converts it to `unknown`. It is not a meaningful fixture for the typed server composer.

## The overruled prose finding

The residual risk is worse than the plan states.

It is not limited to “replying to nobody” and losing one answer. A stale or misclassified card sends a real authoritative Greg message to a live agent. The agent may interpret it as a product decision or instruction and act on it. This does not directly grant a permission-dialog capability, but its effects are not bounded to one harmless turn.

The ordinary stale case is also missing: prose A may have been replaced by prose B while the row remains `idle`. The server checks that the destination is live and currently has an empty input, but not that the displayed tail still exists ([steer.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/steer.ts:1312)).

The draft key also remains underspecified:

- The actual prose-question identity is not currently published.
- “Session identity” must include the steer/execution identity—pane, pane PID and Claude conversation—not merely the tmux session ID.
- The revision dropped the round-one requirement for execution identity.

On the local status refusal: **as written, it is security theatre.** The reconciliation and row status come from the same payload, so comparing the row against the status that reconciliation was just composed from is tautological. If instead the component freezes the status when the draft begins and compares it with later payloads, it catches one narrow case: an observed status change that remains changed. It still misses same-status tail changes, changes between polls, and leave-then-return transitions. Keep it only as a small stale-draft UX guard, not as mitigation for P0-2.

## New union and reconciliation issues

The five arms are not yet a settled type; they are names plus prose, and the prose exposes several problems:

- `attention-prose` claims the row is at an empty input box, but `FleetRow` does not carry `PaneSurface`. Only the send-time capture can establish that.
- `matched-dialog` is called clickable, then is said to allow unreadable material and no buttons ([plan](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md:283)). Those are two capabilities inside one arm.
- In normal producer output, unreadable material cannot be a conversation dialog: `classifyGate` makes it `unknown`, and the attention producer excludes it. A malformed client-side material should become a reconciliation gap, not an ordinary matched item.
- An inbox dialog plus a present row that now has no question does not cleanly fit either “both sides have something” or “without row”.
- An attention item can have a row but no steerable execution identity. The action-bearing arms do not represent this refusal.
- Duplicate rows require per-member observation identities. Otherwise a duplicate whose dialog changed may either become a second row-only card or be suppressed as if it still matched.

“Publish a reconciliation, not a copy” is achievable. Publish source IDs and relation decisions, then resolve question text, options and material from the existing `attention` and `rows` fields. But the browser must validate every reference and downgrade dangling or differently parsed references to a gap. The current statement that an arm “carries material” conflicts with the reference-only promise and should be replaced by an explicit TypeScript shape.

## Stage 1 tests

The existing pane fixtures are adequate for conversation, permission, unknown gates, differing material, and no-material dialogs. I ran the four relevant current suites: 156 tests passed.

The revised test list is not fully implementable as written:

- `dialogFingerprint` is private, so the proposed import cannot compile—and testing it against `AttentionItem.id` would expose that they are different values.
- A malformed gate belongs in the client parser test, not the typed server composer test.
- A row cannot contain a prose observation, so “prose against dialog, and the reverse” needs rewriting as “attention prose versus row dialog” and “attention dialog versus row with no observed dialog”.
- A real unreadable-material dialog is classified `unknown` and excluded, so constructing a clickable matched version by hand would test an impossible producer state.
- The gaps cannot all be tested until the missing causes and the browser-side downgrade are specified.

## Smallest path to buildability

Keep the stage boundaries, but revise Stage 1 once more:

1. Add a producer-published, per-session observation identity matching `sameQuestion`; retain `AttentionItem.id` solely as the semantic group ID.
2. Write the actual five-or-more-arm TypeScript union, removing the invented “empty input observed” state and naming unmatched-present-row and unaddressable cases.
3. Complete the gap vocabulary and make browser parsing/resolution the final authority on `complete`.
4. Route each test to the boundary where that state can really occur.

No `steer.ts` write-path change is required for those corrections.