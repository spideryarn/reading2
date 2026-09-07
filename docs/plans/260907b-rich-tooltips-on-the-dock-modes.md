# Rich tooltips on the dock's mode buttons

> Make sure all the modes in the bottom-bar have rich tooltips, and update new-mode.md.
>
> — Greg, 2026-09-07

**Status: built, reviewed and landed on `dev` on 2026-09-07** (`bf5c1dbf`). All fourteen modes carry
a two-paragraph `ControlTip` in **both** arms of the bar. `npm test` was 3 red of 787 files, all
three environmental — two want a build the worktree had never run, the third is the Postgres
concurrency test, green on its own. Typecheck clean; checked in a browser at 1280px.

**What is deliberately not done**, and it is the only thing left: the bar's three buttons that are
*not* modes — Comments, Tweets, Metadata — still carry `title` attributes. They now sit visibly in
the `title` arm of `DockLink`'s `hover` union, so the debt is written into the type rather than into
a comment. § The simpler option passed over says why they were left.

The fourteen mode buttons already open a card. What the card says is **one sentence**, and that
sentence is `MODE_CATALOG[mode].description` — the same words the command bar draws inline beside
the name. So the hover costs a reader 300ms to be told what the button's own label plus a glance at
the row would have told them: it is a label with a longer label behind it.

Every other row of controls in this app has moved past that. The Diagram chips, the thirty Referee
controls, the shelf's five action buttons and the Feedback button all carry a `ControlTip`, whose
one rule is [tooltips.md](../project/tooltips.md#controltip-which-is-what-most-of-them-are-now):

> The first sentence is what a reader could have guessed by pressing the control; the second is what
> they could not — where the answer comes from, what it costs, or what the control does *not*
> promise.

The bar is the **only** row of controls in the app where the second sentence is missing, and it is
the row where the unguessable half matters most. Six of these buttons start a model call the instant
they are pressed (Glossary, Ideas, Quotes, Timeline, Debate, Diagram), four wait on the reader's own
words (Search, Chat, Referee, Remember), three read a tree that was written before the reader
arrived (Hierarchy, Outline, Summary) and one generates nothing at all (Plain). Nothing on screen
distinguishes them.

## What changes

1. **`ModeCatalogEntry` gains a fourth field, `how`** — [`src/mode-catalog.ts`](../../src/mode-catalog.ts).
2. **`DockModes` renders `ControlTip`** rather than a hand-built head-and-paragraph —
   [`src/web/Dock.tsx`](../../src/web/Dock.tsx).
3. **The loose mode links** off the reading view (the metadata and tweets pages) get the same card
   instead of the `title` attribute they carry today.
4. **A test**, `tests/dock-mode-tooltips.test.tsx`, holding the structure and not the copy.
5. **[new-mode.md](../project/new-mode.md)** and **[tooltips.md](../project/tooltips.md)**.

### `how` lives in the catalog, not on a `MODES_UI` row

The catalog was created yesterday ([260906h](260906h-mode-catalog-and-a-command-bar.md)) precisely
to stop product copy accumulating on a 2,300-line React component, and its docblock says what
belongs there: *facts about the mode, not facts about the bottom bar*. "Opening this spends a model
call" and "this reads a tree that already exists" are facts about the mode. A second reader is
plausible without being speculative — the command bar already draws `description`, and the row it
draws it on is exactly where a `how` would go if that bar ever grows a detail pane.

It also keeps the pairing enforceable: `Record<Mode, ModeCatalogEntry>` means a fifteenth mode is a
compile error until somebody has written **both** halves, which is the only mechanism in this
repo that has ever reliably stopped a per-mode table drifting.

### The visitor's sentence moves to the top of the card

`marked` is a per-mode sentence a **visitor** gets — *this hasn't been built yet*, *owners only* —
and it is a third paragraph today. With `how` added it would be the third of three, which buries the
one line that explains why the button looks the way it does. It becomes `ControlTip`'s `state`, whose
docblock already argues exactly this case for the experimental switch: what the control is doing
*right now* goes above the description, because a reader who opened the card because the button
looked wrong should not read two paragraphs first.

### No prices in these cards

Two of these presses cost real money and one of them costs about $0.20. The figure stays out, and
that is a decision already made rather than one taken here: the command bar marks a generating row
with the single muted word `generates` and no figure, because *a bar with a price on it would be more
disclosed than the button beside it*
([reading-view-overview.md § The command bar](../project/reading-view-overview.md#the-command-bar)).
A tooltip on the button itself is the same surface. So `how` says **that** work starts and roughly
**how long** it takes, never what it costs — except where the empty state already says the price out
loud, which is Diagram, and there the card points at the empty state rather than repeating it.

## The simpler option passed over

**Leave the one sentence and lengthen it.** One edit, no new field, no new test — write a longer
`description` for each mode and be done. Refused for two reasons, and the second is the real one:

- The `description` has a **second consumer**, the command bar, which draws it inline on a row in a
  dropdown. A sentence long enough to carry the unguessable half is a sentence that wraps three
  times there. One string cannot be both.
- **A two-paragraph card is checkable and a long sentence is not.** The whole value of `ControlTip`'s
  shape is that a second paragraph restating the first can be caught by a machine
  ([`tests/referee-tooltips.test.tsx`](../../tests/referee-tooltips.test.tsx)'s `restates`), and the
  cheapest way to fill it is exactly the failure. Fold the two halves into one string and the check
  has nothing to compare.

Also passed over: **converting the bar's other three buttons** — Comments, Tweets, Metadata — which
still carry `title` attributes. They are not modes, Greg asked about modes, and each needs its own
verified second sentence. Worth doing; not done here, and named here so it is not lost.

## The register: about the mode, never about the press

**This is the one thing to take away from this plan, and it was learned the expensive way.** The
first draft wrote every `how` about *an owner pressing this button on the reading view*, because
that is the reader you picture when you are looking at a tooltip. Four of the fourteen opened with
*"Opening it runs a model pass…"*, and GPT Sol showed that sentence is false on three of the four
surfaces the same string is drawn on:

| surface | what actually happens |
|---|---|
| the segment, owner, reading view | a press arms the run — the sentence is true |
| the **loose links**, metadata and tweets pages | the link navigates and arms nothing; arriving is not a press ([`activation.ts`](../../src/web/activation.ts)) |
| either arm, **visitor** | an artefact they have no access to opens `VisitorBand`, not a generator |
| either arm, artefact **already there** | the activation is consumed and nothing runs ([`useAutoRun.ts`](../../src/web/useAutoRun.ts)) |

The fix is not a qualifier on each sentence, which would put "if you are the owner, and on the
reading view, and it has not been generated yet" into fourteen cards. It is to **describe the
artefact instead of the gesture**: *"one model pass over the article, written once and then
stored"* carries the same unguessable fact — this is generated and it is not free — and is true
wherever the card is read.

That also settles § `how` lives in the catalog above, which Sol had disputed on the grounds that a
sentence about a gesture on one surface is not an intrinsic fact about a mode. It was a fair
objection to the copy as written, and the copy was what was wrong.

## The fourteen second paragraphs, and where each claim was checked

The known failure mode of this job is a **plausible invention in the second paragraph** — four of the
nine shelf cards were wrong in first draft
([260905h](260905h-rich-tooltips-on-the-shelf-action-buttons.md#four-of-these-were-wrong-in-the-first-draft)),
and the restatement check cannot see a card that is arguing with the code rather than with itself. So
every factual claim below was read out of the source before it was written, and five drafts were
thrown away for being false or overclaiming:

- *Quotes*: "what verification cannot catch is a line the piece was quoting from somebody else" —
  **false**. `authorVoice` refuses a `kind: "quote"` block and a span wholly wrapped in quotation
  marks, deterministically ([quotes.md § Whose words these are](../project/quotes.md)).
- *Remember*: "nothing is stored" — **false**. The mode's threads are stored like chat's
  (`tests/remember-store.test.ts`); what the mode does not do is saved notes or spaced repetition,
  and the `description` already says so.
- *Diagram*: "the longest wait any button in this bar starts" — **not established**. The Sketch takes
  121–194 s and Debate's spike run took 146.7 s, so the two are the same size. A superlative one
  measurement away from being false, and nothing in the diff would have gone red.
- *Debate*: "everything here was written by somebody other than this article's author" — **false**,
  and it contradicts the reasoning behind the mode's own name: the author's own later correction is
  one of the most useful rows it can produce, which is half of why `reception` and `critiques` were
  refused as names (`src/modes.ts` § debate).
- *Glossary*: "their underlines stay in the prose afterwards" — **misleading**. The underlines are
  not a consequence of having opened the mode; the whole list is drawn in every mode as soon as it
  exists ([glossary.md § The underline is always there](../project/glossary.md)).

Four of those five were found by re-reading the set after it was written rather than by any check in
the diff. That is the argument for reading them all again as a group before shipping: each one looks
right on its own line.

**And that was not enough.** A cross-family review then found seven more, which is the whole case for
the second review being weighted above the first ([AGENTS.md](../../AGENTS.md) § Get a cross-family
review). GPT Sol, 2026-09-07:

- the four *"Opening it runs…"* openings, false on three surfaces of four — § The register above;
- *Quotes* again, third time: "lines quoted from somebody else are refused, which keeps the list in
  the author's own voice" is the exact promise [`quotes.ts`](../../src/quotes.ts) says the mode
  **cannot** make. `authorVoice` catches a marked quotation and cannot catch an unmarked, indirect
  or translated one, so the promise the code settled on is *verbatim passages from this article* and
  nothing about authorship. I had read that paragraph and stopped one sentence early;
- *Debate*'s second draft: "nothing here came out of the article itself" — a claim row prints the
  article's own `claimQuote` beside the response ([`DebatePanel.tsx`](../../src/web/DebatePanel.tsx));
  and "two searches" undercounts two metered *passes*, one of which has run 36 searches alone;
- *Chat*: `ToolStrip` renders nothing when no tool ran, so "the strip above each answer" over-promises;
- *Ideas*: "every row points at the passage it came from" is not invariant — a re-extraction can
  leave a row with zero resolved occurrences, which the panel draws deliberately
  ([`IdeasPanel.tsx`](../../src/web/IdeasPanel.tsx));
- *Diagram*: pressing arms only Sketch or Illustrated; Force, Drift and Trail return `null` from
  `activationForDiagram` and fetch on mount, so both halves of "pressing draws it / arriving draws
  nothing" were false whenever `?diagram=` named one of those;
- *Referee* and *Remember* assumed their default sub-mode, but `?referee=` and `?remember=` are
  persistent query state that survives leaving the mode.

Twelve wrong sentences out of fourteen cards, in a job whose entire content is fourteen sentences.
Nothing in the type system, the tests or the linter could see any of them.

| mode | the unguessable half | checked against |
|---|---|---|
| plain | generates nothing; it is also the way *out* of a mode | `MODE_TARGET.plain`, `src/modes.ts` § plain |
| hierarchy | reads a tree the pipeline already wrote; the same tree Outline and Summary read | `MODE_TARGET`, AGENTS.md § Hierarchy and the zoom tree |
| outline | same tree, free; the detail moves rather than the page scrolling | `src/modes.ts` § outline |
| summary | the tree's own gists; one axis, and deliberately no Length control | [summaries.md § Why there is no Length control](../project/summaries.md) |
| glossary | one model pass on opening, then stored; the underlines stay in the prose in every mode | [glossary.md § The underline is always there](../project/glossary.md) |
| ideas | one pass on opening; the assumed/added divider is the model's reading, not the article's | `IdeasPanel.tsx` § `GROUPS` |
| quotes | the model locates, the article supplies the characters; quoted lines are refused | [quotes.md § Whose words these are](../project/quotes.md) |
| timeline | undated rows stay undated rather than guessed; the order is the reading, not a sort | [timeline.md](../project/timeline.md) §§ Nothing is dated unless the article dates it, The order is the model's reading |
| search | two matchers priced differently — words is free and live, meaning is a model call | [search.md](../project/search.md) § Two matchers, one box |
| referee | opens on Criteria and runs nothing; no verdict, ever | `MODE_TARGET.referee`, [referee-mode.md](../project/referee-mode.md) § rule 1 |
| diagram | the press draws the picture; arriving by link draws nothing and states the price | [diagram.md § Why Force was the default, and why Sketch is now](../project/diagram.md) |
| chat | runs nothing until asked; it can reach past the article, and the strip says when it did | [chat-tools.md](../project/chat-tools.md) |
| debate | two searches of the open web; every row links out to its source | `MODE_TARGET` docblock, `DebatePanel.tsx` § `dbt-card-out` |
| remember | you speak first; four stances change how hard it pushes back | [remember-mode.md](../project/remember-mode.md) |

## What the test holds, and what it deliberately does not

Copied from [`tests/shelf-action-tooltips.test.tsx`](../../tests/shelf-action-tooltips.test.tsx),
including its measured jsdom mechanics — a native `mouseenter` to open, both leave events and two
`act` blocks to close ([tooltips.md § Two things about testing a card in jsdom](../project/tooltips.md)).

- **Every mode in the bar opens exactly one card**, whose head is that mode's `MODE_LABEL`. Exactly
  one, because the panel is portalled to `<body>`: a neighbour's card left open is read here as this
  button's, which is how a check like this passes while asserting nothing.
- **Two paragraphs**, and the second does not restate the first or the label.
- **No `title` attribute** on a mode button, in either arm of the bar — the regression that is
  invisible on a laptop because a `title` still shows *something*.
- **Not the wording.** It is copy, it will be edited, and a test spelling it out is a second copy to
  keep in step — the argument `referee-tooltips.test.tsx` makes at length.

---

Up: [plans.md](../project/plans.md)
