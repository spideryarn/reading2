## Verdict

The practical ranking is broadly right: fix the access path first, then reduce CPU contention. But three parts of the diagnosis are overstated:

- You cannot yet say 2.4 GHz interference is the cause. Gateway loss makes Wi-Fi suspicious, but ten pings are too few, and the 350 ms Internet RTT could also be WAN congestion or bufferbloat. Ethernet/5 GHz/hotspot A/B is the decisive test.
- CPU PSI does not mean the interactive processes wait 92% of the time. It means that during 92% of the interval, *some runnable task somewhere* was waiting. It proves heavy contention, not keystroke latency. Likewise, mosh does not “queue behind 86 Node processes”; sleeping processes are irrelevant. [Kernel PSI definition](https://cdn.kernel.org/doc/html/latest/accounting/psi.html)
- Mosh adaptive prediction is not generally disabled by full-screen programs. Supporting full-screen raw-mode applications is one of its explicit design goals. [Mosh predictor description](https://mosh.org/#techinfo), [paper](https://mosh.org/mosh-paper.pdf)

You cannot assign a useful Cause 1/Cause 2 percentage from these snapshots. For any character that is not predicted, the network contributes roughly the full 450 ms RTT before authoritative echo appears. Server delay is then added. For a successfully predicted character, network latency contributes almost nothing to the immediate echo, so CPU/TUI behaviour may dominate instead.

## The clean separation

Do these A/Bs before adding machinery:

1. Same Claude session and box load, current Wi-Fi versus hotspot/ethernet/5 GHz. This measures the access path.
2. Same network, current load versus a quiet box. Stop or finish CPU-heavy work; merely closing idle sessions proves nothing.
3. Compare adaptive mosh in a plain shell and in Claude. Outstanding predictions are underlined. If shell typing predicts immediately but Claude typing does not, the problem is the TUI/predictor interaction.
4. Compare a fresh Claude session with the long-running slow one. If only the old one lags, session/rendering state is implicated.

For an objective CPU answer, record scheduler delay for the relevant `mosh-server`, tmux and Claude PIDs with `perf sched timehist`. The lightweight fallback is to sample `/proc/<pid>/schedstat` before and after a fixed typing interval: field 2 is cumulative time waiting on the runqueue. [Kernel schedstat documentation](https://www.kernel.org/doc/html/latest/scheduler/sched-stats.html)

That is much stronger evidence than system-wide PSI.

## Mosh and Claude

Adaptive mode builds confidence from observed echoes; Enter, Escape, control keys and some navigation start new prediction epochs. Tmux does not inherently defeat that. Claude may defeat it if its repaint moves the cursor, produces a different intermediate screen, or is slow enough that Mosh treats the predicted echo as wrong. Mosh’s published design uses a 50 ms server-side echo acknowledgement, so heavy CPU contention and prediction failure can reinforce each other.

`--predict=experimental` is not “always predict.” Mosh 1.4.0 describes it as “aggressively echo even when incorrect.” It can make the prompt lie until the authoritative redraw arrives. Use it for a five-minute A/B if curious; do not make it the fix. `--predict=always` is the separate mode that enables ordinary prediction on low-delay links, and should add little here because adaptive already sees a very slow link.

One nit: the `mosh-server` command line cannot confirm predictor mode because prediction is client-side. The wrapper command’s lack of `--predict` does establish adaptive default.

## Revised fix ranking

1. **Get off the broken path.** Correct first move. But describe it as “A/B Wi-Fi/WAN,” not yet “confirmed co-channel interference.”

2. **Run fewer simultaneous CPU-heavy jobs.** This is the honest server fix. Identify the actual CPU consumers; process/session counts are not enough. `nice` is reasonable for known batch commands. Do not nice every Claude process, because that also deprioritises its input renderer.

3. **Check Claude’s renderer.** Run `/tui`; if fullscreen is not enabled, A/B `/tui fullscreen`. Anthropic says this renderer sends less terminal data and especially helps tmux and iTerm2 throughput. It will not fix the network, but it may reduce Claude/tmux/mosh parsing and repaint work. [Claude fullscreen documentation](https://code.claude.com/docs/en/fullscreen)

4. **Set `escape-time 10`, but label it correctly.** Stock Ubuntu 24.04 ships tmux 3.4, whose default is **500 ms**; tmux 3.5 changed it to **10 ms**. It fixes standalone Escape and escape-prefixed key latency, not ordinary letters. Verify with `tmux -V` and `tmux show -s escape-time`. [Ubuntu package](https://packages.ubuntu.com/noble/tmux), [tmux 3.4 default](https://raw.githubusercontent.com/tmux/tmux/3.4/options-table.c)

5. **Do not add cgroups yet.** `cpu.weight` only divides CPU among correctly separated sibling cgroups. With tmux, Claude, Chrome and child jobs currently braided together, arranging those groups is the complex part. Measure per-process runqueue delay first. If fewer jobs is unacceptable and scheduler delay is proven, revisit it. [systemd CPUWeight semantics](https://www.man7.org/linux/man-pages/man5/systemd.resource-control.5.html)

VPN/Tailscale, Eternal Terminal and relocating the box are cargo cult at this stage. A VPN cannot repair local loss except accidentally through a better route; Eternal Terminal adds a daemon and TCP head-of-line blocking; moving the box saves at most the healthy long-haul portion while the present access path is adding hundreds of milliseconds.