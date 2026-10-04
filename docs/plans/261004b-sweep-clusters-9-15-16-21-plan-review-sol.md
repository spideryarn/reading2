No established P0 or P1. I found eight P2 issues worth correcting before implementation.

**PF1 — P2, established: A4 assumes prompt strings that several harnesses cannot access.**

(a) `evals/plain-words/answers.ts::generate` receives events from `explainStream` and `converse`; both generators keep their `SYSTEM` private. Likewise, the glossary path in `evals/plain-words/run.ts::generate` receives generated entries, not a system string. The quiz harnesses call `generateQuiz` without holding its complete system blocks, although `QUIZ_SYSTEM` is exported. Also, `evals/paperwork/run.ts::SOURCES` already includes `paperwork.ts`; that particular omission is false today.

Obtaining every rendered system prompt would require production exports or a request-observation seam outside this cluster.

(b) Replace A4 with:

> **A4. F5, bounded source provenance.** These harnesses do not all hold rendered system prompts. Within the cluster’s file set, extend their source fingerprints to cover the prompt-text dependencies they actually use, including `plain-words.ts`, `paperwork.ts` and applicable shared prompt modules. `paperwork/run.ts` already hashes `paperwork.ts`. Capture the source snapshots before importing and running the generators; in `plain-words/artefacts.ts`, move hashing out of `write()`. Describe these as source fingerprints, not hashes of complete rendered requests. Test that changing a previously omitted dependency changes the recorded fingerprint. Complete request hashing remains deferred.

**PF2 — P2, established: the MCP lifetime change omits the single-client run and failure cleanup.**

(a) [remote-smoke-mcp-browser.mjs](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-clusters-9-15-16-21/scripts/remote-smoke-mcp-browser.mjs)::`main` calls `openPage` once before launching the pair. Removing `finish()`’s kill and killing only “both after both have answered” leaves that single client alive. Its process and pipes can keep the script running after the success line. Pair failures also need cleanup, and clearing the navigation timer does not bound the subsequent re-read.

(b) Replace item i’s implementation wording with:

> Return a live client handle with a bounded read operation and an idempotent close operation. Close the single-run client before starting the pair. Keep both paired clients alive through navigation and the subsequent page read, and close every started client in `finally`, including failure paths. Establish navigation order explicitly, or re-read both clients, so either completion order detects shared state. The re-read must inspect page contents without navigating again. Test delayed startup, both completion orders, read failure and cleanup. Keep this inside the smoke script and its focused test.

**PF3 — P2, established: D’s stale fixture can throw instead of answering false.**

(a) [artifacts-pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-clusters-9-15-16-21/src/store/artifacts-pg.ts)::`stampForStep` compares the artefact stamp with `revision_step_runs` and throws `StampDisagrees` when their shared fields differ. Changing only the artefact’s version, model or fingerprint therefore does not create the intended stale state.

An encompassing `it.fails` could then pass because of that fixture error rather than the claimed disagreement. Some differences are deliberate too: `ideasAreCurrent` compares the artefact’s own profile, while the pipeline uses `ctx.profile`; Illustrated similarly distinguishes the requested note from the stored note.

(b) Replace D’s fixture and disagreement wording with:

> Use `readsPgArtifacts(ref, getDb())` against the published fixture revision, with a `StepContext` whose profile and illustration note match that fixture. Its read methods do not require a live job. Seed readable artefacts and completed run rows with matching stamps. For each stale case, change every recorded copy of the selected stamp field together, preserving row/artefact agreement and output readability. Assert that both calls resolve before comparing their booleans. Where they disagree, assert the exact observed pair in an ordinary regression test and report it; do not use an encompassing `it.fails`. Keep deliberate differences caused by a new profile or illustration request separate from currency agreement.

**PF4 — P2, established: the proposed file sets exceed the umbrella’s allocation.**

(a) The umbrella’s row 15 allocates the two lock-test files and tooltip tests. B additionally edits three store-test files, creates a helper, and exports from `src/web/Tooltip.tsx`. Row 16 lists four scripts, whereas C adds a shared reader and new tests. This contradicts the plan’s instruction to remain inside each cluster’s file set.

(b) Add before “How it runs”:

> Amend the umbrella manifests before delegation. Cluster 15 additionally owns the three existing store tests containing `waitUntilBlockedBy`, its new test helper, and export-only edits to the tooltip delay constants’ defining modules. Cluster 16 additionally owns its shared env reader and focused new tests. Name the concrete paths and check them against other cluster allocations. These are explicit scope extensions; other production files remain outside scope.

**PF5 — P2, established: exporting the stage parser does not make its module safely importable.**

(a) [stage.ts](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-clusters-9-15-16-21/scripts/stage.ts) performs environment loading and runtime imports at module scope, then unconditionally interprets `process.argv`, calls `die`, or runs a stage. A test importing the proposed pure function also executes that CLI path. There is no entry-point guard today.

(b) Replace item f with:

> Export a pure argv parser and guard CLI execution with the existing `src/is-main.ts::isMain`. Importing the parser must not interpret the test runner’s argv, exit the process, enqueue work or require configured services. Move CLI setup behind the guard where necessary. Test unknown flags and extra positionals, plus the existing valid URL, file and one-stage forms; preserve file ingestion’s rejection of `--force`. See the malformed-argv assertions fail against the old parsing behaviour before applying validation.

**PF6 — P2, established: the auth fix leaves a second truthiness check reporting contradictory results.**

(a) [check-remote-auth.sh](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-clusters-9-15-16-21/scripts/check-remote-auth.sh)::`state` uses truthiness, but so does the later “all providers on” expression: `map(select(.value))`. Fixing only `state` makes a string `"false"` report OFF on its provider line and still appear in the ON list. Requiring control keys alone also leaves malformed provider values accepted.

(b) Replace item g with:

> Validate that `external` is an object and that `google`, `email` and `github` are present boolean values; malformed settings exit 2. Use `== true` consistently in both individual states and the “all providers on” list. Test valid enabled/disabled settings, missing control keys, missing Google, and string-valued booleans through the real script with fake curl.

**PF7 — P2, established: fake curl alone does not provide the shell tests’ configuration seam.**

(a) [check-google-redirect.sh](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-clusters-9-15-16-21/scripts/check-google-redirect.sh) changes directory to its checkout and reads `CID` directly from `.env.local`. It does not accept an inherited client ID instead. Without that file, the proposed fake curl is never reached. With it, the test depends on machine configuration. The env-reader tests also need controlled files.

(b) Add after C’s fake-curl instructions:

> Execute copies of the actual scripts and shared reader in a temporary checkout-shaped directory containing dummy `.env.local` and `.env.prod` fixtures. Put fake curl first on PATH and remove inherited configuration overrides from the child environment. Exercise plain assignments, `export`, both quote kinds and surrounding spaces through those fixtures. Do not read or rewrite the developer’s real env files. Assert script exit status and output as well as curl arguments.

**PF8 — P2, established: A1’s historical paths and provenance claim need correction.**

(a) The recorded commit is recoverable: `675aa32b22167f1b921f3286ed10e8fa1c50acf0`. At that revision, however, the files are `src/hierarchy.ts`, `evals/hierarchy-structure/toc10-frozen.ts` and `tests/hierarchy-structure-request-parity.test.ts`.

I reconstructed the rendered constant from that commit’s shared rules and confirmed agreement with its literal. Its SHA-256 is:

```text
532c3dc4208f19bbe0415ac6f653107619cc2135364eb5cdd97a9064e522998d
```

But `evals/structure-whole-document/run.ts` records HEAD without a dirty-tree check or request snapshot. Agreement between committed sources and a committed literal establishes the reconstruction, not conclusively the bytes that the paid run sent.

(b) Replace A1’s recovery bullet with:

> Recover the canonical toc/10 system text from recorded HEAD `675aa32b22167f1b921f3286ed10e8fa1c50acf0`, using its historical `hierarchy` paths. Render `TOC10_SYSTEM` from that revision’s source and dependencies and compare it with `EXPECTED_TOC10_SYSTEM` in `tests/hierarchy-structure-request-parity.test.ts`. Pin the recovered digest independently. Describe this as the canonical prompt reconstructed from the run’s recorded commit; the saved run does not prove a clean working tree or preserve the transmitted system bytes.

One further issue is **reasoned**, because Postgres was unavailable:

**PF9 — P2, reasoned: B1 cannot require two direct blockers using the existing helper.**

(a) The three `waitUntilBlockedBy` copies use the same substantive query and polling loop; their database accessor and error text differ. They return after finding **one** backend directly blocked by the holder.

For two requests locking the same article row, a possible lock chain is:

```text
request 2 → request 1 → holding backend
```

The second request can wait behind the first request’s tuple lock rather than directly name the holder in `pg_blocking_pids`. Counting two direct matches can consequently time out on correct production locking; calling the existing helper twice can return twice for the same waiter.

(b) Replace B1’s visibility/helper wording with:

> Share the existing single-waiter helper after normalising its database accessor and diagnostics. For visibility, require two distinct request backends whose blocking chains reach the test’s holder, following `pg_blocking_pids` transitively where needed. Two successful calls to the single-waiter helper are not evidence of two arrivals. Verify this on Postgres with the real two-request test and with the locking read removed; record both results.

The other suspected seams are workable. A3 has the final message and can obtain the required budget inputs through existing exports; it must explicitly guard `stop_reason === "max_tokens"` before throwing `truncationFailure`. Existing tests demonstrate Floating UI working with fake timers, while its exit transition needs separate advancement where removal is asserted. The frozen request’s other consumers retain compatible request shapes, and the production constant rename can remain purely a rename.

I changed no repository files. The existing parity file passed all three tests using `--configLoader runner`; the default loader first failed creating its cache directory. The conclusion follows from the code, history and offline checks above. PostgreSQL blocking behaviour and real remote-script execution remain unverified.

VERDICT: build