No P0s. I found four P1s.

### P1

1. **The tab fetches once per second, despite claiming not to poll.**

   `App` constructs a new API object during every render at [App.tsx:53](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/App.tsx:53). `useNow()` rerenders `App` every second, and the panel effect depends on API identity at [DeploysPanel.tsx:326](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/DeploysPanel.tsx:326).

   Consequently it aborts and restarts `/api/deploys` every second. If a response takes over a second, the browser may never accept one; the server nevertheless continues each abandoned request. The tests always inject a stable API, so they cannot catch this.

   Hoist one HTTP API instance or memoize it once.

2. **Cached `origin/main` is still rendered as live production, and the rollback alarm can be false.**

   [DeploysPanel.tsx:108](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/DeploysPanel.tsx:108) says:

   > Production is at `<cached origin/main SHA>`

   That is precisely what the corrected route comment says cannot be known: the push may not have built successfully.

   Worse, [DeploysPanel.tsx:146](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/DeploysPanel.tsx:146) declares a rollback or working-directory deploy when ancestry is false. A merely stale cached ref produces the same result when the recorded deploy is newer than the cached tip.

   The count remains rendered too. For non-ancestor histories, `git rev-list recorded..tip` at [git-probe.ts:273](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/git-probe.ts:273) is a set difference, not “later commits.” Only present that count when ancestry is `ancestor`.

3. **The route’s worst-case probe is longer than the browser’s timeout, so a failed Git probe can still blank a good list.**

   The probe can spend nearly:

   - 5 seconds resolving the ref;
   - 10 seconds on two sequential `rev-parse` calls at [git-probe.ts:172](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/git-probe.ts:172);
   - another 5 seconds on the parallel ancestry/count phase.

   The browser gives up after 15 seconds at [deploys-client.ts:39](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/deploys-client.ts:39). Thus the probe may eventually produce honest unknown arms, but the browser has already replaced the entire readable record with “no answer.”

   Give the whole snapshot a deadline shorter than the client deadline, returning unknown Git readings when it expires.

4. **A corrupt newest line still permits a confident comparison against an older deploy.**

   `readDeploys()` drops an unreadable line, then `newestDeploy()` selects the newest surviving version at [deploys.ts:273](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/deploys.ts:273). The route uses that SHA unconditionally at [routes-deploys.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/routes-deploys.ts:154).

   If the final NDJSON line is corrupt, the warning correctly says a deploy is missing, but the header still calls the preceding SHA “the newest recorded deploy” and computes a misleading distance from it. The tests cover an unreadable *oldest* line, not an unreadable newest line.

### P2

- **The client’s “schema check” is only an envelope check.** After confirming `schema`, `kind`, and that `versions` is an array, [deploys-client.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/deploys-client.ts:97) casts everything else. Missing `git`, `unreadable`, or malformed versions can crash rendering or fabricate `undefined` values. There are no tests of the actual HTTP client/parser.

- **“Show more” is broken after 60 rows.** [DeploysPanel.tsx:328](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/DeploysPanel.tsx:328) always sets the limit to 60. With the current 74 deploys, 14 remain and the button stays visible, but subsequent presses do nothing. The fake API always returns one row regardless of the requested limit, masking this.

- **The async response can still reject unhandled.** The error boundary ends before compression and sending. `gzipSync`, `writeHead`, or `end` at [routes-deploys.ts:238](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/routes-deploys.ts:238) can reject `answer()`, while [routes-deploys.ts:203](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/routes-deploys.ts:203) deliberately discards its promise. I found no normal double-send path, but this can leave a request unanswered and create an unhandled rejection.

- **The supplied server clock is unused.** `servedAtMs` exists specifically for age calculations, yet `Freshness` subtracts timestamps from the browser’s `useNow()` value. Device skew therefore changes every rendered “ago,” even while the dashboard header may claim times are corrected.

- **The cache test does not test caching or single flight.** At [fleet-deploys-route.test.ts:330](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tests/fleet-deploys-route.test.ts:330), equal snapshots only prove deterministic Git output, and `calls > 0` counts clock reads rather than subprocess executions. Removing the cache could leave it green. Inject the command runner or put an observable Git wrapper in front of the probe.

### P3

- P1-4’s catastrophic synchronous subprocess freeze is fixed, but the route still synchronously reads, parses, stringifies, and gzips the growing record. At today’s ~210 KB this is small, but `MAX_LIMIT` does not bound file parsing or individual entry size.

- The single-flight implementation coalesces the normal same-watermark case correctly. It holds only one `inFlight` key, though, so an `A → B → A` interleaving launches two A probes. A `Map` would make the “keyed single flight” claim exact.

- The fetch label is not exact in a worktree: the timestamp is the maximum of this worktree’s and the primary checkout’s `FETCH_HEAD`, yet the panel says “this checkout last fetched something.”

### Direct answers

- **P1-3:** The exact corrupt-entries-as-quiet bug is genuinely fixed. Missing, non-array, wholly unreadable, and partially unreadable entries now remain distinguishable. The remaining gap is a corrupt whole newest line, which still leaves the header overconfident.
- **P1-4:** Git subprocesses no longer block the event loop, and same-key TTL/single-flight logic is correct. The surrounding feature still generates one request per second, has a server deadline longer than its client deadline, and retains smaller synchronous blocking sections.
- **Route lifecycle:** I found no ordinary double-send or permanent timer/listener leak. Abandoned browser requests continue server-side, and post-payload send failures can escape as unhandled rejections.
- **Tests:** The real-file parser comparison and real-repository Git semantics are valuable. The focused suites passed—451 tests—but they miss the default API identity, divergent-history copy, newest-line corruption, actual cache execution count, client validation, compression/error paths, and second “Show more” press. Typechecking could not run in this sandbox because `tsx` was denied permission to create its IPC socket.