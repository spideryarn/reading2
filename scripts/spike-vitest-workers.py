#!/usr/bin/env python3
"""Measure the unit lane's wall time AND peak memory at several worker counts.

The 260906h plan measured wall time only. The 2026-09-08 incident was a swap
exhaustion, so the number that was missing is peak RSS per worker count: it is
what decides whether an adaptive rule should key on memory rather than cores.

Sampling is by process group: the run is started with start_new_session=True so
every vitest fork lands in one pgid we can sum without guessing at process names.
"""
import json, os, subprocess, sys, time


def mem_available():
    """What the admission policy itself reads, so the spike measures the same
    observable it will be used to calibrate. Linux only; None elsewhere.

    Summed RSS double-counts shared pages and says nothing about memory charged
    to postgres or the kernel on a run's behalf, so it is the wrong number to
    size a MemAvailable-based threshold with. The drop in MemAvailable across a
    run is the right one. GPT Sol, 2026-09-08."""
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
    except OSError:
        return None
    return None


def sample(pgid):
    out = subprocess.run(["ps", "-eo", "pgid=,rss="], capture_output=True, text=True).stdout
    total = procs = 0
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            g, r = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        if g == pgid:
            total += r
            procs += 1
    return total, procs


def run(workers, project="unit"):
    env = dict(os.environ)
    env["VITEST_MAX_WORKERS"] = str(workers)
    t0 = time.time()
    p = subprocess.Popen(
        ["npx", "vitest", "run", "--project", project],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    pgid = os.getpgid(p.pid)
    peak_rss = peak_procs = 0
    area = n = 0
    avail_start = mem_available()
    avail_low = avail_start
    while p.poll() is None:
        rss, procs = sample(pgid)
        peak_rss = max(peak_rss, rss)
        peak_procs = max(peak_procs, procs)
        area += rss
        n += 1
        a = mem_available()
        if a is not None and avail_low is not None:
            avail_low = min(avail_low, a)
        time.sleep(0.25)
    wall = time.time() - t0
    out = {
        "workers": workers,
        "wall_s": round(wall, 1),
        "peak_rss_gb": round(peak_rss / 1048576, 2),
        "mean_rss_gb": round((area / n) / 1048576, 2) if n else 0,
        "peak_procs": peak_procs,
        "exit": p.returncode,
    }
    if avail_start is not None and avail_low is not None:
        # The number the policy consumes. On a shared box this is noisy -- other
        # agents move it too -- so read it as an order of magnitude, not a
        # constant, and prefer a quiet machine.
        out["memavail_drop_gb"] = round((avail_start - avail_low) / 1024**3, 2)
        out["memavail_start_gb"] = round(avail_start / 1024**3, 2)
    return out


if __name__ == "__main__":
    counts = [int(x) for x in sys.argv[1].split(",")] if len(sys.argv) > 1 else [1, 2, 4, 8, 16]
    out_path = sys.argv[2] if len(sys.argv) > 2 else "spike-results.jsonl"
    with open(out_path, "w") as fh:
        for c in counts:
            r = run(c)
            print(json.dumps(r), flush=True)
            fh.write(json.dumps(r) + "\n")
            fh.flush()
