# The reading column's cap: a middle value

Greg's reply `spya-gf24w4` to [q-z3j0ep](../user-feedback/questions/q-z3j0ep.md), 2026-10-22
23:38 UTC, about stage 2 of
[261022d](261022d-reading-measure-in-real-characters.md#stage-2-held) (report `spya-vywcpu`):

> Maybe somewhere in the middle? Dunno. Take screenshots, use your judgment.
>
> — Greg, 2026-10-22 (`spya-gf24w4`)

The question offered A (bring `PROSE_ALONE_MAX_REM` down from 49 to 34rem, which brings Marginalia
closer and widens bands from a 980px window), B (34 for Marginalia only, with a second number for
where bands widen) and C (leave 49). He picked no letter. This plan takes a single value between the
two, for both.

## The value: 42rem

One number for both uses, as now, so no second number (B's cost). Bands are computed at a 16px root
and Marginalia's gap is the space between the end of a line and the start of its note:

Measured in the browser (§ Evidence), apart from column A, which is arithmetic:

| window | standard band now (49) | at 42 | A (34) | Tweets now / at 42 | Marginalia gap now / at 42 |
|---|---|---|---|---|---|
| 1024 | 400 | 400 | 444 | 425 / 425 | 135 / 121 |
| 1194 (iPad landscape) | 400 | 486 | 544 | 496 / 496 | 177 / 121 |
| 1280 | 460 | 544 | 544 | 533 / 544 | 177 / 121 |
| 1440 | 544 | 544 | 544 | 544 / 544 | 177 / 121 |

The gap runs from the end of the longest line to the notes column's edge. Tweets at 1280 becomes 544
only through fix 1 below; the screenshots were taken before it. Summary's roomy band and Structure's
follow their own rules and are not shown.

Why 42 and not another middle:

- **It is the middle**: (49 + 34) / 2 = 41.5, rounded up a whole rem, because the cap has to stay
  wide enough for the measure (see `PROSE_ALONE_MAX_REM`'s comment on whole rem).
- **The standard band at 1024px is untouched.** It widens from a 1109px window instead of 1221,
  and reaches 544 at 1252 instead of 1364. Below 1109 its width stays as Greg tuned it
  (spya-xebdgz: *"the way it works right now for slightly narrow windows is pretty good"*).
- **On an iPad in landscape the standard band stops at 486, under the Tweets band's 496.** Greg
  tuned 496 on 2026-09-30 and called 544 too wide there. A cap of 41 would give 502, just over it.
  So 42 is the smallest whole value at which the standard band on his iPad is no wider than the one he set.
- **Marginalia's notes come 56px closer** (177 → 121 at 1194 and up), about halfway between now
  and A.

Screenshots: § Evidence.

## The two fixes that come with any smaller cap

Both were found when stage 2 was built at 34
([261022d § Stage 2, held](261022d-reading-measure-in-real-characters.md#stage-2-held)), and both
still apply at 42:

1. **Tweets' wide band must never be narrower than the standard band.** Its lower bound is the
   unwidened standard band. At 42, the widened standard band would pass it between about 1212 and
   1307px. The lower bound becomes `max(standard, spare)`.
2. **A band must not widen the prose below its defended width at a small root.** The spare is
   taken against `max(cap, PROSE_MIN)`, not the cap alone. At 42 the cap is only 402px at a 9px
   root. At an 844px window the raw spare is 430px, but the band's 306px cap still leaves only
   526px of prose, where the standard band holds 288 + 544. GPT Sol confirmed `PROSE_MIN` over
   `MODE_PROSE_FLOOR` in the plan review: the floor would still leave that 306 + 526 layout.

## Changes

- `src/web/layout.ts`: `PROSE_ALONE_MAX_REM = 42`, its comment rewritten to say what the value
  is and why. Both fixes go in `bandWidth` and `spareBeyondTheMeasure`, and the "1220 / 1364"
  numbers in the comments are corrected.
- Tests: the hand-derived numbers in `tests/layout.test.ts`, `tests/layout-margin.test.ts`,
  `tests/text-alone-centring.test.ts`, `tests/gutter-target-size.test.ts` and
  `tests/prose-centred-in-its-cell.test.ts` are re-derived by hand, not copied from the output.
  There are new tests for the two fixes, each red first. The two former `it.fails` "under a rem of
  slack" tests are ordinary tests with a 10rem ceiling: they fail at 49 and pass at 42.
- `scripts/measure-line-length.ts` gains 1194px at Default and 1440px at all four text sizes. Every
  configured window from 1000px up fails if the cap clips the measure.
- Question q-z3j0ep answered, and the spya-vywcpu note's comment updated.

## Simpler option passed over

C, leaving 49. It is simplest, but Greg asked for something in the middle. B passed over too: it
adds a second number, and Greg did not choose it.

## Evidence

A Sonnet subagent ran Playwright against the dev server on the essay `simulators-spya-q2xbny`, at a
16px root, light theme, with a mouse. It set the constant to 49, 44, 42 and 38 in turn. Band mode is
Glossary, Tweets is `?mode=summary&summary=thread`. The 48 screenshots stayed in the session's
scratchpad and were not committed.

| cap | Marginalia gap, 1024 / 1194 / 1280 / 1440 | Glossary band, same windows |
|---|---|---|
| 49 | 135 / 177 / 177 / 177 | 400 / 400 / 460 / 544 |
| 44 | 135 / 137 / 137 / 137 | 400 / 454 / 540 / 544 |
| 42 | 121 / 121 / 121 / 121 | 400 / 486 / 544 / 544 |
| 38 | 89 / 89 / 89 / 89 | 400 / 544 / 544 / 544 |

The Tweets band was 425 / 496 / 533 / 544 at every cap, and the prose lines were 489px in every
case, so no cap clipped the text. By eye: at 49 the notes look detached from their paragraphs; 42
looks comfortable; 38 is the most attached, but it brings the iPad-landscape band to 544, the width
Greg called too wide there. A 486px Glossary band at 1194 reads well. At 1440 every cap looks the
same.

The screenshots showed note text cut off at the right edge at every cap, including 49. A second
subagent traced that to the harness rather than the app. Playwright's default `--hide-scrollbars`
makes the root's `clientWidth` report the full 1194px, while `scrollbar-gutter: stable` still holds
15px back. The layout is then fitted 15px too wide, and the notes run 8px past the page. With
classic scrollbars, as
[browser-testing-playwright.md](../project/browser-testing-playwright.md) says to launch, the notes
end exactly at the visible edge, and overlay scrollbars reserve nothing. No reader can get into
that state, so nothing was built for it. `scripts/measure-line-length.ts` launched the same wrong
way and now passes `ignoreDefaultArgs: ["--hide-scrollbars"]`. The gaps and band widths above do
not depend on it: the gap comes from the cap's slack, not the window.

## Status

- [x] Screenshots at 49 / 44 / 42 / 38
- [x] GPT Sol plan review: go with changes
  ([review](261023a-reading-column-cap-plan-review-sol.md)). All taken: the table's numbers
  corrected (Tweets 425 at 1024, crossover 1109), `structure-band-width.test.ts` and `chat.test.ts`
  added, `narrow-windows.md`, `typography.md` and `marginalia.md` corrected (`measure.ts`
  already said the cap has extra room on purpose, so it was left), and the counter given
  1440 at Large, Larger and Largest (plus 1194), because at 725 those sizes are exempt and could
  not catch a clipping cap
- [x] Built. Both invariant tests were red before their fixes (wide 291 < standard 292; prose
  402 < 544 at 703px, 9px root). An Opus subagent re-derived the test numbers by hand, and every
  one agreed with the code. Counter green at 42: median 60, p90 64–65, at the measure at every
  text size at 1440. Red at 30 (CLIPPED at 1194 and every 1440 size, exit 1), so it does catch a
  cap that is too tight
- [x] GPT Sol code review: ship with fixes
  ([review](261023a-reading-column-cap-code-review-sol.md)). Its fixes were read and kept: a 1165
  assertion back in `structure-band-width.test.ts`, claims scoped to the standard band
  (Structure's is 638 at 1194), the old small-root failure corrected to 306 + 526, and 1221 rather
  than 1220 as the old first widened pixel. Its mutation checks went red as expected
- [x] Question answered and published, note updated, pushed to dev
