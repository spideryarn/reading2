# Who owns Escape: the inventory

Step 1 of **Stage 3** of
[the active mode gets one surface](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md#stage-3--a6-who-owns-escape),
which is item A6 of [the main-app architecture review](260905e-main-app-architecture-review.md).
No code was changed to produce it.

Every behavioural claim below carries a `file:line` and is marked **READ** (I opened the code) or
**INFERRED** (it follows from DOM/HTML semantics rather than from a line I read). The `node_modules`
claims were read in the shipped bundle.

## What is actually going on

Escape in the reader is not one decision, it is **five tiers that run in a fixed order**, and every
surface belongs to exactly one of them. Nothing anywhere reads a z-index, an "is this on top"
question, or another surface's state; the tier a surface happens to be in is the whole of its
authority. That is why the answer differs per pair rather than per phase.

In the order they run on one press:

| Tier | Where | Who is in it | What it stops |
|------|-------|--------------|----------------|
| **T0** | `window`, **capture** | the Dock drawer, and only it — `Dock.tsx:1115` | `stopImmediatePropagation()` at `Dock.tsx:1112` — kills T1, T2, T3 and its own siblings. **READ** |
| **T1** | `#root`, bubble (React's synthetic handlers) | the text boxes: chat composer, chat rename, chat ask-again, annotate textarea, comment follow-up, comment note | whichever call `stopPropagation()` — that kills T2 and T3. **INFERRED**: React 19 attaches at the root container (`main.tsx:206`, `#root` is a direct child of `<body>` — `index.html:134`), so a synthetic stop lands before `document`. **READ** that the calls are there |
| **T2** | `document`, bubble | Floating UI `useDismiss` ×3, `useHoverCard` ×2, `BlockGutter` | Floating UI calls `event.stopPropagation()` (`floating-ui.react.mjs:2628`) — kills T3 but **not its T2 siblings**. `useHoverCard` and `BlockGutter` stop nothing. **READ** |
| **T3** | `window`, bubble | `useEscapeToClose` — Comment, Annotate, Chat | nothing. All mounted instances fire on one press. **READ** `useEscapeToClose.ts:26` |
| **T4** | the platform | the four native `<dialog>`s | not a listener at all. Only `preventDefault()` — on the keydown, or on `cancel` — suppresses the close request, and **nothing in the app does either**. So a native dialog closes no matter what T0–T3 did. **READ** the absence; **INFERRED** the close-watcher semantics |

Three consequences fall straight out, and they are most of what the fix has to answer:

1. **The T2 tier is all-or-nothing.** `stopPropagation` on `document` does not stop *other* listeners
   on `document` — only `stopImmediatePropagation` would. So one press closes **every** open T2
   surface at once: a tooltip and the colour picker together, a hover card and a gutter together.
   **INFERRED** from DOM dispatch; the code is `floating-ui.react.mjs:2628`, `useHoverCard.ts:645`,
   `BlockGutter.tsx:430`, all **READ**.
2. **T2 protects T3, T3 protects nothing.** An open Floating UI surface silently saves the comment
   dialog behind it. An open hover card or gutter does not — and those are the two T2 members that
   forget to stop.
3. **T4 is orthogonal to all of it.** Every pair involving a native dialog is wrong today, and the
   fix cannot live in the dialog.

**15 surfaces. 18 reachable pairs, in 9 classes. 5 unreachable pairs, for 4 distinct reasons.**

The plan's Stage 3 audit was right about T0, T3 and T4, and right to correct itself about Floating
UI. What it did not have is T1 (the text boxes change which tier the press ever reaches) and
consequence 1 above.

## The surfaces

Visual order first, so the "who should own it" column has something to point at. Native dialogs
paint in the **top layer**, above every z-index — `lightbox.css:12` says so in as many words
(**READ**).

| # | Surface | Render condition | Stack | Listener: target / phase | Stops? | On Escape |
|---|---------|------------------|-------|--------------------------|--------|-----------|
| 1 | **Lightbox** `<dialog>` | always mounted (`TableView.tsx:1653`); visible when `showModal()` runs on `figure !== null` (`Lightbox.tsx:94`) | top layer, no z-index (`lightbox.css:27`) | none — deliberate, `Lightbox.tsx:102-104` | n/a | platform closes it; `onClose` at `Lightbox.tsx:109` clears `zoomed` |
| 2 | **FeedbackDialog** `<dialog>` | always mounted for the whole signed-in app (`FeedbackButton.tsx:157`); `showModal()` at `FeedbackDialog.tsx:421` | top layer, no z-index (`feedback.css:64`) | `onKeyDown` on the dialog, `FeedbackDialog.tsx:831` — ⌘/Ctrl+Enter only | no | platform closes it; `onClose` at `:804` |
| 3 | **Illustrated full** `<dialog class="ill-full">` | `IllustratedView.tsx:610`, `showModal()` on `full` at `:310` | top layer, no z-index (`diagram-illustrated.css:225`) | `cancel` + `close` at `IllustratedView.tsx:342-343` | **no `preventDefault`** — the handler takes no event | platform closes it; `setFull(false)` |
| 4 | **Sketch full** `<dialog class="sk-full">` | `SketchView.tsx:1317`, `showModal()` on `full` at `:521` | top layer, no z-index (`diagram-sketch.css:186`) | `cancel` + `close` at `SketchView.tsx:573-577`; the SVG's own Escape branch is **disabled while full** (`SketchView.tsx:853`) | no; the comment at `:574` says not-prevented is deliberate | platform closes it |
| 5 | **Tooltip** (Floating UI) | wherever `<Tooltip>` is used — incl. the dock bar (`Dock.tsx:1687`, `:2061`), Outline, Search, Criteria, Claims, Debate, Masthead, Quiz | `.tooltip-anchor` **z-100** (`tooltip.css:22` — "Above EVERYTHING, drawer included") | `document` / bubble (`floating-ui.react.mjs:2782`) | **`stopPropagation()`** (`:2628`; `escapeKey` defaults `true` at `:2593`, `bubbles` undefined ⇒ `escapeKey: false` at `:2572`) | closes itself |
| 6 | **Prose hover card** | always mounted in the reader (`App.tsx:3428`); shown on hover/tap of `mark.term, .prose a[href], a.cited-link, .chat-sources a[href]` (`ProseHoverCard.tsx:296`) | `.tooltip-anchor interactive hover-card`, so **z-100** (`useHoverCard.ts:771`, `tooltip.css:22/59`) | `document` / bubble (`useHoverCard.ts:645`) | **nothing** (`useHoverCard.ts:640`) | `shut()` |
| 7 | **Debate hover card** | Debate mode only (`DebatePanel.tsx:640`) | same z-100 layer | same hook, same line | **nothing** | `shut()` |
| 8 | **Search colour picker** | `open` state in `SearchPanel.tsx:1858`, click-opened, portalled | `.srch-picker` **z-99** (`search.css:280`; the banner at `:274` says "above the drawer's 95") | `document` / bubble, via `useDismiss(context)` at `SearchPanel.tsx:1871` | **`stopPropagation()`** | closes itself |
| 9 | **ProfilePanel** | `WrittenForYou.tsx:75/157` — Quotes band and the Tweets page | `.prof-panel` **z-99** (`profile.css:432`) | `document` / bubble, `ProfilePanel.tsx:162` | **`stopPropagation()`** | closes itself |
| 10 | **Dock drawer** | `panel !== null && drawer` (`Dock.tsx:1170`); `panel` is `?panel=` (`App.tsx:2516`) | `.dock-drawer` **z-95** (`dock.css:474`); scrim 92, bar 96 | **`window` / capture** (`Dock.tsx:1115`), only while `open && onPanel` (`:1109`) | **`stopImmediatePropagation()`** (`Dock.tsx:1112`) | `onPanel(null)` |
| 11 | **CommentDialog** | `owner && !overlay && openComment` (`App.tsx:3346`) or `!owner && !overlay && openComment` (`:3333`); `note` is `?note=` (`App.tsx:2131`) | `.cmt-dialog` **z-70** (`annotations.css:606`) | `window` / bubble (`CommentDialog.tsx:162`) | **nothing** | `setNote(null)` (`App.tsx:3343/3355`) |
| 12 | **ChatDialog** | `owner && overlay` (`App.tsx:3287`) | `.chat-dialog` **z-70** (`dialogs.css:38`) | `window` / bubble (`ChatDialog.tsx:306`) | **nothing** | `onClose` — clears the draft/thread |
| 13 | **AnnotateDialog** | `owner && annotating` (`App.tsx:3236`); `annotating` set only by `selectProse` (`App.tsx:2900`) | `.annotate-dialog` **z-70** (`dialogs.css:70`) | `window` / bubble (`AnnotateDialog.tsx:160`) | **nothing** | `setAnnotating(null)` (`App.tsx:3243`) — **discards the draft** |
| 14 | **Masthead rename** | `rename.editing` (`TitleEditor.tsx:299`), reached by the pencil in `Masthead.tsx:226`; the masthead is in the reader (`App.tsx:3025`) | in flow, no z-index | React `onKeyDown` on the input (`TitleEditor.tsx:96`) — **T1** | **nothing** | `onDone(undefined)` — cancels the rename |
| 15 | **BlockGutter disclosure** | `open` state, listener registered only while open (`BlockGutter.tsx:423`) | `.blk-gutter[data-open]` **z-3** (`gutter.css:660`) | `document` / bubble (`BlockGutter.tsx:430`) | **nothing** | `setOpen(false)` + focus returns to the "…" |

All fifteen **READ**. There are exactly four native `<dialog>`s in `src/` and no others.

### The T1 text boxes, which decide whether the press reaches a tier at all

Not surfaces, but they are why "press Escape" has no single answer.

| Box | Line | Stops propagation? | Behaviour |
|-----|------|--------------------|-----------|
| Chat composer (used by ChatPanel **and** ChatDialog, `ChatDialog.tsx:596`) | `ChatPanel.tsx:2001` | **yes, every key** | three-step ladder at `:2031` — stop the answer, clear the draft, blur |
| Chat rename row | `ChatPanel.tsx:910` | **yes** | cancels the rename |
| Chat "ask again" editor | `ChatPanel.tsx:1681` | **yes** | cancels the edit |
| Annotate textarea | `AnnotateDialog.tsx:243` | **only while `body` is non-empty** | first Escape clears the box, second closes the dialog |
| Comment follow-up box | `CommentDialog.tsx:532` | only while non-empty | same two-stage shape |
| Comment note textarea | `CommentDialog.tsx:747` | only while the draft differs from saved | same |
| Search query box | `SearchPanel.tsx:508` | **no** — but it calls `preventDefault()` at `:509` | clears the box |
| Masthead rename input | `TitleEditor.tsx:96` | **no** | cancels the rename |

All **READ**. `keynav.ts:537` also listens on `window` bubble but returns on anything that is not an
arrow key (`keynav.ts:466-470`), so it is not an Escape owner (**READ**).

## The reachable pairs

"How a reader gets there" is a named interaction in every row. `?panel=`, `?note=` and `?thread=`
are all URL state (`App.tsx:2516/2131/2165`), so several of these are also reachable by pasting a
link.

| # | Pair | How a reader gets there | Today | Should own it |
|---|------|-------------------------|-------|----------------|
| **1** | **Annotate + Comment** | select prose (`selectProse`, `App.tsx:2881` — clears `note`, sets `annotating`), then click a `mark.cmt` in the prose (`TableView.tsx:1378-1380`) or the gutter's `.blk-cmt` (`BlockGutter.tsx:498`). Both call `openCommentDialog`, which is `(id) => void setNote(id)` (`App.tsx:2910`) and clears nothing | **both close on one press; the annotation draft is discarded** | Comment (later, and painted on top — it renders after Annotate in `App.tsx`, same z-70). Annotate should stay with its draft |
| **2** | **Annotate + ChatDialog** | select prose, then the gutter's chat or "?" button — `chatAboutBlock` (`App.tsx:2763`) and `helpAboutBlock` (`:2871`) set `chatDraft` and clear `note`, but **neither clears `annotating`** | **both close on one press; the annotation draft is discarded** | Chat (later, painted on top). **Not in the plan — same defect as pair 1, second door** |
| **3** | **Annotate + prose hover card** | select prose, then simply **hover a glossary term or a link** — no click at all | **both close; the annotation draft is discarded** | the hover card alone (z-100). **The cheapest path to the loss, and it needs no click** |
| **4** | **Comment + prose hover card** | open a comment, hover a term | both close | the hover card alone |
| **5** | **ChatDialog + prose hover card** | open a floating chat, hover a term (or a link in the answer — `.chat-sources a[href]` is in the selector) | both close; the chat draft goes with it | the hover card alone |
| **6** | **Annotate / Comment / Chat + BlockGutter disclosure** | with any of the three open, press the "…" on a paragraph's gutter | **both close** (gutter is T2 and stops nothing; the dialog is T3) | **open question** — the gutter is later but *lower* (z-3 vs z-70). See Q1 |
| **7** | **Annotate / Comment / Chat + Masthead rename** | with any of the three open, press the pencil beside the title (`Masthead.tsx:226`) | **both close** — `TitleEditor.tsx:96` does not stop | the rename input alone: focus is in it |
| **8** | **Annotate / Comment / Chat + Tooltip, colour picker or ProfilePanel** | hover any tooltip; or, in the Quotes band, open the profile panel; or, in Search, the colour picker | **only the floating surface closes** — `stopPropagation` at `floating-ui.react.mjs:2628` saves the dialog | as today. **Correct** |
| **9** | **Drawer + Comment** | with a comment open, press the Questions tab in the dock; or load `?panel=questions&note=<id>` | **only the drawer closes** | as today. **Correct** — and it is the pair `Dock.tsx:1091-1096` was written for |
| **10** | **Drawer + Annotate** | select prose, then press Questions | **only the drawer closes** | as today. Correct |
| **11** | **Drawer + ChatDialog** | open a floating chat, then press Questions; or `?panel=questions&thread=<id>` | **only the drawer closes** | as today. Correct |
| **12** | **Drawer + a dock-bar tooltip** | the bar sits **above** the scrim (`.dock` z-96 vs scrim 92, `dock.css:51/456`) and stays operable with no focus trap (`Dock.tsx:1132`), so hovering or tabbing to a mode button or the experimental switch opens its tooltip (`Dock.tsx:1687`, `:2061`) over the drawer | **only the drawer closes; the tooltip is left standing** | the **tooltip** — `tooltip.css:22` raised it from 80 to 100 *specifically* to sit over the drawer. **This is the pair local ownership cannot express. See F4** |
| **13** | **Any native dialog + Comment** | open a comment, then press a figure's zoom button (`prose .zoom-btn` → `setZoomed`, `TableView.tsx:584/1653`); or press Feedback in the dock bar; or, in Diagram mode, go full-screen | **both close** — the platform closes the dialog, and the comment's T3 listener fires anyway | **the dialog alone.** Nothing behind a modal should hear the press |
| **14** | **Any native dialog + Annotate** | select prose, then zoom a figure / open Feedback | **both close; the annotation draft is discarded** | the dialog alone |
| **15** | **Any native dialog + ChatDialog** | open a floating chat, then zoom a figure / open Feedback | **both close** | the dialog alone |
| **16** | **Any native dialog + the drawer** | open the drawer, then press Feedback — the button is in the bar, which is above the scrim | **both close** (T0 takes the drawer, T4 takes the dialog independently) | the dialog alone |
| **17** | **Any native dialog + hover card / gutter** | with a card or gutter open, zoom a figure | **both close** | the dialog alone |
| **18** | **Two T2 surfaces** — tooltip + colour picker, or hover card + tooltip, or gutter + tooltip | in the Search band, open the colour picker then hover a neighbouring tooltip; or hover a term and then a band tooltip inside the card's 120ms close delay | **both close** — `stopPropagation` does not stop a sibling on the same node | the topmost only (tooltip 100 > picker 99) |

Rows 1–2 and 13–17 also cover the **Sketch full / Illustrated full** dialogs, which additionally
contain their own tooltips: the same `body` is rendered inside the `<dialog>` when full
(`SketchView.tsx:1329`), so a tooltip opened there is a T2 surface inside a T4 surface — see F7.

## The unreachable pairs, and why

| Pair | Why not |
|------|---------|
| **Comment + ChatDialog** | mutually exclusive by construction: `ChatDialog` needs `overlay` (`App.tsx:3287`), both `CommentDialog` arms need `!overlay` (`:3333`, `:3346`). **READ** |
| **Drawer + BlockGutter disclosure** | the scrim is a full-viewport button at z-92 (`dock.css:454-456`) so the gutter cannot be pressed under it; and opening the drawer is an outside pointerdown, which the gutter's own **capture** listener catches and closes on (`BlockGutter.tsx:426-432`). **READ** |
| **Drawer + colour picker, Drawer + ProfilePanel** | both are click-opened and live in a mode band behind the scrim; and `useDismiss`'s `outsidePress` defaults to `true` on `pointerdown` (`floating-ui.react.mjs:2594-2595`), so pressing the dock tab dismisses them on the way. **READ** the defaults, **INFERRED** that the scrim intercepts the press |
| **Two native dialogs at once** | all four use `showModal()` (`Lightbox.tsx:94`, `FeedbackDialog.tsx:421`, `IllustratedView.tsx:310`, `SketchView.tsx:521`), which makes everything outside the dialog inert, so the second cannot be opened. **READ** the calls, **INFERRED** the inertness |
| **Annotate + Annotate**, and any surface with itself | single state slots. **READ** |

## Findings

### F1 — the known-lossy pair is real, and there are three of it

**Verified.** `selectProse` clears the comment before opening the annotation (`App.tsx:2897-2900`);
`openCommentDialog` is `(id) => void setNote(id)` and clears nothing (`App.tsx:2910`). Both dialogs
then render — `owner && annotating` (`:3236`) against `owner && !overlay && openComment` (`:3346`) —
and both register a T3 `useEscapeToClose` that stops nothing.

**Exactly which press.** Clicking the comment mark moves focus out of the annotate textarea (and
`CommentDialog` then moves focus into itself — `CommentDialog.tsx:165-175`), so the annotate
textarea's two-stage guard at `AnnotateDialog.tsx:243` never runs. **The very next Escape** calls
both `setAnnotating(null)` and `setNote(null)`: the half-typed annotation is gone and the comment is
closed. If focus were still in the textarea with words in it, the first press would clear the box
(also losing the words, by design) and the *second* would close both.

Two more doors to the same loss, neither of them in the plan:

- **Annotate + ChatDialog** (pair 2). `chatAboutBlock` and `helpAboutBlock` clear `note` but not
  `annotating` (`App.tsx:2763`, `:2871`), and `ChatDialog` is another T3 listener.
- **Annotate + hover card** (pair 3). This one needs **no click at all** — hovering a glossary term
  opens a T2 surface that stops nothing, so one Escape closes the card and discards the annotation.

So the loss is not a property of the Comment pair; it is a property of **`setAnnotating(null)` being
reachable from a listener that never asks whether anything is in front of it**.

### F2 — the two T2 members that forget to stop are the cheapest fix in the inventory

`useHoverCard.ts:640` and `BlockGutter.tsx:425` call their close and return. Floating UI, in the same
tier, calls `stopPropagation()`. Making those two stop **when they actually have something open**
fixes pairs 3, 4, 5, 6 and half of 17 in two lines, and makes the tier internally consistent.

The hover card's handler runs whenever the hook is mounted, open or not (`useHoverCard.ts:645`, with
`shut()` a no-op on nothing) — so the stop has to be conditional on a card being shown, or it will
swallow Escape for the whole reader.

### F3 — native dialogs cannot be stopped from a dialog, so the fix belongs in `useEscapeToClose`

Nothing calls `preventDefault()` on a `cancel` event anywhere in `src/` — the two `cancel` listeners
(`IllustratedView.tsx:343`, `SketchView.tsx:577`) share a handler that takes **no event argument**,
so it is not merely unused, it is unreachable without a signature change (**READ**).

That is fine and deliberate. What is not fine is the other half: T3 fires anyway. The local
expression — no manager needed — is that **`useEscapeToClose` declines a press that belongs to an
open native modal**, which it can decide from the event itself (`(e.target as Element)?.closest?.
("dialog[open]")`) or from `document.querySelector("dialog[open]")`. Either is a local test made by
the surface that must yield, not a registry. It fixes pairs 13, 14, 15 and the T3 half of 17.

Pair 16 (drawer + Feedback) is not fixed by that, because the drawer is T0. The drawer would need the
same test.

### F4 — one pair local ownership cannot express, and it may not need to be

**Pair 12: the drawer versus a tooltip painted above it.** `.tooltip-anchor` is z-100
(`tooltip.css:22`) and the rule's own comment says it was raised from 80 *because the drawer at 95
buried the dock's tooltips*. So the intended visual order is explicit and the intended Escape order
follows from it — and it is unreachable by any local means:

- The drawer's listener is **`window` capture**, which runs before everything else in JS. For the
  tooltip to win it would have to register on `window` capture too — and then **registration order
  decides**, which Stage 3 §3 forbids in as many words.
- Floating UI can move `useDismiss` into the capture phase (`capture: {escapeKey: true}`,
  `floating-ui.react.mjs:2782`), but only onto `document` capture, which still runs *after* `window`
  capture. **INFERRED** from the dispatch order; the option is **READ**.
- The only remaining local expression is the drawer asking whether anything is painted above it —
  `document.querySelector(".tooltip-anchor, .srch-picker")`, or a one-bit shared signal. That is
  global knowledge, however small, and a one-bit global is the thin end of the overlay manager A6
  forbids.

**But the requirement may not be worth the machinery.** The only reachable instance is a *hover or
focus* tooltip on the dock bar (`Dock.tsx:1687`, `:2061`): it costs nothing to leave standing, and it
closes on its own when the pointer or focus moves. The colour picker at z-99 is unreachable over the
drawer (see the unreachable table). So the honest options are: **declare that the drawer wins and
write it down**, or accept one DOM read inside the drawer's handler. I would not build a manager for
this, and nothing else in the inventory asks for one.

**Answer to the plan's question: no pair requires a global overlay manager.** One pair (12) cannot
be expressed locally without a global signal or registration order, and its intended behaviour is
cheap to renounce.

### F5 — no existing test presses Escape once with two overlays open

**Verified.** Nine test files mention Escape:
`the-dock-drawer-is-not-a-modal.test.tsx:201`, `profile-panel.test.tsx:203`,
`search-colour-picker.test.tsx:239`, `block-gutter.test.tsx:574/600`,
`article-rename.test.tsx:267/279`, `sketch-zoom-and-peek.test.tsx:290`, plus
`feedback-dialog.test.tsx`, `opening-a-comment-moves-focus-into-its-dialog.test.tsx` and
`remember-panel.test.tsx`, which mention it only in prose. Every one paints a single surface and
presses once. The plan is right: **there is no coverage of any pair in this document.**

### F6 — three smaller things found on the way

- **`openCommentDialog` is typed `(id: BlockId)`** (`App.tsx:2910`) but is called with a *comment*
  id from `TableView.tsx:1378-1380` and `BlockGutter.tsx:498`. It compiles because `BlockId` is a
  plain alias (`src/types.ts:32`). Harmless today, wrong in the one place that names the contract
  everything else depends on, and it would be a type error the day the id gets branded.
- **`SearchPanel.tsx:509` is the only `preventDefault()` on an Escape keydown in the reader.** It is
  there to stop the browser doing something else with the press, but `preventDefault` on a keydown is
  precisely what suppresses a native dialog's close request (**INFERRED**). Unreachable today — focus
  cannot be in the search box while a modal is open — but it is the one existing lever on T4 and it
  is pointing at nothing.
- **Two stale comments about the stacking order**, both asserting the tooltip layer is 80 when it is
  100: `annotations.css:598-599` and `Dock.tsx:62`. The relations they describe are still right.

### F7 — a tooltip inside the full-screen sketch or illustration is outside the top layer

`<Tooltip>` renders through `<FloatingPortal>` into the end of `<body>` (`Tooltip.tsx:22`, `:226`),
and `SketchView.tsx:1329` renders the same `body` — tooltips at `:888` included — *inside* the
`<dialog>` when full. A top-layer dialog paints above every z-index, so the portalled tooltip lands
behind it. **READ** the portal and the render; **INFERRED** the painting. Not an Escape bug, but it
undermines the premise the ownership rule keys on: "topmost" is not always what the z-index says.

## Open questions for you

- **Q1 — when "later" and "topmost" come apart, which wins?** Stage 3 §3 words the rule as *"the
  later and visually topmost surface"*, and pair 6 splits them: the gutter disclosure is opened last
  and sits at z-3, under a dialog at z-70. Pairs 1, 2 and 12 have the same shape in the other
  direction. My reading is that **topmost should decide**, because it is what the reader can see, and
  "later" is only ever a proxy for it — but the rule as written does not say so.
- **Q2 — does the drawer keep winning over a dock-bar tooltip (pair 12)?** See F4. Cheapest answer is
  yes, written down.
- **Q3 — how should a native modal silence the JS tiers (F3)?** A target test inside
  `useEscapeToClose` (no new state, no new seam), or an explicit `enabled` flag fed by a small
  `useNativeModalOpen()` hook (more honest, one more thing to keep in sync). The same choice then
  applies to the drawer for pair 16.
- **Q4 — should the annotation draft survive at all?** Every lossy pair here is lossy because
  `setAnnotating(null)` throws the draft away. If Annotate kept its draft across a close — as
  `ChatPanel` already does for the composer (`drafts` in `ChatPanel.tsx`) — pairs 1, 2 and 3 stop
  being *losses* and become merely wrong *ordering*, which is a much smaller thing to get right.
