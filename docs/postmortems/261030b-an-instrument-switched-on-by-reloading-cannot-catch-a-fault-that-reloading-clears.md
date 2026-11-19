# An instrument switched on by reloading cannot catch a fault that reloading clears

On 2026-10-30 Greg reported from an iPad that the bottom bar, after *"a bit of rotating and
resizing"*, *"gets detached from the very bottom of the screen … when it reappears, it reappears
partway up the screen"* (`spya-u0vb0a`,
[SPIDERYARN-READING2-QB](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-QB)). **It was the
second time.** He reported the same symptom on 2026-10-08 (`spya-gxbwug`). One cause was fixed
then, and the rest was deferred until a trace from the device could say which iOS state it was.
In the three weeks between, no trace arrived, and **none could have**: the only instrument that
takes one starts when the page loads, and loading the page is very probably what clears the fault.
The fix is
[261030e](../plans/261030e-the-bottom-bar-floats-on-an-ipad-after-a-rotation-and-the-probe-that-can-catch-it.md).

**This postmortem is about why the bug is still undiagnosed, not about the bug.** What puts the bar
partway up is still not known. It is one of three iOS states (a page zoomed out, a visual viewport
left panned or with a stale height after the keyboard, or a stale layout viewport for fixed
elements), and the plan's § Diagnosis has GPT Sol's reading of WebKit on each. None of them happens
in the WebKit this box runs. Measured on 2026-10-30, the reported state in Playwright's WebKit with
iPad emulation never left the page wider than the screen or the bar off the bottom.

## The real root cause

The 2026-10-08 work did what it should with a bug it could not reproduce. It fixed the half it
could measure (a page wider than the screen during a turn, which lets iOS zoom the page out). It
declined a blind workaround for the rest on GPT Sol's advice. And it wrote the next step down:
queue item `qi-hzramwrk`, *"if Greg still sees it after the 261008b deploy, ask for a ?probe=1 trace
(ViewportProbe.tsx)"*.

That step could not be taken, and nothing said so. `ViewportProbe` was built on 2026-09-07 for a
different question, the mode band and the soft keyboard. That fault happens on demand: tap the
composer and it is there. So the probe was designed to be switched on by the address, read **once
at mount**, and never subscribed to. That was right for its first job: a reader pays nothing, and
an installed iOS app has no address bar to change later. But a fault that comes *sometimes*, after
a sequence of rotations nobody chose, is the opposite shape. By the time you know you want the
trace, the state you need is on screen. The only way to start the instrument is to add `?probe=1`,
which reloads the page. A reload re-lays out everything and very probably resets the viewport
state. So "ask Greg for a trace" was a request for something the instrument could not record.

**Why nobody noticed:** the deferral named the instrument, and the instrument existed, was tested
and was in production. Every check on it asked whether it records correctly once it is on. None
asked whether it could be turned on at the moment the fault exists.

## The class: an instrument switched on by reloading cannot catch a fault that reloading clears

A diagnostic is only as good as its earliest start. For a fault that can be produced on demand, a
diagnostic that starts at page load is fine: load, then produce. For an **intermittent,
state-dependent** fault (one that arises from a history of events and goes away on a restart),
the instrument has to be running before the fault, or able to attach without a restart. Otherwise
the person who sees the fault is asked to destroy it in order to record it.

It is a sibling of [silent-success.md](../reusable/silent-success.md): a step that reports itself
done ("deferred until a trace") while the thing it depends on cannot happen. The queue item looked
handled, so nobody looked again until the reader reported the bug again.

Where else it could bite, so it is recognised next time:

- **Any `?flag=1` diagnostic read at mount**: `?probe=1` was the only one in `params.ts`.
- **Feedback diagnostics** are taken when the dialog opens, after the reader has decided to
  report. For geometry that is mostly fine, because the state is still on screen. But the dialog
  focuses a text field, and on an iPad that brings up a keyboard, which is itself a suspect here.
- **Server-side logging switched on by redeploying**, for a fault a redeploy clears. The same
  shape, on the other side of the wire.

## Which commit introduced it

- `2dfa5235a` (2026-09-07), *The instrument that can unblock the mode band's fit on a phone*: the
  probe and its read-once `?probe=1` (`currentProbe` in `src/web/params.ts`). Right for its
  question, as above.
- `a18b48d2d` (2026-10-08), *261008b: GPT Sol's code review fixes, and the note (spya-gxbwug ends
  shipped)*, and the queue item it added. That made a trace from this instrument the gate for the
  keyboard half, without asking whether the instrument could take one.

## The fix that is right for the long term

**Record ahead, show on demand.** On the administrator's reading view the probe now records
silently from page load, keeping the newest 200 samples in memory and drawing nothing. The command
bar's *Viewport probe* row shows the panel over that recording without a reload
(`src/web/probe-switch.ts`). The rolling buffer matters because opening the command bar focuses a
text field, and on an iPad the keyboard that brings up is one of the suspects. With the recording
already running, the moments before it are in the trace (GPT Sol, plan review P1). Ordinary readers
without the explicit `?probe=1` diagnostic are untouched: no viewport listener and nothing in the
DOM. The trace also gained the numbers that narrow the three states as far as script can: where an
untransformed `bottom: 0` lands, the root's
`clientHeight`, `visualViewport.pageTop`, the dock's transform, a hit test at the dock's middle, and
`settled` samples 300ms and 1000ms after a rotation.

**What it still cannot do**, and the plan says so: WebKit can be wrong at painting while every
number script reads is consistent, so a screenshot taken at the same moment is part of the trace,
not an extra.

## What would have caught it, ranked by ease against value

1. **A deferral that waits on evidence names how that evidence is collected while the fault is
   present, and checks that it can be.** One sentence in the queue item: *"Greg sees the bar
   floating; he then does X; X does not reload."* Writing X would have shown that X reloads.
   Cheap, and it is the check that was missing. Not made a rule here: rule docs change only with
   Greg's yes ([edit-important-docs.md](../reusable/edit-important-docs.md)). It is proposed in
   this file for the next sweep of `docs/reusable/`.
2. **Diagnostics for intermittent faults record ahead.** Done for the probe, in this change, as
   above.
3. **A test that the instrument starts without a reload.** Done:
   `tests/viewport-probe.test.tsx` § the probe started on the page as it stands. It was red with the
   switch disabled and with the silent recording disabled, and green with both.
