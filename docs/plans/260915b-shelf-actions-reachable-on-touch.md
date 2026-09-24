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

### So: in the card view the icons would have been there, and they did not read as the way in

**Conditional, and worth saying so** (GPT Sol's plan review): the chain — iPadOS matches
`(hover: none)`, so the row is opaque; cards are the default when there is no `?view=` — is sound,
but nothing records which view Greg was in. A table view in portrait would have hidden Archive
behind the scroll. Recognition is the leading explanation, not the only one, and the design below
answers both.

In the card view, on Greg's iPad, five 28px grey glyphs with no words would have been drawn in the
corner of every card. He did not recognise them as the options he was looking for,
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
  `onPointerDown` that calls `preventDefault()` for `touch` and `pen`, and an `onClick` that opens
  the menu if that press was a finger's. A mouse and the keyboard keep Radix's own paths, untouched.
  **That Radix then stands aside is read, not assumed**: `composeEventHandlers` in the installed
  `@radix-ui/primitive` 1.1.7 calls the caller's handler first and runs its own only
  `if (checkForDefaultPrevented === false || !event || !event.defaultPrevented)`, and the trigger's
  `onPointerDown` takes the default, which is `true`.
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

## What the plan review changed

GPT Sol, read-only, 2026-09-15: no P0 or P1, and the Radix mitigation confirmed sound — preventing a
pointer event must not suppress `click` (Pointer Events spec), and a click-controlled trigger for
every input is *not* simpler, because a keyboard's Enter runs Radix's key handler and then generates
a click, which would need a second suppression rule. Five P2s, all taken:

- **Copy's "Copied" would vanish**, because Radix closes the menu on select. Copy's `onSelect`
  prevents the close, so the item itself reads "Copied".
- **The trigger's accessible name is required**, "Actions for <title>", since the menu is
  portalled away from its card and Radix names it from the trigger.
- **The finger record lives one gesture**: cleared on `pointercancel`, consumed by the click that
  reads it, and ignored by a keyboard's click (`detail === 0`) — or a scroll that began on "⋯"
  would leave a stale "finger" that shuts a keyboard-opened menu.
- **The diagnosis was stated too strongly** — now conditional on the card view, above.
- **"Open the original" stays a real anchor** (`asChild`), so modifier-click and "copy link
  address" survive on a touchscreen laptop, where mice and keyboards meet this menu too.

## What the code review changed

GPT Sol, write-capable, 2026-09-15, over stages 1 and 2 — findings first, then fixes, both read and
re-run here before they were committed (cd290ff3):

- **C1 (P1), fixed — a second finger tap on an open menu closed it and opened it again.** With the
  modal menu open the trigger is *outside* Radix's portalled content, so Radix's own dismissal closed
  the menu at the second tap's `pointerdown`, and our click then toggled the *latest* state — back
  open. The finger record now carries `wasOpen` from its `pointerdown`, and the click finishes the
  transition that finger began. The jsdom case that catches it waits a task before the second tap,
  because Radix installs its outside-pointer listener on the next one — the builder's case tapped too
  soon to meet it. **Seen red here by mutation**: putting the blind toggle back turns exactly that case
  red, 17 of 18 green.
- **C3 (P3), fixed** — the re-fetch case let `rerunning`'s reset land outside `act`.
- **C2, reported** — the wider iOS click `pointerType` finding below, already in this plan.

Its sandbox could not launch Chrome (crashpad, `SIGTRAP`), so the Chrome test's evidence is the run
here: six shelf files, 70 of 70, typecheck exit 0.

**The C1 fix was not in any review's snapshot**, so it went back to Sol for a narrow check of that fix
alone — discovery closed ([engineering-manager.md § GPT Sol](../reusable/engineering-manager.md#gpt-sol)).
**Verdict: "C1 closed"**, no new P0 or P1 in the fix, the menu test 18 of 18 in its sandbox. It
traced six orders and confirmed each: a first tap opens; a second closes and cannot reopen; an item
acts and closes, Copy acts and stays open; a tap outside dismisses **without** opening the article
underneath, because Radix's modal menu sets `pointer-events: none` on the body while it is open; a
scroll's `pointercancel` leaves no stale finger for a later mouse; and the render-time `open` read at
`pointerdown` is intentional in the second-tap case. The one residue it names is two *overlapping*
touches sharing the single ref — gesture association, not a P0 or P1, and not pursued.

## The browser pass on the finished code

A Sonnet subagent, headless system Chrome, signed in, its own dev server, 2026-09-15, on cd290ff3:

| Viewport | View | Device | Result |
|---|---|---|---|
| 820 × 1180 | cards | touch | "⋯" 40 × 40, on screen; the icon row not laid out |
| 820 × 1180 | table | touch | "⋯" on screen; the table's box 770 = 770 — **no sideways scroll**, where Archive was cut off before |
| 1180 × 820 | cards | touch | "⋯" 40 × 40, on screen |
| 1180 × 820 | table | touch | "⋯" on screen, no overflow |
| 1280 × 900 | cards | mouse only | "⋯" `display: none`; pointing at a card reveals the row as before |

In all four touch cases: a tap opens the menu with the five in order, and it is still open 500ms
later and not clipped; the URL does not change; a tap outside closes it and opens nothing; Copy stays
open and reads "Copied"; Edit title closes the menu and puts focus in the title's input, and Escape
leaves the title as it was. Archive and Re-fetch were not pressed, on real articles.

**What Chrome cannot tell us, and an iPad can**: the iOS click-`pointerType` bug is not reproduced by
Chrome, which reports `touch` on the click — so the one check left is a real iPad: tap "⋯", choose
each item, and start a scroll of the shelf with a finger on a "⋯".

## The full suite

Once, through `scripts/readiness-run.ts test` in tmux, on cd290ff3: **1122 files passed, 6 failed**
(24,262 tests passed, 5 failed). All six were red again run on their own, so not contention, and none
is this change's — nothing they load imports `ShelfEntry`, `TitleEditor` or `src/web/tailwind.css`
(a grep for the paths finds two comments and no imports):

- `cold-start-lazy-imports`, `pdf-bundle-trace` — no `api-dist/` in a fresh worktree; the two
  `npm run worktree:setup` warns about.
- `fleet-composed-access`, `fleet-decisions-route`, `fleet-reports-route` — no fleet client build
  (`no built client at tools/fleet/web/dist — run npm run build:fleet first`).
- `overseer-daemon-usage-pass` › "`keep-stored` still carries the DISCARDED fresh report" — red on its
  own, and the same six were recorded independently on `origin/dev` the same day by
  de24dac6 ("the six reds that are not ours").

After merging `origin/dev`, the six shelf files and doc-links were run again, and typecheck.

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

**2026-09-24:** of the three, only the spine was broken, and it is fixed — the rail records the type
at `pointerdown` (Spine.tsx § `bandClick`,
[260924c](260924c-ipad-first-tap-on-the-rail-shows-the-card.md)). `clickPress` already caught a
finger's `mouse` click (260915a's `type === "mouse"` branch, with tests in
`tests/link-tap-escapes.test.tsx`, now including a term inside a link), and a bare glossary term's
outcome does not depend on the click's type. The permalink is harmless as said. Neither changed.

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

### What stage 2 built

`useShelfActions` in [`ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx) holds copy, re-fetch, archive
and the `hasWebUrl` test, moved out of `Actions` with their comments. `Actions` renders the icon row
(`any-pointer-coarse:hidden`, replacing stage 1's `any-pointer-coarse:opacity-100`) and
`ShelfActionsMenu` (`hidden any-pointer-coarse:flex`) side by side, so the card and the table's
`RowActions` switch together. The menu is Radix `DropdownMenu`: a 40px "⋯" named "Actions for
<title>", five items at least 40px tall, an unavailable one disabled with `rerunLabel` or the new
`openLabel` as its words (the row's accessible names use the same functions), "Open the original" an
anchor only for a web URL, Copy held open so it can read "Copied", and Edit title stopping Radix's
focus return. The trigger's finger rule is the one § Design and § What the plan review changed
describe.

- **[`tests/shelf-actions-menu.test.tsx`](../../tests/shelf-actions-menu.test.tsx)**, 17 cases, all
  red before the component existed. Removing the finger branch of the trigger's `onPointerDown`
  turns 14 of them red; the three that stay green (the name, a mouse, Enter) do not depend on it.
- **The Chrome test**: the finger cases now ask for the "⋯" shown and the row gone; red 2 of 3
  before, with the mouse control green throughout.
- **One existing test changed**: `tests/shelf-action-tooltips.test.tsx` counted every button in the
  host, and under jsdom the "⋯" is in the same DOM, so it now counts `[data-action]`.

Not done in this stage: the browser pass at iPad size in both views.
