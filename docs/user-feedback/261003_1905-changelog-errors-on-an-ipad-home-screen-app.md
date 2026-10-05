---
reports: spya-u6uba0
ending: shipped
---
# The changelog errors on an iPad, opened from the home-screen icon

Report `spya-u6uba0` (SPIDERYARN-READING2-BK), a problem, from Greg (admin, production row proven),
2026-10-03 19:05 UTC, from `/changelog`, relayed by the Overseer (queue item `qi-3kdqwzmz`):

> When I open the change log page on an iPad, it gives me an error. I don't know why. It only seems
> to be on an iPad. And if I, so I'm using, I've done that thing where you share it to the home
> screen, so it's got an icon on the home screen. I don't know if that's related. I haven't tried it
> in a browser. If you need me to, I can do that, but maybe you can see the problem yourself.

**Ending: Shipped**, on `dev`, not deployed. Plan:
[261003m](../plans/261003m-a-home-screen-app-reloads-itself-when-a-page-s-code-has-moved.md).
Postmortem:
[261003f](../postmortems/261003f-a-home-screen-app-outlives-every-deploy-and-has-no-reload-button.md).

## What it was

The home-screen icon is related, and no, you do not need to try it in Safari. The changelog page
itself is fine on an iPad. The app opened from the icon is never reloaded — iOS wakes the same copy
for days — and each deploy removes the files an older copy would ask for. The changelog's code is
fetched only when you go there, so an old copy asked for a file that was gone and showed *"Part of
Spideryarn didn't arrive … [chunk]"*. Its advice was to reload, and a home-screen app has no reload
button. Reproduced in WebKit with two real builds.

## What changed

- **An old copy now reloads itself** when a page's code is missing and the server says a newer
  build is live. You see the spinner a moment longer, then the page. At most once per new build, so
  it cannot loop. This covers `/changelog`, `/help`, `/design` and `/admin`.
- **The error message has a Reload button**, for when that cannot help, and no longer says "tab".

## What is not settled, and one question for you

**Which message did you see?** There are two error screens, and they end differently:

- *"Part of Spideryarn didn't arrive … **[chunk]**"* — this is the one fixed here. Sentry recorded
  it on your account on 1 October and twice on the morning of the 3rd.
- *"… reloading will probably hit it again. **[render]**"* — a different crash, and **not fixed**.
  Sentry recorded one on your account 78 seconds before this report (`SPIDERYARN-READING2-BJ`), on
  a copy of the app eleven hours old. It could not be reproduced, and Sentry does not say which
  page it was on. An old copy opening the changelog gave `[chunk]` every time it was tried.

If it was `[chunk]`, this report is done. If it was `[render]`, the queue entry for it is the real
one and should move up. Either way the entry exists; the ending here is *shipped* because the
failure that could be reproduced is fixed and the rest is queued, not because both are closed.

Two more things:

- **The app now reloads without asking** in one case: a page's code is missing and a different
  build is live. Nothing is lost, because it happens before the page has appeared. Say if you would
  rather it asked.
- **It has not been tried on a real iPad.** The check was WebKit on the box, pretending to be an
  iPad. That cannot imitate iOS putting the app to sleep and waking it. After the next deploy plus
  one more, opening *What's new* from the home-screen app is the real test.

## Deferred, each in the Overseer's queue

- `qi-wxt4gtyn` — notice a deploy when the app wakes, and take the next navigation as a full page load, so nothing
  has to fail first.
- `qi-58e7v32s` — the `[render]` crash above, `SPIDERYARN-READING2-BJ`.

Both are proposals: nothing starts on either until you authorise it.

## 2026-10-05: both looked at

Authorised on 2026-10-04 and done in
[261005d](../plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md), on `dev`, not
deployed.

- **`qi-58e7v32s`, the `[render]` crash: found and fixed.** An older copy of the app crashed on the
  Metadata page of any article once the server started reporting a pipeline stage (`relations`) that
  the older copy had no icon for. The mechanism is reproduced by a test. That it is what Sentry
  recorded is strongly supported (both crashes are on copies built before that stage, both after
  the deploy that added it) but Sentry kept no address, so it is not proven, and which screen you
  were looking at when you wrote this report is still not known.
- **`qi-wxt4gtyn`, noticing a deploy on waking: half built.** The app now notices, and "What's new"
  reloads itself. Making the next navigation a full page load was **not** built: it would have
  thrown away unsent Chat text and Feedback drafts and interrupted uploads. Whether to do it
  properly is a question for you, in the plan.
