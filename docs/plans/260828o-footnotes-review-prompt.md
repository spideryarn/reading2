# Review the footnotes plan

Read `/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828o-footnotes.md` — the full plan for
footnote and bibliography support. Nothing is built yet; this is a plan review, before implementation.

You reviewed the design question at the sketch stage; your answer is in
`docs/plans/260828o-footnotes-sol.md` and the prompt that produced it is `docs/plans/260828o-footnotes-prompt.md`.
The plan takes most of your advice. **Do not simply re-endorse it.** Two things have changed since
you wrote that answer, and they are what I most want you to check:

1. **The measurements are in.** The fixture survival was measured, not assumed, by running the real
   `runExtract` and `splitIntoBlocks` over the eval fixtures. See the tables in the plan. Some of
   your v1 caution may now be miscalibrated in either direction — say so if it is.
2. **A second reviewer (Fable) shaped the presentation half** — the supplement node's dress, the
   spine dimming, the arc step marker, the tooltip wording, and a two-way validator exception. Judge
   that work as critically as mine.

Read the code, not just the plan. The files that matter: `src/blocks.ts`, `src/types.ts`,
`src/toc.ts`, `src/tree-invariants.ts`, `src/validate-tree.ts`, `src/labels.ts`,
`src/library-scalars.ts`, `src/web/stats.ts`, `src/article-prompt.ts`, `src/library-search.ts`,
`src/chat-tools.ts`, `src/article-vectors.ts`, `src/sanitize-policy.ts`, `src/pdf-read.ts`,
`src/pdf.ts`, `src/web/internal-links.ts`, `src/web/tree.ts`, `src/store/*.ts`,
`evals/extraction/fixtures/verify.mts`.

## What I want

**Attack the plan's specific claims.** Every factual claim in it was checked against the code by me
or by a subagent, but check the ones that carry the most weight:

- That the marker→note chain already resolves correctly end-to-end for Gwern (34/34) and Wikipedia
  (170/170), so stage 4 is mostly dress. If that is wrong, the staging is wrong.
- That `role` on `Block` plus four named predicates is the right replacement for the `gistable`
  overload, and that the four predicates named are the right four — is there a fifth consumer that
  will be missed, and is any one of them wrong about notes?
- The supplement-node design against the tree invariants, including the two-way validator exception
  and the "build the body tree first, append the supplement after" ordering. Does that ordering
  actually hold given how `buildTree` and the gist-composition pass work?
- The stable-id renumbering fix. Is "carry-over key ignores marker digits and leading note numbers"
  sufficient, or does it break id carry-over for something legitimate?
- The five stages. Is each one really independently shippable — tests green, tree safe to commit? Is
  any stage hiding a dependency on a later one?

**Then the questions the plan does not answer:**

- Is `role: "footnote" | "reference"` the right closed set, given Fable's argument that
  Acknowledgments, image credits and Appendices also want this treatment, and that an Appendix can
  be real prose worth gisting? Should `role` be open, or should there be a separate axis?
- The Tufte finding — sidenote text arriving as unmarked body prose because our own sanitiser
  deletes `<label>`/`<input>`. The plan proposes recognising the shape before the sanitiser runs, as
  `stampAuthorAnchors` already does. Is that safe, or does reading pre-sanitiser structure and
  acting on it post-sanitise open something? Be specific about the security implication.
- The PDF bibliography gate. The plan says this is Greg's decision: either re-evaluate the gate, or
  show the bibliography with its incompleteness visible. Is there a third option?
- What is the plan still assuming that the measurements did not test?

**Finally, the failure mode.** The plan has a list of "tests that have to be able to fail". Is it the
right list? Name anything on it that is theatre, and anything missing that would let this ship
looking like it works while doing nothing.

Be concrete, cite files and lines, and disagree where you disagree — I would rather have the
objection than the endorsement.
