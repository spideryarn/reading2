# The exact instant, and how long each step took

**[SPIDERYARN-READING2-2K](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2K)** · reported
2026-09-07 19:17 UTC · *shipped*

## What Greg said

> In the Metadata page in what we did to it, can you make sure it has a tooltip for exactly when it
> happened, rather than only showing the human-readable version? And also, how long it took.

## What changed

Two asks; **one of them already existed**. Every `ran 4 days ago` in *What we did to it* has carried
a card with the full stamp — day, seconds and timezone — since 2026-08-27. Confirmed in a browser
before anything was built: hovering the first step row gave
`Thursday, September 3, 2026 at 1:20:51 PM GMT+1`.

The half that was missing is **how long it took**, and it was missing from the wire rather than from
the database: `revision_step_runs` has recorded `started_at` all along and `StageState` only carried
the finish. So `startedAt` joins it, and the card subtracts:

```
Thursday, September 3, 2026 at 1:20:51 PM GMT+1 · took 1m 47s
When this stage last finished.
```

The design, the null cases, the touch ruling and the evidence are in
[260908a-exact-time-and-duration-on-the-metadata-step-rows.md](../plans/260908a-exact-time-and-duration-on-the-metadata-step-rows.md).

## The thing worth carrying forward

**The card was probably never found, and the page is why.** *What we did to it* sits inside a shut
*Technical details* section, under a subheading of its own — so the hover that answers half this
report is behind a click most readers never make. That is deliberate (Greg, 2026-09-03: *"the less
important stuff less visible"*), and it is not changed here. It is worth knowing that the same thing
already happened once on this page: the re-run placeholder lived in that section for three days and
was asked for as if it did not exist
([260907d](../plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md)). **A feature two
disclosures deep is a feature nobody has.**

Not acted on, because it is a different decision from this report and it is Greg's: whether anything
under *Technical details* should be somewhere else.
