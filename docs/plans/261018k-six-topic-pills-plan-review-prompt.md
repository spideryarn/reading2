Review the plan docs/plans/261018k-six-topic-pills-by-default-above-the-shelf.md, read-only, in the
repo at the current directory (Spideryarn). Read the files it names: src/web/ShelfTerms.tsx,
src/web/PublicShelfTopics.tsx, src/web/shelf-narrow.ts (withinChosenFirst, availableTopics),
tests/shelf-topics.test.tsx, docs/project/shelf-terms.md § Two views, docs/project/public-shelf.md
§ Topic pills.

Greg's request (an admin, trusted): "By default, initially just show a half dozen or so topic pills
on the logged in page above the shelf."

Questions:
1. Is item 3 (keep the topics directly inside a chosen one drawn while collapsed) right, or scope
   creep? Any case where it makes the collapsed row balloon or jump when a pill is pressed (pills
   must never move under the pointer)?
2. Anything that still says or assumes twelve (tests, ghosts, the "All" reservation, docs, help
   pages) that the plan misses?
3. Any interaction with tags row, the URL ?topics= key, the archived scope, or the public shelf
   that breaks?
4. Anything simpler?

Write findings as a numbered list, each with severity (high/medium/low) and file:line, then a final
line "VERDICT: approve" or "VERDICT: revise".
