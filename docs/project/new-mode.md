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

## The client

**The vocabulary is `MODES` in [`src/modes.ts`](../../src/modes.ts), and the compiler asks for the
rest.** A fifteenth word there is red until it has a row in each of these totals:

| Table | Where |
|---|---|
| `MODE_LABEL` | [`src/title-text.ts`](../../src/title-text.ts) — the only place a mode is spelled for a person |
| `OWNER_MODE_NOTE` | [`src/messages.ts`](../../src/messages.ts) |
| `MODE_CATALOG` | [`src/mode-catalog.ts`](../../src/mode-catalog.ts) — **what the mode *is***: the **two sentences** on its bar-button card (`description` and `how` — see [§ The card on the button](#the-card-on-the-button), which is where the second one is written), the words they might type meaning it (`aliases`, which the command bar matches on), and whether it is still behind the experimental switch. A pure module importing only `modes.js`, so both runtimes can read it. All four fields are required, so a new mode means choosing its aliases and **deciding whether it is finished enough to draw for everybody** — [experimental-features.md](experimental-features.md). Say why in the table there either way; moving one later is [§ Moving a mode in or out of the switch](#moving-a-mode-in-or-out-of-the-switch). The `description` and `experimental` fields were on the `MODES_UI` row until 2026-09-07 ([260906h](../plans/260906h-mode-catalog-and-a-command-bar.md)); `how` arrived the same day ([260907b](../plans/260907b-rich-tooltips-on-the-dock-modes.md)) |
| `MODES_UI`, via `ModesMissingFromDock` | [`src/web/Dock.tsx`](../../src/web/Dock.tsx) — an ordered array, because the order is Greg's; the type check stands in for the `Record`. **Layout only** since 2026-09-07: the row is `{ mode, icon, keepLabel? }`, the icon being a React component and `keepLabel` a fact about the bar's fit ladder |
| `POLICY` | [`src/web/visitor.ts`](../../src/web/visitor.ts) — what a visitor may see; there is no fall-through any more, a missing row is a typecheck error |
| `BAND_SAYS` | [`tests/public-network-trace.test.tsx`](../../tests/public-network-trace.test.tsx) — what a **visitor** is shown |
| `MODE_TARGET` | [`src/web/activation.ts`](../../src/web/activation.ts) — **whether pressing it spends money.** Total since 2026-09-06, over a tagged union: `fixed` carries the target, `delegated` carries **an arming function** (Diagram, whose target is whatever `?diagram=` says), `none` carries the reason in a sentence. A `delegated` row holding a *name* rather than a function was the first draft and GPT Sol refused it — nothing consumes a string, so a mode could claim delegation with no arming path anywhere |
| `SPENDS` and `DRAWS` | [`tests/every-mode-draws-its-surface.test.tsx`](../../tests/every-mode-draws-its-surface.test.tsx) — what an **owner's** press buys, and what the band actually draws. Both independently written, never derived from the tables above. `DRAWS` is total over `Mode` with no exclusions — a mode that draws no band says so as a `kind: "none"` row **carrying the positive control**, what is on screen instead. It was keyed `Exclude<Mode, NO_BAND_MODES>` until GPT Sol's F21 on 2026-09-06, and that one list both excused a mode from the table and skipped it at run time, so a mode added to it was checked by nothing |
| `modeBand()`'s `switch` | [`src/web/reader/Reader.tsx`](../../src/web/reader/Reader.tsx) — **which band the mode opens**, and it is a `switch` with a `never` default rather than a `Record`, because each arm is JSX with its own gates. A mode with no arm is a compile error; a mode that deliberately has no band says `return null` in its own case, as `plain` and `hierarchy` do. (It was `band()` until 2026-09-11; `band()` is now the one line that puts its answer inside the boundary below) |
| `MODE_CONTAINMENT` | [`src/web/reader/ModeBoundary.tsx`](../../src/web/reader/ModeBoundary.tsx) — **whether the band may break on its own**, without taking the article. `contained` is the answer for any mode with a band; the boundary is already at the call site. `exempt` needs a reason and a matching change to `EXEMPT` in [`tests/a-broken-mode-leaves-the-article-readable.test.tsx`](../../tests/a-broken-mode-leaves-the-article-readable.test.tsx). Give `WITNESS` an entry for each composition path the mode can draw: the owner's band, a distinct available visitor band, and `VisitorBand` when `visitorGap` can put it in the slot. Each names a `useRenderCount` label whose injected throw proves the component is really inside. If a press or a chip inside your band arms a token, add it to `bandTarget` in `activation.ts` so a band that throws before claiming it retires it ([web-client.md § A mode that breaks](web-client.md#a-mode-that-breaks-does-not-take-the-article-with-it)) |
| `selectPassages` | [`src/web/reader/passages.ts`](../../src/web/reader/passages.ts) — **which passage slot the ring, the paragraph bar and the rail are drawn from.** Same `never` default. A mode with no passage producer answers `NO_FOUND` explicitly; nine do. The **prose marks** are one step further on: `proseFound`, in the same file, adds the quotes, which are marked in every mode ([quotes.md](quotes.md)) — so a new mode gets those whether it asks or not, and must not add them to the other three |

Then the residue, which is why this page exists:

- ~~**The band branch**~~ — **it left this list on 2026-09-06.** It was seventeen sibling
  `{mode === "…" && <Band/>}` expressions that nothing checked, so a mode with no branch opened an
  empty band and errored nowhere; it is now the `modeBand()` switch in the table above, and so is the
  passage selection beside it. Both are compiler-checked, and what a fifteenth mode makes red is
  written out below.
- **The mode's URL params**, [`params.ts`](../../src/web/params.ts) — [url-state.md](url-state.md).
  *Nothing.*
- **A resolver in [`search-hits.ts`](../../src/web/search-hits.ts)** if the mode marks passages;
  `Found` is the one currency. *Nothing.*
- **A read hook** shaped like [`useIdeas.ts`](../../src/web/useIdeas.ts) — ordering from
  [`useOrderedRead.ts`](../../src/web/useOrderedRead.ts), the job from
  [`useStepJob.ts`](../../src/web/useStepJob.ts), rather than a ninth copy of either. *Nothing.*
- **Opening it for the first time starts it.** A mode the reader opens with nothing in it generates
  it, rather than offering a button and waiting — so a new artefact-backed mode wants a name in
  [`auto-run-targets.ts`](../../src/web/auto-run-targets.ts) and `useAutoRun` in its hook, called
  with the **unforced** verb. The traps, and the one mode deliberately left out, are
  [260906b](../plans/260906b-opening-a-mode-starts-it-generating.md).
  *[`tests/modes-that-start-themselves.test.tsx`](../../tests/modes-that-start-themselves.test.tsx)
  for the modes already in it, and since 2026-09-06
  [`tests/every-mode-draws-its-surface.test.tsx`](../../tests/every-mode-draws-its-surface.test.tsx)
  § `SPENDS` for a new one — an independently written table of what each press buys.*
- **The band itself**: render it with
  [`ModeSurface`](../../src/web/ModeSurface.tsx), which owns the `<aside class="mode-band">`, its
  **required** `aria-label`, the optional `head` and `foot` slots, and nothing else. Do not
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
- **`CACHEABLE`** in [`lib/api.ts`](../../src/web/lib/api.ts), if the mode has a GET.
  *[`tests/cacheable-covers-artefact-routes.test.ts`](../../tests/cacheable-covers-artefact-routes.test.ts)*,
  which derives the list rather than repeating it.
- **The dock's mode page**, and the mode's line in
  [reading-view-overview.md § The modes in the band](reading-view-overview.md#the-modes-in-the-band)
  with the doc that owns it. *[`tests/doc-links.test.ts`](../../tests/doc-links.test.ts), for the
  doc; nothing for the line.*

A mode that shows nothing generated — Plain, Hierarchy, Search — stops here.

## The card on the button

Both halves of the card are `MODE_CATALOG` fields, so the compiler asks for them; what it cannot ask
for is that the second one is worth reading. The rule is
[tooltips.md § `ControlTip`](tooltips.md#controltip-which-is-what-most-of-them-are-now):

> The first sentence is what a reader could have guessed by pressing the control; the second is what
> they could not — where the answer comes from, what it costs, or what the control does *not*
> promise.

So `description` is the mode in one fragment — it is also what the command bar draws inline beside
the name, which is why it stays short — and `how` is the half a press would not have told them. For
these fourteen that is almost always one of three things: **it reads something already built**
(Hierarchy, Structure, Summary), **its content is a model pass over the article, written once and
stored** (Glossary, Ideas, Quotes, Timeline, Debate and Diagram's Sketch — the six a press on the
reading view can start paying for, `MODE_TARGET` in [`activation.ts`](../../src/web/activation.ts)),
or **it waits on the reader's own words** (Search, Chat, Referee, Remember). Plain is the fourteenth
and generates nothing at all.

Five things to get right, and the first is the one that cost this field a whole review round:

- **Write about the mode, not about pressing the button.** The same string is read on four surfaces
  at least — the segment on the reading view, the loose links on the metadata and tweets pages
  (which navigate and arm *nothing*), and either of those seen by a visitor, who gets an explanatory
  band rather than a generator. So *"opening it runs a model pass"* is false on three of the four.
  Four of the fourteen opened that way in first draft and every one was caught by a cross-family
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
  first draft, and two of the fourteen here were thrown away for the same reason
  ([260907b](../plans/260907b-rich-tooltips-on-the-dock-modes.md) has both, and the table of where
  each claim was checked). The restatement check can see a card arguing with itself and cannot see
  one arguing with the code.

*[`tests/dock-mode-tooltips.test.tsx`](../../tests/dock-mode-tooltips.test.tsx) — that both exist,
that the second is not a copy of the first, that no price crept in, and that every mode's card opens
in **both** arms of the bar: the segment on the reading view, and the loose links on the metadata and
tweets pages, which are a different component and were the arm left carrying a `title` attribute.*

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
without naming a server module, and which `pipeline.ts` re-exports; `TASK_TIER`, `TASK_WIRE`, `MODEL_ENV_VAR`,
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
- **`PUBLIC_PROJECTIONS` and the public DTO**, if a visitor may read it:
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
- **Pressing the control that opens it — a mode button, a sub-mode chip, the Tweets link — runs the
  job when there is nothing there**; arriving does not —
  [`useAutoRun.ts`](../../src/web/useAutoRun.ts) is the whole rule, and
  [reading-view-overview.md § True across the whole view](reading-view-overview.md#true-across-the-whole-view)
  is why. *Nothing.*
- **`PROMPT_VERSION`, bumped, whenever you change what the prompt asks for** — the
  stamp says which prompt wrote the artefact, and an unchanged one makes every
  stored artefact claim it was written by the prompt that ships. Where the stage
  also has an `outdated` comparison ([`pg.ts`](../../src/store/pg.ts)) the bump
  surfaces in the panel. `hierarchy`'s
  is a stamp and nothing more; `labels`' has no comparison either but is inside
  `batchFingerprint`, so it invalidates checkpoint reuse. Check the version is
  *one* constant before you bump it: `sketch` had two literal
  copies in two files until 2026-09-03 — `SKETCH_VERSION`, which is what gets
  stamped, and `PROMPT_VERSION`, which is what gets compared — so bumping either
  alone marked every sketch outdated including one generated a second later.
  *Nothing.*

## The words the mode puts in front of the reader

Whatever a mode generates for the reader — a gist, a label, an answer, a question,
a caption — is written to the same rule, and a new one takes it too:

> Make minimal tweaks to the prompts … to use slightly plainer/simpler/easier-to-
> understand language, while still trying to stay close to the language of the text.
>
> — Greg, 2026-09-03

Two halves, and the second is what stops the first turning into paraphrase: **the
article's own words for the things the article names** — those are the reader's
handholds, and what they meet again on the page — and **ordinary words for
everything else**. It is not a licence to flatten. A mode that swaps the author's
distinctive word for a common synonym has taken something from the reader, which is
[vision.md](vision.md)'s whole objection to summaries.

Every prompt that carries it ends on the same phrase, **"plainer than the article,
never further from it"**, so `grep -rni "lainer than the article" src/` is the list
of prompts that have it. Put it where the prompt already talks about how to write
rather than opening a section for it, and cover each field the model actually
writes: [`src/hierarchy.ts`](../../src/hierarchy.ts) says it under both TITLES and
GISTS, [`src/quotes.ts`](../../src/quotes.ts) only on `reason` because `text` is
copied verbatim.

Two kinds of prompt deliberately do **not** have it.
[`search.ts`](../../src/search.ts) already asks for its one written sentence "in
plain words", and the four referee prompts ([`referee-candidates-prompt.ts`](../../src/referee-candidates-prompt.ts),
[`referee-claims-run.ts`](../../src/referee-claims-run.ts),
[`referee-mirror.ts`](../../src/referee-mirror.ts),
[`referee-criteria-run.ts`](../../src/referee-criteria-run.ts)) are written for a
peer reviewer reading in their own field — [referee-mode.md](referee-mode.md).

Watch for the rule fighting one already there. Chat and Remember may bring in what
they found on the web, so neither may be told to use "no term the piece did not
use" — that clause was written and then cut for exactly this reason.

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
5. **Any rewrite that produced the retired mode** now produces its successor (`liftStrandedText`, in
   [url-state.md](url-state.md)), and the mode's line in
   [reading-view-overview.md § The modes in the band](reading-view-overview.md#the-modes-in-the-band)
   says where it went.

## Before you call it finished

The dock, the visitor's view, the exported bundle and the offline copy each have a test that
walks `MODES` or `STEP_ORDER`; if yours went green without a new row somewhere, one of the residue
items above is the reason — [silent-success.md](../reusable/silent-success.md).

**What a fifteenth mode makes red, measured rather than remembered.** Adding one word to `MODES` and
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
| [`src/web/reader/Reader.tsx`](../../src/web/reader/Reader.tsx) § `band()` | the band, or an explicit `null` |
| [`src/web/reader/passages.ts`](../../src/web/reader/passages.ts) § `selectPassages` | the passage slot, or `NO_FOUND` |
| [`tests/public-network-trace.test.tsx`](../../tests/public-network-trace.test.tsx) § `BAND_SAYS` | what a visitor's band says, asserted against the network |

**Re-measured 2026-09-07, adding `structure`: seven source errors and four test errors.** The list
above is unchanged and still complete for `src/`; what moved is the test half, because two tables
written since have the same shape and the same purpose:

| Also red | What it is asking for |
|---|---|
| [`tests/every-mode-draws-its-surface.test.tsx`](../../tests/every-mode-draws-its-surface.test.tsx) § `SPENDS` **and** § `DRAWS` | two errors, not one — what the press buys, and what the band draws |
| [`tests/command-bar.test.tsx`](../../tests/command-bar.test.tsx) § `GENERATES` | whether the bar marks the row `generates`, checked against `MODE_TARGET` from the other side |

That is the mechanism working rather than drifting: each new table is an independently written
`Record<Mode, …>`, so every one of them adds a place a fifteenth mode has to be decided rather than
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

---

Up: [reading-view-overview.md](reading-view-overview.md)
