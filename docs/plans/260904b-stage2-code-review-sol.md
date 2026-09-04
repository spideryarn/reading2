Not ready to approve. I found one P1, four P2s, and two smaller verification/documentation gaps.

## Findings

1. **P1 — “Sign in” is a dead link for signed-in readers. Reproduced.**

   [SiteBits.tsx:141](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/SiteBits.tsx:141) chooses the destination solely from `here`, but both relevant pages are also mounted signed in:

   - Signed-in `/pricing` renders `href="#sign-in"`, while the target exists only in `PlansForAStranger` at [PricingPage.tsx:413](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/PricingPage.tsx:413).
   - Signed-in `/features` renders `href="/#sign-in"`, but `/` renders the shelf for an authenticated reader, with no such anchor. The signed-in routes are visible at [App.tsx:494](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/App.tsx:494).

   I mounted signed-in `PricingPage` in a temporary Vitest test and asserted that the nav must not point at an absent fragment. It failed with `href === "#sign-in"`.

   The three signed-out cases are correct. `SiteNav` needs authentication context and should omit or replace “Sign in” when authenticated; add tests for both signed-in pages.

2. **P2 — several pricing sentences overstate what the code guarantees.**

   - **“You are charged in your own currency” is false outside USD, GBP and EUR.** Those are the only currencies advertised at [PlanCards.tsx:212](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/PlanCards.tsx:212), and checkout can only select currencies present on the tier. Someone using AUD, CAD or JPY cannot be charged in their own currency. “Checkout selects among USD, GBP and EUR for your location” would be accurate. The rest of the sentence—final amount, tax included—is supported by the inclusive Stripe price setup.

   - **“On a paid plan until your allowance starts again” is false for a subscription scheduled to end.** At period end it falls back to the lifetime Free entitlement; the lifetime query counts all successful ingests, including paid-period ones, at [pg-billing.ts:255](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/store/pg-billing.ts:255). A subscriber already over three receives no fresh allowance. Qualify this as “until the next billing period, unless the plan ends first.”

   - **“You pay for the articles you add” suggests per-article billing.** The actual product is a fixed monthly subscription with a capped allowance. The cards partly correct that impression, but the hero at [PricingPage.tsx:162](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/PricingPage.tsx:162) should say that plans are based on articles added.

   - **“A paywall … costs you nothing” is too broad.** The code rejects an extraction that produces no blocks; it does not identify paywalls as such. A soft paywall or teaser that produces usable blocks can finish `done` and therefore be charged. Say “a paywall that leaves no readable article.”

   The card prices, quotas, lifetime-Free rule, re-paste/refresh distinction, cancellation location, and “reading is never gated” claim otherwise agree with the billing path.

3. **P2 — recommendation is attached to the route, not to whether the reader is choosing.**

   `WebsitePlans` always supplies `"reader"` at [PlanCards.tsx:257](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/PlanCards.tsx:257). Consequently, a signed-in Researcher visiting `/pricing` sees Reader—the downgrade they cannot currently buy—labelled “Recommended.”

   Meanwhile `/profile` omits the recommendation even though it only shows the offer cards when `canCheckout` is true, generally to Free or lapsed readers who are actually choosing, at [BillingSection.tsx:180](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/BillingSection.tsx:180). The plan’s explanation that `/profile`’s reader “has already chosen” is therefore backwards for the state in which those cards render.

   A tier ID is a reasonable identity, and an absent ID currently degrades safely by raising nothing. But `string` also means a typo silently removes the recommendation. Make the choice contextual and either derive/constrain the ID or fail loudly when a supplied recommendation is absent.

4. **P2 — `/pricing` skips directly from `h1` to card `h3`s.**

   The page’s `h1` is followed immediately by `PlanCards`; each plan title is fixed as `h3` at [PlanCards.tsx:472](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/PlanCards.tsx:472). Landing, Features and Profile provide an enclosing `h2`; Pricing does not.

   Add a “Plans” `h2`—visually hidden if necessary—before the cards, or make the shared component’s heading level contextual. The FAQ itself is sound: one `h2`, question `h3`s, and always-visible answers form a navigable outline.

5. **P2 — `/profile` exposes multiple buttons with the same accessible name.**

   Every dynamic offer uses the visible label `"Upgrade"` at [BillingSection.tsx:198](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/BillingSection.tsx:198). A screen-reader button list cannot distinguish which plan each button buys. Use “Upgrade to Reader/Researcher,” visibly or via `aria-label`.

   For the tooltip itself, `Tooltip` supplies the tooltip role/description relationship and focus/Escape behavior. The browser checks do not cover VoiceOver/TalkBack activation or assert the accessible relationship, but I found no definite tooltip implementation defect beyond that coverage gap.

6. **P3 — the CSS implementation is safe, but its surrounding comments are now false.**

   The feared CSS leak does not occur:

   - Custom properties on `.plan-cards` inherit only into that wrapper’s descendants.
   - The reset at [styles.css:13814](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/styles.css:13814) cannot touch `/profile` siblings or outer shell content.
   - `PlanCards` accepts no arbitrary children, so the reset’s scope is effectively closed.
   - The tooltip portal is outside the wrapper and has its own paragraph spacing.

   This is already narrower than putting `.site` on Profile. I would keep it. Splitting out the unused `--site-lift` variable would be cosmetic.

   However, the block header still says “LandingPage and FeaturesPage—and nothing else” at [styles.css:13434](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/web/styles.css:13434). `SiteFooter` still documents six pages and two marketing pages despite its test correctly expecting seven. `marketing-pages.md` also says “these two pages” at [marketing-pages.md:28](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/docs/project/marketing-pages.md:28).

7. **P3 — final screenshot evidence is not recorded.**

   Stage 2 calls for final 1440 and 390 captures. The log records a 390px iframe check of the design spike, but no final 1440 capture or final-page evidence. That may exist outside the diff, but the supplied evidence does not substantiate this completion claim.

## Verification

- Focused Vitest run: **50 passed, 2 skipped** across the four requested suites. The two skipped assertions were the real-Postgres parts of `plans-match-tiers.test.ts`; this sandbox could not reach Postgres.
- Signed-in dead-anchor defect: **reproduced in a temporary Vitest test**.
- Signed-out no-request assertion: **passed**. It still catches ordinary component `fetch` calls and calls into the mocked auth boundary. As its header now admits, it cannot catch networking introduced inside the real Supabase module or non-`fetch` resource loading. The new nav, hero, FAQ and footer currently introduce neither.
- `npm run typecheck` could not run because the sandbox refused `tsx`’s `/tmp` IPC socket with `EPERM`; this was an environment failure, not a TypeScript result.
- No source files were changed.