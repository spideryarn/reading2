# A builder's guarantee can disappear when the next stage appends children

A review reproduced a structure-step regression before release. A valid model answer with a root and no proposed children produced body leaves directly under the root. Appending trailing notes made that root hold body leaves beside an internal supplement node. The tree passed the structural invariants, but the new labels preflight failed, withholding an article that the preceding commit would have published. No reader incident was established.

## The class: a local invariant mistaken for a composed invariant

`buildTree` guarantees that a node has either grown leaves or proposed internal children. `planBatches` used that local guarantee as though it held after `appendSupplement`, a later transformation that adds internal nodes beside existing children. `checkTree` guarantees ranges and coverage, but does not guarantee homogeneous child kinds. All three functions were correct against different contracts; the orchestration relied on a fourth contract that none of them maintained.

A real starts-only model answer `{ "root": { "title": "The piece", "gist": "The piece makes a claim.", "question": "What follows?", "children": [] } }` parses and builds. With one to four ordinary paragraphs followed by a footnote, `assertTreeSound` reports no problem. The planner then reports `planBatches left N of N gistable block(s) out of every batch`. The same failure is reachable on long bodies. A fallback that catches that error and always invokes the bounded builder would introduce another failure for one-to-three-block bodies: its four-block minimum is real.

The planner's assumption entered in `051bc0a0156c2bbd6a4751b6b6ce4367e775c467` (the labels split). The supplement append was added by `7b6b30fe204d1a7cf5195b3cf6d199fc5c6acda2`. This review's candidate, `e9abf4aa6836d8d53b4f9bdf4187fe9f27bd3324`, introduced the structure-step regression by making the planner run before publication. Previously this shape failed at labels while leaving the article readable.

## Why existing checks agreed

Builder tests used homogeneous body trees. Supplement tests checked structural soundness. Labels tests rejected artificial mixed children, reinforcing the assumption that the builder could never create them. The missing test composed the real parser, builder, supplement append, structural gate and labels planner over an answer with no proposed children. Typechecking cannot express the child-kind guarantee carried in that composition.

## The fix

Exclude supplement nodes from the labels traversal and from the child list used to decide whether a body sibling set is all leaves. Supplements contain no structural blocks and must contribute no labels call. With those branches omitted, the builder's body-only guarantee becomes valid again. The short model tree can remain a model tree, and an oversized body sibling set becomes a planned call that the existing size gate can replace with the bounded tree.

Generic support for mixed body children is unnecessary here. It would introduce questions about noncontiguous sibling sets and batch order that current body builders do not need. Catching every planner exception into the bounded path is also weaker: it conceals unrelated planner bugs and still needs special handling below four blocks.

## Countermeasures ranked by ease against value

1. Add composition tests using real parser/build/append/planner functions for one, two, three and four body blocks plus a supplement, and a large body whose labels request must use the bounded fallback. Small cost; covers the actual producer boundary and both size regimes. These tests were watched failing before the fix and now pass, including checkpoint resumption and several supplement groups.
2. State the labels traversal domain in executable code: apparatus branches are excluded before testing child shape. Small cost; makes a guarantee explicit at the consumer boundary instead of relying on another function's local promise.
3. A type-level homogeneous-child tree representation is rejected for this stage. The published tree deliberately represents both body and apparatus, and imposing a second representation would require conversion at every consumer for little additional protection.

Up: [Postmortems](../project/postmortems.md). Review: [stage D findings](../plans/261005a-long-documents-stage-d-review-sol.md).
