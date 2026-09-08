# The glossary's order buttons, on a finger

Status as of 2026-09-08: **built, reviewed, on `dev`** — four changes, a tripwire over each, and an honest gap. The
incident itself was **never reproduced**: not in Chromium under touch emulation at five viewports,
not against the production bundle, and not on the engine it is actually about, which this box cannot
run. What shipped is the floor the control should have had, not a diagnosis. § What is still open
says what would settle it, and it needs Greg's iPad rather than another agent.

From [SPIDERYARN-READING2-2J](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2J),
2026-09-07 17:46 UTC, `build_commit=c0fb04a4`:

> I couldn't seem to click the order button in the glossary on a touch device. Don't know why. The
> other sub-mode orderings seem to work okay.

The URL he sent it from:
`https://www.spideryarn.com/read/after-work-we-ll-have-each-other-spya-rqztkp?mode=glossary&cols=1&at=spya-vm49e6&sort=centrality`.
The reporter is the administrator, and the report carries `consented: false`, so **there are no
diagnostics** — no user agent, no viewport, no log buffer. "A touch device" is all we know, and Greg
reads on an iPad, so iPadOS Safari is the likely engine.

## References

- [glossary.md](../project/glossary.md) — the mode; `SortBar` is the "order" row in the ASCII sketch.
- [touch.md](../project/touch.md) — what a touch device is allowed to assume here.
- [`src/web/GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx) § `SortBar` (~line 985) and
  § `AskATerm` (~line 1500).
- [`src/web/QuotesPanel.tsx`](../../src/web/QuotesPanel.tsx) § `RankBar` (~line 770) — the control
  Greg says works.
- [`src/web/styles/glossary.css`](../../src/web/styles/glossary.css) § `.gloss-sort*` (34–64) and
  [`src/web/styles/quotes.css`](../../src/web/styles/quotes.css) § `.quotes-rank*` (27–57).
- [`src/web/useVisualViewport.ts`](../../src/web/useVisualViewport.ts) and
  [`index.html`](../../index.html) — both already say, in as many words, that WebKit does not honour
  `interactive-widget=resizes-content` and pans the visual viewport instead.
- [`src/web/ModeSurface.tsx`](../../src/web/ModeSurface.tsx) § *No viewport code lives here yet,
  deliberately* — the band has never been made keyboard-aware, and that is written down as deferred.
- Sibling report SPIDERYARN-READING2-2G (gutter icons that only appear on `:hover`, so never on
  touch). **Not fixed here** — it has its own session — but see § The class, below.

## What was ruled out, and how

Headless Chrome via Playwright (`hasTouch: true, isMobile: true`, so `(hover: none)`,
`(any-hover: none)`, `(pointer: coarse)` and `(any-pointer: coarse)` all match — checked, not
assumed), signed in as the article's owner so `AskATerm` is present, at 390×844 and 820×1180, on
`?mode=glossary&cols=1&sort=centrality`, against the dev server. Scripts are throwaway; the numbers
are what matters.

1. **All four order buttons respond to `page.touchscreen.tap()`** — `aria-pressed` moves, the URL
   changes, the list reorders. True on a fresh page and after scrolling 6000px (bars hidden). At
   both widths. So there is no Chromium repro.
2. **Nothing overlays the band.** A dense `elementFromPoint` grid over the whole `.mode-band` box
   finds no point whose top element is outside the band.
3. **The events all arrive and none is cancelled**: `pointerdown, touchstart, pointerup, touchend,
   click`, every one `defaultPrevented === false`, target `BUTTON.gloss-sort-btn`.
4. **The two controls are structurally identical.** Ancestor chains at the same viewport:
   `BUTTON(static) > DIV(static) > ASIDE.mode-band(position: fixed, z-index: 44) > DIV.reader > …`,
   every one `touch-action: auto`, `pointer-events: auto`, `user-select: auto`. No `<form>` in
   either chain. Their CSS rules are the same declarations; `sortParam` and `rankParam` in
   [`params.ts`](../../src/web/params.ts) are both `history: "push"` with no other options.
5. **The order bar is not churned.** `.gloss-sort` keeps its DOM node for 30s with the job poller
   running (glossary mode keeps `useJobs` alive; quotes does not), so a tap cannot be lost to a
   re-mount. `reload` in [`useGlossary.ts`](../../src/web/useGlossary.ts) never returns `status` to
   `loading`, so a revalidation cannot blank the bar either.
6. **No order button is offered that would be a no-op.** `canPrioritise` and `effectiveSort` agree,
   so the `prioritised` option exists exactly when it does something.
7. **Their touch targets are the same size.** Both bars are 287×64 with four 23px-tall buttons; 36%
   of the glossary bar's box is on a button, 42% of the quotes bar's. So "the glossary's buttons are
   smaller" is false.

WebKit cannot be installed on the box (`playwright install webkit` fails host requirements), so the
engine the report is actually about could not be driven.

## What was found

Two defects, both real, both in the class the report belongs to, neither of them proven to be *this*
report's cause.

### Every text input in the reading view is under 16px, so iOS Safari zooms the page on focus

iOS Safari zooms into any form field whose computed `font-size` is below 16px, and the viewport meta
in [`index.html`](../../index.html) permits it (`initial-scale=1`, no `maximum-scale`). The page
stays zoomed afterwards — the reader has to pinch back out. Measured in the reading view:

| | computed `font-size` |
|---|---|
| `.gloss-ask-input` — *Look up a term…* | **14.4px** |
| `.srch-input` | **15.04px** |
| `.chat-input` | **15.04px** |
| `.fb-input` (feedback dialog) | **13.12px** |
| `.cmdbar-input` | 16px — the only one that does not zoom |

**The glossary is the only mode band with a text input directly above its order row.** `AskATerm` is
owner-only, and the reporter is the owner. So the sequence *tap "Look up a term…" → the page zooms
and pans → reach for "order"* exists in glossary mode and in no other band, which is the only
asymmetry found that matches "the other sub-mode orderings seem to work okay".

Compounding it: the band is `position: fixed`, and once iOS has zoomed, a fixed element is laid out
against a layout viewport that is now wider than what the reader can see. `useVisualViewport.ts`
already carries this whole argument for the three dialogs; the band was deliberately left out
(`ModeSurface.tsx` § *No viewport code lives here yet*).

### The band's controls never got the coarse-pointer treatment the dock got

`@media (pointer: coarse)` in [`narrow-window.css`](../../src/web/styles/narrow-window.css) gives the
dock a 52px bar and a 40px floor per button, because Greg asked for it in as many words
(*"make our button-bar at the bottom a bit easier to press"*, 2026-08-28). In the eleven days after
that it reached one further control — the footnote's *back to your place* link, `footnotes.css`,
2026-09-06 — and **nothing inside a mode band**. (This paragraph said "nothing else in the app"
until GPT Sol's second review found the counter-example. Same mistake as the report is about.)
Inside the glossary band on a coarse pointer, measured:

- four order buttons, each **23px tall**, in a row that wraps, with 4px horizontal gaps and a 5px
  dead strip between the two wrapped lines;
- `.gloss-gate-range`, the threshold slider, **16px tall**;
- `.prof-badge` 19px, `.prof-open` 23px, `.gloss-btn` 28px.

64% of the order bar's own box is not on a button. Apple's minimum is 44pt.

## The class

**This app was designed against a pointer, and touch affordances have only ever been added where
somebody complained.** The dock got a floor because Greg asked; the swipe got `touch-action` because
Greg asked; the hover card learned about taps because glossary terms needed it. Nothing generalised.
The two defects above and sibling report 2G (gutter icons revealed on `:hover`, so never revealed on
a finger) are three instances of the same absence: **no rule says what a control owes a finger, so
each control owes it nothing until a report arrives.**

## What GPT Sol added

Consulted before anything was built, with the seven points above and the source
(`scripts/run-codex.ts --model gpt-5.6-sol --effort high`). It agreed there is no ordinary
event-path bug unique to the glossary, ruled the hover card and the swipe layer out by line number,
and contributed the two things this investigation was missing:

- **The app is installable** (`index.html` § *Add to Home Screen*), and
  [WebKit bug 254861](https://bugs.webkit.org/show_bug.cgi?id=254861) is open against exactly this
  shape: **in an installed iPad web app, after the soft keyboard is dismissed, `position: fixed`
  controls paint in the right place while Safari goes on hit-testing their keyboard-shifted
  positions.** The lower part of the screen can become entirely untouchable, and a few pixels of
  root scroll restores it. That fits every one of the seven points, and it fits "the other sub-mode
  orderings work okay", because the glossary is the only band with a field to raise the keyboard
  from. It is killed if Greg can reproduce on a fresh load without focusing any field, as a visitor
  (no `AskATerm`), or in ordinary Safari rather than the home-screen app.
- **A second, layout mechanism, which was testable and turned out to be real but marginal.**
  `.gloss-list` is `flex: 1 1 0%`, so it has a zero base size and absorbs none of a shortfall: every
  other child of the band takes it instead. Swept the viewport down against both bands:

  | viewport (synthetic sweep, not a device) | glossary order row | quotes order row |
  |---|---|---|
  | 390×844 down to 390×260 | reachable | reachable |
  | 390×220 | **all four buttons unreachable** — the dock is over them | reachable |
  | 844×190, a landscape phone with the keyboard up | **all four below the fold; `elementFromPoint` returns null and nothing scrolls to them** | reachable |

  It is the glossary's row and not Quotes' because `AskATerm` puts it 89px lower — the same 89px
  that is the only structural difference between them. **Left unfixed**, deliberately: it needs a
  band shorter than ~230px, which is a phone in landscape with the keyboard up, and the fix is the
  deferred visual-viewport work rather than a rule. Recorded here so the next person measures rather
  than rediscovers.

Sol's ranking put "the touch targets are too small" third and said in as many words that it *cannot*
explain Quotes working, because Quotes has the same sizing. That is right, and it is why the plan
below is framed as a floor rather than as a fix.

## What was built

Three rules and two tripwires. None of them is claimed to be the diagnosis; each is a real absence
that the report walked into.

1. **A 40px floor for both order rows on a coarse pointer**, in
   [`narrow-window.css`](../../src/web/styles/narrow-window.css) § a coarse pointer — the section
   that already gives the dock its floor because Greg asked for one there in 2026-08-28. Measured
   before and after, at 820×1180 with `(pointer: coarse)` matching:

   | | before | after |
   |---|---|---|
   | glossary order buttons | 4 × 23px tall | 4 × **40px** |
   | quotes order buttons | 4 × 23px tall | 4 × **40px** |
   | one-line row height | 37px | 43px |
   | wrapped two-line row | 64px | 97px |

   Both rows together, because they are one control written twice and a floor given to one is a
   report filed about the other.

2. **`:hover` behind `@media (hover: hover)`, and `:active` beside it**, in `glossary.css` and
   `quotes.css`. The hover wash and the `.on` state paint nearly the same box, so on iOS — where a
   tap leaves hover stuck on whatever was last touched — an unpressed order could sit there looking
   like the one in force. And a finger got no press feedback at all, so a tap that landed and a tap
   that missed looked identical. This is the half that is squarely shared with
   SPIDERYARN-READING2-2G.

3. **Every text field raised to 16px on a touchscreen**, one rule rather than eleven, in its own
   section of `narrow-window.css` (§ a field iOS zooms into). iOS Safari zooms the whole page in on
   focus of a field under 16px and does not zoom back out; `maximum-scale=1` is not available as a
   counter here because it would take pinch-zoom off the article (`index.html` says why). Verified
   in a browser after: `.gloss-ask-input`, `.srch-input`, `.chat-input`, `.remember .chat-input`,
   `.cmt-note`, the sign-in pair, the shelf search, Add URL and the title editor all 16px; the
   feedback dialog's `type="file"` picker left at 11.52px, where it belongs.

   Three decisions inside that one rule, and all three are Sol's second review rather than mine:

   - **`any-pointer: coarse`, not `pointer: coarse`** — unlike every other size rule in the file.
     `pointer` reports what the browser calls the *primary* device, so **an iPad with a Magic
     Keyboard reports `pointer: fine`** and would have been missed entirely. One point of type is
     not the chrome bulk that § a coarse pointer is rationing, so the trade that justifies `pointer`
     there does not apply here. This is also a correction to that section's own comment, which
     claimed `pointer` asks which device the reader is using; it does not.
   - **A positive list of the types that raise a keyboard**, via `:is()`. The negative version —
     `input:not([type="range"]):not([type="checkbox"]):not([type="radio"])` — also matched the
     feedback dialog's visible `type="file"` picker, a control with no keyboard, nothing to zoom and
     a deliberate 0.72rem inside a fixed-size dialog.
   - **A `:root` prefix, for specificity, said out loud.** See below.

   **It shipped applying to nothing, twice.** First `textarea` was written bare — (0,0,1) against
   `.chat-input`'s (0,1,0) — so the chat composer stayed at 15.04px with the rule three lines above
   it. Then the replacement was only strong enough to beat *one* class, and `.remember .chat-input`
   is two, so Remember mode stayed at 15.68px. **A browser measurement caught the first; GPT Sol
   caught the second; `tests/touch-controls.test.ts` was green through both.** It now computes real
   specificity (`:is()` by its most specific argument, not the sum of them), searches for the
   heaviest competing rule rather than assuming one, and names `.remember .chat-input` so a search
   that stops finding it goes red instead of quiet.

   `[readonly]` was the first choice for the textarea's `:not()` and is wrong: the quiz answer box
   goes readonly *while dictation runs*, so the type would have changed size mid-sentence.
   `[hidden]` is inert and does the same job.

4. **`tw:any-pointer-coarse:text-base` on the four fields the utilities layer put out of reach** —
   sign-in's email and password, the shelf's search, Add URL, and the library's in-place title
   editor. `@layer theme, base, app, utilities` puts every `tw:` class after the stylesheets, so no
   amount of specificity in `narrow-window.css` reaches them; they have to say it themselves. Two of
   these were in the "still open" list of the first draft of this plan and Sol found the other two.

[`tests/touch-controls.test.ts`](../../tests/touch-controls.test.ts) covers the floor, the hover
gating, the `:active`, the positive type list and the specificity. It is a text scanner and says so:
it can tell you a declaration is written and that it out-specifies the rules it is racing, never
that a finger lands on a button. The browser measurements are the evidence for that half — and, on
this change's record, the ones that actually caught things.

**Nothing overflowed.** Every surface holding a field was walked at 390×844 with the coarse media in
force — the profile box, the quiz answer, the referee criterion, `/design`, the shelf — and the only
horizontal overflow found is `.dock-modes`, the mode row that has scrolled sideways on a phone since
2026-08-28 by design. It measures 466px in a 390px window **with and without the new rule**, checked
by putting the old sizes back through an injected stylesheet rather than by assuming.

## What the second review changed

The built code went back to GPT Sol
(`scripts/run-codex.ts --model gpt-5.6-sol --effort high`, prompt and answer in the session
scratchpad). No P0s, two P1s, and both were real:

- **Remember mode was still 15.68px, with every test green.** `.remember .chat-input` in
  mode-band.css is `(0,2,0)`; the floor was `(0,1,1)`. That is the second time this one rule shipped
  losing on specificity, and the second time the tripwire agreed with it. Fixed by the `:root`
  prefix, and the test now computes specificity properly and names that rule.
- **Four more fields were under the floor than this plan had recorded** — sign-in's email and
  password and the library's in-place title editor, on top of the two shelf fields already listed.
  All four now carry `tw:any-pointer-coarse:text-base`.

Three P2s, all taken: the `type="file"` picker (the negative selector reached a control with no
keyboard), `pointer` versus `any-pointer` for the font floor, and five places where this work's
own prose was stated more confidently than the evidence supported — including *"the dock and nothing
else"*, which was false, and a postmortem heading that read as a diagnosis of an incident nobody has
diagnosed. All five are corrected in place, and the postmortem is renamed after its class rather
than after that wrong claim.

**Weight that second review higher than the first**, exactly as
[AGENTS.md](../../AGENTS.md) says: the plan-stage review could not have found a CSS rule that loses
on specificity, and two of them were sitting there.

## The simpler option this passed over

**Making the buttons respond to `pointerup` or `touchend` instead of `click`.** It is the obvious
shortcut for "a tap does not register", and it is wrong twice over: if WebKit is hit-testing the
wrong element then an earlier event in the same stream is hit-tested wrongly too, and if it is not,
the app gains duplicate activation and a tap/drag ambiguity in a band where a vertical drag is
already a gesture ([touch.md](../project/touch.md)). Sol reached the same conclusion independently.

## What is still open

- **The incident is not diagnosed.** If it recurs, the fingerprint to look for is Sol's: does a few
  pixels of root scroll bring the row back, does it happen without ever touching *Look up a term*,
  and does it happen in ordinary Safari as well as the home-screen app. Three questions for Greg's
  iPad; nothing on this box can answer them.
- **The band is still not keyboard-aware.** `ModeSurface.tsx` § *No viewport code lives here yet*
  is where that belongs, and it is blocked on a real iOS measurement — which is also what would fix
  the short-band case in the table above.
- **On a landscape phone the glossary band already overflows itself, badly, and this change does not
  cause it.** At 844×390 with `cols=1` the band is 294px and its children sum to 530: head 40, ask
  92, order row 98, threshold 97, the stale banner 130, foot 73 — and **`.gloss-list` is 8px**. It is
  8px with the new floor and 8px without it (measured both ways in one session, by disabling the
  rule through an injected stylesheet), because the list is already on its `min-height: 0` floor and
  the overflow spills past the foot instead. All four order buttons stay reachable either way. So
  the floor costs nothing here — but a mode band whose list is eight pixels tall is its own report
  waiting to happen, and it belongs with the band-fit work above rather than with a size rule.
- **The 40px floor still asks `pointer: coarse`, so an iPad with a Magic Keyboard does not get
  it.** That is deliberate and it is the one decision here worth Greg's eye. The rule the codebase
  already made — sizes on `pointer`, gestures on `any-pointer`, argued in § a coarse pointer — is
  about not putting 52px of chrome on a hybrid machine, and changing a cross-cutting convention off
  the back of one unreproduced report is not this change's business. But the cost is real and it
  lands on exactly the reported device: if Greg reads with a keyboard case attached, the order
  buttons are still 23px for him. The font floor was moved to `any-pointer` because a point of type
  is not chrome; the button floor is a genuine trade, and it is his.
- **Nine other controls in the glossary band are still under 44px** — the threshold slider is 16px
  tall, `.prof-open` 23px, `.gloss-btn` 28px. The floor here was given to the control that was
  reported, not to the band. Worth a sweep, and it is the sweep
  [improve-the-codebase.md](../reusable/improve-the-codebase.md) is for.
- **`:active` on iOS is conditional, and this has not been checked on a device.** Safari applies it
  only when a touch listener exists on the element or an ancestor. This app has several at
  `document` and `window` (`useHoverCard.ts`, `scroll.ts`, `follow.ts`) and the buttons carry
  `cursor: pointer`, both of which are the usual conditions — but "usually satisfied" is not
  "measured", and nothing here can measure it. If the press feedback turns out to be invisible on
  the device, the fix is a `touchstart` no-op listener, and it should be one listener at the root
  rather than one per control.
