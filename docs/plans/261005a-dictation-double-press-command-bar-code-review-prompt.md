# Code review: a double press on Stop, in the command bar, presses Enter

You are reviewing **and fixing** one committed stage, in this worktree. You may edit files. You
cannot commit; leave your changes in the working tree.

- **Fix what is inside this stage**, narrowly, each finding red-first with the test that reproduces
  it.
- **Report, do not fix, anything wider** you notice, so the caller can decide.
- **Do not write anything as a quotation of Greg.** His only words on this are quoted below; if a
  doc needs them, copy them exactly and add none.

## Background

`docs/plans/261005a-dictation-double-press-on-stop-also-sends.md` built a double press on the
dictation Stop button for five text boxes: press Stop twice quickly and the box's own done action
runs once the transcript arrives. You reviewed that plan and that code. The command bar was
deferred to a question for Greg, who answered on 2026-10-05:

> Q-double-stop-elsewhere yes for the command bar

and, in the brief for this stage, asked that the bar "runs whatever it would run on Enter for that
phrase, having said that it will, exactly as the five boxes already do", reusing the shared hook
and button, and that where the phrase matches nothing and goes to the model picker "the double
press should do what Enter does there too, including showing a proposal rather than running
anything Enter wouldn't run". One press stays as today. Illustrated stays without it.

## The candidate

- Commit `8ac1d0f6d`, on top of `5533ab001`: `git show 8ac1d0f6d`.
- Changed paths, complete: `src/web/CommandBar.tsx`, `src/web/DictationStrip.tsx`,
  `src/web/help/help-topics.tsx`, `src/web/help/help-modes.tsx`,
  `tests/command-bar-double-stop.test.tsx`, `docs/project/dictation.md`, and the plan (its new last
  section, "The command bar, built").
- `src/web/useDictationField.ts` is **unchanged**. That is a claim to check, not a given: say if
  the bar needed something from the hook that it did not get.

## The conclusion to check

**"A double press in the command bar can run nothing that a fresh Enter press on the same words, at
the moment the words arrive, would not run; and it runs at most once."** Try to break that
sentence. Then the weaker ones:

1. `enter` is called from the hook's effect, one render after the ending, through `enterNow`. Is
   `active` (the selected row) in that render the first row for the *transcribed* draft, on both
   the Chromium path (live words already in the box, the transcript replaces them) and the
   Safari/Firefox path (empty span, the transcript is an insertion)? Could `selected` be non-zero
   and point Enter at a row the reader never looked at? Could a stale suggestion list (`suggested`)
   from an earlier ask be what `active` comes from?
2. The Enter key handler refuses `e.repeat` and IME composition before calling `enter`. The double
   press has neither. Is there an equivalent hazard — in particular, can a double press both *ask*
   and then *confirm* the answer, which is what the `e.repeat` rule exists to stop?
3. The bar stays mounted when shut. `onDone` checks `open`, `doneKey` is `open ? "open" : "shut"`,
   and an existing effect stops the microphone on close. Shut during the 600 ms window; shut after
   the second press; shut and reopen before the transcript; navigate away (the Dock unmounts).
   Does anything run, and does the strip keep promising?
4. `onDone` is withheld while `said.kind === "pending"` (a run starting). `said` can change between
   the Stop press and the ending. Can the promise be made and then silently not kept, or the other
   way round? Is that worse than what a typed Enter does in the same state?
5. `inFlight`, `dictationBusy` and `canAsk` inside `activate` and `ask`: at the effect's render, are
   they the values a fresh Enter would see?
6. The words. `DONE_WORDS` in `DictationStrip.tsx`: is "Press Enter when the words arrive" /
   "then pressing Enter…" true in every case the bar can reach (a signed-out reader with no match,
   where Enter does nothing, included)? Are the five existing boxes' words byte-for-byte what they
   were?
7. Whether `docs/project/dictation.md` and the two `/help` sentences are true of the code.
8. The test: `tests/command-bar-double-stop.test.tsx` stubs `useDictation` and drives the real
   `useDictationField`, `DictationButton`, `CommandBar` and `Dock`. Does any test in it pass for the
   wrong reason? Three of the eight ("one press", "no transcript", "shut") passed before any code
   was written.

Tests you can run: `npx vitest run tests/command-bar-double-stop.test.tsx` and any other single
jsdom test file (`tests/command-bar-pick.test.tsx`, `tests/dictation-double-stop-sends.test.tsx`,
`tests/dictation-double-stop-sends-real-hook.test.tsx`). You have no network and no Postgres; a red
inside your sandbox from a test that spawns a process or writes a temp file is not yet a finding.
Do not run `npm test`.

## Output

Findings with stable IDs `D1`, `D2`, …, each graded by consequence, each saying **fixed** (with the
test that went red first) or **reported**:

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | a reader-visible wrong result, or a promise on screen that is not kept |
| P2 | a correctness risk that needs an unusual sequence, or a doc that is false |
| P3 | clarity |

End with one line: **ship**, **ship with the fixes made**, or **do not ship**, and the list of
files you changed.
