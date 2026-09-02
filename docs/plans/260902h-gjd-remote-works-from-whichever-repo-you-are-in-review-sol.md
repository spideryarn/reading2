The plan is not ready to build as written. The config decision is mostly contained, but the auto-clone objection is not yet answered: interrupted discovery, clone, or setup can still become a plausible “found and ready” checkout.

1. **Blocker — Stage 1, remote-checkout resolution; [`cloneFacts()`](/Users/greg/dev/spideryarn/reading2/scripts/gjd-remote.ts:1674).**  
   The four-way union is incomplete, and the acquisition path can silently manufacture `absent`. The existing scan ignores SSH/parse failures, has no completion marker or row count, and defaults missing facts to empty strings. A truncated reply can therefore become “no checkout found,” which Stage 2 would act on by cloning.

   It also cannot represent:

   - An occupied non-Git directory.
   - A Git directory with no/unknown origin.
   - An interrupted clone with `.git` and the right origin but no valid `HEAD`.
   - An unreadable candidate.
   - A symlink candidate.
   - A checkout at `~/code/<owner>/<repo>`; the current scan sees direct children only.

   An SSH origin is correctly normalizable by [`remoteSlug()`](/Users/greg/dev/spideryarn/reading2/scripts/gjd-remote.ts:1637), but on this box it is not fetchable. Calling that `found` is truthful only if `found` means “same identity,” not “usable checkout.”

   **Concrete change:** separate `collectRemoteFacts(): Result<Facts, ScanFailure>` from pure resolution. Give the wire format an exact row count, strict base64 fields, and a final sentinel. Scan supported depths 1 and 2 without following symlinks. Replace `occupied(dir, otherSlug)` with a blocked state carrying reasons such as `non-checkout`, `unrecognised-origin`, `incomplete-checkout`, `symlink`, and `unreadable`. Require a valid commit for `found`, and carry an `originTransport` diagnostic so `doctor` can fail an SSH-origin checkout without mistaking it for absent.

2. **Blocker — Stage 2, clone → setup → session; [plan lines 205–215](/Users/greg/dev/spideryarn/reading2/docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md:205).**  
   “No session after failed setup” holds only for the first invocation. A failed setup leaves the successfully cloned directory at its final path; the next `new-claude` resolves it as `found` and skips setup entirely. An interrupted clone can create the same problem. Concurrent invocations can also observe one another’s half-state.

   Foreground SSH is the wrong lifetime for `npm ci`, Docker pulls, and migrations. A sleeping laptop can cut the observer off while setup continues, dies, or is retried concurrently. A stdout nonce says whether one SSH stream finished; it does not provide durable attempt state.

   **Concrete change:**

   - Clone into a unique sibling staging directory, verify origin and `HEAD`, then atomically rename.
   - Hold a box-side `flock` for the target across resolution, clone, and setup.
   - Run setup/check in a dedicated tool-owned tmux job with an attempt id and an atomic status file under `~/gjd-remote/`.
   - Require `check` to pass before creating the final Claude/shell session.
   - On the next run, resume or report a pending/failed attempt; never treat checkout presence as readiness.
   - Remove `--no-setup` from `new-*`; explicit `gjd-remote clone` already is the clone-only escape hatch.

3. **Blocker — Stage 1 and Stage 3, target-selection contract; [plan lines 191–194](/Users/greg/dev/spideryarn/reading2/docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md:191), [`cmdPushEnv()`](/Users/greg/dev/spideryarn/reading2/scripts/gjd-remote.ts:1480).**  
   “`--dir` unchanged” is factually wrong: `push-env`, `clone`, `setup`, and `doctor` do not currently share a `--dir` contract. More importantly, a remote path is not enough to select a local config or env policy. Allowing `GJD_REMOTE_REPO`/`--dir` to win without origin verification preserves the exact invisible cross-repo redirect the earlier review warned about.

   **Concrete change:** introduce three named roots and a command matrix:

   - `TOOL_ROOT`: Terraform state, `provision.sh`, `remote-smoke-browser.mjs`, and the OpenRouter credential loaded by `src/env.ts`.
   - `LOCAL_TARGET_ROOT`: the selected repo’s default `.env.local`.
   - `REMOTE_TARGET_ROOT`: setup, target MCP declarations, and the session cwd.

   Terraform and browser smoke stay tool-owned. `.mcp.json` follows the verified remote target checkout. The default env file follows the local target toplevel and must be a regular, non-symlink file directly under it. `push-env`, `setup`, and repo-doctor require an identity and verify any path override has the same origin. `new-* --dir ~` may remain an explicitly arbitrary directory, but then `GJD_REPO` is unknown. A deprecated `GJD_REMOTE_REPO` that disagrees with cwd must refuse, not merely warn.

4. **Blocker — per-repo config and the one-prompt design; [plan lines 128–159](/Users/greg/dev/spideryarn/reading2/docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md:128).**  
   Unknown-key rejection answers schema creep reasonably well, but it does not create an authority boundary. An arbitrary `setup` string can use `sudo`, alter `~/gjd-remote`, tmux state, Git/SSH configuration, token files, or other checkouts. That cannot be sandboxed while every repo runs as the same passwordless-sudo user. The true guarantee is only that config cannot alter the laptop’s chosen host/path/env policy through a parsed field.

   There is also no reliable command to display in the one pre-clone prompt. Local config may differ from the default branch cloned on the box, and `--repo` outside a local checkout has no local config at all.

   **Concrete change:** use two consent points: confirm the clone, then read and validate config from the cloned commit, display the exact escaped command or script path/hash, and confirm execution. If one prompt is mandatory, clone the exact local commit and byte-compare the config before execution; otherwise refuse. Validate an exact top-level TOML object with only non-empty bounded strings, report parse errors by file/line/column without echoing source, and require `check` for the automatic path. Explicitly document the same-user box authority. Add `ForwardAgent=no`, no TTY, no stdin, and a small explicit environment.

5. **Should-fix — Stage 3, saved env policy; [plan lines 226–241](/Users/greg/dev/spideryarn/reading2/docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md:226).**  
   Letting the model pre-tick newly discovered keys weakens the present guarantee that a new key is skipped until a person deliberately adds it. Pressing Enter on a model-selected default is materially weaker than selecting the key.

   **Concrete change:** only previously human-approved keys may be pre-ticked. Every key absent from the saved policy starts unchecked; the model supplies a recommendation and reason, not the default state. Disable the two forbidden names and non-loopback database values in the UI, then reapply the guards after selection. “Select all” must select only eligible keys.

   Save through a `0700` directory using a non-symlink temporary file, atomic rename, explicit `chmod 0600`, and readback verification. Validate model output as an exact subset of the supplied key names; reject duplicates/unknown names and strip control characters and newlines from descriptions.

6. **Should-fix — Stage 3, value-leak proof; [plan lines 85–88](/Users/greg/dev/spideryarn/reading2/docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md:85).**  
   The existing gateway is well designed for this: malformed JSON does not expose a `SyntaxError` containing response text, provider bodies are discarded, and spend rows carry metadata rather than request bodies. If the request is constructed strictly from names, there is no intended value path into the prompt, checkbox descriptions, log, spend row, or saved policy.

   The proposed sentinel test nevertheless covers only “extracted names, prompt body, or output,” not all claimed sinks. A new parser that propagates its raw exception is the most plausible leak.

   **Concrete change:** reuse the existing redacted `scanEnv` behavior instead of a second parser, and intercept all of these in one test: serialized provider request, stdout, stderr, thrown error text, checklist choices/descriptions, local log line, spend sink row, and saved TOML. Exercise malformed env syntax and malformed model JSON as well as success. None may contain the sentinel value.

7. **Should-fix — paid-call plumbing; [plan lines 117–118](/Users/greg/dev/spideryarn/reading2/docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md:117), [`openRouterJson()`](/Users/greg/dev/spideryarn/reading2/src/ai-call.ts:1025).**  
   `AI_JOB_ROUTE + spend declarations` is not the complete or correct integration. A new job must also extend `AiJob`, `AI_JOB_WIRE`, the model inventory/policy, and their exhaustive tests. `src/spend-declarations.ts` is for declared gateway bypasses; a normal `openRouterJson` call should not be added there.

   More importantly, the CLI currently opens no spend ledger. The gateway will make the call, warn that no collector is open, and drop the row. [`main()`](/Users/greg/dev/spideryarn/reading2/scripts/gjd-remote.ts:2468) is synchronous, so it also needs an awaited async seam. `no-undeclared-spend` does not prove accounting; its current allow-entry even describes `gjd-remote.ts` as having “no transport” ([test line 136](/Users/greg/dev/spideryarn/reading2/tests/no-undeclared-spend.test.ts:136)).

   **Concrete change:** put proposal logic in a separate module, add a proper `env-proposal` job across the exhaustive routing/model maps, load the tool-root env, and await `withLedger("cli", ...)` around the call. Add a red-first test proving one proposal attempt produces exactly one spend row, including malformed-response and provider-failure cases.

8. **Should-fix — Stage 1 tmux migration; [plan lines 195–198](/Users/greg/dev/spideryarn/reading2/docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md:195), [`parseSessionLine()`](/Users/greg/dev/spideryarn/reading2/scripts/gjd-remote-tmux.ts:431).**  
   The promised behavior is impossible without a version discriminator. Every live session is rendered by the new listing script, so an empty `GJD_REPO` looks identical whether the session predates the change or a new session lost its required metadata.

   **Concrete change:** new sessions get `GJD_METADATA_VERSION=1`; the record carries version plus repo. No version plus no repo is a legacy row and displays `(unknown)`. Version 1 requires a valid repo and directory or the whole listing fails. Test a mixed reply containing both a legacy session and a malformed new session. If setup uses tmux, add a typed `GJD_KIND=setup|claude|shell` rather than making setup jobs masquerade as shells.

9. **Should-fix — stage order and v1 scope; [plan lines 179–265](/Users/greg/dev/spideryarn/reading2/docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md:179).**  
   Stage 2 composes the riskiest workflow before the readiness check in Stage 4 and before generic env handling in Stage 3. That makes clone-then-setup depend on pieces that do not yet exist.

   **Concrete change:** reorder to:

   1. Identity, strict remote inventory, target contract, tmux/log metadata.
   2. Config parsing, explicit durable `setup`, mandatory `check`, and repo-doctor.
   3. Generic `push-env`, proposal UI, persistence, and ledger.
   4. Transactional auto-clone orchestration using those proven pieces; provisioning.
   5. Hellozenno end to end.

   Cut package.json `setup` inference—the `.gjd-remote/setup` convention already supplies the zero-config path—and cut `--no-setup` as redundant with `clone`. Add hellozenno’s “kill whichever process owns 5173” fix to Stage 5; otherwise its first normal startup can terminate Spideryarn within a week even though clone/setup passed.

10. **Should-fix — log schema; [`LogRecord`](/Users/greg/dev/spideryarn/reading2/scripts/gjd-remote-log.ts:58).**  
    The plan adds repo identity to tmux but not to the durable laptop log. A directory is not identity—the existing `reading2`/`spideryarn2` mismatch is the motivating example—and failed setup attempts currently have no durable repo-aware record.

    **Concrete change:** add a validated `repo` field to launch/setup records and record setup attempt start/outcome by attempt id. Keep selected keys, model reasons, config command contents, and all values out of the log. Update the schema/version handling deliberately rather than letting readers ignore an unknown field.

11. **Nit — prompt integration; [plan lines 216–222](/Users/greg/dev/spideryarn/reading2/docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md:216).**  
    The current `interactiveStdin()` returns `"inherit"` whenever stdin has not been consumed—even if it is a non-TTY pipe. That is insufficient for the new prompts. It also returns an fd, while Inquirer expects a `Readable`. Stage 3 names `@inquirer/checkbox` although the direct dependency chosen is `@inquirer/prompts`.

    **Concrete change:** add a `promptStreams()` helper that always verifies a controlling TTY, wraps `/dev/tty` as a non-closing `Readable`, supplies a TTY output stream, and maps Ctrl-C/`ExitPromptError` to exit 130 with no mutation. Import both `confirm` and `checkbox` from `@inquirer/prompts`. Test piped stdin, `-p -`, redirected output, and Ctrl-C.

12. **Should-fix — “How each guard is made to go red”; [plan lines 273–286](/Users/greg/dev/spideryarn/reading2/docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md:273).**  
    Two rows cannot support their claim as written:

    - “New-format record missing repo” cannot coexist with legacy acceptance until a metadata version exists.
    - “Setup exits 1 → `tmux new-session` never runs” assumes a command-log injection seam not planned, and becomes the wrong assertion if setup correctly runs in its own tmux job. Assert that no final Claude/shell session or Claude process exists instead.

    Several other rows test the pure decision while leaving the dangerous acquisition boundary untested. Add red controls for:

    - Truncated/failed remote scan, bad row count, nested checkout, symlink, unreadable directory, partial clone, and concurrent clone.
    - SSH local and remote origins, no origin, submodule, and unrecognized origin.
    - Failed setup followed by a second `new-*`.
    - Exact final setup marker/status, including output after a marker and a stale marker from a prior attempt.
    - Both forbidden token names and database URLs with malformed syntax, embedded loopback text, `host=` and `hostaddr=` overrides.
    - A new env key remaining unchecked despite the model recommending it.
    - Existing `0644` policy file and policy-path symlink.
    - Wrong TOML types/tables and redacted syntax errors.
    - Mixed legacy/new tmux sessions.
    - One proposal call producing one persisted spend record.
    - The full value-sentinel sink list from finding 6.

The three changes I would make first:

1. Replace `cloneFacts` reuse with a strict, sentinel-protected inventory and a complete blocked-state model.
2. Design clone/setup as one locked, durable, resumable box-side transaction with persistent readiness and a mandatory independent check.
3. Write the command-by-command target contract—tool root, local target root, remote target root, and exact `--repo`/`--dir` behavior—before changing `sessionDir()` or `push-env`.

No files or remote state were changed.