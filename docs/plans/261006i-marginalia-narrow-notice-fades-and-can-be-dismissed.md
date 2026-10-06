# Marginalia's "needs a wider window" line fades, and can be dismissed

One of Greg's reports (admin; `feedback-reporter.ts` exit 0), Overseer queue item `qi-tdwvz53m`,
report `spya-u264yb`, Sentry `SPIDERYARN-READING2-DV`. Filed as a suggestion; it is a bug.

> It's fine that it shows the "The note need a wider window - press Marginalia again to swap them in
> for the panel" - that's helpful. But there's no way to dismiss it, and it doesn't fade after a few
> seconds.
>
> — Greg, spya-u264yb

## What is there today

With Marginalia on (`?margin=1`) and no room for its column, `MarginaliaHead`
([`MarginaliaColumn.tsx`](../../src/web/marginalia/MarginaliaColumn.tsx)) draws one sentence in a
fixed box at the foot of the window, `.marg-narrow`. There are two sentences: with a band open
beside the prose (700 to 899px), *"… press Marginalia again to swap them in for the panel."*; with
no band, *"… they sit to the right of the text."* It was added so that a mode that drew nothing
would not look broken ([261001d](261001d-annotations-mode-marginalia-in-a-right-hand-column.md),
[261001k](261001k-annotations-head-path-wraps-and-the-notes-swap-in-on-a-narrow-window.md)).

It stays for as long as that state lasts, over the bottom of the article, with no control on it.

**Prior work:** none. No plan, note or commit names this; the only live session on it is this one
(`fbdv-marginalia-notice-cannot-dismiss`).

## The change

Both of the things Greg names, since each is small and they share one bit of state:

1. **It goes by itself after about five seconds** (`TOAST_MS`, the number the app's one toast
   already uses), fading out. The clock stops while the pointer is over it or focus is inside it,
   as the toast's does, so it does not go while it is being read.
2. **It has a × button** ("Dismiss") that sends it away at once.

**It comes back when it is drawn afresh**, and not otherwise. Where the line is drawn at all, with
the rail on (GPT Sol's F2; the first draft of this table had the widths wrong):

| Width | No band | A band open |
|---|---|---|
| under 612px | **the line** ("they sit to the right of the text") | the band covers the window; no line |
| 612 to 699px | the notes fit; no line | the band covers the window; no line |
| 700 to 899px | the notes fit; no line | **the line** ("press Marginalia again to swap them in") |
| 900px and up | the notes fit | both fit |

(600, 688 and 888 with the rail off.) So the line is shown again after: Marginalia switched off and
on; the window widened until the notes fit and narrowed again; under 612px, a covering band closed;
a different article opened. It stays gone across scrolling and every other re-render. The two
sentences never follow one another in a line that stays mounted, so nothing keys on which it is.

Nothing is stored. "Gone" is one `useState` in a small component, `NarrowLine`, that owns the line;
every "shown again" above is that component being mounted afresh. That is the simplest thing that
keeps the line's original job: each time the reader newly ends up with Marginalia on and no notes,
they are told why once.

### Passed over

- **Remembering the dismissal on the device** (`localStorage`, as `SmallScreenHint` does). Then the
  line is seen once ever, and the next time Marginalia draws nothing there is no explanation — the
  thing the line exists to prevent. Greg called the line helpful; he asked for it to get out of the
  way, not to stop appearing. If it turns out to nag, this is the next step and it is small.
- **Only the ×, or only the fade.** Either alone answers half the sentence. The fade alone leaves
  five seconds with no way out; the × alone leaves a box that needs a press every time.
- **Using the `Toast` component.** It is in the bottom-right corner, says a thing has succeeded (a
  tick icon), and is a live region; this line is centred under the prose and is an explanation, not
  an event. What is worth sharing is the clock, below.

### One clock, not two

`ToastCard` ([`Toast.tsx`](../../src/web/Toast.tsx)) has the pause-aware clock inline: a timeout,
stopped while hovered or focused, resumed with only the time left. A second copy would be the same
twenty lines. So it moves into a hook in the same file, `useGoesByItself(ms, onGone)`, which returns
the four handlers (`onMouseEnter`, `onMouseLeave`, `onFocus`, `onBlur`) to spread on the element.
`ToastCard` uses it; the new line uses it too.

**One deliberate change to the toast comes with it** (GPT Sol's F4): the hover half listens to
pointer events and ignores a finger. A tap fires the hover family and nothing need say it has left
([touch.md](../project/touch.md)), so on a touch device a tap on either could have stopped the
clock for good. A finger that wants it gone has the ×. `tests/toast.test.tsx` moves from
`mouseover` to `pointerover` for that one case and is otherwise unchanged.

### The element stays in the document once gone

`.marg-narrow` is named by one rule elsewhere
([`narrow-window.css`](../../src/web/styles/narrow-window.css)):

```
.reader.band-covers:has(.mode-band, .marg-narrow) .small-screen-hint { display: none; }
```

On a touch device under 700px, that keeps the "designed for a larger screen" banner out of the top
of the article while Marginalia is showing its own line, because the banner's claim (a panel covers
the article) is false there. If the faded line were removed from the document, that banner would
arrive **in flow at the top of the article five seconds into reading it** and move the text.

So the line is not unmounted: it gets a class, `is-gone`, and the stylesheet makes it invisible
(`opacity: 0; pointer-events: none`). The fade is a `transition` on `opacity`, written only inside
`prefers-reduced-motion: no-preference`, so a reader who asked for less movement sees it simply go.
One boolean, no "leaving" state, no second timer.

**Invisible, not hidden, and that is for a screen reader** (GPT Sol's F6). The line is a plain
`aside`, not an announced status, so somebody using a screen reader finds it by moving to it, which
may well take longer than five seconds. `visibility: hidden` (the first draft) would have taken the
explanation away from them before they got there, where today it stays. With `opacity: 0` the
sentence is still in the accessibility tree, exactly as before this change. Only the × is hidden
outright (`visibility: hidden`), since it would otherwise be an invisible tab stop. Passed over: a
live region that announces the sentence — it would interrupt on every arrival, for a layout fact.

A side effect, accepted: the small-screen banner stays hidden after the line has gone, for as long
as Marginalia is on in a window too narrow for it. That is today's behaviour for the same state.

### What the reader loses

After the line has gone, the Marginalia button is still pressed and there are no notes, with
nothing on screen saying why. That is what was asked for, and the line was read (or dismissed)
first. The button's own hover card is unchanged.

## Files

- `src/web/Toast.tsx`: the clock becomes `useGoesByItself`; `ToastCard` uses it.
- `src/web/marginalia/MarginaliaColumn.tsx`: `NarrowLine`, drawn by `MarginaliaHead` when `!room`.
- `src/web/styles/marginalia.css`: the box becomes a row (sentence, ×), `.marg-narrow.is-gone`,
  the fade. The × wears `.close-x` (32px, 40px under a finger: GPT Sol's F5), and
  `tests/close-cross.test.ts` now checks it sets no size of its own.
- Tests, below. Docs: `narrow-windows.md` (the line), `web-client.md` (the hook).

No defence, schema, prompt or published sentence is touched. The two sentences are unchanged.

## Tests, red first

`tests/marginalia-narrow-notice.test.tsx`, fake timers, against `MarginaliaHead` directly. The
first draft was written before the change and **seen red: 7 of 8 failed** against `c8653726` (the
eighth, "says why there are no notes, and is showing at first", is the positive control). One of
the seven failed for the wrong reason, a `TypeError` in the test's own stylesheet read (F1), and
was corrected. The cases added after the plan review (marked †) were written with the code, so not
seen red on their own.

- goes by itself at `TOAST_MS`, not a millisecond before;
- † a re-render part-way through does not start the clock again;
- waits while a mouse is over it, then counts only what was left;
- † does not wait for a finger (`pointerType: "touch"`) — the mouse case beside it is what shows
  the test can tell the two apart;
- † waits while focus is on its button, then counts only what was left;
- the × sends it away at once, and is named "Dismiss";
- once gone the sentence is still in the document, the box's rule has `opacity: 0` and no
  `visibility` or `display`, and the button's has `visibility: hidden`;
- comes back when the room returns and is lost again;
- stays gone across an ordinary re-render.

The page, `tests/every-mode-draws-its-surface.test.tsx` § the notes beside a band: at 590px the
line has a Dismiss that works; opening a band removes the line; closing the band shows it again,
not already gone. (Closed by a second press of the band's button. Plain closes the notes too.)

The page-level tests that already find `.marg-narrow` read it straight after opening and hold
unchanged.

A browser check on the box (Playwright, a Sonnet subagent) at 800px with a band and at 590px
without: the line shows, fades at about five seconds, the × works, and nothing moves when it goes.

## GPT Sol's plan review, and what changed

[261006i-marginalia-narrow-notice-plan-review-sol.md](261006i-marginalia-narrow-notice-plan-review-sol.md),
on [its prompt](261006i-marginalia-narrow-notice-plan-review-prompt.md). Verdict **build with
fixes**; no established P0 or P1. Each finding was checked against the code and all six were right.

| | Finding | Taken? |
|---|---|---|
| F1 P2 | one red test failed on a `TypeError` in the test, not on the missing behaviour | **Yes**: `readerCssNoComments()` |
| F2 P2 | the "comes back" table had the widths wrong; the two sentences never swap in place; 650px with no band shows no line | **Yes**: the table above; the `key` and its test dropped; a page test at 590px; the browser check moved to 590px |
| F3 P2 | nothing tested a re-render mid-countdown, or focus on the new button | **Yes**: both added |
| F4 P1, reasoned | a tap could stop the clock for good | **Yes**: pointer events, a finger ignored, in the shared hook, so the toast is fixed too |
| F5 P1, reasoned | the × had no stated touch target | **Yes**: `.close-x` |
| F6 P1, reasoned | fading with `visibility: hidden` takes the explanation from a screen-reader user who has not reached it yet | **Yes**: invisible rather than hidden, above |

## Stages

One stage. Done is: the new test green, `tests/toast.test.tsx` green, typecheck, the suites above,
the browser check, GPT Sol's code review, pushed to `dev`.

## Deferred

Nothing. (Remembering the dismissal per device is a passed-over option, not owed work.)

## Decisions and assumptions (nobody is in the chat)

- **Five seconds, the toast's number**, rather than a second constant. The longer sentence is
  sixteen words; the clock stops under a mouse or the keyboard's focus.
- **Both the fade and the ×**, as above.
- **Not remembered between visits**, as above. This is the one product call here, and it takes the
  side that keeps today's intent; Greg can turn it the other way in a sentence.
- **The report's screenshot was not read.** Nothing in the repo reads that column from production
  short of a new script, and Greg's sentence names the line and both gaps exactly.
