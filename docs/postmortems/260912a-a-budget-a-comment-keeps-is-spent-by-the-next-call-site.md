# A budget a comment keeps is spent by the next call site

Since 2026-08-29, every signed-in owner's reading view has asked `GET /api/jobs` every eight
seconds for as long as the article was open and on screen, with nothing running. That is about 450
requests an hour per tab, each one a serverless invocation and a database query, and a request the
device's radio has to answer, all to learn that nothing changed. It reached real readers in production. Signed-out visitors were
not affected, because the engine never starts for them. It came to light while chasing
SPIDERYARN-READING2-36:

> It is still draining the battery on my iPad really fast for  some reason
>
> — Greg, 2026-09-12, Sentry SPIDERYARN-READING2-36

**Whether this is the whole of that drain is unproven.** Everything was measured in headless
Chromium, some of it under iPad emulation. WebKit will not launch on the box, and an iPad's battery
cannot be measured from here. So the poll is a certain cost and a plausible share of the drain, and
scrolling's unattributed paint and compositing bucket is the next suspect. The measurements, and the
one-minute check on the device that would settle it, are in
[260912a](../plans/260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md).

## What happened

[`jobEngine.ts`](../../src/web/jobEngine.ts) `schedule` keeps the eight-second idle cadence while
`subscribers.size > 0`. `OwnedReader` in [`ArticlePage.tsx`](../../src/web/article/ArticlePage.tsx)
calls `useArc(slug, article.arc)` for every owner. `useArc` calls `useStepJob`, which calls `useJobs`,
so a subscriber is always mounted. On the production build the count is 8 `/api/jobs` a minute at
rest, on desktop and under iPad emulation alike.

**Introduced by `f42a8771`** (2026-08-29, *"Adding an article stops waiting for the arc, and a visitor
pays for it"*), which is the commit that added `useStepJob` to `useArc` (`git log -S useStepJob --
src/web/useArc.ts`). The engine did not exist yet, and each mounted `useJobs` ran its own poll every
eight seconds for ever. At that commit, `useJobs.ts` said *"the reading view mounts none"*. In
`OwnedReader`, eleven lines above the new `useArc` call, `App.tsx` explained that glossary was split
into a read half precisely because *"`useJobs` polls for ever, and a reader who never opens the band
should not pay for it"*. The arc needed its job on arrival, and Greg asked for that. The commit
message costs out what visitors lose. It does not mention the poll.

**The engine's claim came afterwards, and it was false the day it was written.** *"An owner reading
an article with nothing running costs one poll at session start and then silence"* first appears in
`2a0ae3d9` (2026-09-01). The only earlier `git log -S 'then silence'` hit, `12081b0d`, is an
unrelated sentence in a plan. So it is not that one change made the other one wrong. The behaviour
shipped first, and the claim was written three days later over the top of it. That same commit's
message says *"useArc runs on every owned reading view and goes through useStepJob"*, and so does
the test comment it added. `a2e55ead`, forty minutes later, put the same sentence into the engine's
own header, a few paragraphs above "then silence". The author knew about the subscriber. They
followed what it meant for **driving** (the import keeps moving), which was the question under
review, and never followed what it meant for the **cadence**.

## The class: a cost gated on "is anyone subscribed", paid by a subscriber that only wanted the data

The engine charges a recurring cost to anyone who subscribes, but subscribing is also the only way to
read job state. So every caller that wants to know "is my job running?" also buys "poll every eight
seconds for as long as I am mounted", whether it wanted that or not. The budget ("the reading view at
rest costs nothing") was kept by **comments at the call sites that remembered**: glossary in
2026-08-28, quiz and summaries in the same shape, quotes in 2026-09-08. Nothing kept it at the next
call site. The arc was the next one, and it landed a few lines below the comment that states the
rule. This is the shape [260908f](260908f-a-correct-comment-contradicted-by-the-line-beneath-it.md)
names: the rule is written down, and the line beneath it breaks it.

The general form: **when a side effect is priced into the act of reading, every new reader pays it
by default, and a rule that says "don't read from here" only binds the authors who read the rule.**

The sibling search came back clean at rest. Of the fifteen `useJobs`/`useStepJob` call sites at
HEAD, the arc is the only one mounted unconditionally at the top of the reading view.
`ProseHoverCard`'s `WithAddToShelf` holds the cadence only while a card is open, and the rest are
mode bands, the shelf, the add page and the metadata page, where somebody is looking at a queue.

## Why nothing went red

- **The test cited as pinning the claim builds a state the page never reaches.**
  `job-engine-drives-with-no-view.test.ts`, *"sleeps rather than polling for ever when nothing is
  running and nobody is watching"*, starts an engine with **no subscriber** and asserts one poll in
  two minutes. Its comment says this is *"the rule that keeps it from becoming an unbounded idle
  poll on every reading view"*. But every owned reading view has a watcher. The test is correct
  about the engine and silent about the page. It answers a weaker question than the one it was
  quoted for ([silent-success.md](../reusable/silent-success.md)).
- **The whole-App test knew and deferred.** `public-network-trace.test.tsx`, *"asks for its own
  queue on the default view, with no band open"*, says in its own comment that `useArc` polls there.
  It asserts `/api/jobs` count `> 0`, and hands the cadence to the test above because this file has
  no fake timers. Two tests each assumed the other one covered the owner at rest.
- **`idle-work.test.ts` treats subscribed polling as correct.** Its positive control *is* "polls
  while visible with a subscriber mounted". It pins the visibility contract, which held: the poll
  stops when the tab is hidden. But that is also why the cost is paid only while the article is on
  screen, which is exactly when a reader is using it.
- **The measurements looked at CPU.** At rest the page used 0.5–3% of a core, which reads as fine.
  The in-page probe was counting fetches, but `measure-cpu.ts` did not print them until today.

## What would have caught it, ranked by ease against value

1. **A whole-App owner test: signed in, nothing running, and after the session's first
   `/api/jobs`, a fake minute with no more.** Its positive control is the same view with a band
   open. That is the configuration the claim is about, and it would have failed on 2026-08-29. It
   catches the next top-level subscriber whichever feature brings it. **Done**, over Plain and
   Summary: `an owner's reading view, left alone` in `tests/public-network-trace.test.tsx`.
2. **Print the at-rest request count wherever CPU is printed.** `measure-cpu.ts` now prints a
   `fetches:` line. The thing nobody saw for two weeks was a request every eight seconds, not a CPU
   number. Done.
3. **A claim about a page's cost is pinned against that page, not against the component that
   charges it.** A habit, and it is aimed at the class: if the sentence says "an owner reading an
   article", the test mounts an owner reading an article. It belongs next to the engine's rule in
   its header, which the plan rewrites.
4. **Make the idle cadence something a caller asks for, not something it gets by default.** This is
   the long-term fix below. It costs touching every call site, and it closes the class at the source.
5. **Slow the idle poll to sixty seconds.** Rejected. It is still an unbounded loop on a page that
   has asked for nothing (`schedule`'s own docstring: the clock *"stops rather than slowing"*), and
   it would slow every mode band's cross-tab progress, which is what the cadence is for.
6. **A lint rule against job hooks in `OwnedReader`.** Rejected. It is aimed at the instance: rename
   the component or mount the hook one level up and it passes. Item 1 is aimed at the behaviour.

## The fix that is right for the long term

**The fix, stage 1 of the plan**, adds a quiet subscription, `jobEngine.subscribeQuietly`, exposed as
`useJobs(onFinished, { idle: false })`. It gets the same snapshot and notifications, but it does not
count towards `subscribers.size`. `useArc` uses it, and busy polling still carries the arc's own job
to done. Together with item 1 that closes this instance, and item 1 catches the next one. On a
production build at rest, Summary and Plain went from 8 `/api/jobs` a minute to none; a Glossary band
left open still polls at eight seconds, as it should.

It needed one thing the plan did not have, found by GPT Sol reviewing it: **once the idle cadence can
be declined, an action's poke is the only thing that finds the job it made**, and if that one poll
failed nothing would arm another. So an action now leaves a versioned obligation that only a
*successful* poll discharges. Worth knowing for the next change here: taking away a courtesy poll
also takes away whatever it was silently retrying.

It leaves the default where it was: a new `useJobs()` still buys the cadence unless its author knows
to decline it. The right long-term shape is the inverse. A subscription is quiet by default, and the
surfaces that *display* a queue (the shelf, the add page, a mode band) ask for the idle cadence by
name. The cost is then bought by the one caller that wants it, not by every caller that forgot to
refuse it. That is worth doing when a third quiet caller appears. Until then, the owner-at-rest test
is what holds the line.

## The thing I would tell myself

On 2026-09-01 I had just found out, the hard way, that `useArc` subscribes on every owned reading
view. I wrote that into the commit message, the test comment and the engine header, because it
overturned the diagnosis. Then, a few paragraphs further down the same header, I wrote that an owner
at rest pays one poll and then silence, and cited a test with nobody subscribed. The fact I had just
learned was about driving, so I checked it against driving. I never asked the other question the
same subscriber raises. When a correction arrives, follow it through every sentence it touches, not
only the one it came in on.

---

Up: [Postmortems](../project/postmortems.md)
