Verdict: **refuse the plan as written**. No P0s. F1–F5 are established P1s against `d0bdb31c`; most importantly, removing `<thead>` makes the floating gist panels disappear, and the proposed scroll fallback can measure article content as chrome.

All code line references below are against `d0bdb31c`.

## Findings

### F1 — P1, established: removing `<thead>` removes every floating gist panel

(a) [`useColumnContext.ts:107`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/useColumnContext.ts:107>) derives every column rectangle from `thead th[data-col]`, then omits any depth without a header at line 136. [`TableView.tsx:1341`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/TableView.tsx:1341>) passes the missing rectangle to `ContextPanel`, which returns nothing at [`ContextPanel.tsx:202`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/ContextPanel.tsx:202>).

Worse, the underlying gist cell deliberately suppresses its content while panels are enabled at [`TableView.tsx:1033`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/TableView.tsx:1033>). Therefore, after Stage 3, Parts/Sections become empty boundaries and click targets.

(b) Replace Stage 3’s first implementation sentence with:

> Before removing the visible header row, move `useColumnContext` off `<thead>`: derive each column’s `left` and `width` from the first `tbody td.depth-${d}`, derive `clipLeft` from `tbody td.pin-left`, and use `stickyOffset()` as the panels’ top. Add `useColumnContext.ts` and a test proving that context panels receive rectangles when no visible head exists. Only then remove the visible header row.

### F2 — P1, established: article tables become false sticky chrome

(a) The proposed “head alone” branch retains the global `document.querySelector("thead th")` from [`scroll.ts:75`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/scroll.ts:75>). Article HTML is injected beneath the table at [`TableView.tsx:1220`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/TableView.tsx:1220>).

I ran the permitted sanitizer harness; an ordinary article fragment containing `<table><thead><tr><th>…` survived intact. Once Spideryarn’s own head is gone, that article `<th>` becomes the first match. Deep links, arrows, and `?at=` then add an arbitrary content-header height even though it is not fixed chrome.

(b) Stage 3 should say:

> Once the reader’s visible table head is removed, `stickyOffset()` must not query `thead` at all. It measures only owned chrome selected by its dedicated class.

Add a regression test with an ordinary article `<thead>` present as a decoy.

### F3 — P1, established: “neither means 0” is wrong with a safe-area inset

(a) The plan states `0` when neither element exists at [plan line 158](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/docs/plans/260905d-declutter-the-reading-view-top-bars.md:158>) and again at [line 177](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/docs/plans/260905d-declutter-the-reading-view-top-bars.md:177>). But [`styles.css:396`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/styles.css:396>) draws a fixed, opaque `.reader::before` with height `--safe-top`. The existing `stickyOffset()` commentary explicitly identifies `safeTop` as the floor at [`scroll.ts:122`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/scroll.ts:122>).

On an installed notched device, a no-bar mode would place the target at viewport y=0, behind roughly 47px of status-area backstop.

(b) F2 and F3 are both closed by this shape:

```ts
export function stickyOffset(): number {
  const safeTop = safeAreaInsets().top;
  const bar = document.querySelector<HTMLElement>(".controls");
  if (!bar) return safeTop;

  const rect = bar.getBoundingClientRect();
  return Math.max(safeTop, Math.min(rect.height + safeTop, rect.bottom));
}
```

Replace “`0` only when neither” with “`safeTop` when there is no controls bar.” Test both `safeTop = 0` and a non-zero inset.

### F4 — P1, established: deleting `.mode` breaks the retained `ViewOnlyChip`

(a) Stage 1 explicitly deletes `.mode` at [plan line 131](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/docs/plans/260905d-declutter-the-reading-view-top-bars.md:131>). The retained `ViewOnlyChip` renders `className="mode on"` at [`PublicChrome.tsx:75`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/PublicChrome.tsx:75>), with an explicit comment at line 71 naming `.mode` as its styling contract. The rules being deleted are at [`styles.css:728`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/styles.css:728>).

The visitor’s persistent read-only explanation therefore loses its intended typography, colour, case, and spacing.

(b) Replace the Stage 1 file wording with:

> Delete `.controls-label`, `.provenance`, `.keynav`, the obsolete link-button rules and `.mode-close`. Retain `.mode` because `ViewOnlyChip` still uses it.

Renaming it to `.view-only-chip` first would also work, but is a larger change.

### F5 — P1, established: deleting the head removes the table’s accessible column names

(a) The current table’s column semantics are the `<th>` elements at [`TableView.tsx:736`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/TableView.tsx:736>), including the prose heading at line 762. The granularity pills are outside the table and cannot name cells during screen-reader table navigation. “The pills take its job” at [plan line 152](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/docs/plans/260905d-declutter-the-reading-view-top-bars.md:152>) is therefore only visually true.

(b) Change “remove the `<thead>`” to:

> Remove the header row from visual layout, but retain a non-`display:none`, visually hidden `<thead>` with `<th scope="col">` labels. Where rowspan makes implicit association unreliable, connect data cells to those headers with stable `headers` IDs. Neither scrolling nor column geometry may query this hidden head.

### F6 — P1, established: legacy `?text=0` becomes a state with no way out

(a) `text` remains URL state at [`App.tsx:1687`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/App.tsx:1687>) and controls Hierarchy prose at line 1771. Dock mode selection only calls `onMode(m.mode)` at [`Dock.tsx:1445`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/Dock.tsx:1445>).

An old `?mode=hierarchy&text=0` link still opens outline-only Hierarchy, but after removing the Text toggle the reader cannot restore the prose except by manually editing the URL. Visiting another mode only masks the value; returning to Hierarchy exposes it again.

(b) Add:

> Preserve a one-way `Show text` recovery pill only while Hierarchy is rendering legacy `?text=0`. Activating it removes `text` from the URL. Do not retain the general Text toggle.

That keeps old links meaningful without making the legacy state permanent.

### F7 — P1, reasoned: `--bar-h` is not a presence token

(a) Stage 4 says `--bar-h` falls to zero at [plan line 175](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/docs/plans/260905d-declutter-the-reading-view-top-bars.md:175>). But it also sizes `.logo-home` at [`styles.css:3702`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/styles.css:3702>) and `.fb-button` at [`styles.css:13904`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/styles.css:13904>). If the dynamic value is placed where those fixed siblings inherit it, both hit areas collapse to zero.

Even if the override is scoped under `.reader`, the band begins at `--safe-top` and can collide with both fixed corners. The plan’s remedy names only the logo.

(b) Replace Stage 4’s token paragraph with:

> `--bar-h` remains the nominal 2.75rem control/corner height because HomeLogo and FeedbackButton consume it. Only the presence-sensitive `--bar-bottom` becomes `var(--safe-top)` below a no-controls reader. `--bar-hide` remains the mobile controls transform token and needs no absent-bar state. No-bar mode bands must explicitly clear or reserve both fixed corners, not only HomeLogo.

### F8 — P1, reasoned: the proposed aim rule is incomplete and can destroy the pinned-column cue

(a) Gist cells have `depth-N` at [`TableView.tsx:1011`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/TableView.tsx:1011>), but the prose cell at [`TableView.tsx:1127`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/TableView.tsx:1127>) does not. Thus the suggested `td.depth-N` shape cannot show a prose aim.

Also, `.pin-left` already owns `box-shadow` at [`styles.css:890`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/styles.css:890>). Assigning another `box-shadow` for aim replaces the overflow-layer shadow rather than composing with it.

(b) Amend Stage 3:

> Specify and test the complete aim selector matrix: every currently supported gist depth, prose, and spine. Do not use `box-shadow` for the cell wash unless the pinned shadow is explicitly composed. Prefer a later `background-image: linear-gradient(...)`, which paints above each cell’s opaque background without replacing its background colour or pinned shadow. Test prose aim, aimed pinned column while horizontally scrolled, and a four-deep fixture.

### F9 — P2, reasoned: “delete `.only-prose`” can silently break masthead alignment

(a) Stage 3 lists `.only-prose` among removals at [plan line 167](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/docs/plans/260905d-declutter-the-reading-view-top-bars.md:167>). Only one use hides the redundant head, at [`styles.css:12462`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/styles.css:12462>). A separate rule at [`styles.css:12628`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/styles.css:12628>) uses the same class to align the masthead with centred prose, and [`prose-centred-in-its-cell.test.ts:123`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/tests/prose-centred-in-its-cell.test.ts:123>) asserts that contract.

(b) Replace the parenthesis with:

> Delete only `table.only-prose thead`; retain TableView’s `only-prose` marker and the masthead-alignment rule that consumes it.

If the intent was already only the head rule, this removes dangerous ambiguity.

### F10 — P2, established: this does not stay out of `structure-mode`’s way

(a) The plan acknowledges only the other plan’s width negotiation at [line 194](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/docs/plans/260905d-declutter-the-reading-view-top-bars.md:194>). But `260903b` also changes the controls, removes legacy URL state, makes depth adaptive, and later replaces the same TableView/ContextPanel machinery. Both plans touch `App.tsx`, `layout.ts`, `keynav.ts`, `styles.css`, column naming, navigation rungs, and the meaning of `text=0`.

This is semantic overlap, not merely a likely merge conflict.

(b) Add a dependency section:

> Do not execute this plan concurrently with `260903b`. Choose an order and merge `dev` between stages. If Structure’s TableView-removal stage lands first, retire this plan’s Stages 2–3 and port only the top-bar/scroll contracts. If decluttering lands first, `structure-mode` must merge it before continuing and adapt its URL, navigation and adaptive-depth work to the new contracts.

## Answers to the named suspicions

- The correct no-bar `stickyOffset()` floor is `safeTop`, not zero. After the visual head goes, there is no legitimate “head alone” branch.
- Keep `--bar-h` nominal. Change only `--bar-bottom`; `--bar-hide` remains the mobile transform token.
- The spine default flip does **not** move the `band-covers` crossover: its changed case is `text=0` in Hierarchy, where no mode band is open. It can change Hierarchy autofit thresholds by consuming `SPINE_W`; add a direct `fitView({showText:false, showSpine:null})` test because `spine-width.test.ts`’s band cases do not establish that.
- The proposed box-shadow aim rule is not sound for pinned cells and does not inherently cover prose.
- Outline’s arc path itself is correctly separated: [`App.tsx:3282`](</home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/App.tsx:3282>) passes `arcCells` directly to `OutlinePanel`. Keeping that call plus `useArc` preserves rung 4.

I changed no files. `tests/mobile-chrome.test.ts` passed 13/13, but it exercises the existing implementation, not the proposed no-head/no-bar cases. The worktree changed concurrently during the review, so I anchored all code inspection with `git show d0bdb31c`; the reviewed plan snapshot had SHA-256 `b89ee438960e8c5b57bbf711a9eae1a497e7b8f69b4429ea64b32804e3a544f8`.