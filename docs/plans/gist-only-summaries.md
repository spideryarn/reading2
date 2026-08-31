# Summary mode keeps the gists and loses the ladder

> In Summary mode, in Parts sub-mode, I can click on `+N sections` to expand. But in Article
> sub-mode, I can't click on `+N parts` to expand.
>
> Also, hide this `Only the one-sentence gists so far. Writing the longer two rungs is a few model
> calls over the whole article and takes a minute or two — done once and kept.` message as a tooltip
> on the "Write the summaries" button. P.S. Is that even correct? It showed that message even though
> I could see what looked like a nice 3-level set of Summaries... Or maybe this is related to the
> Length functionality?? Aha. I think we can get rid of the Length functionality. I think for now
> just keeping "Gist" only is sufficient.
>
> — Greg, 2026-08-31

and, asked how far "get rid of" goes — reader-facing removal, full removal, or only fix the message:

> Full removal.
>
> — Greg, 2026-08-31

So: **Summary mode stays and stage 5e goes.** The panel keeps the tree, the numbering, the Depth
cut-off, the per-node badges, the follow and the one-sentence gists that stage 4 already writes onto
every internal node. What leaves is the generated ladder — the `short` and `long` rungs, the Length
control, `summary.json`, `src/summarise.ts`, and everything downstream of them.

His P.S. is right, and answering it is worth a line because it is the whole reason this is
happening. The message was **correct and unreadable**. It fires on `owner.status === "none"`, which
means *no `summary.json`*, and it is talking about the two generated rungs. The "nice 3-level set of
Summaries" Greg was looking at is the **Depth** axis — article, parts, sections — drawn from
stage-4 gists, which cost nothing and are always there. Two axes, one of them free and one of them
paid, and a sentence about the paid one sitting under a panel full of the free one. Collapsing the
two axes into one is the fix he reached for himself.

## The simpler option passed over

**Keep the ladder and only fix the message** — move it into the button's `title` and stop it reading
as a verdict on the whole panel. That is a ten-line change and it was offered. Greg picked full
removal instead, and the reason to prefer his answer is that the ladder was never carrying its
weight: it is a paid stage whose cheapest rung is free and already on the tree, whose two paid rungs
share one control with a free axis that does a similar job, and whose absence is the state every
article is in until somebody spends. Deleting it takes a whole pipeline stage, a database column, a
route, an artefact kind and about a thousand lines out of the tree.

**Two rungs of the ladder are not being replaced by anything.** If a longer summary turns out to be
wanted later it comes back as a new stage; this document and
[summaries.md](../project/summaries.md)'s history are what it would be rebuilt from.

## What goes

Rough surface, in the order the work happens. The point of listing it is that a removal is never one
edit and the tendrils here reach the store, the public payload and half a dozen tests that use
`summary` as a convenient exemplar of "a step".

**The stage.** `src/summarise.ts` in full (1,180 lines), its `summary` entry in the pipeline's
`STEP_ORDER` / step table / artefact list (`src/pipeline.ts`), the `summarise` job kind in
`src/models.ts` (family, transport, effort), its timeout in `src/jobs.ts`, and the `summarise` script
in `package.json`.

**The artefact.** `summary.json` and the `summary` artefact kind: `src/store/artifacts.ts`,
`artifacts-fs.ts`, `artifacts-pg.ts`, `contracts.ts`, `fs.ts`, `index.ts`, `pg.ts`,
`pg-revisions.ts`, `import.ts`, `export.ts`, `public-reader.ts`. `Summaries`, `SummaryEntry`,
`SummariesResponse`, `SummariesFound` in `src/types.ts`; `PublicSummaries` and the `summary` field in
`src/public-types.ts` and `src/public/dto.ts`.

**The route.** `GET /api/summary/:slug` and `loadSummaries` in `src/api.ts` and `src/routes.ts`.

**The client.** `src/web/useSummaries.ts` in full; the `access` prop, the Length fieldset, the
`missing` line, the profile tick, the run button and the stale strip in `SummaryPanel.tsx`;
`RUNGS` / `Rung` / `rungParam` and the `?len=` parameter in `params.ts`; `rungText` and
`buildSummaryTree`'s `summaries` argument in `tree.ts`; the summary arms of `visitor.ts`,
`Dock.tsx`'s blurb and `LandingPage.tsx`'s feature line, and the dead rules in `styles.css`.

**A visitor now gets summary mode for free**, which is the one behaviour change beyond the panel:
it was an `ARTEFACT` mode gated on a `summary.json` a shared payload might not carry, and the gists
come down inside the article. It joins `hierarchy` and `outline` in `visitorGap`, and
`tests/public-network-trace.test.tsx` renders it on a payload with no summary artefact of any kind.
The offline cache allowlist is `src/web/lib/api.ts` (not `lib/offline-store.ts`, which is prose) and
loses its `/api/summary/` entry.

**The database column stays, and this is the one deliberate exception.** `article_revisions.summary`
holds real readers' summaries and dropping a column is not reversible. The migration that drops it is
a separate, one-line follow-up that **needs Greg's explicit sign-off** and can happen any time, or
never (AGENTS.md § Real data belongs to the reader).

The first draft of this plan said *"nothing will read or write it after this"*, and
[GPT Sol's review](gist-only-summaries-review-sol.md) returned NO-SHIP partly on that sentence being
false: `REVISION_CARRY_POLICY` classifies `summary` as `"carry"`, `carriedColumns()` derives the copy
list from the schema, and `beginDraftIn` copies it into every new revision. Taking it out of that
policy would either throw or strand the bytes on old revisions, which is data loss with no migration
to blame it on. So the honest statement is narrower and it is the one that ships:

> Nothing **serves, compares, regenerates or interprets** those bytes. `beginDraftIn` still carries
> them forward, and `tests/store-carry-forward.test.ts` now asserts the carried value is byte-equal
> rather than merely non-null. `REVISION_READ_POLICY.summary` is `{}` — granted to no read at all —
> and `tests/store-revision-columns.test.ts` holds it there.

**The file stops travelling, and the column does not.** `copyArtefacts` is the production write path
and it moves artefact *kinds*; `summary` is not one any more, so `db:export` no longer writes
`summary.json` and `db:import` no longer reads it. Writing a file no importer can put back would be
worse than not writing it. What backs up a database is a database backup, and the column is in it.

**The `revision_step_runs_step` CHECK keeps `'summary'`.** Narrowing it means dropping and re-adding
a constraint that Postgres validates against existing rows, so any historical summary step run would
have to be deleted first — real history destroyed to tidy a list. `tests/db-step-constraint.test.ts`
gains a `RETIRED` list naming it, so the constraint is documented as permitting a value nothing
writes rather than quietly rotting.

**The tests.** `tests/summarise.test.ts` and `tests/summary-stamp.test.ts` go. The plan's first
draft claimed six others merely used `summarise` as a handy example of a step and could all be
re-pointed; Sol read each one and only **`profile-prompts`** turned out to be a clean re-point (it
now covers `quotes`, which had no profile coverage at all). The rest were testing this stage:
`block-policy-prompts` and `job-failure` lose their summary cases with the stage,
`pipeline-artifact-store` loses its summary rows, `supplement` keeps the gist-only apparatus test and
loses the stored-summary join, and `store-carry-forward` keeps a case — rewritten around the retired
column. `summary-expand.test.tsx` keeps its cases and loses the props that no longer exist.

Sol also found six more the plan had missed entirely, none of which a typecheck would have caught:
`stop-details`, `parse-json`, `paid-cli-ledger`, `public-imports`, `deploy-checks` and
**`scripts/deploy-checks.ts` itself**, whose `GATE_FIXTURES` required `data/writes/summary.json` — so
the deploy gate would have failed on the first push.

**The docs.** `docs/project/summaries.md` is rewritten around what the mode now is rather than
deleted — it is the owner of the mode, and `reading-view-overview.md` links to it. Every other doc
that names the ladder gets swept.

## And the badge Greg actually opened with

Separate and already landed, because it is small and stands on its own: **the root's `+N parts`
badge is a control now.** It was `disabled`, on the argument that the root draws no title row, so it
has no twist, so an override written there could never be taken off (GPT Sol, 2026-08-27). That
argued for giving the root a way to undo it, and instead it argued the press away. The badge now
flips to `−N parts` once the parts are open, and that collapse **clears the override without writing
the root into `closed`** — a shut root would survive the Depth buttons and leave `parts` drawing an
empty outline, which is the one trap in the neighbourhood. `tests/summary-expand.test.tsx` covers
all three.
