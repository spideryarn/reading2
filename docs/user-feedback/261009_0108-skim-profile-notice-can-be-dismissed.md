---
reports: spya-ud2w92
ending: shipped
---
# Skim's "planned before your profile" notice can be dismissed

`spya-ud2w92` (#502), filed as a suggestion by Greg (admin; `feedback-reporter.ts` exit 0 on the
production row), 2026-10-09 01:08 UTC, from Skim on `arxiv-1706-03762-spya-wyt7j0`. Sentry
`SPIDERYARN-READING2-FD`. Overseer queue item `qi-rpfba2td`. This session has no Sentry sign-in and
did not write the Sentry status; the next feedback sweep does.

> Sometimes the mode shows a message saying "This route was planned before your profile said what
> it says now."
>
> I think that's helpful, but there should be a way to dismiss it if I decide that I actually don't
> care and I don't want to plan it again.

**Ending: Shipped.** It is on `dev` and not deployed.

What we did, in [261009i](../plans/261009i-skim-profile-notice-can-be-dismissed.md):

- **The banner has an ×**, on the profile reason only. The "Quotes, Ideas, or outline have changed"
  banner keeps no ×, because a route over moved Quotes can point at passages that are gone.
- **The dismissal is stored, with its time**, on the article: two columns on `articles`. It holds
  for that route under the profile you have now, so re-planning, or changing your profile again,
  brings the notice back.
- **One shared dismiss was considered and not built**: no other mode shows this notice as a banner.
  The rest say it with the small profile icon, and Illustrated's grey sentence was left as it is.
  The plan gives the reasons.
