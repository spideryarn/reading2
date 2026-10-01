# Stage 2 brief: put each remaining mode onto the band's (i)

Shared brief for the subagents converting the remaining modes. Plan:
`docs/plans/261001m-every-mode-gets-an-i-in-its-top-right-corner.md`. GPT Sol's plan review:
`docs/plans/261001m-mode-info-plan-review-sol.md`. Read both first.

Repo / worktree: `/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon`. Work only there.

## What Greg asked (2026-10-01, spya-ucu35y)

> In Tweet-thread mode, it says "Written by claude-sonnet-5 · tweets/5 · 1 Oct 2026 · 20.0s" at the
> bottom. Move this into a tooltip for a (i) icon in the top-right. … update any other modes to move
> out similar such explanatory/output/metadata text (unless it's really valuable) to follow this (i)
> approach … Each mode should have such an (i) icon, which contains information like: how many X (of
> y); other useful explanatory information about what this is, why, how it works, caveats, how to
> understand it, etc; when it was generated/ran; what model was used.

## The API (already built; do not change these files)

- `src/web/ModeSurface.tsx` takes `mode?: Mode` and `about?: ReactNode`. Given `mode`, the band
  gets an (i) in its top-right corner whose card opens with that mode's `MODE_CATALOG` description
  and `how` (src/mode-catalog.ts), followed by `about`. **Pass `mode` unconditionally**, so the (i)
  is there in every state (loading, empty, running, visitor). `about` holds only what this mode adds:
  counts, caveats, provenance.
- `src/web/BandAbout.tsx` § `AboutMade` renders "Written by <generator> (<version>), <exact date>
  (<n hours ago>), in <duration>." from optional fields. Pass the **owner's** artefact fields only;
  a visitor's artefact has none (src/public-types.ts). `verb` changes "Written" (e.g. "Searched").
- Worked examples, already converted: `src/web/Tweets.tsx` (`TweetsAbout`, and the foot that now
  appears only for a running or failed job), `src/web/FaqPanel.tsx` (`FaqAbout`),
  `src/web/CitationsPanel.tsx` (the `about` const). Copy their shape.
- Card content is `<p>` elements (the card's CSS spaces paragraphs). Counts as a sentence ("12
  terms."), "N of M" where there is a total.

## What moves, what stays

Moves into `about`: provenance ("Written by", model names, versions, generated dates, durations),
explanatory sentences about the whole band (how it was made, how to read it), and counts that stand
alone in a head row.

Stays visible: empty states, loading, running jobs, failures, stale notices, anything the reader can
act on, counts that sit beside the control they describe (a threshold slider's "8 of 24"), and
navigation ("Question 3 of 8"). A caveat needed to read the visible rows correctly also stays.

If a head row's only content was the count you moved, drop the head (pass `null`). Check the
mode's CSS comments and the head's docblock first: if the head is a fragment kept so the row stays
put while loading, say so in your report rather than deciding alone.

**Never leave "Written by" visible in a band.** `tests/every-mode-draws-its-surface.test.tsx` checks it.

## Clearance: the (i) must not sit on a control

The (i) is absolutely positioned at `top: 0.45rem; right: 0.4rem` in the band (1.5rem square). The
band gets class `has-about`, which sets `--band-about-room: 1.9rem`. `.band-head` and `.gloss-sort`
already pad their right edge by it (mode-band.css, glossary.css). **If your mode's top row is
something else** (a controls row, a rank row, a toolbar, a list that starts at the very top), add to
that row's right padding in the mode's own stylesheet, for example
`.mode-band.has-about .quotes-rank { padding-right: calc(<its existing right padding> + var(--band-about-room)); }`,
with a one-line comment pointing at mode-band.css § `.mode-band > .band-about`. Measured layouts
(Outline: `--outln-pad-r`, which its hidden measuring copies share) must apply the inset to every
copy, so the rung choice still matches what is drawn.

## Do not touch

`ModeSurface.tsx`, `BandAbout.tsx`, `mode-band.css`, `glossary.css`'s `.gloss-sort` rules, Tweets,
FAQ, Citations, Referee (exempt: its how-this-works card stays), and the two shared test files
`tests/every-mode-draws-its-surface.test.tsx` and `tests/mode-surface-changes-no-markup.test.tsx`
(the lead updates both after every batch lands). No git commands that change anything: no commit, no
stash, no checkout, no restore. Other subagents are editing other modes' files at the same time.

## Checks

- `npx tsc --noEmit -p tsconfig.json` clean.
- Run your modes' own test files (`ls tests | grep -i <mode>`) and fix any that broke **because text
  moved** (assert on the card instead: click `.mode-band > .band-about`, read `[role="tooltip"]`).
  If a test breaks for any other reason, report it rather than "fixing" it.
- Ignore failures in the two shared test files; the lead owns those.

## Report back (concise, under 500 words)

Per mode: what moved into the card, what stayed and why, any head dropped, CSS added, tests changed,
and anything you were unsure about. No file dumps.
