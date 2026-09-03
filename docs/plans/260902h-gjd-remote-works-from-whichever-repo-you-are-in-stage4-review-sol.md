REFUSE TO LAND. The three Stage 3 blockers are correctly fixed, but Stage 4 does not actually remember rejected keys. That breaks the saved-policy contract and is immediately relevant to hellozenno.

## Findings

1. **Blocker — `scripts/gjd-remote.ts:pushEnvByChecklist` / `proposeOrSkip` and `scripts/gjd-remote-envpolicy.ts:Policy`: rejected decisions are forgotten.**

   The policy stores only `approved`. `proposeOrSkip()` defines “unseen” as every eligible name not approved. Therefore:

   - `--none --save` writes `approved = []`.
   - The next run considers every eligible key new and calls the model again.
   - A partially approved policy repeatedly re-proposes every unticked eligible key.
   - A later model run can pre-tick a key the user explicitly unticked previously.

   This is especially relevant to hellozenno: `FLASK_SECRET_KEY` and `SUPABASE_PASSWORD` are not hard-guarded, so declining them does not persist. It also contradicts “the next push starts from what you approved.”

   Concrete change: persist reviewed decisions, not only positive approvals—e.g. `reviewed` plus `approved`, or explicit approved/rejected sets. Propose only names not reviewed, and force reviewed rows’ checked state to the saved decision. Migrate old policies by treating their approved names as reviewed.

2. **Should-fix — `tests/gjd-remote-envpolicy.test.ts:“puts no value into the wire…”`: the value-leak transport test is vacuous.**

   The sentinels (`sk-or-`, `postgres://`, `hunter2`) never enter the test inputs. Their absence from the request, ledger, and output therefore cannot demonstrate that a target value failed to leak. There is still no value-bearing CLI-to-SSH integration test.

   Concrete change: move the push-env orchestration behind an importable seam, feed it an `.env.local` containing a unique sentinel, stub model/SSH transport, and assert the sentinel appears only in the final staged box payload—not in model bytes, stdout/stderr, errors, policy, or spend row.

3. **Should-fix — `scripts/gjd-remote.ts:sendEnvPayload`: selected credentials remain in a local temporary directory.**

   `mkdtempSync()` and `writeFileSync(staged, payload.text, 0600)` create another copy of the selected secrets, but the directory is never removed on success or failure.

   Concrete change: wrap staging and transfer in `try/finally`, removing that exact temporary directory recursively in the `finally`.

4. **Should-fix — tests do not protect two important wiring points.**

   - `tests/gjd-remote-setup.test.ts:“emits no check at all when nothing is expected”` proves the generator’s optional behavior but cannot go red if `runSetup()` stops passing `expectFiles`.
   - The new CLI fail-closed status-read change has no test reaching `sayFoundSetupStatus()`.
   - `tests/gjd-remote-env.test.ts:“does not fall back … when allowance is short”` does not kill its stated `allowance.names ?? ALLOWLIST` mutation: a short array is non-nullish, so that mutation remains green.
   - `“is one rule, so checklist and payload cannot disagree”` tests `localityVerdict()` directly, not that both call sites use it.

   Concrete change: extract the remaining CLI decisions into importable functions or add narrowly scoped source-to-generated-job integration tests.

5. **Nit — docs/help contain two inaccurate descriptions.**

   - [hetzner-remote-server-box.md](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/docs/project/hetzner-remote-server-box.md:191) and help call Sonnet a “cheap model”; the spike explicitly chose the capable model despite its higher cost.
   - Help says values are not read into anything “sent”; selected values are, of course, sent to the box. It should say they are never sent to the model or ledger.
   - The remembered-policy wording is false until finding 1 is fixed.

## Requested traces

1. **Admission:** every origin-resolved `new-claude` and `new-shell` path—already found or auto-cloned—returns an `AdmissionPlan` from `sayFoundSetupStatus()` and invokes `startUnderAdmission()`. `GJD_REMOTE_REPO` is verified and admitted too. Only an explicit, unverified `--dir` produces `admit: null`.

   The `expect: null` race is sound:

   - Setup acquires first: admission sees the held lock.
   - Setup finishes first: a status now exists, so bytes differ from `"-"`.
   - Admission acquires first: setup cannot begin until tmux creation releases the lock.

   A failed status SSH/protocol read now dies. A present-but-unparseable status, held lock, missing `flock`, or wrong checkout also refuses. Never-run/failed/config-changed still warn and proceed, as Greg decided.

2. **Fingerprint:** no runtime producer remains on `setupConfigSha256()`. The re-confirmation compares the same `SetupSpec` field-by-field; durable status, `--status`, doctor, session gating, and job creation use `setupFingerprint()` v2. Both `cmdSetup()` and `setUpTheClone()` pass a `SetupSpec` into the single `runSetup()`, which always supplies `expectFiles`.

3. **Routes and values:** only the exact normalized slug `spideryarn/reading2` reaches the typed route. Every other slug reaches the checklist route.

   A target value flows through these bindings:

   `cmdPushEnv.text` → `pushEnvByChecklist.text` → `scanEnv.values`; then `pushEnvByChecklist.values` / `valueGuard.value`; finally `buildEnvPayload.localText` → `scanEnv.local` / loop `value` → `pushed` → serializer `v` / `body` → `EnvPayload.text` and `pushed` → `sendEnvPayload.payload` → local `staged` file → `scp`. Readback holds it in `raw`, `back`, and comparison loop values.

   None is printed, included in an error, logged, saved in policy, or handed to the model. Only names reach the model. A selected hosted Postgres URL is checked by value in both checklist guards and `buildEnvPayload()`, whatever its key name.

4. **Policy edge cases:**

   - Repo mismatch: `readPolicy()` returns `error`; CLI refuses before sending.
   - Removed key: ignored, never pushed empty; a later successful push rewrites the policy without it.
   - `--none --save`: next run asks again. That is not right for a command described as remembering the empty answer.

5. **Ledger:** the row lands in Spideryarn’s selected cost store, rooted from this tool checkout rather than the target cwd. In default filesystem mode that is this repo’s `data/_ai-calls.jsonl`; with `SPIDERYARN_STORE=postgres` present at process startup, it is the shared Postgres ledger. `npm run cost` here reads the same selection.

   The row contains `env-proposal`, model/wire, timing, usage/cost, scope and owner attribution. It contains neither target repo slug nor key names. The model request contains key names, but request bodies are not stored in spend rows.

## Fix first

1. Persist reviewed/rejected policy decisions and propose only genuinely new names.
2. Add a value-bearing CLI-to-model/ledger/SSH integration test.
3. Remove the staged secret file in `finally`, then correct the help/docs wording.

For the first hellozenno run after those fixes, watch the second setup confirmation’s script hash, HTTPS submodule authentication, availability of `python3-venv`, and the terminal status’s fingerprint/inode. On the first and second `push-env`, verify `FLASK_SECRET_KEY` and `SUPABASE_PASSWORD` remain unticked, local database URLs pass, and the second run neither re-asks the model nor changes saved rejections. No files or remote state were changed.