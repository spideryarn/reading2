## Verdict: STOP — three false-success paths remain

1. **HIGH — certain: `doctor` can report a stale provisioning success.**

   [`provision.sh`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/provision.sh:440) writes the status file only after all provisioning and verification. If one run writes `PROVISION OK`, then a later rerun fails anywhere before line 440, the old `PROVISION OK` survives. [`doctor`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:1040) will pass it as current.

   Smallest fix: write `PROVISION INCOMPLETE` with the new run time and script hash before the first fallible operation, then use an `EXIT` trap to preserve failure unless the final verification atomically replaces it with `PROVISION OK`.

2. **HIGH — certain: `shell` still has the wrong-directory race, and `new` has no visible failed state.**

   [`cmdShell()`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:485) checks the directory and later gives it to `tmux -c`. Tmux does not fail closed when `-c` disappears: its implementation falls back to the user’s home, then `/`. Thus the same reproduced race can create a healthy shell in `/home/greg`. [Tmux source](https://github.com/tmux/tmux/blob/master/spawn.c)

   For `new`, disappearing is safer than starting Claude in the wrong tree, but [`cmdNew()`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:462) may still print `✓ started` before the job exits. A failed `claude` invocation is worse: the script continues into a login shell, leaving a live-looking session with no Claude.

   Smallest fix: use an explicit `cd ... || exit 1` wrapper for shells too; configure `remain-on-exit failed`; include `pane_dead`, `pane_dead_status`, or an explicit session-state variable in `ls`. Tmux supports retaining only failed panes. [Tmux `remain-on-exit`](https://man.openbsd.org/tmux)

   Also quote the directory in the FATAL message at line 433. It is safely quoted for `cd`, but interpolated raw inside double quotes in the failure branch, so `$()`, backticks, and quotes in a deliberately unusual path become shell syntax if the race fires.

3. **HIGH — certain: `clone` reports success over the wrong repository.**

   At [`cmdClone()`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:776), any checkout at the requested destination prints a green success and exits 0. Only afterwards does it print a red note that the remote is not the requested repository.

   Smallest fix: return success only when `found === want`; otherwise `die()` with the two remotes. The sibling-twin check itself is sound.

4. **HIGH — certain helper-chain defect; wrong-owner trigger partly speculative: the credential helper is not fail-closed.**

   The helper exits non-zero for an unknown owner, malformed path, or wrong host. Git does not stop there: it tries the next configured helper. I reproduced a failing first helper followed by a broader helper supplying credentials. Git documents both helper accumulation and `quit=true`. [Git 2.50 credential documentation](https://git-scm.com/docs/gitcredentials/2.50.0)

   Provisioning currently adds the helper without resetting earlier helpers at [`provision.sh`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/provision.sh:280).

   The raw owner parsing also accepts shapes other than `owner/repo`: `gregdetre/../spideryarn/repo` selects the `gregdetre` token even though the request path may normalize elsewhere. `path=owner` is accepted too.

   Smallest fix:

   - Reset the helper list with an empty helper before registering this one.
   - Require exactly a valid `owner/repo[.git]` path.
   - On any refusal, emit `quit=true` and exit 0 so no later helper or prompt can bypass it.

   Empty and leading-slash paths currently fail safely. `github.com:443` is also refused safely, though that makes explicit-port URLs unsupported. `useHttpPath=true` is necessary and correct, but insufficient by itself.

5. **HIGH — certain mechanism, speculative trigger: the allowlist does not prevent production credentials under allowlisted names.**

   [`ALLOWLIST`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-env.ts:34) includes `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. If `.env.local` ever points at production—or `--file` names another directory’s `.env.local`—those production values are intentionally serialized. The banner’s claim that production credentials are absent is therefore stronger than the code.

   Smallest fix: validate that the Supabase/database values identify the local stack before pushing. Refuse non-loopback database and Supabase URLs unless there is a separate, explicit approval mechanism.

6. **MEDIUM — certain: `doctor`’s expected-check assertion proves bookkeeping, not execution.**

   The sole skip, mosh without a TTY, is named and summarized; it is not silent. The expected-name list is currently unique, and duplicate recordings fail.

   But the assertion is still defeatable:

   - Most tool checks accept exit 0 with empty or arbitrary output; only `jq` has an expected value.
   - [`runBrowserSmoke()`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:1077) accepts an empty script that exits 0.
   - The browser copy’s SCP exit is checked, but its bytes are not.
   - Session listing is printed inside doctor but is not an expected check.

   Smallest fix: require output patterns for every tool; require the browser’s success sentinel; compare local and remote SHA-256 before execution. Copying the smoke script every time is the right policy.

7. **MEDIUM — certain: `push-env` cannot leak an unlisted parsed key, but malformed input can silently remove allowed keys.**

   The good news: output is constructed by iterating `ALLOWLIST`, so `--file`, duplicates, CRLF, multiline values, and malformed extra lines cannot cause a non-allowlisted key to be emitted. CRLF and escaped newlines round-trip correctly.

   The remaining failures:

   - Duplicate keys silently use the last value.
   - An unterminated quote consumes all following lines, potentially turning several allowed keys into one value.
   - Other malformed lines are silently ignored.
   - Missing allowed keys are dim informational output, yet the command replaces the remote file and exits 0.
   - Readback is real—it performs a remote `cat`—but compares the result through the same parser. Malformed extra bytes or comments are not detected.

   Smallest fix: reject duplicates, unterminated quotes, and malformed non-comment lines; compare the raw remote bytes directly with `payload.text` before the semantic comparison.

8. **MEDIUM — certain: `ls` can turn an SSH/tmux failure into “no sessions.”**

   [`sessions()`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:271) suppresses SSH status and converts empty stdout into `[]`. Therefore `gjd-remote ls` can print “no sessions” and exit 0 when listing failed.

   Smallest fix: make the remote script emit an explicit sentinel for “tmux has no server”; treat every other SSH/tmux failure as an error. Count session enumeration in doctor if it is displayed there.

9. **LOW — certain: transcript parsing is not JSON-safe.**

   A genuinely incomplete `aiTitle` string is ignored, which is safe. But a partial line containing a complete title field is accepted even though the JSON object is incomplete. More importantly, an escaped quote truncates the title—`Fix \"doctor\" exit` becomes approximately `Fix \`—and the session is then permanently marked non-provisional.

   Smallest fix: parse only complete newline-terminated JSONL records with `JSON.parse`, ignoring the final partial record.

10. **LOW — certain: `tunnel` may continue without a tunnel.**

   [`tunnel`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:1282) lacks `ExitOnForwardFailure=yes`; a local port collision can leave SSH running after forwarding failed. It also opens a remote shell unnecessarily.

   Smallest fix: add the common SSH options, `-o ExitOnForwardFailure=yes`, and `-N`.

## What is missing entirely

The biggest month-two omission is checkout health. Nothing shows which remote checkouts are dirty, ahead, behind, detached, or unpushed. That is especially risky because the recovery plan explicitly says unpushed remote work has no backup.

Smallest useful addition: a read-only `repos` command that scans the checkout siblings and reports origin, branch, dirty state, and ahead/behind counts. Do not auto-push.

After that, add disk and inode usage to doctor. Persistent transcripts, npm caches, Docker state, and multiple checkouts make disk exhaustion much more likely than another missing executable.

## Confirmed sound

- `shq()` itself is correct POSIX single-quote escaping.
- Clone’s validated owner/repository/name inputs and quoted base/destination paths have no remaining direct injection hole.
- Every destructive or selecting tmux target in the supplied snapshot uses exact `=name`; `kill` cannot prefix-match another session.
- The allowlist construction prevents a non-allowlisted key from entering the generated env file.
- The browser smoke test’s behavioral assertions are strong once doctor requires its sentinel.

Validation was read-only. Shell/Node syntax checks passed, and I directly exercised the env edge cases and Git helper chaining on Git 2.50. Vitest could not start because the sandbox forbids its `.vite-temp` write; that is untested, not green. No files were changed.