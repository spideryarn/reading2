You are the code reviewer for one stage of work in this git worktree (Spideryarn). You may edit files to fix what you find, inside this change's scope, and you must report anything wider for me to decide. Do not commit, push, or run any git command that changes history or the index.

Context:
- The plan: docs/plans/261001a-article-markup-keeps-only-what-we-allow-of-data-attributes-and-classes.md. Your own plan review, with four findings: docs/plans/261001a-article-markup-allowlist-plan-review-sol.md. Check that each finding was addressed correctly. Its fixes are in the diff.
- The whole change, as a diff against HEAD: docs/plans/261001a-code-review.diff. The files: src/sanitize-policy.ts (the defence, approved by Greg), tests/sanitize-allowlist.test.ts (new), tests/sanitize.test.ts and tests/sanitize-client.test.ts (two behaviour tests deliberately reversed, and the parity corpus extended), src/web/xref.ts and src/web/BlockLinkCard.tsx (comments only), docs/project/security.md, and 260930f's § Left for Greg.
- Evidence so far: the new tests went red before the policy change (10 failures: every forgery survived) and green after. The collision tests were mutation-checked: planting `data-url-original` in a src/web file, `className="sout"`, and `data-block-link` in ARTICLE_DATA_ATTRS each turned the intended tests red. Targeted suites (sanitize*, maths*, reserved*, the-sanitiser*, extract-sanitize, citations*, notes*, callouts*, blocks*, xref*, prose-links*): 28 files, 701 tests green. `npm run typecheck` exit 0.

Review for:
1. Correctness of the policy: ALLOW_DATA_ATTR:false plus ADD_ATTR, the class hook (namespace check, classList iteration while removing, the empty-class removal, idempotency across two passes and across the two bindings), and the SANITIZER_VERSION bump.
2. Anything real that breaks. Hunt for code that reads a data-* attribute or a class off article/block HTML after a sanitise and is not covered, including the maths render pass in src/web/maths.ts, figures/rehost, notes-view, citations, and the export. Run the relevant tests yourself.
3. Whether the tests test what they claim. Is any assertion vacuous, does any scanner regex miss an obvious spelling, and does the Temml battery actually exercise the classes it claims to?
4. Comment and doc accuracy: every claim in the new comments must be true of the code. Quote file:line.

For each finding: severity (P0–P3), the evidence, what you changed (if anything), and the red→green evidence for any behavioural fix: write the test first and see it fail. Finish with the exact test commands you ran and their results, then a one-line verdict.
