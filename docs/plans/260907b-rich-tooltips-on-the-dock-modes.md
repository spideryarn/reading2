# Rich tooltips on the dock's mode buttons

> Make sure all the modes in the bottom-bar have rich tooltips, and update new-mode.md.
>
> — Greg, 2026-09-07

**Status: built, reviewed and landed on `dev` on 2026-09-07** (`bf5c1dbf`). All fourteen modes carry
a two-paragraph `ControlTip` in **both** arms of the bar. `npm test` was 3 red of 787 files, all
three environmental — two want a build the worktree had never run, the third is the Postgres
concurrency test, green on its own. Typecheck clean; checked in a browser at 1280px.

**Stage 2 landed the same day**, on Greg's *"follow up with the three non-mode buttons"*: Comments,
Tweets and Metadata carry cards too now, and the `title` arm of `DockLink`'s `hover` union went with
them — § Stage 2 at the foot of this file.

**Stage 3, 2026-09-08**, on *"proceed with any followups if valuable"*: the three things stage 2
named as left. `DockHome` and `DockCommands` took cards, so **no button in the bar row carries a `title`
now** — one survives in `Dock.tsx`, on the drawer's Close, and § Stage 3 says why it stays; the `readers-own` VisitorGap variant and the message behind it were deleted; and
`Metadata.tsx`'s stale header — the source of two of stage 2's wrong sentences — was corrected where
it lives. § Stage 3 at the foot.

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

Also passed over at the time: **converting the bar's other three buttons** — Comments, Tweets,
Metadata — which still carried `title` attributes. They are not modes, Greg asked about modes, and
each needed its own verified second sentence. Named here so it would not be lost, and it was not:
Greg asked for them the same day, and § Stage 2 below is what that turned into.

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
`act` blocks to close ([tooltips.md § Three things about testing a card in jsdom](../project/tooltips.md)).

- **Every mode in the bar opens exactly one card**, whose head is that mode's `MODE_LABEL`. Exactly
  one, because the panel is portalled to `<body>`: a neighbour's card left open is read here as this
  button's, which is how a check like this passes while asserting nothing.
- **Two paragraphs**, and the second does not restate the first or the label.
- **No `title` attribute** on a mode button, in either arm of the bar — the regression that is
  invisible on a laptop because a `title` still shows *something*.
- **Not the wording.** It is copy, it will be edited, and a test spelling it out is a second copy to
  keep in step — the argument `referee-tooltips.test.tsx` makes at length.

## Stage 2 — the three buttons that are not modes

> Follow up with the three non-mode buttons.
>
> — Greg, 2026-09-07

**Comments, Tweets and Metadata**, the last three buttons in the bar wearing a `title` attribute. Six
sentences, and the interesting part is where they came from rather than what they cost to write.

### Where the copy lives, and why not in `MODE_CATALOG`

`NOT_A_MODE`, in [`Dock.tsx`](../../src/web/Dock.tsx), beside the bar it belongs to. The modes' table
earns its place by being keyed on `Mode`, so a fifteenth mode is a compile error until both halves
are written; these three are not modes and never will be, so the same record would be a home chosen
for its shape rather than for what is in it. Three entries next to their call sites is the smaller
number of moving parts.

### What each second paragraph says, and where it was checked

| | the unguessable half | checked against |
|---|---|---|
| Comments | saving one costs nothing and asks the model nothing; it is pinned to the block id before the quote, so the comment outlives the sentence it marked | [comments.md](../project/comments.md) § What a comment is now, § Anchoring, § Asking the model |
| Tweets | one model pass per thread, kept until asked again; not part of adding an article; nothing is shortened to fit and the page marks the overrun | [`src/tweets.ts`](../../src/tweets.ts) header and `buildThread`, [`Tweets.tsx`](../../src/web/Tweets.tsx) `over` and `Rewrite` |
| Metadata | opening it spends nothing — every number on it is read off what has already been written | [`Metadata.tsx`](../../src/web/Metadata.tsx), [`PublicPages.tsx`](../../src/web/PublicPages.tsx) |

**Three of those six sentences were wrong in first draft, and all three were wrong the same way as
stage 1's twelve — inherited from a doc or a header that was itself out of date.** Sol found all
three; each is checked in the source now and the wrong version is recorded at the call site.

- *"Nothing on it is generated"* (Metadata) — the page opens with the hierarchy's `gist` and
  `summary` under *In one sentence*, which are model output. `Metadata.tsx`'s own header says the
  sentence I copied, and it is stale or at best ambiguous.

  **Its replacement lasted about an hour**, and this is the one worth remembering: *"the page itself
  generates nothing and makes no model call"* was killed not by a reviewer but by the merge before
  the push. [260907d](260907d-re-run-any-generated-mode-from-the-metadata-page.md) landed the same
  day and gave that page a *Generate it again* button per step, so a press there spends. Two of the
  three surviving claims about that page died in one afternoon — a doc, then a feature — which is
  the argument for writing the **narrowest** true sentence rather than the most satisfying one.
  What is left is about arriving rather than about the page: opening it spends nothing, and unlike
  the two buttons beside it this one arms nothing on the way in. The re-run buttons announce their
  own cost where they are, and a bar tooltip that inventoried them would be owner-only anyway — the
  visitor's metadata page has no `RerunSection`.
- *"Written once and then kept"* (Tweets) — a thread has a deliberate `Rewrite`, which the page
  itself calls *"Another model call"*. The empty state upstairs has the same drift.
- *"Kept exactly as written"* (Tweets) — `buildThread` trims each post. Whitespace only, so a wording
  defect rather than a product one; the load-bearing claim is that nothing is **shortened to fit**,
  and that is what the sentence says now.
- *"Each mark … survives"* (Comments) — the visible underline is the one part that does **not**
  survive: `resolveMark` returns `null` when the quote is gone. The saved comment does, and its
  gutter bookmark does while its block is still there. "Mark" is the reader's word for the underline,
  so the sentence promised the exception.

**Which is the same lesson twice in one day, and worth naming.** Both stages went wrong by writing
from a doc rather than from the code the doc describes. A project doc is a claim about the code as of
the day somebody wrote it, and reader-facing copy inherits its staleness silently.

**And a fifth, on the second pass, which is subtler than the other four**: the repaired Comments
sentence read *"pinned to the permanent id, **so** the comment survives"* — the right two facts with
a false mechanism welded between them. Stage 3 carries a block id over by matching the new block to
an old one **by its text** ([block-ids.md § Surviving stage 2](../project/block-ids.md)), so a block
whose words changed can be re-minted; the id is not what saves the comment. It survives because it is
stored against the article rather than a revision. The sentence now states both facts and the
outcome, and claims no mechanism between them. Getting the facts right and the causation wrong is a
failure the group re-read would not have caught either — it reads as true.

The register rule from stage 1 did the work again, and Tweets is where it would have gone wrong.
Pressing that link **does** arm a run — `armActivationForTweets` — so *"pressing this writes the
thread"* is the sentence that wants writing. It is false on three of the four surfaces the string is
drawn on: the link arms only for the owner, only from the reading view's own bar, and only when they
are not already on the thread. The artefact-shaped sentence carries the same fact everywhere.

### The find: a button still saying a sentence the drawer retired

Comments is **two** buttons — a `DockTab` on the reading view, a `DockLink` back to it everywhere
else — and its visitor copy was stale. On 2026-09-04 a shared link started carrying the owner's
comments ([260904c](260904c-more-modes-on-a-shared-link.md) § Stage 3) and the drawer dropped its
*comments belong to whoever added this article* notice that day. The button kept it. A visitor was
told the comments were not for them, above a list of the comments.

Both arms read one string now, and it says the true thing: they are the owner's, you can read them,
only they can add one. **Nothing would have caught this.** Both strings were individually
well-formed, no test compared them, and the button is on a page the person editing the drawer had no
reason to open — the same shape as the *"Your comments"* heading over *"Comments belong to whoever
added this article"* that a browser pass found on 2026-08-28.

Left behind deliberately: `COMMENTS_GAP` and the `readers-own` variant in
[`visitor.ts`](../../src/web/visitor.ts) are the source of that retired sentence, and
`tests/visitor-gaps.test.ts` is now their only consumer. Retiring a `VisitorGap` variant touches
three files and a total switch; it is a clean small change and it is not this one.

### A harness fact, and a wrong diagnosis of it worth keeping

Hovering the same bar button twice in one test opened no card the second time. Three probes said the
same thing — an identical re-render between the hovers, a prop-changing one, and no render at all,
all failing identically — so it was written up as **a control opens its card once per mount**, and
remounted around.

That was the symptom. Sol found the cause: `FloatingDelayGroup` waits its `timeoutMs` (400ms here)
after a close before clearing the current group member, and the timer starts at the close *render*,
so `cardFor`'s two 300ms waits do not outlast it. The second hover reopens instantly — the group is
in its instant phase — and the stale timer's close lands in the same `act`, so the card opens and
shuts inside one block. A third wait fixes it properly; `remount` is gone.

**Three failing probes agreeing with each other is not a mechanism.** All three shared the one thing
that mattered and none of them varied it, so they could only ever have confirmed each other. The
note is in [tooltips.md § Three things about testing a card in jsdom](../project/tooltips.md).

### The test that went red instead of quiet

[`tests/public-network-trace.test.tsx`](../../tests/public-network-trace.test.tsx) had a case
asserting the visitor's Comments link does not say *"Your comments"* — read off its `title`
attribute, which this change deleted. It failed, loudly, because `expect(null).not.toContain(…)`
throws rather than passing. Had the assertion been shaped a shade differently it would have gone on
passing for ever while checking nothing, which is
[silent-success.md](../reusable/silent-success.md)'s whole subject.

It now holds the two things only that file can see — these are the real visitor pages rendered
through the app — namely that the link carries no `title` at all, and that nothing visible on the
page claims the marks are the reader's. The visitor's own sentence is checked where the hover
machinery lives, in **both** arms of the bar: Sol pointed out the first draft of the new tests
covered only the `DockTab` arm, and the drawerless arm takes its footing from a different prop
(`isVisitor`, not `own`) — which is exactly the seam both previous Comments copy bugs slipped
through.

### What stage 2 did not do

All three of these were done on 2026-09-08 — § Stage 3 below.

`DockHome` and `DockCommands` carry `title` attributes. Neither goes through `DockLink`, so neither
was in the union that emptied, and neither is one of the three Greg named. Same argument as before:
worth doing, each needs its own verified sentence, named here so it is not lost.

`Metadata.tsx`'s header sentence — *"Nothing here is generated and nothing here is a model call"* —
is the stale one this change inherited from. It should be corrected where it lives; that is somebody
else's file this week and a one-line fix when it is not.

`COMMENTS_GAP` and the `readers-own` variant in [`visitor.ts`](../../src/web/visitor.ts) — the
source of the retired sentence, described under § The find above. Dead apart from its test, and
saying something that is no longer true, which is the pairing that put the stale sentence on a
button in the first place.

## Stage 3 — the three things stage 2 left

Greg, 2026-09-08: *"proceed with any followups if valuable, then push."* All three of § What is
still not done, which is now a list of things that were done rather than a list of things that were
not. What follows is what each turned out to be once opened, which in two of three cases was not
what the note said.

### `DockHome` and `DockCommands`, and why the wordmark needed a prop

Both took a `ControlTip` and dropped their `title`. **No button in the bar row carries a `title`
now**, which was the point of the whole plan and took three stages to reach because the row is
nineteen buttons of five different kinds.

One `title` is left in `Dock.tsx` and it is staying: the drawer's Close, `.dock-close`, which is
inside `.dock-drawer-head` rather than in the row. A `ControlTip` there would be a card whose first
paragraph is *closes this* and whose second is nothing — the shape this plan exists to stop, arrived
at from the other direction. Written down because *no button carries a `title`* was the first
version of the sentence above, and the next reader to grep `title=` in that file would have found
one and had no way to tell which of us was wrong.

`DockCommands` joined the `TooltipGroup` the three non-mode buttons are in. It is the fourth thing at
that end of the row that is not a mode — its own docblock already argued three ways that it is not a
fifteenth one — and the group is a context provider that renders no element, so the move changed
nothing on the page. Its card is the only surface in the app that can teach ⌘K: § The glyph is
`Command` decided the label should say *what the button opens* rather than *how else to open it*, and
the `title` it replaced never appeared on the phone the button was built for. That clause is the one
piece of wording this file's tests pin, and the test says why.

`DockHome` is at the other end with the whole radiogroup between it and the nearest other card, so it
is in **no** group: there is nothing to scrub to.

**It took a `signedIn` prop, and that is the finding rather than the detail.** *Back to your library*
is true for the owner and false for a signed-out stranger, who has no library — signed out, `/` is
the landing page (`App.tsx` § the signed-out routes). That is the same shape as the Comments bug
stage 2 found the day before: a sentence true for whoever added the article, read out to the visitor,
on a button the visitor can see. **Twice in two days, in a bar of nineteen buttons.** The pattern is
not tooltips; it is that this app has two readers and only one of them is the person writing the
copy.

**And the first version of the prop had the bug in it the other way round.** It was
`experimental.signedIn`, a bare boolean; Sol pointed out that the store opens on
`{loaded: false, signedIn: false}` and writes `loaded: true` only when its auth callback lands
(`experimental-store.ts` § `base`). So for that frame an *owner* would have been told there was no
library to return to — the same false sentence, aimed at the other reader. The prop is
`knownSignedOut` now and the call site asks `loaded && !signedIn`, with *unknown* falling to the
owner's sentence, since a stranger's unknown window is one callback long and the store then says so
outright. There is a test on the unknown frame, and I reintroduced the bug to watch it fail.

The name is the point as much as the condition. `feedback` a few lines up is the same boolean today
and is not the same question — *is there a Feedback button in this row*, which the fit measurement
needs because it is a button's width. Three questions were sharing one field: whether a button is
drawn, whether a reader has a library, and whether we have found out yet. Two of them now have their
own names.

### The `readers-own` variant, and a deletion that had already been decided

`COMMENTS_GAP`, the `readers-own` member of `VisitorGap`, and `readersOwnWork` in `messages.ts` are
gone. `FIXED_BY_AN_ACCOUNT` stayed a map rather than collapsing to `return true`, and its docblock
says why: the rule it encodes is not *the offer always applies*, it is *each kind of gap decides
whether the offer applies*, and collapsing it would delete the question rather than answer it.

Two things worth keeping from this one.

**This was not my decision to make and I did not make it.** 260904c had already made it: *"the
member has no producer and goes"*, with a note that Sol had argued for keeping it and that the
argument was conditional on a consent flag Greg declined. So the drawer's comment saying *both the
gap and the union member behind it are gone* was not wrong about the intent — it was written by
somebody describing a decision that had been taken and then not carried out. It was false about the
code for four days and true about the plan the whole time, which is the more interesting way for a
comment to be wrong, and not one a reader can tell apart.

**The resurrection condition travelled with it**, which was the thing most at risk of being lost:
260904c says to bring `readers-own` back if a consent flag ever ships. That instruction is now in
two more places — the tombstone in `messages.ts` and `FIXED_BY_AN_ACCOUNT`'s docblock — because the
one place it was in is a plan from four days ago that nobody deleting a union member would think to
open. My first draft of the tombstone had the history backwards, saying the sentence *"went wrong by
being answered"*; the flag was refused, not granted. Sol caught it.

**A message with no caller is not inert — it is a sentence waiting to be copied.** It had been false
since 2026-09-04 and unreachable since the same day. Precisely: `COMMENTS_GAP`'s only live consumer
was `tests/visitor-gaps.test.ts`, and `readersOwnWork` still had a real caller in `visitorSentence`
— reachable only through the dead variant, which is a distinction worth keeping because it is what a
grep for callers would have shown, and it would have looked alive. On 2026-09-07 the Comments button
was written from half of it. Dead code with a live test looks maintained; that is exactly what made
it available.

### `Metadata.tsx`'s header, which had gone wrong twice over

The sentence was *"Nothing here is generated and nothing here is a model call."* It now says
**opening it** generates nothing and makes no model call, because the page shows the hierarchy's
`gist` and `summary`, and since 2026-09-07 it can start a run of its own from § Generate it again.

The file was already arguing with itself. The author of 260907d added a paragraph to this same
docblock explaining that *Generate it again* claims nothing about whether you need a re-run — and
left the sentence eleven lines above it saying the page makes no model call. Neither is a careless
author; the header is long and the two paragraphs are not adjacent.

Corrected here **and** in `docs/project/comments.md`, which carried the other half of stage 2's
inheritance: *the block id is the half of the anchor that cannot drift*. Stage 3 carries an id by
matching block **text**, so a block whose words changed can be re-minted. What keeps a comment is
that it is stored against the article rather than a revision. Facts right, causation wrong — the
version that reads most like an explanation.

### What the review found, and the one thing it changes about how this went

Six findings, all of which checked out. Three were reader-facing sentences, which is now the
established pattern of this plan; the other three are the interesting ones.

- **`experimental.signedIn === false` does not mean signed out**, above. A real bug, caught by
  reading a store I had not opened.
- ***"It is a link and nothing else"* is false.** Holding the wordmark down plays a logo animation
  and suppresses the navigation (`logo-animation.ts` § the long press). The claim that mattered was
  only ever about cost, so the sentence now makes only that one: *following it makes no model call
  and spends nothing.* I had written the broader thing because it read better.
- **The card does not reach a phone**, and I had claimed the opposite as an argument *for* the
  change: that replacing a `title` gave the phone something to teach ⌘K with. An uncontrolled card
  opens on hover, and the tap that would reveal it is the tap that presses the button; reading one
  on touch needs the controlled variant and a *tap again* hint, which the spine has and this does
  not. `DockLink`'s own comment had the same error — *reachable by a finger and by focus* — and had
  had it for a while. Both now say what is true, and the ⌘K decision survives on a better argument:
  the chord is taught where a keyboard is, which is the only place it works.
- **Deleting a union member falsified six comments elsewhere**, none of them in the diff: three
  counts in `visitor.ts`, *the first of the three* in `messages.ts`, and two docblocks in
  `PublicChrome.tsx` still naming gaps an account cannot fix. The counts are gone rather than
  decremented — the number has changed four times and a count in prose goes stale silently. And
  `ControlTip` said *three callers* when there were four, which predates this change.
- **The ⌘ test proved less than its name.** It asserted the character, which passes on a card saying
  *press ⌘* with the `K` missing and says nothing about the reader who has no Mac. It asserts both
  complete forms now.
- **`comments.md` still overreached** in the sentence *before* the one I had come to fix: *a comment
  whose quote has been re-extracted away still has somewhere to show*, true only while its block
  keeps its id — which the paragraph I added immediately goes on to qualify. I had corrected the
  claim and left its setup standing.

**The thing worth taking from this stage is where the errors were.** Stage 1's were in the copy.
Stage 2's were inherited from stale docs. Stage 3's were mostly neither: they were in the
*justifications* — the comments explaining why the change was right, which no reader ever sees and
no test can reach. Two of them argued for the change from a fact that was false. Those are the
sentences a future author trusts most, because they read as the reasoning rather than the claim.

### What is still not done

`HomeLogo.tsx` carries `title="Spideryarn — back to the library"`, the same string `DockHome` just
dropped. It is the corner wordmark on every page that is not the reading view, so it wants the same
`signedIn` question asked of it and a look at which of those pages a signed-out reader can reach at
all. Named rather than done: a different component on different surfaces is a different change, and
this one was three follow-ups, not four.

---

Up: [plans.md](../project/plans.md)
