# What the page costs, and how to find out

*Started as "what the page costs when nobody is touching it", which is still the first question it
answers — but a reader complained about **scrolling** on 2026-08-27, so it now covers what an
interaction costs too, and how to measure either without fooling yourself. If you are here to run
something, [start here](#start-here-the-recipes).*

Greg, 2026-08-27:

> The CPU usage for the page seems very high. […] gradually bring down the CPU usage (especially
> when it's in the background, but ideally also when it's active) unless it's briefly doing
> something that really requires CPU.

That last clause is the whole standard. **Work a reader asked for may cost whatever it costs**; work
nobody asked for should cost nothing. A model call, a force simulation on the frame you press
`Force`, an ingest walking its five steps — all fine. A tab left open on a table doing four hundred
things an hour to change no pixel is not, and that is what this page is about.

## Start here: the recipes

Every command below is real and was run today. Article slugs live in `data/`; `constitution` is a
good one to test with because it is long (22,500 words, 360 rows, 92,703px tall) and long is where
the costs show up.

**And 360 rows is not long enough.** Everything on this page was measured at 360 or 551 blocks until
2026-09-05, when the same clicks on a **2,046-block** article turned out to cost twenty-three times
as much rather than eleven — a quadratic that no amount of care at 551 blocks would have found. If
you are chasing a complaint that names length, measure two articles and read the **ratio**;
a single article gives you a number and no slope. See § Clicking.

```bash
# The reading view at rest. --local-sign-in gets you past the gate with no human.
npx tsx scripts/measure-cpu.ts --local-sign-in \
  --url "http://localhost:5273/read/constitution?perf=1" --settle 20 --seconds 30

# What a CLICK costs, which is a different gesture from a scroll and has its own
# budget. Prints click-to-next-painted-frame per mode switch. See § Clicking.
npx tsx scripts/measure-cpu.ts --local-sign-in \
  --url "http://localhost:5273/read/constitution?perf=1" --settle 25 \
  --modes "Hierarchy,Summary,Outline,Plain" --repeats 3

# The same page while somebody scrolls it. Real wheel events, through the compositor.
npx tsx scripts/measure-cpu.ts --local-sign-in \
  --url "http://localhost:5273/read/constitution?perf=1" --settle 20 --seconds 30 --scroll

# A genuine background tab: the page is *told* it is hidden, so its listeners behave.
npx tsx scripts/measure-cpu.ts --url http://localhost:5273/ --settle 20 --seconds 45 --hidden

# A tab you cannot relaunch (someone else's browser, already signed in).
npx tsx scripts/chrome-cpu.ts --seconds 60 --pid 51928
```

`?perf=1` switches on the in-page probe, which makes every run print a `renders:` line —
`Spine=114 TableView=104 …`. **Read that line first.** See
[render counts beat percentages](#render-counts-beat-percentages). A component wrapped in `memo`
does not appear at all when it is skipping, because the counter counts body executions; that is the
signal, and it is also what a *broken* memo looks like, so pair it with a browser check.

A `--scroll` run also prints, since 2026-09-04:

```
wheel pointer: {"x":400,"y":400,"insideTable":true,"over":"FIGURE"}
scroll: 417 wheels → 50040px, p95 frame 16.8ms, worst 133.2ms, 40/1455 rAF intervals over 32ms (2.7%)
```

**`417 wheels → 50040px` is the input, and two runs are only comparable if it matches** —
`totalDistance` should be `dispatched × 120`. **`rAF intervals over 32ms` is the closest thing here to what
a reader feels**, and it moves when CPU barely does. `--wheel-x` / `--wheel-y` move the pointer; see
[2026-09-04](#three-things-this-changed-about-how-to-measure-here).

**Pick the slug and the account together, and check the run said `N rows`.** Two ways this wastes an
hour, both hit on 2026-09-03:

- `--local-sign-in` signs in as the **most recently used** local account, which on a shared box is
  whichever throwaway a peer made last — and *a slug you do not own is a 404*, so you measure the
  "Not shared" page. Pass `--email <the owner>`.
- A local `articles` row can have `current_revision_id` **null** (an ingest that never finished),
  and that is also a 404. `constitution` is in this state locally, so the commands above no longer
  work as written on this box. This finds a slug that will actually load, with its owner:

  ```sql
  select a.slug, u.email, rv.word_count, rv.block_count
  from spideryarn.articles a
  join spideryarn.article_revisions rv on rv.id = a.current_revision_id
  left join auth.users u on u.id = a.owner_id
  order by rv.block_count desc limit 10;
  ```

Both failures produce a page that renders fine and costs almost nothing, which is why the harness
prints `page: 551 rows, … 66123px tall` and shouts when there are none. Believe that line, not the
percentage.

### Comparing a change against `main`

Do **not** edit source while a measurement is running, and do not measure a server another agent is
also editing under: Vite hot-reloads the page, the metric counters reset, and the run reports
*negative* CPU. Several hours went into learning that twice.

Two worktrees, two servers, one difference:

```bash
S=/tmp/perf                       # anywhere outside the repo
git worktree add --detach $S/before HEAD
git worktree add --detach $S/after  HEAD
for d in before after; do
  ln -s "$PWD/node_modules" $S/$d/node_modules
  ln -s "$PWD/.env.local"   $S/$d/.env.local
  ln -s "$PWD/data"         $S/$d/data
  rsync -a --delete src/ $S/$d/src/          # everyone's in-flight edits, so both are runnable
  cp package.json index.html vite.config.ts $S/$d/
done
git show HEAD:src/web/Thing.tsx > $S/before/src/web/Thing.tsx   # roll back ONLY your files
(cd $S/before && npx vite --port 5299 --strictPort &)
(cd $S/after  && npx vite --port 5298 --strictPort &)
```

Then measure both, `diff -rq $S/before/src $S/after/src` to prove only your files differ, and
**tear the servers and worktrees down afterwards** (`git worktree remove --force`). Two idle Vite
servers are themselves a CPU complaint.

**Prove the two ports are serving two different bundles, every time:**

```bash
curl -s localhost:5299/ | grep -oE 'src="[^"]*"'   # before
curl -s localhost:5298/ | grep -oE 'src="[^"]*"'   # after
```

On 2026-09-04 they were not. `vite preview --config /other/tree/vite.config.ts` resolves `outDir`
against the **current working directory**, not the config's, so it served the current tree's `dist`
to both ports. Both answered 200, both printed `551 rows`, and the "before" run came back identical
to the "after" — which reads as "the change did nothing" rather than as a broken measurement. Pass
`--outDir /abs/path/to/dist`, or launch each server from its own directory, and check the hashes.

Copying the whole working `src/` into both sides is deliberate: this tree usually holds several
agents' uncommitted work, and a worktree at a bare `HEAD` often will not even boot — today it could
not resolve `d3-hierarchy`, because a peer was midway through removing it.

## Before you believe a number

Every one of these produced a confident wrong answer here first. They are cheap to check and
expensive to miss.

1. **Did the page render?** Every `measure-cpu.ts` run prints `page: 360 rows, 360 prose blocks, …`
   and warns when there are none. A blank page is genuinely cheap, so a run that never rendered
   looks like a fast one. This is [silent-success](../reusable/silent-success.md) with a profiler on
   it.
2. **Is the number negative?** Then the window straddled a page reload and the counters reset.
   Find the reload, don't re-run and hope.
3. **Are two Chromes fighting?** They used to share a hardcoded debugging port, so the second run
   attached to the first run's browser and measured *its* tab, silently. Fixed — Chrome picks the
   port now — but the shape recurs: check you are talking to the browser you started.
4. **Was the window really idle?** A page's first seconds are its load: nine fetches, a mount
   cascade, four times the true render count. `--settle` is not decoration.
5. **Is the tab actually visible?** Under extension automation it is reliably not, and
   `requestAnimationFrame` does not run in a hidden document — so an rAF-based probe hangs and the
   tooling calls the renderer *frozen*. It isn't. See
   [the traps](#the-traps-all-of-which-produced-a-confident-wrong-number-first).
6. **Is a clean main-thread profile proof of anything?** No. On the app shell, 2.3% of a core was
   spent while only 0.9% was on the main thread; the rest was compositor and raster, where no
   main-thread profiler can go.

### Render counts beat percentages

Two runs of *identical* code put the renderer at 30.1% and 37.2% — roughly 20% run-to-run noise on a
laptop carrying several dev servers and a dozen agents. Over the same pair of runs the render counts
repeated to within 1%.

So: state the render counts as the result, quote CPU as directional, and never celebrate a 15%
"improvement" that one re-run would erase. If you need a CPU number to hold still, take three runs
and say so.

## The instruments, and which one answers which question

| | Answers | Reach for it when |
|---|---|---|
| [`src/web/perf.ts`](../../src/web/perf.ts) — in the page, `?perf=1` | **why**: which timer, which component, how many fetches, visible vs hidden | you have a live page and want to know what it is doing |
| [`scripts/measure-cpu.ts`](../../scripts/measure-cpu.ts) — its own Chrome, over CDP | **how much**: real CPU for the whole renderer *and* the main thread alone, the script / layout / style split, per frame, plus render counts | you want a number you can put in a commit message |
| [`scripts/chrome-cpu.ts`](../../scripts/chrome-cpu.ts) — `ps` against a running Chrome | **how much**, whole process, nothing else | you must measure a browser you cannot relaunch |
| [`scripts/measure-annotation.ts`](../../scripts/measure-annotation.ts) — Playwright, driving gestures | **whose fault**: end-to-end beside the share the annotation pipeline owns, per gesture, every repetition printed | a gesture in the reading view is slow and you need to know how much of it is the marks. Its in-page half is [`src/web/annotation-cost.ts`](../../src/web/annotation-cost.ts) |
| `measure-cpu.ts --cpu-profile <out>` — a sampling profile of the window | **which function**: self time, ours separated from `node_modules` | the split says *layout* or *script* and you need a name to go and open |
| a **DOM mutation census** in the page — a `MutationObserver` during a scroll, grouped and counted | **what is being written**, which is often not what the profiler blames | style or layout is high and you do not know what is dirtying the DOM |

The last two are new on 2026-09-03 and between them they found
[the largest cost on this page](#scrolling-rebuilt-the-whole-article-2026-09-03). The census is a
dozen lines pasted into a page rather than a script, because what you want to group by changes every
time; the version that found it is in
[260903l](../plans/260903l-prose-innerhtml-rewritten-on-every-scroll-render.md).

**Profiling perturbs the number.** A run with `--cpu-profile` is a run for *finding* the cost; the
run whose percentage you quote is a separate one without it.

### Use `measure-cpu.ts` unless you can't

It launches its own Chrome with its own profile and one tab, so nothing else is running in the
browser it measures, and it asks the DevTools Protocol rather than inferring from the process table —
so it can say *script* or *layout* or *style* instead of one number. That distinction is usually the
answer.

**It used to stop at the sign-in gate; it doesn't any more.** `--local-sign-in` mints a session
against the local Supabase and hands it to the app's own SDK — see
[The auth wall came down](#the-auth-wall-came-down) for why it is a `verifyOtp` and not a magic-link
redirect, and [`scripts/seed-local-session.ts`](../../scripts/seed-local-session.ts) for the
local-only guard on it. `chrome-cpu.ts` is now only for a browser you cannot start yourself.

**What you cannot reach at all:** a tab the user already had open. The Chrome extension only exposes
tabs in its own MCP group, for parent and subagent alike, so "look at the tab in their screenshot"
is not a slow path, it is a dead end — hand them a console snippet instead. There is one in
[What we still do not know](#what-we-still-do-not-know).

## The numbers, 2026-08-27

Measured with `measure-cpu.ts`, 40-second windows after a 15-second settle, against a `npm run dev`
server. Percentages are of **one** core.

| Page (idle) | CPU, whole renderer | CPU, main thread | Main thread *busy* |
|---|---:|---:|---:|
| a blank HTML file — the floor | 0.0% | 0.0% | 0.0% |
| only the article's YouTube embed, never played | 0.5% | 0.4% | 0.3% |
| the app's shell (sign-in route, React mounted), **visible** | 2.3% | 0.9% | 0.8% |
| the same shell, **hidden** | **0.2%** | 0.1% | 0.1% |

The reading view itself, from `ps` against a signed-in tab: **5.5–7.1% of one core** — see
[what we still do not know](#what-we-still-do-not-know) for why that is the weakest figure here.

### Three columns, because the first two disagree

The gap between "whole renderer" and "main thread" is the most useful thing in the table, and it
**resolves the contradiction the whole investigation started from**. The in-page probe insisted our
JavaScript was doing essentially nothing at idle — 1.6ms of it across fourteen seconds — while `ps`
insisted the renderer was burning 5.5% of a core. Both were right. On the shell, 2.3% of a core is
being spent and only 0.9% of it is on the main thread; the rest is compositor and raster, on threads
no main-thread profiler can see, `perf.ts` included.

So **the first place to look is not React.** A main-thread profile that comes back clean is not
evidence the page is idle; it is evidence the cost is somewhere a main-thread profile cannot go.

**The hidden row is not evidence for any fix on this page, and it would be easy to read as if it
were.** The sign-in shell mounts neither the job poller nor the clock, so its 2.3% → 0.2% is just
Chrome declining to render a tab nobody is looking at — a useful baseline (the app has no *inherent*
background cost) and not a before-and-after. What the fixes below do is stop the pages that *do*
mount those hooks from being the exception to it, and the evidence for that is
[the regression test](#the-regression-test), not this table.

### The last column is not CPU

`TaskDuration`, `ScriptDuration` and friends are reported in wall-clock ticks: they measure elapsed
time *inside* main-thread tasks, and a task that spends its time waiting counts in full. Read them
for the **shape** — which of script, layout or style to go and look at — and never for the **size**.
This page quoted them as "percentage of one core" for about an hour, until a GPT Sol review pointed
at Chromium's source. `ProcessTime` and `ThreadTime` are the real CPU counters and are what the
first two columns use now.

## What was ruled out, and why that is worth writing down

Three plausible culprits died on measurement rather than on argument. Each had a story good enough
to have justified a fix, and a fix to any of them would have been wasted work that appeared to
succeed:

- **The YouTube embed.** The article
  `data/noema-mythology-of-conscious-ai` really does carry
  one, the sanitiser really does permit it ([security.md](security.md)), and an embedded player
  really is its own JavaScript application in its own renderer process — so it is invisible to any
  profiler pointed at our page, which is exactly the shape of thing that stays unfound. It costs
  **0.5% of a core** sitting there unplayed, measured on a page containing nothing else. Real, and
  nowhere near the complaint. Hypothesis dead.
  **And a second time, by a better-looking route.** A browser pass came back with what appeared to be
  the answer: remove the `<iframe>` from a live reading view and foreground CPU fell **3.1% → 0.3%**
  while our own component re-render rate fell **44/min → 0/min**. A tenfold difference, with a
  plausible mechanism attached — the embed provoking `useColumnContext`'s `ResizeObserver` and
  re-rendering the panels.

  It is a confound, and the giveaway is in the report rather than the reasoning. The with-iframe
  window contained a page reload; the without-iframe window did not. Its nine "idle" fetches were
  `/api/article`, `/api/comments`, `/api/chat`, `/api/glossary` and `/api/library/…/open` — the mount
  cascade, twice over because dev runs `StrictMode` — and its thirty-six renders were six cycles of
  `ArticlePage` / `Reader` / `Spine` with three `ContextPanel`s each, which is what those five
  responses landing looks like. So the comparison was *(a window containing a page load)* against
  *(a settled page)*, and the iframe was not the variable. It is the same trap
  [described below](#the-traps-all-of-which-produced-a-confident-wrong-number-first), found twice in
  one day, which is why it gets a paragraph rather than a line.

  The direct check settles it: on a page carrying that embed and nothing else, once settled, the
  host frame did **zero layouts and zero style recalculations across 40 seconds** and cost 0.0% —
  every one of the 0.5% is inside the iframe's own process. A settled embed does not reflow its
  host, so it cannot be re-rendering our panels.

- **CSS animations on invisible elements.** There are six `animation: … infinite` rules in
  [`styles.css`](../../src/web/styles.css) and they cost compositor time that leaves no JavaScript
  trace. But every one of them is on an element that is conditionally rendered — a spinner while a
  job runs, a caret while an answer streams — and closed panels here are *unmounted*, not hidden.
  Counted live on the reading view: **zero elements with a running animation**.
- **Six job pollers on the reading view.** This one was mine, it was wrong, and the code's own
  comments agreed with me — [`useJobs.ts`](../../src/web/useJobs.ts) still said "the reading view
  has one for the thread panel, one for the glossary and one for summaries". It has none. The bands
  are mutually exclusive (`mode === …` in [`App.tsx`](../../src/web/App.tsx)) and the default mode
  opens no band at all — `toc` when this was written, `hierarchy` after the 2026-08-29 rename, and
  `plain` since 2026-08-31. A stale comment is a fine reason to believe something false.

## What was fixed

Five changes, all of them about work nobody asked for. The first is the big one for a background
tab; the rest are small and unarguable.

### The job poller stops when nobody is looking

[`useJobs.ts`](../../src/web/useJobs.ts) polled `/api/jobs` every eight seconds, rescheduled from
each response, and never stopped — about 450 requests an hour, each one waking a React subtree to be
told that nothing had changed. It now polls only while the tab is visible, and polls immediately on
coming back rather than at the end of whatever was left of the interval.

**Three things about that were nearly wrong, and a GPT Sol review caught all three before any of it
was built:**

1. **Pausing the poll must not pause `drive`.** On a serverless host there is no worker process —
   the *browser* walks a job through its steps, one request per step
   ([ingest-queue.md](ingest-queue.md)). Gating everything on visibility would stall an ingest the
   moment the reader switched tabs and resume it when they came back, which is the opposite of what
   a queue is for. It would also have looked exactly like flakiness. Only the status GET pauses.
2. **`poke` cannot simply be dropped while hidden.** An action can finish *after* the tab is
   backgrounded, and its poke is what discovers the job it just created. A hidden poke still makes
   one reconciliation request; it just does not arm the timer afterwards.
3. **Clearing the timer on the way out is not redundant.** Declining to arm a *new* timer still
   leaves the one armed a moment before the reader left, which fires seconds into a tab nobody is
   watching. That is the difference between "almost none" and none — and only the second is a thing
   a test can hold.

Beside it, `setJobs` now bails out when the job list is unchanged. Every poll installed a
freshly-parsed array, so the identity changed on every response and React re-rendered the owning
panel to paint the same pixels.

### …and `drive` had to learn to recover on its own

**This is the hole the first version left**, and it is here rather than in a postmortem because the
shape is worth carrying: *a fix removed the thing something else was quietly depending on.*

`drive` used to swallow a failed advance, wait, and exit, releasing the job — safe only because the
status poll came along within eight seconds and started a fresh driver. Pausing those polls while
hidden removed exactly that. So one transient rejection — a dev server restarting, a dropped
connection — left an ingest stopped until the reader came back and looked at the tab.

An ingest that stalls only when nobody is watching and resumes the moment they look is close to the
worst bug shape available: every attempt to reproduce it succeeds, and it reads as flakiness for
months. The driver now owns its own recovery instead of borrowing the poller's, which also makes it
correct independently of how the poll is scheduled.

Found by the second GPT Sol review — the one on the built code, which
[CLAUDE.md](../../CLAUDE.md) says to weight higher than the plan-stage one, and this is why. And the
regression test could not see it either: its fake `/advance` always succeeded, and its
`readJson` stand-in did not throw on a non-2xx the way the real one does
(`src/web/lib/api.ts` § `readJson`). A test that cannot reach the error path passes for
the same reason a correct one does.

### The clock stops too

[`useNow.ts`](../../src/web/useNow.ts) re-read `Date.now()` every minute forever so that "3 minutes
ago" would not rot. Nobody is watching it rot in a background tab. It pauses while hidden and reads
the clock **immediately** on return — that catch-up is what makes the pause safe, and is the one
failure this change could have introduced.

### The chat anchors are memoised

`anchored(...)` and `countByBlock(...)` were called inline in `Reader`'s JSX, so `TableView` got two
new object identities on *every* Reader render, including ones with nothing to do with chat. That
invalidated `marksByBlock` and could take the article-wide re-annotation with it: an O(article) job
charged to an unrelated state change.

### Scrolling no longer re-runs the force simulation

(Written when there were six pictures; five have since been cut and only Force, Drift and Trail are
left — [diagram.md](diagram.md). The fix and the measurement below stand, and Force is still the
expensive layout the saving is about.)

`atRow` — the reader's position — was a dependency of the diagram layout memo for all six pictures.
`arc`, `force` and `cluster` returned `nowY: null` and never looked at it, so for those three it was a
dependency nobody read — and scrolling with `Force` open re-ran a 300-tick d3 simulation (**39ms at
60 sections, 113ms at 150**) to produce a picture identical to the one it had just thrown away, once
per section, all the way down the article. Those three are also the expensive layouts, so excluding
exactly them is where the whole saving is. See [diagram.md](diagram.md).

**The first version of this excluded `drift` and `trail` too, and that was wrong.** Both read
`atRow` — `drift` for its position line, `trail` to brighten the chain around the reader — from
[`scatter.ts`](../../src/web/scatter.ts), which was simply not one of the files grepped. *A grep over
the wrong set of files reads exactly like a grep that found everything.* It would have shipped two
pictures whose you-are-here line silently stopped following the reader: nothing throws, nothing looks
wrong in a screenshot, and `tests/scatter.test.ts` goes on passing, because the layout functions were
never the thing that changed. Caught by the second GPT Sol review.

## The traps, all of which produced a confident wrong number first

**A window that includes page load is not idle.** The first "60 seconds of idle" here was 14 seconds
long and contained nine `/api/…` fetches — the mount cascade. Its render count was about four times
the true one. `measure-cpu.ts` takes `--settle` for this reason and it is not decoration.

**`visibilityState` lies under extension automation** — and by now the evidence is not anecdotal.
Across roughly ten attempts, two tabs and two renderer processes, a browser pass never once got a
`"visible"` reading, including on a tab it was actively scrolling and screenshotting.
[browser-testing.md](browser-testing.md) already warned about it; treat it as **"this harness cannot
currently produce a genuinely-visible reading"** rather than as flakiness, and use
`measure-cpu.ts --hidden` when the visible/hidden split is the thing you are measuring. `perf.ts`'s report therefore carries
a `tab` field with `visibilityState`, `hasFocus` and the hidden bucket's frame count next to each
other: three sources that agree are a measurement, one that disagrees is a warning not to believe
the buckets. A genuinely hidden tab is served **no animation frames at all**, so that count is the
honest one.

**A cross-origin iframe is not in your page's metrics.** The first version of `measure-cpu.ts`
attached to the top frame only and reported the embed page as costing **0.0%** — a precise, wrong,
welcome-looking answer, which is [silent-success](../reusable/silent-success.md) with a profiler on
it. It now attaches to every out-of-process frame and prints the split — deliberately `iframe`
targets only, never another `page`: a second page is a second tab, and an in-process frame has no
target of its own and is already counted inside the top frame, so summing pages would inflate and
summing in-process frames would double.

**`TaskDuration` is not CPU.** See [above](#the-last-column-is-not-cpu). The failure was not the
metric; it was quoting a number without checking which clock it came off.

**`ps` on macOS gives a lifetime average.** A process busy for its first minute and asleep since
still reports a few percent forever, and no amount of sampling moves it. `chrome-cpu.ts` differences
two samples for this reason; the lifetime figure is printed beside it, labelled, because the two
disagreeing is information. Observed here: one renderer at 48.5% by delta and 1.1% by lifetime.

**Chrome freezes background tabs**, so a hidden-tab measurement can quietly become a measurement of
a frozen tab — and the tab stops answering `Runtime.evaluate` at all, which reads as a crash.
`measure-cpu.ts` disables the freezing and the timer throttling, because the point is to measure what
we ship rather than the browser's rescue of it.

**This machine had 76 Chrome renderers alive**, four of them over 80% of a core from unrelated tabs,
and five appeared or vanished inside one 25-second window. Renderer identification by "the busiest
one" is hopeless there; `chrome-cpu.ts` therefore identifies a tab by making it burn CPU on purpose
(`window.__perf.spin(9000)`) and looking for the jump.

## The shelf was in an infinite render loop, 2026-08-27

The worst number on this page was found by a bug report rather than by any of the instruments above:
the **homepage** was doing roughly **470 renders a second while nobody touched it**, and typing one
character into any of its inputs froze the tab outright. Every doc here was about the reading view;
this was one room along.

The cause was a fresh `[]` per render feeding a `useMemo`, feeding TanStack's sorted-row-model memo,
whose `onChange` queues a page-index reset, which sets React state, which renders again.
[260827e-shelf-render-loop.md](../postmortems/260827e-shelf-render-loop.md) has the ring, the fix, and the stack
trace that named it.

Three things from it are worth carrying into any future hunt here.

**A page in an infinite render loop looks exactly like a page.** The DOM was correct and stable at
339 nodes. Nothing on screen was wrong — it was just being rebuilt three hundred times a second.
[silent-success](../reusable/silent-success.md) usually means a check that agrees with the code;
this was the *output* agreeing with the code. Do not take "the page looks right" as evidence of
anything.

**A CDP input command that never returns is a renderer that is not running its event loop.**
`Input.insertText` is acknowledged by the renderer, so a 15-second timeout on it is a wedge, not a
slow page. That is the single cheapest freeze detector available, and it needs no probe in the page.

**A false-conditioned breakpoint is a counter you can attach to somebody else's library.**

```js
await cdp.send("Debugger.setBreakpointByUrl", {
  urlRegex: "tanstack_react-table",
  lineNumber: 1536,
  condition: "(globalThis.__resets = (globalThis.__resets || 0) + 1, false)",
});
```

The condition runs on every hit; because it evaluates falsy the debugger never pauses and the page
runs at full speed. This is what turned "it wedges when you type" into "it was wedged the whole
time, you could not tell": **2,358 hits in five seconds at rest, and 0 after the fix.** It works on
minified vendor code, needs no source edit, and — unlike `perf.ts` — costs nothing to leave off.

Two companions to it, when a page is already spinning:

- `Debugger.pause` **does** break into a running script (it is a V8 interrupt), so a wedged tab is
  still inspectable. The stack alone said `processRootScheduleInMicrotask → performSyncWorkOnRoot →
  renderRootSync`, repeating.
- The React fiber hangs off any DOM node as `__reactFiber$…`, so from a paused frame you can walk to
  the root and read `root.memoizedUpdaters` — the set of fibers that scheduled the work. It named
  `Library` in one step, with no React DevTools involved.

## The regression test

[`tests/idle-work.test.ts`](../../tests/idle-work.test.ts) holds the behaviour rather than the
number: **a hidden tab issues no requests**, and **a running job keeps advancing anyway**. A
profiler figure is about one laptop on one afternoon and nothing enforces it tomorrow; those two
sentences are exact, deterministic under fake timers, and fail loudly the moment somebody adds a
poller that does not check.

Its first test asserts that polling *does* happen while visible, which looks redundant and is the
most important line in the file. A harness that has quietly broken — a mock that never resolves, a
hook that threw on mount — also reports zero requests, and reads as a pass.

## The 82% tab, 2026-08-27

Greg sent two screenshots: Chrome's task manager with `Tab: Spideryarn · AI-assisted reading` at
**81.9%** of a core, two `challenges.cloudflare.com` subframes under it at 13.4%, and Activity
Monitor agreeing at 101.9% for the same renderer (PID 62201). Alongside it, `Network 0`.

**None of the six fixes above is contradicted by this, and none of them is exonerated either** — the
tab was never identified. What follows is what the evidence rules out, so the next person starts
further along rather than repeating it.

### The premise that was wrong

The message said the web servers were not running. Four were: `lsof` found `vite` on 5273, 5275,
5276 and 5277, all of them this repo. (`:3000` is an unrelated Electron app.) That matters because
the most attractive hypothesis depended on it — a `useEffect` that sets state on a fetch failure has
no natural throttle when the socket is refused in microseconds, so a render storm that looks mild
with a live server pegs a core without one. It is a good hypothesis. It is not this.

The lesson is the ordinary one: **check the premise before building on it.** A wrong premise handed
to a reviewer comes back as forty-five minutes of confident reasoning about the wrong thing.

### What was measured, and what it says

| Page | Where | Cost |
|---|---|---|
| Signed-out landing page | clean Chrome, `measure-cpu.ts`, 30s after a 5s settle | **0.2% of one core** |
| Reading view | Greg's own screenshot, PID 59814 | **0.0%** |
| The hot tab | Greg's screenshot, PID 62201 | **81.9%** |

The reading view row is the useful one, and it is Greg's own machine rather than ours: **a settled
reading view costs nothing**, which is where most of the suspicion had been pointing.

### The Cloudflare frames are not ours

Two `challenges.cloudflare.com` subframes sat inside our tab. Nothing in this repo can put them
there:

- No component renders an `<iframe>` at all.
- The sanitiser's embed allowlist is three origins — YouTube, youtube-nocookie, Vimeo
  ([`sanitize-policy.ts`](../../src/sanitize-policy.ts)) — and every other `iframe` is deleted.
- The Supabase SDK takes a caller-supplied captcha *token*; it contains no Turnstile widget and
  injects nothing. Auth calls only run from button handlers in
  [`SignInControls.tsx`](../../src/web/SignInControls.tsx).
- A challenged `fetch` comes back as **data**. It cannot become an executing frame.

And production serves nothing of the kind: `curl https://www.spideryarn.com/` returns 1,400 bytes
with exactly one `<script>` tag and no mention of Turnstile.

So the frames come from the browser, not the app — a content script is the obvious candidate. That
does **not** on its own explain the tab's 81.9%, because that figure belongs to the parent frame;
but a content script runs in the page's own renderer, so it is charged there. The two candidates
that survive are *the signed-in shelf* and *an extension*, and telling them apart needs that tab.

### What a cross-family review refuted

GPT Sol was given the code and the screenshots and killed most of the list with citations, which is
worth keeping so it is not re-derived:

- **`useJobs` cannot spin.** Its effect deps are `[]`, a failed poll schedules 8 seconds, and
  `drive()` keeps the `driving` guard and waits 8 seconds *inside* its loop. It cannot release and
  re-enter tightly.
- **Supabase refresh cannot spin.** The installed ticker is 30 seconds with exponential backoff and
  a 60-second cooldown, and a refused localhost request throws before the `401` branch in
  `lib/api.ts`, so it never reaches `refreshSession()`.
- **The rAF loops are event-driven, not self-arming.** `App.tsx` schedules only from scroll;
  `useColumnContext` from scroll, resize and a `ResizeObserver`, and it equality-checks before
  calling `setLive`. Spine and DiagramPanel likewise.
- **The SSE hooks do not restart on failure.** `readEvents` blocks on `reader.read()`. Their missing
  unmount abort is a leak during active work, not a spin at rest.
- **The microphone loops do re-arm every frame** — `useAudioLevel.ts` and `MicLevel.tsx` are the
  only paths here that genuinely do — but they need a live track, and `MicLevel` mounts only while
  dictation is armed.

Checked locally and also dead: **no stale spinner.** The 36 job files hold 71 `skipped`, 62 `done`,
21 `pending` and 15 `error` steps and **zero** `running` ones, and every job's own status is `done`
or `error`. So `isBusy()` is false, the shelf polls at the slow 8 seconds, and no
`animation: cmt-spin … infinite` is mounted.

### The trap this round, again

The probe run against a tab opened through the extension reported `requestAnimationFrame` never
firing, and the tool called the renderer *frozen*. It was not: `document.visibilityState` was
`hidden`, and **rAF does not run in a hidden document** — which is the same trap already listed
below, arriving with a new disguise and a confident error message attached. A measurement harness
that cannot see the page cannot tell you the page is broken.

## Scrolling, 2026-08-27

Greg (the Contents mode was renamed Hierarchy on 2026-08-29): *"it looks like CPU usage spikes
briefly e.g. when I scroll in the main Contents & Text
view."*

That is work a reader asked for, so it is allowed to cost something. It was costing a re-render of
the whole rail sixty times a second.

### The auth wall came down

Everything below depends on one thing: **the signed-in reading view can now be measured without a
human.** [`scripts/seed-local-session.ts`](../../scripts/seed-local-session.ts) asks the *local*
Supabase — already running in Docker, its keys deliberately not secret
([supabase-local.md](supabase-local.md)) — for a magic link, and hands the `hashed_token` to the
app's own SDK instance through `verifyOtp`. `measure-cpu.ts --local-sign-in` does it and then
measures.

**Not** by writing `localStorage` ourselves, which needs the SDK's private storage format, and
**not** by following the link, because the app is on `flowType: "pkce"`: a browser that did not
begin the flow has no code verifier, the exchange fails, and `useSession` is documented to notify
nobody when it does. You get a landing page that looks like an article still loading. That is
exactly what happened first, and it is why the harness now prints what is on screen.

### Four ways this measured the wrong thing first

Every one of them returned a plausible number.

- **A page that never rendered.** The first signed-in run reported 345 DOM nodes and a lovely low
  cost. A real article is 3,639 nodes and 92,703 pixels tall. A blank page is genuinely cheap, so
  the number was *correct* and meaningless. Every run now ends with `page: 360 rows, 360 prose
  blocks, … tall` and shouts if there are no rows.
- **Two Chromes, one debugging port.** `measure-cpu.ts` hardcoded `--remote-debugging-port=9333`.
  Run a before and an after together and the second Chrome loses the port, exits that listener, and
  the second script connects to **the first browser** and measures its tab. No error. Now Chrome
  picks the port (`--remote-debugging-port=0`) and we read it back from `DevToolsActivePort`.
- **Vite reloading the page mid-measurement.** Its watcher covered `data/`, which the tests write
  to constantly, so the log filled with `page reload data/test-carry-forward/article.html` and the
  window straddled a reload. That resets the metric counters, so the run reports **negative** CPU —
  the one failure here honest enough to be obvious. `server.watch.ignored` now excludes `data/`,
  `docs/` and `evals/`. **This is a reader-facing fix too**: a reader with an article open was
  having it thrown away and rebuilt while agents wrote fixtures.
- **My own edit.** One window was ruined by saving `Spine.tsx` while it ran. A dev server is a
  moving target and a shared tree is a moving target with several people pushing it.

The last two are why before and after are now measured in **two git worktrees**, each with its own
server, both holding the current working tree and differing only in the files under test.

### What it costs, and what changed

30 seconds of wheel events on a 22,500-word article (360 rows). `--scroll` dispatches real
`Input.dispatchMouseEvent` wheels rather than `scrollTo`, because only the first goes through the
compositor and the passive listeners.

| | before | after |
|---|---|---|
| **Spine renders** | 886 | **114** |
| **TableView renders** | 170 | **104** |
| ContextPanel renders | 510 | 468 |
| main-thread script | 14.4% | **10.1%** |
| main thread, total | 33.6% | 28.7% |
| whole renderer process | 41.5% | 37.2% |

**Trust the render counts, not the percentages.** Two runs of identical code put the renderer at
30.1% and 37.2% — about 20% run-to-run noise, on a laptop with several dev servers and a dozen
agents on it. The render counts repeated to within 1% across runs, and they are the thing the
change is actually about. Idle is unchanged at 0.5–0.6% of a core.

### The rail stopped re-rendering

[`Spine.tsx`](../../src/web/Spine.tsx) held the scroll position in React state — a rAF-debounced
`setScrollY(window.scrollY)`. That is the ordinary way to write it, and it re-renders every band,
tick and tooltip to move one div a few pixels.

The two things a scroll drives are now split by how often they change. **The viewport band's
position** changes every frame and is pure presentation, so it is written straight to the node
(`el.style.top`), the same trick `MicLevel.tsx` uses for `--level`. **Which band is active** changes
when the reader crosses a part — a handful of times per article — so it stays in state, with a local
mirror of its id so the setter fires only on a real transition, the same trick as
`useAudioLevel.ts`. React never clobbers the imperative `top`, because the element's `style` prop
does not contain it.

Pinned by [`tests/spine-scroll.test.ts`](../../tests/spine-scroll.test.ts), which was watched
failing against the old code first: *expected 6 to be 2* for four scrolled frames.

### The table stopped re-rendering — GPT Sol's finding, and the bigger one

`useColumnContext` samples geometry every frame and calls `setLive` whenever the answer changes,
which near the masthead is most frames. It was being called by **`TableView`**, so each of those was
a re-render of the entire block-by-column map — several hundred rows — to move three overlays.

The hook and the overlays now live in a `ColumnPanels` child. Nothing about what is drawn changes;
the panels re-render per frame exactly as before, and the table does not. What still goes upward is
deliberate: hovering a panel entry lights a chain that crosses every column, so that one *must*
re-render the table. A hover is a gesture; a scroll is sixty frames a second.

`TableView` did not fall to zero — 104 renders remain, and they track `Reader`'s 131. Those are
`useReadingPosition` writing `?at=` as sections pass the reading line, which is a deliberate
feature ([url-state.md](url-state.md)) and now the largest remaining cause.

## Scrolling rebuilt the whole article, 2026-09-03

**Every one of those remaining renders was destroying and rebuilding the DOM of every paragraph in
the article, with byte-identical HTML.** On a 551-block article a plain scroll did it **18,734**
times — 34 renders × 551 blocks, exactly. Fixing it is the largest main-thread saving recorded on this
page.

| production build, 25s of wheel events, 551 blocks | before | after |
|---|---:|---:|
| **main thread CPU**, % of one core | 77.3 / 77.0 | **49.1 / 48.9 / 49.1** |
| script, % of the window | 22.2 | 17.9 |
| **layout**, % of the window | 17.1 | **0.8** |
| **style recalc**, % of the window | 10.6 | **0.9** |
| prose subtrees rebuilt | 18,734 | **0** |

Two matched runs before and three after, spread ±0.3 — much tighter than the ±20% this page warns
about, because the box was quiet and the harness owns its browser. Only the first row is CPU; the
three below it are wall-clock inside main-thread tasks, per
[§ The last column is not CPU](#the-last-column-is-not-cpu) — which this table got wrong on its
first draft, so the trap is live. `ProcessTime` was unavailable (headless), so this is the largest
measured **main-thread** saving on this page and says nothing about compositor or raster. Full
working: [260903l](../plans/260903l-prose-innerhtml-rewritten-on-every-scroll-render.md).

### React compares the wrapper, not the html

```tsx
dangerouslySetInnerHTML={{ __html: proseHtml.get(block.id) ?? block.html }}
```

The memo feeding that line was already careful, and **the string was never the problem.** React
decides a prop changed by identity, and the value it compares for `dangerouslySetInnerHTML` is the
`{ __html: … }` **wrapper** — so an object literal in JSX is always "changed", and `setProp` then
runs `domElement.innerHTML = …` *unconditionally*, with no test against what is already there
(`react-dom-client` § `updateProperties`, and the assignment in `setProp`). Writing an identical
string still tears the paragraph down and rebuilds it.

So the obvious way to write that line is the slow way — the same shape as
[the rail](#the-rail-stopped-re-rendering), and the reason both now have a test. The memo hands out
stable `{ __html }` objects instead, one for every block, reused whenever the html is unchanged.
That also means a streaming comment rewrites the paragraphs it touches rather than the article,
which is item 1 below, addressed as a side effect.

### Two things this changes about how to measure here

- **Measure a production build, or measure the wrong half.** In dev, `jsxDEV`,
  `validateProperty` and friends are about half of all script, and a profile taken there points at
  React re-renders. In the production bundle script fell to 22% while **layout and style rose to
  28% between them** — the opposite priority. `--sign-in-via` exists so this is possible at all;
  see below.
- **A mutation census beats a profiler for this class.** The hottest frame in the profile was
  `apply` in [`scroll.ts`](../../src/web/scroll.ts) at 36% of script, and the tempting read was
  "`watchBarVisibility` is expensive". It is not. Its self time was a **forced synchronous layout**,
  charged to whichever function first reads `window.scrollY` after something dirties the DOM — it
  was the victim, and moving that read would have moved the cost rather than removed it. Counting
  DOM mutations during a scroll named the real cause in one step, and `18,734 / 551 = 34.0` is what
  turned a suspicious number into a mechanism.

## Scrolling re-rendered the whole reading view, 2026-09-04

The day after, and the same shape one level up: nothing was rebuilding the DOM any more, but
`TableView` and `Spine` were still being **reconciled 87 and 150 times per scroll** because
`useReadingPosition` writes `?at=` as sections pass the reading line and that re-renders `Reader`.
None of `TableView`'s 29 props depends on `at`. Both are now `memo`ised — the first two `memo`s in
`src/web` — and four inline arrows at the call site in `App.tsx` became `useCallback`s so the memo
could hold. [260904a](../plans/260904a-more-scroll-cpu-wins.md).

**And one prop left on 2026-09-05, which is the same lesson from the other end.** `navDepth` — the
column ← / → are aimed at — changed on every movement of the pointer, so moving the mouse across the
table reconciled all of it to change one underline in the header row. The header row has no height
now, the aim is drawn by tinting the column, and that is `data-aim` on `.reader` plus a rule in
`styles.css` — one attribute write, no render.
[keyboard.md § The aim is visible before you press anything](keyboard.md#the-aim-is-visible-before-you-press-anything).
**A `memo` is only as good as the props that reach it**, and a prop that changes with the pointer is
the cheapest kind to notice and the easiest to leave in place.

**Both sides measured with the same harness and the same input** — 417 wheel events, 50,040px of
travel, every run. "Before" is a detached worktree at `HEAD`, built and served on its own port.

| 25s scroll, 551 blocks, production build | before | after |
|---|---:|---:|
| `TableView` renders | 87 / 88 | **0 / 0** |
| `Spine` renders | 149 / 151 | **63 / 63** |
| `Reader` renders | 87 / 88 | 89 / 88 |
| **main-thread CPU**, % of one core | 56.1 / 55.1 | **44.1 / 42.1** |
| **p95 frame** | 66.6 / 50.0ms | **16.8 / 16.8ms** |
| **rAF intervals over 32ms** | 12.1% / 9.5% | **2.8% / 2.4%** |

**The frame numbers are the ones to quote, and they are new.** Until this run nothing here measured
smoothness at all — only CPU, which is a budget rather than an experience. `measure-cpu.ts --scroll`
now prints `p95 frame …, N/M rAF intervals over 32ms` on every run.

**Read that count for what it is.** It counts rAF *intervals* longer than 32ms, once each, over the
intervals that were delivered. A 133ms gap is roughly seven missed 60Hz opportunities and increments
it once, so it is a comparative jank signal and **not** a dropped-frame rate — do not write "one
frame in nine". The p95 is the cleaner number: it went from 50–67ms to 16.8ms, which is the tail back
at one-refresh cadence, while the worst case is still 117–133ms.

`Reader` not moving is correct: it owns the `?at=` subscription, so it goes on rendering and only its
memoised children skip. `Spine` halving rather than going to zero is also correct — the rail has its
own scroll listener and *should* follow the reader.

### Three things this changed about how to measure here

1. **The wheel harness was flattering the slow side.** It `await`ed each
   `Input.dispatchMouseEvent` before sleeping, so a page whose main thread was busy acknowledged
   more slowly and therefore **received fewer wheel events** — 325 against a static clone's 370, and
   90 against 370 in dev. The slower side of every comparison was asked to do less work, which means
   every before/after run before 2026-09-04, including the 77→49 above, was **biased toward
   understating** the improvement — the direction is clear, the size is not, because wheel
   coalescing makes it nonlinear. The loop now runs on a fixed schedule against its own start time and does not await
   the ack; `dispatched` and `totalDistance` are printed, and `totalDistance` should be
   `dispatched × 120`.
2. **Where the pointer is, is a variable.** The synthetic wheel was hardcoded at `400,400`, which is
   over `table.zoom`, and every `<tr>` carries an `onMouseEnter`. `--wheel-x` / `--wheel-y` move it,
   and the run prints whether the point landed inside the table — because a "pointer away" run that
   was secretly still over it looks exactly like a null result. The answer, for anyone who does not
   want to re-run it: **77–79 `TableView` renders over the table against 74–76 off it**, which is
   noise, and a capture-phase listener saw **0** `mouseenter` events from 60 synthetic wheels
   against 12 from three real `mouse.move`s. Chrome does not recompute hover from a compositor
   scroll under a stationary *synthetic* pointer. Real hardware is unmeasured; nobody here has a
   trackpad.
3. **Check you are measuring two different things.** The first "before" run came back identical to
   the after — no `TableView` renders at all. `vite preview --config <other tree>` had resolved its
   `outDir` against the current working directory and was serving the *new* bundle to both ports.
   Both answered 200, both printed `551 rows`. What gave it away was that the before numbers were
   too good. `curl -s localhost:PORT | grep -oE 'src="[^"]*"'` on both ports settles it in a second,
   and belongs in the recipe: this page already says believe the `N rows` line rather than the
   percentage, and that is not far enough.

### What is left, and it is not script

The unclassified bucket is `TaskDuration − ScriptDuration − LayoutDuration − RecalcStyleDuration`,
all four wall-clock inside main-thread tasks. **Do not compute it against `ThreadTime`**, which is
CPU and a different clock — the first draft of this section did, and the numbers happened to be
close, which is how that survives.

| % of the 25s window | before 1 | before 2 | after 1 | after 2 |
|---|---:|---:|---:|---:|
| `TaskDuration` total | 60.9 | 57.8 | **44.2** | **41.9** |
| script | 23.5 | 23.1 | **5.9** | **5.8** |
| layout | 0.8 | 0.8 | 0.9 | 0.9 |
| style | 1.2 | 1.2 | 1.0 | 1.0 |
| **unclassified** | **35.4** | **32.7** | **36.4** | **34.2** |

**Every point of the improvement came out of script, and the unclassified bucket did not move.**
About 34% of the window is main-thread task time Chromium does not attribute to script, layout or
style — the same before and after — and nobody knows what it is. Paint, compositing commit,
hit-testing and event dispatch all live there. It is also the whole remaining gap over the ~12%
floor, so **it is where the next investigation goes.**

The instruments for it, neither tried: a Chrome trace, or `SystemInfo.getProcessInfo` on the
**browser-level** CDP socket, which reports cumulative `cpuTime` per process across all its threads
and is the way to the whole-renderer figure `ProcessTime` cannot give under headless. Attribution
there needs an isolated browser, or a mapping from renderer processes to targets.

**No obvious single hot JavaScript function remains** — which is weaker than "another round of render
work is not the lever", and is what one sampling profile of one article actually supports. That
profile finds 2,647ms of script in 25 seconds, its largest self-time entry the garbage collector,
then one minified React frame, then `getBoundingClientRect` (4.1%) and `replaceState` (3.1%).

**A story about event listeners, withdrawn.** A draft here explained 51,822 listeners falling to a
5,047 "steady state" as reconciliation churn. It does not hold: 51,822 came from the old ack-gated
run, and the four matched runs report 11,576 and 4,404 before against 4,534 and 2,759 after — one
"before" already below the claimed "after". The counter is GC-sensitive and noisy. Settling it needs
a forced GC before each reading, or the listener owners. Left open. GPT Sol caught this against the
saved run files, 2026-09-04.

### The hole a memo opens, which is not about performance

`blockHref` built 551 permalinks per render by reading `location.search` **during render with no
subscription**, on the stated grounds that "every parameter in the URL is `useQueryState` in App, so
any change to the query string re-renders this whole tree".

Half true, and the false half matters: **nuqs subscriptions are key-isolated.** Its adapter filters
`location.search` down to the keys each hook watches and returns the cached snapshot when those are
unchanged, so a parameter owned by a *child* wakes only that child. Ten reading parameters are like
that — `rank`, `bar`, `run`, `conf`, `deep`, `diagram`, `dx`, `dhue`, `referee`, `remember`. It never
bit because `?at=` re-rendered the reading view eighty-odd times a scroll and refreshed every href on
the way past. **A memo turns a self-healing staleness into a permanent one.** Found by GPT Sol
reviewing the plan, before it shipped.

The fix is [`router.ts`](../../src/web/router.ts) § `watchHistoryWrites` and `useAddressSearch` — one
wrapper on `history.pushState`/`replaceState` firing the app's existing `NAVIGATED` event, and a
`useSyncExternalStore` whose snapshot is the query **string**, so it compares by value and a write
that changes nothing renders nothing. Chosen over an inventory of the 35 parsers in `params.ts`
because an inventory is correct until somebody adds the thirty-sixth and the failure is a quietly
wrong link. Guarded by
[`tests/permalinks-follow-the-address.test.tsx`](../../tests/permalinks-follow-the-address.test.tsx),
watched red.

**The general lesson is worth more than the fix.** Any render-time read of a global — `location`,
`document`, a module-level mutable — is a subscription the component did not declare, and it works
only while something else re-renders it often enough to hide that. Memoising anything above such a
read retires the premise silently. Before adding a `memo`, look for what the subtree reads that is
not a prop.

### Still open, ranked, with citations

GPT Sol reviewed the plan and hunted for the spikes I had not looked at. What survived, in its
order, none of it done:

1. **Comment streaming re-renders the whole reader per token.** `useComments` is owned by `Reader`,
   so every delta replaces the `comments` array `TableView` consumes, re-resolving every anchor and
   rebuilding the prose HTML map. Chat does not have this problem because `useChat` deliberately
   sits *below* `Reader`. The fix is to mirror that ownership. Care needed: the delete race
   deliberately reads through to `done` ([comments.md](comments.md)).
   **The DOM half of this went on 2026-09-03, and only that half.** Every delta still replaces the
   `comments` array, still re-resolves every anchor and still rebuilds the whole HTML map — the
   O(article) computation is untouched. What stopped is the *writing*: only blocks whose html
   actually changed get new `{ __html }` objects, so a streaming answer now rewrites the paragraphs
   it touches instead of all of them. Moving the ownership is still the right fix and is still not
   done. (The first draft of this note claimed the item was addressed; GPT Sol pointed out that the
   expensive recomputation is still there.)
2. ~~**Literal search rebuilds its index on every keypress**~~ — **done, 2026-09-04**, and it was
   larger than this entry said: the index was not the search's, it was the whole client's. `page()`
   in [`search-hits.ts`](../../src/web/search-hits.ts) parses every block's HTML with
   `renderedText`, and **six** exported resolvers call it — two of them inside a loop, so referee
   mode was O(claims × blocks) parses and ticking one criterion paid for all of them again. Both
   halves this entry named are now cached on the `blocks` array's identity, in two `WeakMap`s: the
   parse eagerly, the folded text and offset map lazily, since five of the six resolvers never fold
   anything. The remaining half of the entry, **committing twice per key**, is untouched.
   [260904a](../plans/260904a-more-scroll-cpu-wins.md).
3. **The force simulation re-runs on revisits** (300 synchronous ticks, 39ms at 60 sections, 113ms
   at 150) whenever the reader leaves Force and comes back, and when `box.h` changes even though its
   effective height did not. A cache keyed on the graph inputs plus width and *normalised* height
   fixes both.
4. **Zero DOM reads per frame** is still available: rows are normal-flow, so a row's viewport
   position is `documentTop − scrollY` and could be arithmetic against offsets cached per layout.
   Sol's warning is worth heeding — the sticky column headers are **not** ordinary rows, their `top`
   is deliberately dynamic near the masthead, and `useReadingPosition` has no observer at all, so a
   naive cache would go stale on a late image or a font swap and point at the wrong section. Wrong
   position is worse than slow position.

And one more, found 2026-08-27 while reviewing the shelf's render loop
([260827e-shelf-render-loop.md](../postmortems/260827e-shelf-render-loop.md)) — same class, different room, not
fixed here because it is another stage's file:

5. ~~**An article with no glossary rebuilds `termSelections` every render.**~~ **Already fixed, and
   this entry was stale for a while before anyone noticed** — found 2026-09-04 while surveying for
   [260904a](../plans/260904a-more-scroll-cpu-wins.md). The `?? []` became `?? NO_TERMS`, a module
   constant in [`reader-capability.ts`](../../src/web/reader-capability.ts) § `NO_TERMS`, when the
   reader-capability work landed; [`App.tsx`](../../src/web/App.tsx) § `terms` carries a comment
   saying why. The memo below it — whose own comment records a GPT Sol measurement of **44–135ms**
   on a 400-block, 60-term article — has a stable dependency now.

   Worth the two lines it costs to say so: a "still open" list that quietly contains finished work
   sends the next person to fix something twice, and is the same failure as a doc that describes code
   that has moved.

Explicitly **not** worth doing, checked and dismissed: hover cards (delegated listeners, a 320ms
gate, a `MutationObserver` scoped to one open block), shelf search (already debounced and aborted),
chat streaming (already below `Reader`), keyboard and touch (one scan per key or completed swipe),
the summary panel (runs on target change, not on scroll). No runaway observer loop exists.

## Clicking, 2026-09-05 — and everything above this line is about scrolling

Greg, 2026-09-05 (Sentry `SPIDERYARN-READING2-1M`):

> The interface feels kind of sluggish when clicking around, changing modes and stuff like that for
> a really long article.

**Nothing on this page described a click.** Four rounds of work, every number a scroll — because the
first three complaints were about scrolling. A scroll is judged by its worst frame over thirty
seconds; a click is judged by how long it takes for anything to happen at all, and the two do not
measure each other.

`measure-cpu.ts --modes "Hierarchy,Summary,Outline,Plain" --repeats 3` is the instrument, new that
day. The unit is **click to next painted frame** — two `requestAnimationFrame`s after `btn.click()`
returns, so the handler's synchronous work and the frame that shows it are both inside it.

**Scope of every number below, as a dated example rather than a fact:** run 2026-09-05 on the
Hetzner box, production build served by `vite preview`, `SPIDERYARN_STORE=postgres`, signed in as
`dev-admin@spideryarn.local` via `--sign-in-via` against a dev server on another port. Slugs
`m1-kuhn-spya-a2zrjb` (2,046 blocks) and `scaling-hypothesis` (186 blocks) in the local store. The
bundle hash was checked on every rebuild, because this page records a day lost to `vite preview`
serving one bundle to both ports. Three other agents were on the box, which is what the spread in
the numbers is.

### The other axis nothing here had varied: length

Every measurement above was taken on 360 or 551 blocks. Run the same clicks on **2,046 blocks**
(152,077 words, 47,398 nodes, 560,860px tall) against a 186-block control, production build:

| mode switch | 186 blocks | 2,046 blocks | ratio |
|---|---:|---:|---:|
| **Hierarchy** | 203ms | **4,698ms** | **23x** |
| Summary | 185ms | 2,693ms | 15x |
| Outline | 99ms | 1,308ms | 13x |
| Plain | 86ms | 860ms | 10x |

Eleven times the blocks, twenty-three times the time. **Length is a dimension this page had not
varied, and it hid a quadratic.** If you measure only the familiar article you will not find these.

**Read those as a severe length-correlated cost, not as a scaling curve.** Two articles of different
structure, two warm samples each, in a fixed cycle — so "Hierarchy" is always *Plain→Hierarchy*, and
the two long-article samples were 5,567ms and 3,829ms, a 45% spread. The multi-second reproduction is
overwhelming; the exact 23x is not a durable estimate. GPT Sol, 2026-09-05.

**And the split was the opposite of 2026-09-03's.** Script 60.4% of the window against layout 3.0%
and style 9.8% — where the scroll work had found script at 22% and layout plus style at 28%. A
profiler pointed here on the strength of that precedent looks in the wrong place.

### Two native DOM calls were 52.8% of all script

| profile, self time | before | after fix 1 | after fix 2 |
|---|---:|---:|---:|
| `querySelector` | **38.1%** | *gone* | gone |
| `get ready` | 14.7% | 21.5% | *gone* |
| `getBoundingClientRect` | 4.5% | 5.9% | **29.9%** |

1. **`sections.map(s => document.querySelector('tr[data-block="…"]'))`**, in `useReadingPosition`
   and `useColumnContext`. One document scan per section is `sections x nodes`, which is the
   quadratic. Now one `querySelectorAll` into a `Map` — [`rows.ts`](../../src/web/rows.ts).
2. **`document.fonts.ready`**, read in `Spine`, `dock-fit` and `OutlinePanel` to re-measure after a
   font swap. Reading that getter is not free, and **`Spine`'s effect re-runs on `layoutKey`, so it
   re-read it on every mode switch** — GPT Sol attributed the whole 2,727ms node to that one call
   site. The other two are cold (`dock-fit`'s effect depends on a `useCallback(…, [])` and runs once;
   `OutlinePanel` mounts only in Outline) and were changed for consistency. A draft of this section
   said all three ran per switch; that was wrong, and it is the kind of wrong that sends the next
   person to optimise two things that cost nothing. Now the `loadingdone` event, which is cheaper
   *and* covers later font batches the one-shot promise misses —
   [`fonts.ts`](../../src/web/fonts.ts).

Result, taking the worse of two post-fix runs: Hierarchy **−39%**, Summary −33%, Outline −63%;
main-thread busy 82% → 66.5%. `Plain` did not move. The two post-fix runs put Summary at 1,554ms and
2,049ms, which is the run-to-run spread on a shared box and the reason none of these is quoted to
three figures.

**A frame vanishing from the profile is the strongest evidence available here**, and it is what
proved fix 2's premise — `get ready` was never directly shown to be `document.fonts.ready`, and
changing exactly those three reads is what removed it.

**But the profiler oversold fix 2**: it put `get ready` at 21.5% of script, and removing it moved
the wall clock by about 8%. Believe the smaller number. This page already says a `--cpu-profile` run
is for *finding* a cost and never the run you quote; this is the first time that has been shown as a
size error rather than an argument.

### What is left, and it is a design decision rather than a patch

`getBoundingClientRect` is now 29.9%, and **the mechanism is forced synchronous layout, not the call
count.** Three passes measure the whole article on every mode switch — `Spine.measure` takes a rect
for all 2,046 rows, `useReadingPosition` and `useColumnContext` one per section — and each is
separated from the last by a React render that writes to the DOM, so each flushes layout of a
560,860px document afresh.

Sharing **one** measurement pass between the three consumers is the safe half and probably most of
it. Caching offsets is the large half and is item 4 on § Still open, where the warning still stands:
a cache goes stale on a late image or a font swap, and **wrong position is worse than slow
position.**

Full working, with every command and date:
[260905d](../plans/260905d-mode-switching-is-sluggish-on-a-very-long-article.md).

### A third way to measure the wrong thing, found here

**A `PerformanceObserver` delivers in a later task.** The first version of `--modes` read its
`longtask` entries immediately after the paint, so the *same* Hierarchy switch reported `tasks: 0`
on one repeat and a 2,878ms task on the next — and `tasks: 0` reads as **"nothing blocked the main
thread"**, on a switch that blocked it for five seconds. Collection now waits 150ms, after the
headline number is taken. [silent-success.md](../reusable/silent-success.md), again.

And a smaller one worth knowing: **the first click of a `--modes` run is a click on the mode the
page loaded in**, which costs 20-30ms and looks like the fastest switch in the table. The report
prints `first` and `later mean` separately for exactly that reason.

## Startup, 2026-09-05 — and everything above this line is about a page already running

The first measurement here of what the browser downloads **before** anything on this page applies.
[`scripts/measure-startup.ts`](../../scripts/measure-startup.ts) is the harness: it drives Chrome
over CDP against a production build served by `npx vite preview`, clears and disables the cache per
run, and takes bytes from `Network.loadingFinished.encodedDataLength` — **wire bytes, not `ls`**.

```bash
npx tsx scripts/measure-startup.ts --base http://localhost:4291 \
  --sign-in-via http://localhost:4292 --local-sign-in --email dev-admin@spideryarn.local \
  --paths "/,/read/scaling-hypothesis,/design,/admin" --runs 3 --json out.json
```

**Time-to-readable-prose** is defined in that script's header and printed with every result: the
first *frame* on which a prose block has non-empty text, with a `MutationObserver` lower bound
reported beside it and a hard failure if the probe saw no frames or no prose. Routes with no prose
get a separately labelled TTFT, which is a different measurement and must not be compared with it.

### The two numbers that decide how a startup change may be reported

**Bytes here have a noise floor of exactly zero.** 24 runs, five entry points, two auth states, two
batches hours apart, one unchanged build: `454,911 B` every single time. That makes initial requested
JS a structural assertion wearing a number, and the only startup figure on this page worth gating on.

**Times here cannot see a few percent, and it is not close.** A second batch on the *same* build,
with the box's load average at 115, moved the reader route's median TTRP from **2,735 ms to
10,784 ms**. On loopback the whole 445 kB transfers in 137–242 ms, so a 2.5% change in it is four to
six milliseconds — three orders of magnitude under that. The box also produced only 5–15 frames a
second, so a frame-based timestamp is quantised at 70–200 ms before any of the above. **Quote the
2,505–10,984 ms spread whenever you report a startup timing**, so nobody mistakes silence for a null
result.

Two traps this turned up:

- **`vite preview` gzips on GET but not on HEAD.** `curl -I` reports `Content-Length: 1490905` and
  no `Content-Encoding`; the GET delivers 445,506 bytes. Trusting the HEAD reports emitted size as
  wire size and inflates every saving by about 3×. The script records `content-encoding` per
  response and prints it.
- **A 200 on an old chunk hash does not mean the server is stale.** `curl` for a *previous* build's
  `main-*.js` answers **200** — because the SPA fallback serves `index.html` for anything it does not
  recognise, `Content-Type: text/html`. A freshness check by status code passes on a genuinely stale
  server too. Check the entry hash in the served HTML, and the content type.
- **`/read/constitution` is not readable on this box** — signed in as the seeded
  `dev-admin@spideryarn.local` it answers *"This document isn't shared"*. Startup runs use
  `/read/scaling-hypothesis` (public, 12,646 words, 186 rows). Two runs on different slugs are not
  comparable.

### What lazy-loading /admin and /design was actually worth

[260905i](../plans/260905i-lazy-load-admin-and-design-routes.md), A4 of the architecture review.
Initial requested JS, gzip, from the build:

**Wire bytes**, three runs each, cache disabled, byte-identical in every run:

| Route | before | after | Δ |
|---|---:|---:|---:|
| `/` signed out | 2 reqs, 454,911 B | 4 reqs, 448,770 B | **−6,141 B (−1.35%)** |
| `/` signed in (shelf) | 2 reqs, 454,911 B | 4 reqs, 448,770 B | **−6,141 B (−1.35%)** |
| `/read/scaling-hypothesis` | 2 reqs, 454,911 B | 4 reqs, 448,770 B | **−6,141 B (−1.35%)** |
| `/design` | 2 reqs, 454,911 B | 5 reqs, 455,470 B | **+559 B** |
| `/admin` | 2 reqs, 454,911 B | 5 reqs, 455,246 B | **+335 B** |

**6,141 wire bytes, 1.35%** — and three things in that table matter more than the headline.

**Do not read it as "main shrank from 1,490 kB to 1,101 kB".** The split gave rolldown new splitting
points, so what `main` now shares with the two lazy chunks was hoisted into two **new shared
chunks** — `supabase-*` and `useNow-*` — that `main` then imports *statically*. The trace shows all
three issued within a millisecond of each other. They are startup requests, and quoting `main` alone
would claim a 26% win that does not exist.

**Raw bytes fell 33,231 and only 6,141 of that survived gzip.** Four chunks compress against four
dictionaries. That is the whole reason the realised saving came in at 1.35% against the 2.5% an
emitted-size *deletion* spike had predicted — a deletion never pays the split's compression cost. If
anyone later "corrects" 1.35% upward from the raw figure, this paragraph is why they should not.

**The two lazy routes now cost slightly more**, +559 B and +335 B, because they fetch a fifth chunk.
That is the right trade and it belongs in the record beside the win.

**This was not landed as a speed improvement and should not be cited as one.** It was landed as a
boundary: [`tests/eager-client-graph.test.ts`](../../tests/eager-client-graph.test.ts) walks the
static import closure from `boot.tsx`/`main.tsx` and fails if admin or design code is in it, **or if
the two sides start sharing a module nobody has signed off** — so the next thing added to the
administrator's table cannot arrive in every reader's startup unnoticed. That second clause is the
one that makes the sentence true: a fixed list of six file names would have passed a *new* admin
module imported eagerly, which is exactly how the guard was attacked and exactly how it would have
failed in six months' time.
Two incidental results worth knowing: the `[INEFFECTIVE_DYNAMIC_IMPORT] src/web/lib/supabase.ts`
line is gone from the build, and the Supabase SDK is now a separately cacheable chunk.

**And the ceiling for the rest of it, measured so nobody has to guess.** Stubbing *every* secondary
route — Landing, Features, Pricing, Contact, Privacy, Public shelf, Not-found, Add, Profile, Admin,
Design — to `() => null` and rebuilding gives 420.76 kB gzip against the 457.53 kB baseline. So the
whole secondary-route surface is worth **8%**, and the other 92% is the reader, the shelf and the
modes, which A4 requires to stay eager. Anyone hoping route splitting will halve this bundle should
start from that number.

## What we still do not know

Said plainly, because the fixes above are all real and none of them has been shown to be *the* 5.5%:

- **The 82% tab has never been identified**, and it is the only thing on this list a reader has
  actually complained about. The extension can only reach tabs in its own group, so a subagent
  cannot open somebody's existing tab; and a tab opened afresh through it comes up `hidden`, which
  disables exactly the instruments worth running. Two things settle it, both a minute of Greg's
  time:

  1. **Paste this into that tab's console** and send back what it prints. No `rAF`-only reading, so
     it survives the visibility trap:

     ```js
     (async () => {
       const a = document.getAnimations().filter(x => x.playState === 'running');
       const frames = await new Promise(r => { let n = 0; const t0 = performance.now();
         const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(n); };
         requestAnimationFrame(f); });
       const long = []; const po = new PerformanceObserver(l => {
         for (const e of l.getEntries()) long.push(Math.round(e.duration)); });
       po.observe({ entryTypes: ['longtask'] });
       await new Promise(r => setTimeout(r, 3000)); po.disconnect();
       console.log(JSON.stringify({ url: location.href, vis: document.visibilityState,
         nodes: document.querySelectorAll('*').length, running: a.length,
         names: a.map(x => x.animationName).slice(0, 10),
         iframes: [...document.querySelectorAll('iframe')].map(f => f.src || '(srcdoc)').slice(0, 10),
         framesIn2s: frames, longTasks: long.slice(0, 20) }, null, 2));
     })()
     ```

     `framesIn2s` near 120 means the main thread is fine and the cost is elsewhere in the renderer;
     a low number with fat `longTasks` means it is our JavaScript.

  2. **Open the same URL in an Incognito window**, where extensions are off by default. If the CPU
     goes with them, the answer is an extension and none of this code is implicated.
- ~~**The reading view's idle cost has not been split into script / layout / style.**~~
  **Done, 2026-08-27.** It needed a signed-in session, and that needed "one human step, once, ever".
  It does not any more — see *The auth wall came down* above. Idle is **0.5–0.6% of one core**,
  script and style both at 0.0%, with zero layouts across 30 seconds. The reading view at rest is
  not the problem and never was.

  ```bash
  npx tsx scripts/measure-cpu.ts --local-sign-in \
    --url "http://localhost:5273/read/<slug>?perf=1" --settle 20 --seconds 30 --scroll
  ```
- ~~**Nothing here has been measured on a production build.**~~ **Done, 2026-09-03**, and it changed
  the answer rather than confirming it — see
  [two things this changes](#two-things-this-changes-about-how-to-measure-here). What blocked it was
  the sign-in: `--local-sign-in` works by importing the app's *own* Supabase module, and only a dev
  server serves a module at its source path. `--sign-in-via <dev origin>` signs in there and carries
  the SDK's stored token to the origin being measured — the string moved is the one the SDK wrote,
  so it cannot drift out of step with the client that reads it, which is the objection to writing
  `localStorage` ourselves. Both origins are localhost and
  [`seed-local-session.ts`](../../scripts/seed-local-session.ts) still refuses any non-local
  Supabase.

  ```bash
  npm run build && npx vite preview --port 5299 --strictPort
  npx tsx scripts/measure-cpu.ts --local-sign-in --email <owner> \
    --sign-in-via http://localhost:5273/ \
    --url "http://localhost:5299/read/<slug>" --settle 20 --seconds 25 --scroll
  ```

  The paragraph below is why it matters, and stands: `npm run dev` runs `StrictMode`, which
  renders every component twice on purpose, plus `@react-refresh` and unbundled modules.
  `configurePreviewServer` in [`vite.config.ts`](../../vite.config.ts) now puts the API in front of
  `vite preview` so a built bundle *can* be measured. **`npm run build` works against any store** —
  it proves the client resolves, bundles and parses, and it never boots a store at all. It is the
  `vite preview` step that needs Postgres up
  ([supabase-local.md](supabase-local.md)), because preview really does serve API requests and Vite
  runs it with `NODE_ENV=production`, so the boot guard in
  [`src/store/index.ts`](../../src/store/index.ts) refuses the filesystem store — rightly, since
  that store has no owner column.

  Until 2026-08-28 the build refused too, which is why this used to say it needed Postgres:
  `vite.config.ts` imported `src/routes.ts` at the top level, and `vite build` sets
  `NODE_ENV=production`. That import is now lazy and only a server does it. **A build proves the
  bundle, not the deployment** — production-store assurance lives in the deployed server's own boot
  guard, the API smoke checks and `db:check` ([deployment.md](deployment.md)), never here.
- **Scrolling is measurably expensive and only half-addressed.** 603ms of blocking work across 27
  seconds of scrolling, in three long tasks. The diagram fix above removes one cause;
  [`Spine.tsx`](../../src/web/Spine.tsx) still sets state on every animation frame during a scroll
  and reconciles its whole rail, and `useReadingPosition` in `App.tsx` reads every section's
  rectangle per frame. Neither explains motionless idle CPU, so neither was done first.
- **Client streams are not cancelled when their owner unmounts.** `useSearch` and `useComments` call
  `readEvents` with no abort signal, so switching modes mid-stream can leave the browser receiving
  and parsing tokens for a panel that is gone. Conditional on having started work rather than a
  cost at rest, which is why it is here and not above. `useComments` needs care: its delete race
  deliberately requires reading through to `done` ([comments.md](comments.md)).

## Where the pieces are

**The instruments**

- [`scripts/measure-cpu.ts`](../../scripts/measure-cpu.ts) — the clean-browser harness. Flags:
  `--url --settle --seconds --scroll --hidden --local-sign-in --email --sign-in-via --cpu-profile
  --profile --sign-in --display --json`. It picks Chrome by platform and honours
  `SPIDERYARN_CHROME`; with no `DISPLAY` it goes headless, and `--display :99` puts it on the box's
  X server. **`ProcessTime` reads 0 under headless Chrome**, so a headless run reports main-thread
  CPU only and the whole-renderer figure — compositor and raster, the threads no main-thread
  profiler can see — is simply missing. Do not quote a headless number as a total
- [`scripts/seed-local-session.ts`](../../scripts/seed-local-session.ts) — signs a measuring browser
  into the **local** Supabase, and refuses any other host
- [`src/web/perf.ts`](../../src/web/perf.ts) — the in-page probe (`?perf=1`), and `useRenderCount`.
  Off unless asked for; patches `setTimeout`, `setInterval`, `rAF` and `fetch` when on
- [`scripts/chrome-cpu.ts`](../../scripts/chrome-cpu.ts) — the `ps` sampler, for a browser you
  cannot relaunch

**The tests that hold the fixes down**

- [`tests/idle-work.test.ts`](../../tests/idle-work.test.ts) — nothing polls while the tab is hidden,
  and a failed advance still recovers
- [`tests/spine-scroll.test.ts`](../../tests/spine-scroll.test.ts) — scrolling moves the rail without
  re-rendering it. Also the worked example of driving a React component in jsdom here: mock
  `perf.js` to count renders, stub `ResizeObserver`, shim `requestAnimationFrame`, set
  `IS_REACT_ACT_ENVIRONMENT`, and use **two** `act` calls — React flushes layout effects as the
  first one exits, so awaiting inside it waits before the frame is even requested
- [`tests/perf-probe.test.ts`](../../tests/perf-probe.test.ts) — the probe is genuinely inert when
  switched off
- [`tests/prose-not-rebuilt.test.tsx`](../../tests/prose-not-rebuilt.test.tsx) — a render that
  changes no block's html rebuilds **no** prose, and a block that gains a mark is rebuilt **alone**.
  The second assertion is the one that keeps the first honest: a memo that over-cached would satisfy
  "zero mutations" perfectly while silently never drawing a search hit again. It renders the real
  `TableView` against a committed fixture and counts with a `MutationObserver` — the same instrument
  that found the bug in the browser

**The code this keeps coming back to**

- [`src/web/Spine.tsx`](../../src/web/Spine.tsx) — the rail; writes its band's position to the DOM
- [`src/web/TableView.tsx`](../../src/web/TableView.tsx) — the table, and `ColumnPanels`, which owns
  the per-frame geometry so the table does not
- [`src/web/useColumnContext.ts`](../../src/web/useColumnContext.ts) — the per-frame sampler itself
- [`src/web/useJobs.ts`](../../src/web/useJobs.ts) — the poller, and `drive`
- [`vite.config.ts`](../../vite.config.ts) — `server.watch.ignored`, without which the tests reload
  the reader's page

**Related docs**

- [browser-testing.md](browser-testing.md) — every other way a browser measurement lies to you
- [ingest-queue.md](ingest-queue.md) — why the browser drives a job, which is why `drive` may not pause
- [supabase-local.md](supabase-local.md) — the local stack `--local-sign-in` depends on, and why its
  keys are not secrets
- [web-client.md](web-client.md) — the constraints the reading view is built under
- [testing.md](testing.md) — what is worth testing here and what deliberately isn't
- [silent-success.md](../reusable/silent-success.md) — the pattern behind most of the wrong numbers
  on this page

## If you are about to work on this

Read [Still open, ranked, with citations](#still-open-ranked-with-citations) first — GPT Sol ranked
what is left and, just as usefully, listed what it checked and found **not** worth doing, so you do
not spend a morning on hover cards.

Then three habits, all of which were learned the expensive way here:

- **Measure before you fix, and measure the thing you think you are measuring.** Three of the
  hypotheses on this page died on measurement rather than argument, and two "results" were pages
  that had never rendered.
- **Fix what nobody asked for before what somebody did.** A background poll costs a reader nothing
  they wanted; a scroll they asked for. Both are here, in that order.
- **Write the number down, with its noise.** A figure with no run-to-run range attached is a story,
  and the next person cannot tell whether they have made things better.
