# Why typing on the box felt slow, and what actually fixes it

Greg, 2026-08-31:

> There's a lot of latency when I type on the gjd-remote Hetzner box. Is there anything we can to do
> improve this (without making things too complex)?

**The answer is that it was almost entirely the laptop's own network link, and the box contributed
0.12% of it.** That is not what any of us guessed first, so the measurements are here in full — and
so are the three wrong turns, because each was plausible and two of them survived a review.

Connecting to the box at all is
[260831c-remote-server-tmux-mosh.md](260831c-remote-server-tmux-mosh.md);
the box itself is [infra/hetzner/README.md](../../infra/hetzner/README.md).

## What we measured

From the laptop, while the typing felt slow:

```
ping 1.1.1.1          n=27   min=175  p50=351  p90=436  max=519 ms
ping the box          8/10 received, 20% loss, min/avg/max = 412 / 453 / 516 ms
ssh round trip        p50=750 ms, max=4680 ms   (over an established shared connection)
ping the LAN gateway  8/10 received, avg 15.9 ms, max 34 ms
```

Cloudflare's anycast address should answer in single-digit milliseconds. It was taking 351.
**Everything after that number is a rounding error.**

The laptop's Wi-Fi at the time:

```
PHY Mode: 802.11n           <- the card supports a/b/g/n/ac/ax/be
Channel: 1 (2GHz, 20MHz)
Signal / Noise: -46 dBm / -85 dBm
Country Code: GR
```

An excellent signal on the most crowded channel there is: a scan found **five other networks also on
channel 1**, plus others on 4, 5, 6, 9 and 13. That is the shape of 802.11 link-layer retransmission
— strong signal, big latency, occasional loss — but see the caveat below, because we did not prove
it.

## The box was innocent, and here is the proof

The box looked alarming, which is what sent us down the wrong path:

```
load average: 58.85, 29.47, 18.63      on 16 vCPU
%Cpu(s): 88.5 us, 11.1 sy, 0.5 id
/proc/pressure/cpu: some avg10=92.44
24 claude processes, 86 node, 68 chrome, 11 tmux sessions
```

Three independent measurements say it does not matter for typing:

| Measurement | Result |
|---|---|
| Wakeup latency (1ms sleeps ×300) | p50 **0.08 ms**, p90 0.09 ms |
| Compute-bound loop, 3 s | got **100% of a core** |
| Runqueue wait, `/proc/<pid>/schedstat` field 2, over 10 s | see below |

The last is the one that settles it. Field 2 is cumulative nanoseconds spent waiting on the
runqueue, per process — so it measures the thing we actually care about, for the processes we
actually care about, rather than for the machine as a whole:

```
mosh-server   29.03 ms over 10 s across 161 slices -> 0.180 ms per wakeup
tmux server    3.54 ms over 10 s across  24 slices -> 0.147 ms per wakeup
claude        17.68 ms over 10 s across 346 slices -> 0.051 ms per wakeup
```

A keystroke traverses mosh-server → tmux → claude → tmux → mosh-server, so it waits about
**0.71 ms** in total. Against a network round trip of 450–750 ms, the box is **0.12%** of the felt
latency. Load average 58 and PSI at 92 are both real and both irrelevant.

## Three things we got wrong

Worth recording, because all three are the kind of wrong that sounds right.

**1. We read PSI as "the interactive processes wait 92% of the time".** It does not mean that.
`cpu some avg10=92` means that during 92% of the window, *some runnable task somewhere* was waiting
for a core. It proves contention exists; it says nothing about which task or for how long. GPT Sol
caught this, and pointed at `schedstat` as the per-process measurement that answers the real
question — which is where the 0.71 ms above came from. [Kernel PSI
docs](https://cdn.kernel.org/doc/html/latest/accounting/psi.html)
· [schedstat docs](https://www.kernel.org/doc/html/latest/scheduler/sched-stats.html)

**2. We assumed mosh's predictive echo switches off inside a full-screen TUI.** It does not, as a
rule — supporting full-screen raw-mode applications is one of mosh's stated design goals, and it is
meant to be run inside tmux. A specific app can still defeat prediction by moving the cursor or
repainting differently than predicted, but "adaptive mode gives up in TUIs" is not a fact and we
should not have written it down as one. [mosh.org](https://mosh.org/#techinfo)

**3. A subagent reported that `--predict=experimental` does not exist.** It does — `mosh --help` on
1.4.0 lists it as *"aggressively echo even when incorrect"*. Checked directly rather than believed.
There is also `--predict-overwrite` (`-o`), *"prediction overwrites instead of inserting"*.

## The one change made

`set -sg escape-time 10`, appended to `~/.tmux.conf` on the box and added to
[`provision.sh`](../../infra/hetzner/provision.sh).

tmux waits `escape-time` after a bare Escape to see whether more bytes follow, because Alt+key
arrives as ESC+key. **Ubuntu 24.04 ships tmux 3.4, whose default is 500ms**; tmux 3.5 cut the
default
to 10ms for exactly this reason. Verified on the live box — it really was at 500.

Claude Code uses Escape constantly: interrupt, clear the input, leave a mode. So this was half a
second of dead air on the key you press most. It does **not** touch per-character latency, and it is
not the fix for the problem in the title; it is a real half-second that happened to be sitting
there.

Two details are load-bearing:

- **10, not 0.** At 0 tmux cannot distinguish Alt+key from Escape-then-key at all, and Meta bindings
  break. 10ms is the smallest value that still can.
- **Appended, not folded into the existing block.** That block is guarded by
  `if [ ! -f ~/.tmux.conf ]`, so it only runs on a machine that has never been provisioned — and the
  volume carries the old config back on every rebuild. A line added inside it would never have
  reached the box that needed it. Same trap the `settings.json` jq merge two blocks below already
  works around.

## What we deliberately did not do

- **`--predict=experimental`.** It makes the screen show characters it is not sure about, which in a
  TUI that repaints its input line means the prompt can lie until the real redraw lands. Worth a
  five-minute A/B out of curiosity; not worth shipping. `--predict=always` is the milder mode, and
  should change nothing here, because adaptive already sees a very slow link and is already
  predicting.
- **cgroups / `cpu.weight` for the interactive sessions.** `cpu.weight` only divides CPU between
  correctly-separated sibling cgroups, and tmux, claude, Chrome and their children are currently
  braided together — arranging the groups is the whole cost. And the measurement above says there is
  nothing to win.
- **`nice`ing the Claude processes.** Would also deprioritise the input renderer of the session you
  are typing into.
- **Tailscale/WireGuard, Eternal Terminal, moving the box.** A VPN cannot repair loss on the local
  link. Eternal Terminal adds a daemon and TCP head-of-line blocking, and has no predictive echo, so
  it is strictly worse than mosh for this. Moving the box saves part of the healthy long-haul leg
  while the broken access path is contributing hundreds of milliseconds.
- **SSH cipher, `Compression`, `IPQoS`, `TCPKeepAlive` tuning.** None affects steady-state typing
  latency once a session exists; they affect throughput or connect time. `IPQoS` in particular only
  does anything if every router on the path honours DSCP, which nothing on the public internet does.
- - **`/tui fullscreen`.** Already set on the box — `~/.claude/settings.json` has `"tui":
  "fullscreen"`.

## What to do when it feels slow again

In order, and stop as soon as one works:

1. **`ping 1.1.1.1`.** If p50 is not in single digits, nothing on the box is your problem. Move to
   5GHz, tether to a phone, or plug in a cable.
2. **`ping <box>`** and compare. The gap between the two is the only part Hetzner owns.
3. Only then look at the box, and look with `schedstat` — not with `uptime`, `top` or PSI, all three
   of which will tell you the box is on fire while it schedules your keystrokes in 0.7ms.

The A/B that would actually confirm the Wi-Fi diagnosis — same session, same box load, current
Wi-Fi versus hotspot or ethernet — **has not been run.** Everything above is consistent with
co-channel interference on 2.4GHz, and the 20% loss to the LAN gateway points that way, but ten
pings is not proof and the 351ms to Cloudflare could also be a congested uplink or bufferbloat
upstream of the router. If someone wants the certain answer, that is the one test to run.

## Sources

- - The review:
  [260831ac-gjd-remote-typing-latency-review-sol.md](../plans/260831ac-gjd-remote-typing-latency-review-sol.md)
  (prompt: […-review-prompt.md](../plans/260831ac-gjd-remote-typing-latency-review-prompt.md))
- Claude Code repaints the whole screen per keystroke rather than diffing —
  [anthropics/claude-code#31194](https://github.com/anthropics/claude-code/issues/31194), closed as
  not planned. Flicker over ~100ms+ links, reported worse under tmux and worse still under mosh:
    [#22408](https://github.com/anthropics/claude-code/issues/22408). Neither has a fix; both are
  worth
  knowing about, and neither is actionable from here.
- tmux changed the `escape-time` default in 3.5:
  [CHANGES](https://raw.githubusercontent.com/tmux/tmux/master/CHANGES). Ubuntu 24.04 ships 3.4:
  [packages.ubuntu.com/noble/tmux](https://packages.ubuntu.com/noble/tmux).
- Setting `escape-time 0` breaks Meta bindings:
  [tmux-plugins/tmux-sensible#41](https://github.com/tmux-plugins/tmux-sensible/issues/41).
