# Split provisioning out of cloud-init, to fit the `user_data` cap

`user_data` is capped at 32 KiB by the Hetzner API. Ours renders to **78.8 KiB**, so a rebuild would
be rejected at server creation. Nothing is broken today, and nothing could have told us: the live box
was built when `provision.sh` still lived inside `cloud-init.yaml` and the whole thing was ~18 KiB,
it went over the line when the script was extracted on 2026-08-31, and no apply has created a server
since. Re-running `provision.sh` on a live box — the path we actually use — does not go through
`user_data` at all, and Terraform stores only a SHA-1 *hash* of the field, so `tofu plan` is blind
too. `scripts/check-cloud-init.ts` now measures it and fails.

**The plan: stop shipping `provision.sh` through `user_data`.** cloud-init keeps doing everything
else it does today; a new `gjd-remote provision` copies the script up and runs it — which is already
how it is usually run, just undocumented.

## The measurements

Every number below is the rendered `user_data`, against the 32,768-byte cap. gzip at Go's default
level, which is what `base64gzip()` uses.

| option | bytes | vs cap |
| --- | ---: | ---: |
| today | 80,672 | **OVER +47,904** |
| `write_files` `encoding: gz+b64` for both scripts | 34,516 | **OVER +1,748** |
| ...and the credential helper folded into `provision.sh` | ~33,800 | **OVER +1,000** |
| whole payload `base64gzip()`, scripts still `b64` inside | 45,332 | **OVER +12,564** |
| `gz+b64` and comment lines stripped from `provision.sh` at render time | 17,728 | OK −15,040 |
| **this plan: cloud-init without `provision.sh`** | **13,359** | **OK −19,409** |

Components: `provision.sh` 50,342 raw / 67,124 b64 / 25,144 gz+b64; the credential helper 5,833 raw /
7,780 b64 / 3,648 gz+b64; `cloud-init.yaml` itself 5,768.

## The simpler options, and why they were passed over

**Compress it (`encoding: gz+b64`).** The obvious first move, and it does not fit: 34,516 against
32,768. Even with the credential helper folded in it lands ~1 KiB over, and a variant that squeezed
the remaining inline files under the line would have a few hundred bytes of headroom — which is not
a fix, it is the same failure rescheduled for whoever adds the next provisioning step.

**Compress the whole payload.** cloud-init's Hetzner datasource base64-decodes `user_data` and then
gunzips it — `self.userdata_raw = util.maybe_b64decode(ud)` in `DataSourceHetzner.py`, added by
cloud-init PR #448 in 20.3, and present on the live box (cloud-init 26.1, Ubuntu 24.04). So
`base64gzip()` of the whole payload genuinely works here. GPT Sol believed it was impossible; it is
not, and that is worth recording so nobody re-derives it.

It does not help as it stands: the scripts inside are already base64, which gzip compresses badly,
so the result is 45,332. Inlining them as plain YAML text and compressing the lot is the version
that fits — Sol measured **~31.6 KiB, about 1.2 KiB spare**. Rejected for that headroom, which is
the same failure rescheduled, and for keeping the whole build inside a first-boot monolith. Note the
Terraform-parser objection is *not* a reason: `indent(6, file("provision.sh"))` inserts the contents
as a value and they are not re-parsed, so the shell's `${...}` stays literal. An earlier draft of
this plan said otherwise and was wrong.

**Strip comments at render time.** Fits easily (17,728) and keeps one command. But the file on the
box stops being the file in the repo: on-box debugging is against a stripped script, and
`check-cloud-init.ts` has a whole section asserting that the file it checks is the file that boots.
(The `script-sha256` the box stamps would still be a real hash of a deterministic artefact — just
not of anything checked in. Source-and-deployed identity is the honest objection, not the hash.)

**Move the package installs into `provision.sh` as well** — the fuller version of this split, which
GPT Sol proposed. It is a bigger change than it looks: cloud-init installs `rsync`, `curl`, `gnupg`,
`jq` and others that `provision.sh` uses in its first few steps, so package ownership would have to
move too. Not needed to get under the cap, so not done. Recorded here because it is the natural next
step if cloud-init ever grows again.

**Fetch `provision.sh` from a URL at boot.** Removes the ceiling, needs hosting and a credential
available at first boot — and this box's GitHub tokens are deliberately pasted in by hand *after*
boot. **A prebuilt snapshot** removes it too, at the cost of an image build-and-patch lifecycle for
one box.

## What changes

1. **`cloud-init.yaml`** loses the `/usr/local/sbin/provision.sh` `write_files` entry and the
   `runcmd` that runs it. Everything else stays: the packages, sshd hardening, fail2ban, the
   AppArmor profile, `start-vnc`, and `/etc/gjd-provision.env`.
2. **`runcmd` writes the honest state instead** — `/var/log/gjd-provision-status` saying provisioning
   has never run and naming the command that runs it. An absent file and a never-provisioned box
   would otherwise look the same as a box whose status file someone deleted.
3. **`final_message`** says the next step is `gjd-remote provision`, not "read the provision log".
4. **`main.tf`** drops `provision_b64`.
5. **`gjd-remote provision`** — the new command, and the whole plan turns on it not lying. In order:

   - **Two waits.** ssh may not answer at all straight after `tofu apply`, so a bounded
     reachability retry first — refusing immediately on a changed host key or an auth failure rather
     than retrying — and only then `cloud-init status --wait`. Its exit codes carry meaning: `0` is
     done, `2` is "done, with recoverable errors" and is a refusal here, and a timeout is a refusal.
     *Amended 2026-09-03:* the verdict describes the first boot for ever, and the box this was
     built for had already recorded `error` on its first boot before the split — so a bad verdict
     is overridden by the bootstrap artefacts being present (`cloudInitGate`, which asks for the
     same list `provision.sh` checks first); "still running" and "artefacts missing" stay refusals.
     [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md#building-a-box).
   - **Stage in `/tmp`, install to `/usr/local/sbin`, run from there.** Not from `/home`:
     `provision.sh` bind-mounts the volume over `/home` partway through its own run, so a script
     executing from under `/home/greg` would have `$0` change meaning underneath it. It would also
     be root running code from a user-writable path.
   - **Hash the installed file**, not the uploaded one, before running anything.
   - **`flock`**, so two provisions cannot race on apt, the log and the status file.
   - **An attempt id**, minted here and written into the status file by `provision.sh`. Without it
     the previous run's `PROVISION OK` is still sitting there, and an upload or a `sudo` that fails
     before the script starts would be reported as *this* run succeeding. The verdict needs all of:
     the remote wrapper exited 0, the status file carries **this** attempt id, its `script-sha256`
     matches the file we sent, and it says `PROVISION OK` with no `FAIL` lines.
   - **`tee` inside the root wrapper with `pipefail`**, not `sudo … | tee`, where `tee` is
     unprivileged and owns the pipeline's exit status.
   - **Runs the local preflight first**, so a `provision.sh` that will not parse is caught here
     rather than on the box.
6. **`provision.sh`** stamps the attempt id into its status file, and gains an up-front dependency
   check. Keeping the package list in cloud-init means a new script can meet an old box whose
   immutable cloud-init never installed something the script now assumes; the check makes that say
   so before anything mutates. The ownership rule that follows: **bootstrap dependencies are fixed
   in cloud-init**, and anything newly needed is either installed by `provision.sh` itself or wants
   a rebuild.
7. **`check-cloud-init.ts`** keeps its size guard, which now passes with 19 KiB to spare, and its
   section-0 wiring assertions change shape: `provision.sh` is no longer injected by `main.tf`, so
   what must be asserted is that it is *not*.
8. **`gjd-remote doctor`** learns the new marker. Today a status file with no `FAIL` lines renders
   as `0 failed`, so an un-provisioned box would read as a healthy one; the marker needs an exact
   machine-readable `PROVISION NOT RUN` and doctor needs a branch for it.
9. **The docs**, including `provision.sh`'s own header, which still says it is injected into
   cloud-init, and the README's first-run walkthrough, which still describes provisioning happening
   by itself.

## What this costs

`cloud-init: done` stops meaning "the box is built" and starts meaning "the box is bootstrapped".
That is the semantic change to hold on to, and `final_message` is not where it can be enforced —
that text goes to cloud-init's own log and console, and nothing makes anyone read it.

A rebuild becomes two commands rather than one. That is honest rather than new: `tofu apply` has
never proved a box was ready, and the documented rebuild already has manual steps after it (the
GitHub tokens, `/login`, the MCP OAuth logins).

If phase two never runs, the box has ssh, the firewall, the user and the packages, and nothing else —
no node, no Claude, no docker, no mounted `/home`. The status file says so in words, and
`gjd-remote doctor` fails. Nothing calls that box ready.

## How it gets verified

`gjd-remote provision` can be tested end to end against the live box today, because `provision.sh` is
idempotent and re-running it is the normal thing to do. **The fresh-boot path cannot be tested
without creating a server**, and the honest options are a throwaway second server (a few cents, and
`main.tf` has a guard about building in a project that already holds servers we did not create) or
waiting until the next real rebuild. Ask Greg before doing either.

## Signposts

- [infra/hetzner/README.md](../../infra/hetzner/README.md) — the size problem and the preflight.
- [docs/project/hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) — `gjd-remote` and the box.
- [scripts/check-cloud-init.ts](../../scripts/check-cloud-init.ts) — the guard that found this.
