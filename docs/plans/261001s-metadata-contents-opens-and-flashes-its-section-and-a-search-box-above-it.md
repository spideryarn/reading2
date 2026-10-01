# Metadata: the contents list opens and flashes its section, and a search box above it

Two suggestions from Greg (admin), both about the Metadata page's contents list in the left margin
(`src/web/PageContents.tsx`), batched as Overseer queue item `qi-xfekey3t`.

SPIDERYARN-READING2-7Y (`spya-jgwmaf`), 2026-10-01:

> If I click on the Table of Contents in the left-hand of the Metadata page, expand that section (if
> needed) and flash to show where it is in the page.

SPIDERYARN-READING2-83 (`spya-vn72ww`), 2026-10-01:

> Add a Search box (above the left-hand table-of-contents) to the Metadata page (and make sure it
> does a good job of finding things, including synonyms), and then should scroll to the right place,
> expand the section, flash it, etc (reusing machinery).

## What there is today

- `PageContents` scans its container for `[data-section]` and draws a button per section. A click
  calls `scrollIntoView` on the section, and nothing else: a shut collapsible section stays shut, and
  nothing marks where you landed except the margin highlight.
- `Section` (Metadata.tsx) owns its `open` state locally — on purpose, not in the URL (its comment
  says why). Six sections are collapsible: Authors, Delete, AI processing, What it cost, Export,
  Technical details. Three of those use `keepMounted`, so their content is in the DOM while shut; the
  other three unmount theirs.
- The reading view's flash (`src/web/flash.ts`) washes a block's prose cell warm for `FLASH_MS`
  (1.2 s), restartably, with a still wash for reduced motion. It is block-addressed (`blockRow(id)`),
  and its CSS (`prose.css § the flash on arrival`) is scoped to `td.text`.

## The design

### 1. One verb: *reveal* a section (7Y)

`PageContents` gets one function, `reveal(sectionEl)`, used by a click and by search:

1. **Open it.** It dispatches a DOM `CustomEvent("section-reveal")` on the section element. `Section`
   listens on its own `<section>` (a ref and an effect) and calls `setOpen(true)`. A section that is
   not collapsible ignores it — it is already showing.
2. **Scroll to it** — the same `scrollIntoView({ behavior: "smooth", block: "start" })` as today,
   `"auto"` under reduced motion. Opening only adds content *below* the heading, so the target does
   not move as the section opens.
3. **Flash it.** The whole `<section>` washes, the reading view's colour and length.

**Why an event and not lifting state.** Lifting every section's `open` into the page, or into a
context keyed by label, would make PageContents need to know the page's sections — the second list
of section names its docstring exists to avoid. The DOM is already the contract between the two
(`data-section`, `id`); an event on the same element keeps it the only one. The simpler option
passed over: an `open` attribute PageContents sets directly on the DOM — React would overwrite it on
the next render, and the state would disagree with the screen.

### 2. The flash, shared with the reading view

`flash.ts` gains `flashElement(el)`: the restartable class toggle and timer, the reduced-motion still
variant, the same `FLASH_MS`. `flashBlock` keeps its block-specific parts (finding the cell, the
held flash behind a band, the passage marks) and calls through the same toggle where it can without
changing behaviour. CSS: `.section-flash` / `.section-flash-still` beside the block ones in a
Metadata-page rule, using the same `--highlight-wash` and `--flash-ms`, and `border-radius` so the
wash has the card's corners. A `box-shadow` inset wash as the block one uses, for the same reason
(it paints over whatever background is there).

### 3. The search box (83)

Above the contents list, in the same fixed margin column: one text input, placeholder *Search this
page*. Typing filters and re-orders the list beneath it to the sections that match, best first.
**Enter reveals the top match** (§ 1); clicking any listed match reveals it; **Escape clears** the
box and restores the full list. Empty box: the list is exactly today's.

**What it searches, without a model.** A pure module, `src/web/page-search.ts`, tested on its own:

- Each section's **label**, its **aside** (the heading's one-line answer, e.g. *$0.0123 · 12 calls*),
  a short **`keywords`** list the page authors on each `<Section>` (rendered as `data-keywords`), and
  the section's **visible text** where its content is mounted.
- **Synonyms** from one small hand-written table in that module — groups like
  *cost / price / spend / money / dollars / bill*, *delete / remove / erase / trash*, *share / public
  / link / visibility / private*, *export / download / backup / save*, *rerun / regenerate / redo /
  refresh / again*. A query term matches any member of its group.
- Light normalisation: case, accents, a trailing plural / *-ing* / *-ed* stripped, and prefix match
  so *expo* finds Export as you type.
- Score: label hit beats keyword hit beats aside hit beats body-text hit; a direct hit beats a
  synonym hit; every query word must hit somewhere (AND), so *delete article* does not return every
  section with *article* in it.

**Why authored keywords as well as the text.** Three collapsible sections unmount their content when
shut, so their words are not on the page to search; and the words a reader types (*price*,
*download*, *who wrote it*) are often not the words a section prints. A `keywords` prop is beside
the section it describes, in the one place that already declares the label — not a second list
elsewhere.

**Cost named:** none per keystroke. A model call per keystroke (or an embedding lookup) would find
paraphrases a table cannot, at a cost and latency on every key, for a page with a dozen sections.
That is the deferred version, if the table proves too small.

## Deferred, named

- **Landing on the matching line inside a section**, rather than the section's heading. v1 searches
  only the section's label, authored keywords and heading aside, so the heading is the honest
  destination for every result. Searching body text and landing on its matching line are one later
  feature; *AI processing* is long enough that doing only the first half would be misleading.
- **Narrow windows.** The contents list is `xl`-only, and the search box lives with it, so below
  1280px neither is drawn. A separate report (9M, the contents list on an iPad) has its own session
  deciding what the margin list becomes on a narrow window; the search box follows that rather than
  inventing a second narrow-window design now.
- **⌘-F / `/` to focus the box.** ⌘-K already opens the command bar on this page; a key for this
  box can come when it is asked for.

## Stages

One stage — it is small:

1. `page-search.ts` with red-first tests (`tests/page-search.test.ts`): synonyms, prefix, plural,
   AND, ranking label > keyword > body.
2. `flashElement` in `flash.ts`, with the existing `tests/block-flash.test.ts` still green and a new
   case for an element.
3. `Section` listens for `section-reveal`; `PageContents` reveals on click and on search; keywords
   on each `<Section>`. Red-first component test: click a shut section's entry → it opens and carries
   the flash class; type *price* → *What it cost* is the first entry; Enter reveals it.
4. Browser check (Playwright on the box), desktop 1440 and 390px.

Reviews: GPT Sol on this plan before building; GPT Sol on the code (workspace-write) before push.

## After GPT Sol's plan review — what changed

The review is
[261001s-…-plan-review-sol.md](261001s-metadata-contents-opens-and-flashes-its-section-and-a-search-box-above-it-plan-review-sol.md).
Taken, each one checked against the code:

1. **Open is committed before the scroll** (P1). `Section`'s listener wraps `setOpen` in
   `flushSync`, so the body is in the DOM when the event returns; a test records the page at the
   moment `scrollIntoView` is called. The flash waits for the scroll to go quiet (120 ms with no
   scroll event, 1.5 s ceiling) rather than firing at the click.
2. **The flash is an overlay, not an inset shadow** (P1). A section is mostly opaque cards, and an
   inset shadow paints under its children. `::after`, the orange at 22%, `pointer-events: none`.
3. **Focus lands on the section's heading** (P1). Every section heading is now `tabIndex={-1}`,
   which replaces the one `landing` prop *Access & sharing* had.
4. **No body text in the search** (P2). Searching it promised "the right place" and then landed on
   the heading, screens above the line in *AI processing*; and half the sections unmount their body
   when shut. v1 searches label, keywords and the heading's aside. Landing on the matching line is
   the deferred version.
5. **The index is fresh** (P2). Keywords and aside are part of the entries, and the observer watches
   `characterData` and `data-keywords`, so a cost that lands while a query is typed re-ranks.
6. **Ranking is explicit** (P2): each query word scores once by its best evidence; place first
   (name > keywords > aside), then kind (whole word > prefix > synonym); ties keep page order.
   Question words (*how much did this*) are dropped from a query that has anything else in it.
7. **A fixed top for the margin column** (P2), so filtering does not move the input under the
   cursor; the list scrolls inside a column that stops short of the dock.
8. **Two pages mounted at once** (P1, tests). Written, and it went red for a real reason: jsdom
   answers `root.querySelector("#id")` from the document's id table, so the second page's lookup
   found nothing. `sectionIn` walks the container's `[data-section]` elements instead.

Not taken: `useId()` for the input — it has no `id`, only an `aria-label`, so two pages cannot
collide on it.

## After GPT Sol's code review — what changed

1. **Only the newest reveal may flash** (P2). Each click used to leave its own two timers and window
   scroll listener behind, so a quick second choice could still flash the first section on its old
   clock. `PageContents` now cancels the superseded wait and cancels it on unmount; a test advances
   through the first deadline before the second and proves the old destination stays dark.
2. **The authored vocabulary covers the page readers actually see** (P2). With body search removed,
   *comments*, *where I left off*, *remove from shelf*, *download my data*, *who can read it*,
   *storage location*, and *read time* had no reliable route. The relevant sections now carry those
   words, ordinary question and contraction fragments are ignored, and the overly broad
   reading/progress/time synonym group was split so *read time* does not rank the PDF or personal
   reading section above *At a glance*. The pure tests use the real section order and vocabulary.
3. **Character changes outside an aside no longer rebuild the index** (P3). The observer still sees
   subtree mutations so conditional sections cannot arrive unnoticed, but it rescans only when a
   section, `data-keywords`, or `[data-section-aside]` may have changed. A component test changes
   unrelated text and then an aside, proving only the latter takes the scan path.
4. **Filtered results are announced** (P2 accessibility). A permanently mounted `role="status"`
   reports the result count while remaining visually hidden; the existing empty-result sentence is
   visible. This covers the otherwise silent change to the list under a focused search field.
5. **The flash test now tests paint, not only state** (P2 test gap). The component test already
   proved the class arrived, but would stay green if the CSS that made the class visible vanished.
   The stylesheet test now pins the orange overlay, its animation/still forms, and
   `pointer-events: none`.

The native `SECTION_REVEAL` listener's `flushSync` was exercised through the real React click path:
the collapsed body is in the DOM at the instant `scrollIntoView` runs, with no React warning. The
fixed margin clears `--dock-space`, the shared `wash` keeps the reading view's block and passage
behaviour, and the old *Share…* caller still focuses the *Access & sharing* heading; no change was
needed in those three areas.

## The browser pass, and the one thing it changed

Playwright against system Chrome on the box, 1440×900 and 390×844, as an admin on a local article.
Everything held: a shut *Technical details* or *Delete this article* opens, its heading takes focus,
and the orange layer (0.22, fading to nothing by ~1.9 s after the click) covers the cards with their
text legible; *download*, *fingerprint*, *slug*, *price*, *remove* and *how much did this cost* each
list the right section; the search box stays at the same top while the list filters; Escape brings
the whole list back; no console errors; at 390px neither box nor list is drawn and there is no
sideways scroll.

**Found:** a section too near the foot of the page cannot be scrolled to the top, so the page
bottoms out, and the margin's "you are here" rule says *at the bottom, the last entry* — it marked
*Delete this article* beside a flash on *Technical details*. Now, at the bottom, the entry the
reader just chose is marked while its heading is on screen; scroll it away and the old rule
returns. A reveal that neither scrolls nor resizes anything asks for a measure itself. Test: *marks
the entry it went to, even when the page cannot scroll that far*, red without the fix.

Headings land at 96px when there is room below them, and lower when there is not; that is the page
being short, not the reveal being wrong, and padding the foot to make it reach was not worth it.
