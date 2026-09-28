You are reviewing a short bug-fix plan in this repository (read-only review). Read
docs/plans/260928b-multi-author-bylines-from-citation-meta.md, then src/extract.ts (readingArm,
readArticle, runExtract, tidyMetaText), src/referee-candidates.ts (authorKeys), and
node_modules/@mozilla/readability/Readability.js (_getJSONLD, _getArticleMetadata) to check the
diagnosis.

Saved copies of the real pages are in
/tmp/claude-1000/-home-greg-code-spideryarn2/3f69a3c5-12b4-4330-877f-3721d9896e63/scratchpad/
(nature.html is Greg's page; p3.html arXiv; p4.html PLOS; p5.html Nature AlphaFold; p7.html Frontiers).

Conclusion to check: only the last author survived because Readability's meta map is last-write-wins
on repeated dc.creator, and the fix is to prefer every citation_author (then repeated dc.creator)
read before Readability runs, joined with "; ", with "Surname, Given" flipped to "Given Surname".

The finding I would least like to be wrong about: that preferring citation_author whenever present
cannot make a currently-correct byline worse on some other kind of page (news sites, blogs), and
that "; " is the right join given every consumer of meta.byline (grep for byline across src/).

Report: a verdict (proceed / proceed with changes / rethink), and numbered findings with file:line
evidence. Be concise.
