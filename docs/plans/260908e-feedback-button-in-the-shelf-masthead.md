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

**That is the bug the report is really describing**: the button is present, hit-testable and
correct, and it does not read as the homepage's Feedback button.

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

_(filled in below, after Fable's arbitration and the GPT Sol review)_

## What is deferred

Two things this deliberately does not touch, both of them somebody else's ground in this wave:

- **The shelf's header sits under the status bar in the installed app** — `<h1>` at y=40 inside a
  59px inset, because `main` is `pt-10` and adds nothing for `--safe-top`. Real, visible on a
  phone, and a different bug from this one. `fb2e-black-bar-at-top-of-screen` is in the same wave.
- **The feedback dialog itself** — `fb2h-iphone-feedback-dialog-zoom` owns
  `FeedbackDialog.tsx` this wave. Nothing here goes near it.
