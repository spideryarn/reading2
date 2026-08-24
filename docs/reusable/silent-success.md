# Silent success: when the natural check agrees with the bug

Not project-specific. A pattern, collected because six unrelated bugs turned up in one evening and
every one of them had the same shape.

> **A thing reports success while doing nothing, and the check you would naturally run returns the
> answer you were hoping for.**

Nothing errors. Nothing warns. The code reads correctly, the value comes back correct, the page looks
correct, the tests are green. The defect lives in the gap between *what you asked* and *what you
meant*, and the natural check is on the wrong side of that gap — usually because it shares an
assumption with the code. That is why it agrees with it.

## The six

| The bug | What the natural check said | What you had to measure instead |
|---|---|---|
| `position: sticky` whose containing block is exactly its own size | `getComputedStyle` → `position: sticky`. The CSS is right | `getBoundingClientRect()` **after scrolling**; element width vs `offsetParent` width |
| `position: static` used to unpin one axis | Screenshot at the top of the page: header pinned | Rect `top` read thousands of pixels down |
| A custom property set on `<col>`, read on `<td>` | The variable is defined and the rule is right | `getComputedStyle(cell).getPropertyValue('--tint')` on the actual cell |
| A hidden browser tab | `window.scrollY` after `scrollTo()` → the number you asked for | `document.visibilityState`; a counter on the scroll listener |
| A renamed heading, and links into it | Click the link: a page loads | Whether the anchor exists in the target's headings |
| A test that matches nothing | The suite is green | Mutate the input so it *must* fail, and check it does |

## Why the natural check agrees with the bug

Not coincidence, and not carelessness. **The natural check shares an assumption with the code, which
is why it agrees with it.** In each case above, you and the thing you are checking believe the same
false premise:

| Check | The assumption you and the code both make |
|---|---|
| Read the CSS to confirm it's sticky | that a declaration implies a range |
| Read `--tint` off the `<col>` | that custom properties reach cells |
| Read `scrollY` to confirm the scroll happened | that a position implies an event |
| Click the link | that arriving *somewhere* means arriving **there** |
| Run the test | that no failures means nothing broken |
| Reason about the regex | that you meant what you wrote |

That is what makes "be careful" useless as advice here. Care applied through the same assumption
produces the same wrong answer, more confidently.

## The remedy, statable

> **Measure the effect, not the cause — and pick a check that cannot share the assumption.**

Read the rect after scrolling, not the declaration. Read the computed value on the element that
*consumes* it, not the one that sets it. Break it on purpose and require the alarm. Each of those
substitutes an observable outcome for a restatement of intent.

It also explains why two apparently different techniques below — sweeping a continuous input, and
mutating a test's subject — are the same move: both assert on the observable outcome, across inputs
the author did not hand-pick.

**The fixes are cheap; the interval is not.** Five of these six took minutes to fix once somebody
measured. What they cost was the stretch of time in which everything looked fine — work built on top,
conclusions drawn, and in two cases a second person reproducing the same reasoning and reaching the
same wrong conclusion. Optimise for shortening that interval, not for the fix.

- **Sticky range.** A sticky element is confined to its containing block, so its range is
  `containing block − element`. At zero range it is sticky and never moves. `position` still reports
  `sticky`, because it *is* sticky. Full write-up:
  [css-sticky-containing-block.md](css-sticky-containing-block.md).
- **Two axes, one `position`.** `top`/`left` are independent anchors sharing one `position`, so
  cancelling the position to stop something sticking sideways stops it sticking downwards too. It is
  invisible at the top of the page — where screenshots are taken — because an element you have not
  scrolled past looks identical pinned or not.
  [Details](css-sticky-containing-block.md#a-second-silent-failure-cancelling-position-cancels-both-axes).
- **A property resolved on the wrong element.** Custom properties inherit down the DOM tree. A
  `<col>` is not an ancestor of a cell — only width, background, border and visibility cross from
  column to cell, by a special table mechanism that is not inheritance. So the variable resolves
  perfectly, on an element nothing reads it from.
- **A hidden tab.** Browsers suspend the rendering step for a tab that is not visible, and scroll
  events and `requestAnimationFrame` are both dispatched from it. `scrollTo()` moves `scrollY` and
  fires no event at all. A screenshot does not wake it: you get a correct-looking picture of a page
  whose event loop is asleep.
  [Details](../project/browser-testing.md#a-background-tab-will-lie-to-you-about-scrolling).
- **A stale anchor.** `#old-heading` resolves silently to the top of the document. You land somewhere
  plausible and never learn it stopped taking you where it said.
- **A vacuous test.** A collector that matches nothing passes every assertion about its contents,
  forever. Assert that it found something, and prove it fails by breaking the thing it watches.

## The habit

> When something looks right, ask what you would have to measure for it to look **wrong** — then
> measure that.

Three corollaries, each of which caught something here:

**Sweep a continuous input; don't sample it.** Where the input is a width, an offset, a count, assert
the *shape* of the output over the range rather than its value at points you thought to name. A
column-fitting function was checked by hand at five widths and looked right at all five; it was wrong
between them, and widening the window removed two columns. Non-monotonicity is invisible to sampling
by construction — every sampled point is individually plausible, and the defect lives only in the
relationship between them.

**Reasoning about it is not checking it.** A regex reviewed by eye looked correct and matched the
wrong thing; the mutation run found it in seconds. Reasoning is the natural check par excellence,
because it re-runs the same assumption that produced the code.

**Test the test.** Break the thing on purpose and confirm you get a red. A test whose only evidence
is that it passes is indistinguishable from one that inspects nothing — which is exactly how a
link checker came to go green on all three bugs it was written in response to.

## Spotting the family

You are probably in it when:

- The check you ran and the code you are checking would fail *together*. Reading CSS to verify CSS;
  reasoning about a regex to verify a regex.
- Success is the **absence** of something — no error, no mismatch, no findings. Absence is what a
  broken detector and a clean system both produce.
- The evidence is a screenshot, or any single sample of a continuous space.
- The thing declares an intent (`position: sticky`, a link, a subscription) rather than reporting an
  outcome. Declarations report what you asked for, not what happened.

Collected in spideryarn, 2026-08-25. Applied there in
[browser-testing.md](../project/browser-testing.md) and
[testing.md](../project/testing.md#sweep-a-continuous-input-dont-sample-it).
