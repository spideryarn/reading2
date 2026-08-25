# Their design system — tokens, icons, loading, and one cautionary tale

The visual layer, minus typography, which has [its own page](typography.md). Most of this is already
settled here; what follows is the parts still worth taking and one clear example of where the effort
went wrong.

Reference docs: `docs/reference/DESIGN_COLORS_FONTS.md`, `DESIGN_OVERVIEW.md`, `DESIGN_ICONS.md`,
`DESIGN_LOADING.md`, `DESIGN_LOGO.md`, `DESIGN_SHADCN_UI_REFERENCE.md`, `DESIGN_COLLAPSIBLE.md`,
`DESIGN_TOOLTIPS.md`.

## Tokens and colour

OKLCH throughout, with the full shadcn semantic set — primary, secondary, muted, accent,
destructive, sidebar, chart-*. Brand orange `#DB8A45`. This is the part we already took, and taking
it was almost free precisely because it was a shadcn project
([overview.md § The reversal](overview.md#the-reversal-tailwind-and-shadcn-2026-08-25)).

Their font stack is worth noting as a *pattern* rather than for the specific faces: Geist Sans for
body, Geist Mono for technical text and ids, and **Trebuchet MS scoped to the logo only**. Keeping a
brand face out of the reading surface is the right instinct — the wordmark can have personality, the
prose should not.

## Icons

Phosphor, with a written scale — 12/14/16/20/24/32px — and weight rules by context: regular by
default, bold for alerts, filled for active navigation state.

We went to Lucide for reasons of our own ([icons.md](../icons.md)), so the library doesn't transfer.
**The written scale does.** A short table saying which sizes and which weights are allowed is worth
having, because without one every new component picks a slightly different number and the drift is
invisible until you see two icons side by side. Ours are stated in [icons.md](../icons.md); keep it
that way.

## Loading states

`DESIGN_LOADING.md` is short and genuinely good. Two rules, quoted:

> Under 1 second: No loading indicator needed (distracting)
> 1-2 seconds: Simple spinner with minimal text
> 2-10 seconds: Spinner with descriptive text explaining the action
> Over 10 seconds: Consider progress bars or skeleton screens instead

and:

> Be specific: 'Verifying login' instead of 'Loading'
> Use action verbs: 'Processing document', 'Generating summary'
> Set expectations: 'This may take a few moments'
> Avoid generic: Replace 'Loading...' with context-specific messages

**Both are worth adopting outright.** The under-one-second rule is the one people get wrong most
often — a spinner that flashes for 200ms is worse than nothing, because the flicker reads as
breakage. And the naming rule pays for itself the moment something is slow: *"Extracting with
Readability"* tells the reader what is happening and therefore what might fail, where "Loading…"
tells them only that they are waiting.

We have one place this matters today — the pending state on a comment
([comments.md](../comments.md)) — and one arriving, the library card for an article still being
processed. Both should name the step.

Skeleton screens are listed as a future enhancement and were never built. Skip them; a named spinner
is most of the value.

## The live design reference page

`app/design/page.tsx` — 378 lines rendering every button variant, spinner size, alert and colour
swatch on one route.

**Worth copying, cheaply.** It costs almost nothing to maintain and it catches the class of
regression that tests can't see: a token change that quietly ruins a variant nobody looked at. We
now have generated shadcn components in
[`src/web/components/ui/`](../../../src/web/components/ui/) and a token file they all depend on, so
the failure mode exists here now. One route rendering our primitives against the dark ground would
have caught at least one of the bugs already recorded in
[web-client.md](../web-client.md#what-tailwind-and-shadcn-assume-instead-and-the-bug-it-caused).

Pair it with [browser-testing.md](../browser-testing.md), which already says how to look at this app
without being lied to by colour and sticky positioning.

## The logo playground

`app/design/logoplay/` is **2,807 lines**, plus `styles/logo-animations.css` (1,911 lines) and an
animation registry in `lib/animations/`, for 15 CSS hover animations on the wordmark — highlight
sweep, web threading, glossary builder, and so on. There is a single-source-of-truth registry so the
header and the playground stay in sync.

It is well made. It is also the clearest example of scope creep on a cosmetic feature in that repo:
a registry, a playground route and ~4,700 lines of surface, with no functional payoff, in an app
whose mobile layout was never finished and whose prompt caching was never built.

Greg's call in 2026-08-24 was already "too fancy for now", and that stands. The class names are
preserved in [`styles/tokens.css`](../../../styles/tokens.css) so the CSS could be dropped in as one
file if we ever want it — **but if we do, pick one animation and hand-write it.** The registry and
the playground are the expensive part, and they exist to manage a problem (fifteen variants) that
only exists because there are fifteen variants.

## Accessibility and motion

Thinner than the research docs imply:

- **`prefers-reduced-motion` is handled in exactly one place** in `app/globals.css`, disabling
  `.panel-transition` and `.transition-all`. It does **not** cover the fifteen keyframe logo
  animations or any other bespoke motion. So the guard exists, is documented, and misses most of the
  motion in the app.
- **Focus-visible** is one CSS rule, not a systematic treatment.

The lesson is specific and cheap to act on: **write the motion guard once, globally, before there is
any motion to guard.** One rule, from the start:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

This matters more here than it did there, because our zoom transitions are motion the reader
experiences constantly rather than a hover flourish they can avoid
([granularity-zoom.md § Interaction](../granularity-zoom.md#interaction)). A reader who has asked
their operating system for less motion has asked for it from us too.

Ours belongs in [`tailwind.css`](../../../src/web/tailwind.css), in a named layer, for the reasons
[design-css-overview.md](../design-css-overview.md) sets out.

## The shadcn migration doc

`DESIGN_SHADCN_UI_REFERENCE.md` is a migration *plan* — checklists, tiers, `npx shadcn add`
commands — ending with "Implementation 📋 Awaiting Stage 2 execution". It doesn't record what
happened.

Ours does: [shadcn-migration.md](../../plans/shadcn-migration.md), including an honest assessment
and a list of predictions that turned out wrong. That is the more useful artefact, and the
difference between the two is exactly the difference between a plan and a record.

## See also

- [overview.md](overview.md) — the map to that codebase
- [typography.md](typography.md) — the reading column, which is the part that has to be right
- [../design-css-overview.md](../design-css-overview.md) — our stylesheets and what owns what
- [../icons.md](../icons.md) — Lucide, the one stroke weight, and the spinner recipe
- [../browser-testing.md](../browser-testing.md) — how to look at this app without being misled
- [../../plans/shadcn-migration.md](../../plans/shadcn-migration.md) — our migration, written down afterwards
