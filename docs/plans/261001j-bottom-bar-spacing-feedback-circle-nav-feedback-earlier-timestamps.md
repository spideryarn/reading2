# Bottom-bar spacing, Feedback in a circle, Feedback in the site nav, Earlier timestamps

Six of Greg's own Feedback reports (admin, so trusted input), batched because they are small and two
of them are one ask. Read from the production `feedback` rows, read-only, 2026-10-01. A prior-work
check (git log, `docs/plans/`, `docs/user-feedback/`, `gjd-remote ls`) found none of them built or
in flight.

| Report | Filed | Greg's words, in short | Stage |
|---|---|---|---|
| spya-bumjmy | 09-29 | "a little bit of horizontal space between the icons in the bottom-bar" | 1 |
| spya-ng89zf | 09-29 | the same, "especially when collapsed/without-labels" | 1 |
| spya-xgqv50 | 09-30 | "move the Feedback icon all the way to the right, and perhaps wrap it in its own circle" | 2 |
| spya-xgn06m | 09-05 | "The Feedback and Logo get in the way at the top of /read/public" — the logo half shipped in 260929a; this is the Feedback half | 3 |
| spya-yvwpek | 09-30 | remove "A rough note is worth far more than nothing" from the dialog | 4 |
| spya-d9xdhs | 09-30 | Earlier tab: exact timestamp and "3d ago"; plus a doc rule for every date | 5 |

## Stage 1 — more room between the bar's buttons

Today `.dock` has `gap: 0.15rem`, but most of the bar is the `.dock-modes` segment, whose buttons
touch each other and are spaced only by their own `padding-inline` (0.6rem at rungs 0–2, 0.45rem at
rung 3). So the gap alone would only space the few loose controls; the icons Greg means are mostly
the segment's.

- `.dock` gap 0.15rem → 0.3rem.
- The icon-only rungs get wider padding: rung 2's mode buttons 0.6 → 0.7rem, rung 3's buttons and
  `.dock-home` 0.45 → 0.55rem.

**The trade, named:** the fit ladder is measured (dock-fit.ts), so a wider row drops to the next rung
at a slightly wider window than today — labels go a little sooner. At 390px the reading view's row
already overflows and scrolls sideways (measured 617 against 390 on 2026-09-05), so "still fits"
there means: no clipping, no vertical change, the scroll still reaches the last button. Measured
before and after in a browser at 390 and 1280.

**As built, after the plan review and a browser pass:** Sol pointed out that on a phone the
coarse-pointer `min-width: 2.5rem` floor, not the padding, sets the icon spacing, so that floor went
to 2.75rem (44px; the 390px row now scrolls to 1178 rather than ~1080). And **rung 2's padding went
back to 0.6rem**: measured, 0.7 made plain mode at 1280 fall to rung 3 and lose the words
Commands, Comments, Metadata and Experimental. Greg's two reports were both filed from a band mode,
which is rung 3 at laptop widths, so rung 3 (0.45 → 0.55rem) carries the change and costs no rung.

**Simpler option passed over:** only the `.dock` gap. It is the number named in the brief but it
does not touch the space between the segment's icons, which is what Greg sees as "between the
icons".

## Stage 2 — Feedback at the far right, in its own circle

It is already the last control before the trailing gutter, but sits straight after the experimental
switch. `margin-left: auto` on `.dock-feedback` pushes it to the right-hand end whenever the row has
spare room; when the row overflows the auto margin is zero and it is simply last, as now.

The circle: a 1px `--rule-strong` border with `border-radius: 999px`, inset vertically so it does
not grow the bar (the same margin trick `.dock-modes` uses). With its word showing (rung 0) that is
a pill; at rungs 1–3, icon only, it is given equal width and height so it is a circle. It stays a
`.dock-btn` (so the ladder still finds it) but its hover is drawn inside the shape.

## Stage 3 — Feedback in the site nav, not in the corner

`/features`, `/pricing`, `/read/public` and `/features/public-readable-sharing` wear `SiteNav`
signed in as well as signed out. Signed in, App.tsx still draws the fixed corner trigger over the
nav's right-hand link (Greg's `/read/public` report; 260929a saw the same on `/features` on a phone
and left it). 260929a solved the logo half by taking the corner logo off those pages, because the
nav already carries a way home.

Do the same for Feedback: a fourth `FEEDBACK_SHAPE`, `nav`, styled as the nav's own links (text-sm,
muted, icon + word), rendered as the last item of `SiteNav`'s right-hand cluster when `signedIn`; and
App.tsx's corner condition excludes the routes that draw `SiteNav`. `FEEDBACK_TRIGGER_SELECTOR` is
built from the shape table, so tests/dock-corner-controls.test.tsx's "exactly one trigger per page"
walk counts the new shape automatically.

Phone budget: below `sm` a signed-in nav carries only *Home*, because *Sign in* is a stranger's. The
bar was measured to fit at 320px with two entries; Feedback takes the slot *Sign in* leaves. Checked
at 390 (and 320 if cheap).

**Simpler option passed over:** keep the corner and add right padding to the nav when signed in —
the reservation FeedbackButton.tsx records removing from the reading view for costing 120px on
every page. Two top-right controls is also the SPIDERYARN-READING2-2C finding on the shelf.

## Stage 4 — the dialog loses one sentence

Delete the `<p className="fb-intro">` and whatever CSS only it used.

## Stage 5 — Earlier: exact time and "3d ago"

Each entry's `<time>` says `exactly(createdAt)` (`1 Oct 2026, 14:02`) followed by
`· 3d ago` from `relativeAgo(createdAt, now, "narrow")` — the form Greg named. Past 30 days
`relativeAgo` returns nothing and the line is the exact time alone, the house threshold in
relative-time.ts. `now` is read once per render of the list.

**The doc rule** ("whenever we show a date … the human-readable `… ago` as well as a timestamp,
even if only in a tooltip") goes in a rule doc, so per edit-important-docs.md the wording is drafted
here and sent to the Overseer for Greg rather than committed:

> **Every date a reader sees carries both forms**: the exact timestamp and how long ago it was
> (`3d ago`), one of them in a tooltip if space is short. `src/web/relative-time.ts` has both
> (`exactly`, `relativeAgo`/`timeAgo`); past 30 days the relative form gives way to the date.
> Greg, 2026-09-30.

Proposed home: design-css-overview.md (or typography.md), as one bullet.

## Verification

`npm test`, `npm run typecheck`, lint on touched files; a test for the Earlier line (exact + ago,
and exact alone past 30 days), the corner/nav count walk; Playwright at 1280 and 390 for stages 1–3;
GPT Sol on this plan and on the code.
