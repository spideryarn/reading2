You are reviewing a PLAN (not code yet) for a small UI change in this repo. Read-only.

Plan: docs/plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top.md
Code it touches: src/web/Metadata.tsx (the `Metadata` render body ~lines 700-1200, `Section` ~3184, `ArchiveArticle` ~2298, `ExportSection` ~1658, `DeletePermanently` ~2762, `SharingSection` ~1217), src/web/AccessSharing.tsx (the card the Share button must not bypass), tests/metadata-page-order.test.tsx.

The user's request (Greg, the product owner) is quoted verbatim at the top of the plan. Constraints: Share must NOT bypass the existing public-sharing confirmation; Archive from the top must say it is archived and leave the reader where they are, reversibly.

Please check:
1. Is lifting ArchiveArticle's state into a hook shared by two buttons sound? Any way the two can disagree, or the existing honesty rules (unknown state => no button; failed write => re-read) break?
2. keepMounted for Export/Delete vs unmounting: any hazard (hidden focusable elements, DeletePermanently state, alerts inside hidden)?
3. Focus management for Share…: is focusing the first control in #sec-access-sharing right? Any risk it lands on a control that publishes with one keypress (e.g. Enter)? Check AccessSharing's flow.
4. Anything in the plan that is wrong about the code, or a simpler design that fits the request better.
5. Tests: what's missing that would let a broken build pass?

Write your findings, ranked P0/P1/P2, each with file:line evidence, and a final one-line verdict (build as planned / build with changes / rethink).
