---
reports: spya-bumjmy, spya-ng89zf, spya-xgqv50, spya-xgn06m, spya-yvwpek, spya-d9xdhs
ending: shipped
---
# Bottom-bar spacing, Feedback in a circle, and four small Feedback fixes

Six reports from Greg (admin), read from the production `feedback` rows. None had a note, so his
Earlier tab showed them as Not shipped. Batched into one plan because they are small and two are the
same ask. The time in the file name is the newest of them.

> Let's add just a little bit of horizontal space between the icons in the bottom-bar when reading.

— spya-bumjmy, 2026-09-29

> Add a teeny bit more horizontal space between the buttons in the Reading view bottom-bar
> (especially when collapsed/without-labels).
>
> (I might have already asked this before, but I don't think it has been done yet)

— spya-ng89zf, 2026-09-29

> In the Reading view bottom-bar, move the Feedback icon all the way to the right, and perhaps wrap
> it in its own circle or something to show it's something a little different from the other modes.

— spya-xgqv50, 2026-09-30

> The Feedback and Logo get in the way at the top of /read/public . Take browser screenshots and
> you'll see what I mean. Use Fable to decide how best to resolve with technical review from GPT Sol.

— spya-xgn06m, 2026-09-05 (the logo half shipped in
[260929a](../plans/260929a-logo-beside-the-wordmark-beta-to-the-right-no-shelf-tagline.md); this is
the Feedback half. Fable is retired, so Opus's job here went to the plan and GPT Sol's reviews.)

> In the feedback dialog, remove the text that says "A rough note is worth far more than nothing"

— spya-yvwpek, 2026-09-30

> In Feedback dialog box, we have an Earlier tab. In those entries, can we include the exact
> timestamp and maybe a human-readable `3d ago` or `3h ago`?
>
> And in fact, make a note in a relevant doc that whenever we show a date we should include that
> kind of human-readable `... ago` version, as well as a timestamp, even if only in a tooltip.

— spya-d9xdhs, 2026-09-30

**Ending: Shipped.** On `dev` in 305e8db4. Not deployed. The Sentry status writes are the next
sweep's.

What we did ([261001j](../plans/261001j-bottom-bar-spacing-feedback-circle-nav-feedback-earlier-timestamps.md)):

- **Spacing.** Twice the gap between the bar's loose controls, more padding on the icon-only bar
  (the one a band mode puts you on), and a 44px button floor on a phone. One trade, measured: the
  icon-only bar's padding is the only one that grew. Widening the half-labelled bar's padding too
  made a 1280px laptop lose the words Commands, Comments, Metadata and Experimental, so it was put
  back.
- **Feedback** sits at the far right of the bar, with its icon in a thin circle.
- **Signed in on `/features`, `/pricing`, `/read/public`** and the public-sharing page, Feedback is
  the nav's last entry (icon only on a phone), and the corner button that covered the nav's last
  link is gone from those pages.
- **The "rough note" sentence** is gone.
- **Earlier** dates each report as the exact time plus `3d ago`. Past 30 days only the exact time
  shows, because the shared helper gives no relative form after a month.
- **The doc rule** is in [design-css-overview.md § Dates](../project/design-css-overview.md#dates),
  quoting Greg. The Overseer approved committing it. It names the one exception (nothing relative
  past 30 days). A coarser `2mo ago` would make the rule hold everywhere, if Greg wants that.
