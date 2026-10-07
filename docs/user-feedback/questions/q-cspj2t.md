---
id: q-cspj2t
report: spya-rgq3f6
status: open
asked: 2026-10-07
title: One line in AGENTS.md: controls that do the same job look the same
refs: SPIDERYARN-READING2-E5 · qi-9sv8cha4 · docs/plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md · docs/user-feedback/261006_2142-design-system-refresh-controls-that-look-the-same-in-every-mode.md
---
Background. Your design-system report shipped. The controls that do the same job now look the same in every mode: the row that switches a mode's parts, the button that runs a mode's job, the text boxes, the order chips, the "waiting" line, the colour of a failure sentence, and bigger invisible targets for a finger. /design has a new section, Controls across modes, that shows one live example of each. controls.md now opens with the aim, in your words, and a table of the shared piece for each kind of control and the test that holds the modes to it.

You also asked for a minimal edit to AGENTS.md. Edits to AGENTS.md need your yes first, so nothing there has changed. Today AGENTS.md says nothing about this. An agent adding a mode reads AGENTS.md on every turn, but it only finds controls.md if it goes looking.

The proposed line would go in AGENTS.md § Writing code, after "Prefer simple over easy":

"A control that does the same job looks the same in every mode. Reuse the shared piece (part-switcher, run button, text box, order chips, wait line, failure sentence, hit area, shadow) rather than drawing a new one. Greg, 2026-10-07. The list, and the test that holds each: controls.md § Controls that do the same job look the same. See them live at /design § Controls across modes."

A. Add the line as written. Costs about 60 words that every agent reads on every turn. Gives: a new mode starts from the shared pieces without anyone having to remember controls.md exists.

B. A shorter line: "Controls that do the same job look the same in every mode: controls.md § Controls that do the same job look the same." About 20 words. It still points the way, but it doesn't say what the shared pieces are.

C. Leave AGENTS.md alone. controls.md and /design carry the aim, and the tests already fail when a mode moved onto a shared piece drifts back off it. Costs nothing. Gives up: a brand-new mode isn't held by those tests until someone adds it to them, so it could still arrive with its own design.

What would decide it: how much you want each new mode to start from the shared pieces, against the cost of words in a file every agent reads.

Recommended: B. It's the smallest line that still reaches an agent adding a mode, and the detail stays in controls.md, where it is kept up to date.
