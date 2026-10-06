- **C-F1 — P1, established, fixed.** `/read/why-trees-spya-k3m9qt/` and `/read/%77hy-trees-spya-k3m9qt`, with matching `at`, incorrectly navigated. The router accepts both spellings without normalizing the address. Smallest fix: compare article identity through `parseRoute` and `readHref`.
- **C-F2 — P2, established, fixed.** A response with `page: "/read/x#fragment"` passed validation, putting appended `?at=` inside the fragment. Queries also passed. The server emits neither shape today. Smallest fix: reject `?` and `#` in the path validator.
- **C-F3 — P1, reasoned, left for your decision.** Cross a section boundary, then activate a matching Earlier link before the 300 ms URL debounce settles: stale address equality can suppress the requested return. Closing this reliably requires live reading-position state and coordination with its pending URL write.

Four regression cases failed before the fixes. Afterwards: **254 tests passed**, documentation links passed, typechecking passed through the same script using Node, and touched-file lint passed. Another 771 server boundary probes found no filtering bypass. Postgres was not rerun.

Changed files; no commit made:

- [FeedbackEarlier.tsx](/var/tmp/spideryarn-worktrees/qi-hwkfga7y-earlier-link-carries-at/src/web/FeedbackEarlier.tsx)
- [feedback-dialog.test.tsx](/var/tmp/spideryarn-worktrees/qi-hwkfga7y-earlier-link-carries-at/tests/feedback-dialog.test.tsx)
- [Stage plan](/var/tmp/spideryarn-worktrees/qi-hwkfga7y-earlier-link-carries-at/docs/plans/261006b-earlier-link-carries-the-paragraph.md)
- [Root-cause postmortem](/var/tmp/spideryarn-worktrees/qi-hwkfga7y-earlier-link-carries-at/docs/postmortems/261006b-a-url-guard-checked-its-spelling-instead-of-the-consumers-meaning.md)

**Verdict: accept with the uncommitted fixes; C-F3 remains a reasoned wider finding.**