# The Feedback dialog bigger still, and a green Send reply and a red Defer

Reports `spya-tfp3zw` (#552) and `spya-zjsqe6` (#553), both Greg's (an admin;
`scripts/feedback-reporter.ts` exit 0 on each production row), filed 2026-10-11 from
`/admin/vouchers`, both about the same dialog · worktree `fbtfp3zw-feedback-dialog-size-and-colours`.
Prior work: [261008i](261008i-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md)
(decision 12 made the dialog bigger once; decision 3 added Defer for now), and its note
[261008_1612](../user-feedback/261008_1612-needs-a-decision-threads-reply-defer-and-a-bigger-dialog.md).

> Make the feedback dialog box taller and wider still when the window is large enough.
>
> — Greg, 2026-10-11 (`spya-tfp3zw`)

> When replying in feedback needs a decision, can we have send reply button in green perhaps and the
> defer in red?
>
> — Greg, 2026-10-11 (`spya-zjsqe6`)

## What changes

1. **One more size step, for a large window.** Today: 34rem wide; from 1024px wide,
   `min(92vw, 46rem)`; from 1024×760, at least `min(90%, 44rem)` tall. Added: **from 1280px wide,
   `min(90vw, 56rem)`**, and **from 1280×900, at least `min(90%, 56rem)` tall**. The cap
   `max-height: 90%` of the visible strip is untouched, so a phone, and a phone with the keyboard
   up, are unchanged. All in `src/web/styles/feedback.css`.

   ```
   window width   <1024     1024–1279    ≥1280
   panel width    34rem     46rem        56rem      (each also capped by the window)
   window height  —         ≥760: ≥44rem ≥900: ≥56rem tall (both capped at 90% of it)
   ```

   **What it costs:** at the dialog's ~0.82rem text a 56rem line is roughly 120 characters, past a
   comfortable measure for the report and question prose. Greg asked for wider twice, and the
   dialog is mostly short items rather than long reading, so the width wins; a measure cap inside
   (a `max-width` on the prose blocks) is the follow-up if long lines bother him.
   *Simpler option passed over:* raising the existing 1024px step to 56rem. That makes a 1024–1279
   window's dialog almost full-width, which is where "when the window is large enough" says not to.

2. **Send reply in green, Defer for now in red**, in a *Needs a decision* thread only. Both keep
   their outlined `.fb-copy` shape; the colour goes on the text and border, hover included (a wash
   behind was dropped at plan review: it took Light under 4.5:1). Bring back (the same button on a deferred thread) stays neutral: it is not
   "defer", and red on an undo would say the opposite of what it does.
   - **Red is `--danger`**, the measured text red (4.5:1 on every surface, both themes,
     `tests/appearance-palette.test.ts`). It is named for error text; here it is a "not now" button.
     Reusing it rather than adding a second red is the simpler choice.
   - **Green is a new token, `--positive`**, in `styles/tokens.css`, a dark and a light value, held
     to 4.5:1 on `--page`, `--panel` and `--surface-raised` in both themes by adding it to the same
     test's pairs. There is no green text token today: the only green is `--div-rg-*`, a data scale
     with one value for both themes, and `--div-rg-7` on the light theme's white is about 2.6:1.
   - **Scope:** `FeedbackSendBox` is shared with the addendum box (plan 261010o). The colour goes on
     through classes the thread's `ReplyBox` passes (a wrapper class for Send, a class on Defer), so
     the addendum box's Add is untouched — Greg asked about the reply in *Needs a decision*.
   - **Colour-blind:** red and green are the pair a deuteranope cannot tell apart. Here the words
     ("Send reply", "Defer for now") carry the meaning and the colour is a shortcut, which is the
     condition `colour-scales.md` sets for a red/green pair.
   - Disabled Send (empty box) keeps its 0.45 opacity, so it reads as a faint green.

## Tests

- `tests/appearance-palette.test.ts`: `--positive` on the three surfaces, both themes, ≥4.5:1 —
  red first (the token does not exist), then green.
- `tests/feedback-dialog.test.tsx`: in a waiting thread, Send reply carries the green class and
  Defer for now the red one; Bring back on a deferred thread carries neither; the addendum box's
  Send carries no colour class.
- A stylesheet check (in the same file, reading `feedback.css`) that the green and red rules use
  `var(--positive)` and `var(--danger)`, and that the 1280px steps exist with the widths above.
- Browser: a Sonnet subagent at 1440×1000 and 1100×800 and 390×740, light and dark, screenshots.

## What the plan review changed

GPT Sol, read-only, APPROVE WITH CHANGES
([prompt](261011h-feedback-dialog-plan-review-prompt.md),
[answer](261011h-feedback-dialog-plan-review-sol.md)). All four taken: (1) no wash behind the
words, since it took Light's contrast under 4.5:1; (2) hover selectors that outweigh
`.fb-copy:hover` for colour *and* border, tested; (3) `--positive` added to `/design`'s swatches;
(4) the `--div-rg-*` rationale corrected — it does have light values.

## Not done

Nothing deferred: both are the afternoon-sized version already.
