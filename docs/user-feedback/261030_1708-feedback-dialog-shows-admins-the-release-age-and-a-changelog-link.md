---
reports: spya-hgpctx
ending: shipped
---
# The Feedback dialog shows an admin how old the release is, and links the changelog

Report #742, `spya-hgpctx` (Sentry SPIDERYARN-READING2-QC), Greg (admin, `feedback-reporter.ts`
exit 0), a suggestion, 2026-10-30 17:08 UTC, from the Search mode of `nagel-bat`. No addenda when
re-read before acting and before this note. Session `fbhgpctx-feedback-dialog-release-age`.

> In the feedback dialogue, for admins: at the top, can we include a link to the changelog and some
> kind of indication of when the most recent release came out? You know, three hours ago, six hours
> ago, whatever.

**Ending: Shipped** — on `dev`, not deployed.

What we did: under the dialog's title, for an admin only, a small faint line —
*"Released 3 hours ago · Changelog"* — with the link opening `/changelog` in a new tab, so the
draft and the article stay put. The time is the release's build time, the same instant `/changelog`
dates that release by, so the two agree; no new source and no new request. If the page's deploy
watcher has already seen a newer build live, that one is dated and the line adds *"(this tab is
older — reload for it)"* (or names a rollback). Hover gives the exact time and the commit. The line
sits below the head so Close stays the first thing focused.

Plan, and what GPT Sol's two reviews changed:
[261030d](../plans/261030d-feedback-dialog-shows-admins-the-release-age-and-a-changelog-link.md).
Browser-checked on the dev server (admin sees it, a reader does not, fits at 375px, Close focused).
