# Adding a mode: the recurring edits, and how to make them one

An [improve-the-codebase.md](../reusable/improve-the-codebase.md) sweep with a target: what it
costs to add a **mode** to the reader, and what would make the next one cheaper, safer and more
consistent. Greg, 2026-09-02:

> We keep adding new modes because we're experimenting with what feels good. We want to make it
> easy/consistent/robust/reusable to add new modes.
>
> P.S. Along the way, you may notice ways in which our current implementation of modes could be
> improved/tidied up — that's definitely also in scope!

The test every finding is put to is the one the sweep doc gives: **what would the next editor
have had to find, and what would have told them?** A type the compiler checks beats a test, which
beats a doc that says "also update".

## The finding one level up

**The approach is sound.** Modes are one closed vocabulary ([`src/modes.ts`](../../src/modes.ts)),
and where the repo has already put a per-mode fact in a *total* `Record<Mode, …>` — the title
label, the owner's note, the visitor sweep in `public-network-trace` — a fourteenth mode is a red
compiler. The shared halves that exist (`useStepJob`, `JobProgress`, `Found` as the one currency
in `search-hits.ts`, the fail-closed `visitorGap`, `shared-inventory` walking `MODES`) are the
right shape, and three of them exist *because* an earlier sweep found the copies.

What is not sound is that the discipline stopped partway. Four client sites and about five
store sites still hold a per-mode fact in a shape the compiler cannot check — an array, a
`Partial`, a `Pick` behind a cast, an if-chain — and the two real incidents on record
([a0859a4](../../src/web/visitor.ts) — referee fell through the visitor table for two days;
[260830c](../postmortems/260830c-the-dialog-said-nothing-was-personalised.md) — a hand-kept list
fell behind a growing set) are both that shape. So the work is **not a registry**. It is finishing
the move to total tables where the invariant already lives, and deleting the copies that a total
table makes unnecessary.

**A universal mode registry was already weighed and refused**, and this plan does not reopen it:
[260831am-reader-authored-modes-generative-ui.md](260831am-reader-authored-modes-generative-ui.md)
and Sol's review found that Ideas, Quotes and Timeline each carry editorial policy a generic
`ModeDef` would flatten into "the silhouette of the mode, not the mode". The same goes for a
`makeArtefactStage()` factory over the six generator modules, a generic `/api/artefact/:kind`
route (each per-kind route carries a different staleness contract), and a sixteen-prop
`<ModeBands>` component, which Greg's team lead refused on 2026-08-28
([`src/web/App.tsx`](../../src/web/App.tsx) § A known follow-up). Each is named under
*Rejected* below so the next sweep's search finds it.

## Scope

- **Swept:** `src/` (all), `tests/` (all), `docs/project/`, `docs/plans/` (the mode plans and the
  simplification waves), `docs/postmortems/` (26 files grepped, two on topic). Four subagents:
  one lens (every enumeration of modes), three zones (App.tsx and the panels; the store and
  routes; prior plans and tests). Counts below were re-run by the orchestrator against the tree at
  `1c6ac09` and then after merging `origin/dev` at `2eecca08`.
- **Excluded:** `scripts/`, `api/`, `evals/` — grepped, no real hits (`livemode`, `ssl.mode`,
  columns literally named `quotes` are the false positives). The panel bodies of Chat, Diagram,
  Search and Glossary were not read end to end.
- **Blind to:** anything that exists only at runtime. The one race in this plan (T2.1) comes from
  Sol's 2026-08-28 reasoning, not from a reproduction; the plan asks for one before the fix.

## What adding a mode touches today

Measured from the four mode commits of 2026-08-31 (`2280ee2` plain, `3d71c4e` referee,
`e5fefee` quotes, `70d2321` timeline), then checked against today's tree. **Client side, for a
simple artefact-showing mode like Quotes: 11 files, two of them new.**

| File | What | What tells the author today |
|---|---|---|
| `src/modes.ts` | the word in `MODES` | it is the entry point |
| `src/title-text.ts` | `MODE_LABEL` row | **compiler** — total `Record<Mode,…>` |
| `src/messages.ts` | `OWNER_MODE_NOTE` row | **compiler** |
| `src/web/Dock.tsx` | `MODES_UI` row: icon, label, blurb, position | nothing until `tests/public-network-trace.test.tsx` pairs the buttons with `MODES` |
| `src/web/visitor.ts` | a row in `ARTEFACT` or `COSTS` | nothing at compile time; the fail-closed default plus `tests/visitor-gaps.test.ts` |
| `src/web/App.tsx` | a branch in the band if-chain, a `Found[]` state, two ternary arms | nothing |
| `src/web/params.ts` | the mode's URL params | nothing |
| `src/web/search-hits.ts` | a resolver | nothing |
| `src/web/styles.css` | `-head`, `-head-icon`, `-head h2`, the scroller | nothing |
| `src/web/public-artefacts.ts`, `Metadata.tsx` | two lines each | nothing |
| new `XPanel.tsx`, `useX.ts` | | copy the nearest sibling |

Plus, for a mode backed by a generated artefact, **19 server and store files** (24 if a visitor may
read it), of which the store zone counted about nine with no compiler backstop. Those are listed
under T1.5–T1.9.

**The counts, shown.** `grep -cE 'mode [!=]== "' src/web/App.tsx` → 33 (25 distinct branch
sites: 14 band-render, 3 layout, 2 data hooks, 2 prose-mark ternary chains, 1 overlay, 2 referee,
1 mode-entry effect). `grep -rn 'className="mode-band' src/web | wc -l` → 14 asides.
`grep -rl 'was === "loading" ? "error" : was' src/web` → 7 hooks (`useArc`, `useGlossary`,
`useIdeas`, `useQuiz`, `useQuotes`, `useSketch`, `useTimeline`). `grep -cE 'inFlight|generation\b|trailing'`
→ `useGlossary` 40, every other hook 0 or 1 (a comment). Five `.x-head` families at
`styles.css` (`gloss`, `srch`, `summ`, `diag`, `quotes`), plus `chat-head`.

## Findings

Evidence state on each: **reproduced**, **proved from the code**, or **hypothesis**. Tier is
separate.

### Tier 0 — live defects tripped over on the way

- **T0.1 `CACHEABLE` has fallen behind the routes.** *Proved from the code.*
  [`src/web/lib/api.ts`](../../src/web/lib/api.ts) § `CACHEABLE` lists `/api/glossary/`,
  `/api/ideas/`, `/api/quotes/` and not `/api/timeline/`, `/api/quiz/`, `/api/sketch/`, each of
  which has its own GET route and hook. Its docstring says what is left out is deliberate and
  names three omissions; these three are not among them. So the offline store Greg asked for —
  *"stuff that has already been computed … survive losing the connection"* — keeps quotes and
  drops a timeline. Quotes was added the same week timeline was. Nothing tests the list.
- **T0.2 Referee's cleanup clears half the passage contract.** *Proved from the code.* The
  five-effect contract that `useIdeasMode` and `TimelineBand` follow (on unmount: `onFound([])`
  **and** `onOpenKey(null)`) is only half-copied in `CriteriaPanel`'s cleanup, which clears
  `onFound` and leaves `openRefereeKey` set after leaving Referee. Recoverable on re-entry, but it
  is exactly the divergence the comment above `useIdeasMode` warns about: *"a fix to one of these
  belongs in both."* Since that comment, referee became a third partial copy. Red test first.
- **T0.3 The entry-point doc miscounts the modes.**
  [reading-view-overview.md](../project/reading-view-overview.md) line 8 says "two of the ten
  modes"; there are thirteen, and `web-client.md` says thirteen. Fix in passing.

### Tier 1 — cheap, mechanical, evidence in hand

**Client**

- **T1.1 `MODES_UI` is an array the compiler cannot check against `MODES`.** *Proved.*
  [`src/web/Dock.tsx`](../../src/web/Dock.tsx) § `MODES_UI` is `{ mode: Mode; … }[]`; add a
  mode and forget the row and it compiles. The only pairing is a runtime assertion in a
  *visitor-trace* test. Its position is Greg's by hand and must stay an ordered list, so the fix
  is not a `Record`: keep the array and add a compile-time exhaustiveness check
  (`Exclude<Mode, (typeof MODES_UI)[number]["mode"]>` must be `never`, and the duplicate check
  the other way), which is a few lines and no runtime. The test's *pressing* half stays; its
  membership half becomes redundant and can go.
- **T1.2 The mode's label lives in three places.** *Proved.* `MODE_LABEL` in
  [`src/title-text.ts`](../../src/title-text.ts) (total, compiler-checked), `MODES_UI[].label` in
  `Dock.tsx` (all thirteen pairs match today), and the controls bar in `App.tsx`, which renders
  the raw mode id and uppercases it in CSS — rename "Referee" to "Reviewer" in both tables and the
  bar still says `REFEREE`. `src/modes.ts` names the two-copy problem in prose already. Fix:
  Dock and the controls bar read `MODE_LABEL`; the `label` field leaves `MODES_UI`. `title-text.ts`
  imports nothing under `src/web/`, so Dock may import it.
- **T1.3 `ARTEFACT` and `COSTS` in `visitor.ts` are `Partial`.** *Reproduced — by history.* The
  referee fall-through of 2026-08-31 to 2026-09-02 is this table's own comment. Fix: one total
  `Record<Mode, VisitorPolicy>` with an explicit variant for each of the four cases the function
  already distinguishes (free, spends-as-owner with its button name, needs-artefact with its key,
  and the four modes drawn from the payload). The if-chain and the "not reachable today"
  fall-through are deleted, not moved. `tests/visitor-gaps.test.ts` keeps sweeping `MODES`; the
  "sentence carries its own id" assertion becomes unnecessary and can go with the fall-through.
- **T1.4 Five copies of the band head in CSS, two of them drifted.** *Proved.* `.gloss-head`,
  `.srch-head`, `.summ-head`, `.diag-head`, `.quotes-head` and their `h2` and `-icon` rules are
  byte-identical except: `.summ-head` alone has `flex: none`; `.diag-head h2` alone has the
  ellipsis rules, with a comment saying the one-word-heading assumption *"would stop being true the
  moment the heading became two words"* — the four other heads still carry that assumption, and
  `.gloss-head` is shared by Ideas, Timeline, Quiz and Referee. Fix: one `.band-head` family
  (taking the ellipsis rule for all, since it is the robust one), the five class names retired
  from the panels. A browser pass, in a Sonnet subagent, on every band before and after.

**Store and pipeline** (the artefact-backed half of a mode)

- **T1.5 `STAMP_SOURCE` is `Partial`, and a missing row costs money for ever.** *Proved, in its
  own words.* [`src/store/artifacts.ts`](../../src/store/artifacts.ts) § `STAMP_SOURCE`: *"Missing
  here means `stampFor` answers `null` silently, so the step is never current and re-runs on every
  job for ever."* Fix: total over the artefact-producing steps, with the key derived the way
  `ProfileCarrying` already is, so a new step is red here.
- **T1.6 `pgArticleReader` is a `Pick` cast to `ArticleReader`.** *Proved.*
  [`src/store/index.ts`](../../src/store/index.ts) casts; a missing Postgres loader is a boot-time
  `TypeError` instead of a typecheck error. This is the shape of postmortem
  [260901e](../postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md).
  Fix: declare it `ArticleReader` (or `satisfies`), delete the cast and the hand-kept union of
  method names.
- **T1.7 `REVISION_READ_POLICY`'s inner record is `Partial`.** *Reproduced — by history.*
  [`src/store/pg.ts`](../../src/store/pg.ts) records that `quotes` landed with the projection and
  the read policy "had not caught up", found by `tests/store-revision-columns.test.ts`. Fix: the
  inner record total over `RevisionReader`, with an explicit `null` for "this reader does not
  read this column".
- **T1.8 `STEP_ORDER` is a plain array over `StepName`.** *Proved.* `tests/db-step-constraint`
  reads it as the source of truth for the SQL CHECK, so an omission there is an omission in the
  constraint. Fix: a one-line exhaustiveness check like T1.1.
- **T1.9 Generator-module drift, two small.** *Proved.* `quotes.isStale` takes
  `blocks: BlockFingerprint[]` where the other five take `readonly`; `glossary.ts` alone has no
  `inputFingerprint` export and is special-cased in the pipeline and both stores for it. Fix: the
  `readonly`; give glossary the export and delete the special cases if that is all they are —
  check first that the special-casing is only that.

### Tier 2 — extractions worth doing, each with a test before it

- **T2.1 The same-slug race, and the guard that lives in one hook of seven.** *Hypothesis, argued
  reachable by Sol on 2026-08-28.* `useGlossary` orders reads on one slug with
  generation / one-in-flight / trailing; `useIdeas`, `useQuotes`, `useTimeline`, `useQuiz`,
  `useArc`, `useSketch` do not. The sequence: open a mode while a job for that article is already
  running, the opening GET reads the old artefact, the completion GET lands first, the opening GET
  lands last and overwrites it permanently. This was planned as
  [260828aj § 2.6](260828aj-simplification-wave-2.md), reviewed, narrowed — *extract only the
  mechanism glossary proves, leave parsing, 404s and error prose per hook* — scheduled last, never
  built, and two more copies have arrived since. The test shape is written down there: hold the
  opening reply, change the fixture, finish the job before settling the opening read, settle
  newest-first, and **the control must name the stale value**. Red first; if it cannot be made
  red, that is the finding and the extraction does not happen.
- **T2.2 `usePassageMode`: the five-effect contract, shared by four callers with one proved
  divergence (T0.2).** *Proved.* Ideas, Timeline, Referee (partial) and Quotes (partial) each
  wire `found`/`openKey`/`onFound`/`onOpenKey`/jump through the same five effects, and `App.tsx`
  says the merge *"is the right shape and is a follow-up worth doing on a quiet file."* One hook,
  four callers, opposite ratio to the refused `<ModeBands>`. This is what actually shrinks
  `App.tsx`: the five `Found[]` states and the two five-arm ternary chains are O(modes) today.
  After T2.1, since both touch the same panels.

### Tier 3 — named and sized, not started

- **T3.1 The band dispatch in `App.tsx`.** Fourteen `mode === "…"` band branches and no
  exhaustiveness. The refused shape is the sixteen-prop component. A shape not yet weighed: after
  T2.2, a `Record<Mode, BandSpec | null>` where `null` is "opens no band" (plain, hierarchy) —
  compiler-total, and it would make "does this mode open a band" a fact in one place rather than
  a boolean derived in three (`inMode`, `bandOpen`, `plainCols`). Worth asking Sol whether the
  props problem survives T2.2. Its own job, its own plan.
- **T3.2 Making a mode public-readable is a fifth hand-written table away.** The timeline
  comment in `visitor.ts` records Greg wanting the option, and that it *"wants a general answer for
  all the modes rather than a fifth hand-written table."* T1.3 makes the table total; it does not
  make the policy configurable. Product call, not this sweep's.
- **T3.3 A "how to add a mode" section.** The fallback answer, after the compiler ones. When
  T1 lands, the residue of sites nothing checks is short enough to list: the band branch, the
  params, the search-hits resolver, the CSS scroller, the SQL CHECK and migration, the `export.ts`
  put-chain, `PUBLIC_PROJECTIONS`. It goes in `web-client.md` (client) and `architecture.md`
  § Conventions (artefact), pointing at `MODES` and `ArtifactKind` as the two entry points — a
  signpost, not a checklist to keep in step. Done in the last stage of this run, once the residue
  is known.

### Rejected, and why — so the next sweep's search finds it

- **A mode registry / `ModeDef` / `src/mode-registry.ts`.** Refused in 260831am; the facts are
  different in kind (a SQL column, a prompt effort, a noun) and one table would be a bag of
  optionals read by fifteen callers — a wider interface, not a smaller one.
- **`<ModeBands>` with sixteen props.** Refused 2026-08-28; one caller, one implementation.
- **A `makeArtefactStage()` factory or base class over the generators.** The shared part is one
  line of `isStale`; `renderPrompt` and `generateX` differ substantively.
- **A generic `/api/artefact/:kind` route.** Would need a per-kind staleness table, which is the
  registry again.
- **A shared `<Band>` React component for the chrome.** The duplication is measurably in the
  stylesheet; a class collapses it with no prop plumbing (T1.4). The React wrapper buys nothing
  the class does not.
- **Making `MODES_UI` a `Record`.** Loses the order, which is Greg's; the exhaustiveness check
  gives the compiler guarantee without changing the shape.
- **Deriving the test fixtures `HOMES` and `OWNED`.** Deliberately literal; the postmortem says
  why.

## Stages

Each stage ends green, committed and pushed, with this doc updated and a GPT Sol review. Stages
with non-overlapping file sets run in parallel.

- [x] **Plan.** This doc, reviewed by Sol before anything is built.
- [ ] **Stage A — the client tables (T0.1, T0.2, T0.3, T1.1, T1.2, T1.3).** Files: `Dock.tsx`,
  `App.tsx` (controls bar only), `title-text.ts`, `visitor.ts`, `CriteriaPanel.tsx`, `lib/api.ts`,
  the tests that pin them, `reading-view-overview.md`. Red test first for T0.2 and T0.1
  (a test that `CACHEABLE` covers every per-kind GET route, derived from the route names rather
  than hand-listed). Done when: a mode added to `MODES` with no `MODES_UI` row and no visitor
  policy is a typecheck failure, and no label is spelled twice.
- [ ] **Stage B — the store totals (T1.5–T1.9).** Files: `src/store/artifacts.ts`, `index.ts`,
  `pg.ts`, `src/pipeline.ts`, `src/quotes.ts`, `src/glossary.ts` and whatever special-cases it.
  Parallel with A. Done when: a new `StepName` with no stamp source, a `pgArticleReader` missing a
  loader, and a reader missing from a read-policy row are each red at typecheck.
- [ ] **Stage C — the band head (T1.4).** Files: `styles.css` and the panels' class names. After
  A (both touch `App.tsx`). Browser pass on every band before and after, in a Sonnet subagent;
  done when the diff is one CSS family and eleven renames and the screenshots match.
- [ ] **Stage D — the read-hook guard (T2.1).** Files: the seven `use*.ts` hooks and a new
  helper beside `useStepJob.ts`. Parallel with C. Red test first, as specified; if it cannot go
  red, write that down and stop the stage.
- [ ] **Stage E — `usePassageMode` (T2.2).** After C and D. Characterise the current five effects
  in a test first; then extract without changing behaviour; then the referee fix from T0.2 is
  one line.
- [ ] **Stage F — the signpost (T3.3), and the debrief.** The residue list, in the two docs; this
  plan's status; what is left.

## Progress

- 2026-09-02: audit run, four subagents, counts re-verified; plan written; to Sol.
