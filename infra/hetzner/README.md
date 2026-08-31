# The Claude Code box

Terraform + cloud-init for the 24/7 Hetzner server that Claude Code sessions run on.
The decision behind it, the prices, and what was ruled out are in
[260831a-remote-server-for-claude-code.md](../../docs/research/260831a-remote-server-for-claude-code.md). Connecting
to it — mosh, tmux, one iTerm tab per session, and being told when a session wants you — is
[260831c-remote-server-tmux-mosh.md](../../docs/research/260831c-remote-server-tmux-mosh.md).

## The shape, in one paragraph

The **server is disposable** and the **volume is not**. The volume is bind-mounted over `/home`,
so repos, `~/.claude`, `~/.pw-profile` and everything else survive destroying and recreating the
machine. That is not tidiness — CX53 is the top of its line, so the only way to get more RAM is to
swap the server out from under the volume, and that is only cheap if nothing important was ever on
the server's own disk.

## First run

Zero to a box an agent can work on. Everything is scripted **except four steps that need a human in
a browser** — they are marked ⚑, and no amount of Terraform will remove them.

You need, on the laptop: OpenTofu (or Terraform) ≥ 1.5, a Hetzner Cloud project, a Read & Write API
token for it (Hetzner console → Security → API tokens), and an ssh keypair whose public half sits at
`ssh_public_key_path`.

```
export HCLOUD_TOKEN=...                        # env var only — the provider reads no file
cd infra/hetzner
cp example.tfvars terraform.tfvars             # then edit it; *.tfvars is gitignored
npx tsx ../../scripts/check-cloud-init.ts      # preflight — see "Before every apply"
tofu init
tofu plan                                      # READ IT, every time
tofu apply
tofu output                                    # ip, and the ssh/mosh/tunnel command lines
```

**Then wait about eight minutes and check that provisioning actually worked.** `apply` returning is
not evidence, and neither is `cloud-init: done` — both have reported success over a dead provision,
which is why the status file exists:

```
ssh greg@<ip> 'cat /var/log/gjd-provision-status; tail -3 /var/log/provision.log'
```

It must say `PROVISION OK`. `PROVISION INCOMPLETE` means it died partway and the log says where.
Anything else — an empty file, no file — means it never got as far as writing one.

Then, in this order, from the repo root on the laptop:

1. ⚑ **Log Claude Code in.** `ssh -t greg@<ip> claude`, then `/login`. Nothing below works until
   this is done. It lands in `~/.claude`, which is on the volume, so a *rebuild* keeps it — this is
   a per-box step, not a per-apply one.
2. ⚑ **Issue the two GitHub tokens** and paste them onto the box —
   [Giving the box GitHub access](#giving-the-box-github-access). Until this is done the box can
   clone nothing, and the error it gives says `Repository not found`.
3. **Clone the repo.** `npx tsx scripts/gjd-remote.ts clone spideryarn/reading2 --name spideryarn2`
4. **Send the environment.** `npx tsx scripts/gjd-remote.ts push-env` — allowlisted key names only,
   rebuilt on the box rather than copied, and it prints what it skipped. It writes *into the
   checkout*, so it has to come after the clone and not before it.
5. **Build it, on the box** — `ssh greg@<ip>`, `cd ~/code/spideryarn2`, and there
   `npm ci`, then **`npm run setup`**
   ([`scripts/setup-local.ts`](../../scripts/setup-local.ts)), which runs the local Supabase stack,
   the migrations and the owner seed in the one order that works. The first run pulls ~2GB of Docker
   images. `npm ci` stays outside it on purpose — you cannot run the script before installing.
   It is the same command on the laptop, which is why it is the one that gets exercised.
6. **Copy the article fixtures**, which git does not carry — same section.
7. ⚑ **Authenticate the MCP servers** that need it — [MCP servers](#mcp-servers).
8. ⚑ **Log Codex in**, so cross-family review works without a 12-second tax per run:
   `codex login --device-auth` — [Codex, for cross-family review](#codex-for-cross-family-review).
9. **Check the machine:** `npx tsx scripts/gjd-remote.ts doctor`. It exits non-zero if anything
   failed, so it is usable as a gate. But be clear what it covers: ssh, mosh, ten system binaries,
   the browser stack, the MCP servers, and provisioning. It knows **nothing** about steps 3–7 —
   there is no check for the checkout, `.env.local`, the database, the migrations, the owner row or
   the fixtures, and the browser smoke deliberately uses a global `playwright-core` so that it works
   on a clean `/home` with no checkout at all. The `mcp` check is the one exception — it `cd`s into
   the checkout and needs the OAuth logins, so it catches a missing step 3 and a missing step 7.
   **Everything between them — the environment, the database, the migrations, the owner row, the
   fixtures — doctor cannot see at all.**
10. **Then check the work**, which is the step that actually proves 4, 5 and 6: on the box,
    `REQUIRE_POSTGRES=1 npm test`. That is stage 3's exit criterion in
    [the plan](../../docs/plans/260831x-remote-box-dev-environment.md), and
    [`tests/helpers/pg-ready.ts`](../../tests/helpers/pg-ready.ts) makes an absent database say so
    rather than failing obscurely.

## Before every apply

```
npx tsx scripts/check-cloud-init.ts
```

Seconds, no dependencies, no VM. Every bug that has cost us a rebuild was findable here: an
unescaped `${...}` that Terraform errors on at plan time, a pipe inside a `runcmd` string whose exit
status is `tee`'s rather than the script's, a `check` whose nested quoting made it unrunnable so it
passed by never running, and plain bash syntax errors.

It is mutation-tested — break the file any of those five ways and it goes red — and it fails rather
than passes if its own parser stops finding things, because a preflight that quietly checks zero
things is worse than none.

Not covered: anything that needs the machine to actually boot. The next step up, if this stops being
enough, is `multipass launch --cloud-init` locally before touching Hetzner.

**Then read the plan, and read it for a replacement.** As of 2026-08-31 `tofu plan` reports
`hcloud_server.box must be replaced`, because the live box was built before a round of cloud-init
fixes and the `user_data` hash in state no longer matches the repo. That is expected and will stay
true until we deliberately rebuild — but it means **any apply, for any reason, destroys and recreates
the box.** `/home` survives (delete protection, and it is bind-mounted back) and `gjd-remote` follows
the new IP because it reads `tofu output` rather than a constant. Running tmux sessions do not
survive.

Do not silence this with `ignore_changes = [user_data]`. We want cloud-init edits to take effect on
the next build. Check what the plan says before you apply, every time:

### "Can I just apply the missing bits?" — no, and the reason is Hetzner, not OpenTofu

Asked on 2026-08-31 and worth recording, because the tooling looks like it should allow it.

OpenTofu **does** have the flag you would reach for. `-exclude` arrived in **1.9** (we run 1.12.6)
and is the inverse of `-target`: it plans everything *except* the named addresses **and anything that
depends on them**. The two are mutually exclusive with each other. So
`tofu apply -exclude=hcloud_server.box` is real, and would apply other pending changes while leaving
the box alone — note it would also skip `hcloud_volume_attachment.data`, which depends on the server.

Two caveats on that flag before you reach for it. It is **OpenTofu-only** — HashiCorp Terraform has
no equivalent, only a long-standing open request
([terraform#2253](https://github.com/hashicorp/terraform/issues/2253)), so the "OpenTofu (or
Terraform)" in *First run* above is not interchangeable here. And it cannot be combined with
`-target` in one command.

**But it cannot help with a cloud-init change**, because `user_data` on `hcloud_server` is
force-new: Hetzner's API accepts it only at server *creation* and there is no call that changes it
on a running machine ([hcloud#372](https://github.com/hetznercloud/terraform-provider-hcloud/issues/372)).
Excluding the server means the new `user_data` is simply never delivered.

`state rm` + `import` cannot rescue it either, and the provider source says why: `user_data` is
`ForceNew`, its `StateFunc` stores **only a hash** of the content rather than the content, and the
read path never populates the field at all — so an import has nothing to reconcile *from*. It can
only be made to agree by hand-editing the stored hash, which is drift hidden rather than fixed.

The textbook answer to all of this is `lifecycle { ignore_changes = [user_data] }`, and that is
exactly what the paragraph above rules out on purpose: it would stop the diff by stopping us
noticing it, and we want cloud-init edits to land on the next build.

So there are exactly two honest routes, and they are not alternatives — do both:

1. **Now, by hand.** `provision.sh` is written to be re-runnable on a live box, so the change can be
   applied directly. **Read it before you re-run the whole thing**: it does
   `npm install -g @anthropic-ai/claude-code` *unpinned*, which swaps the `claude` binary under every
   running session — there were ten live tmux sessions on 2026-08-31. Applying just the steps you
   changed is usually the right call.
2. **For the future, in the repo**, so the next build has it. It cannot be tested until that build,
   which is the cost of this design and the reason the preflight and shellcheck matter so much.

Sources: [OpenTofu 1.9 what's new](https://opentofu.org/docs/v1.9/intro/whats-new/) ·
[`-exclude` RFC](https://github.com/opentofu/opentofu/blob/main/rfc/20240725-exclude-resources.md) ·
[Command: plan](https://opentofu.org/docs/cli/commands/plan/)

```
tofu plan | grep -E "must be replaced|Plan:"
```

## The account and project

**Use the personal account, and a project of its own inside it.**

This machine also holds credentials for an unrelated Hetzner account — the `droid-vm` context,
belonging to client work in `gdconsult_work/mindstone`. That is a **separate login**, and nothing
here should ever touch it. Two things keep them apart, and it is worth knowing which does what:

- **The account** is the real boundary. Sign in to console.hetzner.com as **greg@gregdetre.com**,
  not the client login. Different account, different billing, different everything.
- **The project** is the token's blast radius. A Hetzner API token is scoped to exactly one project
  and can see nothing outside it, so a project of its own means even a badly wrong command here can
  only reach this box.

The weak point is neither of those: it is that both accounts' tokens live in the same `cli.toml` on
one laptop, and they differ by one word in an env var. Hence the guard in `main.tf` — Terraform
refuses to build in a project that already contains servers it did not create, and fails at plan
time rather than after. A project of our own is empty and passes; the client's project is not and
fails.

So: log in as greg@gregdetre.com, create a project for this box, then
**Security -> API tokens -> Generate** with Read & Write, and give the CLI its own context:

```
hcloud context create spideryarn     # prompts for the token; does not echo it
hcloud context use spideryarn
hcloud context active                 # confirm it is not some other project
```

The CLI deliberately offers no way to print a stored token, so hand Terraform its own copy:

```
export HCLOUD_TOKEN=$(python3 -c "import tomllib,os;d=tomllib.load(open(os.path.expanduser('~/.config/hcloud/cli.toml'),'rb'));print(next(c['token'] for c in d['contexts'] if c['name']==d['active_context']))")
tofu init
tofu plan
tofu apply
```

That reads whichever context is active, so check `hcloud context active` first — it is the one
command standing between you and applying to the wrong project.

### As of 2026-08-31 this laptop has only the client's context, and the guard caught it

`hcloud context list` shows exactly one context, `droid-vm` — the **client's**. There is no
`spideryarn` context, so the `hcloud context create spideryarn` step above has either never been run
here or has been lost. **Terraform therefore cannot currently be run for this box from this laptop**,
and that is the reason, not anything about the config.

Found by running `tofu plan` with the snippet above, which faithfully read the active context's
token — the client's. The plan came back `Plan: 3 to add, 0 to destroy`, proposing to build our
firewall, SSH key and volume **in the client's project**, because none of ours are there. Then:

```
Error: Resource precondition failed
```

The `hcloud_server.box` precondition in [`main.tf`](main.tf) refused, and its message names the
diagnosis outright: *"The likeliest cause is that HCLOUD_TOKEN belongs to another account or
project."* It was right. Nothing was created, and the guard is the only reason.

Two things follow. **A plan is not a safe read-only operation here** — it is safe, but its *output*
is worthless when the token is wrong, and "3 to add" looks like drift rather than like a
misconfiguration. Read `hcloud context active` before believing any plan. And the claim below that
`tofu plan` reports `hcloud_server.box must be replaced` **cannot be reproduced right now**; whoever
wrote it had a working token in their environment at the time. Treat it as unverified until someone
re-checks it with the right context.

Then, from the output:

```
ssh greg@<ip>
cat /var/log/gjd-provision-status        # must end with PROVISION OK
claude                                   # press c, open the URL on your laptop, paste the code back
```

**Not `/var/log/provision.log`**, which this said until 2026-08-31 and which is actively
misleading: cloud-init tees that file on the FIRST boot and never touches it again, so on the live
box it still ends `PROVISION INCOMPLETE — see above` from a build months ago, while the status file
from the most recent re-run says `PROVISION OK`. Both were true; only one was current. The log is
for reading *why* something failed, and the status file is for deciding *whether* it did.

**Read that log before trusting the box.** Provisioning ends with a block of explicit checks —
volume mounted, swap on, claude and chrome and docker actually running, both MCP servers registered,
password auth actually off. The list is at the bottom of
[`provision.sh`](provision.sh); do not restate it here, it grows. A green `PROVISION OK` is the only
evidence any of it happened; cloud-init reporting success is not.

Use `/login`, never `claude setup-token` — a token session is model-requests-only and loses
Remote Control, claude.ai connectors and `/schedule`.

### Scroll speed, the one TUI setting provisioning owns

`provision.sh` merges a single key into `~/.claude/settings.json`:

```json
"env": { "CLAUDE_CODE_SCROLL_SPEED": "1" }
```

so the mouse wheel moves **one line per notch**, rather than the three Claude Code picks by default
on this terminal stack. Three overshoots badly when you are scrolling back through a long transcript
looking for one line.

Merged with `jq`, never written whole. `~/.claude` is on the volume, so on a rebuild that file
already holds the theme, `tui` and notification preferences, and rewriting it would eat them.

The TUI's own `/config → Scroll speed` writes the same key in the same file, so turning that dial
changes the live box — but a later provisioning run puts it back to `1`, and a session already
running keeps the speed it started with, because the value is read at launch. To move the number for
good, change it in [`provision.sh`](provision.sh).

### Codex, for cross-family review

`provision.sh` installs `@openai/codex` alongside Claude Code, so
[`scripts/run-codex.ts`](../../scripts/run-codex.ts) runs here exactly as it does on the laptop and
a plan written on the box can be reviewed on the box —
[codex-cli-as-subagent.md](../../docs/reusable/codex-cli-as-subagent.md) is the standing rule.
Installing it is the whole change; the interesting part is the credential.

**It already works with no login**, because `CODEX_API_KEY` is on `gjd-remote push-env`'s allowlist
and the wrapper reads it out of the repo's `.env.local`. But the wrapper spends the ChatGPT
subscription *first* by default, and with no `~/.codex/auth.json` that attempt fails and falls back
— about 12 seconds of tax on every run, for a credential that is already paid for. So log in once.
Use the **device flow**: plain `codex login` wants to open a browser on the box.

```
ssh greg@<ip>
codex login --device-auth     # prints a URL and a one-time code; enter both on your laptop
codex login status            # must not say "Not logged in"
```

Until that is done, `--auth key-first` skips the failed attempt.

## Rebuilding

```
tofu -chdir=infra/hetzner apply -replace=hcloud_server.box
```

`-replace`, not the deprecated `taint`: the replacement shows up in the plan you review, so you can
confirm it is replacing the server and the attachment while leaving the volume alone — rather than
marking it tainted and finding out at apply time.

The volume detaches, the server is recreated, cloud-init re-seeds nothing (it sees an existing
`/mnt/data/home`) and the box comes back as itself.

The volume has two locks: `prevent_destroy` (Terraform refuses to replace or destroy it) and
`delete_protection` (Hetzner refuses, so it also covers the console and the API). Retiring the data
means removing both deliberately, in their own commit. Note that `prevent_destroy` makes a
whole-module `terraform destroy` fail at plan time rather than sparing the volume — that is the
intended behaviour, not a bug to work around.

## The live box

Created 2026-08-31 in the personal `greg@gregdetre.com` account, project
[15872845](https://console.hetzner.com/projects/15872845/dashboard) ("Spideryarn"), Falkenstein.

Do not hardcode the address anywhere — it changes on every rebuild, and a stale IP in a doc is
worse than none. Ask the state:

```
tofu -chdir=infra/hetzner output ssh
tofu -chdir=infra/hetzner output vnc_tunnel
```

The token lives in `.env.local` as `HETZNER_CLOUD_API_TOKEN` (gitignored). Terraform wants it as
`HCLOUD_TOKEN`:

```
export HCLOUD_TOKEN=$(python3 -c "import pathlib;[print(l.split('=',1)[1].strip().strip('\"').strip(\"'\")) for l in pathlib.Path('.env.local').read_text().splitlines() if l.strip().startswith('HETZNER_CLOUD_API_TOKEN=')]")
```

## Giving the box GitHub access

**Two tokens, because one cannot do it.** A GitHub fine-grained PAT has exactly one resource owner,
and the box's repos live under two: the `spideryarn` org and `gregdetre`. So there is a token per
owner, and [`github-owner-credential-helper.sh`](github-owner-credential-helper.sh) picks between
them by reading the owner out of the URL git is asking about.

Greg, 2026-08-31, on what it should reach:

> I would like to restrict access to certain repos, and then for it to have pretty much full
> permissions for those.

### The ceremony (Greg, once, on github.com)

1. **Check the org policy first.** Organization settings → Personal access tokens → Fine-grained
   tokens → **Allow access via personal access tokens**. If this says *Restrict*, every clone of an
   org repo fails as `Repository not found` — indistinguishable from a typo. Do this before
   anything else so you never see that error.
2. **Personal token.** Settings → Developer settings → Personal access tokens → Fine-grained tokens
   → Generate new token. **Resource owner: `gregdetre`.** Only select repositories: `gjdutils`,
   `healthyselfjournal`, `healthyselfapp`. Permissions: **Contents: Read and write**, Metadata: Read
   (mandatory and automatic), and Pull requests: Read and write if agents should open PRs. Set an
   expiry — 90 days makes rotation a habit rather than an incident.
3. **Org token.** The same flow with **Resource owner: `spideryarn`**, repositories `reading2`,
   `hellozenno`, `reading`, `spideryarn`. Tokens created by an org owner need no separate approval;
   tokens created by anyone else sit pending, and while pending they can read only public repos —
   which looks exactly like failure mode 1.
4. **Put them on the box**, one file per owner, never pasted into a command (which would put them in
   `~/.bash_history`):

   ```
   ssh greg@<ip> 'sudo install -d -m 0700 -o greg -g greg /etc/github-tokens'
   ssh greg@<ip> 'umask 077; cat > /etc/github-tokens/gregdetre.token'   # paste, then Ctrl-D
   ssh greg@<ip> 'umask 077; cat > /etc/github-tokens/spideryarn.token'  # paste, then Ctrl-D
   ```

**Adding a repo later** under an owner that already has a token is a click on github.com and no
change on the box at all. Adding a repo under a *new* owner is one new `<owner>.token` file — no
code change, no config change, no restart.

### Why not the simpler-looking options

- **Not `gh auth login`.** On a headless box with no Secret Service, `gh` falls back to a plaintext,
  non-expiring, account-wide OAuth token in `~/.config/gh/hosts.yml`. Broader blast radius and no
  expiry, for no convenience gain over pasting a token once.
- **Not `GH_TOKEN` in a shell profile.** `gjd-remote` starts agents over non-interactive ssh, which
  sources neither `.bashrc` nor `.bash_profile` — see the comment at `scripts/gjd-remote.ts:341`.
  An exported token works when a human tests it in a login shell and is missing inside every real
  agent session. Test it the easy way and you test the wrong thing.
- **Not per-owner `credential.<url>.helper` sections.** They do prefix-match on git 2.50.0, but
  `gitcredentials(5)` says a path in the pattern must match *exactly*, so that is undocumented
  behaviour one upgrade away from changing. And matching sections fire in **config-file order**, not
  most-specific-first, so a broader section above a narrower one silently shadows it.
- **Not SSH deploy keys.** They are per-repository, so seven repos means seven keypairs, and adding
  a repo means generating and registering another. That is the opposite of what Greg asked for.

## Can an agent SSH here? Check, do not assume

**On 2026-08-30 Claude Code's Bash tool had no outbound port 22** — not to this box, not to
github.com — and the whole of that day's work was designed around it: an agent could drive the
Hetzner API over HTTPS but could not run anything on the machine, so `gjd-remote doctor` exists to
package every question into one command Greg runs.

**On 2026-08-31 it worked.** Same tool, same box, no change at either end that we made. So the block
is a property of the sandbox an agent happens to be running in, not a fact about this repo, and both
the old rule and its opposite are wrong as standing assumptions.

Test it in one line rather than believing either:

```
nc -vz $(tofu -chdir=infra/hetzner output -raw ipv4) 22
```

If it connects, work on the box directly. If it does not, the block is easy to mistake for the
server being down — it is not; check `hcloud server list` before concluding otherwise, and fall back
to `gjd-remote doctor` and asking Greg to run things with the `!` prefix.

Either way the design rule still earns its place: **prefer things that report over HTTPS, or that
Terraform can assert, over things that need someone to log in and look.** That is what made the box
recoverable on the day nobody could reach it.

## mosh does not carry the tunnel

mosh deliberately carries a terminal and nothing else — no port forwarding, no agent forwarding,
no X11. So the noVNC tunnel below must be a plain `ssh -L`, and `ssh-agent` forwarding for git
pushes needs SSH too. The sane pairing is **SSH + tmux as the primary**, with mosh as a second
attach point onto the same tmux session for phone or flaky wifi — they coexist fine.

## Watching the browser

```
ssh -L 6080:localhost:6080 greg@<ip>     # locally
start-vnc                                 # on the box
```

Then open <http://localhost:6080/vnc.html>. Nothing listens on a public port for this — Xvfb,
x11vnc and websockify are all bound to localhost and reached through the tunnel.

## MCP servers

Three kinds, and only one of them needs anything from a human.

**Greg's account brings its own.** Canva, Zapier, Google Calendar, Gmail, Drive, Notion arrive on
any machine he logs into and need nothing per-box. Do not register them here and do not count them
when someone says the list is too long.

**The two browser servers are provisioned.** `playwright` and `chrome-devtools`, at *user* scope,
pinned and heap-capped by [`provision.sh`](provision.sh) — see its `=== mcp servers ===` block, and
[browser-control.md](../../docs/project/browser-control.md) for what they can and cannot prove.

**The three service servers travel in git**, in [`.mcp.json`](../../.mcp.json) at the repo root, so a
new box gets them from `gjd-remote clone` and no provisioning code has to know about them:

| | url | credential |
|---|---|---|
| `supabase` | `http://127.0.0.1:54361/mcp` | none — it is the local stack |
| `vercel` | `https://mcp.vercel.com` | OAuth, in a browser |
| `sentry` | `https://mcp.sentry.dev/mcp` | OAuth, in a browser |

A project-scope server normally makes every session sit at `⏸ Pending approval` until someone
approves it interactively. `enabledMcpjsonServers` in
[`.claude/settings.json`](../../.claude/settings.json) pre-approves these three by name, which is
why nobody gets a modal. That file is also where the deny list lives, and JSON cannot hold a comment
saying why, so it is here instead.

**Vercel's MCP can spend money.** Four `buy_*` tools — `buy_pro`, `buy_domain`, `buy_credits`,
`buy_addon` — and an autonomous agent must never reach any of them. Denied, along with
**`use_vercel_cli`**, which is a general escape hatch: it runs the Vercel CLI, so leaving it open
would route straight around every other name on the list. Also denied: **`pause_project`**, which
can take production offline, and **`update_project_deployment_protection`**, which can expose it.
Neither is routine work, and Vercel's own guidance is that its MCP has whatever access the account
has and wants human confirmation for every workflow.

**`deploy_to_vercel` is on the `ask` list rather than denied.** Deploying is ordinary work here, so
refusing it outright would be wrong — but the reasoning that had it simply unlisted was wrong too.
"`gjd-remote` passes no `--dangerously-skip-permissions`, so it prompts" does not follow: terminal
sessions on Pro/Max/Team default to Auto mode, where a classifier can approve an action without
asking anybody. An `ask` rule forces the prompt; being unmatched does not. `get_access_to_vercel_url`
is denied outright — it mints an unauthenticated shareable link to a protected deployment, which is
a way of publishing something by accident.

**Syntax.** `mcp__<server>__<tool>` for one tool, `mcp__<server>` for a whole server, `mcp__*` for
every server. `mcp__<server>__*` works too, but the bare form is the one the CLI's own help
documents. Denied tools are removed from the model's tool list rather than refused when called —
proved on the box by denying `mcp__supabase__list_tables` and watching that one tool disappear while
the other ten stayed. Deny also beat an explicit allow of the same name.

**This is a guard rail, not a wall, and it matters which.** Not because a local `allow` can beat
it — it cannot; deny wins over allow whichever settings file each comes from, and an earlier version
of this paragraph had that backwards. It is a guard rail because the file itself is in the repo, and
an agent on the box can edit or delete the deny entry, or reach Vercel through the CLI, the API or a
browser instead. It stops the accidental reach, not a determined one. The only version an agent
cannot touch is a managed-settings file deployed outside the repo, and we do not have one. Say
"guard rail" when describing this; calling it a control would be false.

### ⚑ The one manual step, per box

```
ssh -t greg@<ip>
cd ~/code/spideryarn2
claude mcp login --no-browser vercel
claude mcp login --no-browser sentry
claude mcp list        # both must now say ✔ Connected, not ! Needs authentication
```

**It is an exchange, not a link.** `--no-browser` prints an authorization URL *and then waits*: you
open it in a browser on the laptop, approve, and **paste the redirect URL back** at its prompt. Miss
that second half and it sits there until it times out, which looks like a hang. Pass the flag
explicitly rather than relying on the headless auto-detection added in 2.1.191 — a default is not a
decision, and this is the same reasoning that makes `provision.sh` name `--browser chrome` out
loud.

**A rebuild does not undo this.** The tokens are in `~/.claude/.credentials.json` and
`~/.claude.json`, `/home` is the volume (`findmnt /home` says `/dev/sdb`), and the volume outlives
the server. So the unit is not the box and not the `apply` — it is **the retained volume**, and it lasts until the tokens expire or are revoked.

**But `claude mcp remove <name>` is a de-authentication.** Measured on the box, 2026-08-31:
removing a server shrank `~/.claude/.credentials.json` from 1364 to 959 bytes for `vercel`, then
959 to 523 for `sentry`, and re-adding restored nothing. The control was a duplicate `add`, which
fails and leaves the file byte-identical — so the shrink is `remove`'s doing. And the store is keyed
by **server name, not by scope**: the laptop's existing Vercel login was picked up by the new
project-scope entry the moment the name matched. So `remove` at any scope destroys the one
credential every scope shares. That is a trap for whoever next tidies up a duplicate registration,
and it is the reason these three live in `.mcp.json` rather than in `provision.sh`: the provisioning
helper for the browser MCPs does remove-then-add for idempotence, and copying that pattern here
would log the box out of Vercel and Sentry on every re-provision. If you ever do script one, guard
with `claude mcp get <name>` — exit 0 present, exit 1 absent — and add only when absent.

**You do not have to remember the login**, because `gjd-remote doctor` fails when it has not been
done:

```
✗ mcp  sentry, vercel not connected — on the box: claude mcp login sentry
```

It reads the wanted names out of `.mcp.json` rather than keeping a second list, so adding a server
extends the check on its own.

**These are for sessions a human can answer for, not for headless automation.** A `claude -p` run
asked to call one of them gets `you haven't granted it yet` and cannot prompt, because nobody is
there — it is not a misconfiguration and there is nothing to fix. `gjd-remote new` starts
interactive tmux sessions, so agents on the box are fine. A script that shells out to `claude -p` is
not, and it will report the tool *missing* rather than blocked, which is the confusing way round. It tells a *missing login* apart from a *stale checkout* — a box that
has not pulled the commit adding `.mcp.json` is told to pull, not sent off to do a browser ceremony
that cannot help. [`scripts/gjd-remote-mcp.ts`](../../scripts/gjd-remote-mcp.ts),
[`tests/gjd-remote-mcp.test.ts`](../../tests/gjd-remote-mcp.test.ts).

### Why Supabase needs no credential, and what that buys

It is the **local** stack's own MCP on a loopback address, not Supabase's hosted one, so it cannot
reach production. That is what lets `push-env`'s allowlist leave `SUPABASE_ACCESS_TOKEN` — the
management token that can delete the production project — behind entirely.

**And that claim is now enforced rather than merely true.** The allowlist matches key *names*, and a
name says nothing about where it points: `DATABASE_URL` is spelled the same for the throwaway
container and for the one production database. So "no production credential on the box" was
something nobody was checking, and it would have gone quietly false the first afternoon somebody
pointed `.env.local` at production and then pushed. Since 2026-08-31 `push-env` refuses to send
`DATABASE_URL`, `SUPABASE_URL` or `VITE_SUPABASE_URL` unless the value is loopback
([`MUST_BE_LOCAL` in `scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts)), reusing the
migrator's own `isLocalDatabaseUrl` so "local" cannot mean two different things in one repo.

**And a loopback URL is still not the whole story**, which was the second half of the same finding:
a production `SUPABASE_SERVICE_ROLE_KEY` bypasses every policy in the database it belongs to and
would sail past a check that only reads URLs. The local stack's keys say who they are — JWTs with
`iss: supabase-demo` and no project `ref`, where a hosted project's carry `iss: supabase` and its
ref — so `push-env` reads the issuer of any Supabase-shaped value it is about to send and refuses
anything not issued by the local stack. It needs no list of known-bad values, it is keyed off the
shape rather than the key name so a JWT added to the allowlist later is covered the day it is added,
and a token whose payload will not decode is refused rather than waved through. Both found by GPT
Sol. It serves 11 tools, verified by a
`tools/list` call on 2026-08-31: `search_docs`, `list_tables`, `list_extensions`, `list_migrations`,
`apply_migration`, `execute_sql`, `query_logs`, `get_advisors`, `get_project_url`,
`get_publishable_keys`, `generate_typescript_types`.

Two of those write. They cannot touch production, but the box runs one Supabase stack shared by
every session on it, so `execute_sql` there is somebody else's data as well as yours —
[supabase-local.md](../../docs/project/supabase-local.md).

## What a fresh clone cannot do

Two things a green `git clone` does not give you. Both were found by running the suite on a new box,
not by reading anything, and both fail in ways that do not name the cause — the archaeology is in
[the plan](../../docs/plans/260831x-remote-box-dev-environment.md#what-a-fresh-clone-cannot-do-discovered-by-trying-it).

**`npm run db:seed-owner`.** A freshly migrated database has no owner row, so every insert carrying
an `owner_id` dies on a foreign key. It cost 18 failing test files and the error names neither the
constraint nor the fix. **`npm run setup` now runs it for you** — that script exists because of this
— so this one is only a trap if you assemble the steps by hand.

**The article fixtures.** `data/` and `output/` are gitignored — about 62MB and 11MB — and roughly
19 test files need an article with both `blocks.json` and `tree.json`. Only two of the nineteen say
so; the rest say things like `expected 0 to be greater than 0`. There is no scripted source for
them, so today they are copied from a laptop that has them:

```
for d in data output; do
  rsync -avz "$d/" "greg@<ip>:/home/greg/code/spideryarn2/$d/" > "/tmp/rs-$d.log" 2>&1
  echo "$d exit=$?"
done
```

Three things in that loop are load-bearing. **`-v`**, or rsync prints nothing whatever it does and
you cannot tell a full copy from a no-op. **No pipe**, so `$?` is rsync's own status and not
`tail`'s — reporting a sync that had transferred 75 of 254 files is a mistake already made here
once. And **no `--delete`**: the box generates its own output, and this is a top-up, not a mirror.
macOS ships openrsync, which is rsync 2.6.9, so none of the `--info=` flags exist — a command tested
only on Linux dies instantly here, and quietly if you pipe it.

This is the class the project already solved for Postgres, where
[`tests/helpers/pg-ready.ts`](../../tests/helpers/pg-ready.ts) makes an absent database say so.
**Article fixtures have no equivalent**, and every fresh clone pays for it: this box, a rebuild, the
deploy gate's worktree, a new contributor. Worth fixing at the source.

## Things that will bite

- **`terraform apply` after changing `server_type` reprices the server.** Hetzner grandfathers
  existing servers at their old rate; a rescale moves you to current pricing.
- **The Terraform key is the only key.** On rebuild, the volume's `authorized_keys` is REPLACED
  from the key Terraform manages, not appended to — so a rotated-out key stops working, which is
  the point. If you ever add a second key by hand, a rebuild removes it.
- **`claude mcp add` may want you logged in.** It is the one provisioning step plausibly needing
  auth. If the log's MCP checks fail, log in first and then re-run the two `claude mcp add`
  commands from `/usr/local/sbin/provision.sh`.
- **Both MCP servers are pinned** to whatever version was current at provision time, not `@latest`
  at each launch. Re-provision to move them.
- **Each MCP server's heap is capped** at 512MB via `NODE_OPTIONS`, because N sessions x M servers
  spawns node processes with no cap each and that is the documented way this box dies. Anthropic
  closed the issue "not planned", so the cap is ours to keep.
- **An AppArmor profile for bubblewrap is installed** even though nothing uses it yet. On Ubuntu
  24.04+ the default policy stops bubblewrap making user namespaces, so Claude Code's sandbox
  runtime fails to start and says nothing useful about why. It is here for the day we isolate
  sessions.
- **Node matches the laptop (26), not LTS (24).** A major-version gap between laptop and box is
  where "works on my machine" comes from.
- **Playwright runs `--isolated`.** One persistent browser profile supports exactly one browser
  process, and this box exists to run sessions in parallel. The cost is that the browser does not
  stay signed in to anything.
- **There is one browser here, and it is `google-chrome-stable`.** Both MCPs launch it — the
  Playwright one is given `--browser chrome --executable-path /usr/bin/google-chrome-stable`, the
  channel flag to choose Chrome and the path so nothing depends on Playwright's channel lookup — and
  [`scripts/remote-smoke-browser.mjs`](../../scripts/remote-smoke-browser.mjs) names the same binary
  in `executablePath`. Playwright's own chromium download was removed from provisioning on
  2026-08-31 after 651MB of it turned out to be launched by nothing. So **a bare `chromium.launch()`
  fails here** with "Executable doesn't exist"; pass the path. If you genuinely need Playwright's own
  browser, install it **version-matched to the client you are about to run**
  (`npx playwright@1.62.1 install chromium`) — the bare `npx playwright install chromium` pulls
  `@latest` and recreates the very revision mismatch this box was cleaned up to remove.
- **The MCP list is deliberately two.** N sessions × M MCP servers spawns unbounded Node processes;
  that, not RAM, is what falls over first. Argue before adding a third.
- **There is no backup.** By choice — the code lives in remote git. Anything on this box that is
  not pushed is not kept. Note the gap that hides: Claude Code **session transcripts** are not in
  git either, and the volume protects against the server dying, not against the volume itself
  being corrupted or the wrong thing deleted. MindstoneRebel backs transcripts off-box with rclone
  on a best-effort, non-blocking basis. Undecided here — see the open question below.

## Locked out? The console is the way back

fail2ban bans an IP after 5 failed auths. With one operator and mosh in the mix that is easy to
trip by accident, and the instinct — retry — is what deepens the ban. **Stop retrying.** Go to
console.hetzner.com, open the server, and use the web console (VNC), which reaches the box over
Hetzner's own out-of-band path and is not affected by fail2ban, the SSH firewall rule, or an sshd
you have just misconfigured. From there: `fail2ban-client unban <ip>`.

That path is also the reason `sshd -t` runs before the sshd restart during provisioning, and worth
remembering before hand-editing sshd config on a box you are relying on.

## Lessons taken from MindstoneRebel

Greg runs a similar Hetzner box in `gdconsult_work/mindstone/MindstoneRebel`. Three of its
hard-won lessons apply here, and are written down before they are needed rather than after.

- **Never reap processes on resemblance.** Their `AGENT_ORPHAN_REAPER.md` records three
  orphan-cleanup heuristics they built and abandoned, because each would have killed *live,
  well-behaved* Claude Code processes: `claude bg-pty-host`, `bg-spare` and `daemon run` all sit at
  ppid 1, idle, with no TTY — indistinguishable from "orphaned" by shape. A fleet of tmux'd
  sessions is exactly that shape. If we ever automate cleanup here, it must kill on proof (an
  env-var fingerprint, a deleted cwd) and carry an explicit never-kill list.
- **A long-lived tmux server carries stale env.** Their session spawner passes `env KEY=val` inline
  on every new session rather than trusting tmux inheritance, because the tmux server outlives the
  invocations that started it and a session opened today can inherit a variable set months ago.
  This box has exactly that shape: one tmux server, many sessions, running for weeks. Set env
  explicitly per session; do not trust what the server happens to be holding.
- **Pick a concurrency cap and write it down as load-bearing.** Their autopilot doc states "single
  VM, single dispatcher, max 3 concurrent sessions" as an assumption other parts depend on, flagged
  for revisit if the number changes. We have not picked ours, and CX53's real ceiling is unmeasured.
  Measure it, then write the number down here rather than leaving it implicit.

Two of their choices we deliberately did **not** copy. They run UFW on top of key-only SSH; here
the Hetzner cloud firewall already sits outside the box, where a compromised host cannot rewrite
it, and UFW would enforce the same rules a layer further in while adding a way to lock yourself
out. And they provision no swap, adding one reactively when `npm ci` OOMs — we do it upfront,
which is the better default for a box running many Node processes unattended.

## Reviewed, and one thing deliberately left open

GPT Sol reviewed this before first apply and returned STOP, with two blockers (an unescaped
interpolation inside the comment warning about unescaped interpolations, and `file()` not expanding
`~`) plus nine real findings. All are fixed except one, which is a decision rather than a bug:

**Every session runs as one account with passwordless sudo, sharing one set of Claude credentials
and one browser profile.** One prompt injection, one malicious repo script, or one bad `npx`
release compromises the box and every session on it. Anthropic's own guidance is that bypassing
permissions offers no prompt-injection protection and belongs only in an isolated environment.

> It's fine for them to run as one account with passwordless sudo for now. … We can always
> optimise/improve the setup later.
>
> — Greg, 2026-08-31

**Decided, not overlooked.** The structural fixes — a separate admin account, dropping unrestricted
sudo after provisioning, running autonomous sessions inside the sandbox runtime — change how the box
is used, and are worth doing when the box is doing work worth protecting. The AppArmor profile below
is the piece that has already been paid for, so that day costs less.

**On the AppArmor profile**, since it looks like an unfinished job and is not one: it grants
`bubblewrap` permission to create user namespaces, which Ubuntu 24.04's default policy denies. It
isolates nothing by itself and is inert today. Its only purpose is that when we *do* run sessions
inside Claude Code's sandbox runtime, that runtime starts instead of failing with no useful
explanation — a silent failure we would otherwise have debugged from scratch on the day we could
least afford it. It costs nothing to carry.

Related: swap bounds nothing. It softens the OOM killer but N sessions x M MCP servers is still
unbounded, and swap thrashing can make SSH unusable. Per-session memory and process limits are the
real answer if this becomes a problem.
