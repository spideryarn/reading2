Fixed the scoped findings; no commits made.

- **F5 — P1, fixed:** The cap could pass with 22 MB hidden files or symlink targets. [Discovery now includes hidden paths and refuses symlinks](/var/tmp/spideryarn-worktrees/q-yeses-plan-inflation-dns-stub/tests/docs-size-cap.test.ts:45). `parentPath` worked on Node 26.8.1.
- **F6 — P1, fixed:** `vi.unstubAllGlobals()` could restore the transport while the counter stayed empty. [The default fetch guard now survives cleanup](/var/tmp/spideryarn-worktrees/q-yeses-plan-inflation-dns-stub/tests/chat-tools.test.ts:80), including nested teardown. The canary tests opened no sockets.
- **F7 — P1, fixed:** The reproduction omitted an intervening edit. The actual sequence was **22,487,524 + 2,306 − 105,000 = 22,384,830 bytes**. The initial block was 1,284 bytes; the committed block was 1,278.
- **F8 — P1, fixed:** The full suite was red: **8 failed files, 7 failed tests, 32,151 passed, EXIT=1**. Original links disappeared rather than multiplied. `bd5f4bdc1` changed another plan; only `5312d3a42` later edited this damaged plan. The suite started seconds after commit.
- **F9 — P1, fixed:** Corrected the `split`/`sed` examples, Edit’s exceptions, the cap description, and the assertion’s empty-source loophole. The proposed assertion now requires `old` to be nonempty.
- **F10 — P2, reported only:** The existing doc-link checker also skips hidden paths. Left unchanged because it is wider work.

F7–F9 are corrected in the [postmortem](/var/tmp/spideryarn-worktrees/q-yeses-plan-inflation-dns-stub/docs/postmortems/261005r-a-slice-between-two-markers-can-be-empty-and-replace-with-an-empty-needle-succeeds-everywhere.md:35) and plan. The existing admission and different-page tests retain their assertions.

The new controls first produced five discovery failures and two counting failures. After fixes, **121 tests passed across all three permitted files**. The transcript/git audit and scoped lint passed. Protected files were untouched.

**Verdict: land after fixes.**