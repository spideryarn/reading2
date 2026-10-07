**Verdict: ship with these fixes applied.** Changes are uncommitted.

- **C1 — P1: Stop before the last step’s work starts can still publish.** Input: local Stop during preflight with a failed starting note, or during `beginStep`. **Reproduced:** both tests ended `done` and ran the last step. **Fixed:** check the signal before and after opening the step marker. Two offline regressions pass; a Postgres regression checking cancellation and draft disposal is written, **unrun**.

- **C2 — P1: a stopped partial Illustrated set can replace the last good painting.** Input: provider timeout produces `cancelled: true` with a live signal; Stop then arrives during image storage or runner settlement. **Reproduced:** storage returned the partial painting; the runner accepted a partial product after Stop. **Fixed:** check after storage and carry `discardOnAbort` through ledger/preview settlement to the commit decision. Red-first regressions pass, including the provider-timeout-without-Stop control.

- **C3 — P2: the new early Illustrated throw drops paid image bytes.** Input: the first plate arrives after Stop; remaining plates are cancelled. **Reproduced:** zero storage calls instead of one. **Fixed:** move the throw after uploads. The paid plate remains stored as a blob; the previous painting remains published. These blobs are not a resumable painting checkpoint.

- **C4 — P2: M2 exposed a test gap, not a dead branch.** Input: remove the local cancel branch while later progress writes fail. **Reproduced by mutation:** the next step’s asynchronous preparation starts, although eventual status remains `cancelled`. **Fixed coverage:** an isolated test now detects that extra preparation. Mutation removed.

- **C5 — P1, wider: remote Stop can be missed across failed progress reads.** Input: Stop during an earlier step on another instance, followed by failed boundary and starting writes. **Reasoned:** there is no local abort, so subsequent work can run. This predates the change and is documented in `note`. **Not fixed**, per scope.

- **C6 — P2, wider: an assets retry can regress previously stored entries.** Input: a stopped manifest contains successful images; a later retry encounters failures for those URLs. **Reasoned:** collection rebuilds the manifest rather than preserving prior successes. **Not fixed:** this is existing collection behavior.

- **C7 — P3: the card does not explain the kept outcome.** Input: Stop during the last step, followed by publication. **Reasoned:** “Stopping after the current step…” is ambiguous, while “Done — read it” accurately describes the published result. **No wording changed**, as requested.

The sentinel itself is compatible with the inspected readers: freshness and Metadata report it not current; public reading, export, image serving and rendering retain the entries. Image caches use individual content hashes. Re-pasting an existing URL queues an unforced import that retries assets; Refresh from source and Start again force it. Reading alone does not retry it.

Deadline-first products remain uncommitted; Stop-first retains its fixed abort reason and follows the keep rule. Registry omissions from `metadata`/`extract` are optional missing facts, rather than fabricated facts. The signal-ignoring registry work in `citations`/`debate` completes its product.

The existing Postgres earlier-step controls could pass M2 because subsequent progress writes detect cancellation. Their fake products also cannot establish the real assets or Illustrated retention behavior; the offline step tests supply that evidence.

Files changed:

- [src/jobs.ts](/var/tmp/spideryarn-worktrees/sweep7-stop-keeps-and-publishes/src/jobs.ts)
- [src/pipeline.ts](/var/tmp/spideryarn-worktrees/sweep7-stop-keeps-and-publishes/src/pipeline.ts)
- The three review test files: `jobs-tier0-offline`, `illustrated-step-registration`, and `jobs-walk`.
- [Root-cause write-up](/var/tmp/spideryarn-worktrees/sweep7-stop-keeps-and-publishes/docs/postmortems/261007f-cancellation-checked-before-asynchronous-preparation-finishes.md)

Ran the three requested offline suites: **54 passed**. Typechecking passed across all projects. Scoped lint completed with one warning and complexity advisories; `git diff --check` passed. No Postgres tests or `npm test` were run.