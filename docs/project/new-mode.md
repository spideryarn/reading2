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
| `MODES_UI`, via `ModesMissingFromDock` | [`src/web/Dock.tsx`](../../src/web/Dock.tsx) — an ordered array, because the order is Greg's; the type check stands in for the `Record`. **The row carries a required `experimental: boolean`**, so adding a mode means deciding whether it is finished enough to draw for everybody — [experimental-features.md](experimental-features.md). Say why in the table there either way |
| `POLICY` | [`src/web/visitor.ts`](../../src/web/visitor.ts) — what a visitor may see; there is no fall-through any more, a missing row is a typecheck error |
| `BAND_SAYS` | [`tests/public-network-trace.test.tsx`](../../tests/public-network-trace.test.tsx) |

Then the residue, which is why this page exists:

- **The band branch**: the `mode === "…"` if-chain near the bottom of `Reader` in
  [`App.tsx`](../../src/web/App.tsx), whose own header comment records why it is still a chain and
  not a table. *Nothing; this list.*
- **The mode's URL params**, [`params.ts`](../../src/web/params.ts) — [url-state.md](url-state.md).
  *Nothing.*
- **A resolver in [`search-hits.ts`](../../src/web/search-hits.ts)** if the mode marks passages;
  `Found` is the one currency. *Nothing.*
- **A read hook** shaped like [`useIdeas.ts`](../../src/web/useIdeas.ts) — ordering from
  [`useOrderedRead.ts`](../../src/web/useOrderedRead.ts), the job from
  [`useStepJob.ts`](../../src/web/useStepJob.ts), rather than a ninth copy of either. *Nothing.*
- **Opening it for the first time starts it.** A mode the reader opens with nothing in it generates
  it, rather than offering a button and waiting — so a new artefact-backed mode wants a name in
  [`auto-run-targets.ts`](../../src/web/auto-run-targets.ts), a row in `MODE_TARGET`
  ([`activation.ts`](../../src/web/activation.ts)), and `useAutoRun` in its hook, called with the
  **unforced** verb. The traps, and the one mode deliberately left out, are
  [260906b](../plans/260906b-opening-a-mode-starts-it-generating.md).
  *[`tests/modes-that-start-themselves.test.tsx`](../../tests/modes-that-start-themselves.test.tsx)
  for the modes already in it; nothing for a new one.*
- **The band's chrome**: the scroller is documented in
  [`styles.css`](../../src/web/styles.css) § mode band. A `.band-head` title row is **optional, and
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

## Before you call it finished

The dock, the visitor's view, the exported bundle and the offline copy each have a test that
walks `MODES` or `STEP_ORDER`; if yours went green without a new row somewhere, one of the residue
items above is the reason — [silent-success.md](../reusable/silent-success.md).

---

Up: [reading-view-overview.md](reading-view-overview.md)
