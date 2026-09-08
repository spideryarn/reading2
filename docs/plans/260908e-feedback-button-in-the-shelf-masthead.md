# The Feedback button in the shelf's masthead

**The report asked for a button that was already there.** This doc is mostly about what was
actually wrong, because the literal request — draw the Feedback button in the top right of the
logged-in homepage — describes something the app has done since 2026-08-31 and was doing on the
exact production build Greg filed from.

Greg, 2026-09-07 17:32 UTC, `SPIDERYARN-READING2-2C`, filed from an article on production
(`build_commit=c0fb04a4`):

> Show the Feedback button in the top right of the logged in Homepage

He is the administrator (`001bb7a0-…`, checked with `scripts/feedback-reporter.ts`, exit 0), so
[feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it) says build it
without stopping to ask whether it is worth doing. What is left to decide is *what* to build, since
the thing named is not missing.

## What was actually there

Reproduced in headless Chrome against this worktree's own dev server, signed in as the dev admin,
on the shelf at `/`:

| width | `.fb-button` | box | topmost element at its own centre |
|---|---|---|---|
| 390 × 844 | present | 352, 0 · 38 × 44 | its own `<svg>` |
| 430 × 932 | present | 392, 0 · 38 × 44 | its own `<svg>` |
| 768 × 1024 | present | 648, 0 · 120 × 44 | `.fb-button-text` |
| 1000 × 900 | present | 880, 0 · 120 × 44 | `.fb-button-text` |

`display: flex`, `visibility: visible`, `opacity: 1`, `z-index: 60` at every width, and nothing
covers it — `elementFromPoint` at its own centre returns the button or its glyph, never something
painted over it. `tests/feedback-button-visibility.test.tsx` has asserted *is drawn for a signed-in
reader* on `/` since 2026-08-31, and `git show c0fb04a4:src/web/App.tsx` still carries the one line
that draws it. So this is not a regression and it is not a device-specific disappearance.

**What the reader sees instead** is the answer, and the phone case makes it obvious. Below the
731px query `.fb-button-text` is `display: none`, so what remains on a phone is a bare 15px
speech-bubble glyph in `--ink-faint` — a mid grey, chosen deliberately, because `feedback.css` says
so: *"It is chrome offering to take a complaint, not a call to action — a button that advertises
itself in the corner of every page is one more thing between the reader and the article."* It is
alone in the absolute corner of the **window**, with nothing else near it.

Meanwhile the shelf has its own top-right cluster, in the **content column**: the `Profile` and
`Admin` links in `Library.tsx`'s header, small icon-plus-label controls in the same `--ink-faint`
grey. On a 1280px window that cluster sits about 130px to the left of the Feedback button and 20px
below it. They are the same kind of control, wearing the same colour, and they do not read as one
group.

The installed-app case is sharper still. With an iPhone's insets standing in
(`--safe-top: 59px`, the number `shell.css` records for the device in question), the shelf's
`<h1>Spideryarn</h1>` sits at y=40 — partly under the status bar — while the Feedback button
correctly drops to y=59 because `.fb-button` is `top: var(--safe-top)` and the shelf's `main` is a
plain `pt-10`. So on the one device Greg was holding, the Feedback button is the single element in
that band that is *not* aligned with anything else on the page.

**So this is read as a placement request rather than a defect report**, and the distinction is worth
keeping because only half of it is measured. What is measured: the button is present, hit-testable
and correct, and it sits apart from the page's own controls. What is *inferred*: that this is why
Greg could not find it. He filed from an article, phrased it as a placement request, and did not say
he had looked and failed — so "it does not read as the homepage's Feedback button" is our reading of
what he wants, not an observation of what happened to him. GPT Sol pushed back on an earlier draft
that stated it as fact, and was right to.

The reading is still the one to build on. A settled, signed-in DOM absence at `c0fb04a4` is very
unlikely on this evidence, and a transient auth-loading frame — the only remaining mechanism — does
not fit a report phrased this way. If Greg says otherwise, the thing to re-examine is that frame.

### The question the brief expected, and why there isn't one

The brief for this session anticipated that the existing trigger might assume an article is in
scope, and that the interesting part would be what a report with no article attached carries
instead. **It carries the same thing every other non-article page's report carries, and always
has.** `FeedbackHost` computes `where` once, from the router:

```ts
where={{ url: location.href, slug: route.kind === "read" ? route.slug : null }}
```

so `slug` is already `null` on `/privacy`, `/profile`, `/admin` and the shelf, and the `url` tag —
which is the field that makes a report actionable when there is no slug — is `location.href`
whatever the page. `route_kind` was the closed vocabulary that used to make this a question, and
Greg deleted it on 2026-09-02 precisely so that every page could file a report without a migration
([feedback.md § The one rule](../project/feedback.md#the-one-rule)). Nothing about the payload
changes here, and this plan proposes no new field, so
[feedback.md § The one rule](../project/feedback.md#the-one-rule) is untouched.

## The options

**A. A third shape, `masthead`.** Draw the same `FeedbackTrigger` as an icon-plus-label control
inside the shelf's `Profile`/`Admin` cluster, wearing its neighbours' classes, and stop drawing the
fixed corner trigger on the `library` route so there is exactly one per page.

**B. Make the corner louder on the shelf** — keep the word visible below 731px, or brighten it.

**C. Write it up and leave the corner alone**, on the argument that the button is present and this
is discoverability rather than a defect.

**The simpler option this passes over is C**, and it is worth naming because it is genuinely
defensible: nothing is broken, and the corner's quietness is a decision somebody made on purpose.
It loses on one fact — the person who cannot find the button is the person who *wrote the feature*,
which is about as strong a signal as a discoverability complaint can carry.

B loses on a different one: it makes the button louder without making it belong to anything, and
the corner is exactly where it is least connected to the rest of the page. It also spends the
quietness that `feedback.css` argues for, and buys alignment with nothing.

## The decision

**A, and Fable arbitrated it** — the call this doc was written to hand over, since both A and C are
defensible and the person who would normally decide is asleep. Its reasoning, 2026-09-08, is worth
keeping in three lines because two of them are better than mine:

- **C argues with the reporter about what he meant.** *"He is not saying it is missing; he is saying
  the homepage's top-right — which to a reader means the Profile/Admin cluster, not the window
  corner — should hold it."*
- **The consistency objection is already spent.** *"'Same place on every page' was already given up
  on 2026-09-06 when the reading view — where readers spend nearly all their time — moved it into
  the bottom Dock. The rule now is 'in the page's own chrome cluster', and A is that rule applied to
  the shelf."* That is the argument I would have had to make badly; the corner is not a convention
  this breaks, it is the fallback for pages that have no chrome of their own, and the shelf stopped
  being one of those the day it grew a masthead.
- **The learned-location risk is small**, and points the other way on a phone: the new spot is a
  hand's width from the old one, and the row never hides its labels, which the corner does below
  731px.

### And the safe-area line came out of the same review

Fable's closing note was that the shelf's `<main>` should get `--safe-top` too, offered as a
separate one-liner. **It is not separate, and that is the one place this plan changed after the
arbitration.** `.fb-button` was `top: var(--safe-top)` and cleared the notch under its own power; a
control in the masthead row inherits whatever `<main>` says. Moving the button into a header that
starts at y=40 inside a 59px inset would have taken a button Greg could not find and put it under
the status bar — on the very device he filed from. So it is a precondition, and it ships here.

The shelf keeps its own 2.5rem: `pt-10` becomes `pt-[calc(2.5rem + var(--safe-top))]`, which changes
nothing on a desktop and honours HomeLogo.tsx's rule that a page's top clearance is its own business.

### What is built

| change | where |
|---|---|
| a third `FEEDBACK_SHAPE` row, `masthead`, wearing the `Profile`/`Admin` classes | `src/web/FeedbackButton.tsx` |
| `hook` per shape, and `FEEDBACK_TRIGGER_SELECTOR` derived from it | `src/web/FeedbackButton.tsx` |
| the corner trigger stops being drawn on `library` | `src/web/App.tsx` |
| the trigger in the masthead row, last and so right-most; `<main>` gains `--safe-top` | `src/web/Library.tsx` |
| the shelf case now asserts the masthead shape and the corner's absence | `tests/dock-corner-controls.test.tsx` |
| the masthead shape's own block, and § every shape is countable | `tests/feedback-button-tooltip.test.tsx` |
| the who-gets-a-button cases ask for any shape rather than one class | `tests/feedback-button-visibility.test.tsx` |

### `hook`, and the test that was about to stop meaning anything

`tests/dock-corner-controls.test.tsx` enforces *never two Feedback buttons on one screen* by counting
elements, and it counted them with a hand-written `".fb-button, .dock-feedback"` — a list of the
shapes that existed the day it was written. **A third shape would not have broken that test.** It
would have made it cover one page fewer: a masthead trigger matches neither class, so a shelf drawing
both would have counted as one and the file would have been green about it. That is
[silent-success.md](../reusable/silent-success.md) exactly — a check that agrees with the code
because it shares an assumption with it.

So each shape carries a `hook` class, `FEEDBACK_TRIGGER_SELECTOR` is built from that column, and the
count is derived rather than remembered. The compiler cannot finish the job, because `hook` and
`button` are two independent strings and nothing makes the first a substring of the second — so
§ *every shape is countable* renders each variant and checks its hook really is on the rendered
element. Two halves, at opposite ends, neither trusting the other.

### The 6px the reset does not take, found by measuring rather than looking

The masthead trigger is a `<button>` in a row of `<a>`s, and the global button reset in
[`tailwind.css`](../../src/web/tailwind.css) deliberately takes a button's border, background and
font but **not its `line-height`** — the note there argues that case at length — and, it turns out,
**not its padding**. So the first version of this button kept the UA's `padding: 1px 6px` while its
neighbours had none.

Measured in Chrome, 2026-09-08: 18px tall against their 16, and the gap between `Admin` and
`Feedback` reading 22px in a row where every other gap is `gap-4`'s 16. **The vertical difference
never mattered** — the row is `items-baseline` and the glyph is shorter than the line box, so the
text baselines aligned exactly either way, which is why the screenshot looked fine. The horizontal
6px is what a reader would eventually feel, in a row whose entire design claim is that this control
is indistinguishable from `Profile` beside it.

`tw:p-0` fixes it, and the re-measurement is the evidence: `padding: 0px`, `h: 16`, the same `top`
as both links, and both gaps exactly 16.0. It is pinned by a test, because **jsdom has no layout and
cannot see any of this** — the class is the only proxy, and `p-0` is precisely the class a later
tidy-up would delete as redundant.

The same pass checked the two things a keyboard reader needs: tab order runs
`Profile → Admin → Feedback → the search box`, and Enter on the focused button opens the dialog.
Neither the button nor the links declare a focus ring, so all three fall back to the browser's —
consistent, which is the point, though it is the row's existing behaviour rather than anything this
change chose.

### Watched red before it was believed green

Both new guarantees were falsified deliberately, because a check nobody has seen fail is not
evidence:

- **Restoring `App.tsx`'s old `route.kind !== "read"`** — the shelf case and the visibility control
  both fail with `expected …(2) to have a length of 1 but got 2`. Two buttons on the shelf, which is
  the failure the count exists for.
- **Misspelling `masthead.hook`** — five cases fail, including
  `masthead is invisible to the one-trigger-per-page count`, which is the silent one stated out
  loud.

## What the cross-family review changed, and it was three things

GPT Sol, 2026-09-08, on the built code. No P0s; every finding below was checked and acted on.

- **P1 — two triggers on `/design` and `/admin` for an ordinary reader.** `SignedIn` answers an
  administrator's address from a non-administrator with the *shelf*, so those pages drew the
  masthead trigger — while the corner condition, written as `route.kind !== "library"`, saw a route
  that is not `library` and drew a corner one too. **Two Feedback buttons on one screen, which is the
  single rule `tests/dock-corner-controls.test.tsx` exists to hold**, green in every suite because
  neither address was in its walk and `tests/admin-only-routes.test.tsx` proves they render the shelf
  without ever counting a trigger.

  The fix is a `drawsShelf(route, user)` predicate that both halves read, and the finding is really
  about the shape of the question: a corner control has to ask **what page is this**, which depends
  on the reader, not **what route is this**, which does not. Reproduced first — both addresses fail
  with `drew 2 triggers` — then fixed, and the walk now covers them.

- **P1 — on the reported phone, "top right" was top left.** The header row is `flex-wrap` +
  `justify-between`, and `space-between` puts a *single* item on a line at that line's **start** — so
  the moment the control group wrapped, which is every phone, it sat against the left margin. At
  390px it ran 24→250 in a 366px column. Invisible while the group was only `Profile` and `Admin`;
  not invisible once it held the button Greg asked to have in the top right, on the device he asked
  from. `ml-auto` on the group fixes it and does nothing on the unwrapped line, where
  `justify-between` had already put the free space there. Now measured flush at every width:
  `gapToRightEdge: 0` at 390, 430, 700 and 1000.

- **P2 — the hit target fell from 38×44 to 16px.** Moving a control off a fixed corner and into a
  text row shrinks it, and this is a control a phone reader reaches for. The floor already exists —
  `min-height: 2.5rem` under `@media (pointer: coarse)`, the dock's number since Greg asked for it on
  2026-08-28 — so this reuses it as `tw:pointer-coarse:min-h-10` rather than inventing one.
  **All three controls in the row get it**, on `narrow-window.css`'s own argument about the two
  order rows: a floor given to one control is a bug report about the one beside it. `Profile` and
  `Admin` were always 16px, so that part is a pre-existing condition fixed in passing rather than a
  regression of this change. Verified under Chrome's mobile emulation, where `(pointer: coarse)`
  genuinely matches — `hasTouch` alone does not flip it: all three at exactly 40px, same `top`.

**And one thing it changed that was not code**: an earlier draft of this doc said the unfindability
*was* the bug, which states an inference about Greg's experience as an observation. See § What was
actually there, above, which now separates what was measured from what was read into it.

Two findings it explicitly cleared, worth recording because they were the ones I was least sure of:
`FEEDBACK_TRIGGER_SELECTOR` is sound for counting — deriving it from `FEEDBACK_SHAPE` is not
circular, because renaming a hook and its class together is harmless drift rather than a false green
— and the safe-area change is "justified, not scope creep", with no test or caller depending on the
literal `tw:pt-10`.

## What is deferred

Two things this deliberately does not touch, both of them somebody else's ground in this wave:

- **The shelf's header sits under the status bar in the installed app** — `<h1>` at y=40 inside a
  59px inset, because `main` is `pt-10` and adds nothing for `--safe-top`. Real, visible on a
  phone, and a different bug from this one. `fb2e-black-bar-at-top-of-screen` is in the same wave.
- **The feedback dialog itself** — `fb2h-iphone-feedback-dialog-zoom` owns
  `FeedbackDialog.tsx` this wave. Nothing here goes near it.
