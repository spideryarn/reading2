# Plan review: 260930f cross-reference links (read-only)

You are reviewing a PLAN, before anything is built, in the repo at the current working directory
(a git worktree of Spideryarn, an AI-assisted reading app). Do not change any file.

**Candidate**: commit `f25496a0`, file
`docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md`. Read it in
full. Greg's request is quoted at its top; only his sentences express intent.

**Background to read, as needed** (not a limit on scope): `AGENTS.md`; `docs/project/block-ids.md`
(the contract: text is addressed by block id only); `docs/project/mode.md` § The artefact;
`src/ideas.ts` (the template: `validateOccurrences`, `buildIdeas`, `generateIdeas`);
`src/referee-claims.ts` (`validateClaims`, the "spaced" match); `src/web/annotate.ts` (`annotateHtml`,
the `cite` kind and `citeMarks`); `src/web/TableView.tsx` (the `proseHtml` memo and the delegated
`onClick`/`onMouseUp`); `src/web/BlockLinkCard.tsx`; `src/web/ProseHoverCard.tsx`;
`src/sanitize-policy.ts` (`FORBID_ATTR`); `src/web/auto-modes.ts`; `src/rerun-steps.ts`;
`src/pipeline.ts` (`STEPS.ideas`); `docs/plans/260928b-*.md`; `docs/plans/260930c-*.md`.

## What to do

An independent attack on the plan first. For each problem: does the design do what Greg asked?
Will it work against the real code? The plan names files and functions, so check that they exist
and behave the way the plan assumes. Is there a simpler v1 that gets most of the value? Is anything
missing from the checklist of places a new step must be registered? Are the cost estimate and the
security consequences right, given that the article HTML is untrusted and a visitor can read it?

Verdict: **build as planned** / **build with changes** (list them) / **rethink** (say what
instead).

Severity, graded by consequence:
P0 data loss, exploitable security, incorrect charging, or the service broadly unusable ·
P1 user-visible wrong behaviour, or an authoritative contract violated ·
P2 design or maintainability risk with no wrong behaviour today ·
P3 prose defect.

Give every finding an ID (F1, F2…), a severity, the evidence (file:line), and the fix you would make.

## My own suspicions (already mine, and worth less: spend most of the run elsewhere)

- Whether `BlockLinkCard`'s delegated listener really picks up a `<mark data-block-link>` inside
  the prose, and whether it conflicts with `ProseHoverCard`'s own delegated card on the same
  element.
- Whether `tabindex`/`role="link"` on a mark produced by `annotateHtml` is sound, given marks are
  split at every boundary (one phrase can become several `<mark>` pieces).
- Whether the `why` line in front of a reader should instead be dropped for v1 (Greg asked for a
  preview of the target, not an explanation).
