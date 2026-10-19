---
reports: spya-qspg5a
ending: shipped
comment: Reopening an article now lands on the paragraph you were reading, on this device, and no longer slips back a section each time.
---
# Reopen lands on the paragraph you were reading

`spya-qspg5a` (#606, suggestion, Sentry event `1cd428b0e76f4ccdab785f39db5779cb`), from Greg (admin;
`feedback-reporter.ts` exit 0 on the production row). Filed 2026-10-18 20:41 UTC from
`/read/rovelli-order-of-time-…-spya-r26sug?at=spya-gurejz&margin=1`, build 956a2380. Queue item
`qi-xgbrzm8g`.

> When I reopen an article that I've already been reading, it should ideally reopen at roughly the
> position where I was on last, where I was, yeah, the paragraph that I was reading most recently.

**Ending: shipped** on `dev`. Plan
[261019a](../plans/261019a-reopen-lands-on-the-paragraph-you-were-reading.md), postmortem
[261019a](../postmortems/261019a-a-reopen-drifted-back-a-section-each-time.md). An earlier report
asked for the per-device restore, and it shipped on 2026-09-05
([260905_0957](260905_0957-reopen-an-article-where-you-left-it.md)). This report found two
things wrong with it.

- **A regression, fixed.** Since 2026-10-02 the prose has used a serif web font that finishes
  loading a few seconds after the page opens. Reopening jumped to the right place, then the font
  arrived and rewrapped every line above it, which pushed the place about 3,000px down. The reading
  position then recorded where that left the page: the section *before*. So each reopen started
  one section further back (367 → 311 → 262 → 190 in four tries on dev). The same thing happened to
  a shared link that carried `?at=`. An arrival now holds its place until you move: it stays
  aligned as fonts and layout settle, and lets go at your first scroll, key or touch.
- **The paragraph, not the section.** The address still records the section while you scroll (a
  2026-08-25 decision). But on this article a section is about 1,650 words, roughly seven minutes
  of reading, so landing at its start was never "where I was". The copy this browser keeps now
  stores the paragraph at the reading line, and a reopen lands on that paragraph.
- **Checked in a real browser** (fresh context, cold cache, 3,051-block article). At desktop and
  phone width, a deep `?at=` and a bare reopen both land on their block, and three reopens in a
  row do not move. Wheeling releases the hold, and a shelf click lands on the stored paragraph.
- **Not asked for, so not built: another device.** Your place is still remembered per browser, as
  in the 2026-09-05 version, and the drift alone explains this report. Picking up on your phone
  where you left off on your laptop would need the position stored on the server (a per-reader,
  per-article row with a timestamp, so a schema change) and a rule for which device's place wins.
  Say if you want it and it becomes its own plan.
