---
reports: spya-yf6vmy
ending: shipped
---
# A spinner while Needs a decision loads

Report `spya-yf6vmy` (#669), Greg (admin, provenance proved by `feedback-reporter.ts`), filed from
the Feedback dialog on `/changelog`:

> In this feedback dialog, there's a bit at the top right that says needs a decision.
> Interestingly, it seems to appear a few seconds after the dialog opens. It's not a huge deal, but
> can we add a loading spinner there to indicate that something is happening?
>
> And perhaps a minimal update to our design system docs or whatever that anytime something is
> happening in the background that hasn't finished yet there should be a loading spinner (perhaps
> with tooltip).
>
> — Greg, 2026-10-21 15:48 UTC

**Shipped**, to `dev`, alongside plan
[261021h](../plans/261021h-agent-questions-reach-needs-a-decision-without-a-deploy.md), which was
changing the same control.

- The *Needs a decision* shortcut is now drawn as soon as the dialog opens, with no number. If the
  read takes longer than 600ms, a spinner sits where the number goes, with the tooltip "Looking for
  questions waiting on you…". The number replaces it when the read lands. If the read fails, the
  shortcut goes, as before.
- The rule is in [loading-spinner.md § Anything still happening gets one](../project/loading-spinner.md#anything-still-happening-gets-one),
  under the house's 600ms rule, so a fast read still shows no flicker.
- Test: `tests/feedback-dialog.test.tsx` § "draws the shortcut at once while its count loads".
