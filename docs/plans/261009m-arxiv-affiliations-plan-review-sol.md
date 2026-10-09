Verdict: **revise before build**. No P0s; two P1 integrity gaps defeat the stated “held to the page” guarantee.

1. **P1 — affiliations are verified page-wide, not against the author whose creator record contains them.**

   [`titleBlockRecords`](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/src/arxiv-affiliations.ts:39) puts every creator on page 1, while [`affiliationsFor`](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/src/pdf-authors.ts:504) accepts the first matching span anywhere on any page. The exact-name check at [src/arxiv-affiliations.ts:62](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/src/arxiv-affiliations.ts:62) does not bind affiliations to those names.

   I reproduced this with the Attention fixture: assigning `Google Research` to Ashish Vaswani and `Google Brain` to Noam Shazeer passed and returned both wrong associations.

   The PDF path has the same general page-wide limitation, though markers sometimes provide extra evidence. Here the HTML gives stronger evidence—one creator element per author—and the plan discards it.

   After the global check, re-verify each returned author against only `block.creators[i]`, or otherwise preserve the creator record ID through verification. Add a test swapping two real, printed affiliations; it must refuse.

2. **P1 — deleting `.ltx_contact_name` breaks the consecutive-page-words guarantee and can manufacture text the page never printed.**

   The claim at [plan:44](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/docs/plans/261009m-arxiv-html-affiliations-by-the-authors-pass.md:44) is false for a positional verifier. Removing words creates new adjacency. The implementation also removes every matching element without checking its text or structure at [src/latexml.ts:901](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/src/latexml.ts:901).

   I reproduced a creator printing:

   ```text
   Alice Doe Affiliation:DepartmentAffiliation:University
   ```

   After label deletion its evidence became `Alice Doe DepartmentUniversity`, and the verifier accepted and stored `DepartmentUniversity`—a word the page did not print.

   There is already stricter machinery: the known-label allowlist at [src/latexml.ts:1023](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/src/latexml.ts:1023) and structural validation in [`contactLines`](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/src/latexml.ts:1223). Reuse that rather than raw selector deletion.

   The simplest safe version is to keep contact boundaries and accept separate affiliations or a conservative refusal. If joining split contacts is required, define and validate that projection explicitly; do not obtain it by deleting arbitrary intervening text. Add adjacent-label, unknown-label, and no-whitespace tests.

3. **P2 — equality of names does not prove the list came from the title-block fallback.**

   The plan’s gate at [plan:49](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/docs/plans/261009m-arxiv-html-affiliations-by-the-authors-pass.md:49) cannot guarantee its following claim that a `citation_author` page is never asked. [`metaAuthors`](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/src/meta-authors.ts:48) chooses citation metadata first and the title block only as a fallback, but identical citation names with no affiliations are observationally identical afterward.

   Carry explicit provenance such as `authorsSource: "citation" | "dc" | "latexml"` or test for author metadata before losing that fact. The citation test must use the exact same names and order as the title block; a shorter or different list does not test this edge.

4. **P2 — the stage tests need the adversarial and call-placement cases, not only ordinary model mistakes.**

   Add tests for:

   - a wrong-but-printed affiliation assigned to another author;
   - an affiliation assembled across deleted labels;
   - exact matching `citation_author` names causing zero calls;
   - an ordinary reader exception degrading to names only;
   - a rejected/too-short article causing zero calls;
   - a prose-retention fallback causing exactly one call.

   That final case matters because [`readArticle`](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/src/extract.ts:442) may execute `readingArm` twice. Only evidence extraction belongs there; invoke the paid reader once in `runExtract`, after challenge/Readability/length refusal checks.

The remaining operational design is sound: the system prompt fences records as untrusted data, abort propagation can follow the reviewed PDF wrapper, fixed refusal reasons/counts can be logged without prose, and `openRouterAuthorsReader` inside `runStep` will automatically attribute the gateway call to the article’s `extract` step. The exact-name equality check is sufficient for name splitting/order once affiliation ownership is checked separately.