## Verdict: revise before accepting

### High

1. **The gate misses a current paid CLI.**  
   The completeness check only accepts exact `tsx src/*.ts` scripts and direct seam imports ([paid-cli-ledger.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/paid-cli-ledger.test.ts:305)). `eval:dictation-vocab` ([package.json](/Users/greg/Dropbox/dev/experim/spideryarn2/package.json:52)) transitively calls `openRouterJson` via `transcribeWith` ([bench-vocabulary-sources.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/dictation/bench-vocabulary-sources.ts:445), [transcribe.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/transcribe.ts:245)). It has no ledger; the spend register explicitly says its rows are dropped ([spend-declarations.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/spend-declarations.ts:123)).

   `PAID_CLIS` is complete only for current production stage CLIs. The check is not tautological, but its name and header are false.

2. **`ledgerOffence` can pass code that spends outside the ledger.**  
   It checks the imported wrapper’s spelling and first argument, not its binding or callback ([paid-cli-ledger.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/paid-cli-ledger.test.ts:156), [paid-cli-ledger.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/paid-cli-ledger.test.ts:265)). These pass:

   ```ts
   if (isMain) withLedger("cli", async () => {}).then(main);
   ```

   ```ts
   if (isMain) {
     const withLedger = async (_scope, fn) => fn(); // shadows the import
     await withLedger("cli", main);
   }
   ```

   `directCalls` also ignores variable initializers, nested statements and `else` branches ([paid-cli-ledger.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/paid-cli-ledger.test.ts:223)).

   The “locally-defined withLedger” control does not test binding: it omits the import, so it fails merely with “imports no withLedger” ([paid-cli-ledger.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/paid-cli-ledger.test.ts:359)). The controls assert only non-null, never the expected offence text.

   An unknown guard alone fails safely, but an unrelated recognized `import.meta` branch can pass while the real entrypoint is skipped.

3. **The reload tests serialize away the live same-slug race.**  
   All three loaders can start an opening GET and an `onFinished` GET concurrently ([useIdeas.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useIdeas.ts:83), [useSummaries.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useSummaries.ts:90), [Tweets.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Tweets.tsx:123)). If the post-job response installs the new artefact first, the older opening response can overwrite it permanently.

   Every new test settles the opening request before firing `finishJob` ([background-reload-keeps-the-list.test.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/background-reload-keeps-the-list.test.tsx:283)). `useGlossary` documents and solves this exact ordering with generation/trailing fetches. The plan’s 2.6 already acknowledges it, so this is not a new regression—but the Tier 0 verification is weaker than claimed.

### Medium

4. **The `useIdeas` server reason is not durable.**  
   `queue.error` is shared polling/action state. The failed POST sets it, then `finally` immediately starts a poll; any successful poll clears it ([useJobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useJobs.ts:422), [useJobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useJobs.ts:328)). With `postFailed` still true, the UI falls back to “Couldn't start the job,” possibly before the reason paints.

   The test’s static mock has no poll, so it proves only the ternary, not the real sequence.

5. **`store/revisions.ts` still gives step 11 unsafe advice.**  
   “Publication starts succeeding here with no change to this file” is false ([revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/revisions.ts:74)). `begin` passes the job token and then drops it from `RevisionHandle`; `publish` and both failure paths omit it ([revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/revisions.ts:113), [revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/revisions.ts:187), [revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/revisions.ts:212)).

   Consequently, publication skips the live-attempt fence, and failed drafts retain `jobs.draft_revision_id`; the sweeper deliberately spares them. The acceptance condition must require carrying the job fence through publish/fail, clearing the pointer atomically, and testing refused/failed drafts through sweep.

6. **The new Tweets copy violates `copy.md`.**  
   “Couldn't check for a newer thread — Failed to fetch” supplies no action or stable code and is assembled outside `messages.ts` ([Tweets.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Tweets.tsx:290), [copy.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/copy.md:21)). It is not acceptable under that contract.

   Opening-read failure does **not** show twice. Ready and none branches retain correctly. The error branch retains the old error and hides a newer reload failure.

### Documentation nits

- `isStale` is no longer “used at both ends”; the pipeline independently applies the same hash rule ([glossary.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:698)).
- The touched header still says the Postgres artefact adapter is unwritten, despite `artifacts-pg.ts` existing ([artifacts.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts.ts:26)).
- `copy.md` now counts three copies of “Couldn't start the job”; adding `useIdeas` makes four.
- The `glossaryIsCurrent` deletion itself is safe. The live stamp path covers presence, source hash, prompt and model.

Targeted result: 150/150 tests passed; the findings above explain why green is insufficient here. No files changed.