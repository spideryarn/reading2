# Code review: plan 261001a, stages 5 and 6 — the registry's record on Citations rows and Debate sources

You are GPT Sol. You reviewed the plan and stages 1–4 and 3. Stages 5 and 6 are uncommitted in this
tree; the change is `docs/plans/261001a-stages-5-6-code-review.diff` (note `src/types.ts` also holds
stage 3's uncommitted edits — review only the registry parts there). Spec: § Stage 5 and § Stage 6 of
`docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md`. The shared
lookup is `src/bibliographic.ts` (committed).

The builder's summary:

- Wiring: `citationRegistryDeps` / `debateRegistryDeps` hold the real `lookupWork`, and a test checks
  that. The pipeline runs the lookups after the model call, so no stamp, prompt or `PROMPT_VERSION`
  changes. A re-run's lookups are cache reads; the step never fails because of a lookup.
- Stage 5: rows whose link `parseWorkId` reads as DOI or arXiv, except `search` / `web` rows; each
  identifier asked once, the first 80, 2 at a time; `registryTitleAgrees`; a disagreement is kept as
  `{ kind: "conflict", source }`; a re-run replaces any older registry field. At most 12 authors plus
  a `moreAuthors` count; fields capped. The public side carries a found record only.
- Stage 6: `parseWorkId` first, else a publisher path whose *first* segment is `doi`, then at most one
  view word (full/abs/pdf/epdf…), then `10.NNNN/suffix`; the query is never read.
  `titleNamesWork(engineTitle, registryTitle)` for every address; no engine title → nothing. A
  registry record's authors and year take priority over the extract's in Debate; `rowYear` drives the
  date order; when the engine title is cut short, the registry's full title becomes the headline.
- Clients: the Citations by-line uses the registry only where the article leaves a field empty, with
  "· from Crossref"; a conflict draws a note.

Look hardest at:

- **Can a wrong record reach a row?** A mistyped DOI, a publisher DOI path that names a different
  object (a supplement, a figure, `/doi/10.x/y.s001`, a book chapter versus its book), an arXiv id
  whose DataCite record is a different version, or a weak title agreement (short or generic titles
  like "Introduction" or "Editorial").
- **Politeness**: is the 80-row, two-at-a-time loop bounded in wall time inside a pipeline step, and
  could a large shelf re-run storm Crossref? The global limiter is in `src/bibliographic.ts`.
- The public DTO: exactly the named fields, and nothing owner-only.
- That the pipeline step's artefact and freshness semantics are unchanged (`docs/project/architecture.md`
  § Conventions); that a lookup failure cannot fail the step or silently drop the list.
- Tests that could not fail.

**You may fix what you find** in these stages' files (sandbox workspace-write). Do not touch stage 3's
files (`src/citation-investigate*.ts`, `src/citation-paper-passages.ts`, `src/web/CitationInvestigation.tsx`,
`src/web/useCitations.ts`, the stores, the schema, `drizzle/`). Run `npm run typecheck` (or
`node --import tsx scripts/typecheck.ts`) and the affected test files by path. Do not commit. Findings as
id, severity, evidence, and what you did. End with a verdict.
