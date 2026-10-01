---
reports: spya-j389gg, spya-qfzb4g
ending: shipped
---
# Metadata: *What it cost* shut with its total showing, and Export further down

Two reports from one session of Greg's on `/read/dongetal25-spya-vfmvmm/metadata`, both from Greg
(admin: `scripts/feedback-reporter.ts --report-id --event-id` exits 0 for each). The time in the file
name is when this session picked them up; the report text came in the brief.

SPIDERYARN-READING2-7G (`spya-j389gg`, event `eebd423fe4c44327ac200778a70f53a9`), a suggestion:

> In Metadata, when we show the Costs (for admins), default to collapsed (to save vertical space),
> showing only the total figure/summary.

SPIDERYARN-READING2-7H (`spya-qfzb4g`, event `15a3f1bc77244f70b0b2f680ce78eace`):

> In Metadata, move "Export" section further down.

**Ending: Shipped.** On `dev` as `604be6c1`, not deployed. Resolve 7G and 7H. The next feedback sweep
does the Sentry status write.

What we did:

- **What it cost is shut by default, and its heading carries the total** — `$0.0123 · 12 calls`,
  `At least …` when some calls reported no cost or a live conversation went unreported, `none
  recorded` when there are none. Click the heading for the table.
  - If reading the costs fails, the section stays open and shows the error rather than hiding it.
  - Still for admins only: the section, and the request behind it, exist only for an admin, and the
    server refuses anybody else regardless.
- **Export moved down**, from above *Technical details* to just above *Re-run AI processing*. The
  foot of the page is now: *Technical details*, *What it cost* (admin), *Export*, *Re-run AI
  processing*, *Archive this article*, *Delete this article*.
  - That is as low as it goes without undoing two earlier placements of yours: Re-run directly above
    Archive (4Z), and Archive then Delete at the very end. It also puts Export next to Delete, whose
    "Export it first" link scrolls to it. If you want it lower still, the next step is between
    Archive and Delete.

The plan is
[261001c](../plans/261001c-metadata-cost-shut-with-its-total-and-export-further-down.md).
