# /changelog: release dates as relative time

Feedback report **SPIDERYARN-READING2-6P** (kind: suggestion, from Greg's own account). His words:

> In the What's New page, `/changelog`, we show sort of date stamps for when the deploy came out. I
> wonder if we could show them as human readable, e.g. `3d ago`, `3h ago` (perhaps using a library
> as per docs/reusable/third-party-library-selection.md )
>
> — Greg, 2026-09-30

## Library: none, because the repo already has the answer

[third-party-library-selection.md](../reusable/third-party-library-selection.md) asks what the
requirement is before what the library is. The requirement is one function — distance from now, in
the unit a reader would have used — and the platform has had it since 2020:
`Intl.RelativeTimeFormat`, whose `style: "narrow"` in English produces exactly Greg's examples
(`3d ago`, `3h ago`, `12m ago`, and `yesterday` with `numeric: "auto"`). Checked in Node on the box.

More to the point, **the repo already wraps it**: `src/web/relative-time.ts` § `timeAgo`, with its
tests, used by the shelf, the admin table and the metadata page; and `src/web/useNow.ts`, the
minute-ticking clock that keeps a relative date from rotting on a page left open. A library
(`date-fns`' `formatDistance`, `dayjs/relativeTime`, `timeago.js`) would be a second way to do one
thing — exactly what CLAUDE.md § *Prefer simple over easy* says not to add. That is the legitimate
"no library" outcome the report's scope note anticipated.

## What changes

`/changelog` draws a release's date in two places (`src/web/ChangelogPage.tsx`):

1. **The release heading** — `Release 95  6 September 2026, 09:49`. Becomes `Release 95  3 days ago`.
2. **The contents list's narrow date column** — `6 Sep`. Becomes `3d ago` (narrow style: the column is
   2.75rem, sized for a short date).

In both, the exact stamp stays one hover away: a `<time dateTime="…" title="6 September 2026, 09:49
UTC">`. `<time>` also gives the machine-readable instant to anything that wants it.

**Past 30 days each falls back to what it shows today**, in UTC. `timeAgo` already hands over to an
absolute date past a month — "43 days ago" is worse than the date — but its absolute date is in the
*viewer's* zone, and this page decided on 2026-09-06 that a release's date is UTC so that it does not
depend on who is reading (`formatVersionStamp`'s comment). So the relative half is split out of
`timeAgo` as `relativeAgo(iso, now, style)`, which returns `undefined` past the threshold, and
`timeAgo` becomes `relativeAgo(…) ?? absolute(…)` — unchanged behaviour, one threshold, one place.
The changelog does `relativeAgo(…) ?? formatVersionStamp(…)` (heading) and `?? formatShortDate(…)`
(contents).

**Where the clock is read.** The page is client-rendered only (no SSR — `ChangelogBody` already reads
`window.location` in its initial state), and the file is a build-time constant; so the only way this
could go stale is a tab left open, which is what `useNow` exists for. `ChangelogBody` calls `useNow()`
once and passes `now` down to both the contents list and each release, so the two surfaces can never
disagree across a minute boundary (useNow.ts's own rule).

## Simpler option passed over

Relative time in the heading only, leaving the contents column as `6 Sep`. Less code, but Greg's
examples are the narrow form and the contents list is where a reader scans dates; leaving it absolute
would make one page speak two ways about the same release.

## Deferred

- **Touch readers cannot reach the exact stamp.** It is a `title` for a mouse and an `sr-only` copy
  for a screen reader (below), but a sighted phone reader has no way to it. A tap-to-reveal —
  `ControlTip` on a focusable trigger — is a later change if anyone asks; past a month the page shows
  the UTC date itself anyway.
- The 30-day threshold means releases before ~31 August still show absolute dates. That is
  `timeAgo`'s existing, deliberate rule, reused rather than re-decided.

## Tests

- `tests/relative-time.test.ts`: `relativeAgo` returns `undefined` past the threshold where `timeAgo`
  returns a date; `narrow` picks the same unit as `long`.
- `tests/changelog-page.test.tsx`: a release from hours ago renders a relative string (not the
  absolute stamp) with the UTC stamp in its `title` and the ISO in `dateTime`; a release older than
  30 days renders the old absolute stamp. Written first and watched red.

## Plan review, and what changed

GPT Sol, read-only, 2026-09-30: **approve with changes**, two P2s, both taken. (The first run was
killed at the tool's 10-minute limit with no answer; the second, in `tmux-job`, exited 0 with a fresh
answer file.) The code had been drafted in parallel, so both landed as edits to it.

1. **`style: "narrow"` is only `3d ago` in some locales.** In `en-GB` — Greg's own — it is `3 days
   ago` and `3 hr ago`, confirmed in Node on the box, which neither matches what he asked for nor
   fits a fixed-width column. So the narrow formatter is pinned to `"en"` (the page is written in
   English) and its test asserts the exact strings; the heading's `long` formatter keeps the
   viewer's locale, as everywhere else in the app.
2. **A `title` is invisible to a keyboard and not reliably read aloud.** The `<time>` now carries
   an `sr-only` *", released 6 September 2026, 09:49 UTC"*, the duplication tooltips.md asks of a
   trigger nothing can focus. The earlier "the release's box links its deploy" rationale for touch was
   wrong — nothing in the box says the time — and is corrected under § Deferred.

## Status

- Plan review (GPT Sol, read-only): done, above.
- Built: yes — `relative-time.ts` (`relativeAgo`, `RelativeStyle`), `ChangelogPage.tsx`
  (`ReleaseDate`, `useNow` in `ChangelogBody`, the contents date column `w-11` → `w-16`), tests in
  `tests/relative-time.test.ts` and `tests/changelog-page.test.tsx`, watched red first.
- Code review (GPT Sol, workspace-write): **approve**, no product-code defects; one P3 on the tests,
  which it fixed: the heading's long form is now asserted against the runtime's own formatter rather
  than a digit, the 30-day boundary is tested on both sides, and a new test advances the interval to
  prove the dates move while the page stays open. Exit 0, fresh answer file, diff read, gates re-run.
- Note: `docs/user-feedback/260930_0259-changelog-release-dates-as-relative-time.md` (row
  `spya-pu7536`, ending shipped).
