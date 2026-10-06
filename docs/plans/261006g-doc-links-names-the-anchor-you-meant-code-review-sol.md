`suggestAnchor` is correct for its stated rule. Findings:

- **C1 — P2, fixed:** Two mutations passed the original [test](/var/tmp/spideryarn-worktrees/qi-takva5m9-em-dash-anchors/tests/doc-links.test.ts:386): collapsing only the first repeated run and ignoring letter case. Added coverage that rejects both, plus empty candidates, underscores and numbered occurrences.
- **C2 — P2, fixed:** The [plan](/var/tmp/spideryarn-worktrees/qi-takva5m9-em-dash-anchors/docs/plans/261006g-doc-links-names-the-anchor-you-meant.md:33) still promised the discarded edit-distance fallback. It now describes the implementation and current message.
- **C3 — P3, fixed:** The [failure message](/var/tmp/spideryarn-worktrees/qi-takva5m9-em-dash-anchors/tests/doc-links.test.ts:216) repeated a lengthy explanation on every line. Shortened it and pinned complete output for heading slugs, literal IDs, ambiguity and no match.
- **C4 — P2, fixed:** The [References bullet](/var/tmp/spideryarn-worktrees/qi-takva5m9-em-dash-anchors/docs/reusable/write-planning-doc.md:84) promised a suggestion unconditionally. It now states the uniqueness requirement and retains the file’s existing style.
- **C5 — P2, wider/pre-existing:** Checker and GitHub anchor conventions still disagree. Left unchanged as required.

Validation: **17 tests passed**, lint clean, mutations rejected. Typechecking reports only the known out-of-scope unused `writtenAsB`. `slug()` is byte-for-byte unchanged.

**Verdict: Approve the scoped change with these fixes; no P0/P1 findings.**