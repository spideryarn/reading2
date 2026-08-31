## Verdict: STOP before rebuild

The NodeSource configuration is basically correct, and the current failed volume can be rebuilt without losing SSH access. But two false-success paths remain—most importantly, cloud-init still cannot see `provision.sh` fail.

## Ranked findings

1. **BLOCKER — certain: `tee` still hides every provisioning failure from cloud-init.**

   [`cloud-init.yaml:313`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:313) is interpreted by `sh`; the pipeline’s status is therefore `tee`’s status, normally zero, not `provision.sh`’s. This exactly explains cloud-init reporting `done` after line 55 failed. Cloud-init documents that string-form `runcmd` entries are interpreted by `sh`. [Cloud-init `runcmd`](https://docs.cloud-init.io/en/latest/reference/modules.html#runcmd)

   Smallest fix:

   ```yaml
   runcmd:
     - bash -o pipefail -c 'bash /usr/local/sbin/provision.sh 2>&1 | tee /var/log/provision.log'
   ```

2. **HIGH — certain mechanism, speculative trigger: the Node fix can still accept a failed repository refresh.**

   `nodistro`, `Pin: origin deb.nodesource.com`, and priority 600 exactly match NodeSource’s current Node 26 setup script. The `origin` keyword matches the repository hostname, not its `Release` file’s `Origin:` field. [NodeSource’s current setup](https://github.com/nodesource/distributions/blob/master/scripts/deb/setup_26.x), [APT pin semantics](https://manpages.debian.org/testing/apt/apt_preferences.5.en.html)

   However, ordinary `apt-get update` can tolerate transient repository failures. Ubuntu 24.04 provides `--error-on=any` specifically to make any update error fatal. [Ubuntu Noble `apt-get`](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html)

   Smallest fix:

   ```bash
   apt-get -o DPkg::Lock::Timeout=600 --error-on=any update
   ```

   Then assert the candidate before installing—not merely the result afterwards:

   ```bash
   apt-cache policy nodejs
   ```

   Require `Candidate:` to begin with major 26 and come from the NodeSource index. Also run both key-download pipelines under `bash -o pipefail -c` and `chmod 0644` the keyrings.

3. **HIGH — certain: `--prompt` passes the literal text `$(cat …)` to Claude.**

   [`gjd-remote.ts:211`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:211) applies `shq()` to the entire command substitution:

   ```bash
   claude '$(cat /home/greg/gjd-remote/prompts/name.md)'
   ```

   Single quotes suppress substitution. I reproduced the generated shell command; its argument was literally `$(cat /home/greg/...)`.

   Smallest fix:

   ```ts
   `claude "$(cat -- ${promptPath})"`
   ```

   The path is already fixed from a validated slug, so it does not need another shell-quoting layer inside the substitution.

4. **HIGH — certain: a bad `--dir` silently launches Claude in `/home/greg`.**

   [`gjd-remote.ts:210`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:210) turns a typo into a successful session in the wrong repository:

   ```bash
   cd requested-dir || cd /home/greg
   ```

   This is exactly the silent-success class, with unusually expensive consequences: Claude may work on the wrong tree.

   Smallest fix: remove the fallback and make the job exit visibly if `cd` fails, or validate with `ssh("test -d ...")` before creating the session.

5. **HIGH — certain: the MCP memory cap may silently disappear.**

   [`cloud-init.yaml:274`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:274) retries *every* capped-add failure uncapped. A transient failure, duplicate registration, or quoting problem can therefore leave the exact OOM protection you intended absent while verification still passes.

   Smallest fix: remove the uncapped fallback. Current Claude Code supports `--env`; failure should stop provisioning. Then verify each entry with `claude mcp get <name>` and assert `NODE_OPTIONS`, the exact pinned package version, and arguments—not just grep the name from `list`. [Claude MCP commands](https://code.claude.com/docs/en/mcp)

6. **MEDIUM — certain: a later successful rebuild is not idempotent at MCP registration.**

   The immediate rebuild is unaffected because the failed run never reached MCP setup. But after a successful build, the user-scoped registrations persist on the volume, and current Claude Code rejects an add when that name already exists. The second rebuild can therefore die at `add_mcp`.

   Smallest fix: under the same timeout, remove each exact user-scoped entry first, ignoring only “not found,” then add it afresh:

   ```bash
   claude mcp remove --scope user playwright
   ```

7. **MEDIUM — certain: the verification block often checks artefacts, not effects.**

   The main holes are:

   - [`cloud-init.yaml:294`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:294): `mountpoint /home` does not prove it is the volume’s `/home`. Compare `stat -c %d /home /mnt/data/home` as well.
   - Line 300: a directory named `chromium-*` may be left by a failed download. Require the executable and run `--version`.
   - Lines 301–302: a disconnected MCP still prints its name. Require a connected status or launch-level check.
   - Line 303: an existing but invalid `.tmux.conf` passes. Parse it with a temporary tmux server.
   - `claude`, Chrome, Node and npm are checked as root. Check their versions through `su - "$USER_NAME"`.
   - AppArmor reload and apt-timer restart deliberately ignore failure and have no later checks.
   - `npm view` and both `claude mcp list` checks have no timeout, despite the “every step has a timeout” claim.

8. **MEDIUM — certain: default resume does not reliably choose the newest session, and failed attach becomes a successful shell.**

   [`gjd-remote.ts:321`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:321) takes the last line returned by `tmux ls`; it never sorts by `session_created`. Tmux provides explicit creation sorting, so the current order is not a newest-session contract. [`attachCmd()`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:109) then turns “session not found” into a login shell via `|| exec bash -l`.

   Smallest fixes:

   - Select the maximum `created` value in TypeScript or use `tmux list-sessions -O creation`.
   - Remove the shell fallback so a missing session fails visibly.

   The explicit `=name` usage for named attach and kill is correct and prevents prefix matching. [tmux target and sorting rules](https://man.openbsd.org/tmux.1)

9. **MEDIUM — certain: `start-vnc` can print success after all three background processes die.**

   [`cloud-init.yaml:77`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:77) treats successful background launch as successful service startup. `pgrep -f websockify` is also broad enough to match an unrelated instance.

   Smallest fix: after starting, check the exact processes plus listeners on 5900 and 6080; fail instead of printing tunnel instructions if either is absent.

10. **LOW — certain, locally controlled input: two shell-injection boundaries remain.**

   - `GJD_REMOTE_HOST` is interpolated unquoted into local `sh -c` commands at lines 91 and 109–119.
   - A `--dir` containing a newline followed by a line exactly equal to `REMOTEJOB` terminates the remote heredoc despite `shq()`, because heredoc bodies are parsed before shell quoting inside their contents matters.

   Smallest fix: use argument-array spawning for ssh/mosh and reject CR/LF in `dir`. Scping the job file, as you already do the prompt, would eliminate the heredoc boundary entirely.

## Node diagnosis

The preinstalled Node is explained: `novnc` at [`cloud-init.yaml:36`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:36) depends on Ubuntu’s `nodejs`, so cloud-init installed Node 18 while processing `packages:`. It was not part of the Hetzner base image. [Ubuntu Noble `novnc` dependencies](https://packages.ubuntu.com/km/noble/novnc)

The most plausible explanation for NodeSource exiting zero is also concrete. Its current script contains branches shaped like:

```bash
if ! apt update; then
    handle_error "$?"
fi
```

Inside that branch, `$?` is the status of the successful negation—zero—so `handle_error` exits zero. The same defect exists around several setup operations. Without the earlier part of the log I cannot prove which branch fired, but the script genuinely can fail and exit successfully.

Do not purge Ubuntu’s `nodejs`. A normal NodeSource `nodejs` upgrade replaces the package while continuing to satisfy `novnc`’s dependency. Purging first can remove `novnc`, and nothing currently checks that it survived.

For this box, NodeSource remains the best 80–20 choice:

- NodeSource: right for “latest available patch in major 26,” once update and candidate checks are strict.
- Official tarball: better only if you want one exact patch and SHA256; it makes security updates your job.
- `fnm`: worse here because it is per-user and depends on shell environment setup—the exact boundary your noninteractive ssh/tmux jobs already have to defend. [fnm shell setup](https://github.com/Schniz/fnm#shell-setup)

## Rebuild path

The current volume state is safe for this rebuild:

1. The failed build got as far as Node, so `rsync`, the key copy/seed, volume mount and `/home` bind all completed.
2. The new instance creates `/home/greg/.ssh/authorized_keys` on its root disk.
3. The script mounts the existing volume.
4. Because `/mnt/data/home` exists, it copies the new key into the volume **before** binding the volume over `/home`.
5. The bind hides the root-disk key only after the same key exists in the visible home.

So the bind does not lock you out. The remaining implicit assumption is that the same image recreates `greg` with the same UID; that is very likely here, but an explicit `uid` would make it a contract.

Use OpenTofu’s replacement workflow and inspect that the plan shows the server and attachment replaced while the volume is unchanged:

```bash
tofu -chdir=infra/hetzner apply -replace=hcloud_server.box
```

The README’s `terraform taint ... && terraform apply` mixes tool names and uses the deprecated taint workflow. OpenTofu recommends `-replace` because the replacement is visible in the reviewed plan. [OpenTofu replacement guidance](https://opentofu.org/docs/cli/commands/taint/)

## First-round disposition

Fixed correctly: Terraform escaping, `pathexpand`, attachment wait/fail, volume delete protection, key replacement, SSH snippet ordering, user-scoped MCPs, isolated Playwright profile, Chrome/headless setup, and exact tmux targeting.

Fixed incompletely: fail-fast propagation, MCP memory bounding, and end-state verification.

Still unresolved from round one: the single session user retains unrestricted passwordless sudo, and the AppArmor file merely permits future bubblewrap use—it does not isolate today’s Claude sessions.

Validation: the CLI passes a targeted TypeScript compilation. Targeted Biome checking reports seven existing lint errors, principally `main(): void` returning void expressions and switch clauses ending in `process.exit`; full project typecheck is currently blocked by unrelated dirty-tree errors in `src/pipeline.ts`. OpenTofu validation could not start the provider inside this read-only sandbox. No files were changed.