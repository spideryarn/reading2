# A control moved by its own press

Up: [postmortems.md](../project/postmortems.md). The plan and its evidence:
[261008d](../plans/261008d-dictation-button-holds-still-and-why-the-iphone-asks-again.md).
Fixed in `96124f2c2`.

> I was hoping to double-click to save what I just said and send in one go. But the button moves as
> soon as it gets pressed because it switches to "turning into text", and so I couldn't double-press
> it fast enough.
>
> — Greg, spya-pd9fnc, 2026-10-08, on `?mode=chat`

## What happened

[261005a](../plans/261005a-dictation-double-press-on-stop-also-sends.md) made a second press on the
dictation button, within 600 ms of Stop, mean "send when the words arrive". In Chat the first press
moved the button 28.7 px down, so the second tap landed above a 36 px button and did nothing.

Three pieces, each reasonable alone:

- **The chat band is `position: fixed` with both edges pinned** (`mode-band.css`; the `bottom:`
  rule in its present form since `4eede51e5`, 2026-08-28). The composer is the band's last item, so
  it grows and shrinks *upwards*.
- **`DictationStrip` sits under the button row** in the chat composer, since `cf690017c`
  (2026-08-27). A line removed below the button therefore moves the button down.
- **The "Microphone: … Change" line (`.prof-mic-line`) is drawn only while `armed`**, from
  `051a9810c` (plan 261001q, 2026-10-01: "names the device on its own line for as long as dictation
  is on"). The hook also clears `deviceLabel` at Stop. So the line goes at the exact moment Stop is
  pressed.

Until `4c59b9d9c` (261005a, 2026-10-05) nothing pressed the button again during that moment, so the
shift was harmless. 261005a added the second press and assumed, without saying so, that the first
one leaves the button where it was. That assumption is the bug; `051a9810c` supplied the movement
and `4c59b9d9c` made it matter. Greg read the new wording, "Turning that into text…", as the cause
because it was what he could see change. It moves the row by 0.6 px.

## Why 261005a's browser check said Chat worked

It reported a double press sending exactly once in Chat at 1440, 820 and 390 px, on `4c59b9d9c`.
**The layout then was the one that failed today**: `4c59b9d9c` has `051a9810c` as an ancestor, its
strip gates the line on `dictation.armed && dictation.deviceLabel`, the strip is already below the
buttons, and the band is already bottom-pinned. Chrome's fake microphone has a label (`Fake Default
Audio Input`, per 261001q's own table), and 261008d's check, on the same fake device, saw the line
and measured the drop.

So the difference is almost certainly **how the second tap was aimed**. Playwright's
`locator.click()` and `locator.tap()` find the element again and aim at its centre *now*, so a
second press by locator follows a button that has moved. A person's thumb, and 261008d's check, tap
where the button *was*. This is inference: 261005a's script was not kept, and its write-up says only
"a double press". The two checks agree on everything else.

## The class: a control moved by its own press

**A control whose first press changes the layout that positions it, so the press that is meant to
follow lands somewhere else.** It is a sibling of
[an invisible target needs space at every layout boundary](261007l-an-invisible-target-needs-space-at-every-layout-boundary.md):
both are a target checked in one state of the layout while the user meets it in another. Here the
other state is a phase the press itself starts.

It recurs wherever a press flips a phase that something nearby draws from: a label that widens
("Listening…" → "Writing it down…" in Learn and Quiz, found by GPT Sol's plan review of 261008d),
a picker that closes, a status line that appears, a spinner that replaces a word. Each is fine for a
single press. Any gesture of two presses on one spot — a double tap, a press then a confirm in the
same place, a quick Stop then Start — turns it into a miss.

## The fix

**Shipped, and the long-term one:** keep the dimensions of everything that positions the control
the same across the phases its own press drives. `DictationStrip` remembers the last label it
showed while armed and keeps the line through `transcribing`, with "Change" drawn but disabled. The
"Couldn't use the microphone you chose" warning and an open picker stay too. `TalkLabel` holds both
words in one grid cell so its width does not change at Stop. The fix is in the shared strip, so
every box gets it.

Passed over: pinning the composer's `min-height` (fixes Chat only, and leaves a blank line after
the words land), and making the hook keep `deviceLabel` until the transcript lands (changes a fact
other readers of the hook rely on).

## What would have caught it, ranked by ease against value

1. **A double-press check taps twice at the first tap's coordinates**, not by finding the element
   again. Costs nothing, and is the only thing that would have made 261005a's check fail. Belongs in
   [browser-testing.md](../project/browser-testing.md) as a rule for any multi-press gesture; not
   written there yet, because this postmortem was asked to touch no other file.
2. **Assert the control's rect is unchanged across the phase change** its press drives, in the same
   browser check: read `getBoundingClientRect()` before the press and 50 ms after. A number, not a
   screenshot, and it says *why* a double tap fails rather than only that it does.
3. **A jsdom test that the strip draws the same lines either side of Stop.** Done in `96124f2c2`
   (`tests/dictation-strip-holds-still.test.tsx`, seen red first). Cheap and permanent, but it
   covers only lines the test knows to look for; jsdom has no layout, so it cannot see a width.
4. **A standing Playwright suite that taps every dictating box twice** — rejected for now. The
   repo runs no browser suite in its gates, and building one for this gesture alone costs more
   than items 1 and 2, which catch the class wherever a browser check already runs.
