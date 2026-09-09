# A design system for the fleet dashboard: research, a reusable UI/UX prompt, then apply it

**Status as of 2026-09-09: Stages 1–3 done.** Screenshots and measurements taken, the research done,
and [design-a-screen.md](../reusable/design-a-screen.md) written. Sol's read of the screens and the
restyle follow.

Up: [dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md) via
[fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md);
[overseer-direction.md](../project/overseer-direction.md) is the direction this serves.

## Goal

Greg, 2026-09-09:

> the Usage Limits tab UI is horrible. It's really hard to scan. In general, I think we need a
> design system of some kind. Write screenshots to files, and get input from GPT Sol. Ask the
> question for each screen "what are the main purposes/intent/questions that the user might have,
> and how can we make that more visible. Better still, do some web research with Sonnet about best
> practices for UI/UX, and write up as a prompt in docs/reusable/ , and then apply that throughout
> the web dashboard.

And, asked what he wants from the dashboard as a whole — relayed by the Overseer the same day, and
the **acceptance test for every screen in this plan**:

> The main thing I really want from this web dashboard interface is to have a very easy way to see
> answers to questions like: Is anything needed from me? Is anything blocked? Where do things
> stand? And right now, it is very hard to see those things!

Three questions, in his order:

1. **Is anything needed from me?**
2. **Is anything blocked?**
3. **Where do things stand?**

A screen that does not help answer one of those three is not finished, however tidy it looks. This
is not a beautification job: the deliverable is a page that answers a question faster.

## What "design system" means here, and what it does not

The fleet dashboard **already has half of one** and it is the half everyone builds first. Measured
in this worktree at `447d70f4`:

| It has | It has not |
|---|---|
| One token file, light and dark, one place per colour (`tailwind.css`, 691 lines) | Any **type scale** — 355 of 361 text-size utilities are `10px`–`13px` |
| A five-tone status language, `Record`-keyed so a sixth tone is a type error (`ui.tsx` `TONE_CLASSES`) | Any **emphasis rule** — which of those tones may be the loudest thing on a screen |
| `Card`, `Pill`, `SectionHeading`, `Button` with one height and one radius | Any **spacing scale** — `controls.md` says outright it does not invent one |
| A `danger` variant that is deliberately not `loud` | Any statement of **what each screen is for**, so nothing can be judged off-plan |

Two censuses make it concrete. Both are `grep` over `tools/fleet/web/src/`, so **both are counts of
source, not of rendered screen** — a distinction Sol made and the first version of this plan blurred.

- **Type.** 355 arbitrary sizes — `text-[12px]` ×156, `text-[13px]` ×149, `text-[11px]` ×41,
  `text-[10px]` ×3, `text-[14px]` ×2, `text-[15px]` ×2, and one each of `17px` and `22px` — plus 13
  named ones the first census missed (`text-xs` ×7, which is 12px, and `text-sm` ×6, 14px). So of
  **368 sizing utilities, 356 are in the 10–13px band.** Two weights, `font-medium` ×85 and
  `font-semibold` ×49. The page is drawn in a 3px band: **nothing can be dominant, because nothing
  is bigger than anything else.**
- **Ink.** `text-ink-faint` ×177, `text-ink-soft` ×129, `text-ink` ×69 — exact.

**The inference from the ink census was wrong, and Sol's is better.** The first version of this plan
said *when the whisper is the majority voice, nothing is quiet*. That is rhetoric standing in for an
argument: a majority of quiet text is perfectly good hierarchy when the quiet text really is
secondary. What the ratio actually indicates is the thing worth acting on —

> it more strongly indicates that most of the visible page is secondary material. Making those
> paragraphs quieter will not make the yes/no, percentage and reset time sufficiently easy to find.
>
> — GPT Sol, P1(1), 2026-09-09

So the work is not mainly a type scale. **It is information hierarchy: deciding what is primary and
deleting, collapsing or demoting the rest.** The scale is necessary and nowhere near sufficient, and
Stage 6 is reframed below accordingly.

**The simpler option passed over:** restyle the Usage tab alone, no doc, no research, no scale.
Rejected because Greg asked for the general thing ("in general, I think we need a design system"),
because the same 3px band and the same secondary-material problem show up across the eight tabs, and
because a one-tab fix would be re-litigated by the next agent who adds a tab. **What that costs is
not "one stage: the doc"** — another sentence the first version got wrong. It costs the research,
the full-screen measurement, Sol's analysis, the shared primitives, two pilot surfaces and then
every remaining tab, and the honest form of the trade is that the general version is severalfold the
cost of the narrow one and is worth it only if the tabs after the pilots actually get done.

**A second simpler option passed over:** adopt a third-party design system (Carbon, Polaris, shadcn
proper). Rejected on [vision.md § Principles](../project/vision.md#principles) — *prefer boring*,
and a third exception to it is Greg's to make, not mine — and because `tests/fleet-imports.test.ts`
already forbids the fleet reaching into `src/`, so a dependency here is a dependency this tool
carries alone.

## Constraints

- **Honest absence survives.** Every state in `UsagePanel.tsx`'s header — an expired window carries
  no number *at all*, "no limits hit" is drawn only beside its coverage, an old 429 is history not a
  live block, a future timestamp is unreadable not fresh — is load-bearing and must come out the
  far side. A redesign that makes an unknown look calm has failed;
  [overseer-direction.md § Does the augmentation principle apply?](../project/overseer-direction.md#does-the-augmentation-principle-apply)
  is the rule it breaks — *never hide that a decision was made, or who made it* — and
  [silent-success.md](../reusable/silent-success.md) is the class.
- **Phone first, and both.** 390px is the size Greg actually reads this at; 1280px must not become
  a stretched phone.
- **Follows the device for light/dark**, unlike the product, which is dark unconditionally. Both
  branches are real and both get looked at.
- **No import from `src/`** — `tests/fleet-imports.test.ts` walks the whole transitive graph. The
  reader app's design docs are to be *learned from*, not imported:
  [design-css-overview.md](../project/design-css-overview.md),
  [typography.md](../project/typography.md), [controls.md](../project/controls.md),
  [colour-scales.md](../project/colour-scales.md),
  [narrow-windows.md](../project/narrow-windows.md), [icons.md](../project/icons.md).
- **Do not restart or reconfigure the live dashboard on 8787.** Screenshots come from a fixture
  server (below), never from the live page.

## The screenshot harness, and why it is not the live page

A disposable Node server serves **this worktree's own `tools/fleet/web/dist/`** and answers the
read-only API routes from **one capture of 8787's GET responses**, taken once at the start of this
plan. Real data, this build, no collection cost to the box, and — the reason it matters for a plan
whose deliverable is before/after pairs — **the data cannot move between the two shots.**

The previous plan got this wrong in a way worth not repeating:
[260909b § RETRACTION](260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md)
records screenshots believed to be of one worktree's build that were of another's. The check that
would have caught it is the one this harness makes trivial: the server prints the `dist` path it is
serving in its bind line, and that path contains the worktree name.

The harness lives in the session scratchpad, not the repo, because it is scaffolding: it hardcodes
a snapshot directory and answers eight routes out of twenty-two. If a second plan wants it, that is
the moment to commit it, not now.

Screenshots land in `docs/plans/260909c-dashboard-design-system-screenshots/`, `before/` and then
one `after/` per applied stage.

## Stages

### Stage 1 — measure what is there

*Status: done.*

- [x] Capture the live GET routes once; stand up the fixture server on 127.0.0.1:8901.
- [x] Type and ink censuses (above).
- [x] Screenshots of every tab at 1280 and 390, plus full-page at 390, plus the session detail —
      27 files in `260909c-dashboard-design-system-screenshots/before/`.
- [x] Per-tab measurements at 390px.

#### What the page measures

| Tab | 390px height | Interactive elements | Font sizes | Text colours | Horiz. scroll |
|---|---|---|---|---|---|
| Deploys | **8,839px** | **151** | 5 | 4 | no |
| Recent messages | 6,932px | 34 | 5 | 6 | no |
| Sessions | 3,529px | 93 | 6 | 5 | no |
| Overseer | 3,182px | 26 | 5 | 6 | no |
| **Usage limits** | 1,922px | 17 | 7 | 6 | no |
| Box health | 1,525px | 22 | 6 | 7 | no |
| Queued ideas | 1,149px | 18 | 5 | 5 | no |
| Readiness | 872px | 12 | 6 | 6 | no |

Nothing overflows horizontally, which is worth saying because it is the one thing that usually goes
wrong at 390px and here does not. **Usage limits is not the tallest tab — it is the fifth.** So the
complaint is not about length, and a plan that set out to shorten it would be answering a question
Greg did not ask.

**Correction to the interactive-element column, 2026-09-09.** Every figure in it is a
`querySelectorAll` count and therefore **an over-count on any tab with a disclosure** — session
`deploys-ui` measured a page where the selector said 171 and a real 250-press Tab cycle said 34.
The obvious rescue does not work: `content-visibility` on a closed `<details>` clears neither
`offsetParent` nor `getClientRects()`, so a "visible" filter returns the same wrong number with more
confidence. Deploys is the tab most affected, being almost entirely disclosures now; the figures
above stand as a *relative* signal between tabs measured the same way, and nowhere else. The rule and
its sibling — do not compare a before taken one way with an after taken the other — are in
[design-a-screen.md § Measure](../reusable/design-a-screen.md).

#### Reading the Usage tab off the pixels, not off the DOM

Mine, from `usage-390-full.png`, having looked at it rather than at a measurement of it:

1. **It is a document, not a dashboard.** Twelve paragraphs, every one full-bleed, left-aligned and
   the same size. Nothing is a number, nothing is a bar, nothing is a cell.
2. **The section headings are the quietest text on the page.** `REJECTIONS SEEN` and
   `CACHED HEADROOM` are 11px uppercase in the faint ink — smaller and paler than the prose they
   organise. They are the only structure the tab has, and they are drawn to disappear.
3. **The one real number is `seven_day 58%`, at 13px**, in the middle of the third block, below
   three non-answers, with nothing drawn against it. The reader's question is *how much headroom is
   there*; the answer is present, in body copy, in the fourth screenful.
4. **Every timestamp is printed three times** — `2026-09-09 05:51 UTC · 06:51 London · 08:51
   Athens` — and there are about ten of them. Greg is bouncing between London and Athens so the
   zones exist for a reason, but this is a large fraction of the page's height spent on the same
   instant said three ways.
5. **One bullet is an eleven-line essay** about a `seven_day` contradiction, at the same weight as
   the sentence above it that says the account is fine.
6. **Three of the non-answers are printed twice on one screen** — `nimbus_quill`, `spend` and
   `member_dashboard_available` each appear in *Cached headroom* and again under the 24-hour chart,
   word for word.
7. **The 24-hour chart is mostly empty**: a full-width plot with a 100/50/0 axis carrying one short
   green segment. It occupies about a screenful and asserts almost nothing.

#### The correction: the tooltips are not on the page

The screenshot agent reported that tooltip text is *"rendered inline as regular flowing text … the
single biggest driver of the wall-of-text feeling"*. **That is wrong, and it is worth recording why,
because the mistake is a standard one.** `Explain` puts its sentence in a `tw:sr-only` span
(`Tooltip.tsx:278`) — visually hidden, present in `textContent`, and returned by `getComputedStyle`.
An agent measuring the DOM sees it; the reader never does. Checked against the rendered pixels
before it reached this plan. [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)
is the class; the local lesson is that a screen's own screenshot outranks a census of its DOM.

#### Box health is the model, and the pattern already exists

The best-organised tab is `HealthPanel`, and what makes it work is one repeated shape: a **stat
card** — an 11px uppercase faint LABEL, a ~22px bold tone-coloured VALUE, and a 12px soft line of
evidence under it (`4.0` / *0.3× of 16 cores*), two to a row. It is the only place on the whole
dashboard that uses the 22px size, and it is the only tab where the number that matters is the
biggest thing in its box.

**So the design system's main job is to name that pattern and spread it**, not to invent one. It
also happens to be the shape that preserves honest absence: the value slot can hold an em-dash and
the evidence line the reason, without the card losing its form.

#### And the Sessions list, which is the landing candidate

From `sessions-390.png`: the first screenful answers *is anything needed from me?* well — a
red-edged card, `AT LEAST 1 WAITING ON YOU · SCANNED 23S AGO`, with its floor caveat under it. Then
it stops answering anything.

- **Two of the four lines on every session card are constant across all 18 rows** —
  `spideryarn/reading2` and the monospace id trio. That is Fable's item 3 in
  [260909b](260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md#3-the-misdirection-proxies-which-no-screen-shows-at-all),
  now confirmed off the pixels.
- **The *New session* card sits above the list**, spending a block on a rare action.
- The fold falls on the second `WORKING` card, so *where do things stand?* costs 3,529px of
  scrolling, and *is anything blocked?* is not asked anywhere on the screen.

### Stage 2 — what the field actually knows

*Status: done.* Seven areas researched with sources; the conclusions are in the doc below rather
than restated here, per [documentation-policy.md](../reusable/documentation-policy.md) — one home per
fact. Three widely-repeated claims are flagged there as folklore rather than evidence (the
Z-pattern for dense screens, "30–50% faster with progressive disclosure", and any "N panels max"
attributed to Grafana).

### Stage 3 — the reusable prompt doc

*Status: done.*

- [x] [docs/reusable/design-a-screen.md](../reusable/design-a-screen.md) — written as a prompt in
      two halves: three questions answered in prose before any stylesheet is touched, then the
      checklist. Greg's question is its first half, generalised; the rule that a screen answers one
      question, that a caveat stays on screen only if it changes what you do in the next ten
      seconds, and that zero / unknown / stale / failed are four renderings and not one, are the
      three it is built around.
- [x] One line in [docs/reusable/README.md](../reusable/README.md) under *How to do a task*.

### Stage 4 — Sol on the screens

- [ ] Hand GPT Sol the screenshots, the measurements, the reusable doc and Greg's three questions;
      ask his question per screen and for the ranked changes per tab.
- [ ] Sol reviews this plan, as the engineering-manager cadence requires, before any code.

### Stage 4b — the type scale and `StatCard`

*Status: done.* Additive: no existing panel changed, nothing existing restyled.

- [x] A **five-step type scale** in `tailwind.css` — `answer` 22px, `lead` 15px, `body` 13px,
      `note` 12px, `label` 11px, each at least ~25% from its neighbour. Not invented: they are
      `HealthPanel`'s stat tile's own three sizes, named, plus the body size and one step down.
      **Sizes only** — weight and colour are deliberately not welded to the step, because emphasis
      wants two dimensions moving together and fusing them would take that choice away at every call
      site. No sixth step, and nothing below 11px.
- [x] **`StatCard`** in `ui.tsx`, with `StatValue` as a four-arm union — `value`, `stale`, and
      `absent` in one of three named states. An absence **cannot** carry a number, and **cannot**
      inherit the caller's calm tone.
- [x] [tests/fleet-stat-card.test.tsx](../../tests/fleet-stat-card.test.tsx) — 11 assertions about
      *distinguishability* rather than styling.

**They passed first time, so they proved nothing until they were made to fail.** Three mutations,
each killing exactly the tests that should die and no others: collapsing the three absence words
back to one em-dash killed 5; letting an absence take the caller's tone killed 2; dropping the stale
age killed 1. [silent-success.md](../reusable/silent-success.md).

### Stage 5a — the landing surface's data contract, before any of it is built

Dispatched into this plan by the Overseer on 2026-09-09, and it outranks the Usage restyle because
it is the thing Greg actually asked for. It absorbs
[260909b's ranked proposal](260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md#the-ranked-proposal)
items 1 and 2 (*on a phone the detail is the whole page*; *the detail should show what the inbox
knows*); that session stays idle.

Split out of a single Stage 5 on Sol's P1(2), which is right: *"landing-first as product priority is
defensible; landing implementation before its data contract is not."* The original stage postponed
its own feasibility work until inside the build.

- [ ] For each of the three questions: the **supported answer**, its **completeness condition**, and
      its **honest non-answer** when the condition fails.
- [ ] A 390px wireframe, and a stated acceptance criterion for "one screenful" — currently the
      plan's weakest word, since an attention list of six cards has no screenful. Proposal to be
      settled here: *the answer to all three questions, and the first item of any of them, fit above
      840px at 390px wide* — the rest is a count and a scroll.
- [ ] **No build in this stage.** If 5a shows the landing needs another session or new collection
      work, the Usage rewrite becomes the first code pilot instead and the landing waits, rather
      than the whole job waiting for it.

### Stage 5b — build the landing surface

- [ ] Build only what 5a showed to be supported. State unknown coverage rather than inventing a
      generic "blocked" count.
- [ ] **It replaces the Sessions page rather than sitting above it** — Sol's GLOBAL-01, and the trap
      this plan was walking into. Three regions: *needs you*, *blocked* (never a `0` that was not
      measured), *progress* (movement, not `7 working`). Roster and log become drill-ins.

#### What the data can already support, from the captured snapshot

Read off the fixture capture rather than assumed, so the design starts from what exists:

| Question | What exists today | What is missing |
|---|---|---|
| **Needed from me?** | `state.attention.list.items` — the Overseer's ranked inbox, 1 item in this capture, each with `kind`, `waitingSince`, prose evidence and the session it belongs to. Plus `queue.depth.needsGreg` (1) and `queue.depth.unauthorized` (5 proposals nobody has authorised) | Nothing, for a v1. The two sources have never been drawn on one screen |
| **Anything blocked?** | Queue rows carry `wait` / `waitingOn` / `ready`; the usage verdict says whether the account is rate-limited; readiness carries a red-gate verdict; sessions carry `question` and `pause` | **There is no field that says a session is blocked.** `status` is `working` / `idle` / `shell` — the pane's state, not the work's ([overseer-direction.md § `idle` is the bug](../project/overseer-direction.md#idle-is-the-bug-the-vocabulary-describes-the-pane-not-the-work)). Blocked-ness has to be assembled from the inbox's judgement plus the queue's `waitingOn`, and the landing must say which of the two it used |
| **Where do things stand?** | Per-session `description` and `title`; `readiness.verdict` and `dev` (including `dev → main: 323 commits not deployed`); `deploys.versions[0]` | **No "last wrote" or "last commit" per session.** The transcript path is on the page, so an `mtime` `stat` would give the first without a read — but that is a server change and the server is not mine ([260909b item 3](260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md#3-the-misdirection-proxies-which-no-screen-shows-at-all)). Named as missing; not invented |

#### The dock has run out of rungs — and a ninth tab makes it worse

Reported by session `readiness-tab` via the Overseer, 2026-09-09. **Not yet independently checked by
me** — my screenshots were taken with a fine pointer, so the `@media (pointer: coarse)` branch never
fired and they cannot confirm or deny it. Recorded as their measurement, to be reproduced before it
is designed against:

> At 390px with a coarse pointer the eight modes fit only as 40px icon buttons with the active label
> kept, and the standalone Refresh button then sits at x≈399, past the edge, reachable only by
> scrolling the bar sideways. `flex-grow` cannot help: at 448px of content in a 390px bar there is
> no free space to distribute, so the `.dock-modes` share weight is inert in exactly this case.

If it reproduces, it belongs here rather than in a CSS patch, because there is no rung below "labels
off": **a bar that grows one button per mode has no next step**, and the fix is a different shape —
an overflow, or a landing surface that demotes several tabs to a drill-in. That is the same
conclusion the three questions push towards, which is a reason to believe it rather than a
coincidence: if one screen answers *needed from me / blocked / where things stand*, several of the
eight tabs stop being top-level navigation.

### Stage 6 — Usage limits: an information-hierarchy rewrite, not a restyle

Reframed on Sol's P1(1). A restyle cannot fix this tab, because what is wrong with it is not how its
paragraphs look but that **there are seventeen of them and they are all equally primary**. The
component's own header says the question is *can this account afford more work?* and the rendering is
a careful evidentiary document rather than a decision display. The order to build to:

1. **The decision** — available / limited / approaching / cannot tell.
2. **The one valid number and the next reset time**, where they exist.
3. **Any caveat that changes that decision**, immediately adjacent to it.
4. **Provenance, old incidents and the second clock**, progressively disclosed.

- [x] Rewrite to that hierarchy, using `StatCard` for (2). Before/after pair at both widths in
      `260909c-dashboard-design-system-screenshots/`.
- [ ] Cut the duplication found in Stage 1: three non-answers printed twice on one screen. **Still
      open** — the second copy is under the 24-hour chart in `UsageHistory.tsx`, untouched so far.

#### Two defects the tests could not have caught, found by looking at the picture

Both were mine, both were in the component written to prevent exactly them, and both were found
after the suite was green. Recorded because the *shape* is the lesson:

- **A window whose `kind` is `unknown` was mapped to the `unavailable` state.** That arm means *a
  number arrived and cannot be shown to be valid* — typically no `resets_at`. Nothing failed. The
  consequence was **three red alarm cards on a tab whose verdict is "cannot tell"**: a gap painted
  as a fault, which is a misattribution and alert fatigue at once. It is `withheld` now, which is
  what that state exists for. **No test could have caught it**, because both are honest absences
  and every assertion is about which words appear, not about how alarming the page reads.
- **The producer's own sentence was printed twice.** For an expired window the card prefixed `why`
  with *"this window has already reset, so the cached number describes nothing: "* — and `why`
  already says exactly that. Eleven lines in one grid cell, on the tab whose entire complaint is
  that it is a wall of text. The prefix is gone; the state word `Unknown` carries what it was
  carrying.

The general form, which is now the last item in
[design-a-screen.md § Afterwards](../reusable/design-a-screen.md): **a suite that asserts which
words appear cannot see how a screen reads.** Both of these were a green suite and a wrong picture,
and the only instrument that found them was a screenshot looked at by someone asking whether the
answer was where it should be.

**And a third, from the same instrument, after the first two were fixed.** With the alarm colour
corrected the tab still gave most of its first screenful to three cards saying nearly the same five
lines: `nimbus_quill`, `spend` and `member_dashboard_available` — entries that sit in
`~/.claude.json`'s blob alongside the real windows, carry no `resets_at`, and are not headroom at
all. A violet wall instead of a red one is the same disease. They are now folded into a disclosure,
**count on the face and entries one tap behind**, which is the partition `Incidents` already makes
one section below and for the same stated reason: none of them is a thing to act on.

Whether that fold is a legitimate summary or the redesign quietly demoting an honest absence is the
question this plan is least sure of, and it is the one the code review is asked to challenge hardest.

#### What the rewrite actually moved, at 390px

| | Before | After |
|---|---|---|
| Page height | 1,922px | **1,478px** (−23%) |
| Where the headroom number is | 13px, third block, fourth screenful | **22px, first screenful** |
| Distinct font sizes | 7 | 8 |
| Distinct text colours | 6 | 7 |
| Horizontal overflow | none | none |

**The size and colour counts going UP is the point, not a regression.** A scale is a set of
deliberately separated steps; what was there before was a cluster, and flattening a page to fewer
sizes would score better on the tally and read worse. The diagnostic was always the spread. That
clarification is now in the checklist, because the tally is exactly the kind of number a later agent
would optimise in the wrong direction.

Above the fold on a phone, in order: the verdict, `CACHED HEADROOM`, both window cards — one reading
`42% left · 58% used · resets in 5d 23h`, the other `Unknown` because its cached number describes a
window that reset 182 minutes ago — then the fold, then *Why*. Before, the first screenful was three
paragraphs of provenance.

#### Two things left deliberately undecided until the code review answers

- **`windowStat`'s tone thresholds** — `left <= 10` alarm, `<= 25` needs — are numbers I invented.
  A nearly-full window really is closer to blocking, so this is arithmetic rather than judgement;
  but the producer already computes `approaching` with rules of its own, and a card that re-derives
  a severity is the *second interpretation of one measurement* this file's header forbids. Leaning:
  keep the colour, take the thresholds from the producer if it will give them, drop them if not.
- **`Cached headroom` as a heading** over a group that can contain a `Withheld` entry, which is by
  definition not headroom.
- [ ] Decide the three-zone timestamps. They are deliberate — Greg moves between London and Athens —
      but they are a large fraction of the tab's height, and the ten-second test says a wall-clock
      instant in three zones changes belief rather than action for every line except the *next
      reset*. Proposal: the reset keeps all three zones; everything else becomes an age with the
      zones one tap away. **This changes what the reader sees, so it goes to Greg** rather than
      being decided here.
- [ ] The fail-capable checks below, red before green.

#### The check that could actually fail — Sol's P1(3), adopted

The existing `tests/fleet-usage-card.test.tsx` is genuinely good: it already fails on lost strings,
resurfaced expired percentages, missing coverage, misbadged incidents and collapsed absence arms.
**And it stays green through every way this stage could go wrong** — it would not notice the
coverage moving into a closed disclosure, an unknown caveat becoming 10px faint, or the answer being
pushed below the phone fold.

So the states most at risk, named rather than gestured at:

- `limits.kind === "none"` versus `"unknown"`, and the `unreadable` / `malformed` / `TRUNCATED`
  qualifiers on the coverage line.
- A typed `expired` window, **and** a live `value` window whose reset passes while the page is open —
  neither may show its percentage.
- An unattributed cache after a `/login` swap: no percentages at all.
- A `limited` verdict whose attributed reset has passed: cleared/history, not live alarm, with the
  producer's reasons framed in the past tense.
- An unreset but *unattributed* incident: may say "has not reset", must not look like the active block.
- A future or unreadable `collectedAt`: stale or unknown, never fresh.
- The seven outer absences — `not-asked`, `no-report`, `report-unreadable`, checkpoint absent,
  checkpoint unreadable, unsupported schema, feed unreadable. **Only `usage === null` may draw
  nothing.**

And the check, which is a shape the existing suite cannot express:

- [ ] Give the decision, the valid number/reset, and any decision-changing caveat **explicit
      `data-*` roles**, so a test can find them without knowing the markup.
- [ ] One browser fixture test at **390px** over four representative states — `limited`,
      `ok`-with-coverage, `expired`/unattributed, `unknown`/stale — asserting **relational
      invariants, not pixels**: the verdict and any applicable reset are inside the first viewport;
      no critical region has a hidden or closed ancestor; the verdict's computed font size exceeds
      the provenance text's; unknown and error text is not assigned the quietest role.
- [ ] Keep every existing negative assertion that an expired or unattributed percentage appears
      nowhere.

A snapshot of every computed style would be brittle and is explicitly not what this is. Mutate the
finished code and check the suite notices, per [silent-success.md](../reusable/silent-success.md).

### Readiness: a handover, a constraint, and a question answered

`readiness-tab` handed the panel over and stopped. Three things came with it, recorded here because
the session that knew them is gone.

**A constraint that must not be broken.** The sparkline marks carry two axes at once: **colour is
state** (green pass, red fail, violet void, hollow outline for running) and **height plus a ring is
provenance** — full-height ringed is a run that counts towards the verdict, half-height is history
that can never vote. On this box most runs are bare `npx vitest run`, so most marks are history, and
if the two treatments collapsed *a green mark between two red ones would read as a recovery that
never happened*. The legend makes the same promise in words. Any resizing keeps both axes
distinguishable, and it gets checked at 390px specifically, because a ring is what disappears first.

**Their own diagnosis of the tab, which I agree with:** the cards are in the order the data arrives
— verdict, history, tree — rather than the order a reader needs them, which is why
`dev → main: 323 commits not deployed` is the last line of the third card at 13px. That is the
ordinary mistake, not a careless one, and naming it is the whole fix.

**And a real design question they asked rather than defended:**

> the headline currently says "we do not know" in the tone colour, and that will be the answer
> almost all the time, because a run only counts if it went through `scripts/readiness-run.ts` and
> nothing on the box does that yet … A permanently-unknown headline at that weight may be shouting
> a shrug.

**One absence is doing the work of two, and splitting them resolves it without shouting or hiding.**
This is [design-a-screen.md § Absence](../reusable/design-a-screen.md)'s rule biting somewhere I had
not expected it to:

- *Nothing on this box runs `scripts/readiness-run.ts`, so no run can ever count* is a fact about the
  **instrumentation**. It is stable, it is the same tomorrow, and it has a fix somebody could type.
  It is not news about this commit.
- *A run was attempted and could not be read*, or a reading is stale, or a gate genuinely went red,
  **is** news about this commit.

Drawn as one thing, the permanent case teaches the reader to skip the loudest element on the tab —
the alert-fatigue failure, which costs you the day it finally says something. Receding generally
would make an unknown look calm, which is the worse failure. So the instrumentation gap becomes a
**quiet, permanent, unmissable standing line** stating the gap and the command that closes it, and
the loud slot is kept for a verdict about this commit, which then means something whenever it
appears.

So Readiness's stage is: promote `dev → main` to a headline `StatCard`; split the two unknowns;
give the sparkline band weight without collapsing its two axes.

### The Sol plan review, and what it changed

Round 1 at `af0b6928`:
[260909c-dashboard-design-system-plan-review-sol-r1.md](260909c-dashboard-design-system-plan-review-sol-r1.md).
No P0. **All three P1s accepted and all three P2s acted on** — an unusually clean review to receive,
and the reason is that it attacked the plan's *reasoning* rather than its taste.

| Finding | What I did |
|---|---|
| **P1(1)** the diagnosis names a symptom, not the cause: form and information architecture, not type | Accepted. Rewrote § What "design system" means here, replaced my ink-census inference with Sol's, and reframed Stage 6 from *restyle* to *information-hierarchy rewrite* with a four-step order |
| **P1(2)** Stage 5 postpones its feasibility work into its own build | Accepted. Split into 5a (data contract, wireframe, no build) and 5b, with an escape hatch so the whole job does not wait on the landing |
| **P1(3)** "re-check every state by name" cannot fail | Accepted, and it is the most valuable finding here. `data-*` roles plus one 390px browser fixture test asserting relational invariants — now written out in Stage 6 |
| **P2(1)** the census arithmetic is wrong and misses 13 named sizes; there are eight modes, not seven | Accepted; re-ran both greps myself and Sol is right. 349 of 355 arbitrary are 10–13px, not 355; with the named ones it is 356 of 368. Corrected, and relabelled as a source census rather than screen evidence |
| **P2(2)** make the reusable doc a runnable prompt, not only a checklist | Accepted; see below |
| **P2(3)** several plan facts are only intentions | Half of it was already stale — the screenshots and measurements are committed now. The two that stood: "one screenful" had no acceptance criterion (Stage 5a now proposes one) and *"the cost of the general version is one stage: the doc"* was simply false (corrected above) |

**Two of Sol's findings were already answered by work it could not see**, which is worth recording
rather than claiming as agreement: it flagged that no `blocked` predicate exists and that
last-written / last-commit are missing, and the data table in Stage 5a says the same from the
captured payload. Two independent routes to one conclusion is a stronger reason to believe it than
either alone.

Sol's own recommended order and mine now differ in one place only: it would *"stop and reassess
before mechanically restyling every remaining tab"*. Adopted as written — Stage 7 is explicitly a
reassessment, not a queue.

### The Sol screens review, and the one finding that changes the landing surface

[260909c-dashboard-design-system-screens-review-sol-r1.md](260909c-dashboard-design-system-screens-review-sol-r1.md),
at `5b3efeb3`. No P0. Its verdict agrees with the plan's reframing and sharpens it:

> The dashboard is organised around data producers — sessions, transcripts, checkpoints, usage scans
> — while Greg arrives with three decisions … Box health and Readiness work because they lead with a
> verdict and subordinate the evidence. Usage, Overseer, and Recent messages foreground their
> evidence-gathering machinery.

**GLOBAL-01 is the finding that changes what gets built**, and it catches the plan about to repeat
the failure it had just diagnosed:

> Build it, but do not make it another block above the existing Sessions page. That would repeat the
> current failure: the useful summary becomes a preamble to 3,529px of roster.

So the landing surface **replaces** the Sessions page rather than prefacing it, with the roster and
the log as drill-ins, and three explicit regions: *needs you* (the first actionable question),
*blocked* (**never `0 blocked` unless it was actually measured**), and *progress* — which is *not*
`7 working`, because working is activity, and the question is whether anything moved.

**S2-01 landed on code I had written an hour earlier and was right.** `StatCard`'s first draft drew
a bare em-dash for any missing number. *"Without the explanatory state word, it conflates unknown,
absent, and failed."* The primitive now has three named absence states — `Unknown`, `Withheld`,
`Unavailable` — from a closed vocabulary, plus a fourth `stale` arm that keeps the number and wears
its age, because blanking an old-but-valid reading throws away the best information there is. That
is the honest-absence rule arriving inside the component written to enforce it, which is worth
recording rather than quietly fixing.

**DOC-01 corrected three sentences in the reusable doc**, and the third is the one worth naming:
*"every live number carries when it was taken"*, applied per tile rather than per group of readings
taken together, **produces exactly the Usage tab's wall of provenance.** A rule that fails when
applied naively needs to say so, and now does.

Its ranked three, adopted as the order of the remaining work: the landing surface as a true
action-first overview; Sessions rewritten around purpose, blocker and progress with the two constant
lines removed; Usage rebuilt from its typed epistemic states. It also names the **best single
existing-screen deletion** as those two constant lines — which is where I had independently landed
from the pixels, and it is a product call for Greg rather than mine.

### Stage 7+ — the remaining tabs: a reassessment, not a queue

Each with a before/after pair, the gates, and a Sol code review. Order decided after Stage 4's
ranking.

## Ownership: what was agreed, with whom, on 2026-09-09

Four sessions were messaged by name before any shared file was touched, and all four replied. The
agreements, so the next agent does not have to re-negotiate them:

| With | Agreed |
|---|---|
| `dashboard-tooltips` | **Their tooltips land on a tab first, my restyle after** — a restyle that moves prose into a card changes what an `Explain` is attached to. Their order: Recent messages → Queued ideas → Sessions/masthead → Overseer. **Usage limits, Readiness and Deploys are unclaimed by them and mine to take now** |
| `deploys-ui` | Deploys stays in the sweep; they message me when their rework lands and I do the visual pass **on top of it**, not underneath. They decline `StatCard` for their tab, with a reason I accept: the freshness header's facts are qualified sentences, not stats, and turning them into big numbers is the "punchier" move that file exists to warn against |
| `readiness-tab` | **Handed to me outright** — *"ReadinessPanel.tsx is finished and I'm stopping, so restyle it freely."* Their session has since ended; see § Readiness below for what they asked and my answer |
| `claude-agents-dashboard` | `ActionButtons.tsx` and the detail's action machinery stay theirs; **the narrow-width layout question in `App.tsx` is mine**. An extraction of shared shapes out of `ActionButtons.tsx` is welcome *after* Stages 5–6, on the condition that the copy tests move with the components and **no string is tidied on the way** — several are worded around what the code can and cannot know, and the awkward ones are awkward on purpose |

**And a correction I did not have: `SessionDetail.tsx` is owned by neither of us.** It went to
`dashboard-titles-descriptions-detail` for the same re-layout Stage 5 describes. To be agreed with
them, not with `claude-agents-dashboard`, and Stage 5 sequences behind them.

### Three things from those replies that change the work

- **`ui.tsx` moved under me while I was planning** (`ac48cb43`, merged here). `SectionHeading` now
  takes an optional `tip?: Tip`. So `StatCard` should take one too and pass it to `Explain` — every
  future stat then carries its own card for free, and `HealthPanel`'s tiles already source a `tip`
  from `health-view.ts` waiting for somewhere to put it.
- **`tests/fleet-tooltip-copy.test.ts` now fails any new `title=` attribute** in
  `tools/fleet/web/src/`. Deliberate — it is the hover-only regression. Do not edit the allow-list.
- **`deploys-client.ts` exports `localZone()`, `deployLocalWhen()`, `deployDays()`, `dayLabel()`** as
  shared vocabulary, encoding a rule worth keeping: *a clock time is never drawn without its zone
  label beside it.* Anything here needing a device-zone time takes them from there rather than
  writing a second one.

### And a design correction worth more than the layout it was about

I put the co-visible contradiction — the attention card and the detail describing one session
differently on one screen — as a layout problem to be solved by moving the detail up.
`claude-agents-dashboard`'s answer, which I accept:

> Moving the detail up so they are never co-visible would **hide the contradiction rather than
> resolve it**, and it would be worse than the current state, where at least you can see it.

They disagree because they have different clocks: the attention feed is the coordinator's
checkpoint, the detail is this server's snapshot, and both are honest. So the fix is that each says
which moment it describes. That is the same conclusion Fable reached from the other direction in
[260909b item 2](260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md#2-the-inboxs-judgement-about-this-session-becomes-section-1-of-its-detail)
— *two sources disagreeing, both named, is the honest form* — and it is the augmentation principle
again: **never hide that a decision was made, or who made it.** Stage 5 must not implement Fable's
item 1 in a way that quietly drops item 2.

Not mine at all: server files, `wire.ts`, `tools/overseer/**`, `src/web/**`.
