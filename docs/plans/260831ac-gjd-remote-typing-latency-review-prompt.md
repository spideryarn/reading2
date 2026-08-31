# Review prompt: typing latency on the gjd-remote box

You are reviewing a **diagnosis**, not a patch. Nothing has been changed yet. Tell us where the
diagnosis is wrong, what we have mis-attributed, and which fixes are worth doing given the
constraint below.

## The constraint that governs the answer

Greg's ask, verbatim: *"There's a lot of latency when I type on the gjd-remote Hetzner box. Is there
anything we can to do improve this (without making things too complex)?"*

The house rules are "prefer boring" and "simplest version first". So we want the **smallest number
of changes with the largest effect**, and we want to be told plainly which of the candidate fixes
are cargo cult. A recommendation that adds a daemon, a VPN, or a second transport needs to earn it.

## The setup

- Laptop: macOS, iTerm2, mosh 1.4.0, tmux 3.7b locally (only the remote tmux matters).
- Box: Hetzner **CX53** (16 *shared* vCPU, 32GB RAM, 16GB swap), Ubuntu 24.04, location **fsn1**
  (Falkenstein, Germany).
- Transport: `mosh` with an automatic `ssh -t` fallback. A probe decides which.
- Inside it: **plain `tmux attach -d -t =<name>`**, deliberately NOT `tmux -CC` control mode
  (control mode does not survive mosh, and closing an iTerm tab under `-CC` kills the remote window).
- Inside tmux: **Claude Code**, a full-screen Node/Ink TUI that repaints on every keystroke.
- The box also runs headless Chrome (for Playwright) and Docker (for local Supabase), plus one
  Claude Code session per tmux session.

The whole remote `~/.tmux.conf` is three lines:

```tmux
set -g allow-passthrough on
set -s extended-keys on
set -as terminal-features 'xterm*:extkeys'
```

Notably **`escape-time` is left at the tmux default**.

The attach command, from `scripts/gjd-remote.ts`, is built as:

```
MOSH_TITLE_NOPREFIX=1 LANG=C.UTF-8 mosh <host> -- sh -c '<tmux set-titles...> && tmux attach -d -t =<name>'
```

so mosh runs with its **default `--predict=adaptive`**. The observed server command line confirms it:

```
mosh-server new -c 256 -s -l LANG=C.UTF-8 -- sh -c tmux attach -d -t =s-260831-193800
```

## What we measured, just now, from the laptop

Network, from the laptop where the typing feels slow:

```
ping box (188.245.166.213):  8/10 received, 20% loss, min/avg/max = 412 / 453 / 516 ms
ping 1.1.1.1:               30 pings, n=27, min=175  p50=351  p90=436  max=519 ms
ping 192.168.1.254 (LAN gw): 8/10 received, 20% loss, min/avg/max = 3.0 / 15.9 / 34.0 ms
```

Wi-Fi link state on the laptop:

```
PHY Mode: 802.11n          <- card supports a/b/g/n/ac/ax/be
Channel: 1 (2GHz, 20MHz)
Signal / Noise: -46 dBm / -85 dBm
Transmit Rate: 115-130 Mbps, MCS Index 13
Country Code: GR           <- Greece, i.e. Greg is not in the UK right now
```

So: **~350ms p50 to Cloudflare anycast**, which should be single-digit ms. The box adds roughly
100ms on top of an already-broken path. Signal strength is excellent (-46 dBm) yet there is loss and
huge variance — the shape of 2.4GHz co-channel interference causing L2 retransmissions, not of a
weak signal or a distant server.

Box, at the same moment:

```
up 5:33, 12 users, load average: 58.85, 29.47, 18.63     <- on 16 vCPU
Tasks: 635 total, 52 running
%Cpu(s): 88.5 us, 11.1 sy, 0.5 id, 0.0 wa, 0.0 st        <- steal is ZERO
Mem:  31337 total, 27841 used, 1613 free, 3495 available
Swap: 16383 total,   762 used                             <- si/so = 0 in vmstat
/proc/pressure/cpu:    some avg10=92.44 avg60=85.72 avg300=47.20   full avg10=0.00
/proc/pressure/memory: some avg10=0.08  avg60=0.21               full avg10=0.06

claude processes: 24     node processes: 86     chrome processes: 68
tmux sessions:    11     mosh-servers:     8
mosh-server CPU:  0.0-0.3% each
```

## Our diagnosis, for you to attack

**Cause 1 — the local network, and it dominates.** ~350ms p50 with loss on the laptop's own uplink.
No server-side tuning can touch this. The single biggest available win is moving the laptop off
2.4GHz channel 1 onto 5GHz, or onto a phone hotspot, or a cable.

**Cause 2 — the box has no spare CPU.** `some avg10=92.44` means that ~92% of the time at least one
task is stalled waiting for a runqueue slot. Load 58-72 on 16 vCPU. Steal is 0.0 and memory pressure
is ~0, so this is Greg's own workload, not the hypervisor and not swapping. Every keystroke traverses
mosh-server -> tmux -> claude -> tmux -> mosh-server, and each hop queues behind 86 node processes.
mosh-server's own CPU use is negligible, so it is a victim rather than a cause.

**Cause 3 — mosh's predictive echo is probably not masking Cause 1.** mosh runs at the default
`--predict=adaptive`. We believe adaptive prediction stays largely disabled inside a full-screen
repainting TUI, which is exactly the case where a 350ms RTT is most painful.

## The candidate fixes, in the order we currently rank them

1. **Fix the Wi-Fi.** 5GHz band, or hotspot, or ethernet. Costs nothing, changes nothing in the repo.
2. **Stop running 11 sessions at once**, or cap concurrency. Possibly `nice`/`renice` the batch work,
   or put Chrome and Docker in a cgroup with a CPU weight, so the interactive path wins the runqueue.
3. **`set -sg escape-time 10`** in the remote `~/.tmux.conf`. We are unsure of the real tmux 3.4/3.5
   default on Ubuntu 24.04 and unsure whether this affects *typing* or only escape-prefixed keys.
4. **`mosh --predict=experimental`** (always predict). Uncertain whether this helps or actively
   misleads inside an Ink TUI that repaints the input line.
5. Move the box closer, or add a VPN/Tailscale underlay, or switch to Eternal Terminal.

## What we want from you

1. **Is the ranking right?** In particular: how much of the felt latency is Cause 1 vs Cause 2? Is
   there a measurement that would separate them cleanly, that we have not done? We can run anything.
2. **Cause 2 specifically.** Is `some avg10=92` on a 16-vCPU box actually enough to add perceptible
   keystroke latency, given mosh-server needs only microseconds of CPU per keystroke? Or are we
   over-reading PSI? What is the *simplest* mitigation — is a systemd slice / `cpu.weight` for the
   interactive sessions worth the complexity here, or is "run fewer sessions" the honest answer?
3. **Cause 3.** What does mosh's adaptive predictor actually do inside tmux and inside a full-screen
   TUI? Is `--predict=experimental` a real fix for this workload or a way to make the screen lie?
4. **Which of our candidates are cargo cult**, and what have we missed entirely?
5. Anything about **Claude Code's own redraw cost** over a thin link that we should know.

Answer plainly and briefly. Name what you are unsure about rather than smoothing over it.
