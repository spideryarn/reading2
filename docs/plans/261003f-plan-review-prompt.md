# Plan review: 261003f (commands take arguments, tags and dictation in the bar, chat command chips)

You are reviewing a PLAN, read-only. Candidate: commit 2952175f5, file
docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md, in this worktree.
Nothing is built yet.

Context to read (it does not limit scope):
- docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md (what the bar already does, and its review ledger)
- docs/project/chat-llm-help-commands-vision.md (the accepted line: navigate freely, propose writes/spends, never destroy/publish)
- src/web/command-match.ts (Command, ActionOutcome, parseFindQuery, rankCommands), src/web/CommandBar.tsx (findRow, besideTheModes, activate, CommandBarArticle, ShelfRow), src/web/Dock.tsx (DockCommandBar)
- src/web/search-hits.ts (findLiteral), src/web/reader/useReadingPosition.ts (?at=), src/web/params.ts (termParam, atParam)
- src/web/useGlossary.ts (useGlossaryRead, ask), src/web/GlossaryPanel.tsx (AskATerm), src/web/reader/Reader.tsx (openTermInGlossary, bookmarkBlock)
- src/web/article-tags.ts, src/tags.ts; src/web/useExperimental.ts
- docs/project/dictation.md § Adding it to a box; src/web/FeedbackDialog.tsx as the worked example
- src/web/Cited.tsx (how [spya-…] chips are parsed and rendered), src/web/ChatPanel.tsx, src/converse.ts (chat prompt), src/chat-tools.ts, docs/project/chat-tools.md § Security
- docs/project/security-map.md

Do an independent pass first: would this plan, built as written, produce wrong behaviour, a security hole (chat's prose is model output that may be steered by a hostile article), a paid call the reader did not ask for, a broken contract (block ids, URL state, last-view classification), or a simpler design missed? Is anything in the plan contradicted by the code? Is the stage cut right?

Severity: P0 data loss / exploitable security / incorrect charging / service unusable; P1 user-visible wrong behaviour or a contract violated; P2 design risk with no wrong behaviour today; P3 prose. Give every finding an ID (F1, F2, …), a severity, the evidence (file:line), and the fix you'd make. End with a verdict: build as is / build with these changes / rethink.

## My own suspicions (worth less; spend most of the run elsewhere)

1. The command chip in chat prose: is "parsed, the reader presses" enough, given a hostile article could get the model to write [[tag …]] or [[glossary …]] (which spends)? Should spend-chips be excluded from chat?
2. The glossary hand-off into the band (one-shot in memory): does generate-on-open of an empty Glossary plus an ask produce two paid runs?
3. Verb collisions: "first", "go to", "glossary X", "define X" against existing mode/page rows and the find verbs.
4. Dictation: the bar's Enter both filters and activates; how should armed/readOnly interact?
