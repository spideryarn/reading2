# UI sweep: the umbrella plan

**Status: breadth pass done, plan under review, 2026-10-07. § What landed is filled in as each
cluster does.**

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
- **Four clusters are built in this run** (K1 to K4): CSS defects and focus marks; composition
  keys, the shelf filter and false copy; failure sentences and small panel states; and the
  threshold slider's four copies of one stylesheet. Each is its own worktree, GPT Sol code review
  and browser check, two in flight at most.

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
- **Not looked at:** *(the shelf-and-site browser auditor had not reported when this was written;
  the signed-out pages, the public shelf and the shelf's own controls are filled in under § What
  the shelf auditor added)*. Real loading and failure states (they need a model call or a slow
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

| # | Cluster | Tier | Ease | Value | Risk | Wave |
|---|---|---|---:|---:|---|---|
| **K1** | CSS: a leaking error style, focus marks, undefined tokens, small cascade defects | 0/1 | 4 | 4 | low | 1 |
| **K2** | Composition keys, the shelf's passage filter, and copy that is false | 0 | 4 | 4 | low | 1 |
| **K3** | Failure sentences, and five small panel states | 0 | 3 | 4 | low-med | 2 |
| **K4** | The threshold slider and order row: four stylesheets for one control | 2 | 3 | 3 | med | 3 |

File sets are disjoint within a wave. K3 and K4 both touch `QuotesPanel.tsx`, `SearchPanel.tsx`
and `DebatePanel.tsx`, and K1 and K4 both touch `quotes.css` and `search.css`, so K4 goes last.

### K1 — CSS: a leaking error style, focus marks, undefined tokens, small cascade defects

Stylesheets only, plus the Tailwind classes on one list in `ProfilePage`.

- **A page-level error style reaches two small rows** (C ✓, G1-01). `shell.css` has
  `.loading, .error { padding: 3rem; font-family: var(--font-mono); white-space: pre-wrap }`,
  meant for the whole-page `pre.error` in `ArticlePage.tsx`. `ChatPanel.tsx` emits
  `.chat-tool.error` and `Dock.tsx` emits `.dock-question-state.error`, and neither rule resets
  the padding. A failed chat tool or dock question gains 48px on every side. The builder
  reproduces it in a browser first (it needs no model: add the class in the page), finds every
  emitter of a bare `error` or `loading` class, and scopes the rule to the elements that mean it.
- **`--danger` and `--ink-faintest`** (C ✓, sixth sweep item 3; Greg has said obvious fixes need no
  asking). Both are defined nowhere, so `var(--danger, var(--highlight))` on those same two rows
  draws a failure in the brand orange. The red already exists: `--destructive`, defined in both
  themes and used 34 times. **The two uses become `var(--destructive)`; no `--danger` token is
  added.** The relay said "define `--danger` from the colour scale"; a second name for the one red
  the scale already has is a second way to do one thing, so this is the same outcome with one part
  fewer, and it is said here so it can be overruled. `--ink-faintest` (two uses) becomes
  `--ink-faint`, which is what renders today. The six `var(--destructive, oklch(…))` fallbacks
  that can never fire go, and so does the comment in `diagram-sketch.css` that says
  `--destructive` is defined nowhere (G1-14).
- **Focus marks that cannot be seen** (R for the profile list, b4-2; C ✓ for the rest, G1-03,
  G1-04, b4-3). The app's dominant mark is `2px solid var(--highlight-text)`. The exceptions:
  /profile's section list (no outline, no shadow; the only change is 0.002 of lightness);
  `.prof-box-input` and `.outln-row.focused` (the raw orange, 2.6:1 on the light page);
  Marginalia's four buttons and the collapsed chat card (`--rule-strong`, under 2:1 in both
  themes); /profile's collapsible headings and the shelf's "details" buttons (colour only). Each
  takes the dominant mark. A keyboard reader sees a ring where there was none; nobody else sees
  anything. This is the one item here a reader could call a design change, and it is in the
  cluster because an invisible focus mark is a defect and the mark it gets is the app's own.
- **Small cascade defects** (C ✓ unless marked): the full-screen Sketch rule
  `.sk-in-full .sk-scene { max-width: 20rem }` re-truncates the open scene chip the rule above it
  frees (G1-02); `.gloss-btn:hover` lights a disabled button (G1-09); two tooltip variants drop
  the viewport cap, so a 26rem card is allowed in a 390px window (G1-05, the override C, the
  overflow H: the builder measures it); the touch rule that stops iOS zooming a focused field
  says `1rem` where its own comment says 16px, and the app supports a 12px root (G1-07);
  `.quotes-hint` uses `!important` to beat one rule a more specific selector would beat (c1-7);
  `feedback.css` mixes `in oklch` where the map says `oklab` (G1-11, no visible change).
- **False comments** (C ✓): `src/web/styles/tokens.css` "the app is dark only" (G1-12);
  `styles/tokens.css` "custom properties are unaffected by layering" (G1-13) and "a THIRD" beside
  `calc(var(--rhythm) / 4)` (G1-15).
- **`--ink-faint` on a raised surface, dark theme, is 4.44:1** (R, b1-13, b2-3, b4-10): the dock's
  labels, the hover card's three buttons, Skim's counters. The token passes on the page (5.66) and
  misses on `--surface-raised` by a hair. **Not built**: raising a token that 200 rules read, to
  move a ratio by 0.06, wants a look at /design in both themes by someone with taste; it is in
  § For Greg, question 3.

Done when: each defect has a before and after measured in a browser by a Sonnet subagent (computed
padding on the two rows; `:focus-visible` outline on each control after a real Tab; the Sketch chip
width); `npm run typecheck`, the CSS-reading tests (`css-tokens`, `close-cross`, `touch-controls`,
`styles-entry-is-imports-only` and any that name a changed selector) and `doc-links` pass.

### K2 — composition keys, the shelf's passage filter, and copy that is false

- **Enter and Escape act while a reader is composing Japanese or Chinese** (C ✓, G2-01). Renaming
  a chat thread saves on the Enter that picks a candidate; the chat composer's Escape, which
  dismisses the candidate list, clears the whole draft; the shelf's search and Help's search blur
  on Enter. `isImeComposing` in `key-chord.ts` exists and Search, Debate, the dock and the quick
  search already use it. Red test first for each handler (a key event with `isComposing: true`),
  then the guard.
- **A topic or tag on the shelf filters the cards and not the passage matches** (C, G2-06).
  `Library.tsx` passes only the Unread set to `Passages`, so choosing a topic and searching can
  show no cards above passages from articles outside the topic. The control says "only". Red test
  first; the two sentences that say "unread" where they now mean "your filters" change with it.
- **Copy that is false as written** (C ✓): the Learn band's accessible name is still "Remember
  what you took from this article" (c2-1; Learn replaced Remember on 2026-10-05); the Admin home
  says "Only Gift vouchers can change anything", and the feedback list's Ignore also writes
  (G2-12); the shelf card's details say "Built: nothing beyond the tree" from three flags, on an
  article with Quotes and a Timeline (G2-10); the public-sharing page describes "the finest level
  of zoom", which went with the gist columns (G2-11).

Not here: the reader-facing sentence in `SHARED_LINK_CARRIES` ("its table of contents") is
understandable and was left; it is in question 2.

Done when: each red test has been seen red; a Sonnet browser check types into the rename box and
the composer with composition events and sees the draft survive, and sees the shelf's passage list
obey a topic; `npm run typecheck`, the touched suites and `doc-links` pass.

### K3 — failure sentences, and five small panel states

- **Six places hand a raw exception to the reader** (C ✓, c3-1, c3-2, c2-2). The rule since plan
  [260924a](260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md) is that only a
  sentence somebody wrote for a reader reaches one, and `describeFetchFailure` in
  `src/web/lib/describe-failure.ts` is the seam. `useGlossary.ts` (two sites), `useCitations.ts`
  and `useQuiz.ts` copied its first branch (`StreamStalled`) and print `err.message` for
  everything else; `useProjection.ts` and `useSimilar.ts` store `err.message` outright, and
  Diagram draws it. A lost connection there reads "Load failed". Each calls the helper. Red test
  first: a `TypeError` thrown by the transport must not reach the screen. `SkimPurpose.tsx`'s
  "Something went wrong." (on copy.md's own avoid list) goes the same way. The other dozen
  `(e as Error).message` sites c2 listed are **H**: the builder traces each to its thrower and
  fixes only those a non-`ReaderFacingError` can reach, and lists the rest as checked.
- **Quotes hides a running job at its ceiling** (C, G2-04): at `MAX_QUOTES_TOTAL` the foot shows
  "That is as many as we keep" in place of the progress row, so a run forced from Metadata has no
  Stop and no Retry on the band.
- **A glossary occurrence chip leaves the stepper behind** (C, G2-07): clicking occurrence two
  does not move `atBlock`, so Next goes to two again.
- **Referee offers "Try again" for a failure another try cannot fix** (C, G2-08), where Search,
  Chat and `JobProgress` ask `worthRetrying`. And Search tells the reader "the ⚠ on each row above
  tries it again" when, for those same failures, the ⚠ is deliberately not a button (G2-09).
- **Search's order buttons are the one order row not on the shared group** (C ✓, c3-5, c1-1): no
  `aria-pressed`, no group name, a bare `:hover` (the iOS stuck-hover bug its siblings' comment
  describes), no 40px floor on a touch screen. It moves onto `OrderGroup` and gains the hover
  guard and the floor. **Its look stays** (a 10px corner and plain ink where its siblings have
  6.4px and orange ink): that difference is in question 1.
- **Both arrows of the Quotes stepper say "First quote"** before a quote is chosen (C ✓, b1-17).
  The builder checks which is right and fixes the label.

Not here, and why: **the rewrite hold on seven forced re-runs** (found here as c3-11 and G2-05) is
the seventh sweep's cluster C10, and so is the Metadata page's raw exception. **The loaded
branches of Sketch and Illustrated** draw their own spinner and failure line, so a regeneration
there has no Stop, retry or stalled warning (G2-03); it sits beside C10's work in `useIllustrated`,
and that session took it on 2026-10-07.

Done when: each red test has been seen red and a mutation of each fix turns it red again; a
Sonnet browser check sees Search's order row announce a pressed state and keep its look
(computed radius and colour unchanged); `npm run typecheck`, the touched suites,
`tests/read-error-matrix.test.tsx` and `doc-links` pass.

### K4 — the threshold slider and order row: four stylesheets for one control

Sixth sweep item 6, which recommended waiting for the fifth sweep's question 3 (one word and one
track for the sliders). The census (c1) shows the CSS does not depend on that answer:

- **The slider's ten rules exist four times**: `.gloss-gate*` and `.srch-gate*` (both in
  `glossary.css`), `.quotes-bar*` (`quotes.css`), `.dbt-bar*` (`debate.css`). 39 of 40 rule pairs
  are identical; the one difference is deliberate and documented (`.dbt-bar-value` is words, so it
  is not monospaced). Two comments justify the copies by saying the panels' paddings "differ and
  always have"; all four are `0.4rem 0.7rem 0.5rem`.
- **The order row and its button exist twice identically** (`.gloss-sort*`, `.quotes-rank*`); FAQ,
  Debate and Citations already reuse Glossary's.

One class set for each, with a modifier for Debate's value, and the four components emit it. That
is about 140 lines gone and no pixel moved. **The components stay four**: whether Search, Quotes
and Debate should share `ThresholdSlider` itself is still question 3 of the fifth sweep (the
deletion test says a full merge spreads five flags across three callers), and nothing here
forecloses it.

Proof it changed nothing, since there is no red test for a refactor: before the change, a script
records the computed style of every element of the slider and order row in Glossary, Search,
Quotes, Debate, Citations and FAQ at 1440 and 390, both themes; after, the same script must print
the same values. The script is committed beside the plan. Tests that read these stylesheets as
text are updated only where they name a renamed class, and each is shown to still fail when the
declaration it guards is removed. **Sol is asked directly whether the dedup earns its keep**, and
whether the modifier is one flag too many.

If the before-and-after cannot be made to match exactly, the cluster stops and says so.

## How the clusters are built

Each cluster is one Opus builder in its own worktree, two in flight at most. This umbrella is the
plan for all four, reviewed once by GPT Sol (read-only) before anything is built; each cluster
keeps a short plan doc of its own (`261007a-ui-sweep-k<N>-….md`) recording what landed, what the
builder found false in this plan, and what it left. Each gets a GPT Sol code review, write-capable
inside the cluster, and a browser check by a Sonnet subagent against a dev server started from the
cluster's own worktree and stopped by its PID. The simpler option passed over: four separately
reviewed plans; for items this small the plan review's value is in checking the claims and the
file sets, which one review of this doc does.

Every claim above is a claim. Builders are told to re-find each by content, to report the false
ones, and that a finding marked H is not built until it has been shown.

Gates per cluster: `npm run typecheck`, the suites it touched, `npm run lint` on touched files,
`doc-links`, then merge `origin/dev` and push `HEAD:dev`. No deploy.

## For Greg

Nothing here is built. Three questions, each with a recommendation; the plain-words version goes
to Greg through the Overseer.

**1. Should controls that do the same job look the same in every mode?**
Measured, the same control comes in several sizes:

| The control | How many designs | The range |
|---|---|---|
| The row that switches a mode's parts (Summary's Brief/Fuller/Thread, Referee's four, Learn's four, Diagram's five, Debate's two, Structure's two, Search's three) | six | 24 to 36px tall; corners 0, 4, 5, 9 and 10px; a joined bar, separate chips, bare text tabs, an orange outline |
| The button that runs a mode's job | six | 24 to 36px tall, 8 or 10px corners; Search's `find` is 12px shorter than the box beside it |
| A text box | nine | six paddings, four corner sizes (4, 5, 6, 10px) |
| The order chips and the buttons beside them | four | 23, 26, 28 and 32px in one band |
| An explanation on hover | two | the app's card in most places; the browser's own grey box in about 140, mostly Chat, Search, Debate and the shelf's sort chips, where a finger gets nothing at all |
| Waiting for a mode to load | two | a spinner after a pause, announced to a screen reader (Chat, Search, Diagram); a bare grey sentence (thirteen bands) |
| A failure sentence | four colours | orange, red, plain ink, grey |

*Recommend:* yes, one family at a time, each with a before-and-after screenshot for you to accept
or refuse: tooltips first (a rule you have already stated, 2026-10-01, and the one with a real
cost: touch readers get no explanation), then the loading line, then the part-switcher, taking
Summary's joined bar as the model because you chose it on 2026-10-03. Each is a day or less.
*Costs:* every one changes what a reader sees a little; the part-switcher is the largest. This is
the companion to the font-size question already with you (qi-f8h393sb), and the two could be
answered together: "line up the five or six things that recur" covers both.
*If no:* nothing changes; the table stays as the record.

**2. Three things a phone or keyboard reader meets.**
- *Small tap targets at phone width.* Some controls grow for a finger (order chips to 40px,
  Summary's switch to 44px) and their neighbours do not: Quotes' "why" button is 17px square (48
  of them on one page), the passage links 34 by 9px, Structure's switch 28px, /profile's and
  Metadata's section headings 14px tall. *Recommend:* give each the invisible larger hit area the
  close cross already has (40px to the finger, no change to how it looks), which moves nothing on
  screen except where two targets would overlap.
- *The dock is a long way off for the Tab key.* On the reading view a keyboard-only reader passes
  40 spine slivers and four buttons per paragraph before the mode switcher. Ctrl-K and `/` work,
  so this is a cost, not a wall. *Recommend:* a "skip to modes" link as the first Tab stop, the
  standard remedy, invisible until focused. *Cost:* one more thing in the tab order.
- *The hover card on a link or a term cannot be entered with the keyboard* (documented in
  keyboard.md as known). *Recommend:* its own small job; the tooltip already has the focus helper
  the card would reuse.

**3. Smaller things to accept or wave off.**
- *Wording.* The run button is "Find the…" in four modes, "Choose the quotes", "Read the
  timeline", "Write it"; two modes say "Find" on the button and "Reading…" while it runs; the
  not-made-yet line says "one model call" in four bands and "one model pass" in three; "this one"
  against "this piece". *Recommend:* fix the two mismatches (button and progress line disagree),
  pick "call", and leave the verbs, which read as chosen per mode.
- *Faint text.* The grey used for secondary text is 4.44:1 on raised surfaces in the dark theme
  (the bar is 4.5): dock labels, the hover card's buttons. The passage-id chips in Learn's answers
  are 2.1:1, faint on purpose by their own comment. *Recommend:* lighten the grey one step on
  raised surfaces only; leave the chips unless you find them hard to read.
- *Shadows in the light theme.* Tooltips, dialogs and menus keep the heavy black shadow tuned for
  the dark page; the marketing pages already lightened theirs. Not measured as a defect, only as
  a difference. *Recommend:* look at one tooltip in the light theme and say.
- *Three bands still print their own name* (Debate, Chat, Learn) where the rest lost theirs on
  2026-09-05 because the dock says it. Debate's comment calls its heading deliberate.
  *Recommend:* leave Debate, since somebody decided it.

Still open from earlier sweeps and touched by this one: the fifth's question 3 (one word and one
track for the threshold sliders). K4 removes the CSS half of its cost whichever way it goes.

## Considered and rejected

- **A `--danger` token.** See K1: the red exists as `--destructive`.
- **One `<NoneYet>` component for the not-made-yet state.** Every site has its own first sentence,
  run label and class; a shared component would be a bag of props (c3-15). A shared sentence
  constant is the most that passes the deletion test, and it waits on question 3.
- **Merging the three hand-rolled sliders into `ThresholdSlider`.** Spreads flags; see K4.
- **Moving Tweets' hand-written `band-head` into `ModeSurface`.** It exists because its controls
  row must come first; a new slot for one caller fails the deletion test (c3-13).
- **Replacing `.gloss-btn` with shadcn `Button` in Glossary and Citations** (c3-16). A real drift,
  but it changes a height and a corner a reader would see: it belongs to question 1.
- **Pulling Quotes' own empty, quiet and stale classes onto the shared ones** (c3-14). Same: the
  paddings and colours differ, so unifying moves pixels. Question 1.
- **Making the light theme's shadows lighter here.** A taste call with no measured defect.
- **Arial in every text box** was reported by two auditors as a font bug. It is the reader's
  voice, on purpose ([fonts.md](../project/fonts.md)).
- **Dashed borders on Referee's preset chips**: reads as a deliberate "suggestion" look.
- **The dock scrolling sideways inside itself at 390**: the documented narrow-window behaviour.
- **The z-index and line counts in `design-css-overview.md`**: dated measurements with their
  command beside them, left alone as the sixth sweep's review decided.

## After the clusters: named, not built

- `/api/relations/:slug` and `/api/illustrated/:slug` answer 404 for "not made yet", printing a red
  console error on Marginalia and Illustrated (R, b1-7, b2-4). The none-yet plan
  ([261006h](261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md)) names
  relations among its five leftovers and **does not name Illustrated**, which makes six. For the
  session holding qi-s6x55kam.
- Three lists that fail to load say "Reload to try again" with no button (saved searches,
  conversations, criteria), where twelve artefact reads have Try again (c3-10). Each hook would
  need a retry; a small job of its own.
- `TagEditor.tsx` uses `tw:z-[110]`, above the tooltip's 100 that the map calls frontmost (c1-13).
  Nobody has looked at a tooltip over the tag editor.
- A plain-mode paragraph permalink points at `?mode=summary` (H, b2-13). Not checked.
- The FAQ band's (i) card promises order buttons "one tap away" on an article with too few
  questions to show them (b1-9), and Citations' (i) card is four times the length of any other
  (b1-8).
- A non-admin who opens `/admin` lands on the shelf with no word of explanation (b4-12).

## One level up

**Is the overall approach to the interface sound? Yes, with one thing missing.** The shared pieces
exist and are good: `ModeSurface`, `JobProgress`, `ReadError`, `OrderGroup`, `ThresholdSlider`,
`describeFetchFailure`, the tooltip, one close cross. Ten artefact modes are the same page ten
times and mostly use them. The drift is at the edges of that group, in the modes that arrived
first or are unlike the rest (Search, Chat, Referee, Diagram), and it is the fifth sweep's habit
again: **a shared piece is extracted, and the modes that predate it are not moved onto it.**
Every Tier 0 item in K3 is a hand-rolled copy that kept the first branch of a rule and dropped
the rest.

What is missing is not a design system; `controls.md` already says "one height, one radius". It
is that **nothing measures it**. The numbers in question 1's table took a browser and an hour to
produce and no test would notice a seventh design arriving. If Greg says yes to question 1, the
cheapest durable form of the answer is a page like `/design` that draws each recurring control
from every mode side by side, so a difference is something you see by opening one address.

## Review status

- This umbrella: GPT Sol, read-only. *(pending)*

## What landed

*(filled in as clusters land)*
