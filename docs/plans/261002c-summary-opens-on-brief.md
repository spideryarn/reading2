# Summary opens on Brief (8N)

Overseer queue item `qi-jvxmmya4`. A suggestion from Greg, filed 2026-10-01 on production build
`4de26073` — **SPIDERYARN-READING2-8N** (`spya-zw479b`):

> In summary mode, default to the brief summary when it opens for the first time.

## Where things stand (origin/dev at `0fbd316a`)

- Both changes this sat behind have landed: Summary lost Parts & Sections (fb7q-7r,
  [261001p](261001p-summary-loses-parts-and-sections-a-touch-wider.md)), and pressing Summary on
  the bar now writes the three plain-words levels (fb7t-7v,
  [261002a](261002a-summary-generates-on-open.md)).
- Which level shows is `?summary=`, parsed by `summaryParam` (`src/web/params.ts`), whose default
  is `simple` — the slider's middle stop, and absent from the address.
- One `simple` job stores all three levels atomically (all or none, `src/simple-summary.ts`; Fuller
  is asked first and the other two once its stream begins, but the reader sees none until all
  three are stored), so the selected level does not affect generation, cost or the loading state.

## What we build

**The default becomes `brief`.** `summaryParam.withDefault("brief")`, and `subModeParams`
(`src/web/sub-modes.ts`) clears the parameter for `brief` instead of `simple`, so the default is
the one absent from the address, as for every other sub-mode.

```
open Summary, no ?summary=  ──► Brief           (was Simple)
?summary=simple             ──► Simple          (now written out; was absent)
?summary=fuller             ──► Fuller          (unchanged)
?summary=gists / junk       ──► Brief           (degrades to the default, as before)
```

**"The first time" needs nothing more.** `?summary=` is in the remembered view
(`src/web/last-view.ts`), so a reader who moves the slider to Simple or Fuller comes back to that
level on their next visit to the article; only an article with no remembered level opens on the
default. That is Greg's "when it opens for the first time".

### What moves with it

- **A remembered view written before this change** that was on Simple stored no `?summary=` (it
  was the default), so it now restores onto Brief. Accepted: the reader is one slider step away,
  and the alternative — a stored-version marker — is machinery for a few days of history.
- **An old shared link** with no `?summary=` that meant Simple now opens on Brief. Same answer.
- Docs that name `simple` as the default: `summaries.md`, `url-state.md`, the `summaryParam`
  comment, and the comment in `sub-modes.ts`.

### Passed over

- **Per-reader default (a profile setting)** — nobody asked; a one-step slider is the setting.
- **Remembering the level across articles** — not asked for; "the first time" reads as per
  article, which last-view already gives.

### Tests (red first)

- The band with no `?summary=` opens on Brief; with `?summary=simple`, on Simple; pressing the
  Brief end removes `?summary=` (nuqs drops the parser's default — the serializer itself is the
  identity, Sol P2).
- `subModeParams({mode:"summary", view:"brief"})` clears the parameter; `simple` sets it.

## Reviews

- Plan: GPT Sol, read-only — `261002c-summary-opens-on-brief-plan-review-sol.md`. No P0/P1; two
  P2s (the test wording and the generation-timing claim above), both taken.
- Code: GPT Sol, workspace-write — `261002c-summary-opens-on-brief-code-review-sol.md`. No P0; one
  P1 it fixed (two more tests that still expected Simple: `public-network-trace`,
  `every-mode-draws-its-surface`) and one P2 it fixed (the docs said every chosen level is written
  into the address; Brief is its absence).
