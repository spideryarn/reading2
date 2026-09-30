# Trajectory: the (i) on the controls row, and ‹ › name their keys

[SPIDERYARN-READING2-73](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-73) and
[SPIDERYARN-READING2-74](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-74), two
suggestions from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), both sent from
Trajectory on `bf03197835-spya-qfwsw2`. One batched note for both. The time in the file name is when
this session picked them up; it had no Sentry access, and the report text came in the brief. **No
`reports:` header**, because the feedback row ids were not in the brief. The next sweep adds them.

> Can we save vertical screen real estate by moving the (i) icon that's at the top of the Trajectory
> mode onto the same row as the other UI widgets like previous and next and gist and more
> sub-modes, etc.

> Add tooltips for the previous and next buttons in the trajectory mode, explaining what they are
> briefly and especially showing the keyboard shortcuts.
>
> And more generally, any time we have a keyboard shortcut, it should be mentioned in the relevant
> tooltip. So perhaps you could make a note of that in tooltips.md and the doc about keyboard
> shortcuts, and maybe even the docs about design or icons. Perhaps mention it in one with
> signposting to that as the single source of truth from the others.

**Ending: Shipped** (both). On `dev`, not deployed. Resolve 73 and 74; the next feedback sweep does
the Sentry status write.

- **73:** the (i) had been overflowing the 400px band's header by about 13px, onto a row of its own.
  It now shares the row with ‹ › and Gist · More · Most. On a long route, or a phone, the header
  still needs two rows, and then the (i) goes to the second row with the depth buttons. It never has
  a row to itself.
- **74:** ‹, › and the door's *Next stop ›* have cards saying what they do and *While reading, press
  ←.* On a touch device a tap still steps at once. The rule has one home,
  [tooltips.md § A shortcut is named on its card](../project/tooltips.md#a-shortcut-is-named-on-its-card),
  with signposts from keyboard.md and icons.md.
- **Waiting on Greg:** design-css-overview.md is a rule doc, so it was not edited. The proposed
  line, under its signposts, is: *"A control with a keyboard shortcut names the key in its tooltip —
  tooltips.md § A shortcut is named on its card"*, linked as `tooltips.md#a-shortcut-is-named-on-its-card`.
- **Not done:** no sweep of every other shortcut in the app. That is a queue candidate, and so are
  › staying natively disabled at the end of a pass, which means its card cannot open there, and a
  stale route's missing stop, where a step lands nowhere.

Plan: [260930h](../plans/260930h-trajectory-info-button-on-the-controls-row-and-shortcut-keys-in-tooltips.md).
