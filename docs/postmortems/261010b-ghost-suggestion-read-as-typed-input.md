# A ghost suggestion was read as typed input

`gjd-remote tell` and the dashboard's message box refused every session showing Claude Code's
ghost suggestion — the dim `carry on` it pre-fills after a turn — with `input-not-empty`, as though
somebody had left a draft there. At 19:00 on 2026-10-10 that was all six sessions on the box sitting
at a prompt. Nothing was sent wrongly; messages simply could not be sent. Plan:
[261010m](../plans/261010m-ghost-suggestion-is-not-input.md).

## Root cause

`paneSurface` (`tools/fleet/pane.ts`) decides whether the input box is empty from a
`tmux capture-pane -p`, which drops every attribute. Claude Code draws its suggestion and its
first-run hint with SGR 2 (dim) and typed text with none, so the one property that separates them
was thrown away before the parser saw the screen. The emptiness check arrived with `d3aac3211`
(2026-09-08, plan 260908f), which knew the suggestion existed and named the arm `occupied-input`
rather than `drafted-input` because "a capture cannot tell" — true of the capture it was given, not
of the terminal.

## The class

**A screen reading that drops attributes cannot tell suggestion from input.** Any time a terminal
UI uses styling to mean something (dim = not real, inverse = cursor, colour = selected), a plain-text
capture collapses two states into one, and the parser built on it is right only about the capture,
never about the program. The safe-direction default (refuse) hid it as an availability bug rather
than a correctness one.

## The fix

`sendMessage` now captures with `-e` and `paneSurface` judges emptiness on the capture with dim
characters blanked, tracking SGR across lines and skipping extended colour parameters. Geometry and
dialog parsing still run on the stripped text; `answerQuestion` keeps the plain capture. A plain
capture still reads as before, so the old safe default survives anywhere attributes are absent.

## What would have caught it

A fixture taken with `-e` of the state the plan already knew about. The corpus had three `-ansi`
captures, all dialogs; none of an input box. When a plan says "the capture cannot tell X from Y",
the next question is whether the *terminal* can — capture once with every flag before concluding.

## Review caught a second class before landing

**Lossy filtering followed by locating a delimiter again can erase real input.** With a dim
structural `❯` followed by non-dim `DRAFT❯`, deleting dim characters left `DRAFT❯`; the occupancy
check took the typed marker for the structural one and discarded the whole draft. This was in the
uncommitted change, not an earlier commit. A read-only subagent independently reproduced it.
Blanking preserves positions, and the original line supplies the only marker column to exclude.
The regression now asserts both `occupied-input` and a send refusal with no keys emitted.

The review also caught colon SGR left in the geometry by `stripAnsi` (tmux emits `4:3m` for
curly underline), and the promised unknown-SGR fallback retaining dim. The new cases failed before
the fixes; tests now compare attributed and plain dialog readings and keep uncertain text visible.
