---
reports: spya-j8xe8w
ending: shipped
---
# The Feedback dialog's release line moves onto the tab row

Report #744, `spya-j8xe8w`, Greg (admin, `feedback-reporter.ts` exit 0), a suggestion,
2026-10-31 09:21 UTC, from the shelf. No addenda when re-read before acting and before this note.
Session `fbj8xe8w-release-line-on-links-row`.

> I like that the feedback dialogue now says, you know, released two hours ago and provides a link
> to the changelog. Can we move that onto the same row as right earlier and needs a decision so that
> it doesn't use up vertical space?

**Ending: Shipped** — on `dev`, not deployed.

What we did: the admin's *"Released 2 hours ago · Changelog"* line (from `spya-hgpctx`,
[its note](261030_1708-feedback-dialog-shows-admins-the-release-age-and-a-changelog-link.md)) no
longer has a row of its own. It sits at the far end of the Write · Earlier · Needs a decision row,
beside the tabs rather than among them (a link is not a tab, for a screen reader). Where the
dialog is narrow — a phone, or any window under 1024px — it says *"2h ago · Changelog"*, because
the long form wrapped to three lines on a phone and made the row taller than the line it replaced.
Close is still what the dialog focuses first; the hover and screen-reader detail are unchanged.

Plan, and what the browser check and GPT Sol's two code reviews changed:
[261031a](../plans/261031a-feedback-dialog-release-line-on-the-tab-row.md). Browser-checked at
375px and 1280px: the row is the tabs' own height at both, with the long stale-tab wording too.
