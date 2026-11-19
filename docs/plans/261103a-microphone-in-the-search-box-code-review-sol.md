Fixed these findings:

- **P2 — [SearchPanel.tsx:701](/var/tmp/spideryarn-worktrees/fbubbygh-search-dictation/src/web/SearchPanel.tsx:701):** `error === null` did not prove delivery. Empty/refused transcripts could search rough guesses; retained warnings blocked valid transcripts. Added an explicit delivery result to `onCommit`.
- **P2 — [SearchPanel.tsx:749](/var/tmp/spideryarn-worktrees/fbubbygh-search-dictation/src/web/SearchPanel.tsx:749):** Clearing left stale words queued for search. Clear now discards them.
- **P2 — [SearchPanel.tsx:722](/var/tmp/spideryarn-worktrees/fbubbygh-search-dictation/src/web/SearchPanel.tsx:722):** Words-mode Enter followed by switching to meaning still triggered a paid search through `edit()`. Matcher changes now cancel automatic submission too.
- **P3 — [search.md:21](/var/tmp/spideryarn-worktrees/fbubbygh-search-dictation/src/web/help/pages/modes/search.md:21):** Clarified meaning-mode timing; updated the generated help corpus and project docs.

Four regressions failed before fixes. All **75 tests passed**, including the requested suites and shared dictation tests. Typecheck passed via the same script using `node --import tsx`; the npm launcher encountered sandbox IPC restrictions.

No commits or index changes.