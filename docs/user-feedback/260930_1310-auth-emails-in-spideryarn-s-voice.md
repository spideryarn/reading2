---
reports: spya-muymup
ending: shipped
---
# Auth emails in Spideryarn's voice

[SPIDERYARN-READING2-6S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6S), a suggestion
from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from Trajectory on
`pmc13013618-spya-uekgh6`. The time in the file name is when this session picked the report up. It
had no Sentry access and the report text came in the brief. The
header above was added by the feedback sweep on 2026-09-30, from the issue's `report_id` tag.

> The auth emails still use Supabase's default wording. "Reset your password" and the sign-up
> confirmation are unbranded boilerplate. Rewrite them in Spideryarn's voice and using Spideryarn's
> branding. Keep things simple and reliable. Run spikes.

**Ending: Shipped** to `dev`, and **not yet live**. The emails change only when the Overseer or Greg
runs `npx tsx scripts/supabase-auth-config.ts templates`, a write to the hosted Supabase project's
configuration that this session was not allowed to make. Resolve 6S; the next feedback sweep does
the Sentry status write.

What changed:

- **The sign-up confirmation** is now "Confirm your email for Spideryarn": the dark page, the orange
  spider and wordmark, one orange button, and a line saying a reply reaches a person.
- **The password-reset email** is now "Continue to Spideryarn", in the same layout. It says
  "continue", not "choose a new password" or even "sign in", because **the app cannot reset a
  password today**:
  there is no "Forgot password?" link, no screen to set a new one, and a reset sent from the Supabase
  dashboard lands on a link our sign-in code refuses. That gap was there before this change. Building
  the real reset flow is the plan's first deferred item.
- Spiked end to end on a throwaway local Supabase: a real sign-up confirmation and a real reset both
  arrived with our words, and both links signed in. Screenshots are linked from the plan.

Before it counts as live: apply the templates, check Resend's click tracking is off, and send one of
each. The steps are in the plan's § Applying it to production.

Plan, both GPT Sol reviews, the spike and the screenshots:
[260930h-auth-emails-in-spideryarn-s-voice.md](../plans/260930h-auth-emails-in-spideryarn-s-voice.md).
