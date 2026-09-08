# Diagnosing a box that has run out of CPU, RAM or disk

Reach for this when a shared machine feels slow, a command gets killed for no reason, or somebody
asks "how are resources on this box?". It is written for a box that several agents share, because
that is where the answer is least obvious: almost everything you find belongs to somebody, and the
cost of a wrong kill is another agent's work.

The short version: **measure first, attribute second, and kill only what you can prove is
abandoned.** Most of the time the honest answer is "it is oversubscribed and it will clear on its
own", not "here is what I killed".

## The survey

One pass, cheap enough to run on a box that is already thrashing:

```bash
uptime                     # load average vs cores
nproc                      # cores, to divide by
free -h                    # RAM, and how much swap is left
df -h /                    # disk
swapon --show              # how many swap areas, and how full each is
vmstat 1 3                 # si/so non-zero = actively swapping; high wa = thrashing
ps -eo pid,ppid,pcpu,pmem,rss,comm --sort=-rss | head -20
```

Reading it:

- **Load** is runnable + uninterruptible processes, not a percentage. Divide by `nproc`. Equal to
  cores is busy; several times cores is oversubscribed; and a load that is mostly *uninterruptible*
  is disk, not CPU — `vmstat`'s `wa` column tells you which.
- **`available`, not `free`.** Linux spends idle RAM on cache and gives it back on demand. `free`
  near zero with `available` in the gigabytes is healthy. Both near zero is not.
- **Swap is a cliff, not a slope.** Some swap used is normal. *All* of it used means the next
  allocation fails and the OOM killer picks a victim — check with
  `dmesg -T | grep -i 'out of memory'` (usually needs `sudo`), which names the process and the time.

## Attribute before you touch anything

Group the memory rather than reading a process list, or you will chase the biggest single process
instead of the biggest cause:

```bash
ps -eo rss,args --no-headers | awk '{r=$1; $1=""; if ($0 ~ /vitest/) k="vitest"; else if ($0 ~ /vite/) k="vite"; else k="other"; s[k]+=r; n[k]++} END {for (k in s) printf "%-10s %4d procs %7.1f GB\n", k, n[k], s[k]/1048576}' | sort -k3 -rn
```

Then, for each candidate, answer all four before it becomes a kill:

1. **Whose is it?** Walk `ppid` up until you reach a session, a shell, or PID 1.
2. **Does its working directory still exist?** `readlink /proc/<pid>/cwd`. A `(deleted)` suffix means
   the directory was removed while the process kept running — strong evidence of an orphan.
3. **Is anything still using it?** `ss -ltnp | grep :<port>` for a server; a live parent for a child.
4. **How bad is it if you are wrong?** A dev server someone restarts in five seconds is not a
   database mid-write.

## The traps

Each of these produced a confidently wrong number the first time.

**`ps -e … -C name` silently ignores the `-C`.** `-e` means "every process" and it wins, so
`ps -eo pid --no-headers -C chrome | wc -l` counts *all* processes and looks like a plausible
browser count. On 2026-09-04 it reported 866 chrome processes on a box that had 40. Use
`pgrep -x chrome`, or `ps -C chrome -o pid=` with no `-e`. This is
[silent-success.md](silent-success.md) exactly: a wrong command that returns a number rather than an
error.

**`pgrep -f <name>` matches command lines, not programs.** Agent tooling spawns processes whose
*arguments* contain the name — `npm exec @playwright/mcp … --browser chrome` is not a browser. The
same run counted 162 "chrome" processes that were mostly MCP servers belonging to live sessions;
the real figure was 46, and killing on the first number would have broken every agent's browser
tooling. `pgrep -x` matches the executable name; `-f` is for when you genuinely mean the arguments.

**`ppid == 1` is not proof of abandonment.** It proves the *launcher* exited. A browser started with
`--remote-debugging-port` outlives its launcher on purpose and a live session can reconnect to it;
one started with `--remote-debugging-pipe` cannot, because the pipe died with the parent. Check the
cmdline before concluding. On 2026-09-04 an orphaned-looking browser turned out to belong to a
session with 15 live processes.

**`pkill -f <string>` will match your own shell.** Your command line contains the string you are
searching for, so the shell running `pkill` kills itself, and the exit code looks like a failure of
the thing you meant to kill. Kill by PID, or filter out `$$`.

**A kill list is a list of PIDs, not a pattern.** `pkill -f vite` on a shared box takes out every
other agent's dev server. Resolve the pattern to PIDs, print them with their cwd and age, satisfy
yourself about each, and only then kill those numbers.

## Add swap without disrupting anything

Adding a *second* swap file is safe on a running, loaded machine: it is additive, takes effect
immediately, and interrupts nothing. `fallocate` writes metadata only, so it does not cause an IO
storm on a box that is already thrashing.

```bash
sudo fallocate -l 16G /swapfile2      # ext4/xfs; on btrfs see mkswapfile
sudo chmod 600 /swapfile2
sudo mkswap /swapfile2
sudo swapon /swapfile2
swapon --show                          # verify it is actually active
```

Persist it, or it is gone at the next reboot — and back the file up first, because an unbootable
`/etc/fstab` is a much worse day than a full swap file:

```bash
sudo cp -a /etc/fstab /etc/fstab.bak-$(date +%Y%m%d-%H%M%S)
echo '/swapfile2 none swap sw 0 0' | sudo tee -a /etc/fstab
sudo swapon -a --verbose               # must say "already active -- ignored", not error
```

That last line is the check that the entry parses. A typo in `/etc/fstab` is not noticed until boot.

**Do not grow existing swap in place under pressure.** Resizing means `swapoff` first, which forces
every swapped page back into RAM at once — on the loaded box that made you want more swap, that is
the OOM you were trying to avoid. Add a second file instead.

**More swap buys time, not capacity.** It converts a hard kill into a slowdown you can notice and
act on. If you are exhausting it, the fix is fewer concurrent jobs or a per-session memory limit.

## What usually turns out to be the cause

On a box shared by coding agents, in rough order of how often it has been the answer:

- **Concurrent test suites.** Each `vitest` run forks a worker per core, so two agents running the
  full suite on a 16-core box is 32+ processes. These belong to live work — leave them, and ask the
  agents to serialise if it matters. **Do the arithmetic before reaching for the worker cap**:
  measured here, peak memory was 3.84 GB fixed per run plus 0.198 GB per worker, so 87% of it was
  spent before the first worker forked. Capping workers bounds processes, not gigabytes; what bounds
  gigabytes is the number of concurrent runs.
- **Dev servers from deleted worktrees.** The worktree is removed, the server keeps running and
  keeps its heap. Cross-check `git worktree list` against the servers you can see; a server whose
  worktree is absent from both git and disk is safe.
- **Browsers leaked by finished browser automation**, which are much rarer than a naive `pgrep`
  suggests — see the traps above.

## Project-specific pointers

Not portable, so keep them at the edges of this doc:

- Which machine you are on, and that a change to it is also a change to the file that builds the
  next one: [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md).
- The swap size for new boxes is `swap_gb` in `infra/hetzner/variables.tf`; the block that applies it
  is in `infra/hetzner/provision.sh`, and it deliberately does not resize existing swap.
- A crowded box refuses to start a suite rather than swapping: the reserve in
  `~/.config/spideryarn/vitest-memory-reserve-gb`, written by `infra/hetzner/provision.sh` and read
  by `vitest-admission.ts` — [testing.md](../project/testing.md).
- Killing a shared dev server breaks other agents: [worktrees.md](../project/worktrees.md).
