# A remote server to run Claude Code on

**Status:** research, 2026-08-31. Nothing here is built. It records a decision and the working
behind it, so the next agent does not redo the survey.

This doc is about **which machine**. How you reach it from iTerm and keep sessions alive across a
sleeping laptop is [260831c-remote-server-tmux-mosh.md](260831c-remote-server-tmux-mosh.md); driving a browser once
you are on it is [260831b-playwright-browser-control.md](260831b-playwright-browser-control.md).

The ask, from Greg (2026-08-30):

> I want to be able to run Claude Code remotely on a server that can run npm install and run
> webservers and Claude-in-Chrome … and generally do everything I can do on my laptop, but will run
> 24h/day. Probably I want >=32GB RAM (and the option to resize to more) so I can run lots of
> sessions in parallel. It needs its own (ideally persistent) filesystem out of the box. It should
> have a nice API/CLI so the agent can do the work to configure/update infrastructure.

Budget: ideally under $100/month. Location: UK/EU, for interactive SSH latency. Billing: **monthly,
no annual commitment** — Greg, 2026-08-31: *"I don't want to pay more than monthly, i.e. to have
flexibility."*

And the line that decided it, when the choice had narrowed to two:

> I'm less worried about CPU, more about AI-first-flexibility

## The decision

**Hetzner Cloud CX53** — 16 shared vCPU, 32GB RAM, 320GB NVMe, Falkenstein, €29.49/mo net
(≈€35.39 including 20% UK VAT).

Built as **disposable compute plus a persistent volume**: the repos, `~/.claude`, and the browser
profile live on a Hetzner volume, and the server itself is declared in Terraform with a cloud-init
script so it can be destroyed and rebuilt from a file. That shape is the whole point — see
[Why this rather than the cheaper hardware](#why-this-rather-than-the-cheaper-hardware).

## The one thing most likely to mislead you

**Hetzner repriced on 15 June 2026, and almost every source still quotes the old numbers** —
blog posts, price aggregators, and model training data alike. Two research agents in this project
confidently recommended a plan at a third of its real price before being caught.

The primary source, and the only one to trust:
<https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/>

What changed: **CPX and CCX more than doubled**, CX and CAX rose ~30%, and **dedicated hardware
barely moved**. Existing servers are grandfathered, but a new order *or a vertical rescale* moves
you to current pricing — so resizing an old cheap server silently reprices it.

## Prices, 2026-08-31

All Hetzner published prices are **net**. Hetzner charges UK customers **20% VAT**
(<https://docs.hetzner.com/general/others/value-added-tax/>), so add a fifth to everything below.
IPv4 is billed separately, roughly €0.60/mo net.

| Plan | Cores | RAM | Disk | €/mo net | €/mo inc UK VAT |
|---|---|---|---|---|---|
| CX53 | 16 shared | 32GB | 320GB | 29.49 | 35.39 |
| CAX41 (ARM) | 16 shared | 32GB | 320GB | 40.99 | 49.19 |
| CPX62 | 16 shared | 32GB | 640GB | 129.99 | 155.99 |
| CCX33 | 8 dedicated | 32GB | 240GB | 138.49 | 166.19 |
| CCX43 | 16 dedicated | 64GB | 360GB | 275.99 | 331.19 |
| AX41-1-LTD (dedicated hardware) | 6c/12t | 64GB | 2×512GB | 57.30 | 68.76 |

The CX ladder is CX23 (€5.49) → CX33 (€8.49) → CX43 (€15.99) → CX53 (€29.49). **CX53 is the top of
the line.** There is nothing above it, which matters — see the gotchas.

## Gotchas

- **32GB is a cliff, not a rung.** The next real step up in RAM is CCX43 at €331/mo inc VAT, a
  9x jump. Design the box as disposable-compute-plus-volume from day one and the jump becomes
  detach, destroy, recreate, reattach — minutes, and scriptable. Do not design it as a pet.
- **ARM is not the cheap option any more.** CAX41 has identical specs to CX53 and costs €11.50/mo
  more. It also showed as *unavailable* on 2026-08-30. The old "ARM is cheaper" instinct is wrong
  here. (If it is ever used: Google Chrome ships no arm64 Linux build. Playwright's bundled
  Chromium does — use `channel: 'chromium'`, never `channel: 'chrome'`.)
- **Cloud and Robot are separate accounts.** Hetzner Cloud (`console.hetzner.com`) and Hetzner
  Robot (dedicated servers) have different logins and separate ID checks. Signing up for one does
  not get you the other.
- **Identity verification is required.** Since March 2026 Hetzner runs an iDenfy check — photo ID
  plus a selfie — as part of signup. Budget time for it; it is not instant.
- **There is no documented CPU limit on shared vCPU.** The Cloud service agreement's only
  enumerated prohibitions are crypto mining, network scanning and forged source IPs. The sole
  fair-use language is generic and non-numeric: *"the fair use principle applies … if you overload
  the server, Hetzner must take measures to protect other customers"* (`/legal/system-policies/`).
  So running sustained multi-core builds on CX53 breaks no written rule, but it is exposure to an
  undocumented, discretionary call rather than a stated allowance.
- **Falkenstein, not Helsinki** — ~22ms from London against ~45ms.
- **`AX41-1-LTD` is not obviously the same box as the `AX41` product page.** "-1-LTD" is a
  permanent cheaper hardware tier, not limited stock. If a dedicated server is ever ordered, check
  the actual spec in the console; €57.30 net is the right planning figure.

## Why this rather than the cheaper hardware

Netcup's RS 4000 G12 is better hardware for the money — 12 *dedicated* EPYC cores, 32GB DDR5 ECC,
1TB NVMe. It was the recommendation until two constraints landed.

Monthly-only billing took most of its price advantage away. The headline €39.92/mo needs a year's
commitment; the no-commitment price is **€48.32/mo**, against CX53's €35.39. Netcup charges UK
customers 20% VAT too, so the two are directly comparable. (All Netcup figures confirmed from their
live configurator, 2026-08-31, and quoted VAT-inclusive — unlike Hetzner's, which are net.)

Then "AI-first flexibility" decided it outright. Hetzner has, and Netcup does not:

- **`hcloud`**, a complete CLI — create, destroy, resize, snapshot, firewall, volumes, rescue mode.
- **An official, HashiCorp-verified Terraform provider.** The box becomes a file.
- **cloud-init user-data at creation**, so a server is born with everything installed.
- **Hourly billing**, so build-and-destroy costs pennies and an agent can spin up a throwaway box
  for one risky experiment.

Netcup is mid-migration from a legacy SOAP API to a new REST one, has no official CLI, and only
unofficial Terraform providers split across both API generations.

The unlisted fifth reason, which matters more than it should: **models know `hcloud`.** It is
everywhere in training data. An agent gets Hetzner commands right first time and fumbles Netcup's.

Two points in Netcup's favour, recorded so the next agent does not have to rediscover them: its
VPS line *does* offer hourly metering on the no-commitment term (€37.60/mo equivalent for VPS 4000
G12, plus a one-off €5.04 setup fee), so hourly billing is not unique to Hetzner. And it supports a
genuine **live in-place upgrade** within a hardware generation, data preserved across a restart —
but the upgrade restarts the minimum contract term, which is the catch for anyone on monthly.

## What was ruled out, and why

| Category | Examples | Why not |
|---|---|---|
| Agent sandboxes | E2B, Daytona, Modal, Vercel Sandbox, Cloudflare, Runloop, Blaxel, CodeSandbox | Priced for bursty ephemeral execution, so 24/7 use costs 5-15x a VPS. Several capped below spec (Daytona 8GB, Cloudflare 12GiB); Modal and Vercel Sandbox cap sessions at 24h; Vercel Sandbox has no raw SSH at all. |
| PaaS | Railway, Render, Fly.io, Northflank, Koyeb, Porter | RAM priced at $6-10/GB/mo against $1-3 on a VPS. Fly and Northflank are the right *shape* (real SSH, real volumes, root) but ~$150-400/mo at 32GB. |
| Hosted dev environments | GitHub Codespaces, Gitpod/Ona, Replit | Built to stop when idle. Codespaces has a 4-hour idle ceiling at the org-policy maximum; Gitpod became Ona and dropped persistent boxes. |
| Orchestration layers | Coder, DevPod | Not hosting. They sit on a VM you still buy elsewhere. DevPod looks unmaintained (no release since March 2025). |
| Hetzner's own dedicated-vCPU cloud | CCX33/CCX43 | Repriced out of contention in June 2026 — 4x Netcup for the same RAM and fewer cores. |

**Railway deserves a specific note**, since it is what gets recommended in conversation: its SSH is
CLI-mediated tmux rather than real `sshd` (so no mosh), only Amsterdam in the EU, and ~$400/mo at
32GB.

One structural point that applies to the whole PaaS category and is easy to miss: they are
immutable-image-plus-volume. On Railway and Fly, **any** restart — an OOM kill, not just a deploy —
resets everything outside the mounted volume. Apt packages and Chrome must be baked into a
Dockerfile permanently. A VPS has none of that; the whole disk is the machine.

## The API and CLI

- **Docs:** <https://docs.hetzner.cloud/> · **CLI:** <https://github.com/hetznercloud/cli>
- **Terraform:** <https://registry.terraform.io/providers/hetznercloud/hcloud/latest/docs>
- **Robot (dedicated) API:** <https://robot.hetzner.com/doc/webservice> — it *can* order servers
  (`/order/server/product`, `/order/server_market/product` for the auction), contrary to a common
  belief, but ordering must first be switched on manually in the Robot UI. No official Terraform
  provider; three community ones exist.
- **Auction tracker:** <https://radar.iodev.org> (unofficial; returned 403 to automated fetches).

Useful primitives for an agent-run box: **volumes** (persist independently of the server),
**snapshots** (roll back a destructive experiment), **cloud-init user-data** (whole machine from a
script), **rescue mode** (boot a recovery system when the box will not come up).

## Claude Code on the box

- **Authenticate with `/login`, not `claude setup-token`.** Over SSH the browser cannot reach the
  local callback, so Claude Code shows a code to paste back into the terminal — press `c` to copy
  the URL, open it on the laptop, paste the code. A `setup-token` session is model-requests-only
  and loses Remote Control, claude.ai connectors, `/schedule`, and Chrome integration.
  <https://code.claude.com/docs/en/authentication>
- **Watch the login expiry.** `/login` credentials expire; Claude Code warns three days out and
  `/status` shows the state. An unattended session that outlives its login just stops.
- **Keep the MCP server list short.** Sessions are only ~300MB each, but MCP servers multiply —
  N sessions × M servers spawns unbounded Node processes. One report reached kernel panics at
  15 × 34 on a 64GB machine. MCP count, not RAM, is the thing that breaks at scale.
- **Browser: Playwright MCP plus chrome-devtools-mcp.** Claude in Chrome cannot follow us to a
  headless box — it needs a real desktop Chrome with the extension, has no headless mode, and is
  disabled outright under API-key or `setup-token` auth. Playwright drives, chrome-devtools-mcp
  debugs. See [claude-in-chrome.md](../project/claude-in-chrome.md) and
  [browser-testing.md](../project/browser-testing.md) for how browser work is done here today.
- **Watching it yourself:** Xvfb + x11vnc + noVNC over an SSH tunnel. CDP screenshots work whether
  or not anyone is connected, so the model never depends on the viewer.
- **Skip browser logins for consoles that have an API.** Vercel (`mcp.vercel.com`) and Supabase
  (`mcp.supabase.com`) both have official MCP servers. Google Cloud Console does not, and its
  passkey gate needs a human.
- **Security:** put SSH behind Tailscale and close port 22. `--dangerously-skip-permissions` must
  run inside a container, VM, or the sandbox runtime — Claude Code refuses to start with it as root
  on Linux. <https://code.claude.com/docs/en/sandbox-environments>

Anthropic's **self-hosted environments** (August 2026) would wire a box like this into Anthropic's
own orchestration, but it is Team/Enterprise only and so not available on Max.

## Not verified

Carried forward honestly rather than guessed:

- Storage Box (BX) current pricing, and live auction stock — both JS-only pages; the auction
  tracker 403s to automated fetches.
- Whether `AX41-1-LTD` is the same silicon as the `AX41` product page.
- Netcup's ongoing notice period once past the minimum term. The 14-day statutory withdrawal
  right and the 30-day money-back guarantee are confirmed; "31 days, then monthly" appears only on
  forums.
- Whether Hetzner Cloud and Robot ID checks are one process or two.
