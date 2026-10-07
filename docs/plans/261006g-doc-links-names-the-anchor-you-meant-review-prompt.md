Review a short plan before it is built. Read-only: do not edit anything.

The plan: docs/plans/261006g-doc-links-names-the-anchor-you-meant.md (untracked, in this worktree).
The code it changes: tests/doc-links.test.ts — `slug`, `anchorsIn`, and the test
"point at anchors that exist". The doc it adds a line to: docs/reusable/write-planning-doc.md.

Questions:
1. Is the plan's account of how `slug()` differs from GitHub's anchor rule correct? Check the code.
2. Is `suggestAnchor` as specified sound — can the hyphen-collapse match or the edit-distance
   fallback mislead, and is the threshold sensible? Note anchors with a `-1`, `-2` suffix for
   repeated headings, and explicit `<a id>` anchors.
3. Is anything in "What does not change" a mistake to leave out?
4. Anything simpler that gets the same result?

Severity scale: P0 must not build as written; P1 fix before building; P2 worth doing; P3 note.
Give every finding an ID (F1, F2, …), its severity, and the evidence. End with a one-line verdict.
Keep it short; this is a half-day item.
