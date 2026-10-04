# Plan review: Search results get the room on a landscape iPad

You are reviewing a plan, read-only. Do not change any file.

**Candidate (live, pre-commit).** Base `8019e35494c72bf66ce7f448d2beeed30585cba8`. One untracked
file is the candidate: `docs/plans/261003p-search-results-get-the-room-on-a-landscape-ipad.md`.
Nothing is built yet. The code it proposes to change is `src/web/SearchPanel.tsx` (`Legend`,
`ConfSlider`, `Results`, `Hit`, `HitCard`), `src/web/styles/search.css` (`.srch-saved-wrap`,
`.srch-hits`, `.srch-legend`), `src/web/styles/glossary.css` (`.srch-gate*`),
`src/web/threshold.ts` (`hiddenNote`), and the tests `tests/glossary-band-wiring.test.ts`,
`tests/mode-surface-changes-no-markup.test.tsx`, `tests/search-hit-card-on-the-score.test.tsx`.
The owner doc is `docs/project/search.md`. That list is where to start, not a limit on scope.

**The request** is from the product owner and is quoted in full at the top of the plan. He decides
the product; do not argue whether the legend or the line should go. Do say if the plan misreads him.

**Independent pass first.** Read the plan against the code and attack it:

- Is each statement the plan makes about the current code accurate (what is a scroller, what the
  40% cap does, what the gutter button opens, which tests pin what)?
- Will the proposed changes do what the arithmetic table claims? Is there a layout consequence the
  plan has not seen (other window sizes, a phone, the narrow-window rules in
  `src/web/styles/narrow-window.css`, a visitor's read-only panel, the empty and all-hidden states,
  words mode)?
- Is anything else in the tree depending on the legend, on the foot line being unconditional, or
  on the 40% cap, that the plan does not list?
- Is the test list enough to go red before the change and to notice a later regression?
- Is there a simpler change that gets the same room?

**Severity scale (grade by consequence):** P0 data loss, exploitable security, incorrect charging,
service broadly unusable. P1 user-visible wrong behaviour, or an authoritative contract violated.
P2 design or maintainability risk with no wrong behaviour today. P3 non-behavioural prose defect.
Refuse only on an *established* P0 or P1 (direct evidence, no unresolved material inference);
reasoned findings rank and inform but do not block. Give every finding a stable ID, `PR-1`,
`PR-2`, ….

**My own suspicions, last, and worth less than your own pass:**

- Whether a tap on a touch screen really opens the gutter card (`Hit` in `SearchPanel.tsx`, the
  controlled `Tooltip`). A Playwright `touchscreen.tap` did not open it and a synthetic click did.
  Read the Tooltip component and say what you think a real tap does.
- Whether keeping the foot line when something is hidden, and dropping it only at zero, is the
  right reading of "we can get rid of that … n of m above kind of answers that".
- Whether 25% is too small for the saved list on a short window (a phone in landscape).

End with one line: `VERDICT: approve`, `VERDICT: approve with changes`, or `VERDICT: refuse`, then
the findings by ID.
