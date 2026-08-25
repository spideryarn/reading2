# The reading view — panes, rail, and what consolidating them cost

The shell everything else hung off: a resizable two-pane layout with a permanent icon rail. It is
their second attempt, and the migration from the first broke something that took a week and an
architectural change to fix. That is the part to read.

Reference doc: `docs/reference/UI_INTERFACE.md`. Code:
`components/resizable-document-layout.tsx`, `components/vertical-icon-nav.tsx`,
`components/unified-left-pane.tsx`.

## What it is

- A **30/70 horizontal split** — tools on the left, document on the right — using shadcn's
  `ResizablePanelGroup`. The left pane collapses entirely with Cmd/Ctrl+B.
- A **48px vertical icon rail**, always visible even when the pane is collapsed. Clicking an icon
  both expands the pane and switches which tool is showing. Phosphor icons, orange when active.
- The rail scrolls independently, so it never loses items on a short viewport.

The rail is the good idea here: it means "collapsed" never means "gone". The reader can always see
what tools exist and reopen the pane straight into the one they want, in a single click. Compare our
[spine](../granularity-zoom.md#the-spine-a-birds-eye-rail), which makes the same bet in a different
register — a fixed rail that survives every layout change, because *where am I* must never be the
thing that gets dropped when the window narrows.

## The first attempt, and why it was abandoned

`docs/planning/discarded/250530b_collapsible_resizable_panes.md` planned **three** independently
resizable panes: ToC, document, tools. It was abandoned wholesale in favour of the current design
(`docs/planning/finished/250531b_fresh_2pane_resizable_layout.md`).

Consolidating three panes into one tabbed pane saved space and cost them something specific:
**document → ToC scroll sync broke.** As you scrolled the article, the outline no longer followed.
The repo records the immediate fix as attempted and failed — *"Stage 5.1 ⚠️ ATTEMPTED -
UNSUCCESSFUL"* — and it stayed broken until the whole communication mechanism was replaced a week
later.

**Why it broke is the lesson.** With three panes, each component could hold a direct reference to
the other and push updates at it. Once the ToC became one tab inside a shared pane, it might not be
mounted at all when the document scrolls — so a design built on components talking to each other
directly had nothing to talk to. The fix was not a better wiring diagram; it was a **shared position
store that both panes read**, owned above both of them.

The full three-episode story — including a working auto-scroll feature they deliberately deleted —
is [cross-pane-sync.md](cross-pane-sync.md). It is the most useful page in this folder for anyone
touching our scroll code, because we already hold the shape they arrived at:
[`src/web/position.ts`](../../../src/web/position.ts) owns "where is the reader", the spine and the
URL both read it, and nothing pushes scroll updates at anything
([url-state.md § The unit is a section](../url-state.md#the-unit-is-a-section-not-a-position)).

## Mobile

`ARCHITECTURE_MOBILE.md` and `DESIGN_MOBILE_PLATFORM_DETECTION.md` read as full reference docs but
describe intent more than shipped code: a PWA manifest, auto-collapse below 640px, and
`react-responsive` device detection. Both docs still list "mobile-optimised layout" and "touch
gesture support" as Planned/Future, and `UI_INTERFACE.md`'s own limitations section says mobile
responsiveness is not optimised.

Two takeaways:

1. **There is no working touch pattern to copy.** If we ever want the horizontal zoom gesture on a
   phone, we are starting from scratch — and a trackpad two-finger swipe is not the same gesture as
   a touch drag, which is the thing their doc correctly worried about and never resolved.
2. **Don't let a "Planned" section stand in for finished work.** A reference doc describing
   aspiration in the present tense is worse than no doc: it makes an agent believe the capability
   exists. Our equivalent is
   [web-client.md § How the migration finished](../web-client.md#how-the-migration-finished), which
   names what was done *and what was dropped on purpose* — that framing is the right one, and it
   should stay.

## What we take from this

- **The icon rail pattern** — collapsed chrome that still shows what exists — is worth having if this
  app ever grows a second mode. Not yet: we have one feature.
- **A single always-visible pane beats tabs** at our scale, and sidesteps the mount/unmount problem
  entirely.
- **Own reader position centrally from day one.** This is the one architectural rule this doc
  exists to record.
- **shadcn's `Resizable`** is the component they used and is available to us; if the reading column
  ever becomes user-resizable, that is the boring choice. Note it would have to enter
  [`layout.ts`](../../../src/web/layout.ts)'s fit arithmetic rather than sit beside it, or the two
  will disagree about how wide anything is
  ([granularity-zoom.md](../granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them)).

## See also

- [overview.md](overview.md) — the map to that codebase
- [cross-pane-sync.md](cross-pane-sync.md) — the sync failure this layout caused, and how it was finally fixed
- [structure-panel.md](structure-panel.md) — the panel that lived in the left pane
- [url-state-and-keyboard.md](url-state-and-keyboard.md) — the state layer above this, and the loop it caused
- [../web-client.md](../web-client.md) — our client, its constraints and what's outstanding
- [../granularity-zoom.md#the-spine-a-birds-eye-rail](../granularity-zoom.md#the-spine-a-birds-eye-rail) — our fixed rail, and why it is not a column
