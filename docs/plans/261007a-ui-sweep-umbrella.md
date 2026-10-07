# UI sweep: the umbrella plan

**Status: done enough to stop here, 2026-10-07. All five clusters are on `dev` (§ What landed).
Three questions are with Greg (§ For Greg), and two jobs are queued under rules he has already
given.**

The UI half of the sweep Greg asked for on 2026-10-06, run the way
[improve-the-codebase.md](../reusable/improve-the-codebase.md) says with the interface as its
target. The [sixth sweep](261006j-sixth-codebase-sweep-umbrella.md) ran no browser and says it
cannot see "anything visual"; the [seventh](261006m-seventh-codebase-sweep-depth-umbrella.md), in
flight beside this one, is the code behind the interface. This doc lists what was found in what a
reader sees and touches, groups it into clusters, says which are built in this run, and ends with
the decisions that are Greg's.

What it is for, in Greg's words (2026-10-06):

> When the box calms down is a good moment to potentially go broader and deeper on that, i.e. look
> for other areas that could be improved/tidied up/refactored/etc, both in the codebase and the UI
> and anywhere else, and kick off one or more agents to try and get things into good shape before
> the next round of development.
>
> If it's consequential, requires tradeoffs, product decisions, or is hard to reverse, etc, then
> let's discuss first.

And on siblings: *"looking for inconsistencies across modes is a good thing to try and improve"*.

## The short version

- **Nothing is broken at the level of layout.** Across about 230 page loads (every mode, the
  shelf, /profile, /admin, Metadata, at 1440, 820 and 390 wide, dark and light) no page scrolled
  sideways, nothing was clipped or overlapped, and the light theme, three days old, had no text
  under the contrast bar in the reading modes. Two red 404s in the console, both "not made yet"
  reads the none-yet work has not reached.
- **The live defects are in behaviour, and the second model family found most of them** by reading
  components: Enter and Escape acting during Japanese or Chinese text composition (a chat draft is
  erased), a raw browser error message shown as a failure sentence in six places, the shelf's
  topic filter not applying to passage matches, a page-level error style leaking 48px of padding
  onto two small status rows, and several smaller ones (Tier 0, below).
- **Keyboard focus is the weakest visible area**: one list with no focus mark at all, six controls
  whose mark is a colour too faint to see, and a reading view where the dock is some 85 Tab presses
  away.
- **Siblings have drifted most in three places**: the same control drawn at five sizes (sub-mode
  chips, run buttons, text boxes), tooltips (about 140 native `title`s against the house rule), and
  wording (run verbs, loading lines, "call" against "pass"). Lining these up is a design change a
  reader would see, so it is a question for Greg, not a cluster.
- **Five clusters are built in this run** (K1 to K5): CSS defects and focus marks; keys pressed
  during text composition; the shelf filter and false copy; failure sentences and small panel
  states; and the threshold slider's four copies of one stylesheet. Each is its own worktree, GPT
  Sol code review and browser check, two in flight at most.

## How it was run

Breadth, nine nominators, all told to nominate and not to score:

- **Four Sonnet browser auditors**, each driving its own headless Chrome through Playwright against
  this worktree's dev server: modes A (plain, structure, summary, glossary, ideas, quotes,
  timeline, citations, faq, marginalia); modes B (chat, search, referee, diagram, learn, debate,
  skim, hover cards, lightbox); the shelf and the signed-out pages; /profile, /admin, Metadata,
  keyboard and touch. Each measured rather than looked: sideways scroll, clipping, computed
  contrast, control heights and radii, console errors, failed requests, native titles.
- **Three Sonnet static nominators**: a census of the CSS (duplication, colour literals, undefined
  tokens, control sizes); the copy; and the seventeen modes' panels compared as siblings.
- **Two GPT Sol readers**, read-only, one over every stylesheet and one over the components.
  The sixth sweep's lesson was that cheap GPT nominators return nothing and that the second family
  earns its place where it reads code; so both were Sol, and both read.

Depth was not run as separate investigation docs: the seventh sweep is doing exactly that for the
client, and nothing here needed cause separated from symptom. The cross-family check on this plan
is GPT Sol's review of it, and of each cluster's code.

No paid model call was made. Browser auditors were told never to press a control that runs a
model, and none did.

## Scope line

- **Looked at, in a browser:** every `?mode=` value and the sub-modes of Diagram (sketch,
  illustrated), Learn (four) and Referee (four); the dock and spine; the glossary hover card; the
  figure lightbox; the shelf signed in; /profile; /admin and its four pages; /design; the Metadata
  page; the Feedback dialog. Three widths, both themes. Tab order on the shelf, /profile and three
  reading modes. Touch-target sizes at 390 on seven pages.
- **Read as code:** all 47 stylesheets under `src/web/styles/`, both token files,
  `colourscales.css`, `tailwind.css`; every mode's panel; `ModeSurface`, `JobProgress`,
  `ReadError`, the shelf, profile, admin and site page components; reader-visible strings in
  `src/web` and `src/messages.ts`.
- **Also in a browser** (reported after the first draft; § What the shelf auditor added): twelve
  signed-out pages and the shelf, Help and Changelog signed in.
- **Not looked at:** real loading and failure states (they need a model call or a slow
  server; only their code was read). Debate with stored results. The prose link hover card and
  comments on the prose (no fixture had either). Tab order beyond three modes. Chat and Learn
  mid-answer. Tailwind utility sizes inside components, except where a browser measured them.
- **What the method cannot see:** a real phone. Safe-area insets are zero on this box, Chrome has
  no iOS text autosizing, and `isMobile` emulation is not a finger. Anything that happens only
  while a model is streaming. Taste: a measurement says two buttons differ, not which is right.
- **Tree audited:** `bf78e90c7`. Line numbers below are already stale; locate by content.

## Evidence states

**R** reproduced in a browser or by running it, **C** proved from the code, **H** hypothesis.
✓ means I re-read the code myself after the nominator. IDs in brackets are the nominator's:
G1 is Sol's stylesheet read, G2 Sol's component read, b1 to b4 the browser auditors, c1 to c3 the
static nominators. The raw reports are in the session scratchpad and are summarised here.

## The clusters

Rewritten after GPT Sol's plan review (§ What the review changed); this is the text the builders
are given.

| # | Cluster | Tier | Ease | Value | Risk | Wave |
|---|---|---|---:|---:|---|---|
| **K1** | CSS: a leaking error style, focus marks, undefined tokens, small cascade defects | 0/1 | 4 | 4 | low | 1 |
| **K2** | Keys pressed while composing Japanese or Chinese text | 0 | 3 | 4 | med | 1 |
| **K3** | The shelf's passage filter, and copy that is false | 0 | 4 | 3 | low | 2 |
| **K4** | Failure sentences, and four small panel states | 0 | 3 | 4 | med | 2 |
| **K5** | The threshold slider and order row: four stylesheets for one control | 2 | 3 | 3 | med | 3 |

**File manifest**, so no two clusters in one wave hold a file:

- **K1**: `src/web/styles/{shell,dock,mode-band,diagram-drift,diagram-sketch,footnotes,feedback,search,chat-actions,narrow-window,quotes,profile,outline-mode,marginalia,dialogs,tokens}.css`,
  `styles/tokens.css`, `src/web/PageSection.tsx`, `DesignPage.tsx` (one token row), and the
  CSS-reading tests that name a changed selector.
- **K2**: `src/web/key-chord.ts`, `useEscapeToClose.ts`, `Dock.tsx` (the drawer's Escape listener
  only), `DockQuickSearch.tsx`, `ChatPanel.tsx`, `Library.tsx` (the search box's key handler
  only), `help/HelpPage.tsx`, `PageContents.tsx`, `AnnotateDialog.tsx`, `CommentDialog.tsx`,
  `TitleEditor.tsx`, `TagEditor.tsx`, `CommandBar.tsx`, `SearchPanel.tsx` (the input's key handler
  only), and their tests.
- **K3** (after K2): `Library.tsx` (the `Passages` props and two sentences), `ShelfEntry.tsx`,
  `ShelfTerms.tsx`, `AdminPage.tsx`, `PublicReadableSharingPage.tsx`, `OpenSourcePage.tsx`,
  `ChatPanel.tsx` (one label), `ModeSurface.tsx` (one comment), `src/messages.ts`
  (`SHARED_LINK_CARRIES`), `CitationsPanel.tsx` and `FaqPanel.tsx` (one `runningLabel` each).
- **K4** (after K1 and K2): `src/web/lib/sse.ts`, `useGlossary.ts`, `useCitations.ts`,
  `useQuiz.ts`, `useProjection.ts`, `useSimilar.ts`, `SkimPurpose.tsx`, `purpose.ts`,
  `SourceLink.tsx`, `command-runners.ts`, `ArticleCost.tsx`, `export-download.ts`,
  `QuotesPanel.tsx`, `GlossaryPanel.tsx`, `CriteriaPanel.tsx`, `MirrorPanel.tsx`,
  `SearchPanel.tsx` (the `SortBar` and one hint), `styles/search.css` (the order buttons), and
  their tests.
- **K5** (after K1 and K4): `glossary.css`, `quotes.css`, `debate.css`, `search.css`, `faq.css`,
  `narrow-window.css`, `ThresholdSlider.tsx`, `OrderGroup.tsx`, the six panels that emit the
  classes, and the tests U17 names.

The seventh sweep (session `code-depth`) is in `useQuiz.ts`, `useCitations.ts`, `QuotesPanel.tsx`,
`CitationsPanel.tsx`, `FaqPanel.tsx`, `DebatePanel.tsx` and, later, `CommentDialog.tsx` at the same
time. Both sessions know; the edits are different blocks. **K4 merges `origin/dev` before its
review, not only before its push**, and checks that Quotes' progress row and that session's
rewrite hold show the right control together (U19).

### K1 — CSS: a leaking error style, focus marks, undefined tokens, small cascade defects

Three review checkpoints in one worktree, a commit each: status rows; focus; the rest.

**Status rows.**

- **A page-level error style reaches two small rows** (C ✓, G1-01, U2). `shell.css` has
  `.loading, .error { padding: 3rem; color: var(--ink-soft); font-family: var(--font-mono);
  font-size: 13px; white-space: pre-wrap }`. Four things carry a bare class: `pre.error`
  (`ArticlePage.tsx`, the one it is for), `div.loading` (`LogoLoader.tsx`'s reduced-motion
  fallback, which must keep it), `li.chat-tool.error` (`ChatPanel.tsx`) and
  `span.dock-question-state.error` (`Dock.tsx`). **Only the error arm is scoped, to `pre.error`;
  `.loading` stays.** The two rows lose 48px of padding on each side and also the mono face, the
  13px size and `pre-wrap` they were never meant to have; the builder records each row's whole
  computed style before and after, not only its padding, and says what changed.
- **`--danger` and `--ink-faintest`** (C ✓, sixth sweep item 3, U1). Both are defined nowhere, so
  `var(--danger, var(--highlight))` on those same two rows draws a failure in the brand orange.
  My first plan was to use the existing `--destructive` and add no token. The review showed that
  is not enough: `.chat-tool-detail` carries `opacity: 0.7`, and the chat row sits on `--panel` in
  the band and on `--surface-raised` in the chat dialog, where `--destructive` reads 3.1:1 and
  2.8:1 (dark) at that opacity, and 4.38:1 on the dark raised surface even at full opacity. So
  **`--danger` is defined, as Greg's relay asked, as an error-*text* colour** in both theme blocks
  of `styles/tokens.css`, chosen from the same hue as `--destructive` and **measured at 4.5:1 or
  better on `--page`, `--panel` and `--surface-raised` in both themes**; the two rows use it with
  no fallback and the error detail is drawn at full opacity. `--destructive` itself is not
  changed: destructive buttons fill with it. /design gains the token in its table. `--ink-faintest`
  (two uses) becomes `--ink-faint`, which is what renders today. The six
  `var(--destructive, oklch(…))` fallbacks that can never fire go, and so does the comment in
  `diagram-sketch.css` that says `--destructive` is defined nowhere (G1-14).

**Focus marks that cannot be seen** (R for the profile contents list, b4-2; C ✓ for the rest,
G1-03, G1-04, b4-3; geometry per control from U3). The app's usual mark is
`2px solid var(--highlight-text)`. The rule for this cluster: **keep each control's existing
geometry and change only what makes it invisible.**

| Control | Today | Change |
|---|---|---|
| `.prof-box-input` (`profile.css`; check every consumer, not only /profile) | outline off; border goes raw `--highlight`, 2.6:1 on light | border `--highlight-text` |
| `.outln-row.focused` (`outline-mode.css`) | inset shadow in raw `--highlight`. `OutlinePanel` sets the class without keyboard focus, so mouse readers see it too | colour only, to `--highlight-text`; the inset stays |
| Marginalia's four buttons (`marginalia.css`) | 2px outline, offset 2px, `--rule-strong` (under 2:1) | colour only. At a 12px root two neighbours' marks can touch (6px gap, 8px of marks): the builder measures and reduces the offset if they do |
| `.chat-card-shut` (`dialogs.css`) | 2px outline, offset −2px, `--rule-strong` | colour only; the inset stays (`.chat-dialog` hides overflow) |
| Collapsible headings (`PageSection.tsx`; shared by /profile and Metadata) | outline off; colour change only | an outline that is not clipped; the builder checks both pages |

/profile's contents list and the shelf's "details" trigger have the same defect and live in
`PageContents.tsx` and `ShelfEntry.tsx`, which K2 and K3 own; they are fixed there.

**The rest** (C ✓ unless marked): the full-screen Sketch rule
`.sk-in-full .sk-scene { max-width: 20rem }` re-truncates the open scene chip (G1-02): cap closed
chips only. `.gloss-btn:hover` lights a disabled button (G1-09). `.tip-hit` and `.tooltip.tip-cite`
replace the viewport-aware maximum with a bare `26rem` (G1-05): restore the cap; the overflow is H
until measured at 390. The touch rule that stops iOS zooming a focused field says `1rem` where its
comment says 16px, and the app supports a 12px root (G1-07): `max(1rem, 16px)`, never a literal
16px. `.quotes-hint` uses two `!important`s that `.quotes-empty .quotes-hint` replaces (c1-7).
`feedback.css` mixes `in oklch` where the map says `oklab` (G1-11; a consistency fix, no visible
change). False comments (C ✓): `src/web/styles/tokens.css` "the app is dark only" (G1-12);
`styles/tokens.css` "custom properties are unaffected by layering" (G1-13) and "a THIRD" beside
`calc(var(--rhythm) / 4)` (G1-15).

Done when: a Sonnet browser subagent has measured each defect before and after (the two rows'
computed styles and contrast on both surfaces in both themes; each focus mark after a real Tab;
the Sketch chip; the tooltip at 390); `npm run typecheck`, `css-tokens`, `close-cross`,
`touch-controls`, `styles-entry-is-imports-only`, any test naming a changed selector, and
`doc-links` pass.

### K2 — keys pressed while composing Japanese or Chinese text

A reader typing Japanese or Chinese presses Enter to accept a candidate and Escape to dismiss the
candidate list. `isImeComposing` in `key-chord.ts` is the house test for "that key belongs to the
input method" (it reads the native flag, React's, and the older `keyCode === 229`). Search, Debate,
the dock and the quick search use it for Enter. The review's census (U6, U7) found the class is
much wider than the four handlers first nominated:

- **Text is lost or committed** (C ✓ for the first three): the chat composer's Escape clears the
  draft; renaming a conversation saves on Enter; the chat question editor's Escape cancels the
  edit; Annotate's textarea and Comment's editors clear or restore on Escape; `TitleEditor`
  cancels on Escape; Search and `DockQuickSearch` guard Enter but their Escape still clears.
- **The page moves**: Help's search navigates to its first result on Enter and clears on Escape
  (U8; not "blurs", as first written); `PageContents` does the same; the shelf's search blurs on
  Enter and clears on Escape.
- **Two shared listeners sit above all of these** (U7): the dock drawer's capture-phase Escape
  listener in `Dock.tsx`, and `useEscapeToClose`, which closes the Chat, Annotate and Comment
  panels. Neither asks about composition, so a guard in the input alone still loses the surface.
  **These two are fixed first**, each with a test that goes through the mounted surface and
  native event propagation, since a synthetic event on the input alone would pass while the
  panel still closed.
- **A weaker test for the same thing**: `TagEditor` and `CommandBar` read only
  `nativeEvent.isComposing`; `CommandBar` also calls `preventDefault` before it asks. They move to
  the helper.

Rules for the builder: where a handler calls `stopPropagation` unconditionally, the guard goes
**after** it (returning first would let a composing key escape a handler that means to contain
it); where a form would submit implicitly, a composing Enter is `preventDefault`ed, as Debate
does, not merely ignored. The builder greps every `key === "Enter"` and `"Escape"` on an input,
textarea or contenteditable in `src/web`, fixes those where a composing key loses text, moves the
page, closes a surface or submits, and **lists the rest with the reason each was left** (the
review's examples: Cmd-Enter in Quiz, Feedback, ProfileBox and the Add page; focus moves in the
sign-in form).

`PageContents.tsx` also gets its focus mark here (K1's table): the contents entries are full-width
buttons in an unpadded scrolling list, so the mark is inset, not an outline the list would clip.

Done when: every fixed handler has a test seen red; a Sonnet browser check dispatches real
composition events (`compositionstart`, a key with `isComposing`, `compositionend`) into the
composer, the rename box, the comment editor and Help's search and sees the draft, the panel and
the page stay put; `npm run typecheck`, the touched suites and `doc-links` pass.

### K3 — the shelf's passage filter, and copy that is false

- **A topic or tag on the shelf filters the cards and not the passage matches** (C ✓, G2-06, U9).
  `Library.tsx` passes only the Unread set to `Passages`. The allowed slugs come from
  `narrowShelf(scope, { query: "", unread: show === "unread", topics: chosenSets })` in
  `shelf-narrow.ts`. **Not from `rows`**, which would apply the card's title and byline match to
  passage hits and hide an article whose body matches and whose card does not. `ShelfSearchAlso`,
  the archived tallies and `ShelfPublicSection` keep their own scope; the server's cap on hits
  stays, so no sentence may claim that nothing matches anywhere. The two sentences that say
  "unread" where they now mean the reader's filters change with it. Red test first.
- **Copy that is false as written** (C ✓): the Learn band's accessible name, "Remember what you
  took from this article" (c2-1), and the stale Remember example in a `ModeSurface` comment; the
  Admin home's "Only Gift vouchers can change anything", when the feedback list's Ignore also
  writes (G2-12); the shelf card's "Built: nothing beyond the tree", computed from the three flags
  `LibraryEntry.has` carries (U10: **label the short list honestly; do not widen the server's
  projection to make the claim true**); the public-sharing page's "finest level of zoom" (G2-11);
  `/opensource`'s "something you can zoom around" (b3-18); `SHARED_LINK_CARRIES`, "its table of
  contents, every zoom level" (c2-6, U20).
- **Two bands whose button and progress line disagree** (C ✓, c2-4, U20): Citations and FAQ say
  "Find the citations" / "Find the questions" and then "Reading…". The progress line becomes
  "Finding…", as Ideas and Glossary have it.
- **`ShelfEntry.tsx`'s two other items**, since this cluster owns the file: the "details" trigger's
  focus mark (K1's rule; the card already changes its border on `focus-within`, so the builder
  checks the two do not fight), and "Couldn't queue a rebuild: ${e.message}" through
  `describeFetchFailure` (K4's rule).
- **The topic counts on the light-theme shelf are 3.2:1** (R, b3-1): `--ink-faint` at
  `opacity-70`, 12px. The opacity goes; the builder measures both themes.

Done when: the red test has been seen red; a Sonnet browser check sees the passage list obey a
topic and a tag and reads the new sentences on screen; `npm run typecheck`, the touched suites
and `doc-links` pass. `/help` is checked for any sentence these changes make false.

### K4 — failure sentences, and four small panel states

- **Six places hand a raw exception to the reader** (C ✓, c3-1, c3-2, c2-2). The rule since plan
  [260924a](260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md) is that only a
  sentence somebody wrote for a reader reaches one, and `describeFetchFailure` in
  `src/web/lib/describe-failure.ts` is the seam. `useGlossary.ts` (two sites) and
  `useCitations.ts` copied its first branch (`StreamStalled`) and print `err.message` otherwise;
  `useQuiz.ts`'s marking catch has no branch at all; `useProjection.ts` and `useSimilar.ts` store
  `err.message` outright and Diagram draws it.
- **The throw seam comes first** (U11, P0 in the review). `readAnswerStream` in `lib/sse.ts`
  throws `new Error(sentences.ended)` when a stream ends early: an authored, retryable sentence
  in a plain `Error`. The helper would turn it into `PAGE_FAULT`, telling the reader the app has
  a bug when their connection dropped. So: (1) the early-end throw becomes a
  `ReaderFacingError`; the rejected-completion throw beside it is classified on purpose (a
  `MalformedReply` unless the builder shows otherwise); (2) then the six catches call the helper.
  Five separate tests, each seen red: a transport failure **as the real helpers mark it** (not a
  bare `TypeError` from a mocked `apiFetch`, which tests the unexpected-exception path instead),
  a stall, a server refusal, an early end, a malformed completion. Projection and Similar keep
  their abort handling and keep a good earlier answer on screen.
- **Skim says "Not saved" when it cannot know** (C ✓, U21). `SkimPurpose.tsx` prints
  "Not saved — {error}" when `savePurpose` rejects, and `purpose.ts` rejects whenever the reply to
  its PATCH is lost, which can be after the server stored it. The sentence becomes one that says
  the save could not be confirmed, the draft stays in the box, and the stored value is re-read
  before anything asserts it. Its "Something went wrong." fallback (on copy.md's avoid list) goes.
- **Four more sites an ordinary exception can reach** (C per U12): `SourceLink.tsx`,
  `command-runners.ts` (the tag commands), `ArticleCost.tsx`, `export-download.ts`. Each goes
  through the helper after the builder has named what throws there. **Left, with the reason
  (U12):** `GlossaryPanel` and `ProseHoverCard`'s hide (already wrapped in `useGlossary.setHidden`);
  `PrivateLink` (4xx only, an `HttpError`); chat's `NotThisReader` (authored on purpose);
  dictation; the upload engine and batch upload, whose plain `Error`s are authored at their throw
  sites and need classifying first (§ After the clusters); Metadata (the seventh sweep's C2).
- **Quotes hides a running job at its ceiling** (C, G2-04, U14). At `MAX_QUOTES_TOTAL` the foot
  shows "That is as many as we keep" in place of the progress row. A running or failed job takes
  precedence over the idle sentence; and a failed forced rewrite retries **the rewrite**, through
  the existing `rerun`, not the append-only "Find more" path.
- **A glossary occurrence chip leaves the stepper behind** (C ✓, G2-07): the chip's jump goes
  through a callback that records the block, as `BlockNav.onGo` does.
- **Referee offers "Try again" for a failure another try cannot fix** (C ✓, G2-08): Criteria and
  Mirror ask `worthRetrying`, as Search does; the failure sentence stays visible.
- **Search's order buttons** (C ✓, c3-5, c1-1, U16). They have no `aria-pressed`, no group name,
  a bare `:hover` (the stuck-hover-on-iOS bug their siblings' comment describes), no `:active`
  or `:focus-visible` rule and no 40px floor on a touch screen. **They do not move onto
  `OrderGroup`**: the review showed that would change how the row wraps and scrolls, which is
  more than "its look stays". They get `aria-pressed`, a named group, and the hover guard, focus
  mark and touch floor in `search.css` under their own class. Moving them onto the shared group
  is in § For Greg, question 1. And the hint under failed searches, "the ⚠ on each row above
  tries it again" (G2-09), is shown only when some row's ⚠ is a button, with wording the builder
  writes for the all-permanent and the mixed case.

**Removed by the review (U13):** both Quotes arrows saying "First quote" before a quote is chosen.
`stepQuote` sends either arrow to the first quote in that state, so the labels are right.

Not here, and why: the rewrite hold on seven forced re-runs (found here as c3-11 and G2-05) and
the loaded branches of Sketch and Illustrated (G2-03) are the seventh sweep's, which took the
second on 2026-10-07.

Done when: each red test has been seen red and a mutation of each fix turns it red again; a
Sonnet browser check sees Search's order row announce a pressed state with its computed radius,
colour, position and wrapping unchanged at 1440 and 390; `npm run typecheck`, the touched suites,
`tests/read-error-matrix.test.tsx` and `doc-links` pass, on a tree that has `origin/dev` merged.

### K5 — the threshold slider and order row: four stylesheets for one control

Sixth sweep item 6, which recommended waiting for the fifth sweep's question 3 (one word and one
track for the sliders). The census (c1; the review re-ran it, U17) shows the CSS does not depend
on that answer:

- **The slider's ten rules exist four times**: `.gloss-gate*` and `.srch-gate*` (both in
  `glossary.css`), `.quotes-bar*` (`quotes.css`), `.dbt-bar*` (`debate.css`). Every rule matches
  Glossary's but one, deliberately: `.dbt-bar-value` is words, so it is not monospaced. Two
  comments justify the copies by saying the panels' paddings "differ and always have"; all four
  are `0.4rem 0.7rem 0.5rem`.
- **The order row and its button exist twice identically** (`.gloss-sort*`, `.quotes-rank*`).

One class set for each, with a CSS modifier for Debate's value (no React flag), about 140 lines
gone. **The components stay as they are**: whether Search, Quotes and Debate should share
`ThresholdSlider` itself is still the fifth sweep's question 3.

Everything that names the classes (U17): `ThresholdSlider.tsx` (for Glossary, FAQ and Citations),
`OrderGroup.tsx` (the group class), the Glossary, Quotes, FAQ, Citations, Debate and Search panels;
`narrow-window.css` (both order-button families); `faq.css`'s `:not(:has(> .gloss-sort))`, whose
relationship must survive a rename; the tests `touch-controls`, `glossary-band-wiring`,
`css-tokens`, the import-order check, `order-group`, `threshold-slider-adopters`,
`mode-surface-changes-no-markup`, the panel and compact-header tests, `quotes-yours-rows`,
`search-results-get-the-room`. The builder re-runs the grep; this list is a claim.

**The evidence, since a refactor has no red test (U18).** Taken **after K1 and K4 have landed**.
A committed script records, for every element of the slider and order row in Glossary, Search,
Quotes, Debate, Citations and FAQ: resolved styles, bounding rectangles and scroll overflow; at
1440 and 390; fine and coarse pointer; both themes; at rest, hovered, focused by Tab, pressed, and
with the slider moved so the reset shows. The same script after the change must print the same
values. The claim that can then be made is "no difference in this matrix", and that is the claim
made. Each text-reading test that names a renamed class is shown to still fail when the
declaration it guards is removed. If the two runs cannot be made to match, the cluster stops and
says so.

## How the clusters are built

Each cluster is one Opus builder in its own worktree, two in flight at most. This umbrella is the
plan for all five, reviewed once by GPT Sol (read-only) before anything is built; each cluster
keeps a short plan doc of its own (`261007a-ui-sweep-k<N>-….md`) recording what landed, what the
builder found false in this plan, and what it left. Each gets a GPT Sol code review, write-capable
inside the cluster, and a browser check by a Sonnet subagent against a dev server started from the
cluster's own worktree and stopped by its PID. The simpler option passed over: five separately
reviewed plans; for items this small the plan review's value is in checking the claims and the
file sets, which one review of this doc does.

Every claim above is a claim. Builders are told to re-find each by content, to report the false
ones, and that a finding marked H is not built until it has been shown.

Gates per cluster: `npm run typecheck`, the suites it touched, `npm run lint` on touched files,
`doc-links`, then merge `origin/dev` and push `HEAD:dev`. No deploy.

## For Greg

**Decided 2026-10-07, Greg:** question 1, *"yes A probably controls that do the same job should look the same in every mode, though use your judgment. and make a minimal update to docs about aiming for consistency. the agent should take screenshots for itself, but no need to show me screenshots. just proceed autonomously"*; questions 2 and 3, *"yes to all as you see fit"*. Font sizes (qi-f8h393sb) were not part of the answer. Built by session `fbrgq3f6-design-consistency` together with the design-system refresh (qi-9sv8cha4).

Nothing here is built. Three questions, each with a recommendation. The version that goes to Greg
through the Overseer is plainer and carries a picture of each "before" (U20: a question about a
tooltip he cannot see is not answerable).

**1. Should controls that do the same job look the same in every mode?**
Measured, the same control comes in several designs:

| The control | Designs | The range |
|---|---|---|
| The row that switches a mode's parts (Summary's Brief/Fuller/Thread, Referee's four, Learn's four, Diagram's five, Debate's two, Structure's two, Search's three) | six | 24 to 36px tall; corners 0, 4, 5, 9 and 10px; a joined bar, separate chips, bare text tabs, an orange outline |
| The button that runs a mode's job | four | nine modes share one (32px, 8px corners); Referee's three are 29 and 34px with 10px corners; Search's `find` is 24px, 12px shorter than the box beside it |
| A text box | nine in the bands, four more on the shelf, Help and sign-in | six paddings, corners of 4, 5, 6, 8 and 10px |
| The order chips and the buttons beside them | four | 23, 26, 28 and 32px in one band |
| Search's order row | one of a kind | its own corner, colour and wrapping where five siblings share one |
| Waiting for a mode to load | two | a spinner after a pause, announced to a screen reader (Chat, Search, Diagram); a bare grey sentence (thirteen bands) |
| A failure sentence | four colours | orange, red, plain ink, grey |
| The signed-out pages' top bar and title | two | the full bar and a 76px title on Home, Features, Pricing; a small home icon and a 24px title on Help, Changelog, Privacy, Contact |

Pictures, taken from the running app on 2026-10-07:
[the part-switchers](261007a-ui-sweep-q1-part-switchers.png),
[the run buttons](261007a-ui-sweep-q1-run-buttons-and-boxes.png),
[the text boxes](261007a-ui-sweep-q1-text-boxes.png).

*Recommend:* yes, one family at a time, each shown to you as a before and after to accept or
refuse: the loading line first (it also fixes what a screen reader hears), then the part-switcher,
taking Summary's joined bar as the model because you chose it on 2026-10-03, then text boxes and
run buttons. Each is a day or less. *Costs:* each changes what a reader sees a little; the
part-switcher most. This is the companion to the font-size question already with you
(qi-f8h393sb), and one answer could cover both: "line up the handful of things that recur".
*If no:* nothing changes; the table stays as the record.

**2. Three things a phone or keyboard reader meets.**
- *Small tap targets at phone width.* Some controls grow for a finger (order chips to 40px,
  Summary's switch to 44px) and their neighbours do not: Quotes' "why" button is 17px square (48
  on one page), the passage links 34 by 9px, Structure's switch 28px, /profile's and Metadata's
  section headings 14px tall, "Forgot your password?" 18px. *Recommend:* give each the invisible
  larger hit area the close cross already has (40px to the finger, drawn the same size). Where
  two would overlap (the 48 "why" buttons sit 20px apart), the row grows instead, and that one I
  would show you first.
- *The dock is a long way off for the Tab key.* On the reading view a keyboard-only reader passes
  40 spine slivers and four buttons per paragraph before the mode switcher. Ctrl-K and `/` work,
  so this is a cost, not a wall. *Recommend:* a "skip to modes" link as the first Tab stop, the
  standard remedy, invisible until focused.
- *The fade-in on the marketing pages hides what you have already seen* when you
  scroll back up (measured on /features). *Recommend:* reveal once and stay.

**3. Smaller things to accept or wave off.**
- *Wording.* The run button is "Find the…" in four modes, "Choose the quotes", "Read the
  timeline", "Write it"; the not-made-yet line says "one model call" in four bands and "one model
  pass" in three; "this one" against "this piece". *Recommend:* pick "call" and "this one"; leave
  the verbs, which read as chosen per mode.
- *Faint text.* The grey for secondary text is 4.44:1 on raised surfaces in the dark theme (the
  bar is 4.5): dock labels, the hover card's buttons. The passage-id chips in Learn's answers are
  2.1:1, faint on purpose by their own comment. *Recommend:* lighten the grey one step on raised
  surfaces; leave the chips unless you find them hard to read.
- *Shadows in the light theme.* Tooltips, dialogs and menus keep the heavy black shadow tuned for
  the dark page; the marketing pages already lightened theirs. [One card, as it is and with a lighter
  shadow](261007a-ui-sweep-q3-light-theme-shadow.png). The difference is small. *Recommend:*
  the lighter one, if you can see a difference at all; otherwise leave it.
- *Three bands still print their own name* (Debate, Chat, Learn) where the rest lost theirs on
  2026-09-05. Debate's comment calls its heading deliberate. *Recommend:* leave them.

**Not asked, because a rule of Greg's already covers it; queued as jobs of their own:**

- **Native browser tooltips to the app's card.** About 140 `title` attributes on controls, against
  the rule in [tooltips.md](../project/tooltips.md) (Greg, 2026-10-01); the densest are Chat (17),
  Search (20), Debate (13) and the shelf's sort chips, where a finger gets no explanation at all.
  The work is mostly four shared pieces accepting a card (`OrderGroup`'s buttons,
  `ThresholdSlider`, `DataTable`'s chips and headers, the dialogs' close buttons), then the
  stragglers; a `title` that needs no card (a `<time>`, the logo's build stamp) stays, with its
  reason. Sized at a day. Not built in this run only because it touches the same panels as K4 and
  K5 and would be a sixth cluster.
- **The hover card on a link or a term cannot be entered with the keyboard** (G2-02, documented as
  known in keyboard.md). The tooltip already has the focus helper (`FocusReach`) the card would
  reuse. Its own small plan, because focus inside a card that closes on `focusin` is easy to get
  subtly wrong.

Still open from earlier sweeps and touched by this one: the fifth's question 3 (one word and one
track for the threshold sliders). K5 removes the CSS half of its cost whichever way it goes.

## Considered and rejected

- **Using `--destructive` for error text and adding no `--danger`.** My first choice; the review
  measured it under the bar on two of the three surfaces. See K1.
- **Moving Search's order row onto `OrderGroup` as a fix.** It changes wrapping and scrolling
  (U16). Question 1.
- **One `<NoneYet>` component for the not-made-yet state.** Every site has its own first sentence,
  run label and class; a shared component would be a bag of props (c3-15).
- **Merging the three hand-rolled sliders into `ThresholdSlider`.** Spreads five flags across
  three callers; see K5.
- **Moving Tweets' hand-written `band-head` into `ModeSurface`.** It exists because its controls
  row must come first; a new slot for one caller fails the deletion test (c3-13).
- **Replacing `.gloss-btn` with shadcn `Button` in Glossary and Citations** (c3-16), and **pulling
  Quotes' own empty, quiet and stale classes onto the shared ones** (c3-14). Real drift, but each
  moves pixels: question 1.
- **Widening `LibraryEntry.has` so the shelf card can list everything built** (U10). A server
  projection and a cache contract, to make one label exhaustive.
- **Arial in every text box** was reported by three auditors as a font bug. It is the reader's
  voice, on purpose ([fonts.md](../project/fonts.md)).
- **Dashed borders** on Referee's preset chips and the shelf's "Tag" chip: a deliberate "add"
  look. **The dock scrolling sideways inside itself at 390**: the documented narrow-window
  behaviour. **No footer on `/read/public`**: public-shelf.md says so on purpose.
- **The z-index and line counts in `design-css-overview.md`**: dated measurements with their
  command beside them, left alone as the sixth sweep's review decided.
- **Both Quotes arrows saying "First quote"** (b1-17): correct as written (U13).

## After the clusters: named, not built

- `/api/relations/:slug` and `/api/illustrated/:slug` answer 404 for "not made yet", printing a red
  console error on Marginalia and Illustrated (R, b1-7, b2-4). The none-yet plan
  ([261006h](261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md)) names
  relations among its five leftovers and **does not name Illustrated**, which makes six. For the
  session holding qi-s6x55kam.
- A signed-out visitor to `/read/<a slug that does not exist>` gets the landing page, the address
  unchanged, and a 404 in the console (R, b3-8); a mistyped path elsewhere gets a proper
  not-found page. It may be deliberate (not saying whether a private article exists). Not checked
  against [security-map.md](../project/security-map.md); for whoever next touches the public
  reader.
- The upload engine and batch upload print plain `Error`s that are authored at their throw sites;
  they need classifying as `ReaderFacingError` before their catches can use the shared helper
  (U12).
- Fields sized by a Tailwind utility (`tw:any-pointer-coarse:text-base`, in `PageContents` and
  Help) fall under 16px at a 12px root, as K1's CSS rule did; the utility outranks the rule (U5).
- Modified-Enter and focus-moving handlers K2 lists as left.
- Three lists that fail to load say "Reload to try again" with no button (saved searches,
  conversations, criteria), where twelve artefact reads have Try again (c3-10).
- `TagEditor.tsx` uses `tw:z-[110]`, above the tooltip's 100 that the map calls frontmost (c1-13).
- A plain-mode paragraph permalink points at `?mode=summary` (H, b2-13). Not checked.
- The FAQ band's (i) card promises order buttons "one tap away" on an article with too few
  questions to show them (b1-9); Citations' (i) card is four times the length of any other
  (b1-8); Quiz's (i) card is not interactive where the other seven are (b2-11).
- A non-admin who opens `/admin` lands on the shelf with no word of explanation (b4-12).
- The same Feedback control is a 16px text button on the shelf and a 44px button on /help (b3-2).
- The landing page's hero image measures 1.69 wide-to-tall against a natural 1.6 (H, b3-19);
  every other screenshot there and on /features is exact.

## One level up

**Is the overall approach to the interface sound? Yes, with one thing missing.** The shared pieces
exist and are good: `ModeSurface`, `JobProgress`, `ReadError`, `OrderGroup`, `ThresholdSlider`,
`describeFetchFailure`, `isImeComposing`, the tooltip, one close cross. Ten artefact modes are the
same page ten times and mostly use them. The drift is at the edges of that group, in the modes
that arrived first or are unlike the rest (Search, Chat, Referee, Diagram), and it is the fifth
sweep's habit again: **a shared piece is extracted, and what predates it is not moved onto it.**
K2 and K4 are that shape entirely: a helper that four callers use and fifteen do not; a rule
whose first branch was copied and whose other three were dropped.

What is missing is not a design system; `controls.md` already says "one height, one radius". It
is that **nothing measures it**. Question 1's table took a browser and an hour to produce, and no
test would notice a seventh design arriving. If Greg says yes to question 1, the cheapest durable
form of the answer is a page like `/design` that draws each recurring control from every mode
side by side, so a difference is something you see by opening one address.

## What the review changed

[GPT Sol's review](261007a-ui-sweep-umbrella-review-sol.md), read-only, verdict **ready with these
fixes**. Twenty-one findings, all accepted and applied above; none overruled. The ones that
changed what gets built:

- **U1.** `--destructive` fails as error text at the row's 0.7 opacity and on the dark raised
  surface. `--danger` is defined after all, as a measured text colour.
- **U2.** Scope only the `.error` arm; `LogoLoader`'s `.loading` needs the rule. The leak is the
  face, size and whitespace as well as the padding.
- **U3, U4.** Focus marks keep each control's geometry; "each takes the dominant mark" would have
  clipped one, doubled another and changed a mark mouse readers see. Three of the controls live
  in components K2 and K3 own, so the file sets were not disjoint: a manifest replaces the claim.
- **U6, U7, U8.** The composition defect is about fifteen handlers and two shared listeners, not
  four handlers. It became a cluster of its own (K2).
- **U9, U10.** The shelf filter's derivation is specified; the "Built" label is made honest, not
  exhaustive.
- **U11.** P0: the stream's early-end sentence is a plain `Error`, so the shared helper would have
  called a dropped connection an app fault. The throw seam is fixed first.
- **U12.** "The other dozen" raw-message sites became a named list with an owner and a reason each.
- **U13.** The Quotes-arrow nomination is false and is removed.
- **U14, U15.** Quotes' retry must retry the rewrite; Search's hint needs wording per case.
- **U16.** Search stays off `OrderGroup`; it gets the accessibility and touch fixes under its own
  class.
- **U17, U18.** K5's consumer list is longer than "tests that read CSS", and equal computed styles
  do not show equal geometry: the evidence matrix grew, and the claim shrank to what it shows.
- **U20.** Tooltips and the hover card's keyboard reach are covered by rules Greg has already
  given; they left the questions and became queued jobs. Two wording contradictions moved into K3.
- **U21.** A live defect the sweep missed: Skim says "Not saved" when it cannot know. In K4.

## What the shelf auditor added

The ninth nominator reported after the first draft. Twelve signed-out pages and three signed-in,
three widths, both themes: no sideways scroll, no console error but the one named above, no
distorted screenshot. Its findings are folded in: the topic counts' contrast and `/opensource`'s
stale line (K3), the signed-out pages' two page frames and the text boxes (question 1), the
scroll-reveal (question 2), and five items in § After the clusters. Not looked at by anyone: a
public article opened from the public shelf; the shelf's table view beyond its text; light-theme
contrast at 820.

## What this run says about the method

- **A browser found less than reading did.** About 230 page loads of measurement produced one
  honest headline, that nothing overflows, and the drift tables. Every live defect that was
  built came from GPT Sol reading components and stylesheets, or from a static nominator
  comparing siblings. A UI sweep still needs the browser, for the "nothing is broken" claim and
  for every before and after, but the second family reading code is where the defects are.
- **The plan review changed more than any nominator.** It reversed one decision (`--danger`),
  removed one false finding, turned four handlers into a class of fifteen with two listeners
  above them, and caught that the obvious failure-sentence fix would have told readers the app
  was broken when their connection dropped.
- **Each code review found something real in work that had been built red-first and
  browser-checked**: a composing key leaking past seven handlers; a sentence calling loading
  results "already opened"; a guard that broke the rule written an hour earlier; a palette test
  that passed at 4.5001:1 for a colour painted at 4.495:1.
- **A brief's facts were wrong about as often as the sixth sweep's were.** "Plain GETs" that were
  paid POSTs is the one that could have cost money; the builder checked before pressing. Telling
  builders that every claim is a claim, and asking for the false ones back, caught each.
- **A `type="search"` box, a Radix popover and a browser's own focus ring** each did something
  jsdom does not, and each was found only in a real browser. Unit tests alone would have shipped
  three fixes that did not fix.

## Review status

- This umbrella, round 1: [GPT Sol](261007a-ui-sweep-umbrella-review-sol.md), read-only, **ready
  with these fixes**; all twenty-one applied. No second round: the fixes narrow or specify the
  work, and each cluster's code gets its own review.
- Each cluster's code: GPT Sol, write-capable inside the cluster, one round each; the prompts and
  answers are beside each cluster's plan (`261007a-ui-sweep-k<N>-code-review-*.md`). K1, K2, K3
  and K5: ready with these fixes, all fixed. K4: not ready, on one finding outside the builder's
  files, which the orchestrator then fixed (§ What landed, K4). Nothing overruled.

## What landed

- **K2, keys pressed while composing — landed 2026-10-07**, `67ce4c833` and `b03381467` on `dev`
  ([its plan](261007a-ui-sweep-k2-composition-keys.md), which holds the census of every Enter and
  Escape handler and what each does). The two shared Escape listeners and fourteen text boxes no
  longer close, clear, cancel, save or navigate on a key the input method is using; `TagEditor`
  and `CommandBar` use the house test; /profile's contents list has a visible, inset focus mark
  (7.3:1 dark, 5.7:1 light). About sixty test cases seen red, 25 mutations, and a browser check
  through Chrome's own composition API (`Input.imeSetComposition`), not synthetic events. The rule
  is written into [keyboard.md](../project/keyboard.md) § "A key an input method is using is not
  ours". **What the plan had wrong:** a guard in the handler is not enough for a
  `type="search"` box, because Chrome empties it on Escape by itself and the old handlers were
  hiding that with `preventDefault`; jsdom has no such default, so only the browser showed it.
  **GPT Sol's review found the cluster's sharpest defect:** seven handlers returned on a composing
  key *before* their conditional `stopPropagation`, so a composing Escape leaked to `document`
  where an ordinary one was contained. Left: `GlossaryPanel`'s "ask a term" box (K4's file, added
  to K4), `ShelfTags`'s popover (added to K3), and, losing no text, `ModeHerald`, the hover cards
  and a few forms the census lists.

- **K1, CSS — landed 2026-10-07**, `74c7ec21b`, `49e5b9ad2`, `3a4d5d745` and Sol's fixes
  `3073853b8` on `dev` ([its plan](261007a-ui-sweep-k1-css-status-rows-focus-marks.md), with the
  measuring script and its before and after output beside it). **Status rows:** the page-level
  rule is `.loading, pre.error`; a failed chat tool row went from 543×115px (48px padding, mono,
  `pre-wrap`) to an ordinary 543×19px row, and a failed dock line from 113px tall to 17px.
  `--danger` is defined in both themes as error text, `oklch(0.7 0.2 27.325)` dark and
  `oklch(0.52 0.2 27.325)` light, 5.2:1 or better on the page, the panel and the raised surface
  in both (the old orange at 0.7 opacity was 1.8 to 4.0:1), and is on /design. **Focus marks:**
  five controls measured after a real Tab went from 1.4–2.7:1 (or no mark) to 4.8:1 or better,
  each keeping its geometry; Marginalia had five such buttons, not four. **The rest:** all built
  as specified. `tests/css-tokens.test.ts` gained a check that no outline is drawn in a surface or
  hairline colour, seen red. GPT Sol: ready with these fixes, no P0 or P1; its two P2s were about
  the builder's new tests (an exemption inherited from the text check; a palette pair that passed
  as a continuous colour at 4.5001:1 where the painted 8-bit colour is 4.495:1). **What the plan
  had wrong:** the tooltip was never off screen at 390, it filled the width to within 5px (the cap
  is restored on that ground, and the card is 13px narrower there); two marks are never drawn at
  once, so Marginalia's offset stays; in the dark theme `--highlight` and `--highlight-text` are
  one colour, so two of the focus changes show only in light. Also extended: the disabled-hover
  guard covers `aria-disabled="true"`, because Citations' Investigate lit the same way. Not
  measured on a real page (no fixture reaches them without a model call): a real failed chat tool
  or dock question, `.marg-question`, `.tip-hit`; those were measured on injected markup matching
  what the components emit. Left: the ordinary `.chat-tool-detail` is `--ink-faint` at 0.7
  opacity, about 3:1 (question 3's "faint text").

- **K3, the shelf's passage filter and false copy — landed 2026-10-07**, `3aad96ec5` and Sol's
  fixes `5b93f7b0e` on `dev` ([its plan](261007a-ui-sweep-k3-shelf-filter-and-false-copy.md)).
  The passage list obeys topics and tags as well as Unread, derived from `narrowShelf` with an
  empty query; a test over all sixteen filter combinations, red first, and red again against the
  version that derives from the card rows. In a browser, six topics with a query matching no
  card listed 1 to 13 passages each and none from outside the topic. The false sentences are
  corrected (Learn's accessible name, Admin home, the shelf card's "Built", two "zoom" sentences,
  `SHARED_LINK_CARRIES`); Citations and FAQ say "Finding…"; the shelf's details trigger has a
  focus mark; the rebuild failure goes through the shared helper; the counts on topic and tag
  chips went from 3.2:1 to 5.7:1 or better in both themes. **GPT Sol's review found two P1s:**
  with "Include archived" on and its listing still loading or failed, hidden archived hits were
  described as "already opened" (the sentence now says only that they are not shown); and the
  builder's guard on the tag popover kept it open by `preventDefault`, against the rule K2 had
  just written that a composing key is left untouched, which Radix makes impossible from inside
  its own callback, so it is a capture listener scoped to the open popover. Two postmortems came
  with it (`261007b`, `261007c`). **What the plan had wrong:** the counts are drawn in
  `ShelfTermChip.tsx` (and `ShelfTagFilter.tsx`), not `ShelfTerms.tsx`, and fail in dark too; "one
  composition check" could not satisfy the written rule. Left: `SHARED_WITH_YOU` in
  `src/messages.ts` still says "at every zoom level" and nothing imports it; "the one admin page
  that writes" survives in a comment, a test comment and a heading in `admin.md`; the shelf's
  two "also found in" sections are told about Unread and topics but not tags.

- **K4, failure sentences and panel states — landed 2026-10-07**, `b007f68cd`, `012af29a1`,
  `675d794f9`, `e707aa87f`, `5d593947c` and Sol's fixes `911317050` on `dev`
  ([its plan](261007a-ui-sweep-k4-failure-sentences-and-panel-states.md)). **The throw seam:**
  a stream that ends early throws a `ReaderFacingError`; a refused completion throws
  `MalformedReply` (its old sentence told the reader to try again, which is a second paid call
  when the answer had already been stored). **The catches:** six hooks and four more sites call
  `describeFetchFailure`; one test file poses only `fetch`, so the real transport marking is what
  is exercised, over seven kinds of failure (25 of 39 cases red first). **Skim's purpose box**
  re-reads what is stored before it says anything: stored, it carries on; not stored, it says so;
  unreadable, it says it cannot tell. **Panels:** Quotes shows a running or failed job at its
  ceiling (and the seventh sweep's rewrite hold, which arrived mid-build, shows there too);
  a glossary occurrence chip moves the stepper; Referee's Criteria and Mirror offer Try again only
  when `worthRetrying`; Search's order row has a named group, pressed states, a guarded hover, a
  focus mark and a 40px floor for a finger, with every resting value at 1440 measured identical
  before and after; the hint under failed searches has three wordings, for all, none and some rows
  retryable. 47 mutations, all noticed. **GPT Sol's verdict was "not ready"**, on one finding the
  builder could not fix inside its manifest: `COULD_NOT_REACH` said "nothing was sent or received
  just now", false for a stream or download cut part-way, and K4 routed six more failures to it.
  **Fixed by the orchestrator in `src/messages.ts`** (the clause is gone; the comment says why),
  so nothing is overruled. Sol's other fixes: Skim's recovered save skipped `profileSaved()`; "That
  was not saved" could be false if another tab overwrote a landed save; the Search hints promised
  a certain failure where the real refusal says "most likely". **What the plan and brief had
  wrong:** Diagram's projection and similar reads are POSTs that can call a paid embedding, not
  plain GETs (the builder aborted them in the browser; nothing was spent); on the server a forced
  Quotes run over a current list is always an append, so only the client's verb differed.
  Left: Mirror, under a failure that cannot be retried, has no pressable control until the
  sub-mode is re-entered (needs `useMirror.ts`); `ProfileBox`, `SettingsSection` and the Add page
  still say "Not saved — …" for every rejection, the defect Skim had (the shared fix is in
  `useAutosavedText`); the lost-connection mark for a blob read is written inline twice and wants
  a `readBlob` beside `readJson`; two comments in `DiagramPanel.tsx` say "the server's own words"
  of a sentence that is now sometimes the client's.

- **K5, the threshold slider and order row — landed 2026-10-07**, `28713c72a` and Sol's fixes
  `1771c8c1f` on `dev`
  ([its plan](261007a-ui-sweep-k5-threshold-slider-and-order-row-one-class-set.md), with the
  measuring script and both runs' output beside it). The slider's ten rules existed four times
  and the order row's eight twice; there is now one set of each, under the names Glossary already
  used (`.gloss-gate*`, `.gloss-sort*`), which three and four bands were drawing with already.
  Debate's value carries a CSS modifier, `in-words`; no component changed beyond the class names
  it emits. 175 lines of stylesheet gone net (the plan said about 140), 71 selector occurrences
  down to 33. **The evidence: 0 differences over 76,084 compared values**, in 28 scenes (seven
  bands, two widths and pointers, two themes) and 292 states (rest, hover, real Tab focus,
  pressed, the slider moved, the reset), each element recorded as a hash of every computed
  longhand plus its box and scroll sizes. The script was shown to repeat (0 differences run
  twice on the untouched tree, once a varying order of custom properties was sorted) and to see a
  change (a `line-height` of 1.4 for 1.35 gave 167 differences). The built stylesheet, as a second
  witness, differs in one rule for these selectors. GPT Sol: ready with these fixes, no P0 or P1,
  no stylesheet changed; it judged the dedup worth its keep and the modifier not a flag too many.
  Not in the matrix: Debate's order row on real markup (no stored debate has two orders; a
  stand-in was measured), a real phone, widths between 390 and 1440, the native range thumb.
  Left: `tests/debate-panel.test.tsx` asserts that an id nothing has had for some time is absent,
  which cannot fail; in Citations, tabbing through the order row adds `&at=` to the address;
  `design-css-overview.md` has no line saying where a band's slider and order row are styled.

**The whole, together:** on the merge of `origin/dev` holding all five clusters, `npm run
typecheck` is clean (3,368 files) and the twenty suites the clusters added or leaned on pass
together (1,024 tests). The full suite was not run by this session; the readiness loop runs it
against `dev`. No paid model call was made at any point: OpenRouter spend for the run is zero.
