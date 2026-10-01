The plan does not yet preserve the stated invariant. I found no P0s, but three P1s should be resolved before implementation.

1. **P1 — Verified affiliation text can silently consume a real author.**

   The proposed check is circular: the model classifies text as an affiliation, then that classification is used to prove the text is not a person ([plan lines 34–44](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/docs/plans/261001l-pdf-stacked-bylines.md:34)). `findAffiliation` only proves that the words occur somewhere on the page; it does not establish what those words mean ([pdf-authors.ts:199](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/src/pdf-authors.ts:199)).

   Concrete structured-list failure:

   ```text
   byline:
   Alice Adams Acme University alice@acme.edu
   Bob Brown Beta Institute bob@beta.edu
   Carol Clark

   answer:
   Alice Adams — ["Acme University", "Bob Brown Beta Institute"]
   Carol Clark — []
   ```

   Both proposed affiliations verify. The first affiliation, first email, second affiliation, and second email account for the entire gap. The stored list becomes Alice and Carol, silently dropping Bob.

   This is not necessarily “two mistakes at once” as [the plan claims](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/docs/plans/261001l-pdf-stacked-bylines.md:54): one boundary/segmentation mistake naturally produces both the merged “affiliation” and the omitted author.

   It also affects names-only output: give Carol an additional affiliation that does not verify. The same gap passes, the affiliation failure selects the names-only arm, and the clean byline still becomes `Alice Adams; Carol Clark`.

   There is an even narrower collision requiring no invented affiliation: if Alice genuinely has affiliation `DeepMind` and the byline also contains a corporate author named `DeepMind`, that verified string can account for the omitted corporate author. String equality is not provenance.

2. **P1 — The raw email-span rule is not safe or sufficiently specified.**

   A conventional email regex greedily accepts letters as part of the final domain label. With text-layer fusion such as:

   ```text
   Alice Adams alice@acme.eduDeepMind Carol Clark
   ```

   it can recognize `alice@acme.eduDeepMind` as one email and silently absorb the one-word corporate author `DeepMind`. A word boundary does not help because the greedy match ends at a valid boundary.

   The proposed test uses a space before `Po-Hsuan` ([pdf-authors.test.ts:172](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/tests/pdf-authors.test.ts:172)), so almost any regex passes it. The plan needs the exact grammar and adversarial fused-tail tests, including a one-word person, capitalization transitions, malformed braces, and punctuation immediately after the domain. On ambiguous fused tokens, refusal is the safe result.

3. **P1 — The eval can report perfect “no silent drop” while missing the known failure.**

   Removing an author object from the correct fixed answer ([plan lines 82–88](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/docs/plans/261001l-pdf-stacked-bylines.md:82)) also removes that author’s affiliations. It does not simulate the dangerous answer where the omitted author’s words remain misclassified under an earlier author.

   Add explicit adversarial negatives for:

   - A dropped middle and trailing author whose `name + affiliation` is assigned as an earlier author’s affiliation.
   - The same cases with an unrelated affiliation failure, exercising names-only output.
   - A truthful affiliation string identical to an omitted corporate/mononymous author.
   - Email spans fused directly to a one-word author.
   - First, middle, last, and adjacent multiple omissions.

   Fixed answers are useful for testing the checker, but the unsafe case depends on model segmentation behavior. Deferring all real-model evaluation ([plan line 107](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/docs/plans/261001l-pdf-stacked-bylines.md:107)) leaves that risk unmeasured. At least the stacked corpus should also be run through the actual authors pass before shipping.

4. **P2 — “Earlier authors” and “all authors” are the correct scopes, conditional on safe evidence.**

   Earlier authors, rather than only the immediately previous author, are necessary for row-major extraction:

   ```text
   A B C  Aff-A Aff-B Aff-C  Email-A Email-B Email-C  D
   ```

   The gap before D legitimately contains evidence belonging to A, B, and C. Likewise, after the final name, row-major layouts can contain affiliations for every author, so trailing accounting needs all matched authors.

   Implement these as multisets of concrete, non-overlapping permissions, not a reusable global set of affiliation strings. One verified proposal should not authorize unlimited identical occurrences. None of this resolves finding 1: the evidence must first be independently safe to classify.

5. **P2 — The existing glue rule already has a small silent-drop exception.**

   `BETWEEN_NAMES` accepts every single Unicode letter ([pdf-authors.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/src/pdf-authors.ts:97)). Therefore:

   ```text
   Alice Adams, J., Carol Clark
   ```

   can accept `[Alice Adams, Carol Clark]`, silently dropping an initials-only author `J.`. If “never” is literal, add this to the eval and narrow letter-marker handling to markers actually established from the surrounding affiliation notation.

6. **P2 — A simpler safe v1 should support a narrower layout.**

   There is no text-only rule that both accepts arbitrary affiliation/name sequences and guarantees that affiliation-shaped words are not people; names and institutions share the same character language.

   A simpler v1 is:

   - Close C4 immediately with conservative trailing refusal.
   - Support only explicit email-delimited stacked blocks, requiring the number and order of independently delimited mailbox identities to agree with the matched author blocks.
   - Refuse ambiguous fused email tails.
   - Defer row-major grids and shared/irregular blocks until there is independent layout evidence or a deliberately accepted weakening of the invariant.

   That covers the reported Lu-style `name → institution → email` shape without allowing arbitrary model-labelled affiliations to erase words. If row-major grids must ship now, the plan must explicitly relax the invariant and measure that trade-off; the current design cannot claim both.

**Verdict: revise before build**