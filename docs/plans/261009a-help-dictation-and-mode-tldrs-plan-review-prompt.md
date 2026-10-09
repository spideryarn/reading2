You are reviewing a plan (read-only) for the Spideryarn repo, in this worktree.

Plan: docs/plans/261009a-help-dictation-and-mode-tldrs.md. Read it, then check it against the code and docs it names:
- src/web/help/HelpAsk.tsx, src/web/useDictationField.ts, src/web/DictationStrip.tsx, src/web/FeedbackDialog.tsx (the twin), src/web/ChatPanel.tsx § Composer, src/web/dictation-keep.ts, docs/project/dictation.md § Adding it to a box
- src/web/help/help-markdown.tsx § renderHelpModeHalves, src/web/help/help-content.tsx § helpBody/helpSearchText, src/web/help/pages/modes/*.md, tests/help-corpus.test.ts, tests/help-page.test.tsx, src/help-chat-call.ts, docs/project/help-page.md

Look for: anything in the dictation wiring that would send rough words, lose a recording, or diverge from how other boxes do it; any place that reads a mode file's sections and would break or silently drop the new `## In short` section (search, the corpus, the chat system prompt, help-answer-links, any other consumer of HELP_MODE_PAGES bodies); simpler designs I passed over wrongly; and missing tests.

Write findings ranked by severity, each with file:line evidence, and end with a one-line verdict (GO / GO WITH CHANGES / NO-GO). Do not edit any files.
