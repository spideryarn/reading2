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

## Fourteen more, from the checks rather than the code

The twelve above are mostly the *product* lying to you. These are the *checking apparatus* doing it
— gates, corpora, guards, reports — which is worse, because that is the thing you were going to
believe.

| The bug | What the natural check said | What you had to measure instead |
|---|---|---|
| A guard whose failure mode is silence | Nothing printed, so nothing is wrong | A backstop computed a different way, that fires on the change having happened rather than on the rule recognising it |
| A static gate that checks syntax, not execution | The right calls, present, in the right order | The shape outright — polarity, whether the exit is unconditional, whether the call is an awaited *statement*, whether the branch is reachable |
| An override spent on a different failure | The forced run went through; the thing you diagnosed is shipped | What the gate actually reported on the forcing run, diffed against the failure set you diagnosed — HEAD moved in between |
| A round-trip test over a corpus missing the field | Every exported file matches `data/` | Which fields of the payload the corpus actually contains — coverage is a property of the fixtures, and nothing reports which fields were exercised |
| An eval arm the corpus cannot exercise | "0 regressions across 14 pages" | The fixture that would fail *without* the change; if you cannot name it, the arm never ran |
| A count of rewrites, read as a count of landings | 36/36 retargeted | Where each link actually landed — half were on a bare digit |
| A summary filter | `grep -E '^✓|^✗'` — all green | The indented lines under each heading, which is where the file names are |
| A markup check after new markup arrives | The needle stopped matching, so the bug is fixed | Text taken from between `>` and `<`, with attributes and inlined `<script>` stripped first |
| A negative assertion with too long a needle | `not.toContain("data-chat")` passed for months | The shortest token that would still be wrong — `class="chat"` survived the whole time |
| One instance of a thing | The page renders one line, as designed | Two instances — with one of anything, "one line per page" and "one line per row" are the same output |
| An empty list | `items.length === 0` → "Nothing yet" | Which of the three states it is: none, not asked yet, or asked and failed |
| A claim that a reader can reach the bug | The code demonstrably handles the state | The mount, and what keys it — handling a state and reaching it are two questions |
| A signal that grows | The count climbed 3 → 58 → 87 over six hours, so something is still doing it | The newest thing the artefact contains — a stale snapshot and an active corruption both grow, and only content separates them |
| An assertion that reddens above the line you care about | The test fails when the bug is introduced, so it covers it | *Which* assertion fired — a mutation can redden a test without ever reaching the one it is named for |

Three rules generalise out of those, and they are the ones worth carrying:

**Ask what your check prints when it is defeated.** If the answer is "nothing", it cannot be trusted
alone. Three bugs in a row on one eval had this shape: each fix stayed inside the mechanism that was
already blind, so the third proved the *design* wrong rather than the code. The backstop that finally
worked does not consult the rule at all.

**Enumerate both failure directions from the comparison, not from the comments.** Six comments in one
repo called `import.meta.url.endsWith(basename(argv[1]))` wrong and every one described the false
positive — a same-named file in another directory. None mentioned the false negatives (a path with a
space, its `%20` form, a symlinked entry), where the CLI starts, does nothing, exits 0 and prints
nothing. That was three of the seven real failing cases. The noisy direction is the one somebody got
bitten by and wrote up; the quiet one produces no bug report, so nobody has the experience that would
prompt the sentence.

**Never write a "should I emit this?" condition as a second list beside the data.** Derive it —
`Object.keys(payload).some(…)` — so a field added tomorrow is covered without a second edit. A
hand-copied list of four keys is how `db:export`, the rollback tool, silently stopped writing
`shelf.json` for any article whose only shelf state was the reader's purpose.

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
and a scripted edit that matches nothing changes nothing and says nothing — `str.replace` on an
absent needle returns the string unchanged and raises no error, and `sed` is no better. So the
control runs, the test passes, and the green is reported as evidence.

> A no-op in ordinary work leaves a missing change somebody may notice. A no-op in a red-first
> control leaves a **green test you are about to cite as evidence**.

**Four ways a control lies, and they are indistinguishable from outside.** It matched nothing. It
applied half and the rest died. It landed in a comment rather than in the code. Or it went red — for
a syntax error rather than for the thing under test, which is the same class of useless as green for
the wrong reason.

Four defences, each cheap, and none of them optional once you have seen the others:

- **Insert a fresh line at a stable anchor** rather than editing an existing one. The line a control
  breaks is by definition the line you have just been changing: the least stable text in the file,
  and the one a peer may have edited under you minutes ago.
- **Assert the anchor occurs exactly once** — *exactly*, not at least — and pick one that identifies
  **the line that runs**. `>= 1` on a string living in both a docstring and the code renames the
  comment and passes.
- **Make a mutation that did not apply say so**, in the words `NO-OP` rather than by going green. The
  guard belongs on every scripted replacement, not only the ones inside controls.
- **Read the failure message and check it names what you meant to break.** Nothing else separates a
  real red from a syntax error, and it costs one line of output.

And treat a control that passes as broken until you have seen **the specific failure string it
should have produced** — not merely a red run. *"It passed"* and *"it never ran"* are the same
observation, and only the message tells you which you are looking at.

**And the control can be right while the test is too narrow to see it.** This is the other half, and
it is not about the edit at all: the mutation applied, the code really is broken, and the test stays
green because it **reached a narrower slice of the system than the sentence describing it claimed**.
Four instances in one afternoon, one shape: a network trace that never hovered could not see a hook
fetching on `pointerover`; an equality check comparing two page loads could not see a divergence that
needs a pointer; a fixture with correlated flags could not see a mode wired to the wrong one; a unit
test handed its props by hand could not see the wiring that should have supplied them.

So when a control passes, ask **what the test actually exercises** before asking what the code does.
The gap is usually between the test's scope and the claim in its own name — and the name is what
everybody reads. All of the above
was collected in spideryarn on one afternoon, 2026-08-28; the tell for the first was four controls
passing at once, which is not a thing that happens.

## Spotting the family

You are probably in it when:

- The check you ran and the code you are checking would fail *together*. Reading CSS to verify CSS;
  reasoning about a regex to verify a regex.
- Success is the **absence** of something — no error, no mismatch, no findings. Absence is what a
  broken detector and a clean system both produce.
- The evidence is a screenshot, or any single sample of a continuous space.
- The thing declares an intent (`position: sticky`, a link, a subscription) rather than reporting an
  outcome. Declarations report what you asked for, not what happened.
- **You agree with what you are being told.** Four claims went unchecked in one afternoon here and
  the pattern was not that they were obscure — it was that **nobody doubted them**. The worst was an
  agent reporting that a feature had not shipped, about a commit it had made itself twenty minutes
  earlier, *while agreeing with the instruction to drop it*: it read the instruction, agreed with the
  reasoning, and reported compliance with a decision its own work had already overtaken. Its own
  account is the line to remember — **"the agreeing is what stopped the checking"**. Doubt does not
  trigger verification reliably enough to be the trigger; the repo has to be. A useful phrasing when
  you think somebody is wrong, because it survives you being the mistaken one: *check it yourself
  rather than taking my word.*
- **The outcome depends on something about the *viewer* that you cannot see from here.** A near miss
  from the same session: a component library's `dark:` classes compile to
  `@media (prefers-color-scheme: dark)`, on a page that is dark unconditionally with no media query.
  Every such rule would have applied or not according to the **OS setting of whoever opened the
  page** — flawless on the author's dark-mode machine, subtly wrong on a light-mode one, and outside
  the reach of any test, since a headless DOM has no OS to ask. Whenever the answer varies by
  environment, the environment you happen to be in is a sample of one.

- **The check that decides "this is broken" is shallower than the decision it protects.** Then
  broken cannot be told from ordinary, and it arrives wearing ordinary's clothes. Three of these in
  one day, in three different files, and each was invisible because the wrong branch is a branch that
  runs every day:
  - a baseline classifier asked only whether `entries` was an array, while staleness was judged on
    `sourceHash` — so an artefact with **no** hash passed as usable, failed the ordinary staleness
    comparison, and was treated as *the text has changed*. Every id re-minted, reported as success.
    **Unusable arriving disguised as stale.**
  - a fingerprint ignored a field that the policy above it was stated on, so an article whose
    classification had changed hashed identical and reported itself current.
  - a file reader returned `null` for *absent*, for *corrupt* and for *over the size ceiling* alike,
    while the caller's question was "has this article ever been through a run before" — so a
    half-written file answered *no*, and a whole identity set was minted over the top of it.

  The rule that covers all three: **whatever field the decision reads, the usability check must read
  too.** And the tell is that the two answers are *different kinds of thing* — "the shape is fine" is
  not an answer to "can I believe this".

  Its test-side twin is worth the same paragraph, because it is what let all three survive: **a test
  derived from the implementation only proves the implementation is itself.** The wrong-shape cases
  for the first one asserted exactly what the production validator asserted — that the field was an
  array — so they stayed green straight through the data-loss path. Derive the cases from the
  *decision* instead: enumerate what the code needs in order to tell its states apart, and write one
  for each way that input can be missing or wrong. A sibling failure from the same day: a fixture
  that planted its test data two blocks past the context window, so the test passed with the guard
  removed. One repeats the code's assumption, the other cannot reach the code at all, and both look
  like coverage.

Collected in spideryarn, 2026-08-25. Applied there in
[browser-testing.md](../project/browser-testing.md) and
[testing.md](../project/testing.md#sweep-a-continuous-input-dont-sample-it).
