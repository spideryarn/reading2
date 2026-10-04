# Plan review: 261004g, four small client fixes

You are reviewing a plan before it is built. Read-only: change no file.

**Candidate (live, pre-commit).** Base SHA: the worktree's HEAD (`git rev-parse HEAD`). One
untracked file, which is the whole candidate:

- `docs/plans/261004g-four-small-touch-and-narrow-window-fixes-structure-list-card-band-about-double-press-glossary-band-comes-back-shelf-copy-notice.md`

Read it, then read the code it names. Start with, without that limiting scope:
`src/web/OutlinePanel.tsx` § `Row`, `src/web/StructurePanel.tsx` § `CardRow`, `src/web/Tooltip.tsx`,
`src/web/BandAbout.tsx`, `src/web/modes/referee/RefereeMode.tsx` § `HowToRead`,
`src/web/useTapReveal.ts` if it exists, `src/web/reader/Reader.tsx` (every `setMode(` and every
`setBandAway(`), `src/web/useShelf.ts`, `src/web/ShelfEntry.tsx` § `useShelfActions`,
`src/web/useCopy.ts`, `tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx`,
`tests/band-about.test.tsx`.

## What to do

Make an independent pass first. For each of the four items: is the stated cause the real cause, is
the fix the right one for the long term, will the proposed red test really be red on today's code
for the stated reason, and is there a simpler design? Check the table in item 3 row by row against
the code: a wrong "No" there is a bug left in.

You may run one test file yourself if it needs nothing outside the tree (no Postgres, no network).

## Severity, fixed

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | user-visible wrong behaviour, or an authoritative contract violated |
| P2 | design or maintainability risk with no wrong behaviour today |
| P3 | non-behavioural prose or comment defect |

Give every finding an ID (`F1`, `F2`, …), its severity, and the file and line it rests on. Finish
with one line: **Verdict:** `build it`, `build it with changes`, or `do not build`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Item 1: whether dropping `keepSide` changes anything for a mouse on a wide window, and whether the
  jsdom tripwire is worth having at all.
- Item 2: whether refusing an open while `dismissedByPress` is set interferes with Tooltip's
  `byTouch` handling or with the `interactive` card's focus rules.
- Item 3: whether `setMode` to the mode already open pushes a history entry (Reader.tsx says nuqs
  does not elide a same-value push), which 261004b's `citeActions.dig` would then already be doing.
- Item 4: whether a copy on one row should clear a copy failure reported by another row.
