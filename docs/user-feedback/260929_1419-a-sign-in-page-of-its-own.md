---
reports: spya-p6s5a4
ending: shipped
---
# A sign-in page of its own, signposted from the signed-out pages

Greg's own report (admin; provenance proved from the production row by
`scripts/feedback-reporter.ts`, exit 0), filed 2026-09-29 14:19 UTC from a trajectory view. It never
reached Sentry, so there is no issue to resolve.

> For the non-logged-in users, let's create a separate sign-in page and signpost to it at the top
> and bottom, and follow any best practices in making that nice and usable. We're currently
> emphasising Gmail, but we also allow email and password, and that should be apparent. And we
> need to somehow make it easy for people to both log in and register.
>
> And so then for the non-logged-in homepage, instead of having that sign-in button at the bottom,
> we'd have a sign-in button that takes you to the sign-in page.

**Shipped** on `dev` in 073ac151 and 7f7e7b46 (merged as e1edee101). `/login` is now the sign-in
page, in the marketing pages' look. It has a *Sign in | Create account* switch, with Google and the
email form both visible from the start, and *Show* on the password. The landing page's top bar,
hero and foot panel all link to it, and so does `/pricing`, so no page carries the form any more.
A deep link still returns you to the article after signing in. Plan, both GPT Sol reviews and the
browser check:
[261001m](../plans/261001m-a-sign-in-page-of-its-own-signposted-from-the-signed-out-pages.md).

Pushback, recorded in the plan rather than argued: this reverses Greg's own 2026-08-27 rule that
the form lives on the landing page. It was worth reversing, since the panel had already been a jump
away at the foot of the page since 2026-09-03.
