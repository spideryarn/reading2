# Review: should a publication be gated on a tree it did not change?

You are reviewing a **design decision for a live production incident**, before it is built. Be
adversarial. I want the flaw, not encouragement. Repository: Spideryarn, a reading app; TypeScript,
Postgres via drizzle, one article = one row with a chain of immutable revisions.

## What happened

Today's deployed build added a new tree-shape invariant. In `src/tree-invariants.ts` (~line 352),
`checkTree` now fails a tree in which a non-leaf child covers exactly its parent's whole block range
("one rung finer restates the same blocks instead of compressing them").

`checkTree` is called by `reasonsNotToPublish` in `src/store/pg-revisions.ts` (~line 1364), which is
called by `publishRevisionIn` (~line 1629) on **every** publication.

Every reader-facing AI feature — glossary, quotes, ideas, debate, timeline, diagram — runs as a *job
step*. A step begins a draft revision (`beginDraftIn`, ~line 823, which **copies the base revision's
blocks and tree forward verbatim**), does its paid model call, writes its own artefact into the
draft, and publishes. None of those steps touches the tree.

So: an article whose **already-published** tree has a restated rung can no longer publish anything at
all. Observed in production on one article — four consecutive failures across two different steps
over thirteen minutes, each having completed and paid for its model call first (one of them $0.2454),
each reported to the reader as *"trying again is worth a go"*, which is false: the failure is
deterministic and permanent.

Measured on the local database: 2 bad rungs across 38 articles with a published tree (9,720 nodes
scanned). Roughly one article in twenty. The production article is a third instance.

The producer was fixed in the same commit — `buildTree` now splices this shape away
(`collapseRestatedRungs` in `src/hierarchy.ts`). **Already-stored trees were not migrated.**

## The proposed fix

> A publication is gated on the tree it **changes**, not on the tree it merely **carries forward**.

Concretely: in `reasonsNotToPublish` (or its caller), if the draft's tree is identical to the tree the
article is currently serving, then tree-shape problems are pre-existing — already in front of readers
either way — and must not refuse the publication. Log them; do not fail. Any publication that builds
or alters a tree stays fully gated, which is where the gate was aimed. Re-running the `hierarchy`
step still repairs the article, because `buildTree` now splices the shape away.

Claimed benefit: fixes the **class**, not the instance. The next invariant anyone tightens will not
retroactively wedge every article that violates it.

## What I want from you

1. **Attack the reframing.** Is "already in front of readers either way" actually true for every
   invariant `checkTree` enforces? `reasonsNotToPublish` also checks: no blocks, no tree, the
   `hierarchy` step run's status, and `hierarchy.input_hash !== hashBlocks(blocks)`. Should the
   carry-forward exemption cover **all** of them, only the `checkTree` problems, or a named subset?
   Name the check where the exemption would be dangerous, if there is one.

2. **Attack the comparison.** "Identical to the tree the article is currently serving" — how should
   that be established, cheaply and without a false negative? A deep JSON equality needs the current
   revision's tree loaded inside the publish transaction (the projection currently loads only the
   draft's). Is there a cheaper identity that is not weaker — and specifically, is *"this draft was
   copied from the current revision and no step that writes the tree has run in it"* a better test
   than comparing the trees, or a worse one? Consider that `basedOnRevisionId === currentRevisionId`
   is **already** proven immediately above, under the article lock.

3. **The alternatives I rejected — tell me if I rejected the right ones.**
   - *Splice the bad rung at publish time* (reuse `collapseRestatedRungs`). Rejected: publication
     must not silently rewrite content, and this file is not the tree's owner.
   - *Cascade `hierarchy` automatically when the base tree is invalid.* Rejected as bigger: needs a
     failure kind on `PublishRefused` plus a cascade rule, and it re-runs an expensive stage as a
     side effect of pressing "glossary".
   - *A one-off backfill.* Rejected as not fixing the class — though it may still be worth doing.
   - *Never add retroactive invariants.* Rejected: detection is worth having; the fault is that the
     only consequence of detection is a hard refusal.

4. **The two follow-ups.** (a) The reader is told to retry a permanent failure. (b) The model call is
   paid for **before** the gate is consulted. Rank these against the main fix — is either of them
   actually the *more* important change, and is (b) fixable at all without pre-flighting the gate?

5. **What would you have caught at review time** that would have stopped `c8e2cc7e` shipping a
   retroactive invariant with no migration? A test? A convention? Name the cheapest one.

Answer in prose. Lead with the single most serious problem with the proposal. If you think the
proposal is right, say so plainly and spend your effort on question 2, which is where I am least sure.
