This file is the review.

- **CR-11 — P1, established, fixed:** `src/chat.ts:476`. An omitted-kind spoken request could append to Explore. Added a stored-thread guard; regression observed red, then green.
- **CR-12 — P2, reasoned, left:** `src/converse.ts:1921`. The reminder demands links for the reader’s thoughts and the model’s reasoning.
- **CR-13 — P2, reasoned, left:** `src/converse.ts:1403`. The shared “never beyond the article” instruction conflicts with Explore’s wider-world remit.
- **CR-14 — P2, established risk, left:** `src/web/ChatPanel.tsx:486`. Per-kind presentation ternaries lack exhaustive compiler checking.
- **CR-15 — P2, established wider gap, left:** `src/routes.ts:3969,4097`. Live issuance ignores stored-thread capabilities; older kinds are affected too.
- **CR-16 — P3, established, left:** `src/converse.ts:1140`. Tutorial still redirects exploration to Chat.
- **CR-17 — P3, established, fixed:** `docs/project/remember-mode.md:211`. Corrected the three-chip list.

**133 tests passed**, typechecking and scoped lint passed. Verified 36 older-kind message arrays byte-identical; migration chain consistent and additive.

No commits or protected prompt edits. Postgres files are listed in the review; especially run the newly extended `tests/chat-spoken-route.test.ts`.

**Verdict: land with CR-11 and CR-17 fixes, after that Postgres regression passes.**