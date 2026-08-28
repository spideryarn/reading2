# Silent success: when the natural check agrees with the bug

Not project-specific. A pattern, collected because six unrelated bugs turned up in one evening and
every one of them had the same shape. Others keep arriving in the same shape; they get added below.

> **A thing reports success while doing nothing, and the check you would naturally run returns the
> answer you were hoping for.**

Nothing errors. Nothing warns. The code reads correctly, the value comes back correct, the page looks
correct, the tests are green. The defect lives in the gap between *what you asked* and *what you
meant*, and the natural check is on the wrong side of that gap — usually because it shares an
assumption with the code. That is why it agrees with it.

## The twelve

| The bug | What the natural check said | What you had to measure instead |
|---|---|---|
| `position: sticky` whose containing block is exactly its own size | `getComputedStyle` → `position: sticky`. The CSS is right | `getBoundingClientRect()` **after scrolling**; element width vs `offsetParent` width |
| `position: static` used to unpin one axis | Screenshot at the top of the page: header pinned | Rect `top` read thousands of pixels down |
| A custom property set on `<col>`, read on `<td>` | The variable is defined and the rule is right | `getComputedStyle(cell).getPropertyValue('--tint')` on the actual cell |
| A hidden browser tab | `window.scrollY` after `scrollTo()` → the number you asked for | `document.visibilityState`; a counter on the scroll listener |
| A renamed heading, and links into it | Click the link: a page loads | Whether the anchor exists in the target's headings |
| A test that matches nothing | The suite is green | Mutate the input so it *must* fail, and check it does |
| A `//` comment in `biome.json` (comments need `.jsonc`) | `npm run lint` runs and reports findings, exit code as expected | Whether a rule you switched **off** still fires — and `grep` the output for `unknown key` |
| A CSS framework's text scanner inventing a class name you already use | The install is correct, the build is clean, and the class is in the compiled CSS | The **diff** of the compiled output, rule by rule — and whether anything in your own source already answers to that name |
| Unlayered CSS silently outranking layered utilities | The class is in the DOM, the rule is in the stylesheet, and both are valid | `getComputedStyle` on the element for the property in dispute — or which `@layer` each rule actually landed in |
| A rule whose condition depends on the *viewer's* machine, not yours | The page looks right — on your machine, with your OS settings | Force the condition off (or read the compiled rule) and check the styling still arrives |
| A focus ring that fails contrast, drawn over the browser's own | The ring is there, it is the colour it was asked to be, the class is on the element, and the page looks right | The **contrast ratio** of the composited ring against its background — and whether the component suppressed the native indicator in order to draw it |
| The browser quietly correcting a scroll position you set yourself | The maths is right, the CSS is right, and reading `scrollTop` back gives a plausible number — the browser's *adjusted* one | Where the element actually is on screen, measured after a **content change above it**, not the number you wrote |

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
| Check the class is in the compiled CSS | that a class exists because something asked for it |
| Add the class and look at the page | that a valid rule is a rule that applies |
| Look at the focus ring | that drawing an indicator is the same as indicating |

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
- **A scanner that invents a class you already use.** Tailwind v4's source scanner is a plain **text**
  scanner: it pulls bare words out of your files and emits a utility for any that happens to match a
  utility name, whether or not the word was ever a class. Installed against an eight-thousand-line
  codebase that had never met Tailwind, it generated eighteen — and one of them, `.outline`, was
  already in use as a *mode* class on a `<table>`. The result was a 1px border round the whole table,
  in a view you have to opt into, that reads as a deliberate design choice.

  Everything about this reports success. The install is right, the build is clean, the CSS is valid,
  the class is genuinely in the output. The gap is between *"the framework generated what I asked
  for"* and *"the framework generated only what I asked for"*, and no natural check straddles it: you
  did not write `.outline`, so you have no reason to go looking for it. The measure is the **diff** of
  the compiled output — read what appeared, not whether what you wanted appeared. The fix here was a
  namespace (`prefix(tw)`), which makes the collision impossible by construction rather than by
  vigilance.

  It has a nastier second half. The scanner reads whatever you point it at, and by default that is the
  project root — including your documentation. Class names quoted as **examples in a plan document**
  compiled into the production bundle: seven live utilities that no component had asked for. While
  that was happening, *"the class is in the compiled CSS"* stopped being evidence that anything
  worked, which is the same shape as a test that cannot fail. Prose can become shipped code, and a
  verification step can be poisoned by the very document describing it.
- **Unlayered CSS outranking layered utilities.** In the cascade, an unlayered normal declaration
  beats a layered one — whatever the layer order, whatever the source order, whatever the specificity.
  Everything a modern CSS framework emits sits inside a layer; a hand-written stylesheet imported
  plainly does not. So the old stylesheet wins every contest, permanently, and the framework you just
  installed does nothing wherever the two overlap.

  This is the purest form of the pattern. The class is in the DOM, the rule is in the stylesheet, both
  are valid, the network tab shows the CSS served, and the page simply does not move. There is no
  error to search for and no state to inspect — the failure *is* the absence of a change. Worse, it is
  selective: utilities on untouched elements work fine, so a five-minute smoke test comes back green
  and you conclude the install is good. And in the case that produced this entry it was near-total by
  bad luck rather than by degree: the old stylesheet styled its buttons by descendant selector
  (`.controls button`, `.cmt-nav button`), which is exactly where the new components were going.

  It has a sibling that bites from the other direction: **a layer you use but never name is
  appended after every layer you did name.** Declare `@layer theme, base, app, utilities`, then
  write a rule into `@layer components`, and that rule outranks all four — including the utilities
  it was meant to sit beneath. Two lines of component reset, written to put back a fraction of a
  framework reset, silently beat both the hand-written stylesheet and the framework. The tell is
  the same in both directions: a declaration that is present, valid and simply not winning. Layer
  order is not source order, and it is not specificity; it is the order of the statement, plus
  everything unnamed on the end.

  Two ways to measure it. `getComputedStyle(el)` for the property in dispute, which is an outcome and
  not a declaration. Or read the compiled CSS and check which `@layer` each rule landed in — a
  suspiciously **empty** layer beside rules sitting outside every layer is the whole diagnosis.

  Note that this and the previous entry pull in opposite directions, which is why neither fix
  substitutes for the other. Layering makes your utilities win *more*, so it makes an accidental class
  collision worse. Namespacing stops the framework inventing names, and does nothing about your own
  rules beating the ones you meant.

## The habit

> When something looks right, ask what you would have to measure for it to look **wrong** — then
> measure that.

Four corollaries, each of which caught something here:

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

**And the control itself can be a no-op.** Breaking the thing on purpose is usually a scripted edit,
and a scripted edit that matches nothing changes nothing and says nothing —
`str.replace` on an absent needle returns the string unchanged and raises no error, and `sed` is no
better. So the control runs, the test passes, and the green is reported as evidence.

> A no-op in ordinary work leaves a missing change somebody may notice. A no-op in a red-first
> control leaves a **green test you are about to cite as evidence**.

It is worse than it sounds, because the line a control edits is by definition the line you have just
been changing — the least stable text in the file, and the thing a peer may have edited under you
minutes ago. Two defences, both cheap: **insert a fresh line at a stable anchor** rather than editing
an existing one, and **assert the anchor occurs exactly once** before substituting. And treat an
unexpectedly green control as broken until you have seen it red once — spideryarn, 2026-08-28, where
four controls passed at once and the tell was that four controls passing at once is not a thing that
happens.

**The same guard belongs on the mutation, and on the ordinary edit beside it.** Within the hour, on
the same afternoon, a scripted edit block died on a syntax error partway through — so a test went on
asserting a field the rename had already moved, passed trivially, and was about to be cited as
evidence. So: make a red-first that did not actually mutate report **"NO-OP"** rather than a green
run, and check the anchor on every scripted replacement, not only the ones inside controls. A partial
edit is the same failure wearing different clothes — some of it applied, so nothing looks skipped.

## Spotting the family

You are probably in it when:

- The check you ran and the code you are checking would fail *together*. Reading CSS to verify CSS;
  reasoning about a regex to verify a regex.
- Success is the **absence** of something — no error, no mismatch, no findings. Absence is what a
  broken detector and a clean system both produce.
- The evidence is a screenshot, or any single sample of a continuous space.
- The thing declares an intent (`position: sticky`, a link, a subscription) rather than reporting an
  outcome. Declarations report what you asked for, not what happened.
- **The outcome depends on something about the *viewer* that you cannot see from here.** A near miss
  from the same session: a component library's `dark:` classes compile to
  `@media (prefers-color-scheme: dark)`, on a page that is dark unconditionally with no media query.
  Every such rule would have applied or not according to the **OS setting of whoever opened the
  page** — flawless on the author's dark-mode machine, subtly wrong on a light-mode one, and outside
  the reach of any test, since a headless DOM has no OS to ask. Whenever the answer varies by
  environment, the environment you happen to be in is a sample of one.

Collected in spideryarn, 2026-08-25. Applied there in
[browser-testing.md](../project/browser-testing.md) and
[testing.md](../project/testing.md#sweep-a-continuous-input-dont-sample-it).
