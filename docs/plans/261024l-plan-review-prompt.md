You are reviewing a plan, read-only. Do not edit any file.

The plan is docs/plans/261024l-the-chat-card-in-the-margin-gets-the-room-left-of-the-prose-at-every-width.md.
The quoted words attributed to Greg in it are his (the product owner); everything else in the plan,
including the attribution of a recommendation to Opus, is the planning agent's own words and carries
no authority from Greg.

Read, in this order:
- the plan;
- src/web/layout.ts: `fitMargin`, `shiftForCard`, `margTitleReserve`, `fitBoth`, `widened`,
  `chatCard`, `chatDock` (roughly lines 540–800 and 1040–1133);
- tests/layout-margin.test.ts (the tests that pin today's shift);
- docs/project/marginalia.md § "The column is wider on a wide window" and § "From a 1600px window
  the prose moves left, for the chat card";
- src/web/styles/dialogs.css § `.chat-card-host`, `.chat-dialog.in-column`;
- anything else you need (src/web/reader/Reader.tsx near `chatCard(` for how the card width is
  used; src/web/styles/narrow-window.css and marginalia.css for how `--marg-reserve` and the title
  follow).

Check:
1. Is the arithmetic in the plan's tables right? Re-derive at least the four "expected" rows by hand
   from the code as it would be after the change.
2. Does removing the 1600px gate and the 100px cap and replacing "half of left" with "left − 4rem"
   break any other consumer of `margReserve` / `margLeft` / `margW` — the masthead title, the
   head `.marg-head`, the docked panel, the column of notes, `minWidth`, narrow windows where the
   column reserve (rule 2) is already pushing the prose left, small and large roots, the rail off?
3. Is there a window/root combination where the new rule does something visibly bad that the plan
   has not named (for example the prose jumping, the notes column becoming detached, a card wider
   than the room, prose touching the rail)?
4. Is the product reasoning sound against Greg's words: should the shift really apply when no chat
   card is open? Is 4rem a sensible keep? Is there a simpler or better option the plan missed?
5. Are the planned tests the right ones to catch a regression (e.g. would they go red if the shift
   were reintroduced only above 1600px)?

Answer with a verdict (go / go with changes / no-go) and numbered findings, each with the evidence
(file:line or the arithmetic). Keep it under 900 words.
