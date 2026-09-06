The serious flaw is that the proposal compares only the tree, while `checkTree` validates the `(blocks, tree)` pair. As currently drafted, it can publish a newly invalid revision.

A concrete counterexample: copy a valid revision, leave its tree unchanged, then change one draft block’s `gistable` from `true` to `false`. Its labelled leaf now violates `checkTree`, but `hashBlocks` does not include `gistable`, so the hierarchy hash still matches. Tree equality exempts the new `checkTree` failure and the revision publishes. The current proposed tests do not cover this case.

The core policy is right, but the exemption must mean “the complete input to this validation is unchanged,” not merely “the tree JSON is unchanged.”

1. Scope of the exemption

If both blocks and tree are exactly equal to the current revision’s, then “already in front of readers either way” is true for every hard problem returned by [`checkTree`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/tree-invariants.ts:149). It is a deterministic function of those two inputs. I would therefore grandfather all `checkTree.problems`, rather than naming only the restated-rung rule; that genuinely fixes the class.

Do not extend that exemption to every reason in `reasonsNotToPublish`:

- No blocks and no tree remain unconditional refusals. They are fundamental readability requirements, not newly tightened shape rules.
- A missing hierarchy run remains a refusal.
- A hierarchy run whose status is `running` or `error` absolutely remains a refusal. This is the clearest dangerous check: a hierarchy attempt can fail while leaving the copied tree byte-for-byte unchanged. Exempting it would publish the residue of a failed tree-owning operation.
- The hierarchy input-hash check remains unconditional. In particular, tree equality says nothing about whether blocks changed; that is exactly the divergence this check exists to stop.

So the named subset should be only `checkTree` problems, conditional on exact equality of the complete `(blocks, tree)` pair.

There is one conceptual caveat: a newly generated feature may have consumed that malformed tree, so the feature itself is new even though the tree is not. That is properly a step-input or step-output validity concern, preferably checked before its model call—not a reason to wedge every unrelated publication after the call.

2. Establishing identity

The existing `basedOnRevisionId === currentRevisionId` check proves which revision was copied. It does not prove that the copied artefacts remained untouched afterwards.

For the tree, the database-side comparison in the current draft is the right mechanism:

```sql
draft.tree IS NOT DISTINCT FROM base.tree
```

It transfers one boolean, not two trees, and JSONB equality avoids false negatives from object-key ordering or whitespace. Call it normalized semantic equality, though—not “byte-for-byte” equality.

But the query must also compare the block rows exactly. Do that server-side in the same query, with symmetric `EXCEPT` over `ordinal` and every carried block column except revision identity/generated `fts`. There are only hundreds of rows per article, and the result remains one boolean. Reusing the exhaustive carried-column inventory would also make a new block column fail visibly rather than silently weakening the comparison.

Do not substitute the existing hashes:

- `hashBlocks` omits fields that `checkTree` reads, notably `gistable` and `kind`.
- [`structureHash`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/source-hash.ts:197) omits `rootId`, child ordering, depth, `navLabel`, `sourceHeading`, `provisional`, and other fields; several affect validation.
- Hashes also remain theoretically weaker than exact equality.

“No tree-writing step ran” is worse as a state-identity test. It is an audit-history proxy: it can miss a write outside that protocol, and it calls a deterministic rebuild that reproduces the identical tree “changed.” Existing step-run rows are copied forward and were not designed as immutable artefact-provenance markers.

There is also a contradiction in the proposed wording:

- Exact equality implements “a publication that alters the tree is gated.”
- It does not implement “a publication that builds the tree is gated,” because a hierarchy run can rebuild the identical value.

If “builds” genuinely matters, add an explicit `tree_written_in_this_revision`/origin marker maintained transactionally by the sole tree-writing seam, and require both exact input equality and “not written here.” Otherwise drop “builds” from the claim and make the policy explicitly state-based.

Two tests are missing from the current draft:

- Valid current tree; draft changes only `gistable`; tree remains identical; publication must be refused.
- Invalid current tree; hierarchy is recorded as having run and reproduces the identical invalid tree; decide explicitly whether this is exempt. That test forces the “builds versus alters” decision.

One further defect in the draft: it logs “publishing over…” inside the transaction, before the hierarchy provenance checks and before later job/billing settlement can roll the transaction back. Return grandfathered problems as publication warnings and log them only after commit, alongside the existing publication log.

3. Rejected alternatives

You rejected the right ones.

Publish-time splicing is wrong. Besides violating stage ownership, it would change the tree after feature artefacts were generated against it, invalidating their fingerprints and possibly their node/range relationships while leaving the hierarchy run’s provenance describing something else.

Automatic hierarchy cascading is too large and too surprising for incident containment. It must also cascade every tree consumer; otherwise repairing the tree can strand or stale arc and other derived artefacts. An explicit “repair hierarchy” action could be useful later, but pressing Glossary should not secretly buy and publish a new hierarchy.

A backfill is not the class fix, but it is worth doing after the gate fix. It removes the duplicated reader experience and stops repeated warnings. Prefer an explicit maintenance revision or hierarchy rerun over mutating an allegedly immutable published revision in place.

“Never add retroactive invariants” is the wrong lesson. New invariants should become producer postconditions immediately; existing stored data needs either migration, grandfathering, or an explicit health-warning path.

4. Follow-ups

Priority order:

1. Correct the main exemption to compare the complete validation input.
2. Classify permanent publication refusals correctly.
3. Add preflight validation before paid work.

Neither follow-up is more important than restoring publication availability.

The retry message is the more urgent follow-up because it actively instructs the reader to repeat a deterministic expense. Do not mark every `PublishRefused` non-retryable, though: an exact-base conflict can be repaired by starting again. `PublishRefused` needs structured reason codes or kinds so tree-invalid/missing-prerequisite failures are `bug`, while a moved-base conflict can remain retryable.

The spent first call cannot be prevented without some form of preflight. Caching or retaining the generated artefact can reduce the cost of a subsequent attempt, but the provider has already been paid. Run a cheap, advisory preflight over inherited publication prerequisites after opening the draft and before the model call, while retaining the authoritative gate inside the final transaction. It cannot replace the final gate because the current revision can move while the model is running, and it must know the planned write set so an invalid inherited tree does not prevent a hierarchy step whose purpose is to repair it.

5. Cheapest review-time catch

The cheapest catch was one integration test:

> Publish an unrelated draft copied from a currently served revision whose tree violates the newly added invariant.

That test would have failed as soon as `c8e2cc7e` connected the new rule to the existing publication gate. The corresponding convention is: every new hard invariant over durable stored data must ship with either a migration or a grandfathered-current-revision test.

The carry-forward test now in [`store-publish-guards.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/tests/store-publish-guards.test.ts:330) is the right regression for the original incident. Add the block-only mutation test before accepting the proposed implementation; without it, the fix opens a real laundering path.