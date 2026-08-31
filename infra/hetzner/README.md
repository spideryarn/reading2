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

```
export HCLOUD_TOKEN=$(hcloud context active --token)
terraform init
terraform plan
terraform apply
```

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
  not pushed is not kept.

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
