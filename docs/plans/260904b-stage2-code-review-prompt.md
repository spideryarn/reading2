# Review the built Stage 2 — the pricing page redesign

The code review after building, which this repo weights higher than a plan review.

Plan: `docs/plans/260904b-pricing-page-and-public-showcase.md`, § "What the research said" and
§ "Stage 2". Your earlier reviews are
`docs/plans/260904b-pricing-page-and-public-showcase-review-sol.md` (the plan) and
`docs/plans/260904b-stage1-code-review-sol.md` (stage 1, all six findings fixed and committed).

The scoped diff is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/32ac35d1-d07c-4611-81e5-f1113e41b6a9/scratchpad/stage2.diff`.

Read at least: `src/web/PlanCards.tsx`, `src/web/PricingPage.tsx`, `src/web/SiteBits.tsx`,
`src/web/SiteFooter.tsx`, `src/web/BillingSection.tsx`, `src/web/FeaturesPage.tsx`,
`src/web/LandingPage.tsx`, `src/web/styles.css` (the `§ the site` block at the end),
`tests/plans-match-tiers.test.ts`, `tests/pricing-page-current-plan.test.tsx`,
`tests/site-footer.test.tsx`, `docs/project/marketing-pages.md`, `docs/project/positioning.md`.

## What changed

`/pricing` was a bare `<main class="max-w-3xl">` with a *← Back* link and no nav; its content column
started at x=360 where `/` and `/features` start at x=168, and the `--site-*` custom properties are
declared on `.site` so `site-panel` was not even available there. It now carries `.site`, a
`SiteNav here="pricing"` (a third `here` value), a hero, and `SiteFooter variant="marketing"`.

`PlanCards` went from a three-row `<table>` to three cards, with the Reader card raised via an
opt-in `recommended` prop. `/`, `/features` and `/pricing` render `WebsitePlans`; `/profile` renders
`PlanCards` from `summary.offers` and declines `recommended`. The four *How it works* paragraphs
were folded into a seven-question FAQ. `styles.css` now hangs the `--site-*` tokens and the margin
reset off `.plan-cards` as well as `.site`, so the cards work on `/profile`, which has no `.site`
ancestor.

## What I want you to attack

1. **The `styles.css` change is the one I most distrust.** Widening where `--site-*` tokens and the
   margin reset apply — adding `.plan-cards` alongside `.site` — touches a block whose header says
   these values must not be lifted into `tokens.css` and that the site's surfaces are staged
   deliberately. Does hanging them off a second selector leak the marketing language into the app
   shell, and specifically: does the margin reset now apply to anything on `/profile` it should not?
   Is there a narrower way to get the cards working on `/profile`?
2. **`SiteNav`'s *Sign in* anchor.** It was `#sign-in` on `/` and `/#sign-in` elsewhere. Now
   `/pricing` has its own `#sign-in` panel, and the logic changed so the anchor is `#sign-in`
   everywhere except `/features`. Verify that is right from every page that mounts `SiteNav`, and
   that no page can render a link to an anchor it does not contain — that failure was found in
   review once already and it is a link that visibly does nothing.
3. **The no-request guarantee, again.** `tests/pricing-page-current-plan.test.tsx` asserts a
   signed-out `/pricing` asks for no URLs at all. The page grew a hero, a nav, a footer and an FAQ.
   Confirm it still holds and that the test can still see a regression.
4. **The FAQ copy against the code.** This repo's rule is that a claim on these pages is checked
   against the code, never against a doc about the code — it once said "six diagrams" when there
   were four. The build already caught one error of mine this way: re-pasting a URL DOES cost a
   second article, while *Refresh from source* on something already on the shelf is FREE, because a
   slot is reserved only when the request carries a URL or an upload and settled only on a `done`
   ending. Check every factual claim in the FAQ and on the cards against
   `src/billing/admission.ts`, `src/store/pg-billing.ts`, `src/billing/tiers.ts` and
   `src/messages.ts`. Name any sentence that is false or misleading.
5. **`recommended` as an opt-in prop.** Is a tier id the right shape, and what happens if it names a
   tier not in the list, or if `/profile`'s offers ever include it? Should the marketing pages and
   `/profile` really differ here?
6. **Accessibility of the new tooltip and the cards.** The tooltip trigger is a `<button>` and was
   verified to open on `Tab`/`Escape` and on `tap()` in a touch context. Look for what that check
   would miss. Also: are the cards' headings a sensible document outline now that the page has an
   `h1`, and does the FAQ use a structure a screen reader can navigate?
7. **Anything the diff breaks that the tests do not cover**, and any claim in my plan's stage-2
   section that is not true of the code.

Rank by severity. Be concrete, say plainly where the implementation is wrong rather than merely
different from your taste, and run a test file yourself — a finding you reproduced outranks one you
reasoned to.
