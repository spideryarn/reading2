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

The home-screen icon is the cause, and no, you do not need to try it in Safari. The changelog page
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

## To know

- **The app now reloads without asking** in that one case. Nothing is lost by it on these pages.
  Say if you would rather it asked.
- **One error is not explained.** 78 seconds before this report Sentry recorded a different crash
  on your account (`SPIDERYARN-READING2-BJ`, the whole-app `[render]` message) on a copy eleven
  hours old. It could not be reproduced or tied to `/changelog`. It has its own queue entry, as does
  the wider fix: noticing a deploy when the app wakes, before anything breaks.
