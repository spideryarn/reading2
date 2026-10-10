# A ghost suggestion is not input

`gjd-remote tell <session>` and the dashboard's message box refused `input-not-empty` whenever
Claude Code was showing a **ghost suggestion** in its input box: the dim, pre-filled next prompt
(`carry on`, `go ahead`) it proposes after a turn, or the `Try "refactor <filepath>"` hint a new
session shows. Neither is in the input buffer; the first keystroke replaces it. Postmortem:
[261010b](../postmortems/261010b-ghost-suggestion-read-as-typed-input.md). Owner area:
[fleet-and-overseer-overview.md](../project/fleet-and-overseer-overview.md).

## Evidence

- `tmux capture-pane -p -e`, read-only, on all six sessions on the box with a prompt line at
  2026-10-10 19:00: every one was `ESC[39m❯ NBSP ESC[2m<suggestion>ESC[0m`. SGR 2 is dim.
- A throwaway Claude Code 2.1.296 under its own tmux server (`-L ghostprobe`, killed afterwards; no
  existing session was touched): typed text, Ctrl+J multi-line input, a short paste and the
  `[Pasted text #1 +11 lines]` pill all render with **no attribute** after `❯ `; the first-run hint
  renders dim; typing over the dim hint leaves only the typed text.
- The binary (2.1.296) hides the suggestion whenever the input is non-empty
  (`suggestion = isAssistantResponding || hasInput ? null : text`), and counts an Enter as accepting
  it only when the submitted text equals it. So `send-keys -l <ours>` then `Enter` submits ours.
  A live ghost could not be produced in the throwaway session (no suggestion arrived after two
  Haiku turns), so this half is from the code, not observed.

## The change

1. `pane.ts`: `capturePane(paneId, form)` with `CaptureForm = "text" | "attributes"` (`-p` or
   `-p -e`). Default `"text"`, so every other caller is unchanged.
2. `pane.ts`: `undimmedLines(capture)` — the capture with ANSI stripped and every dim character
   blanked, preserving positions so occupancy excludes only the original prompt marker. SGR state
   is tracked across lines (tmux writes attribute *changes*), extended colour
   parameters skipped so `38;2;…`/`38;5;2` are not read as dim. `paneSurface` keeps all geometry
   (prompt line, borders) on `cleanLines`, and judges occupancy on `undimmedLines`. If the two
   disagree on line count it falls back to the attribute-blind reading.
3. `steer.ts`: `SteerIo.capture(paneId, form)` with `form` required; `sendMessage` asks for
   `"attributes"`, `answerQuestion` keeps `"text"` (the form the dashboard parsed the dialog in, so
   `sameQuestion` compares like with like).

Fail-safe direction: a plain capture has no SGR, so nothing is removed and it reads exactly as
before. Mixed dim and undimmed text in the box is occupied. Any parameter we do not understand
clears dim.

## The simpler option passed over

Treating a short single line after `❯` as a suggestion, or matching known suggestion wording, needs
no `-e`. Rejected: it is a guess about content, and a person's one-line draft looks exactly like a
suggestion in plain text — the guess would fail in the direction that types onto their words.

## Tests

- `tests/fleet-pane-surface.test.ts`: a real `-e` capture (`none-ghost-suggestion-ansi.txt`) is
  `empty-input`; the same screen with typed text, typed text plus a dim tail, `38;2`/`38;5;2`/colon
  colour forms, `2;22`, and a typed continuation under a dim prompt line are all `occupied-input`;
  a dim run carried across a line break is still empty.
- `tests/fleet-steer.test.ts`: `sendMessage` sends exactly our text and Enter over the ghost fixture,
  refuses the same screen with the text undimmed, and asks for `"attributes"` while
  `answerQuestion` asks for `"text"`.
- Read-only on the live box: `paneSurface` on plain vs `-e` captures of all 20 panes. The six ghost
  panes moved `occupied-input` → `empty-input`; the other 14 agreed, and `parsePane` gave the same
  answer on both forms for all 20.

## Code review corrections

The review reproduced two bugs before fixing them: deleting a dim prompt marker let a typed
`DRAFT❯` become `empty-input`, and `stripAnsi` left colon-form SGR in the geometry and could lose
dialog recognition. Dim characters are now blanked, occupancy uses the original marker column,
and both text readings share the complete CSI parameter range. Unknown or incomplete SGR now
clears dim as promised; tmux's current encoder normalizes these away, so this is a conservative
fallback rather than an observed pane format. OSC metadata is removed before SGR interpretation.
Regression tests cover the reproductions, colour/reset variants, hyperlinks, dialog parity and
the real capture adapter's flags, using a mocked subprocess. See the postmortem for the bug class.
