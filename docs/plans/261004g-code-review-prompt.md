# Code review: 261004g, four small client fixes (round 1)

You are reviewing built code, and you may fix what you find. Work only in this worktree.

**Candidate (committed).** Five commits on top of base `8ef63beb2`:

- `0a6a00150` item 1, Structure list face card (qi-fkyrdns3), plus the plan
- `60aa681df` item 2, band (i) double press (qi-9rk34gjz)
- `d843a716d` item 3, Glossary band comes back (qi-fs4qzzfm)
- `5eba9db04` item 4, shelf Copy link notice (qi-pnqc7eh4)
- `a4a6e58a0` the failed-copy glyph in Tweets and Chat

`git diff 8ef63beb2..a4a6e58a0` is the whole candidate; `git diff --stat` on the same range lists
the paths. The plan, with your plan review's findings and what was done about each, is
`docs/plans/261004g-four-small-touch-and-narrow-window-fixes-structure-list-card-band-about-double-press-glossary-band-comes-back-shelf-copy-notice.md`.
Start there, without that limiting scope.

## What to do

1. Make an independent pass over the diff first. For each item: does the code do what the plan
   says, is anything wrong for a reader, and would each new test really go red if its fix were
   reverted? Mutate the fix and run the one test file to find out; a test file that needs nothing
   outside the tree (jsdom, no Postgres, no network) is yours to run. Put the code back after.
2. **Fix what is inside this stage, narrowly and red-first**: write or extend a failing test, see it
   red, then fix. Report, do not fix, anything wider.
3. One piece of work is asked of you outright: **your plan-review F1 has a fix and no test.**
   `openAskedFromDrawer` in `src/web/reader/Reader.tsx` now calls `showBand("chat")` when the mode is
   Chat or Remember. Add a whole-page regression case to
   `tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx` if the harness can reach it (a Chat
   band stepped aside on a narrow window, then a question opened from the Comments drawer or the
   margin, expecting the band back), see it red against the old line
   (`if (mode === "remember") void setMode("chat");`), and leave it green. If it cannot be reached
   in that harness without mocking most of Chat, say so and say what the smallest honest test is.
4. Check the docs I touched against the code: `docs/project/touch.md` (two additions) and
   `docs/project/tooltips.md` (one sentence). Fix wording that the code contradicts.

Do not commit. Do not run `git` commands that change anything. Do not attribute any sentence to
Greg that is not already quoted in the repo.

## Severity, fixed

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | user-visible wrong behaviour, or an authoritative contract violated |
| P2 | design or maintainability risk with no wrong behaviour today |
| P3 | non-behavioural prose or comment defect |

Give every finding an ID (`C1`, `C2`, …), its severity, the file and line, and whether you **fixed**
it (with the test you saw red) or are **reporting** it. Finish with one line: **Verdict:** `land it`,
`land it with the fixes above`, or `do not land`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `openTermInGlossary` still calls `setTermId(id)` and possibly `setGate` with a value that may be
  the one already set. If nuqs pushes for those too, *Open glossary* on the term already selected
  adds a Back step that changes nothing. I left it, as older than this work; say if it is worth
  fixing here.
- `showBand` depends on `mode`, so its identity changes on every mode change, and with it
  `openTermInGlossary`, `citeActions` and the command `executor`. I believe nothing memoised on
  those is expensive.
- `usePressToggle` returns a fresh `trigger` object and `onClick` each render. Referee's button and
  the band's (i) are both cheap, and `Tooltip` clones its child anyway.
- `tests/structure-row-cards-may-drop-below.test.ts` reads source text. It is a tripwire, labelled
  as one; say if it is worth less than its upkeep.
- Item 1 on a wide window: without `keepSide`, `flip` now also checks the cross axis, so a mouse
  near the top or bottom edge could get a card somewhere new. A browser check is running separately.
