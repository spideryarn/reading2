# The glossary's order button, on a touch device

**Sentry:** `SPIDERYARN-READING2-2J` · reported 2026-09-07 17:46 UTC, from
`/read/after-work-we-ll-have-each-other-spya-rqztkp?mode=glossary&cols=1&at=spya-vm49e6&sort=centrality`,
`kind=problem`, build `c0fb04a4`. From Greg, so
[feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it) says *build it*.

**Ending: shipped**, on `dev` — with a caveat that belongs in the first paragraph rather than the
last. **The incident was never reproduced**, so what shipped is the floor the control should have
had rather than a demonstrated fix.

> I couldn't seem to click the order button in the glossary on a touch device. Don't know why. The
> other sub-mode orderings seem to work okay.

The plan doc, with the seven things that were ruled out and how, the browser measurements, GPT Sol's
cross-family read, and the three questions that would settle it, is
[260908a-glossary-order-button-not-clickable-on-touch.md](../plans/260908a-glossary-order-button-not-clickable-on-touch.md).
The class is
[260908a-a-rule-written-to-the-width-of-the-complaint.md](../postmortems/260908a-a-rule-written-to-the-width-of-the-complaint.md).

## What happened, in short

The control Greg says is broken and the control he says works are the **same control written
twice** — the same markup, the same CSS declarations, the same nuqs options. Measured side by side
at five viewports with `(pointer: coarse)` in force, both responded to every tap, on a fresh page
and after scrolling, in dev and against the production bundle. Nothing overlays either. So the
report cannot be answered with "here is the difference".

What it *did* stand on is that **nothing in this app had ever said what a control owes a finger**.
The order buttons were 23px tall, their only affordance was a `:hover` wash on a device with no
hover, and the text field directly above them was 14.4px — small enough that iOS Safari zooms the
whole page in when you touch it and never zooms back out. Three hardenings, all in the class the
report belongs to, none of them demonstrated to be the fix for the incident:

- a **40px floor** for both order rows on a coarse pointer, the same number the bottom bar has had
  since Greg asked for it in August;
- **`:hover` behind `@media (hover: hover)`, with `:active` beside it**, so a finger gets feedback
  and a stuck hover cannot make an unpressed order look like the one in force;
- **every text field raised to 16px** on any device with a touchscreen — one rule for the ones the
  stylesheets style, and `tw:any-pointer-coarse:text-base` on the four the Tailwind utilities layer
  puts out of its reach.

## The one thing to know if it happens again

GPT Sol found [WebKit bug 254861](https://bugs.webkit.org/show_bug.cgi?id=254861), open against
installed iPad web apps — which Spideryarn is — where dismissing the soft keyboard leaves
`position: fixed` controls painting in the right place and hit-testing at their old ones.

**It fits, but only if its preconditions held**, and nothing here can say whether they did: it needs
the home-screen app rather than a Safari tab, and it needs the keyboard to have been up, which means
Greg having typed into *Look up a term* at some point in that session. If both held it also explains
why Quotes works, since the glossary is the only band with a field to raise a keyboard from. If
either did not, the evidence contains no mechanism that explains the asymmetry at all.

Three questions would confirm or kill it, and only Greg's iPad can answer them: does it happen on a
fresh load without ever touching *Look up a term*; does a few pixels of scroll bring the row back;
and does it happen in ordinary Safari as well as the home-screen app.

## What was deliberately not done

The band is still not keyboard-aware — that is the deferred work in `ModeSurface.tsx`, blocked on a
real iOS measurement. Nine other controls in the glossary band are still under 44px. And two
Tailwind-classed fields on the shelf are still 13px and 14px, because the utilities layer outranks
the rule. All three are named in the plan doc.
