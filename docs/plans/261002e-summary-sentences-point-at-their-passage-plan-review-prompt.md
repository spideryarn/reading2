# Plan review: summary sentences point at their passage (261002e)

You are reviewing a **plan**, read-only, before anything is built. Repo: this worktree.

Candidate: `docs/plans/261002e-summary-sentences-point-at-their-passage.md` (untracked, live pre-commit;
base is HEAD of this worktree). Nothing else has changed yet.

Start with these files (they do not limit scope):
- `src/simple-summary.ts` (the writer, prompt, schema, validation `toParagraphs`/`buildLevel`, `ANSWER_TOKENS`)
- `src/simple-check.ts` (the fidelity guard; reads paragraph text + ids)
- `src/types.ts` (`SimpleParagraph`, `SimpleSummary`, `isUsableSimpleSummary`, `SIMPLE_ARTIFACT_VERSION`)
- `src/public-types.ts`, `src/public/dto.ts` (visitor payload)
- `src/pipeline.ts` (`ARTICLE_OUTPUT_FORMAT`), `src/messages-structured-output.ts`
- `src/web/SimplePanel.tsx`, `src/web/BlockRef.tsx`, `src/web/BlockLinkCard.tsx`,
  `src/web/OnScreenLinksStyle.tsx`, `src/web/on-screen.ts`, `src/web/styles/summary.css`
- `docs/project/summaries.md`, `docs/project/prompting-guide.md`, `docs/project/tooltips.md`

The request (an admin's, so the product goal is decided) is quoted at the top of the plan. Your job:
is this the right *way* to deliver it, simplest that gives Greg what he asked, and what will break.

Attack, independently first:
1. Is the chosen data design (model emits sentences each with a nullable id constrained to its
   paragraph's ids; `text` derived by join; additive optional `sentences` field; no SIMPLE_VERSION bump;
   prompt version bump) sound? Anything reading stored rows or `text` that would break, any place
   where an optional field is rejected or stripped (validators, DB, public DTO, export, Dock, voucher
   emails, simple-check)?
2. Is reusing `BlockRef` with the sentence as children (to get the card, the jump, and 8K's on-screen
   CSS) actually going to work — card content, the section-head subtraction, keyboard focus, styling
   overrides, the `.mode-band` scoping, missing-block case, a11y?
3. Structured-output schema rules (nullable required field, OpenAI subset, cache key test).
4. Is the measurement stage proportionate and sufficient? Should a blind judge be required?
5. Is there a materially simpler design that gets Greg the same thing?

Severity: P0 data loss/security/charging/broadly unusable; P1 user-visible wrong behaviour or
authoritative contract violated; P2 design/maintainability risk; P3 prose. Give every finding an ID
(F1, F2…), severity, file:line evidence, and a concrete fix. End with a one-line verdict.

## My own suspicions (worth less; spend most of the run elsewhere)
- Whether `isUsableSimpleSummary` or a pg reader rejects unknown keys.
- Whether a sentence-length BlockRef inside `.simple-text` breaks the card's placement (top of a
  multi-line inline element).
- Whether the join-with-space derivation changes the guard's or word-count behaviour.
