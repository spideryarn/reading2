---
reports: spya-tfsjvq
ending: shipped
comment: Shipped: the top bar now starts below the clock wherever the phone draws one over it, and is still flush at the top where nothing does. Certain on the home screen; please check a Safari tab after the deploy.
---
# The signed-out bar under the clock on an iPhone

Report `spya-tfsjvq` (#708), from Greg (`feedback-reporter.ts` exit 0, no addenda when re-read
before this note), sent from the signed-out landing page `https://www.spideryarn.com/` on
2026-10-25, with a screenshot. Session `fbtfsjvq-landing-nav-under-the-clock`.

> The links at the top of the screen is blocked when I'm using it on an iPhone in a web browser.
>
> The tricky part is that if I have shared it to my home screen, then I want that stuff to be at
> the top Because there won't be any of the iPhone OS UI. Is there a best of both worlds?

**Ending: Shipped.** On `dev`, not deployed.

## What we did

[Plan 261026a](../plans/261026a-signed-out-nav-below-the-clock-on-an-iphone.md), with GPT Sol
reviews of the plan and the code;
[postmortem 261026a](../postmortems/261026a-a-fix-on-one-caller-of-a-shared-bar-leaves-the-others-broken.md).

- **What blocked them:** the screenshot shows the clock and battery drawn over "Spideryarn Reading"
  and "Sign in". The page is laid out under the status bar (`viewport-fit=cover`), and the
  signed-out bar only added the status bar's height (`--safe-top`) on the document pages (Privacy,
  Contact…). The landing page, Features, Pricing, Sign in, the public shelf and the public-sharing
  page did not.
- **The best of both worlds is that inset itself:** it is the clock's height where iOS draws
  something over the page, and zero where nothing is. So the bar stays at the very top in every
  case, and moves down only by what covers it. All seven pages now share the one rule in
  `styles/site.css`.
- **Checked:** `tests/site-nav-safe-area.test.ts` (red first), and `scripts/safe-area-check.ts
  --site`, which forces a 59px inset and failed 6 of 7 pages before the fix, passes 7 of 7 after,
  and fails all 7 under `--break`. A Sonnet subagent's iPhone 15 Pro emulation showed a 59px strip
  of the bar's own background with the links below it, at rest and scrolled, and the bar flush at
  the top with no inset.
- **What emulation cannot show:** the real status bar, Safari's toolbars, and what iOS actually
  reports as the inset. On the home screen it is about 59px by construction, so that half is
  certain. In a Safari tab it is unproven: a portrait tab may report zero, and then this change
  does nothing there.

**To try on the phone after the deploy:** the landing page in a Safari tab and from the home
screen, at the top and scrolled down. If the tab still has the bar under the clock, open any
article with `?probe=1` in that tab and send its trace with a new report: it records `--safe-top`.
A zero there turns it into a product choice (a fallback gap just for Safari, or giving up the
edge-to-edge page), which comes to you as a question rather than a guess.
