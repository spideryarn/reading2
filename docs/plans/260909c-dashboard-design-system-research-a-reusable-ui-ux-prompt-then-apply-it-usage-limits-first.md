# A design system for the fleet dashboard: research, a reusable UI/UX prompt, then apply it

**Status as of 2026-09-09: Stage 1 in progress.** Screenshots and web research dispatched; the
reusable doc, Sol's read of the screens, and the restyle follow.

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

The two censuses that make the diagnosis concrete, both from `grep` over `tools/fleet/web/src/`:

- **Type.** `text-[12px]` ×156, `text-[13px]` ×149, `text-[11px]` ×41, `text-[10px]` ×3, and then
  one each of `17px` and `22px`. Two weights, `font-medium` ×85 and `font-semibold` ×49. So the
  whole page is drawn in a 3px band. **Nothing can be dominant, because nothing is bigger than
  anything else.** That is the mechanical cause of "hard to scan", and it is why the fix is not
  more colour.
- **Ink.** `text-ink-faint` ×177, `text-ink-soft` ×129, `text-ink` ×69. The *quietest* colour is the
  *most common* one, and the loud one is the rarest. **When the whisper is the majority voice,
  nothing is quiet** — the reader's eye has nothing to land on, so it lands on the accent colours
  instead, which are then spent on whatever happened to be coloured rather than on what matters.

So the work is: a **type and emphasis scale** on top of the palette that already exists, plus a
written statement of what each screen is for — and then applying both, starting where Greg pointed.

**The simpler option passed over:** restyle the Usage tab alone, no doc, no research, no scale.
Rejected because Greg asked for the general thing ("in general, I think we need a design system"),
because the same 3px band and the same faint-is-the-majority problem is on all seven tabs, and
because a one-tab fix would be re-litigated by the next agent who adds a tab. The cost of the
general version is one stage: the doc.

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

*Status: in progress.*

- [x] Capture the live GET routes once; stand up the fixture server on 127.0.0.1:8901.
- [x] Type and ink censuses (above).
- [ ] Screenshots of every tab at 1280 and 390, plus full-page at 390, plus the session detail
      (Sonnet subagent, read-only).
- [ ] Per-tab measurements: 390px `scrollHeight`, interactive-element count, distinct font sizes,
      distinct text colours, horizontal overflow.

### Stage 2 — what the field actually knows

*Status: in progress.*

- [ ] Sonnet web research over seven areas: scannability and visual hierarchy; status colour
      semantics and colour-blind safety; empty/unknown/stale/error states; tables versus cards on a
      phone; typographic scale and numeric data; progressive disclosure; operational-dashboard
      specifics. Conclusions with sources, and each rule specific enough to fail a design.

### Stage 3 — the reusable prompt doc

- [ ] Write `docs/reusable/<name>.md`: the questions to ask of a screen before touching it (Greg's,
      generalised), then the checklist the research yields. **Nothing Spideryarn-specific in it** —
      it goes in `docs/reusable/`, which is for notes meant to be carried elsewhere.
- [ ] One line in [docs/reusable/README.md](../reusable/README.md) under the right heading. A new
      doc and its index line need no approval (AGENTS.md § How we write docs here);
      `tests/doc-links.test.ts` must stay green.

### Stage 4 — Sol on the screens

- [ ] Hand GPT Sol the screenshots, the measurements, the reusable doc and Greg's three questions;
      ask his question per screen and for the ranked changes per tab.
- [ ] Sol reviews this plan, as the engineering-manager cadence requires, before any code.

### Stage 5 — the landing surface: Greg's three questions in one screenful

Dispatched into this plan by the Overseer on 2026-09-09, and it outranks the Usage restyle because
it is the thing Greg actually asked for. It absorbs
[260909b's ranked proposal](260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md#the-ranked-proposal)
items 1 and 2 (*on a phone the detail is the whole page*; *the detail should show what the inbox
knows*); that session stays idle.

- [ ] Say, per question, **what data already exists and what is missing** — named as missing, never
      invented.
- [ ] Design and build it.

### Stage 6 — Usage limits, the tab Greg named

- [ ] Restyle against the doc. Before/after pair at both widths in this plan.
- [ ] Every honest-absence state re-checked by name, not by eye.

### Stage 7+ — the remaining tabs, one stage each

Each with a before/after pair, the gates, and a Sol code review. Order decided after Stage 4's
ranking.

## Ownership and the live collisions

Mine now: `UsagePanel.tsx`, `UsageHistory.tsx`, `usage-history-series.ts`. Mine per tab as I reach
it, **by announcement**: `tailwind.css`, `ui.tsx`, `Dock.tsx`, `App.tsx`, `AttentionPanel.tsx` and
the other panels.

Live in the same files tonight, to be messaged **by name** before Stage 5 or 6 touches their tab:
`dashboard-tooltips` (tooltips across every panel), `deploys-ui` (`DeploysPanel.tsx`),
`readiness-tab` (`ReadinessPanel.tsx`), `claude-agents-dashboard` (`ActionButtons.tsx`, parts of
`SessionDetail.tsx`). The Overseer arbitrates a disagreement.

Not mine at all: server files, `wire.ts`, `tools/overseer/**`, `src/web/**`.
