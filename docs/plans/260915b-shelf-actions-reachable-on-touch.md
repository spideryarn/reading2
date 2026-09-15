# The shelf's actions, reachable on a touch screen

> We have a few options that we can apply to articles on the shelf in the logged-in homepage, like
> archive and rename the title and a couple of others that I can't remember. On an iPad or other
> touch device, there didn't seem to be a way to access them. So maybe we could set it up so that you
> have to double-click the article to open it, and one click shows these options, or add a drop-down
> button to display them, or something else that makes them available on the logged-in homepage shelf
> on a touch device.
>
> — Greg, 2026-09-12, on an iPad
> ([SPIDERYARN-READING2-40](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-40))

From an admin, so it gets built; what is ours is *how*
([feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it)).

## What is there today

Five 28px icon buttons at the top right of every card (and in the table view's last column): Edit
title, Re-fetch and rebuild, Open the original, Copy link, Archive —
[`ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx) § `Actions`. They sit at `opacity: 0` and are
revealed by `group-hover`, `group-focus-within` and `@media (hover: none)`. On a finger the first tap
on one opens its explanatory card and the second presses it
([260905i](260905i-reveal-then-commit-for-the-shelf-action-row-on-touch.md)). A tap anywhere else on
the card opens the article, because the title link's `::after` is stretched over the card.

## Diagnosis

### The first theory, and why it is wrong for an iPad

The obvious suspect was the reveal's media query. `(hover: none)` describes the *primary* pointer,
and [touch.md § The gutter](../project/touch.md#the-gutter-and-the-row-a-finger-is-on) records that
an iPad with a Magic Keyboard reports `hover: hover` — which would leave the row invisible while the
reader goes on tapping the glass.

**That claim is false for iPadOS**, and this plan corrects it. WebKit pins the primary features to
touch on iOS whatever is attached; only the `any-` features change. The commit that made it so,
[changeset 268086](https://trac.webkit.org/changeset/268086/webkit) (2020-10-06):

> On iOS, the primary pointer will always be touch input, so the `hover`/`pointer` media query should
> never change. If a mouse is connected, however, `any-hover`/`any-pointer` should change as now there
> is at least one device that supports `hover`/`fine`. Note that in the case of `any-pointer` this
> means that both `coarse` and `fine` will apply.

The design discussion is [WebKit bug 209292](https://bugs.webkit.org/show_bug.cgi?id=209292). The one
later change in this area, [WebKit PR 73183](https://github.com/WebKit/WebKit/pull/73183) (merged
2026-09-03), flips the primary features only when background text extraction *and* desktop content
mode are both requested by the client — not Safari's default, and not a home-screen app.

So on Greg's iPad `(hover: none)` matched, keyboard or not, and in the card view the five icons were
drawn at full opacity. (The view lives only in `?view=`, and the default is cards.)

The media-query hole is real **elsewhere**: Chrome on a touchscreen laptop reports `hover: hover` with
`any-pointer: coarse`, and there the row is invisible to the finger. Measured with the new test below.

### What the browser says

A Sonnet subagent drove the real shelf on this box — Chrome, `isMobile` and `hasTouch` (which answer
`hover: none` and `pointer: coarse`, as an iPad does), signed in, 20 cards and 37 table rows:

| Viewport | View | The five icons | In view? |
|---|---|---|---|
| 820 × 1180 | cards | opacity 1, 28 × 28px | yes |
| 820 × 1180 | table | opacity 1 | **Archive is cut off**: the table's `overflow-x-auto` box is 770px wide and its content 815px, so the last 45px — the Archive button — is behind a sideways scroll nothing advertises |
| 1180 × 820 | cards | opacity 1 | yes |
| 1180 × 820 | table | opacity 1 | yes |

In all four, the first tap on Archive or on the pencil opened its card ("Tap again to do it") and did
nothing else; a tap on the card's body opened the article.

### Could iOS be eating the tap?

WebKit's content-change observer suppresses the click of a tap whose synthetic `mouseover` makes
something appear, and it does watch a single-shot timer of up to 400ms (`maximumDelayForTimers`,
[ContentChangeObserver.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/cocoa/ContentChangeObserver.cpp)) —
so the tooltip's 240ms open is in range. But it counts an appearance only if the thing that appeared
is *actionable* (`isConsideredActionableContent`: a click handler, an image, an iframe), and a
tooltip `<div>` is not. Even if it were, the result would be the reveal-then-commit the row already
does. Not the cause.

### So: the icons were there, and they did not read as the way in

In the default card view, on Greg's iPad, five 28px grey glyphs with no words were drawn in the
corner of every card, and each worked. He did not recognise them as the options he was looking for,
which is the one explanation left and the one his own words fit: *"there didn't seem to be a way"*,
and *"a couple of others that I can't remember"* — a reader who had seen the row would have been
looking at the others. On a desktop the same row is found by pointing at a card and read one card at
a time; a finger gets it all at once, unlabelled, on every card, where it reads as decoration.

Plus one real defect of reach: the table view in portrait.

### And the row's reveal-then-commit does not run on a real iPad

GPT Sol's diagnosis (read-only, 2026-09-15) found what neither browser nor research could: `pressCapture`
decides finger-or-mouse from `pointerType` on the **click**, and on iOS that value is wrong.
[WebKit bug 282988](https://bugs.webkit.org/show_bug.cgi?id=282988), *"iOS Safari 'click' events
have the 'mouse' pointerType when triggered from touch"*, filed 2024-11-12 against Safari 18.2 / iOS
18, fixed in January 2025, **reopened** the next month after the fix regressed, and still open: the
`pointerdown` and `pointerup` of a tap say `touch`, the `click` says `mouse`. Checked against the bug
itself, not only Sol's account of it.

So on Greg's iPad the first tap on an icon did the thing — Archive archived, Open left the app — and
the two drawn-unavailable buttons swallowed the tap and showed nothing. The card explaining each
control, which the row relies on to make unlabelled glyphs usable by finger, never opened. Chrome's
emulation reports `touch` on the click, which is why the browser pass could not see it.

**That strengthens the design rather than changing it**: a menu of words opened by an ordinary button
needs no finger-or-mouse decision at the click at all.

## The failing test

[`tests/shelf-actions-visible-to-a-finger-in-chrome.test.tsx`](../../tests/shelf-actions-visible-to-a-finger-in-chrome.test.tsx)
renders the real `ShelfCard` and `EditableTitle`, compiles the real `tailwind.css` over their
classes, and asks Chrome for the row's effective opacity under three devices set with
`--blink-settings` (CDP's `Emulation.setEmulatedMedia` ignores `hover` and `pointer`, and Playwright's
`hasTouch` only makes a pure touch device — both measured 2026-09-15). Red before any fix:

| Device | Row at rest | Pencil at rest | Row on hover |
|---|---|---|---|
| mouse (the control) | 0 | 0 | 1 |
| finger | 1 | 1 | — |
| finger and trackpad | **0** | **0** | — |

## Design

**Where there is a finger, one visible "⋯" button per card, opening a labelled list of the five
actions.** Greg's second suggestion — *"add a drop-down button to display them"* — and the one that
answers the diagnosis: the problem is not that the controls are hidden but that five unlabelled
glyphs do not say what they are, and a list of words does.

```
 a card, on a device with a finger                  after tapping ⋯
┌──────────────────────────────────────────┐      ┌──────────────────────┐
│ The Mythology Of Conscious AI       [⋯]  │      │ ✎  Edit title        │
│ Anil Seth · Noema · ~54 min · 139 blocks │      │ ↻  Re-fetch and rebuild│
│ Claims that AI is becoming conscious …   │      │ ↗  Open the original │
└──────────────────────────────────────────┘      │ ⧉  Copy link         │
                                                  │ ▣  Archive           │
                                                  └──────────────────────┘
```

- **Which devices.** `any-pointer: coarse` — *is there a finger* — shows the "⋯" and hides the icon
  row; everything else keeps today's hover-revealed icons and their cards, untouched. So an iPad, a
  phone and a touchscreen laptop get the menu; a desktop with only a mouse sees no change.
- **A menu of words needs no reveal-then-commit.** The label *is* the explanation, so a tap on an
  item does it — Archive has its Undo strip, which is the confirmation it has always had. An
  unavailable item is drawn disabled with its reason in the words, the same parenthesis the icon
  button's accessible name already carries ("Re-fetch and rebuild (no address recorded)").
- **One set of handlers.** Copy, re-fetch and the `hasWebUrl` test move out of `Actions` into a
  `useShelfActions` hook that both presentations call, so the two cannot drift about what an action
  does. The icon row keeps its reveal-then-commit: it is still reachable by a pen on a machine with
  no touchscreen, where `any-pointer` is `fine`.
- **Radix `DropdownMenu`**, from the `radix-ui` package the app already imports `RadioGroup`,
  `Toggle` and `Slot` from — so no new dependency, and the shadcn + Radix exception
  ([vision.md § Principles](../project/vision.md#principles)) already covers it. What it brings is
  the part that is easy to get wrong by hand: outside-tap and Escape dismissal, focus into the list
  and back to the trigger, arrow keys, a portal so the list is not under the stretched link, and
  collision handling at the screen's edge. The gutter's "…" is a *disclosure* rather than a menu on
  purpose (BlockGutter.tsx § the last slot), because it opens the same controls in place; this one
  opens a different presentation of them, which is what a menu is.
- **Radix's trigger opens on `pointerdown`, for every pointer, and that is wrong for a finger.**
  Measured in the installed `@radix-ui/react-dropdown-menu` 2.1.24: `onPointerDown` toggles on any
  primary-button press, with no `pointerType` test. A finger that lands on "⋯" at the start of a
  scroll of the shelf would open the menu, and on a tap the list would appear under the finger
  before it lifts. So the trigger takes a finger's press at the *click*, and the decision that it is
  a finger is made at **`pointerdown`, where iOS reports it correctly** — composing our own
  `onPointerDown` that calls `preventDefault()` for `touch` and `pen` (Radix's composed handler
  skips itself when the event is already prevented), and an `onClick` that opens the menu if that
  press was a finger's. A mouse and the keyboard keep Radix's own paths, untouched.
- **Finger-sized.** The trigger is 40px square on a coarse pointer, the house number for a thumb
  ([narrow-windows.md § What a control owes a finger](../project/narrow-windows.md#what-a-control-owes-a-finger)),
  and the items are at least as tall. The five icons were 28px.
- **The table view gets it free** — `RowActions` renders the same `Actions` — and that fixes the
  portrait clipping as a side effect: one 28px button in the last column where there were five.

### What was passed over

- **Keep the icons and do nothing more** (Fable's first pick, made before the browser showed the
  icons were already visible on an iPad). It would change nothing for the reader who filed this.
- **Labels under the five icons on touch.** Fifty words on a shelf of ten cards, all of them saying
  the same five things.
- **Single tap shows the options, double tap opens** (Greg's first idea). It changes the one gesture
  every reader uses on the shelf to serve one they use occasionally, and it runs into iOS's own
  double-tap-to-zoom.
- **The "⋯" menu everywhere**, desktop included. It would make the desktop consistent with the iPad,
  but nobody asked for the desktop to change, and there the hover row with its cards works.

## Wider, and not fixed here

WebKit bug 282988 is not a shelf fact. Every tap rule in the app that reads `pointerType` **off the
click** inherits it on iOS 18.2 and later, and three do (a grep of `src/web/` for `pointerType`,
2026-09-15):

- **[`Spine.tsx`](../../src/web/Spine.tsx) § `bandPress`'s caller** — `(e.nativeEvent as PointerEvent).pointerType === "touch"`
  on the band's `onClick`. On an iPad a click says `mouse`, so the first tap jumps and the card that
  touch.md calls *"the only reason the rail is usable by finger at all"* never opens first.
- **[`useHoverCard.ts`](../../src/web/useHoverCard.ts) § `clickPress`** — the link and glossary card's
  tap rule, rebuilt on 2026-09-15 by
  [260915a](260915a-ipad-link-taps-that-escape-the-link-card.md) to decide at the click. It reads the
  click's own `pointerType` and matches it against the presses it recorded at `pointerdown`, by type;
  whether a `mouse` click from a finger is caught there needs tracing by whoever owns it.
- **[`BlockGutter.tsx`](../../src/web/BlockGutter.tsx) § the permalink** — reads it to decide whether
  a press was keyboard or pointer; a finger read as a mouse is the harmless direction there.

The fix is the same shape each time — take the pointer type from the `pointerdown` of the same
gesture, which iOS reports correctly — and it belongs to each surface's owner rather than to a shelf
change. Written into the report's note for Greg.

## Stages

1. **The media query** — `any-pointer-coarse:opacity-100` beside `hover-none:opacity-100` on the
   shelf row and on `EditableTitle`'s pencil (the article pages share the rule), the Chrome test, and
   the correction to touch.md's claim about the Magic Keyboard. Done before this plan went for review,
   because it is needed whatever the design: it is the touchscreen laptop's fix, and the pencil keeps
   it after stage 2.
2. **The menu** — `useShelfActions`, `ShelfActionsMenu`, the `any-pointer` switch between the two
   presentations; a jsdom test that opens the menu and presses each item (and that an unavailable one
   does nothing and says why); the Chrome test extended so a finger sees the "⋯" and not the row and
   a mouse the opposite; library.md and touch.md; a browser pass at iPad size in both views.
3. **Bookkeeping** — the note in `docs/user-feedback/`, full suite once, GPT Sol code review, push.
