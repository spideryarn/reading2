# before-v2: the baseline, re-measured with the fixed harness

The printouts in this folder are the **before** for spya-m0mcqb, taken with `scripts/trace-scroll.ts`
after GPT Sol's review of the first one
([261003a-ipad-battery-scroll-repaint-review-sol.md](../../../plans/261003a-ipad-battery-scroll-repaint-review-sol.md),
F1–F3 and F7). They replace the numbers in [`../before/`](../before/), which used the trace's whole
span as the window, called summed cull rects "painted area", and counted mixed causes as inline-only.

Each printout starts with the exact command, the cwd, the commit and the load average. Read the
`HEADLINE:` line first: gesture seconds (wall clock and from the page's own marks), delivered px,
CPU seconds (trace main-thread busy; `/proc` for the target renderer process and for its main thread),
the same per 1000px, then the counts. **Compare runs per 1000px**, not by seconds: the touch gesture
waits for each CDP acknowledgement, so it stretches when the box is loaded.

The code measured is commit `40e232dc9`, which is the reading view before the fix.

## The recipe — use it unchanged for the after

`S` is the scratchpad of the session that took these; any directory works, as long as the batch
script's `S` and `HARNESS` agree with it. Ports 5491 (the build) and 5492 (a dev server used only to
sign in, `--sign-in-via`) were picked to stay clear of the 5391/5392 a peer may be using.

**Before** — a clean, detached tree at the base commit, so the edits in the worktree cannot leak in:

```bash
W=/home/greg/code/spideryarn2/.claude/worktrees/fb-m0mcqb-ipad-scroll-paint
S=/tmp/claude-1000/-home-greg-code-spideryarn2/2ad69e0b-306d-4c33-9b25-1e596d2ed4ca/scratchpad
V=$W/docs/investigations/261003a-what-a-scroll-frame-costs-in-the-reading-view/before-v2
git -C $W worktree add --detach $S/m-base 40e232dc9
ln -s $W/node_modules $S/m-base/node_modules
cp $W/.env.local $S/m-base/.env.local
cd $S/m-base
npx vite build --sourcemap
npx tsx scripts/tmux-job.ts --name m2-preview npx vite preview --port 5491 --strictPort
npx tsx scripts/tmux-job.ts --name m2-dev     npx vite --port 5492 --strictPort
curl -s localhost:5491/ | grep -oE 'src="[^"]*"'      # must name a file in $S/m-base/dist/assets
npx tsx scripts/tmux-job.ts --name m2-batch $V/runall.sh m2
```

**After** — the same, from the worktree itself, once the fix is in its `src/` (stop the two `m2-`
servers first, or use two other ports and change `5491`/`5492` in a copy of the batch script):

```bash
cd $W
npx vite build --sourcemap
npx tsx scripts/tmux-job.ts --name m3-preview npx vite preview --port 5491 --strictPort
npx tsx scripts/tmux-job.ts --name m3-dev     npx vite --port 5492 --strictPort
curl -s localhost:5491/ | grep -oE 'src="[^"]*"'      # must name a file in $W/dist/assets, not m-base's
npx tsx scripts/tmux-job.ts --name m3-batch $V/runall.sh m3
```

The batch script, [`runall.sh`](runall.sh) `<prefix> [run names…]` (its traces and summaries go to
the `S` hard-coded at its top), runs, in order and twice over: iPad
Summary (`?mode=summary`), iPad Plain, desktop Plain — each as

```bash
npx tsx $W/scripts/trace-scroll.ts --local-sign-in --email referee-test-260901@example.com \
  --sign-in-via http://localhost:5492/ --settle 20 --rest 30 \
  --device <ipad|desktop> --url "http://localhost:5491/read/replication-crisis-spya-hrjamq<?mode=summary>" \
  --out $S/<prefix>-<name>
```

It is run **from the tree being measured**, because the harness maps the bundle's call sites through
`./dist/assets/*.map` relative to its working directory; the harness itself is always `$W`'s copy, so
before and after are read by the same code. The gestures are the same as the first runs: desktop,
180 wheel events of 120px every 60ms (+60, −30, +60, −30); iPad, 24 touch swipes of 600px in 20
moves 16ms apart, held before lifting (8 down, 4 up, 8 down, 4 up). Traces stay in `$S`
(`<prefix>-*.trace.json`, plus a `.summary.json`); only the `.txt` printouts are copied here.

Tear down afterwards: `tmux kill-session -t '=<session>'` for each session you started, then
`git -C $W worktree remove --force $S/m-base`.
