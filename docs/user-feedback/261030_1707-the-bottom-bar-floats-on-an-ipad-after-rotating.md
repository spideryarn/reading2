---
reports: spya-u0vb0a
ending: awaiting
comment: Not reproducible off a real iPad, and three different iPad Safari states give this symptom. Built a recorder you can show mid-bug without reloading; question q-th6h9q asks for one trace and a screenshot next time it happens.
---

# The bottom bar floats partway up an iPad after rotating and resizing

A bug report from Greg (admin; `feedback-reporter.ts` exited 0 on the report's production row),
2026-10-30 17:07 UTC, build `8352c47a`, on `nagel-bat` with Search open, Structure expanded and
Marginalia on. No screenshot, no diagnostics.

`spya-u0vb0a` ([SPIDERYARN-READING2-QB](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-QB)):

> On an iPad, sometimes after sort of, you know, a bit of rotating and resizing, the bottom bar kind
> of gets detached from the very bottom of the screen, and so it seems to, I think it still hides,
> but then when it reappears, it reappears partway up the screen.

## What we did

**The same symptom was reported on 2026-10-08**
([note](261008_0717-ios-layout-and-zoom-after-a-rotation-or-the-keyboard.md)). One cause was
fixed then, and that fix is in the build Greg was on, so this is a different cause.

**It does not reproduce here.** The report's own page state, in Playwright's WebKit with iPad
emulation, went through seven rotations and window sizes. Every frame was sampled, and the page was
never wider than the screen and the bar never left the bottom. GPT Sol read WebKit's source and bug
tracker. Three iPad Safari states give this symptom: the page zoomed out, the visual viewport left
panned or with a stale height after the soft keyboard (WebKit bug 218983 is almost this exact
sequence, and Search focuses its field on opening), or a stale layout viewport for fixed elements.
Each needs a different fix.

**No blind fix.** "Move the bar down to the visible bottom" would push it under Safari's floating
toolbar on iOS 26 iPhones, where WebKit keeps a `bottom: 0` bar above that toolbar on purpose. It
also cannot help if the fault is in painting only.

**What was built instead: a recorder that can catch it.** The viewport probe could be turned on only
with `?probe=1`, which reloads the page and very probably clears the bug. That is why the trace
asked for on 2026-10-08 never came
([postmortem](../postmortems/261030b-an-instrument-switched-on-by-reloading-cannot-catch-a-fault-that-reloading-clears.md)).
Now, on the administrator's reading view only, it records silently from page load. The command
bar's *Viewport probe* row shows what it recorded without a reload. Each sample also records where
`bottom: 0` really lands, the layout viewport's height, the visual viewport's page offset, the
dock's transform, a hit test on the dock, and settled readings 300ms and 1000ms after a rotation.
Ordinary readers without the explicit `?probe=1` diagnostic get none of it.

**Awaiting Greg:** [q-th6h9q](questions/q-th6h9q.md) asks for one trace and a screenshot the next
time it happens, after the deploy that carries this. It is also the device evidence the keyboard
half deferred on 2026-10-08 (`qi-hzramwrk`) was waiting for. The plan
([261030e](../plans/261030e-the-bottom-bar-floats-on-an-ipad-after-a-rotation-and-the-probe-that-can-catch-it.md))
has the measurements, both GPT Sol reviews, the fix that was passed over, and a table for reading
the trace when it arrives.
