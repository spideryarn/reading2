Review the plan docs/plans/261029j-explained-passages-underlined-in-the-prose.md before it is built.
Read it, then the code it touches: src/web/annotate.ts (MarkKind, annotate(), citeMarks, termMarks),
src/web/styles/annotations.css (mark.term, mark.cmt.term, mark.cite), src/web/TableView.tsx
(termMarksByBlock, citeMarksByBlock, proseHtml, sameInputs, NOT_A_BLOCK_SELECTION),
src/web/ProseHoverCard.tsx (read, selector, tapSelector, openDelay, onCommit, QuoteCard, OpenInMode),
src/web/marginalia/MarginaliaColumn.tsx (OwnerMarginFeed, ExplanationsMarginFeed),
src/web/reader/Reader.tsx (ownerFeed, askExplanationInChat, openExplanationInBand, ProseHoverCard props),
src/explanations.ts, src/web/explanation-labels.ts, src/sanitize-policy.ts, docs/project/explanations.md,
docs/project/glossary.md § Finding the term in the prose.
Find what is wrong or missing: overlap cases between kinds, touch/hover precedence bugs, memo/cache
bugs (a list arriving late not drawing), offset-space mistakes, owner/visitor leaks, anything in the
plan that would ship broken silently. Be concrete: file, line, scenario. Rank by severity. Do not edit.
