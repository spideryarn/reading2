## Verdict: STOP before apply

As written, Terraform cannot evaluate the configuration. After the two blockers are fixed, there are several rebuild, browser, and security problems worth fixing before first use.

### Ranked findings

1. **BLOCKER — certain: an unescaped interpolation exists in a comment.**

   [`cloud-init.yaml:6`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:6) contains `${like_this}`. `templatefile()` parses comments, so Terraform looks for a variable named `like_this` and fails during planning. It will not silently substitute an empty string. Terraform documents `${…}` as interpolation and `$${…}` as the literal escape. [HashiCorp template syntax](https://developer.hashicorp.com/terraform/language/expressions/strings)

   Smallest fix: change it to `$${like_this}` or remove the syntax from the comment.

2. **BLOCKER — certain: Terraform does not expand `~` in `file()`.**

   [`variables.tf:39`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/variables.tf:39) defaults to `~/.ssh/id_ed25519.pub`, used by [`main.tf:29`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/main.tf:29) and [`main.tf:96`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/main.tf:96). Terraform will try to open a literal path beginning with `~`.

   Smallest fix: use `file(pathexpand(var.ssh_public_key_path))` in both places. [HashiCorp `pathexpand`](https://developer.hashicorp.com/terraform/language/functions/pathexpand)

3. **HIGH — speculative trigger, certain failure behaviour: late/missing attachment produces a silently incomplete server.**

   The attachment at [`main.tf:109`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/main.tf:109) cannot happen until after the server has been created and started. The explicit `depends_on` at line 106 only waits for the volume; the existing `volume_id` interpolation already provides that dependency.

   If the device misses the 60-second window at [`cloud-init.yaml:105-109`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:105), `exit 0` terminates the entire generated `runcmd` shell script—not just that YAML item. Node, browser setup, MCP configuration, fail2ban and the SSH restart are all skipped. Cloud-init still reports success and, because `runcmd` is once per instance, a later attachment does not self-heal. [Cloud-init `runcmd`](https://cloudinit.readthedocs.io/en/latest/topics/modules.html?highlight=growpart)

   In practice package upgrades will usually give Terraform enough time to attach it, but this is not guaranteed.

   Smallest safe fix: make the volume a prerequisite, not an optional fallback. Use a retrying boot-time unit that mounts/binds it, and refuse to continue setup until `mountpoint -q /home` succeeds. At minimum, fail nonzero and require a post-apply `cloud-init status --wait --long` check.

4. **HIGH — certain: Terraform protection does not protect the volume as strongly as the comments imply.**

   [`main.tf:35-46`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/main.tf:35) is safe against ordinary Terraform replacement while the lifecycle block remains. There is no cloud-init reformat path: `mkswap` only touches `/swapfile`, and Hetzner’s `format = "ext4"` formats at volume creation. [Provider volume documentation](https://github.com/hetznercloud/terraform-provider-hcloud/blob/main/docs/resources/volume.md)

   But `prevent_destroy`:

   - Does not protect against deletion through Hetzner’s console/API.
   - Does not protect after the resource configuration is removed.
   - Makes a whole-module `terraform destroy` fail at planning; it does not destroy the server while conveniently leaving the volume. [Terraform lifecycle documentation](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle)

   Smallest fix: also set `delete_protection = true` on the volume. Retirement then deliberately disables both protections first.

5. **HIGH — certain: both MCP servers are installed for the wrong scope.**

   At [`cloud-init.yaml:152-153`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:152), `claude mcp add` defaults to local scope. Because the command runs from `/home/greg`, the servers are registered only for that “project”; they will not load in repositories below it.

   Smallest fix: put `--scope user` before each server name, then verify from an actual repository with `claude mcp list`. Remove the unconditional `|| true`, or follow it with a real verification. [Claude Code MCP scopes](https://code.claude.com/docs/en/mcp)

6. **HIGH — certain: the Playwright configuration cannot support parallel sessions.**

   Every MCP process uses `/home/greg/.pw-profile` at [`cloud-init.yaml:152`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:152). Playwright states that one persistent profile can be used by only one browser process. Parallel Claude sessions will contend for its lock. [Playwright MCP profiles](https://github.com/microsoft/playwright-mcp)

   Smallest fix: use `--isolated`, or allocate a distinct user-data directory per session. A single shared authenticated profile and unrestricted parallelism are incompatible.

7. **HIGH — certain: `chrome-devtools-mcp` lacks its required browser and usable display.**

   [`cloud-init.yaml:153`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:153) starts it with defaults, but only Playwright Chromium is installed. Chrome DevTools MCP requires current stable Chrome. It also defaults to headed operation, while Xvfb is only started manually by `start-vnc`. [Chrome DevTools MCP requirements](https://github.com/ChromeDevTools/chrome-devtools-mcp)

   Smallest fix for unattended use: install Chrome stable and add `--headless`. For visible sessions, explicitly start a managed Chrome under Xvfb and connect the MCP using `--browser-url`.

8. **HIGH — certain: provisioning failures are largely silent.**

   All 12 `runcmd` entries parse as strings and become one `/bin/sh` script. There is no `set -e`, and important failures are explicitly hidden with `|| true`. A failed NodeSource download, npm install, browser download or MCP setup can be followed by a successful SSH restart, making cloud-init look successful.

   Smallest fix: enable fail-fast behaviour, run pipelines through Bash with `pipefail`, and end with explicit checks for the mount, `claude`, browser executables and both MCP registrations.

9. **HIGH — certain architectural risk: every agent is effectively root and shares every credential.**

   [`cloud-init.yaml:14-20`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:14) gives the single agent account passwordless unrestricted sudo. All sessions share its processes, Claude credentials and browser profiles. One prompt injection, malicious repository script, or compromised `npx ...@latest` release compromises every session and the whole server.

   Smallest meaningful fix: separate the SSH/admin account from the agent account, remove unrestricted sudo after provisioning, pin MCP versions, and isolate autonomous sessions in containers or Claude’s sandbox. Anthropic says bypass-permissions offers no prompt-injection protection and should be used only in isolation. [Claude permission-mode guidance](https://code.claude.com/docs/en/permission-modes)

10. **MEDIUM — certain mechanism, environment-dependent impact: `99-hardening.conf` may lose to an earlier snippet.**

    OpenSSH uses the first value encountered for most directives. Ubuntu loads `sshd_config.d` lexically, so an earlier `50-*.conf` can win over [`cloud-init.yaml:44`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:44). [Ubuntu OpenSSH guidance](https://ubuntu.com/server/docs/_/downloads/en/latest/pdf/)

    Smallest fix: name it `00-hardening.conf`, add top-level `ssh_pwauth: false`, and run `sshd -t` before restarting. Confirm with `sshd -T`.

11. **MEDIUM — certain: key rotation adds the new key but never revokes the old one.**

    [`cloud-init.yaml:128-131`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/cloud-init.yaml:128) appends and deduplicates. A compromised old key remains valid forever.

    Smallest fix: if this is intentionally a single-key box, replace the managed key rather than append it. Otherwise use a separately managed authorized-key file so manually added keys and the Terraform-managed key have distinct ownership.

### Cold boot versus rebuild

- **Cold boot:** after fixing findings 1–2, the user/key is created before `runcmd`; the volume is then mounted, seeded and bind-mounted before browser downloads or MCP writes. That happy-path ordering is correct.
- **Rebuild:** provided the attachment arrives, the current key is copied into the persisted home before the bind mount, so the bind does not lock the user out. UID 1000 should remain stable on a clean Ubuntu image.
- The stated cloud-init order is slightly wrong: canonical Ubuntu runs `write_files` before `users_groups`, not after it. The current SSH outcome remains safe because the configuration is restarted later, after user creation. [Canonical module order](https://github.com/canonical/cloud-init/blob/main/config/cloud.cfg.tmpl)

### Confirmed correct

- Mosh’s TCP SSH bootstrap plus UDP `60000-61000` rule is correct and sufficient. [Mosh documentation](https://mosh.org/)
- Hetzner firewalls are stateful; with no outbound rules, outbound traffic and corresponding replies are allowed. [Hetzner firewall FAQ](https://docs.hetzner.com/cloud/firewalls/faq/)
- `automount = false` is appropriate when managing mounts yourself.
- The provider attributes appear valid. `~> 1.48` allows all later 1.x releases; commit the generated lock file for reproducibility.
- Terraform’s explicit `depends_on` is redundant and does not solve attachment ordering.
- Swap reduces some OOM risk, but it does not bound unlimited Node processes; swap exhaustion or thrashing can still make SSH unusable. Add per-session memory/process limits rather than treating 8GB swap as a guarantee.

Terraform was not installed locally, so I could not run `terraform validate`; I did parse the rendered-shape YAML successfully after substituting dummy values. No files were changed.