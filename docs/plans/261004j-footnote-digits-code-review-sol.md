Fixed four code defects red-first; one established P1 remains outside this stage. Nothing committed.

- **C1 — P1, established, fixed:** Numbered body instructions became endnotes. Failing tests covered ordinary footnotes, title-page affiliations and page gaps. Recovery now requires a Notes/Endnotes section and an adjacent notes page without body prose.
- **C2 — P1, established, fixed:** Cross-page note continuations defeated recovery. Two tests failed first; the simpler page-by-page rewrite now preserves continuations and applies each page atomically.
- **C3 — P1, established, fixed:** `studies1` quoted from `studies15`, or `dose5` from `dose5mg`, fabricated citation numbers. Four failing cases now pass using full-block context.
- **C4 — P1, established, fixed:** Delimited maths supplied false citation numbers. The failing TeX test now passes using the existing maths-span parser.
- **C5 — P1, established, wider, unfixed:** Omitted PDF notes and unrecognised web notes make `hasNotes` false. A wrong entry copied consistently still passes the title check. The offline probe reproduces both cases.
- **C6 — P3, established, fixed:** Docs now describe recognised note evidence and the actual recovery guards.

All callers checked. Eight condition-deletion mutations went red; maths-guard removal and quote-only evidence also failed. Added missing note-id-only coverage.

Validation: **223 targeted tests passed**. Typechecking added no diagnostics beyond the accepted baseline. Full `npm test` stopped during database setup; scoped lint reported informational findings only.

[Full review and mutation evidence](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/docs/plans/261004j-footnote-digits-code-review-sol.md).

**Verdict: narrow repairs complete; changes required to resolve C5 before claiming “no notes” safety.**