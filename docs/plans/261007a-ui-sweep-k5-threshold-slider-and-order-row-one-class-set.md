# UI sweep K5: the threshold slider and the order row, one set of rules each

Cluster K5 of [the UI sweep umbrella](261007a-ui-sweep-umbrella.md#k5-the-threshold-slider-and-order-row-four-stylesheets-for-one-control),
which is the plan and was reviewed there. This doc records the census, the names chosen, the
evidence that nothing a reader sees changed, what the umbrella got wrong, and what was left.

**A refactor: the goal is that no pixel moves.** The claim made at the end is the narrow one the
umbrella asked for (U18): *no difference in the measured matrix*, with the matrix written out and
what it does not reach listed beside it.

## What it is for

Six bands have a slider that hides weaker results, and five of them have a row of order buttons.
Each is one control to the reader. In the stylesheets the slider was written four times and the
order row twice, kept alike by hand and by two comments that said the copies were needed because
the panels' paddings "differ and always have". They do not differ. This cluster leaves one copy of
each.

It does not touch the question the fifth sweep left open
([261003f](261003f-fifth-codebase-sweep-umbrella.md), question 3: one word and one track for the
sliders). The components stay four: `ThresholdSlider` (Glossary, Citations, FAQ, since that sweep's
cluster 18), Search's `ConfSlider`, Quotes' `BarSlider`, Debate's `StopBar`. Only the class names
the last three emit change. Merging the components was rejected in the umbrella (five flags across
three callers) and is not rebuilt here.

## The census, re-derived

`docs/plans/261007a-ui-sweep-k5-census.mjs.txt` parses every stylesheet `src/web/styles.css`
imports, in import order, and lists each rule whose selector names one of the seven families. On
the tree before the change (`434e03141`): **71 selector occurrences**.

**The slider: ten rules, four times.** `.gloss-gate*` and `.srch-gate*` in `glossary.css`,
`.quotes-bar*` in `quotes.css`, `.dbt-bar*` in `debate.css`.

| Rule | Copies | Declarations |
|---|---:|---|
| root (`padding: 0.4rem 0.7rem 0.5rem; border-bottom`) | 4 | identical |
| `-row`, `-label`, `-reset`, `-reset:hover`, `-reset:focus-visible`, `-range`, `-range:focus-visible`, `-note` | 4 each | identical |
| `-value` | 4 | three identical; `.dbt-bar-value` has no `font-family: var(--font-mono)` and is otherwise the same |

**The order row: eight rules, twice**, plus one rule that named both. `.gloss-sort*` in
`glossary.css`, `.quotes-rank*` in `quotes.css`: the row, the row under `.mode-band.has-about`,
the button, its `:hover` (inside `@media (hover: hover)`), `:active`, `.on`, `:focus-visible`, and
the row's `flex-wrap: nowrap` under `@media (pointer: coarse)`. All identical. The 40px finger
floor in `narrow-window.css` was one rule with the selector list
`.gloss-sort-btn, .quotes-rank-btn`. `.gloss-sort-group` (the scrolling group `OrderGroup.tsx`
draws) was always one copy, and Quotes' row already used it.

**Not part of the dedup.** Search's order row (`.srch-sort*`, eight rules in `search.css`,
including K4's hover guard, focus mark and floor) differs from the others on purpose: its own
radius, its own pressed colour, `display: contents` on its group. Whether it should join is the
umbrella's question 1, which is Greg's. `faq.css` has one selector that reads the class,
`.mode-band.faq.has-about:not(:has(> .gloss-sort)) > .tl-scroll`, and FAQ's row was and is
`.gloss-sort`.

**Who emits the classes** (`src/web`): `ThresholdSlider.tsx` (`gloss-gate*`), `OrderGroup.tsx`
(`gloss-sort-group`), `GlossaryPanel`, `CitationsPanel`, `FaqPanel` and `DebatePanel` § `OrderBar`
(`gloss-sort`, `gloss-sort-btn`), `QuotesPanel` (`quotes-rank*`, `quotes-bar*`), `SearchPanel`
(`srch-sort*`, `srch-gate*`), `DebatePanel` § `StopBar` (`dbt-bar*`). Nothing in `src/` reads any
of them back from the DOM: every hit is a `className`. Three range inputs have an `id` spelt like
an old class (`quotes-bar`, `srch-gate`, `gloss-gate`); those are ids, a `<label>` points at each,
and they stay.

**Which tests name them.** Two read source text: `touch-controls` (the CSS, by selector) and
`glossary-band-wiring` (the panels' JSX, by `className`). Twelve more use them as DOM selectors:
`glossary-compact-header`, `glossary-band-selection`, `citations-panel`, `faq-panel`,
`debate-panel`, `quotes-and-citations-compact-header`, `quotes-yours-rows`,
`search-results-get-the-room`, `search-order-row-and-failed-hint`, `threshold-slider-adopters`,
`order-group`, `mode-surface-changes-no-markup`. No doc under `docs/project/` or `docs/reusable/`
names a deleted class (`design-css-overview.md` and `mode.md` name `.gloss-sort`, which stays).

## The names

**The shared names are the glossary's: `.gloss-gate*` and `.gloss-sort*`.** Three bands already
drew the slider with `.gloss-gate*` and four drew the order row with `.gloss-sort*`; `glossary.css`
opens by saying its `.gloss-*` classes are the base other bands reuse. So the dedup is: Quotes,
Search and Debate emit the classes the others already emit, and their copies are deleted.

*The option passed over:* a neutral name (`.threshold-*`, `.order-row`). It reads better in
Search's JSX, and it would have renamed the class in `ThresholdSlider`, `OrderGroup`, four more
panels, two project docs and about ninety test lines to say the same thing. If the fifth sweep's
question 3 ever folds the components together, that is the moment a rename costs nothing extra.

**The old names are gone from the elements, not kept as hooks.**
[web-client.md § Never delete a semantic class name](../project/web-client.md#never-delete-a-semantic-class-name)
is about classes that code reads from the DOM by selector (`.controls`, `thead th`). None of
these is read by anything in `src/`; only tests selected them, and those tests now select the
shared class. Keeping `quotes-bar` beside `gloss-gate` as an unstyled hook would leave a name on
the element that the next person styles, which is how the copies began.

**Debate's value: one CSS modifier, no React flag.** `StopBar`'s value is always words (its
`words` prop is how it is built), so the span is always `gloss-gate-value in-words`, and
`.gloss-gate-value.in-words { font-family: inherit; }` sits beside the rule it modifies.
`inherit` explicitly selects the parent's computed face, as default inheritance did when no
other rule specified a face on this span. *Passed over:* a
contextual rule (`.dbt .gloss-gate-value`), which needs no class at all but would silently
un-mono any numeric slider Debate later gains, and says nothing at the element about why.

## Why the cascade comes out the same

The merged rules sit where `.gloss-gate*` and `.gloss-sort*` always sat, in `glossary.css`, early
in the import list. Quotes' copies were in `quotes.css` (after `narrow-window.css`) and Debate's
in `debate.css` (later still), so for those two bands the rules moved *earlier*. That could matter
only against a rule of equal weight, on the same element and the same property, that sits between
the old place and the new:

- **The finger floor** (`narrow-window.css`, coarse pointer) sets `display`, `align-items`,
  `justify-content` and `min-height` on the button; the base rule sets none of the four.
- **`flex-wrap: nowrap` on a touch screen** was in `quotes.css` straight after Quotes' base rule,
  and is in `glossary.css` straight after the shared one. Same order, same winner.
- **`.on` after `:hover` and `:active`**, which is what keeps a pressed order from changing under
  the pointer: the order inside the block is unchanged.
- **The elements carry no other class** a one-class rule could match, bar `on`, and Debate's
  root, whose second class (`dbt-rel`) has no rule anywhere.
- `.gloss-gate-value.in-words` outweighs `.gloss-gate-value`, so its position decides nothing.

Reasoning about a cascade is how these bugs get in, so it is not the evidence. The two witnesses
below are.

## The evidence

### Witness one: the browser, before and after

`docs/plans/261007a-ui-sweep-k5-measure.ts.txt` (with `…-measure-lib.ts.txt`), run against a dev
server started from this worktree, on the untouched tree and again after the change. Headless
Chrome 1440x900 with a mouse (`pointer: fine`, `hover: hover`) and 390x844 with `hasTouch` and
`isMobile` (`pointer: coarse`, `hover: none`; the script records both media queries and they read
back as expected), each in dark and light (`data-theme` read back).

**What is recorded.** For the slider's root and the order row's root, every descendant element,
the root's parent, and the band: all the computed longhands Chrome lists (about 400 an element,
custom properties included), kept as a hash in the committed file and in full in a scratch file;
74 named properties in clear (box, flex, font, colour, border, outline, overflow); the bounding
rectangle to a hundredth of a pixel; `scrollWidth`, `clientWidth`, `scrollHeight`, `clientHeight`
and `scrollLeft`; the element's own text; and which of `:hover`, `:active`, `:focus`,
`:focus-visible` it matches. Also the document's scroll width against its client width.

**The scenes** (seven, in each of the four cells):

| Scene | Fixture | Slider | Order row |
|---|---|---|---|
| Glossary | `/read/vb-spya-vu3xen?mode=glossary` | `ThresholdSlider` | 4 buttons |
| Citations | `/read/vb-spya-vu3xen?mode=citations` | `ThresholdSlider` | 4 buttons |
| FAQ | `/read/noema-mythology-of-conscious-ai?mode=faq` | `ThresholdSlider` | 4 buttons |
| Quotes | `/read/vb-spya-vu3xen?mode=quotes&rank=prioritised` | `BarSlider` | 4 buttons |
| Search | `/read/levin-self-improvising-memory-spya-gj60pu?mode=search&runs=spya-w0e3ct` | `ConfSlider` | 3 buttons (its own row) |
| Debate, Claims | `/read/levin-self-improvising-memory-spya-gj60pu?mode=debate&debate=claims` | `StopBar` | none (Claims has none) |
| Debate, Reception | `/read/arxiv-1902-spya-pfud4c?mode=debate` | none | **injected**, see below |

**The states.** At rest. Each of a pressed and an unpressed order button: hovered (a real
`locator.hover()`, mouse cells only), focused by a real Tab (script focus only finds the place in
the order; a real Shift+Tab leaves and a real Tab returns, and the state is kept only if the
button then matches `:focus-visible`), and held down (mouse down on it, read, mouse up somewhere
else so no click fires). The range: hovered, focused by Tab, then moved off its default with an
arrow key until the reset appears; the page reloaded at that address and read at rest; the reset
hovered, focused by Tab, and held down. 292 state captures, 2,112 element records, in each run.
No state was skipped in either run.

**Result: 0 differences over 76,084 compared values**, class strings aside (the old run holds 46 distinct class
strings and the new one 26, as intended). Three checks that the zero means something:

- *The script repeats.* The Quotes scene run twice on the untouched tree: 0 differences over
  13,398 values. (The first attempt differed in every hash: Chrome lists custom properties in an
  order that changes between loads, so the hash is now taken over sorted names.)
- *It can see a difference.* `.quotes-bar-note { line-height: 1.35 }` changed by hand to `1.4`:
  167 differences reported, starting with the note's line-height `17.496px -> 18.144px` and the
  slider's height `79.05 -> 79.69`. Changed back.
- *It can see the one deliberate difference.* With the `.in-words` rule disabled after the
  change, Debate's value reads `"Geist Mono Variable"…` for `"Geist Variable"…`, 159px becomes
  220px wide, and 92 values differ. Restored.

**Nothing was spent.** A pressed order and a moved slider write a URL parameter and feed a
`useMemo`: for Search, `SearchMode.tsx` reads `?order=` and `?conf=` through `useQueryState` and
filters `ordered` with `keepAbove`; no effect depends on either. As a second fence the script
refuses every request that is not a GET, bar the sign-in's and the "opened" stamp. It refused 86,
all of them an embedded video's own beacons to its own host; none was to this app.

### Witness two: the built stylesheet

`npm run build` on each tree, then two PostCSS readings of the emitted `main-*.css`:

- `…-k5-census.mjs.txt built <file> --canon` lists every rule naming these classes with the
  family name replaced by a placeholder, its `@layer` and `@media`, and its declarations, sorted
  and with duplicates folded. The two listings differ in **one line**: the mono-less
  `.SLIDER-value { … }` (Debate's copy) is gone and `.SLIDER-value.in-words { font-family:
  inherit }` is there. Every other rule, its conditions and its declarations are the same text.
- `…-k5-built-rest.mjs.txt` lists every *other* rule in the file, in cascade order: **3,383
  rules, identical** in both builds. Nothing else moved.

The built file is 3,389 bytes smaller.

### The tests

Six test files changed, each only where it named a renamed class; `tests/debate-panel.test.tsx`
also gained one case, because the modifier is new and nothing else would notice it going: the
span's class is `gloss-gate-value in-words`, and the rule hands the face back.

Mutated after the change, each seen red and put back (`261007a-ui-sweep-k5-mutate.py.txt`, beside this doc):

| Mutation | Red in |
|---|---|
| no `min-height` on `.gloss-sort-btn` under a coarse pointer | `touch-controls` |
| no `.gloss-sort-btn:active` | `touch-controls` |
| no `.gloss-sort-btn:focus-visible` | `touch-controls` |
| no `flex-wrap: nowrap` for `.gloss-sort` under a coarse pointer | `touch-controls` |
| `.gloss-sort-btn:hover` outside `@media (hover: hover)` | `touch-controls` |
| Quotes' foot line under its old class; then made conditional | `glossary-band-wiring` (both) |
| Search's foot line made unconditional | `glossary-band-wiring` |
| no `.gloss-gate-value.in-words` rule; the rule only inside `@media print`; no `in-words` on the span | `debate-panel` (all three) |
| Quotes' row, Quotes' value, Search's value, Debate's reset: each back under its old class | `quotes-and-citations-compact-header`, `quotes-yours-rows`, `search-results-get-the-room`, `debate-panel` |

`touch-controls` used to hold `.gloss-sort-btn` and `.quotes-rank-btn` to the same floor, hover
guard and focus mark as a pair, and `.gloss-sort` and `.quotes-rank` to the same one line. With
one rule there is no pair to hold, so each list lost a name and no check was removed.

Gates: `npm run typecheck`; `touch-controls`, `glossary-band-wiring`, `css-tokens`,
`styles-entry-is-imports-only`, `order-group`, `threshold-slider-adopters`,
`mode-surface-changes-no-markup`, `quotes-yours-rows`, `search-results-get-the-room`,
`glossary-band-selection`, `glossary-compact-header`, `quotes-and-citations-compact-header`,
`citations-panel`, `faq-panel`, `debate-panel`, `search-order-row-and-failed-hint`, `doc-links`:
17 files, all passing.

## What changed, counted

- Stylesheets: 240 lines removed, 65 added (mostly the comments that now say where the rules
  are), **175 fewer**. 71 selector occurrences naming these families became 33: 38 gone, one
  added.
- `glossary.css` no longer holds `.srch-gate*`; `quotes.css` holds no order row or bar;
  `debate.css` holds no bar; `narrow-window.css`'s floor names one class.
- `QuotesPanel.tsx`, `SearchPanel.tsx`, `DebatePanel.tsx`: class names only (and one comment in
  the last). `ThresholdSlider.tsx`, `OrderGroup.tsx`, `GlossaryPanel.tsx`, `CitationsPanel.tsx`
  and `FaqPanel.tsx`, all in K5's manifest, needed no edit: the shared names are the ones they
  already emit.
- The two comments that justified the copies by paddings that "differ and always have" are
  deleted (`glossary.css` above `.srch-gate`, `debate.css` above `.dbt-bar`). All four were
  `0.4rem 0.7rem 0.5rem`.

## What the matrix does not reach

The claim is "no difference in this matrix". Outside it:

- **Debate's order row on real markup.** Five articles on this box have a stored debate; none has
  two Reception orders, so the row is never drawn. The script puts a CSS stand-in for
  `DebatePanel.tsx` § `OrderBar` into a real Debate band after `.dbt-controls`: the same tags and
  classes, but *as found / stance / date* rather than the panel's *as found / date / stance*,
  without the buttons' titles, handlers or `OrderGroup`'s scroll/reflow effects. It tests those
  classes in the band, not the real component's behaviour. The classes did not change in this
  cluster.
- **A real phone.** `isMobile` is not a finger: `:active` was produced with mouse events in the
  touch cells too, safe-area insets are zero, and there is no iOS text autosizing.
- **Hover on a touch screen** (not asked for; `hover: none` there, so the guarded rule is off).
- **Widths between 390 and 1440**, a landscape phone, a root font size other than the default,
  `forced-colors`, print, right-to-left.
- **A band without the (i)** (`.mode-band` with no `has-about`), a reader who does not own the
  article, and any state while a job is running or streaming.
- **Pseudo-elements.** The range's thumb and track are the browser's, styled by `accent-color`
  alone (recorded on the input); `.gloss-sort-group::-webkit-scrollbar` cannot be read from
  script. Both rules are unchanged text in the built file.
- **FAQ without its order row**, where `faq.css`'s `:not(:has(> .gloss-sort))` applies. The
  selector and the class FAQ emits are both unchanged.
- **Other interaction and loading states:** a held-down range thumb, slider endpoints and a
  one-stop Quotes track, later order buttons selected or horizontally scrolled, mixed mouse/touch
  media capabilities, browser zoom, and fallback fonts before the web fonts finish loading.
  The script verifies Tab focus, but does not assert expected control counts, media capabilities,
  themes, hovered targets or pressed targets before capturing them. The saved captures were
  checked during review for the expected counts and hovered/pressed/focused states. Equal
  incomplete captures on a future run could still compare as equal.

For everything in this list the second witness still holds: the same rules, with the same
conditions and declarations, in a file where no other rule moved.

## What in the umbrella or the brief was not so

- **"About 140 lines gone."** 175 net.
- **Its list of what names the classes.** `mode-band.css` and `voices.css`, also checked in the
  census, name none; neither is named in K5's consumer list. Of the
  tests it lists, `css-tokens`, the import-order check, `order-group`,
  `threshold-slider-adopters` and `mode-surface-changes-no-markup` needed no change (the first
  two name none of the classes; the others name only ones that stay). Its general reference to
  panel tests does not spell out
  `glossary-band-selection`, `citations-panel`, `faq-panel`, `debate-panel` and
  `search-order-row-and-failed-hint`.
- **The manifest names `faq.css`, `ThresholdSlider.tsx`, `OrderGroup.tsx` and six panels.** Three
  panels and four stylesheets changed. That follows from choosing the existing names.
- **"`/read/vb-spya-vu3xen` has … FAQ"** (the brief): it has one, with too few questions to draw
  the order row or the slider. `noema-mythology-of-conscious-ai` draws both.
- **"If no article has a stored debate"**: five have. The gap is narrower, as above.
- True as written: ten rules four times; one deliberate difference; the order row twice; the two
  comments and the paddings.

## Left

- **`glossary.css`'s touch-screen comment** used to explain why Quotes' one-line rule could not
  live in `narrow-window.css` (that sheet loads before `quotes.css`). With one rule in
  `glossary.css`, which loads before `narrow-window.css`, the floor and the one-line rule could
  now sit together in that sheet. Not moved: it would reorder rules for no reader, and the
  comment now says what is true.
- **`design-css-overview.md` does not say where a band's slider and order row are styled.** A line
  under its map would help the next mode. A signpost needs no approval under AGENTS.md; that
  wider doc edit is left outside this cluster.
- **The fifth sweep's question 3** is as open as it was. This removes the CSS half of its cost
  whichever way it goes: four components, one look, one set of rules.
- **Search's order row** stays a design of its own (umbrella question 1).

## Review

[GPT Sol's code review](261007a-ui-sweep-k5-code-review-sol.md)
([the prompt](261007a-ui-sweep-k5-code-review-prompt.md)), write-capable, one round. Verdict:
**ready with these fixes**; no P0 or P1. It found no changed cascade winner and no established
reader-visible difference, re-ran `compare` (zero differences over 76,084 values), and decoded
both files to check the scene, capture and record counts and the hovered, focused and pressed
targets. On the questions put to it: the dedup earns its keep ("removes independently maintained
declarations without introducing component flags or replacement copies"); the glossary prefix is
awkward in Search but was already the shared convention; the Debate modifier is not one flag too
many; dropping the old names was right. It changed no stylesheet, so the browser measurement
stands as run. Its four findings, all accepted; one fix was rewritten:

- **K5-F1 (P2, established): lossy evidence normalization.** The census serialized
  `.gloss-gate { padding: 1px }` and the same declaration with `!important` identically, because
  PostCSS stores priority separately from `value`. The serializer now retains `important`;
  this mutation was seen red before the fix and green afterwards. None of the actual K5
  declarations had this flag, so the existing browser evidence remains applicable.
- **K5-F2 (P2, established): syntactic presence substituted for applicability.** The new Debate
  test accepted its modifier inside `@media print`, where the screen would keep the mono face.
  It now requires one unconditional inherited-face rule and tests the JSX wiring; that mutation
  was seen red, and the unmutated test green. Its name describes that structural guarantee,
  rather than claiming a computed rendering test. **The fix as Sol wrote it imported `postcss`
  into the test**, which `package.json` does not declare (it is here only as another package's
  dependency, and no other test imports it). The builder kept the finding and rewrote the check
  with `enclosing` from `tests/helpers/stylesheets.ts`: the modifier is named exactly once, its
  rule is the one declaration, and no at-rule encloses it. The print-only mutation is red against
  that version too (`M8b` in the mutation script).
- **K5-F3 (P3, established): the injected row was described as exact markup.** Its button order,
  omitted titles and missing React behaviour differ as recorded above. The script comment and
  this doc now call it a CSS stand-in; the injection and saved captures are unchanged.
- **K5-F4 (P3, established): overstated documentation corrections.** The umbrella already
  referred generally to panel tests, so "misses" overstated its omissions; the wording now
  distinguishes tests not individually named. The modifier rationale called `inherit` a
  computed value rather than a specified keyword, and the deferred signpost incorrectly implied
  approval was required despite AGENTS.md's signposting exception. Those descriptions are
  corrected here; no rule doc was edited.

Ten targeted test files passed (281 tests). The import-order file passed five cases and could
not run its Git-spawning case under this sandbox (`spawnSync git EPERM`); the same import scan
passed with the Git file list supplied separately. The standard typecheck wrapper could not open
its tsx pipe; direct `tsc --noEmit` passed for all four projects. The touched test passed lint,
and `git diff --check` passed. No stylesheet changed; no commit was made.
