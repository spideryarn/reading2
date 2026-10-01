# A quieter Experimental switch, tooltips on the vertical lines, a readers-only filter in /admin/feedback

Three small admin suggestions from Greg, batched (Overseer queue `qi-y9dcfe2c`). Each ends on its
own; the note is
[261001_0951-quieter-switch-line-tooltips-readers-only-filter.md](../user-feedback/261001_0951-quieter-switch-line-tooltips-readers-only-filter.md).

## 1. The Experimental switch, quieter (SPIDERYARN-READING2-80, `spya-sz8qzx`)

> It's nice that we have the toggle for Experimental features in the bottom bar. But when it's
> toggled on, it's too visible/emphasised somehow - the whole "Experimental" button is orange, and
> the toggle is an even brighter orange. Please de-emphasise.
>
> — Greg, 2026-10-01

Today, when the setting is on, two things are orange at once:

```
TODAY (on)                               AFTER (on)
┌──────────────────────────┐             ┌──────────────────────────┐
│▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔│ orange top  │                          │
│ ⚗ Experimental [━━━●]    │ orange wash │ ⚗ Experimental [▓▓▓●]    │ bar's own ink
└──────────────────────────┘ orange text └──────────────────────────┘
   .dock-btn.on                 track filled in --highlight     track filled in currentColor
```

- **The button stops wearing `.on`.** That class is the bar's *selected* look — the wash, the top
  rule and the orange ink a mode gets when you are in it. This button is a toggle, not a place you
  are, and the drawn switch already says on or off; the lit frame was saying it a second time, loudly.
  `aria-pressed` is untouched, so nothing changes for a screen reader.
- **The track, when on, is filled in `currentColor`** — the button's own ink — with the knob in
  `--page`, instead of brand orange. Filled-and-knob-right versus outline-and-knob-left is the whole
  on/off signal and needs no colour. Hover still turns the button (and so the switch) orange, the way
  every button in the bar does.

Simpler option passed over: keep `.on` and just soften the switch. It leaves the half Greg named
first ("the whole button is orange").

## 2. Tooltips on the vertical lines (SPIDERYARN-READING2-84, `spya-vskqfn`)

> There are vertical lines now next to some blocks. What are they for? They should ideally have
> tooltips to explain themselves.
>
> — Greg, 2026-10-01

**Which lines.** A sweep of every rule that can be drawn beside a prose block found two that fit
*"now"* and *"some blocks"*, both behind the Experimental switch, both in the build he filed from
(`4de26073`):

| Line | Where | Blocks | Tooltip today |
|---|---|---|---|
| **Reading time** — darker the longer you have read there | left, between the gutter and the text (gutter.css § reading time) | only the ones you have read | a native `title`, **but not on the line** — see below |
| **Annotations' question rule** — the question this part answers | right, in the Annotations column (marginalia.css `.marg-question`), new 2026-10-01 | only the ones with a question note | none |

The first is the strong candidate: Greg reported the same line on 2026-09-29 in nearly the same
words (SPIDERYARN-READING2-4S — *"a vertical grey line to their left … At the least, a tooltip?"*),
and that report shipped a tooltip. Reading the CSS says why he cannot have found it:

```
           gutter (pointer-events: none)  │ gap before the text
                                         ││
  the line, ::after, left: -2px  ──────▶ ▌│░░░░░  ◀── .blk-read, the hover strip:
  pointer-events: none                    │        left: 100%, ≤ 5.6px wide
                                          ▲
                              the strip starts where the line ends
```

The hover strip begins *to the right of* the 2px line, so pointing at the line itself lands on the
gutter, which takes no pointer events: nothing happens. The tooltip is only in the 5.6px of blank
space beside it. **Confirmed in the browser before the fix** (Playwright against system Chrome,
`wisdom-spya-vkvttk` at 1400px, `--read: 3` injected on five rows): the strip's box is
x 337.7–343.3; the line is x 335.7–337.7; `elementFromPoint` at the line's centre returns
`td.text`, with no title anywhere above it, and an actual hover there reveals the gutter's
*"More for this paragraph"* button instead. Half a pixel to the right of the line, the strip and its
title are found.

What changes:

- **The reading-time strip covers its own line**: it starts 3px left of the gutter's edge (the
  2px line plus 1px) and is 3px wider, and the line is drawn at the same place on screen, now inside
  the strip. The line does not move; only the target does. 3px and not more because the gutter's
  own 24px buttons end at that edge (the hover above found one), and every pixel the strip takes is
  a pixel of theirs. Still
  `pointer-events: none` while the gutter's "…" panel is open (the reason is in gutter.css), still
  zero-width on a row you have not read.
- **The question rule gets a `title`:** *"A question this part of the article answers. Read on to
  find the answer."* A native `title`, as the gutter's controls use, on the whole note — the rule is
  1px and the words beside it are the larger target.

Deferred, as 4S already deferred it: nothing on touch (a `title` does not show on a tap), and no
faster styled tooltip in place of the native one's ~1s delay. If Greg meant a third line, the note
asks him which side it was on.

Simpler option passed over: a legend or "what is this?" row somewhere. A tooltip is what he asked
for, and the bug is that the one we have cannot be reached.

## 3. A readers-only filter in /admin/feedback (SPIDERYARN-READING2-87, `spya-b23bqq`)

> In /admin/feedback/ , provide a filter to show only non-admin suggestions (i.e. suggestions from
> people other than me).
>
> — Greg, 2026-10-01

**Reading of "suggestions":** every report from somebody who is not an administrator, whatever its
kind. Most reports have no kind or are *problem*; filtering to `kind = suggestion` as well would hide
exactly the readers' bug reports Greg most wants to see, and the kind chip is already on each card.
If he meant the kind too, that is a second, separate toggle — deferred.

**Where it filters: the server, not the browser.** The list is paged (a keyset cursor, 200 at a
time by the server's default). Filtering in the browser would give a page that is all Greg's own reports as *zero reports,
there are older ones* — and a filter that quietly shows fewer than it should is the silent-success
shape. So:

```
/admin/feedback  [ Everyone | Readers only ]          ← two-button toggle, aria-pressed
        │
        └─ GET /api/admin/feedback?from=readers[&before=<cursor>]
                 │  any other `from` value → 400 (never quietly "everyone")
                 └─ listFeedbackAcrossOwners(limit, cursor, "readers")
                        where owner_id NOT IN ADMIN_USER_IDS     (src/admin.ts)
```

- **Who counts as an admin is `src/admin.ts`, and nothing else.** The SQL uses `ADMIN_USER_IDS`,
  the same list `isAdmin` reads; a test pins that every reader the filter keeps is one `isAdmin`
  refuses and every one it drops is one `isAdmin` accepts, so the two cannot drift.
- **It changes nothing about who can reach `/admin`.** The `/api/admin` gate above the route table
  is untouched; this is one more query parameter on a route already behind it.
- **The cursor carries no filter**; the client sends `from` with every page, and switching the
  toggle reloads from the top.
- **Not in the address bar** in v1 — the toggle is component state, so a page reload goes back to
  *Everyone*. Deferred until it bites.

## Stages

1. Switch (80): red test that the button carries no `.on` when on, and dock.css's on-track uses no
   `--highlight`; then the change.
2. Filter (87): red store test (filter drops admin-owned rows, pages correctly), red route test
   (`?from=readers` filters, `?from=bogus` is 400); then store, route, hook, page.
3. Lines (84): confirm in the browser that the line's own pixels have no tooltip; red tests (the
   strip's box contains the line; the question note has a `title`); then the change; browser again.
4. Browser check, desktop and 390px; GPT Sol code review; gates; note; push.

## Changed by GPT Sol's plan review

[The review](261001l-quieter-experimental-switch-tooltips-on-the-vertical-lines-readers-only-filter-in-admin-feedback-plan-review-sol.md)
found two blockers and three smaller things; all five were taken.

- **P1, the reading-time strip.** Widening the strip 3px back over the gutter would have taken the
  right edge of every gutter button's click — the trade gutter.css already records being refused on
  2026-09-29. So **the line moves instead**: drawn at the strip's own left edge (`left: 0`), 2px
  right of where it was, inside the box that carries the title. The strip's size is unchanged.
- **P1, the filter's race.** `useAdminFeedback`'s in-flight guard would drop the reload a switch
  asked for while *Load older* was running, and the older everyone-page would land under *Readers
  only*. So the inbox is a child **keyed on the filter**: a switch mounts a fresh one, with its own
  guard and cursor and no reports, and the old one's late answer reaches nothing.
  `tests/admin-feedback-from.test.tsx` answers the two requests out of order, and goes red without
  the key.
- **P2:** `?from=` with an empty value is a 400, not *everyone* — only an absent parameter is.
- **P2:** the comments that described the lit frame were rewritten with the change.
- **P2:** the page is 200 reports by the server's default, not 50 (corrected above).

## Built, checked, reviewed

**Browser** (Playwright against system Chrome, 1400px and 390px): the switch on is grey, filled,
knob right, no `.on` and no orange until hovered; off is an outline, knob left. The reading-time
line's own pixels now find `span.blk-read` and its title; one pixel left of it is still the cell,
and the hovered row's "…" button keeps both its edges. Annotations' question notes carry their
title. `/admin/feedback`: 24 reports under *Everyone*, 4 under *Readers only* (none by the dev
admin), the request carrying `from=readers`, no sideways scroll at 390px.

**GPT Sol's code review**
([answer](261001l-quieter-experimental-switch-tooltips-on-the-vertical-lines-readers-only-filter-in-admin-feedback-code-review-sol.md))
found three P2s and fixed them: the superseded request is now aborted on remount rather than left to
finish (StrictMode-safe); the route test now proves the filter reaches the store, not just that the
status is 200; and a stale "there is no pagination" comment in src/types.ts. Its sandbox could not
reach Postgres, so those two suites were run here: green.

**Status: shipped to `dev`**, not deployed.
