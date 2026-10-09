# Code review round 2 (read-only, narrow): 261009l Peer review

Repo at the current working directory. Round 1 (docs/plans/261009l-peer-review-code-review-sol.md) made fixes that nobody has reviewed; they are in commit d4de31d9d (`git show d4de31d9d`), plus commit 3d7a9a916 (reshot Help images, help-images.ts metadata, a Help caption). Also commit 729712c42 is Stage 2 (C1), already reviewed in round 1.

Review ONLY those two commits' changes for: a test that cannot fail or asserts the wrong thing, Help or doc text that is now false against the code (check claims in src/web/help/pages/modes/peer-review.md, ai-words.md, faq-beyond-the-article.md and the visitor sentence in src/web/visitor.ts against the code), and metadata in src/web/help/help-images.ts that does not match its image (dimensions: check with `file` on the png). Discovery of new unrelated issues is closed. Do not edit anything.

Severity P0–P3, ID each finding R1, R2…, file:line, concrete fix. End with one line: LAND / FIX FIRST.
