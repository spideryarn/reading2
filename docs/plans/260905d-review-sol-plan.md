## Verdict

Revise before implementation. The core idea and ordering are sound, but F1–F3 are established P1s, so I would not approve the plan yet.

### Findings

1. **F1 — P1, established: the retained `profile.d` export bypasses the new parser.**

   (a) The plan makes the environment authoritative, then proposes copying the file into that environment ([plan:68](</home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/docs/plans/260905d-gjd-remote-resolves-the-box-address-without-an-env-var.md:68>), [plan:77](</home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/docs/plans/260905d-gjd-remote-resolves-the-box-address-without-an-env-var.md:77>)). In a login shell, a malformed but non-empty file therefore becomes `GJD_REMOTE_HOST`; the resolver takes the existing env branch and never performs the promised file validation. Even a valid file would be reported as coming from the environment, defeating the proposed provenance line.

   (b) Delete plan item 3. Provisioning should remove the legacy `/etc/profile.d/gjd-remote-loopback.sh`. Once the resolver reads `/etc/gjd-remote-host`, the login-shell export has no remaining benefit; reserve `GJD_REMOTE_HOST` for genuine explicit overrides.

2. **F2 — P1, established: the proposed provisioning check cannot run on every box provisioning supports.**

   (a) A fresh box is bootstrapped and then receives only `provision.sh`; provisioning precedes any repository clone ([box doc:124](</home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/docs/project/hetzner-remote-server-box.md:124>), [cloud-init:144](</home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/infra/hetzner/cloud-init.yaml:144>)). Therefore `provision.sh` cannot generally run `scripts/gjd-remote.ts` or import the new module. Making that a required verify check either breaks first-time provisioning or requires a skip that would not catch today’s bug.

   (b) Split the evidence:

   - Provisioning verifies the exact file contract and authenticates through the address read from that file.
   - Unit/integration tests prove the resolver selects the file with the env absent.
   - Stage 2 runs the real CLI from the existing checkout on the live box as a post-apply smoke test.

   Uploading enough application source merely to let provisioning test it would be needless machinery.

3. **F3 — P1, established: “parses” does not establish that the chosen address matches the SSH configuration.**

   (a) The file could contain a syntactically valid public or non-loopback IP. “File exists and parses” would pass, while the existing SSH verification still tests the separately hard-coded `127.0.0.1` ([provision.sh:1119](</home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/infra/hetzner/provision.sh:1119>)). The CLI would then use an address for which the loopback identity block does not apply. That directly breaks the box-side invariant.

   (b) For this version, define the managed file as exactly one logical line containing `127.0.0.1`, optionally terminated by one LF. The explicit env override can remain general. Provisioning should also read that value and use it in the loopback SSH probe, so the address and authentication checks cannot disagree.

4. **F4 — P2, reasoned: the file’s I/O and trust contract remains underspecified.**

   (a) Empty content, multiple lines, `EACCES`, `EISDIR`, and symlinks are not covered by “does not parse.” A broad catch could turn an unreadable file into “absent” and fall through. Conversely, `cat >` preserves a pre-existing file’s ownership and follows a symlink, so it does not itself establish the promised root-owned regular file.

   (b) Put this matrix in the plan:

   - Only `ENOENT` means absent.
   - Every other read/stat error dies naming the path and OS reason.
   - Empty, extra lines, extra whitespace, and any value other than `127.0.0.1` die naming the path.
   - Reject non-regular files and symlinks.
   - Provisioning writes a temporary root-owned `0644` regular file and renames it over the destination, then verifies owner, mode, shape, and content.

   `/etc` is disposable and the file is wholly managed, so full replacement is correct; it does not need the append-marker treatment used for persistent, partly human-owned `~/.ssh/config`.

5. **F5 — P2, established: Stage 1’s completion criterion depends on Stage 2.**

   (a) Stage 1 says the box command must work ([plan:88](</home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/docs/plans/260905d-gjd-remote-resolves-the-box-address-without-an-env-var.md:88>)), but the file that makes it work is not installed until Stage 2. Also, a test going red because its imported module does not exist proves only an import failure, not the fallback behavior.

   (b) Make Stage 1 complete on focused resolver tests plus the unchanged laptop path. Move all real box commands to Stage 2 after provisioning. For red-first evidence, scaffold an executable resolver with the old env→Terraform behavior and require the new assertion to fail for the intended reason.

6. **F6 — P2, established: `resolve` alone is not the best place to expose provenance.**

   (a) `resolve` first requires a recognizable repository ([gjd-remote.ts:1679](</home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/scripts/gjd-remote.ts:1679>)). Host troubleshooting may happen from `$HOME`, cron, or a damaged checkout. `doctor --box-only` already works without repo identity, prints the chosen address, and actually SSHs to it ([gjd-remote.ts:4676](</home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/scripts/gjd-remote.ts:4676>)).

   (b) Have the resolver return `{ address, source }` and include the source in doctor’s existing heading, for example `gjd-remote → 127.0.0.1 (from /etc/gjd-remote-host)`. Keeping it in `resolve` too is cheap. Do not add a separate doctor check row: resolving and then passing doctor’s SSH check is already the relevant outcome.

7. **F7 — P3, established: the plan omits existing authoritative help text.**

   (a) `--help` currently says the default is always Terraform ([gjd-remote.ts:5312](</home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/scripts/gjd-remote.ts:5312>)), and the `host()` docblock makes the same claim ([gjd-remote.ts:253](</home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/scripts/gjd-remote.ts:253>)). Both become false.

   (b) Add the help text, docblock, and the project doc’s module inventory to Stage 1’s manifest.

### Decisions I would keep

The order should remain **env → file → Terraform**. The environment is an explicit per-invocation override; the file is machine-local configuration; Terraform is the laptop fallback. Terraform-first only protects against an unexpected laptop file, while creating a latent box failure if `tofu` and state ever appear there. The safer response to an unexpected file is strict provenance and validation, not lower precedence.

The trust boundary is acceptable. Reading root-controlled `/etc` does not materially widen authority: the same caller can already set `GJD_REMOTE_HOST`, and an agent with sudo can already alter SSH and the tool itself. The important concern is operational misdirection, addressed by exact loopback content and enforced file ownership.

Baseline evidence only: the permitted tmux suite passed, 107/107 tests. It does not exercise this proposed resolver.