# Code review, stage 2: 260930f cross-reference links (the xref mark in the prose)

Repo: the current working directory, a git worktree of Spideryarn. You may edit files (see "Fixes").

## Candidate

**A. Stage 2**, the main subject: commits `9d615800` and `8ee4c5d5`.
- The diff is `git diff 97c5c3c0 8ee4c5d5 -- . ':!src/crossrefs.ts' ':!src/pipeline.ts' ':!src/store' ':!src/db' ':!tests/crossrefs.test.ts'`.
- The changed paths are `git show --stat 9d615800 8ee4c5d5`.
- Start with:
  - `src/web/xref.ts`
  - `src/web/annotate.ts` (`xrefMarks`, the `"xref"` kind)
  - `src/web/TableView.tsx` (the click, Enter, `onMouseUp`, `ProseEntry` / `sameInputs` / memo)
  - `src/web/BlockLinkCard.tsx`
  - `src/web/ProseHoverCard.tsx`
  - `src/web/useCrossrefs.ts`
  - `src/web/article/ArticlePage.tsx`
  - `src/web/reader-capability.ts`
  - `src/web/reader/Reader.tsx`
  - the CSS in `annotations.css`
  - `tests/xref-marks.test.ts`, `tests/xref-prose.test.tsx`, `tests/crossrefs-revalidate.test.tsx`

**B. A narrow check of your own stage-1 fixes** from review 1, in commit `caaacce6`: C1 (the
exact-request fingerprint) and C2 (the maths-rendered phrase check). Nobody else has reviewed that
code. Check that the fixes are right, and that server and client still agree on which phrase
occurrence is unique. General discovery on stage 1 is closed.

**The plan**: `docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md`.
Read § 2 in full, the "Stage 2 as built" section and § Left for Greg. Your plan review is
`docs/plans/260930f-cross-reference-links-plan-review-sol.md`. Check in code that F2 (the nonce
design, *not* the sanitiser half, which is left for Greg), F4, F5, F6, F7 and F8 on the client are
really done.

## What to do

1. An independent attack. Look for:
   - Can an article's own HTML, or anything a visitor controls, make a working xref, open a card
     aimed at a block of its choosing, or trigger a jump?
   - Can a stale or foreign-slug artefact be drawn?
   - Overlap and precedence against terms, cites, comments, chat anchors, search/quote washes and
     authors' links, on mouse and on touch.
   - Keyboard: one Tab stop per link; Enter; focus and the card.
   - Server and client agreeing on the unique occurrence: maths, `<br>`, entities, split marks.
   - Performance of the prose memo on a 2,500-block article: identity stability, no rebuild per
     render.
   - Does a visitor make any authenticated request?
   - Does the new `useJobs("quiet", …)` subscription in `useCrossrefs` change the idle-poll
     behaviour of the reading view?

   Run the jsdom test files yourself: `npx vitest run tests/xref-marks.test.ts
   tests/xref-prose.test.tsx tests/crossrefs-revalidate.test.tsx`, plus anything else that needs
   no database or network.
2. **Fixes.** Fix what is inside this stage, narrowly and red-first. Report, but do not fix,
   anything wider. Do not commit. Do not edit `src/sanitize-policy.ts`, `src/sanitize.ts`,
   `src/web/sanitize.ts`, `src/public/*`, `src/store/public-reader.ts` or any other file in
   docs/project/security-map.md § Where the defences physically live. If a finding needs one of
   those, report it for Greg.

Severity, graded by consequence:
- **P0**: data loss, exploitable security, incorrect charging, or the service broadly unusable.
- **P1**: user-visible wrong behaviour, or an authoritative contract violated.
- **P2**: design or maintainability risk with no wrong behaviour today.
- **P3**: prose defect.

Give every finding an ID (D1, D2…), a severity, file:line evidence, and whether you fixed it (with
the test that went red) or only reported it. End with a verdict: **approve** / **approve with
these fixes** / **changes needed**.

## My own suspicions (already mine, and worth less: spend most of the run elsewhere)

- The browser check found that a Tab-focused mark near the bottom of the window can sit behind the
  bottom dock. Is there an existing scroll-padding convention this should follow?
- The xref underline is close to a glossary term's; the difference is mostly colour.
