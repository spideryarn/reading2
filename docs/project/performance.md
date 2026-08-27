# What the page costs when nobody is touching it

Greg, 2026-08-27:

> The CPU usage for the page seems very high. […] gradually bring down the CPU usage (especially
> when it's in the background, but ideally also when it's active) unless it's briefly doing
> something that really requires CPU.

That last clause is the whole standard. **Work a reader asked for may cost whatever it costs**; work
nobody asked for should cost nothing. A model call, a force simulation on the frame you press
`Force`, an ingest walking its five steps — all fine. A tab left open on a table doing four hundred
things an hour to change no pixel is not, and that is what this page is about.

## The three instruments, and which one answers which question

Measuring this went wrong twice before it went right, and both times the tool was the reason. Pick
deliberately:

| | Answers | Reach for it when |
|---|---|---|
| [`src/web/perf.ts`](../../src/web/perf.ts) — in the page, `?perf=1` | **why**: which timer, which component, how many fetches, visible vs hidden | you have a live page in front of you and want to know what it is doing |
| [`scripts/measure-cpu.ts`](../../scripts/measure-cpu.ts) — its own Chrome, over CDP | **how much**: real CPU for the whole renderer *and* for the main thread alone, plus the script / layout / style split, per frame | you want a number you can put in a commit message |
| [`scripts/chrome-cpu.ts`](../../scripts/chrome-cpu.ts) — `ps` against the Chrome you are using | **how much**, whole process, nothing else | you must measure the browser you are already signed into |

```
npx tsx scripts/measure-cpu.ts --url http://localhost:5290/ --settle 20 --seconds 45
npx tsx scripts/measure-cpu.ts --url … --hidden          # a real background tab
npx tsx scripts/chrome-cpu.ts  --seconds 60 --pid 51928  # a tab you cannot relaunch
```

### Use `measure-cpu.ts` unless you can't

It launches its own Chrome with its own profile and one tab, so nothing else is running in the
browser it measures — and it asks the DevTools Protocol rather than inferring from the process
table, so it can say *script* or *layout* or *style* instead of one number. That distinction is
usually the answer.

`chrome-cpu.ts` exists for the case `measure-cpu.ts` cannot cover, which today is **anything behind
the sign-in gate**: a fresh Chrome profile is not signed in, and every route including `/api/health`
answers `401`. So the reading view can be measured with the in-page probe and with `ps`, and not yet
with the good tool. See [What we still do not know](#what-we-still-do-not-know).

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
  [`noema-mythology-of-conscious-ai`](../../data/noema-mythology-of-conscious-ai) really does carry
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
  are mutually exclusive (`mode === …` in [`App.tsx`](../../src/web/App.tsx)) and the default mode is
  `toc`, which opens no band at all. A stale comment is a fine reason to believe something false.

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
([`lib/api.ts:159`](../../src/web/lib/api.ts)). A test that cannot reach the error path passes for
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

`atRow` — the reader's position — was a dependency of the diagram layout memo for all six pictures.
`arc`, `force` and `cluster` return `nowY: null` and never look at it, so for those three it was a
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
- **The reading view's idle cost has not been split into script / layout / style.** That needs
  `measure-cpu.ts` against a signed-in session, and a fresh Chrome profile is not signed in — every
  route including `/api/health` answers 401. Until then the reading-view number comes from `ps` on a
  machine with 76 renderers, and deserves the suspicion that implies.

  **The unblock is one human step, once, ever:**

  ```bash
  npx tsx scripts/measure-cpu.ts --profile ~/.spideryarn-measure --sign-in
  # sign in in the window that opens, then Ctrl-C
  npx tsx scripts/measure-cpu.ts --profile ~/.spideryarn-measure \
    --url http://localhost:5273/read/<slug> --settle 25 --seconds 60
  ```

  The session lives in that profile and survives, so every later run is unattended. Keep the
  directory outside the repo; it holds a real session.
- **Nothing here has been measured on a production build.** `npm run dev` runs `StrictMode`, which
  renders every component twice on purpose, plus `@react-refresh` and unbundled modules.
  `configurePreviewServer` in [`vite.config.ts`](../../vite.config.ts) now puts the API in front of
  `vite preview` so a built bundle *can* be measured — but `npm run build` refuses to run against
  the filesystem store, so it needs Postgres up ([supabase-local.md](supabase-local.md)).
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

- [`src/web/perf.ts`](../../src/web/perf.ts) — the in-page probe, and `useRenderCount`
- [`scripts/measure-cpu.ts`](../../scripts/measure-cpu.ts) — the clean-browser harness
- [`scripts/chrome-cpu.ts`](../../scripts/chrome-cpu.ts) — the `ps` sampler
- [`tests/idle-work.test.ts`](../../tests/idle-work.test.ts) — the regression test
- [browser-testing.md](browser-testing.md) — every other way a browser measurement lies to you
- [ingest-queue.md](ingest-queue.md) — why the browser drives a job, which is why `drive` may not pause
