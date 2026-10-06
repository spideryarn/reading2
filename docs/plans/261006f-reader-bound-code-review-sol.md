Fixed six findings; no commits.

| ID | Severity / evidence | Finding | Status |
|---|---|---|---|
| C1 | **P1, established** | Installed SDK 2.112.4 can emit late `INITIAL_SESSION null` after discarding A’s refresh, erasing B’s newer session. Reproduced with synchronous storage. | Fixed: initial events only fill an unheard tab. |
| C2 | **P2, reasoned** | Reader-ID equality misses A → signed out → A, allowing stale lookup adoption. Reproduced using the SDK’s supported asynchronous storage; production reachability remains unestablished. | Fixed with session revisions. |
| C3 | **P1, established** | Queued comment edits, placements, colours and late deletions sent with B’s token. | Fixed with mounted-reader bindings. |
| C4 | **P0, established** | Audio conversion, retries and late first-upload callbacks could send A’s audio as B. | Fixed across all eight dictation callers; recordings retain their original reader. |
| C5 | **P1, established** | Queued search/criteria settings, delayed search revisions and late deletions sent as B. | Fixed. |
| C6 | **P0, established** | Delayed live startup could create a paid session as B; late tools and meter callbacks also used B’s token. | Fixed with reader-bound wiring in both live engines. |
| C7 | **P2, established** | Unscoped browser storage retains search words and reading-position state. Unmatched search pairs do not display their words. | Reported; deliberately excluded from this work. |

Every behavioral fix has a regression observed failing against the preceding implementation, plus controls confirming ordinary requests still succeed.

**F1–F6 checked:** F1 needed the additional C1/C2 repairs. F2’s spoken retries, F3’s keyed profile page, F4’s sign-out clearing, F5’s shelf refill fence and F6’s historical closure wording are implemented.

Remaining implicit late senders include chat recovery reads, mode polling, link-preview retries and chained link summaries. Their server ownership checks precede access or spending; I established no further cross-account write or charge. Existing meter ownership checks protect accounting, but did not protect session creation.

Updated auth, dictation, plan and postmortem documentation. The security-map and web-client signposts remain accurate.

Validation: **277 tests passed across 14 suites**, including every requested suite. Typechecking passed all four projects, covering **3,307 source files**. Scoped lint and whitespace checks passed. The npm typecheck wrapper hit an IPC restriction; the equivalent direct runner passed. I stopped the broader unit run after unrelated sandbox failures involving subprocesses and process/socket checks. Browser checks remain outstanding.

VERDICT: approve with fixes