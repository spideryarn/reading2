# Adding a mode

The one checklist for adding a mode to the reader — the client half and, if the mode shows a
generated artefact, the pipeline-and-store half. It was two sections until 2026-09-03,
[web-client.md § Adding a mode](web-client.md#adding-a-mode) and
[architecture.md § Adding an artefact-backed mode](architecture.md#adding-an-artefact-backed-mode);
Greg asked for one place, and those two now point here.

> We keep adding new modes because we're experimenting with what feels good. We want to make it
> easy/consistent/robust/reusable to add new modes.
>
> — Greg, 2026-09-02

What a mode *is* is [reading-view-overview.md](reading-view-overview.md); the reasoning, the
measured counts, and the shapes deliberately **rejected** — a mode registry, a sixteen-prop
`<ModeBands>`, a `Record<Mode, BandSpec | null>`, a `makeArtefactStage()` factory, a generic
`/api/artefact/:kind` — are in
[260902o-adding-a-mode.md](../plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md).
Read its *Rejected* list before proposing a registry again.

The shape of both halves is the same: **a closed vocabulary, total tables the compiler checks,
and then a residue nothing checks** — listed here with, in italics, what would tell you if you
forgot it. The rule behind the total tables is
[260830c § What would have caught the class](../postmortems/260830c-the-dialog-said-nothing-was-personalised.md#what-would-have-caught-the-class):
a hand-kept list falling behind a growing set.

## Where else to look

For things this checklist does not hold:

- **What the band shows while it waits** — the house spinner-and-sentence, `useSlow`'s delay,
  `role="status"` — is [web-client.md § The waiting state](web-client.md#the-waiting-state); the
  empty and failed states beside it are the rest of
  [§ Empty is not the same as not asked yet](web-client.md#empty-is-not-the-same-as-not-asked-yet).
- **What a signed-out visitor sees of the mode** on a public article is decided in three places: the
  client's `POLICY` in [`src/web/visitor.ts`](../../src/web/visitor.ts) (which band they get),
  `PUBLIC_PROJECTIONS` in [`src/store/public-reader.ts`](../../src/store/public-reader.ts) (which
  fields a public read selects at all), and the
  server's `REVISION_READ_POLICY` in [`src/store/pg.ts`](../../src/store/pg.ts) (which stored
  columns each kind of read may touch). The rule — a visitor sees whatever is already stored, and never
  starts a paid call — is Greg's, quoted in
  [260929c](../plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md); the threat
  model behind it is [security-map.md](security-map.md). The checklist's rows for it are `POLICY`
  below and [§ The artefact](#the-artefact-if-the-mode-shows-one)'s `PUBLIC_PROJECTIONS` bullet.
- **A mode can start without being opened.** Besides the first press
  ([`auto-run-targets.ts`](../../src/web/auto-run-targets.ts), below), the add page queues every
  main mode once an import finishes — derived from `MODE_CATALOG`'s `experimental` flag, so a new
  non-experimental mode joins it with no edit, and is paid for on every import that keeps the box
  ticked. [`src/web/auto-modes.ts`](../../src/web/auto-modes.ts) and
  [ingest-queue.md § The add page](ingest-queue.md#the-add-page).
- **Checking it in a browser**: [browser-control.md](browser-control.md), then
  [browser-testing.md](browser-testing.md); `CLAUDE.md` § Delegating says who does it.

## Adjacent shapes that reuse part of the machinery

Two existing shapes borrow half this page:

- **A pipeline step with no band** (a line on the Metadata page, a preprocessing pass like
  `crossrefs`) takes [§ The artefact](#the-artefact-if-the-mode-shows-one) and
  [§ Its cost](#its-cost) and skips the client tables. Existing steps have an entry in `STEPS`,
  described in [architecture.md § Stage ownership](architecture.md#stage-ownership), and whether
  one runs on every import is recorded in `DEFAULT_INGEST_STEPS` in
  [`src/pipeline.ts`](../../src/pipeline.ts) —
  [ingest-queue.md § `STEP_ORDER` is not the default list](ingest-queue.md#step_order-is-not-the-default-list).
- **A per-reader setting** is exemplified by the experimental switch, a column on the reader's
  profile row:
  [experimental-features.md § Where it lives](experimental-features.md#where-it-lives). (View
  choices carried in a shared link are URL parameters — [url-state.md](url-state.md). The add
  page's browser-only tick box instead uses `localStorage` —
  [`src/web/auto-modes.ts`](../../src/web/auto-modes.ts) § `readAutoModes`, which says why.)

## The client

**The vocabulary is `MODES` in [`src/modes.ts`](../../src/modes.ts), and the compiler asks for the
rest.** A new word there is red until it has a row in each of these totals:

| Table | Where |
|---|---|
| `MODE_LABEL` | [`src/title-text.ts`](../../src/title-text.ts) — the only place a mode is spelled for a person |
| `OWNER_MODE_NOTE` | [`src/messages.ts`](../../src/messages.ts) |
| `MODE_CATALOG` | [`src/mode-catalog.ts`](../../src/mode-catalog.ts) — **what the mode *is***: the **two sentences** on its bar-button card (`description` and `how` — see [§ The card on the button](#the-card-on-the-button), which is where the second one is written), the words they might type meaning it (`aliases`, which the command bar matches on), and whether it is still behind the experimental switch. A pure module importing only `modes.js`, so both runtimes can read it. All four fields are required, so a new mode means choosing its aliases and **deciding whether it is finished enough to draw for everybody** — [experimental-features.md](experimental-features.md). Say why in the table there either way; moving one later is [§ Moving a mode in or out of the switch](#moving-a-mode-in-or-out-of-the-switch). The `description` and `experimental` fields were on the `MODES_UI` row until 2026-09-07 ([260906h](../plans/260906h-mode-catalog-and-a-command-bar.md)); `how` arrived the same day ([260907b](../plans/260907b-rich-tooltips-on-the-dock-modes.md)) |
| `MODES_UI`, via `ModesMissingFromDock` | [`src/web/Dock.tsx`](../../src/web/Dock.tsx) — an ordered array, because the order is Greg's; the type check stands in for the `Record`. **Layout only** since 2026-09-07: the row is `{ mode, group, icon, keepLabel? }`, the icon being a React component, `group` the run of related modes it sits in (a line is drawn between runs, since 2026-09-29 — put it next to its run, and add it to the hand-written order in `tests/dock-mode-order.test.ts`), and `keepLabel` a fact about the bar's fit ladder |
| `POLICY` | [`src/web/visitor.ts`](../../src/web/visitor.ts) — what a visitor may see; there is no fall-through any more, a missing row is a typecheck error |
| `BAND_SAYS` | [`tests/public-network-trace.test.tsx`](../../tests/public-network-trace.test.tsx) — what a **visitor** is shown |
| `MODE_TARGET` | [`src/web/activation.ts`](../../src/web/activation.ts) — **whether pressing it spends money.** Total since 2026-09-06, over a tagged union: `fixed` carries the target, `delegated` carries **an arming function** (Diagram, whose target is whatever `?diagram=` says), `none` carries the reason in a sentence. A `delegated` row holding a *name* rather than a function was the first draft and GPT Sol refused it — nothing consumes a string, so a mode could claim delegation with no arming path anywhere |
| `SPENDS` and `DRAWS` | [`tests/every-mode-draws-its-surface.test.tsx`](../../tests/every-mode-draws-its-surface.test.tsx) — what an **owner's** press buys, and what the band actually draws. Both independently written, never derived from the tables above. `DRAWS` is total over `Mode` with no exclusions — a mode that draws no band says so as a `kind: "none"` row **carrying the positive control**, what is on screen instead. It was keyed `Exclude<Mode, NO_BAND_MODES>` until GPT Sol's F21 on 2026-09-06, and that one list both excused a mode from the table and skipped it at run time, so a mode added to it was checked by nothing |
| `modeBand()`'s `switch` | [`src/web/reader/Reader.tsx`](../../src/web/reader/Reader.tsx) — **which band the mode opens**, and it is a `switch` with a `never` default rather than a `Record`, because each arm is JSX with its own gates. A mode with no arm is a compile error; a mode that deliberately has no band says so in its own case — `plain` returns `null`, and `marginalia` draws only what sits outside its right-hand column. (It was `band()` until 2026-09-11; `band()` is now the wrapper that puts its answer, or a visitor's `VisitorBand`, inside the boundary below) |
| `MODE_CONTAINMENT` | [`src/web/reader/ModeBoundary.tsx`](../../src/web/reader/ModeBoundary.tsx) — **whether the band may break on its own**, without taking the article. `contained` is the answer for any mode with a band; the boundary is already at the call site. `exempt` needs a reason and a matching change to `EXEMPT` in [`tests/a-broken-mode-leaves-the-article-readable.test.tsx`](../../tests/a-broken-mode-leaves-the-article-readable.test.tsx). Give `WITNESS` an entry for each composition path the mode can draw: the owner's band, a distinct available visitor band, and `VisitorBand` when `visitorGap` can put it in the slot. Each names a `useRenderCount` label whose injected throw proves the component is really inside. If a press or a chip inside your band arms a token, add it to `bandTarget` in `activation.ts` so a band that throws before claiming it retires it ([web-client.md § A mode that breaks](web-client.md#a-mode-that-breaks-does-not-take-the-article-with-it)) |
| `selectPassages` | [`src/web/reader/passages.ts`](../../src/web/reader/passages.ts) — **which passage slot the ring, the paragraph bar and the rail are drawn from.** Same `never` default. A mode with no passage producer answers `NO_FOUND` explicitly — the switch is the list of which do. The **prose marks** are one step further on: `proseFound`, in the same file, adds the quotes, which are marked in every mode ([quotes.md](quotes.md)) — so a new mode gets those whether it asks or not, and must not add them to the other three |

Then the residue, which is why this page exists:

- ~~**The band branch**~~ — **it left this list on 2026-09-06.** It was seventeen sibling
  `{mode === "…" && <Band/>}` expressions that nothing checked, so a mode with no branch opened an
  empty band and errored nowhere; it is now the `modeBand()` switch in the table above, and so is the
  passage selection beside it. Both are compiler-checked, and what a new mode makes red is
  written out below.
- **The mode's URL params**, [`params.ts`](../../src/web/params.ts) — [url-state.md](url-state.md).
  *Nothing.*
- **A resolver in [`search-hits.ts`](../../src/web/search-hits.ts)** if the mode marks passages;
  `Found` is the one currency. *Nothing.*
- **A read hook** shaped like [`useIdeas.ts`](../../src/web/useIdeas.ts) — ordering from
  [`useOrderedRead.ts`](../../src/web/useOrderedRead.ts), the job from
  [`useStepJob.ts`](../../src/web/useStepJob.ts), rather than a ninth copy of either. *Nothing.*
- **Opening it for the first time starts it — always.** A mode the reader opens with nothing in it
  generates it, rather than offering a button and waiting, and so does each of its sub-modes:

  > opening a mode should always trigger generation if it hasn't happened already.
  >
  > — Greg, 2026-10-01 (7T; Summary was the last artefact mode that waited on a button —
  > [261002a](../plans/261002a-summary-generates-on-open.md))

  Modes with nothing to generate (Plain, Structure and Marginalia) open without a run. So do
  surfaces that need the reader's words first (Search, Chat, Referee's Criteria and Mirror,
  Remember's Recall). So a new
  artefact-backed mode wants a name in
  [`auto-run-targets.ts`](../../src/web/auto-run-targets.ts) and `useAutoRun` in its hook, called
  with the **unforced** verb. The traps, and the one mode deliberately left out, are
  [260906b](../plans/260906b-opening-a-mode-starts-it-generating.md).
  *[`tests/modes-that-start-themselves.test.tsx`](../../tests/modes-that-start-themselves.test.tsx)
  for the modes already in it, and since 2026-09-06
  [`tests/every-mode-draws-its-surface.test.tsx`](../../tests/every-mode-draws-its-surface.test.tsx)
  § `SPENDS` for a new one — an independently written table of what each press buys.*
- **The band itself**: render it with
  [`ModeSurface`](../../src/web/ModeSurface.tsx), which owns the `<aside class="mode-band">`, its
  **required** `aria-label`, the optional `head` and `foot` slots, the band's (i) (`mode` and
  `about`, below), and nothing else. Do not
  hand-write the `<aside>` — twelve panels did until 2026-09-07, and the two places that still do
  are documented exceptions rather than precedents: `FeatureBoundary`'s fallback (a deliberate
  circuit breaker — read the comment there before you touch it) and the `/design` band specimen.
  **Decide whether your header row is meant to persist when it has nothing in it**, because
  `ModeSurface` renders no header element at all for an absent, `null` or boolean `head`:
  - a row that should **stay put while its contents come and go** — because something below it
    would otherwise shift, or because it is the only line that cannot wrap — takes an
    always-present fragment, `head={<>{artefact && <X/>}</>}`;
  - a header that genuinely **should not exist** in a state takes the conditional directly,
    `head={artefact && <X/>}`, and no empty row is drawn.

  Five existing bands are in the first camp and it is not obvious from their code: Glossary, Ideas,
  Quotes and Timeline all empty their header while the artefact loads, and **Diagram's is empty in
  its ordinary state** — its only header child is a caveat that draws on the projected pictures,
  while Sketch is the default. Those five were migrated as fragments to keep exactly the row they
  already had. Do not copy the fragment by reflex; copy the question.
  [260906f](../plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md).
  *[`tests/mode-surface-changes-no-markup.test.tsx`](../../tests/mode-surface-changes-no-markup.test.tsx),
  which pins each band's **surface shape** — its root, its ordered direct children, its header's
  children — against what it was before the surface existed. Not a full-DOM oracle: it does not see
  descendants below a direct child, attribute values on children, or a branch no fixture mounts.*
- **The band's chrome**: the scroller is documented in
  [`styles/mode-band.css`](../../src/web/styles/mode-band.css) § mode band. A `.band-head` title row is **optional, and
  the default is not to have one** — since 2026-09-05 it must not carry the mode's own name, because
  the Dock at the foot of the page is already saying it (Greg: *"I think we can rely on the bottom
  bar to tell us what mode we're in"*). Add the row only if you have something else for it — a
  count, a sub-mode switch, a control that cannot wrap. Summary and Search have none at all.
  [260905d](../plans/260905d-declutter-the-reading-view-top-bars.md) § Stage 5. *Nothing.*
- **No description line in the band.** A sentence saying what the mode is, how it was made or how
  to read it — *"Written by AI in plain words to help you get your bearings…"* — is not wanted, at
  the top, in a foot, or under the controls:

  > make a note in the new-mode.md (or similar) that we don't want these mode descriptions - they
  > waste space. Either put them as tooltips for an (i) icon, or just try and make things
  > self-explanatory.
  >
  > — Greg, 2026-09-30 (SPIDERYARN-READING2-7B)

  So, in order of preference: make the control or the content say it by itself; put it in the card
  on the control that opens it (`ControlTip`'s *what* and *how*, [tooltips.md](tooltips.md)); or
  put it in the band's (i), next. Empty states and failures are not descriptions — they say what is
  happening, and stay.
  [261001b](../plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md)
  took Simple's foot out for this.
- **Every band has an (i) in its top-right corner**, and what a band says *about itself* goes there:

  > Move this into a tooltip for a (i) icon in the top-right. … Each mode should have such an (i)
  > icon, which contains information like: how many X (of y); other useful explanatory information
  > about what this is, why, how it works, caveats, how to understand it, etc; when it was
  > generated/ran; what model was used.
  >
  > — Greg, 2026-10-01 (spya-ucu35y), about Tweets' *"Written by claude-sonnet-5 · tweets/5 · 1 Oct
  > 2026 · 20.0s"* foot

  Give `ModeSurface` your mode as `mode`, **unconditionally**: the card then opens with the mode's
  own `description` and `how` from [`MODE_CATALOG`](../../src/mode-catalog.ts) — the words the
  Dock's card on its button says, so write them there and not again — and the band has its (i) in
  every state, loading, empty, running and visitor included. `about` adds what only your mode
  knows, in this order: **counts** ("12 terms", "8 of 24"), **caveats**, and **who made it and when**
  with [`AboutMade`](../../src/web/BandAbout.tsx) — the model, the version, the exact time and how
  long ago ([design-css-overview.md § Dates](design-css-overview.md#dates)), how long it took. That
  last part is the owner's alone: a visitor's artefact carries none of it.

  **What stays on the band**: empty states, loading, running jobs and failures; anything the reader
  can act on; a count beside the control it describes (a threshold's "8 of 24"); navigation
  ("Question 3 of 8"); and a caveat the visible rows cannot be read without — Timeline's *"Everything
  dated here is in 2026"*, because its rows leave the year out. A head row whose only content was a
  count goes, and gives the space back. The one band without a corner (i) is Referee, whose *how
  this works* card is too long for a tooltip and opens inside the band instead.

  **Your top row has to leave the corner clear.** The (i) is out of flow (`position: absolute` in
  the band), and the band gets `has-about`, which sets `--band-about-room`. `.band-head` and
  `.gloss-sort` already pad their right edge by it; if your top row is anything else, add
  `var(--band-about-room)` to its right padding in your own stylesheet
  ([design-css-overview.md](design-css-overview.md) § The band's (i)). Plan
  [261001m](../plans/261001m-every-mode-gets-an-i-in-its-top-right-corner.md).
  *[`tests/every-mode-draws-its-surface.test.tsx`](../../tests/every-mode-draws-its-surface.test.tsx)
  § `DRAWS`: every band row says `about: "corner"` or names why it is exempt, and the sweep checks
  one (i), first in the band, in the empty and the populated state, and no "Written by" on the band
  itself.*
- **`CACHEABLE`** in [`lib/api.ts`](../../src/web/lib/api.ts), if the mode has a GET.
  *[`tests/cacheable-covers-artefact-routes.test.ts`](../../tests/cacheable-covers-artefact-routes.test.ts)*,
  which derives the list rather than repeating it.
- **The dock's mode page**, and the mode's line in
  [reading-view-overview.md § The modes in the band](reading-view-overview.md#the-modes-in-the-band)
  with the doc that owns it. *[`tests/doc-links.test.ts`](../../tests/doc-links.test.ts), for the
  doc; nothing for the line.*
- **Each voice in its face**: apply the provenance rule in [fonts.md](fonts.md), with a class per
  element in [`voices.css`](../../src/web/styles/voices.css). *[`tests/voices-css.test.ts`](../../tests/voices-css.test.ts) §
  `VOICES_BY_MODE`, a `Record<Mode, …>`: the mode's AI classes, or why it has none. It cannot see an
  element you forgot to name.*

A mode that shows nothing generated — Plain, Search — stops here.

## Patterns requested for existing modes

Nothing checks these. Each was asked of a particular mode and later implemented by the other named
modes; each item points to the mode doc that holds its machinery.

- **Generated Glossary, Quotes and Citations items are marked in the main text in every mode.**
  Asked first of
  the Glossary (Greg, 2026-08-26: *"Glossary entries should always be underlined in the verbatim
  text column, even outside Glossary mode"*), then of Quotes, then of Citations:

  > And (just as we do with quotes and glossary), once generated, we should always visually
  > indicate Citations somehow in the main text (with tooltip/clickable, that pops up a panel for
  > the citation with various useful information & actions.
  >
  > — Greg, 2026-09-12 (SPIDERYARN-READING2-3M,
  > [260916b](../plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md))

  How it was done without making every reader fetch every list:
  [260908i](../plans/260908i-quotes-marked-in-the-prose-in-every-mode.md), and
  [citations.md § Marked in the prose, in every mode](citations.md#marked-in-the-prose-in-every-mode).
- **The rated lists in Glossary and FAQ open in a prioritised order, with a threshold the reader
  can move.**

  > perhaps we could even consider using the same approach we use for the glossary and other
  > places, where we give each question a rating for something like how difficult and how
  > central, as well as the ordering. And that way then we could have a prioritized ordering by
  > default with a threshold
  >
  > — Greg, 2026-09-29, of FAQ (SPIDERYARN-READING2-5D,
  > [260929g](../plans/260929g-faq-difficulty-centrality-and-a-threshold.md))

  The machinery is [`src/web/threshold.ts`](../../src/web/threshold.ts) § `applyThreshold` and
  [`ThresholdSlider`](../../src/web/ThresholdSlider.tsx); the reasoning is
  [glossary.md § The threshold, and whose it is](glossary.md#the-threshold-and-whose-it-is) and
  [faq.md § A few big questions first](faq.md#a-few-big-questions-first-and-a-threshold).
- **A mode whose items are anchored to blocks is a candidate for Marginalia**, shut by default.
  Asked when FAQ, Citations, Debate and comments went there:

  > And make a note in new-mode.md and/or docs for Annotation mode that we should keep an eye out
  > for where new mode-items might be useful to include/display in Annotations mode.
  >
  > — Greg, 2026-10-01 (SPIDERYARN-READING2-82,
  > [261002b](../plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md))

  So when you add a mode, ask whether its items belong in the right-hand column.
  [marginalia.md § Keep an eye out for new kinds](marginalia.md#keep-an-eye-out-for-new-kinds) says
  what adding one takes, and which kinds are not there yet.

## The card on the button

Both halves of the card are `MODE_CATALOG` fields, so the compiler asks for them; what it cannot ask
for is that the second one is worth reading. The rule is
[tooltips.md § `ControlTip`](tooltips.md#controltip-which-is-what-most-of-them-are-now):

> The first sentence is what a reader could have guessed by pressing the control; the second is what
> they could not — where the answer comes from, what it costs, or what the control does *not*
> promise.

So `description` is the mode in one fragment — it is also what the command bar draws inline beside
the name, which is why it stays short — and `how` is the half a press would not have told them. For
the current modes that is almost always one of three things: **it reads something already built**
(Structure), **its content is a model pass over the article, written once and
stored** (Summary's plain-words levels, Glossary, Ideas, Quotes, Timeline, Debate, Citations, FAQ, Skim and Diagram's Sketch
or Illustrated picture — the artefact-backed surfaces a press on the reading view can start paying
for, `MODE_TARGET` in [`activation.ts`](../../src/web/activation.ts)),
or **it waits on the reader's own words** (Search, Chat, Referee, Remember). Plain is the remaining
one and generates nothing at all.

Five things to get right, and the first is the one that cost this field a whole review round:

- **Write about the mode, not about pressing the button.** The same string is read on four surfaces
  at least — the segment on the reading view, the loose links on the metadata page
  (which navigate and arm *nothing*), and either of those seen by a visitor, who gets an explanatory
  band rather than a generator. So *"opening it runs a model pass"* is false on three of the four.
  Four of the then fourteen cards opened that way in first draft (2026-09-07) and every one was caught by a cross-family
  review rather than by anything in the diff. *"One model pass over the article, written once and
  then stored"* says the same thing and is true wherever the card is read — and it is what makes
  `how` an intrinsic fact about the mode rather than a Dock string parked in a shared module, which
  is the argument for it living in the catalog at all.

- **No price.** Say that work starts and roughly how long it takes, never what it costs. The command
  bar marks a generating row with the single muted word `generates` and no figure, because a bar
  with a price on it would be more disclosed than the button beside it
  ([reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar)) — and a
  tooltip on that button is the same surface. Diagram's empty state is the one place the number is
  said out loud, and the card points at it rather than repeating it.
- **Not the first paragraph again.** The cheapest way to fill `how` is to reword `description`, and a
  hover that costs a reader 300ms to learn nothing they knew is worse than no card at all.
- **Not something already on screen.** The band this button opens says its own thing, and the
  visitor's sentence is `markedModes`' — neither belongs here as a second copy.
- **Read it out of the source before you write it.** The known failure of this job is a *plausible
  invention* in the second paragraph: four of the nine cards on the shelf's action row were false in
  first draft, and two of the mode cards were thrown away for the same reason
  ([260907b](../plans/260907b-rich-tooltips-on-the-dock-modes.md) has both, and the table of where
  each claim was checked). The restatement check can see a card arguing with itself and cannot see
  one arguing with the code.

*[`tests/dock-mode-tooltips.test.tsx`](../../tests/dock-mode-tooltips.test.tsx) — that both exist,
that the second is not a copy of the first, that no price crept in, and that every mode's card opens
in **both** arms of the bar: the segment on the reading view, and the loose links on the metadata
page, which are a different component and were the arm left carrying a `title` attribute.*

## Moving a mode in or out of the switch

Three edits, and the second is the point:

1. **The `experimental` flag on its `MODE_CATALOG` entry**, [`src/mode-catalog.ts`](../../src/mode-catalog.ts)
   — it was on the `MODES_UI` row until 2026-09-07. That is the whole of the behaviour — the route,
   the band and the URL do not change, and a hidden mode was always reachable by `?mode=…` anyway.
2. **Its name in `BEHIND_THE_SWITCH`**, [`tests/dock-experimental-modes.test.tsx`](../../tests/dock-experimental-modes.test.tsx).
   An independent copy of the policy on purpose, so that nobody moves a mode in or out of every
   reader's bar by editing one boolean: change the flag alone and six of that file's tests go red,
   in either direction. Deriving the list from `MODE_CATALOG` would assert that the bar draws what
   the table says, which is what `visibleModes` *means* — a check that cannot fail. GPT Sol weighed the
   alternatives on 2026-09-06 and this is the one it kept.
3. **The row, and the reason, in [experimental-features.md](experimental-features.md)** — going in
   or coming out, say why. That doc owns the argument.

**Nothing counts the modes, anywhere, and it must stay that way.** Promoting Quotes on 2026-09-06 was
one line of behaviour and 86 of bookkeeping, because "nine of fourteen" had been restated in five
source comments, two docs and a pile of assertions — and one of the two literal lists had already
drifted wrong and gone on passing, since a stale name in a `not.toContain` loop is a weaker
assertion rather than a failing one. Assert identities against `BEHIND_THE_SWITCH`; derive
everything else from `MODES`.

## The artefact, if the mode shows one

It starts at `ArtifactKind` and `ArtifactMap` in
[`src/store/artifacts.ts`](../../src/store/artifacts.ts) and `StepName` in
[`src/types.ts`](../../src/types.ts). **The compiler then asks for a row in each of these**, every
one of them a total record, so the new kind or step stays red until it has one: `SHAPE` and
`STAMP_SOURCE` (`artifacts.ts`), `STEP_BUDGET_MS`
([`src/jobs.ts`](../../src/jobs.ts)), `STEPS` ([`src/pipeline.ts`](../../src/pipeline.ts)) and — via
`StepsMissingFromOrder` — `STEP_ORDER`, which moved to
[`src/step-order.ts`](../../src/step-order.ts) on 2026-09-04 so the browser could read the order
without naming a server module, and which `pipeline.ts` re-exports; `ARTICLE_OUTPUT_FORMAT`
([`src/pipeline.ts`](../../src/pipeline.ts)), each article stage's answer format; `TASK_TIER`, `TASK_WIRE`, `MODEL_ENV_VAR`,
`STAGE_EFFORT` and `ARTICLE_RENDERER` ([`src/models.ts`](../../src/models.ts));
`REVISION_CARRY_POLICY` ([`pg-revisions.ts`](../../src/store/pg-revisions.ts)); and `ArticleReader`
([`contracts.ts`](../../src/store/contracts.ts)) with its adapter,
[`pg.ts`](../../src/store/pg.ts), *annotated* rather than
`Pick`-cast. (`DECODERS`, the filesystem adapter's per-kind decode table, was on this list too until
`artifacts-fs.ts` was deleted 2026-09-05; there is no Postgres equivalent, because the columns need
no decoding.)

Then the residue nothing refuses at compile time:

- **The SQL CHECK on `revision_step_runs.step_name`** — a migration is the truth and the literal in
  [`src/db/schema.ts`](../../src/db/schema.ts) is a hand-kept copy, because `drizzle-kit generate`
  cannot see a CHECK expression. *[`tests/db-step-constraint.test.ts`](../../tests/db-step-constraint.test.ts)*
  compares the last `ADD CONSTRAINT` in the journal's migrations with `STEP_ORDER`, both directions.
- **The per-kind GET route** in [`src/routes.ts`](../../src/routes.ts); each carries a different
  staleness contract, which is why there is no generic one. *Nothing.*
- **The put-chain in [`src/store/export.ts`](../../src/store/export.ts)** — one `await put(…)` per
  artefact, and a missing line exports nothing and says nothing. *Nothing.*
- **`PUBLIC_PROJECTIONS` and the public DTO** — and a visitor may read it by default. A mode that
  stores what it generates shows the stored output to a visitor on a public article, and only
  *making* it is the owner's; `owners-only` is for a mode whose stored output is the reader's own
  writing (Chat, Remember, Referee). Four modes took `owners-only` as "a staging decision" and a
  visitor was refused a Skim that had already been paid for —
  [the postmortem](../postmortems/260929a-one-policy-row-decided-who-may-make-a-mode-and-who-may-see-it.md):
  [`public-reader.ts`](../../src/store/public-reader.ts) and
  [`src/public/dto.ts`](../../src/public/dto.ts).
  *[`tests/store-revision-columns.test.ts`](../../tests/store-revision-columns.test.ts)* pins each
  read's projection exactly against `REVISION_READ_POLICY`'s grants;
  *[`tests/public-dto.test.ts`](../../tests/public-dto.test.ts)* pins the keys a public DTO may emit,
  against inputs deliberately over-full so a projection that copied its argument would fail.
- **And if what a visitor reads is a *table* rather than a column on the revision**, four more
  things, learned by doing it twice on 2026-09-04 (comments, then saved searches —
  [260904c](../plans/260904c-more-modes-on-a-shared-link.md)). A mode whose content is the
  **reader's own work** is a different job from a mode whose content is a generated artefact:
    - **its own query in `public-reader.ts`**, naming its columns and **repeating `publicSlug` in
      its own `where`**. Resolving an article id and handing it to the owner's reader is the exact
      escape hatch *[`tests/public-imports.test.ts`](../../tests/public-imports.test.ts)* exists to
      close, and that test's **table allowlist** has to be widened deliberately, with the three
      sentences its docblock demands written about the new line;
    - **the row filters in SQL, never in a `map`** — a filter in a projection is one satisfied
      typechecker away from being widened, and a row that was never selected has to be put back on
      purpose. *[`tests/public-reads.test.ts`](../../tests/public-reads.test.ts)* reads them off the
      generated statement;
    - **an `access` union on the panel**, whose visitor arm carries **none of the verbs** rather
      than a `readOnly` flag beside them — and none of the fetch state either, since a visitor makes
      no request. React forbids a conditional hook, so the owner/visitor seam is a component
      boundary ([reader-capability.ts](../../src/web/reader-capability.ts));
    - **a second fixture article in the Postgres test**, private, with rows of its own. With one
      article in the fixture a query filtering on nothing returns the same rows as one filtering
      correctly, so the predicate is untestable —
      *[`tests/public-visibility-pg.test.ts`](../../tests/public-visibility-pg.test.ts)*.
- **Pressing the control that opens it — a mode button, a sub-mode chip — runs the job when there
  is nothing there**; arriving does not. (One mode starts on arrival instead: Tweets, since
  2026-09-29 a mode rather than a page, kept the rule Greg asked of its page on 2026-09-12 —
  `useAutoRunOnArrival` in the same file — and is in last-view's `NEEDS_AN_EXPLICIT_PRESS` so a
  restore cannot spend. A new mode that wants the same needs both halves.)
  [`useAutoRun.ts`](../../src/web/useAutoRun.ts) is the whole rule, and
  [reading-view-overview.md § True across the whole view](reading-view-overview.md#true-across-the-whole-view)
  is why. *Nothing.*
- **`PROMPT_VERSION`, bumped, whenever you change what the prompt asks for** — the
  stamp says which prompt wrote the artefact, and an unchanged one makes every
  stored artefact claim it was written by the prompt that ships. Where the stage
  also has an `outdated` comparison ([`pg.ts`](../../src/store/pg.ts)) the bump
  marks old artefacts outdated — re-run from Metadata if wanted, but **not announced in the
  panel** (Greg, 2026-09-29, SPIDERYARN-READING2-55;
  [260929c](../plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md)); only a
  *stale* result, where the article moved, gets a banner. `structure`'s
  is a stamp and nothing more; `labels`' has no comparison either but is inside
  `batchFingerprint`, so it invalidates checkpoint reuse. Check the version is
  *one* constant before you bump it: `sketch` had two literal
  copies in two files until 2026-09-03 — `SKETCH_VERSION`, which is what gets
  stamped, and `PROMPT_VERSION`, which is what gets compared — so bumping either
  alone marked every sketch outdated including one generated a second later.
  *Nothing.*

## The words the mode puts in front of the reader

A new mode's prompt takes the shared plain-words rule, `plainWords(...)`, naming each kind of text
it writes — [prompting-guide.md](prompting-guide.md) is the rule, the trade-off and how to measure a
change. If the model answers in JSON, the request sends a strict schema through
`withMessagesJsonSchema` (or `withChatJsonSchema`) — no `enum` of block ids, and the ids still
resolved after the parse — [prompting-guide.md § What the model writes back](prompting-guide.md).

## Its cost

**Nothing to add, if the mode spends through a pipeline step or an article route** —
[cost-tracking.md](cost-tracking.md) is the three rules that make that true. A step's spend is
attributed to the article by `runStep`, and its `(step, job)` pair becomes its own line in the
**What it cost** section of the metadata page (administrator only); `npm run cost` counts the same
calls by job and category.

Two things to check:

- **A new route answers `article` in the route table** — `"first-capture"` when the slug is capture 1;
  the compiler makes you answer, but it cannot make you answer right. A slug that arrives in the
  query or the body is `"handler"`, and wrapped by hand with `withSpendAttribution`.
- **A new `AiJob` gets a row in `JOB_DISPOSITION`** ([`src/cost-categories.ts`](../../src/cost-categories.ts)),
  or its spend is shown in the `unknown` category. The compiler asks for this one too.

Then generate the mode once on a local article and open the metadata page: the mode's line should
be there.

**Its cache group.** If the mode's marked article block is byte-identical to the shared `articleText`
or `articleWithIds` prefix, add it to `ArticleStage`, then give it a row in `STAGE_EFFORT` and
`ARTICLE_RENDERER` ([`src/models.ts`](../../src/models.ts)); once it is in that union, the compiler
asks for both. Same effort and renderer mean one group. Choose them for what the mode writes, never
to join a group, and say in the row's comment which group that puts it in, or that it is alone. If its
bytes cannot share — Citations' whole-document rendering and Illustrated's fenced rendering are the
examples — leave it out of `ArticleStage` and say why there instead. Expect a group to save almost
nothing: modes are separate jobs, and an ordinary stage marks its article only when another group
member is in that same job. **If the mode makes several calls over one article itself**, it owns a
different shape: stagger them on `MeteredCall.onStart` as Simple does rather than firing them together
— [prompt-caching.md § What production actually does](prompt-caching.md#what-production-actually-does).
*[`tests/article-cache-group.test.ts`](../../tests/article-cache-group.test.ts), for the grouping;
nothing for the comment.*

## Retiring a mode

The checklist above read backwards, plus two things adding never needs. Outline was the first to go,
on 2026-09-10, when its nested list became Structure's narrow face
([260910g](../plans/260910g-structure-mode-subsumes-outline.md)):

1. **Take the word out of `MODES` and put it in `RETIRED_MODES`** ([`src/modes.ts`](../../src/modes.ts)),
   pointing at the mode that took it over, so links readers already have land somewhere.
   `modeFromParam` is the one place both the view and the tab title read it.
2. **Give the successor the retired name as an alias** in `MODE_CATALOG`, so a reader who types the
   old word in the command bar lands on the new mode, and rewrite any `description` or `how` —
   the successor's and its neighbours' — that named it.
3. **The compiler lists the totals**: every table in [§ The client](#the-client), and in tests
   `BAND_SAYS`, `SPENDS`, `DRAWS` and `GENERATES`.
4. **The suite lists the rest**, and only the suite: `visitor-gaps`' `ALWAYS_FREE` and gap walk,
   `page-title`'s `named`, `BEHIND_THE_SWITCH`, `last-view`'s mode list, `shared-inventory`'s
   `WIRE_ROW` (any wire key the retired mode owned — Outline had `arc` and `navLabelStatus`) and its
   always-shares list, the rewrite targets in `address-settling` and `public-read-rewrite`,
   `SILENT` in `every-mode-says-which-passages-it-marks`, and the band shapes in
   `mode-surface-changes-no-markup`.
5. **Any rewrite that produced the retired mode** now produces its successor (the `lift…` rewrites
   in `settleAddress`, [`src/web/router.ts`](../../src/web/router.ts) — [url-state.md](url-state.md)), and the mode's line in
   [reading-view-overview.md § The modes in the band](reading-view-overview.md#the-modes-in-the-band)
   says where it went.

**A retired word for a mode that is not a band does not go in `RETIRED_MODES`**, which maps only to
band modes (`BandMode`). Marginalia's old word, `annotations`, has to land on the `?margin=1` switch
instead, so it is translated there by `isMarginaliaModeWord` in [`src/modes.ts`](../../src/modes.ts),
which the Reader, the Dock's links and the remembered last view all ask —
[261001n](../plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md).

## Before you call it finished

The dock, the visitor's view, the exported bundle and the offline copy each have a test that
walks `MODES` or `STEP_ORDER`; if yours went green without a new row somewhere, one of the residue
items above is the reason — [silent-success.md](../reusable/silent-success.md).

**What a new mode makes red, measured rather than remembered.** Adding one word to `MODES` and
running `npm run typecheck` gives exactly six source errors and one test error — no more, and the
list is the checklist above with a compiler behind it. Measured 2026-09-06, on
[260906c](../plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md)
§ Stage 4b:

| Red | What it is asking for |
|---|---|
| [`src/title-text.ts`](../../src/title-text.ts) § `MODE_LABEL` | the word a person sees |
| [`src/messages.ts`](../../src/messages.ts) § `OWNER_MODE_NOTE` | the owner's one-line note |
| [`src/web/Dock.tsx`](../../src/web/Dock.tsx) § `ModesMissingFromDock` | a row in the bar, with `experimental:` decided |
| [`src/web/visitor.ts`](../../src/web/visitor.ts) § `POLICY` | what a visitor may see |
| [`src/web/reader/Reader.tsx`](../../src/web/reader/Reader.tsx) § `modeBand()` | the band, or an explicit `null` |
| [`src/web/reader/passages.ts`](../../src/web/reader/passages.ts) § `selectPassages` | the passage slot, or `NO_FOUND` |
| [`tests/public-network-trace.test.tsx`](../../tests/public-network-trace.test.tsx) § `BAND_SAYS` | what a visitor's band says, asserted against the network |

**Re-measured 2026-09-07, adding `structure`: seven source errors and four test errors.** The list
above is unchanged and still complete for `src/`; what moved is the test half, because two tables
written since have the same shape and the same purpose:

| Also red | What it is asking for |
|---|---|
| [`tests/every-mode-draws-its-surface.test.tsx`](../../tests/every-mode-draws-its-surface.test.tsx) § `SPENDS` **and** § `DRAWS` | two errors, not one — what the press buys, and what the band draws |
| [`tests/command-bar.test.tsx`](../../tests/command-bar.test.tsx) § `GENERATES` | whether the bar marks the row `generates`, checked against `MODE_TARGET` from the other side |
| [`tests/voices-css.test.ts`](../../tests/voices-css.test.ts) § `VOICES_BY_MODE` | which of the band's text uses the AI voice under [fonts.md](fonts.md)'s provenance rule (added 2026-10-02, not in either measurement) |

That is the mechanism working rather than drifting: each new table is an independently written
`Record<Mode, …>`, so every one of them adds a place a new mode has to be decided rather than
defaulted. **The count is the thing to re-measure, never the thing to trust** — it is a fact about
today's tables, not a rule, which is why it is written with its date each time.

**And four more tests go red that the typecheck cannot see**, because their tables are keyed on
`string` or written as a `case` list rather than as a `Record<Mode, …>`. Running the suite is the
only way to find them, so run it before believing the compiler was the whole checklist:

| Also red, without a type error | What it is asking for |
|---|---|
| [`tests/visitor-gaps.test.ts`](../../tests/visitor-gaps.test.ts) § `ALWAYS_FREE` **and** the gap walk | two failures — whether a visitor is short of anything, said twice from two directions |
| [`tests/page-title.test.ts`](../../tests/page-title.test.ts) § `named` | the word the tab says, checked against `MODE_LABEL` from the other side |
| [`tests/styles-entry-is-imports-only.test.ts`](../../tests/styles-entry-is-imports-only.test.ts) § `MANIFEST` | **where in the cascade the mode's stylesheet loads**, if it has one. The order *is* the cascade, so a new sheet has to say where it goes and what it sits between |

One test also goes red without the typecheck being run at all:
[`tests/every-mode-says-which-passages-it-marks.test.ts`](../../tests/every-mode-says-which-passages-it-marks.test.ts)
walks `MODES` and requires the new mode to be named a producer or a non-producer — which is the
guard against the cheap wrong fix, quietly adding it to the `NO_FOUND` arm to make the compiler
stop.

**Since 2026-10-02 the Help page asks too**, with two more `Record<Mode, …>` tables in
`src/web/help/`: the mode's own section (when to use it, how to read it) and its row in *Which mode
when*. Write them for a reader, not a developer — [help-page.md](help-page.md). Retiring a mode keeps
its `#mode-…` link working on its own, through `RETIRED_MODES`.

---

Up: [reading-view-overview.md](reading-view-overview.md)
