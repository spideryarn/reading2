---
reports: spya-ym9dum
ending: shipped
---
# "What's new" refreshes itself when there is a new version

`spya-ym9dum`, from Greg (admin; relayed by the Overseer as his own report), filed 2026-10-04 11:17
UTC from `/changelog#release-126`. This session did not write the Sentry status; the next feedback
sweep does.

> Could you set this page to somehow poll every 15 minutes or so, and if there's a new version, then
> refresh the page.

**Ending: Shipped.** It is on `dev` and not deployed. Plan:
[261005d](../plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md).

## What we did

- **The app now asks which build is live**, every 15 minutes while it is on screen, and each time
  it comes back to the foreground. The second matters more on an iPad: a sleeping app's timers do
  not run, so the check on waking is the one that usually finds the new version. The question is one
  tiny static file (`/build.json`); nothing signed in, no model, no cost.
- **If a different build is live and you are on "What's new", the page reloads itself.** You stay at
  the same address, `#release-126` included. Releases you had opened by hand close again.
- **It does not reload if that would lose something**: an unsent Chat or Remember message, a
  Feedback report you have started, an upload still going, or no connection. It tries again at the
  next check.
- **At most once per new build**, so a mix-up on the server cannot make the page blink.
- No other page reloads itself.

## What it does not do

The list on the page is compiled into the app, so "a new version" means "a new deploy". Notes
written for a release that has not been deployed yet do not appear until it is.

## Checked, and not

Unit tests for each rule above. A two-build check in WebKit with an iPad's user agent
(`scripts/check-two-builds.ts`): open the page on one build, swap the server to a second, wake the
page, and the copy that ends up running is the second. Not checked on a real iPad: the box cannot
imitate iOS putting an app to sleep. After the next deploy plus one more, leaving "What's new" open
on the iPad and coming back to it is the real test.
