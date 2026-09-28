# 260928b — One block-link component, with a rich tooltip and a flash on arrival

> MEDIUM PRIORITY Delegate new task: We should have a reusable component for a block-link (e.g. from
> Glossary, Citations, Chat, etc). Find all the block links and update them to use this new
> component. It should have a rich tooltip (that provides useful info about the block, including
> perhaps a preview - see @docs/project/tooltips.md ) , and when you click it the relevant block
> should flash for a second or so in the text so you can see which one it is, and anything else that
> you think will improve the user experience.
>
> — Greg, 2026-09-28

Status: **built, 2026-09-28** — stages 1–3 below; Sol plan review *build with changes* (all
seven taken), code reviews round 1 and round 2 both *approve with the working-tree fixes*; browser
check passed at desktop and iPad widths. Run unattended by an Overseer-started session; the calls Greg's
words do not settle are recorded under [Assumptions](#assumptions).

## What exists, and the decision to build on it

**`src/web/BlockRef.tsx` is already the component.** It draws an id as a real `<a href="?at=…">`,
drops the `spya-` prefix, hands a plain left-click to `onJump` and leaves ⌘-click, right-click and
middle-click to the browser. About fifteen panels use it. So this is **not a second component**: it
is `BlockRef` grown into the one thing Greg describes, and the hand-rolled links moved onto it.
Replacing it would change nothing that matters and cost every caller an edit for a rename; the name
stays.

What it lacks, measured against Greg's ask:

| Greg asked for | Today |
|---|---|
| a rich tooltip with a preview | only inside chat/summary prose: `Cited.tsx` wraps `BlockRef` in a `Tooltip` with `CitedBlock` (the paragraph, truncated). Everywhere else a native `title={id}` — which tooltips.md calls a regression, not a shortcut |
| the block flashes on arrival | **nothing flashes anywhere.** The inventory found no arrival highlight in `src/web` |
| a way back | **already done, and already free**: every `onJump` in the reading view is `jumpTo` → `beginJump`, which stamps the entry and makes `ReturnChip` offer *↩ back to ‹section›* ([260906g](260906g-back-to-where-you-jumped-from.md), [260916a](260916a-back-to-where-you-were-survives-a-mode-change.md)). Nothing to build; the plan must only not route around it |

## The inventory (2026-09-28, Sonnet trawl, each hit read by me)

Every jump in the reading view funnels through one chain: `jumpTo`
(`reader/useReadingPosition.ts`) → `beginJump` (`keynav.ts`) → push `?at=` + `scrollToBlock`
(`scroll.ts`). That is the single fact the design leans on.

**A. Already `BlockRef` / `BlockRange`** (id text): `PassageLinks` (chat, live conversation),
`Cited` (chat answers, summaries), `GlossaryPanel` ×3, `QuizPanel`, `QuotesPanel`, `TimelinePanel`,
`IdeasPanel`, `FaqPanel`, `CitationsPanel`, `CandidatesPanel`, `DebatePanel`, `SummaryPanel`
(range), `ContextList` (range), `TableView` (range in a gist cell). `BlockGutter` uses `blockHref`
only — its left-click copies, deliberately (block-ids.md), and stays as it is.

**B. Hand-rolled links whose only job is "go to this passage"** — a `<button onClick={() =>
onJump(id)}>` around a quote or a phrase. These are what "find all the block links and update them"
means, and they move onto the component:

- `ClaimsPanel.tsx` ×3 (`.clm-jump`, the quoted passage)
- `CriteriaPanel.tsx` (`.crit-jump`, the quoted passage)
- `MirrorPanel.tsx` (`.mir-jump`, the reader's own comment quote)
- `SketchView.tsx` (`.sk-card-jump`, "Go to this passage")
- `SearchPanel.tsx` (`.srch-hit-btn`, the matched quote)
- `IdeasPanel.tsx`, `TimelinePanel.tsx` (the found passage's quote button)
- `TrajectoryPanel.tsx` (`.traj-go`, a stop's number and breadcrumb) — trajectory mode **has
  landed**, so it is in scope
- `ProseHoverCard.tsx` "go there" (the footnote/link card's foot button)

Each is decided at build time on one question: *is it a link to a place, or a control that also
moves the page?* A link becomes a `BlockRef` with children. One that is a control (does something
besides going there — selects, opens, toggles) keeps its button and gets the flash for free from C.

**C. Navigation surfaces that are not block links, and stay as they are.** Each already has its own
card or its own gesture, and wrapping it in a link would fight that: the spine's bands
(reveal-then-commit on touch), Structure and Outline rows (their own cards, tree semantics), gist
cells in the table, `ContextList` rows, diagram nodes and step buttons, Trajectory's
Previous/Next, `GlossaryPanel`'s term select (selects *and* jumps), the comments drawer's rows,
`BlockNav`'s ‹ ›. **They still get the flash**, because the flash lives in `beginJump`, not in the
component (below). Arrow keys, swipe, comment Prev/Next and `BlockNav.nudgeTo` call
`scrollToBlock` directly and deliberately push nothing — stepping, not jumping — and do not flash.

**D. Injected HTML** (tooltips.md § The second implementation): the article's own internal links in
the prose (`TableView`'s delegated `tbody` click), the lightbox copy, and `NoteCard`'s preview.
There is no React element to render a component into, and `ProseHoverCard` already gives the
article's links their card ([links.md](../project/links.md)). They call `onJump`, so **they flash
too**; they get no new tooltip.

## The design

### 1. The flash lives in the jump, not in the link

`beginJump` is the one place every deliberate jump passes through, so the flash goes there:
`flashBlock(id)` in `scroll.ts` (beside `scrollToBlock`), called by `beginJump` on **both** of its
branches.

- **The moved branch**: the flash starts when the glide lands, not when it starts — a flash that
  finishes mid-scroll is a flash nobody saw. `glide` gets a completion hook (or `flashBlock` waits
  `SCROLL_MS`); the implementer picks whichever is simpler to test, and a glide cancelled by the
  reader's wheel does not flash.
- **The already-there branch** is the better half. `beginJump` deliberately does nothing when the
  reader is already on the target (keynav.ts § "clicking a search result for the paragraph you are
  already reading now does nothing at all"). A flash there answers "which one is it" without moving
  anybody and without costing a Back — it turns that accepted wart into the right behaviour.
- **What flashes**: the verbatim cell of `tr[data-block=id]` — the prose, not the gist columns.
  A class added and removed (`.block-flash`, ~1.2s), keyed so a second click restarts it.
- **`prefers-reduced-motion`**: the same wash, held static for the same time and then removed
  without a fade — `reducedMotion()` from `scroll.ts` is the one test for it.
- **No second jump-and-highlight mechanism exists to reuse** — the footnote `[data-came-from]` mark
  is persistent state about a return path, not an arrival.

### 2. The tooltip lives in `BlockRef`

`BlockRef` reads a small context, `BlockLinkContext`, provided once by `Reader`:
`{ text(id): string | undefined, section(id): string | undefined }` — built from the `blockText`
map Reader already has and `sectionIndexContaining(sections, rowOf, id)`, the same resolver
`ReturnChip` names its place with. No new index.

The card, following tooltips.md and **defined by subtraction**:

- **head**: the section it is in — the one thing no caller shows (a panel lists occurrences, not
  where they sit).
- **preview**: the paragraph, truncated with `snippet()` — the exact `CitedBlock` content, which
  moves here and stops being Cited's private card. **A caller already showing the passage passes
  `preview={false}`**: Quotes, Claims, Search and the other quote buttons draw the words beside the
  link, and a card repeating them is the restatement failure tooltips.md names.
- **no "click to go there" foot line**: that is what a link is. The id stays in `aria-label`
  territory and the `href`.

`title` goes. Without a provider (a test, a page outside the reader) there is no card and the
accessible name still carries the id.

`Cited`'s `live` rule is kept: while an answer streams there is no Floating UI instance per chip
(`tip={false}`); with `title` gone the gap is simply no card for those seconds, which is fine.

### 3. A link to a block that is not in this article

`Cited` already draws an id the article lacks as plain text, on the argument that a dead chip is
worse than noise (block-ids.md § Showing an id). `BlockRef` adopts that rule generally, **but only
when a provider can answer**: with the context present and `text(id) === undefined`, it renders a
dimmed, non-link span whose card says the passage is not in this version of the article (the
re-extraction case in block-ids.md). Without a provider it cannot know, and stays a link.

### 4. Keyboard and touch

It is an `<a href>`, so Tab reaches it and Enter follows it; the card opens on focus, as every
`Tooltip` does. On touch: no reveal-then-commit. A tap goes straight there, and the flash plus the
back chip are the confirmation. Reveal-then-commit exists for the spine because a two-pixel band
tapped blind is a coin flip (touch.md); a block link is a legible word, and making every link in
every panel take two taps would be a tax on the common case. `Tooltip`'s default hover handling on
touch is left alone.

## What was passed over

- **The flash inside the component's click handler.** Simpler to read, and wrong: half the jumps
  (group C, group D) never pass through the component, so the same act would flash in one panel and
  not the next. The jump is the one place they meet.
- **Converting group C too.** It would make "every block link uses the component" literally true and
  cost the spine its touch gesture, Structure its cards and trees their roles — for a card most of
  them already have.
- **A new `BlockLink` beside `BlockRef`.** Two components for one idea is what block-ids.md's
  "one component rather than four spans that drift apart" was written against.
- **Reveal-then-commit on touch** — above.

## Stages

1. **The component and the flash.** `flashBlock` + CSS + reduced motion, called from `beginJump`;
   `BlockLinkContext` provided in `Reader`; `BlockRef` gains the card, `preview`, `tip`, `children`,
   the missing-block state, and loses `title`; `CitedBlock` folds into it. Tests red first:
   `beginJump` flashes on both branches; the flash waits for the glide and is static under reduced
   motion; the card shows section + snippet and omits the preview when asked; no `title`; an unknown
   id with a provider is not a link. Docs: block-ids.md § Showing an id, tooltips.md's table.
   Sol code review.
2. **Migrate group B**, one caller at a time, `preview` decided per caller, with the class names the
   panels' CSS already styles kept on the anchor. Existing panel tests updated where they look for a
   `button`. Sol code review.
3. **Browser check** (Sonnet, desktop and iPad widths): hover a chip in chat and in Glossary, click
   it, see the flash and the back chip; reduced motion; a migrated quote button. Close the plan.

## Assumptions

- "Block link" means group A + B; C and D get the flash and not the component (above).
- The tooltip's head is the section title, not a part › section crumb: the spine's card carries
  the crumb because the rail cannot; here one line is enough, and more is a card nobody reads.
- The flash is ~1.2s; Greg said "a second or so".
- Touch is one tap.

## Coordination

Trajectory (landed — its `.traj-go` is migrated in stage 2), fb44 (prompt wording, no overlap),
shelf-topics (home page, no overlap). Merge `origin/dev` before each stage.

## Plan review (GPT Sol, 2026-09-28) — and what changed

[260928b-block-link-plan-review-sol.md](260928b-block-link-plan-review-sol.md). Verdict *build with
changes*; all seven taken. **This section overrides the design above where they differ.**

- **F1 (P1) — the flash waits for a real landing, never a timer.** `scrollToBlock` reports how it
  ended — `settled` (instant, sub-pixel, or the glide's last frame), `cancelled` (wheel, touch, a
  newer scroll), `missing` (no row) — through a callback. The flash fires only on `settled`.
  `beginJump`'s already-there branch **cancels any glide in flight** before flashing, so a block
  that is being carried past does not flash and then leave.
- **F2 (P1) — a flash nobody can see is deferred, or dropped, deliberately.** On a narrow window
  most bands cover the article (`.reader.band-covers` with a band open and not `.band-away`). There
  the flash is **held pending** and fires when the prose is next exposed — the reader closes the
  band or it steps aside — so leaving the mode shows you where you landed. `Reader` owns that state
  and calls the flush. A newer jump replaces the pending one. With the prose column off (outline
  view, `showText` false) there is no prose to flash: **no flash**, and the gist column's own
  current-row highlight is what says where you are. Tested both ways.
- **F3 (P1) — group B, enumerated rather than decided later.** Migrate: `ClaimsPanel` ×3, the pure
  `CriteriaPanel` placement (line ~1441), `SketchView`'s "Go to this passage", `ProseHoverCard`'s
  "go there". **Stay buttons** (they select or update state as well as go, and an anchor's ⌘-click
  would skip that): Search hits, Ideas and Timeline quote buttons, the composite Criteria result,
  Trajectory's stops. Mirror stays too — it has its own provenance card, and the generic one would
  replace something more specific. Everything that stays gets the flash through `beginJump`.
- **F4 (P1) — one card for the whole page, not one Floating UI instance per link.** Glossary emits
  a link per occurrence, literal search is uncapped, and `TableView` draws two per gist cell. So the
  card is **one delegated panel** mounted by the provider — the `ProseHoverCard` shape (tooltips.md
  § The second implementation): `BlockRef` renders `data-block-link={id}`, and a delegated
  `pointerover`/`focusin` positions a single panel with `setPositionReference`. It also removes
  Cited's per-chip `Tooltip` and its `live` exemption: one panel costs nothing while an answer
  streams. This is the third customer tooltips.md predicted; the plan does **not** extract a shared
  hook from `useHoverCard` yet — `ProseHoverCard` carries interactive content and a touch gesture
  this card does not want — but says so in tooltips.md.
- **F5 (P2)** — the context value is one memoised `Map<BlockId, { text, section }>`, built in one
  linear pass over sections × blocks, and stable across position renders.
- **F6 (P1)** — accessible names: an id chip is named by its id (short id as text, full id in an
  `sr-only` span or `aria-label` only on the default rendering); a link with `children` is named by
  them. The card is the description (`aria-describedby` while open). The missing-block span carries
  its explanation as `sr-only` text as well as in the card, since a span takes no focus.
- **F7 (P2) — the scope, stated exactly.** The flash is on **history-pushing in-place jumps** —
  `beginJump` — which covers every block link and every deliberate navigation control (glossary
  select, diagram node, gist cell, search hit). It does **not** fire on Back/Forward, a pasted link,
  initial arrival, the return chip, or stepping (arrows, swipe, ‹ ›, comment Prev/Next, Trajectory
  Prev/Next). Stepping moves one item at a time and a flash on every step is noise; Back and the
  return chip return you to a place you chose to leave. Tested as exclusions.

## Stage 2 — what landed

Each site checked first: a site migrated only if its click did `onJump(id)` and nothing else.
Tests: `tests/block-link-migration.test.tsx` (Claims, Sketch), the placement case in
`tests/referee-gap.test.tsx`, and Summary's title in `tests/summary-expand.test.tsx` — an
`a[data-block-link]` with `at=` in its `href`, one jump on a plain click, none on ⌘-click; all
red before the change.

**Migrated to `BlockRef` with children** (classes kept; each panel's CSS gains a two-class
`.x.block-ref` rule, because `.block-ref`'s id-chip type in prose.css would otherwise win or lose on
stylesheet order; colour, opacity and underline go on `a.x` only, so the missing-block span keeps
its strike-through):

- `ClaimsPanel` ×3 `.clm-jump` — the claim's quote, each passage, the other text — `preview={false}`:
  the quote is the link's text.
- `CriteriaPanel` placement `.crit-jump` (misses and unpaired) — `preview={false}`, same reason.
- `SketchView` "Go to this passage" `.sk-card-jump` — preview **on**: the Sketch card shows the
  model's words for the node, never the paragraph. The delegated card portals into an open modal
  dialog when its anchor is inside one, so it remains above the top layer in Enlarge.
- `SummaryPanel` `.summ-title` — round 2's inventory grep found the omitted pure jump: the section
  title did nothing but `onJump(entry.node.range[0])`. Its parent already excludes both `button`
  and `a` from the widened row click, and the card's preview adds the opening passage the summary
  row does not show.

**Kept as buttons:**

- `CriteriaPanel`'s composite result — opens the row (`onOpen`) as well as jumping; ⌘-click would
  skip the opening. Asserted in `referee-gap.test.tsx`.
- `ProseHoverCard`'s "go there" / "back to the passage" — it sits inside an interactive card that
  already shows the destination's words. As a `BlockRef` it would open the block card on top of that
  card, and `preview={false}` still draws the section heading, so it is still a card on a card.
  Moving the pointer onto that second card could also count as leaving the first, which would close
  it. `BlockRef` has no way to switch its card off, so this stays a button. If we want the `href`
  here, the fix is a `card={false}` on `BlockRef`, which is stage 1's file.
- Search hits, Ideas and Timeline quote buttons, Trajectory stops, and Mirror are unchanged, per F3.

## Stage 3 — the browser check, and the close

Sonnet, Playwright on the box, local stack, articles `writes` (glossary, summary) and
`openai-huggingface` (glossary, quotes). Measured, not eyeballed:

- **Card**: one `.tooltip-anchor` on hover, section + preview, `.tooltip` background
  `oklch(0.26 0 0)`; no `title` attribute. Opens on keyboard focus; a tap opens none.
- **Flash**: `td.text.block-flash` 46–73ms after the click (the glide is short), gone at ~1.25s;
  the wash is an inset shadow of `--highlight-wash` (~0.257 oklab lightness against the page's
  0.145), `.prose` transparent over it. Visible in a crop as a warm brown fill; subtle next to the
  green search marks in a full-page shot, which is the house wash and left as it is.
- **Already there**: a second click flashes with `scrollY` unchanged.
- **Reduced motion**: `block-flash-still`.
- **Return chip**: appears after a jump.
- **Covered band**: at the two iPad widths (768, 1024) the Glossary band never covers the prose —
  `bandCoversProse` covers only below ~688px net of the spine — so the deferral was exercised at
  650px instead: no flash while covered, and it fired on pressing Plain.
- **Summary titles**: normal panel type; the card omits the section head where the title is the
  section (1.1, 1.2) and keeps it on a Part whose first block sits in a differently named section,
  which is correct.
- **Not checked**: Referee (Claims/Criteria) — the local fixtures have no referee data; covered by
  unit tests only. Console: one pre-existing `SignedIn` setState warning on sign-in, unrelated.

After round 2, one change of mine, red first: **the card drops its section head when the link's own
text already contains it** (a Summary title), and opens no card at all if that head was all it had.

### What is left over

- `ProseHoverCard`'s foot button and the other kept buttons above — deliberate.
- Group C (spine, Structure, Outline, gist cells, diagram nodes, drawer rows) and group D (the
  article's own links in the prose, lightbox, note card) have no new card, by design; they flash.
- The full suite in the worktree: 25,208 passed, 6 files red, none this work's —
  `cold-start-lazy-imports` and `pdf-bundle-trace` want `npm run build`, the three `fleet-*` files
  want the fleet dashboard's `dist/`, and `client-imports` was Trajectory's `section-path.js`
  import, which passes again after merging origin/dev.

The wash, cropped: [before](260928b-block-link-flash-before.png), [150ms after landing](260928b-block-link-flash-at-150ms.png).
