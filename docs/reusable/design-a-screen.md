# Designing a screen so it answers the question the reader came with

Not project-specific. Hand this to yourself — or to a subagent — before redesigning any screen, and
especially before restyling one somebody has called *hard to scan*.

It is written as a **prompt**, in two halves that must be done in order. The first half is three
questions you answer in prose before you touch a stylesheet; the second is a checklist with a source
against every rule. **Doing the second half without the first produces a tidier screen that is no
easier to use**, which is the usual outcome of a redesign and the thing this doc exists to prevent.

## Running it: what goes in, what must come out

A checklist wearing the word "prompt" is still a checklist. So this is the contract — gather all
four inputs before starting, and produce all six outputs before writing any code. If an input is
missing, get it; a design review done without screenshots is a review of your memory of the screen.

**Inputs**

1. **Purpose** — who reads this screen and what they came to do. In their words if you can get them.
2. **Screenshots at every supported width**, from real or realistic data, saved to files. Full-page
   as well as viewport for anything that scrolls.
3. **A state inventory** — every state the screen can be in, *including* the ones where it is
   reporting that it does not know. This is the input people skip, and it is the one that makes the
   difference between a redesign and a regression.
4. **Measurements and the available data** — the numbers from § Measure below, and what the screen's
   data source can and cannot actually support.

**Outputs**

1. **The decisions this screen supports**, ranked. If you cannot name one, say so — that is a
   finding, not a failure.
2. **Ranked obstacles**, each citing a screenshot or a line of code. "It feels cluttered" is not an
   obstacle; "the number answering the screen's question is 13px, below three paragraphs, in the
   fourth screenful" is.
3. **The proposed hierarchy** — what is primary, what is secondary, what is provenance.
4. **What to remove, collapse or move.** Required, not optional: a redesign that only adds has not
   made a decision.
5. **Claims the data cannot support** — named as missing rather than invented, and never filled with
   a plausible default.
6. **Checks that could fail after implementation.** See § Afterwards.

Anything you cannot answer, write down as unanswered. The gaps are the useful part of the output.

## Half one: what is this screen for?

### 1. Write down the questions the reader arrives with

> What are the main purposes, intent and questions that the user might have, and how can we make
> that more visible?

Answer it **in the reader's words, not in the system's**. "Show usage limits" is the system's
words; "can I start more work right now, or will it be rejected?" is the reader's. The difference
decides the layout: the first is a list of fields, the second is one yes/no with its evidence
underneath.

Rank them, and be honest that the list is short. **One screen supports one decision or task** —
an overview may legitimately need several subordinate questions, but they must be subordinate to
something. Grafana's own guidance is one panel, one question; the SRE book's version is that a
dashboard's top level shows what is broken and user-visible *now*, with cause and diagnosis one
level down. If your ranked list has six *equal* items, you have either two screens or a screen with
a summary and a drill-in, and finding that out now is the cheapest it will ever be.

**Ask the reader if you can.** One sentence from the person who uses it beats a day of inference,
and their answer is usually blunter and narrower than anything you would have written for them. If
you get such a sentence, quote it verbatim in the plan and treat it as the acceptance test — a
screen that does not help answer it is not finished, however tidy it looks.

### 2. Say what the reader does next

For each question: **what action does the answer lead to, and is that action on this screen?** An
answer with its action three taps away is a screen that informs rather than one that helps. This is
also the test for a caveat, an explanation, a provenance line: *would it change the reader's
immediate action, or their confidence in taking it?* If it would change neither — if it only alters
what they believe about how the system works — it belongs one tap away, attached to the fact it
qualifies. Not deleted, and not on the page.

The confidence half is not a loophole, and leaving it out makes the rule wrong: an operator who
does not trust a number will go and check it by hand, which is a worse outcome than the caveat
costing a line. What fails the test is the material that explains the *mechanism* rather than
qualifying the *reading*.

### 3. Say what the screen must never do

Before you make anything louder, write down what must stay visible when it is made quieter. Every
redesign is a redistribution of attention, and the material that loses is whatever nobody wrote
down. In particular, name the states where **the screen is reporting that it does not know**, and
say how each will still be distinguishable afterwards. See § Absence below; this is the failure this
whole doc is pointed at.

---

## Half two: the checklist

Each rule is meant to be specific enough to **fail** a design. "Use good contrast" is not a rule;
"non-text UI components and graphical objects need ≥ 3:1 (WCAG 1.4.11)" is. Where a rule is a
convention rather than evidence, it says so.

### Measure before you form an opinion

Do this first, on the screen as it stands. Every one of these is a command, not a judgement, and
they routinely name the cause outright before anybody has argued about taste.

- [ ] **Count the distinct font sizes actually rendered**, and how often each occurs. A page whose
      sizes all sit within a few pixels of each other has no dominant element and *cannot* be
      scanned, whatever else is done to it. Count the weights too. **The diagnostic is the spread,
      not the count** — fixing this usually makes the number of distinct sizes go *up*, because a
      scale is a set of deliberately separated steps and what you started with was a cluster. A
      redesign that reduced the count by flattening everything to one size would score better on the
      tally and be worse.
- [ ] **Count the distinct text colours, by frequency.** If the quietest colour is the most common
      one, nothing on the page is quiet: the reader's eye has nothing to land on, so it lands on
      whatever happens to be accented instead.
- [ ] **Full page height at the narrowest supported width**, in CSS pixels, and the count of
      interactive elements on it. Both are proxies for how much the screen is asking of somebody
      holding a phone.
- [ ] **Count the interactive elements by tabbing, not by selector**, on any page with a disclosure.
      A `querySelectorAll` of buttons and links counts everything inside a *closed* `<details>`, and
      the obvious filters do not save you: `content-visibility` clears neither `offsetParent` nor
      `getClientRects()`, so "visible" checks return the same inflated number with more confidence.
      Press Tab a few hundred times and count what actually receives focus. Measured on one page,
      **both numbers from that same page after the change**: the selector said 171, the tab cycle
      said 34.
- [ ] **Do not compare a before taken one way with an after taken the other.** The trap sits right
      next to the rule above: once you switch method for the "after", the improvement you report is
      part real and part instrument. Either re-measure the "before" the same way, or say in the same
      breath which number came from which method — otherwise the next person to re-measure finds a
      figure that does not match and cannot tell which half to distrust.
- [ ] **Does it scroll horizontally?** `scrollWidth > clientWidth` at the narrow width is a bug
      almost every time.
- [ ] **The squint test.** Blur the screenshot until you cannot read words. What is still visible is
      what the design is actually saying comes first. If that is not the answer to question 1, the
      hierarchy is wrong and no amount of copy-editing will fix it.
      ([NN/g](https://www.nngroup.com/videos/squint-test/))

### Hierarchy and scanning

- [ ] **Design for scanning, not reading** — most people scan a screen rather than read it, so the
      first word or two of each line and the top-left of each block carry most of the information
      that will actually be taken in. Front-load the highest-information word.
      ([NN/g, F-pattern](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/))
- [ ] **Two or three levels of emphasis, no more**, and build each from *two* dimensions together
      (weight + colour, or size + position) rather than from size alone. More levels and nothing is
      emphasised. ([Refactoring UI](https://gist.github.com/selcukcihan/b9418596a98abfcd4bbc622550820cc5))
- [ ] **To de-emphasise, change colour or opacity — not weight or size.** Dropping a size to make
      something secondary costs legibility and buys less separation than a colour step does.
- [ ] **Grouping is proximity and common region**, not decoration. If two facts belong together,
      put them together or box them together; a heading over a gap does less work than the gap does.
      ([NN/g, visual hierarchy](https://www.nngroup.com/videos/visual-hierarchy/))
- [ ] **The same kind of fact in the same place in every row.** In a repeated list, the eye
      re-orients per row when status is sometimes left and sometimes right, and that cost is paid
      once per row. ([NN/g](https://www.nngroup.com/videos/managing-visual-complexity/))
- [ ] **Attention decays down a repeated list**, so the ordering has to carry urgency; position
      alone will not get the eighteenth row noticed.

Folklore flag: the **Z-pattern** is repeated everywhere but has nothing like F-pattern's
eye-tracking evidence behind it for dense data screens. Do not design a dense screen around it.

### Colour, and status that survives colour-blindness

- [ ] **Colour is never the only carrier.** Every status must also have a word, and preferably a
      shape or glyph. This is a pass/fail accessibility criterion, not a preference
      ([WCAG 1.4.1](https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-without-color.html)),
      and the red/green pair that status systems reach for first is exactly the one ~8% of men
      cannot separate ([Section508](https://www.section508.gov/create/making-color-usage-accessible/)).
- [ ] **Shapes must differ in silhouette**, not only in fill — triangle for warning, circle for
      normal, and so on — so the meaning survives a greyscale screenshot.
      ([IBM Carbon, status indicator pattern](https://carbondesignsystem.com/patterns/status-indicator-pattern/))
- [ ] **One colour, one meaning, across the whole surface.** A colour that means "error" here and
      "selected" two screens away has no meaning at all.
      ([Polaris](https://polaris-react.shopify.com/design/colors))
- [ ] **Text contrast ≥ 4.5:1, large text ≥ 3:1**
      ([WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)) — **and,
      separately, ≥ 3:1 for UI component boundaries, focus rings, chart lines, gauge fills and any
      icon you have to understand** ([WCAG 1.4.11](https://www.wcag.com/designers/1-4-11-non-text-contrast/)).
      Two criteria, two scopes: a screen can pass the first and fail the second on a pale chart
      line, and the check that only measures text will not notice.
- [ ] **Check both themes.** If the page follows the device, the dark branch is a real design and
      not a tint of the light one; token pairs that look fine light routinely lose contrast dark.
- [ ] For several **categories** that must stay distinguishable (not just good/bad/warn), the
      Okabe–Ito eight-colour set is the usual colour-blind-safe answer. A scientific-figure
      convention, widely adopted — not a standard.

### Absence: zero, unknown, stale, and failed are four things

**The most valuable half of this checklist**, and the one that gets lost in a redesign, because
making the important thing loud is the same gesture as making a caveat invisible.

- [ ] **Zero is not unknown.** A measured zero and a value nobody could read must not render the
      same. Design systems that get this right give a system failure its own treatment rather than
      reusing the no-data-yet one
      ([PatternFly](https://www.patternfly.org/components/empty-state/design-guidelines/),
      [Cloudscape](https://cloudscape.design/patterns/general/empty-states/)).
- [ ] **Never draw an unknown as a calm zero.** An empty bar, a `0%`, a green tick standing in for
      "not measured" reads as good news and is believed. If a number cannot be shown to be valid,
      **do not put a number there** — a renderer handed a numeric field will eventually render it,
      so the discipline has to be in the data, not in the caveat beside it.
- [ ] **A reassuring sentence is only worth saying beside the evidence that makes it falsifiable.**
      "Nothing is wrong" and "nothing was checked" read identically; print what was actually
      examined — *opened 235 of 240, 232,961 lines* — under the reassurance, every time.
- [ ] **Every live number carries when it was taken** — but *once per group of readings taken
      together*, not once per tile. Where figures on one screen refresh at different rates, each
      rate needs its own stamp; where twelve numbers came from one pass, twelve timestamps is the
      wall of provenance this checklist exists to prevent. Applying the rule naively is itself a
      way to fail it.
      ([Smashing, 2025](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/))
- [ ] **Prefer a duration to an instant** for anything the reader is judging freshness by. *Read 6m
      ago* survives being read in another timezone; `05:51 UTC · 06:51 London · 08:51 Athens` is the
      same fact three times and ages badly on a phone. Keep the wall-clock instant for the thing a
      reader must act *at* — a deadline, a reset — and put the rest one tap away.
- [ ] **Stale must look stale.** Showing the last good reading rather than a blank is right; showing
      it at full weight with no mark is not.
- [ ] **A fetch failure gets its own banner**, distinct from stale and from empty, because it is a
      fact about the screen rather than about the thing being watched.
- [ ] **Missing points in a chart are drawn as missing** — a break, not an interpolation and not a
      drop to zero. A line that joins across a gap asserts data that does not exist.
- [ ] **Skeletons beat spinners** for a load whose shape you know. Industry convention rather than a
      controlled study.

### Type, and numbers

- [ ] **A defined scale, hand-picked. Steps that must read as *levels* want ≥ ~25% between them**;
      closer than that and two sizes stop being two levels.
      ([Refactoring UI](https://gist.github.com/selcukcihan/b9418596a98abfcd4bbc622550820cc5))
- [ ] **Separate the levels from the density variants, and do not claim one rule covers both.** A
      dense screen legitimately wants two or three sizes close together at the bottom — secondary
      text, captions, labels — which are *not* further demotions and are separated by weight, colour
      or position rather than size. Three well-separated levels plus two density variants is an
      honest scale; five sizes described as five evenly-spaced steps is a claim a reader can measure
      and disprove. Say which of your sizes are which.
- [ ] **Check the top of the scale against the root font size.** A "heading" step that equals the
      body size is not a step, and this is easy to ship: it looks fine wherever it also gets weight
      and colour, and does nothing wherever it doesn't.
- [ ] **Ad-hoc arbitrary sizes are the smell.** If the codebase is full of one-off pixel values, the
      scale does not exist yet, and adding one more will not help.
- [ ] **Two weights are usually enough**, and nothing below 400 for UI text — light weights read as
      low-contrast at small sizes, and worse on a dark ground.
- [ ] **`font-variant-numeric: tabular-nums` on anything that lines up** — percentages, durations,
      counts, timestamps. Proportional figures in a column are what makes a column of numbers hard
      to compare.
      ([Monotype](https://www.myfonts.com/pages/fontscom-learning-fontology-level-3-numbers-proportional-vs-tabular-figures))
- [ ] **A dense list may legitimately run tighter line-height** (~1.2–1.3) than body copy's
      1.4–1.6. Say so as a decision rather than inheriting prose values by accident.

### On a phone: tables, cards, and what decides it

The sources genuinely disagree, and **the task decides it, not the width**:

- **Comparing one value across many rows** — scanning a percentage down a column — wants a **table**,
  because only a table preserves the alignment that makes the comparison possible. Make it work
  narrow with a **frozen identity column** and horizontal scroll, or with **priority columns**: a
  small fixed set that is always visible, the rest behind a drill-in.
- **Reading one row as a self-contained unit** wants a **card**, because it does not need alignment
  the reader is not using.
- **Stacking a wide row into a card stops working past roughly six fields** — it trades a
  wide-scroll problem for a long-scroll problem. With many rows and many fields, a priority-column
  table beats cards on a phone, and cards will make the screen mostly scrolling.

- [ ] **Tap targets: 24×24 CSS px is the floor** ([WCAG 2.5.8](https://www.allaccessible.org/blog/wcag-258-target-size-minimum-implementation-guide)),
      **44×44 is the target** ([WCAG 2.5.5](https://accessibility.build/wcag/2-5-5); Apple HIG 44pt,
      Material 48dp). Treat 24 as legal, not usable, for anything you expect to be tapped rather
      than read.
- [ ] **The narrow width is a design, not a consequence.** Check it first if it is the one people
      actually use, and check that the wide one has not become a stretched phone.

### Progressive disclosure, and how it goes wrong

- [ ] **Overview first, zoom and filter, details on demand.** The list is the overview; per-item
      charts, logs and gauges are the detail, reached by drilling in rather than crammed into every
      row. (Shneiderman, *The Eyes Have It*, 1996 —
      [PDF](https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf))
- [ ] **Anything needed on every glance must be up front.** Hiding it behind a disclosure does not
      reduce complexity, it relocates it and adds a click to the same total effort. The test for an
      accordion is: is what is inside needed *every* time, or only sometimes?
      ([NN/g](https://www.nngroup.com/videos/progressive-disclosure/))
- [ ] **Filters and sort are zoom, not new information.** If a filter reveals something that was not
      derivable from the overview, the overview is lying by omission.
- [ ] **De-duplicate down the column before you hide along the row.** The bigger win is usually
      moving what repeats on every row up onto a group heading — a date, a repo, an owner — not
      folding away what is unique to each. Measured on one list: what turned a two-line row into a
      one-line row was the date moving to the day heading, not the disclosure that had just been
      added. Hiding the unique part costs a tap; removing the repeated part costs nothing.

Folklore flag: "30–50% faster with progressive disclosure" circulates widely and traces to a
secondhand citation. Do not quote it as a number.

### If it is an operational dashboard

- [ ] **The bar for a top-of-screen, high-contrast treatment**: *is this urgent, actionable, and
      actively or imminently visible to the user?* Everything failing that test is secondary,
      however interesting. ([Google SRE book](https://sre.google/sre-book/monitoring-distributed-systems/))
- [ ] **Symptoms above causes.** What is broken goes at the top; why it is broken is a drill-in.
- [ ] **Alert fatigue is a design failure.** People can respond with urgency a few times a day. If
      every row looks urgent, none of them is — so count how many things on the screen are currently
      wearing the alarm colour, and if it is most of them, that is the finding.
- [ ] **Four golden signals** — latency, traffic, errors, saturation — as the minimum vocabulary for
      "what does this screen need to say about one running thing".
- [ ] **Normalise units**; prefer a percentage of the ceiling to a raw number when ceilings differ.
      Avoid stacked series by default: stacking makes any individual series unreadable.
      ([Grafana](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/))
- [ ] **Refresh no faster than the data changes.** A 30-second refresh on an hourly metric asserts a
      freshness that does not exist.

Folklore flag: "no more than N panels per dashboard" is not in Grafana's docs, whoever attributes it
there.

---

## Afterwards: how you know it worked

A redesign is unusually good at looking finished while being worse, so decide the evidence before
you start.

- [ ] **Before-and-after screenshots at every supported width**, from the *same data*. Render from a
      fixed capture rather than a live source, or the two shots differ for reasons that have nothing
      to do with you.
- [ ] **Re-run the measurements** from § Measure. Distinct sizes, colour frequencies, page height,
      interactive count — these are the numbers that moved, or did not.
- [ ] **Walk the list from question 3 by name.** Every state you wrote down as "must stay visible"
      gets looked at in the new design, individually. Not "checked the page" — checked *that state*,
      which usually means forcing it.
- [ ] **A check that could fail.** Prose in a plan cannot go red. If a property matters — an unknown
      never renders a number, a status never relies on colour alone, no arbitrary type sizes outside
      the scale — consider whether it is expressible as a test or a lint rule. Not everything is
      worth one; the ones guarding an *absence* usually are, because absences are what nobody
      notices breaking.
- [ ] **Then look at the picture anyway, yourself.** A suite that asserts *which words appear*
      cannot see *how a screen reads*, and that gap is where the interesting defects live. Two
      failures it will never catch:
      - **An honest state drawn as the wrong honest state.** *Nobody measured this*, *this cannot be
        shown to be yours* and *the source broke* are all legitimate, so every arm passes every
        assertion — and picking the loudest one paints a page of red alarms over what is merely a
        gap. Only a person looking at the rendering sees that the screen is shouting.
      - **Saying the same thing twice.** A caption you wrote in front of a message the system
        already produced reads as two facts in a diff and as one long paragraph on screen. It is
        the most common way a redesign to remove a wall of text adds to it.

      So the last step is not a command. Open the screenshot, ask the question from Half One, and
      see whether the answer is where you put it. **If you delegated the screenshots, look at them
      yourself** — a report saying "nothing is broken" is an answer to a different question, and an
      agent measuring the DOM cannot see what is `sr-only`, what is off-screen, or what is loud.

## Source quality, briefly

Strongest, and safe to cite as rules: **W3C/WCAG** understanding documents (1.4.1, 1.4.3, 1.4.11,
2.5.5, 2.5.8), the **Google SRE book**, **Shneiderman 1996**, **NN/g**'s own articles, **IBM
Carbon**'s status pattern (which publishes its accessibility rationale).

Solid, and vendor or practitioner rather than standard: **Grafana**'s docs, **Shopify Polaris**,
**Refactoring UI** (a well-regarded book; its numbers are the authors' heuristics, not studies), and
practitioner syntheses such as Smashing's — good on pattern, not to be quoted for figures.

Flagged above where a widely-repeated claim is folklore. Prefer to lose a rule than to cite one that
will not survive being looked up.
