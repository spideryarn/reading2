# The Claude Code box

Terraform + cloud-init for the 24/7 Hetzner server that Claude Code sessions run on.
The decision behind it, the prices, and what was ruled out are in
[remote-server-for-claude-code.md](../../docs/research/remote-server-for-claude-code.md). Connecting
to it — mosh, tmux, one iTerm tab per session, and being told when a session wants you — is
[remote-server-tmux-mosh.md](../../docs/research/remote-server-tmux-mosh.md).

## The shape, in one paragraph

The **server is disposable** and the **volume is not**. The volume is bind-mounted over `/home`,
so repos, `~/.claude`, `~/.pw-profile` and everything else survive destroying and recreating the
machine. That is not tidiness — CX53 is the top of its line, so the only way to get more RAM is to
swap the server out from under the volume, and that is only cheap if nothing important was ever on
the server's own disk.

## First run

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

Then, from the output:

```
ssh greg@<ip>
sudo tail -20 /var/log/provision.log    # must end with PROVISION OK
claude                                   # press c, open the URL on your laptop, paste the code back
```

**Read that log before trusting the box.** Provisioning ends with ten explicit checks — volume
mounted, swap on, claude and chrome installed, both MCP servers registered, sshd config valid and
password auth actually off. A green `PROVISION OK` is the only evidence any of it happened;
cloud-init reporting success is not.

Use `/login`, never `claude setup-token` — a token session is model-requests-only and loses
Remote Control, claude.ai connectors and `/schedule`.

## Rebuilding

```
terraform taint hcloud_server.box && terraform apply
```

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

## An agent cannot SSH here

**Claude Code's Bash tool has no outbound port 22** — not to this box, not to github.com. It reaches
HTTPS fine, so `tofu`, `hcloud` and `curl` all work, and the block is easy to mistake for the
server being down. It is not: check `hcloud server list` before believing otherwise.

The practical consequence is that **an agent cannot verify its own provisioning, or operate the box
directly.** Anything needing a shell on the server has to be run by Greg (the `!` prefix in Claude
Code puts the output back in the conversation), or triggered from the box itself. Worth designing
around rather than rediscovering: prefer things that report over HTTPS, or that Terraform can
assert, over things that need someone to log in and look.

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
release compromises the box and every session on it. The fixes are structural — a separate admin
account, dropping unrestricted sudo after provisioning, running autonomous sessions inside the
sandbox runtime — and they change how the box is used, so they are Greg's call rather than
something to slip in. Anthropic's own guidance is that bypassing permissions offers no
prompt-injection protection and belongs only in an isolated environment.

Related: swap bounds nothing. It softens the OOM killer but N sessions x M MCP servers is still
unbounded, and swap thrashing can make SSH unusable. Per-session memory and process limits are the
real answer if this becomes a problem.
