# ⌘-K on the Metadata page, and the full wordmark animations on the shelf

Two unrelated reader reports from Greg, batched because both are small. Each lands as its own commit
and gets its own note in `docs/user-feedback/`.

## 66 — ⌘-K does nothing on the Metadata page

> The Cmd-k Command shortcut doesn't work in Metadata mode.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-66, on `/read/dongetal25-spya-vfmvmm/metadata`)

**Cause: deliberate, and the reason no longer holds.** The command bar, its ⌘-K listener and its
Dock button are all gated on `onMode !== undefined` (Dock.tsx § `useCommandBarChord`,
`DockCommands`, `DockCommandBar`). The metadata page mounts the Dock with no `onMode`, because there
is no band to switch there, and the gate's comment says *"nothing for a command to do"*. But the
same Dock on that page already draws every mode as a link back to the article in that mode
(`DockModeLinks`), and the bar's six other rows there (Metadata, four app pages, Feedback)
need no band at all. So there *is* something to do: exactly what the links beside
the bar do.

**Fix.** Open the bar on the metadata page too, for an owner (visitors still get none — the
capability gate in `DockCommands` is unchanged). Off the reading view, a mode row does what that
mode's link in the same Dock does: navigate to `readHref(slug, withMode(search, mode), "article")`.

- **It arms nothing**, matching the link beside it. On the reading view a mode row runs the mode
  exactly as its button does, and the Commands card promises *"exactly as pressing that button here
  does"*; on the metadata page "that button here" is a link, and a link arrives without generating
  (activation.ts § arriving is not a press). So typing *Glossary* there lands on Glossary; if it has
  never been built, the reader presses to build it, as from the link. **The simpler option passed
  over the other way**: arming before navigating would make the bar a *cheaper* door than the link
  beside it and make the card false on that page. Named as a follow-up if Greg wants it.
- The Metadata row still appears (it is the current page); pressing it is a no-op navigation. Not
  worth a special case.
- No Comments row there (no drawer is mounted), as today whenever there is no drawer.
- **The `generates` marker is left as it is, and over-warns there.** From the metadata page Glossary,
  FAQ and the other token-armed modes start nothing, but Tweets (an `arrival` mode, whose band writes
  the thread when it mounts) and Diagram (which buys an embedding on mount) still can. The marker
  already says *may* start and already over-warns on the reading view (activation.ts §
  `modeGenerates`); making it depend on which page the bar is on is a second rule for one word.
  Over-warning is the direction that costs no money. GPT Sol's finding 1, accepted this way.
- **The seam is `useActivateMode`**: with no `onMode` it navigates to `modeLinkHref`, the one href
  builder `DockModeLinks` also uses. Lifting the three gates alone would have armed a token and
  stayed on the page.

**Test first**: a test that renders the Dock as the metadata page does (`view="metadata"`, no
`onMode`, signed-in owner), presses ⌘-K on `window`, and expects the dialog open — red today. Then
that Enter on a mode row navigates to the article href with `?mode=`, and that a visitor's metadata
page still gets no bar.

## 6D — no fun animations in the logged-in shelf's top-left

> We don't seem to get the fun logo animations for the logo in the top left of the logged in
> homepage.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-6D, on `/`)

**Cause: a deliberate deferral, now asked for.** The shelf's top-left is a 28px spider
(`ShelfSpider`) beside a plain `<h1>Spideryarn</h1>` in `text-3xl`. Only the spider hosts the hook,
so only the six spider animations can ever play, and pointing at the word does nothing. 260929c
spread the ten-letter wordmark to every other page but **left this heading out on purpose**: the
letter animations move by fixed pixels tuned for the 13px (0.82rem) wordmark, and at 30px a 2px pluck
reads as half a gesture. design-logo.md § The two mount points names the fix — make the set scale
with its host — as its own piece of work. This report asks for that work. (Build d6266038 already has
260929c; the shelf was never one of the pages it gave the letters to, so nothing is waiting to
deploy.)

**Fix, two parts:**

1. **The letter animations measure in the wordmark's own em.** One token, `--logo-px: calc(1em /
   13.12)` — a pixel of the 0.82rem wordmark — and every letter-geometry length in
   `logo-animations.css` becomes `calc(var(--logo-px) * N)` with the same N. At the default 16px root
   size the corner and the Dock (both 0.82rem) are unchanged, including Abseil's measured 8px against
   the Dock's clip; under a reader's font-size preference they move in proportion to the Dock, which
   is rem-sized too. The footer (14px) and marketing bar (16px) grow by
   7% and 22%, which is more faithful to the tuning than today. **Hairline widths stay 1px** (a
   thread, a border): a hairline is a hairline at any size. The mark animations (px against the
   20px spider) are left as they are — the shelf spider already plays them, and that is not what
   was reported.
2. **The shelf's heading and spider become one host.** The `<h1>` spells its name with
   `LogoLetters` (the text content, and so the heading's accessible name, is still "Spideryarn"), and
   the hook moves from the spider's span to the row holding both, with `{ tap: true }` as today. The
   heading keeps its own face, size and colour.

**Known and accepted**: Dawn's glow turns the letters orange for about a second and then drops back
to the heading's ink colour — the footer already does exactly this, since it is also a non-orange
wordmark. Retype's cursor sits after the `n` with nothing after it, so it draws. Selecting the
heading's text is lost to `user-select: none`, as on every other wordmark (it stops iOS's long-press
callout).

**Test first**: `tests/logo-animation.test.tsx` already fails when an animation has no rule; add a
failing assertion that the shelf's host contains drawn `.logo-letter`s (the only thing that makes
the letter set eligible), and a stylesheet assertion that no letter-geometry `px` remains in the
letter rules outside the named hairlines. Then a browser check at 30px, and in the Dock at 0.82rem
to confirm nothing moved there.

## Deferred

- Arming a mode from the bar on the metadata page (see 66 above).
- Mark animations sized to the spider's own box (they are px against a 20px spider; the 28px shelf
  spider plays them a little small). Not reported.

## Reviews

- Plan: GPT Sol, read-only, 2026-09-30 — no P0. Taken: the Tweets/marker point (answered above by
  accepting the over-warning, not by a second marker rule); a test of the Feedback row on a
  metadata page inside `FeedbackHost`; the row count (six, not nine); "unchanged at the default root
  size" rather than "not a fraction of a pixel"; `aria-hidden` on the spider alone, never on the
  host round the heading; keyboard.md, reading-view-overview.md, CommandBar.tsx's gate note, the
  Only-i blurb ("a single pixel") and Abseil's "eight pixels" brought up to date. Its full
  classification of every `px` in the stylesheet (letter / hairline / mark) matches what the
  test enforces: `.site-wordmark-rest` and the keyframes letter rules run are included, the mark's
  and the 1px hairlines are not. Kept the name `--logo-px` over its `--logo-unit`: the value *is* a
  pixel of the reference wordmark, and the tuned numbers read as pixels.
- Code: GPT Sol, workspace-write, 2026-09-30 — three P3s, all fixed by it in scope and read here:
  the command bar's header, reading-view-overview.md and web-client.md still said every mode row
  activates as on the reading view (and gave stale row counts); `tests/shelf-wordmark.test.tsx`
  gained an assertion that the heading is not inside `aria-hidden` and one that a tap on the heading
  still plays; `tests/command-bar.test.tsx` checks the Metadata page offers no Comments row.
- Browser (Sonnet, Playwright, local): ⌘-K and Ctrl-K open the bar on Metadata; *glossary* ⏎ lands
  on `?at=…&mode=glossary` in Glossary with no generate request; *library* ⏎ goes to `/`. On the
  shelf, sixteen hovers drew letter and mark animations both; forced at 30px, pluck peaked at 4.6px,
  sag 6.9px, seam ±6.9px, abseil 20.1px, nothing clipped. The Dock's wordmark (2560px wide, where
  its word shows) is unchanged: abseil 8.75px, unclipped, pluck 2.0px.
- Gates: the nine scoped suites (347 tests) and `npm run typecheck` green before commit.
