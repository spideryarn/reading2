# Plan review: Reception lists the papers that cite the piece, from OpenAlex

You are reviewing a **plan**, read-only. Nothing is built yet. Do not edit any file.

## The candidate

Live, pre-commit, in this worktree (branch `worktree-qi-aabv7jjy-debate-openalex-citers`, based on
`origin/dev` at `8548c0d4a`). One untracked file is the candidate:

- `docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md`

Read it first. Then read whatever of the tree you need to attack it. Starting points, which do not
limit scope:

- `docs/plans/261002i-debate-leads-with-who-has-cited-this-article.md` § Stage 2, and § What a
  stage-2 v1 must get right (your own earlier findings 5–8)
- `docs/plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md`
- `docs/plans/261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md`
- `src/bibliographic.ts`, `src/store/pg-bibliographic.ts`, `src/article-registry.ts`,
  `src/fetch.ts` § `fetchBibliographicJson`, `tests/setup/provider-guard.ts`
- `src/debate.ts` (header), `src/web/DebatePanel.tsx`, `src/web/useDebate.ts`, `src/routes.ts`
  (Debate's routes and how an owner-only, experimental-gated route is written)
- `src/web/PrivacyPage.tsx`, `docs/project/privacy.md`, `docs/project/sql.md`,
  `docs/project/security-map.md`, `docs/project/mode.md`, `docs/project/copy.md`

## What the work is for

Greg said yes to sending an article's DOI to OpenAlex so that Debate's Reception sub-mode can list
the papers that cite the piece (a count and a list; not what each says). The plan chooses a
model-free lookup, cached per DOI in two new tables, served by a new owner-only route, drawn as a
"Cited by" section at the end of Reception.

## What to do

Make an independent pass first. Attack the plan as a design: is it the simplest thing that gives
Greg "39 papers cite this" and the list; what will break; what is wrong about the existing code it
leans on; what it forgot that this repo's rules require (the mode checklist, the public boundary,
the privacy page's rules, the SQL rules, the fetch rules, the experimental switch); whether any
claim it makes about existing code is false. Check claims against the code rather than against the
plan's prose. You have no network, so you cannot call OpenAlex; the measured facts in § Measured
were taken from the box today.

You may run one test file or a script that needs nothing outside the tree
(`npx vitest run tests/<one>.test.ts`, `node --import tsx <script>`); not `npm test`.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an id (F1, F2, …), a severity, the file and line that shows it, and the change
to the plan you would make. End with one verdict: *build as written*, *build with the P0/P1 fixes*,
or *do not build; here is the smaller or different thing*. Reducing or reframing the plan is a
legitimate answer.

Do not write any sentence that attributes words or a decision to Greg beyond the one quotation
already in the plan.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Is a `GET` that makes an outside request and writes a cache row acceptable here, or does this
  repo want it behind a job or a `POST`?
- Is title agreement with OpenAlex's record enough verification without an author check?
- Loading the list before the paid search has run: does the pre-search screen or the mode's
  auto-arming make that harder than the plan assumes?
- Two tables with `text[]` authors against one row with a JSON list: which does sql.md actually
  want for a cache of somebody else's records?
- Is reusing the `bibliographic_services` slots and cooldown for a third service sound, given the
  `Registry` type and its CHECK?
- Is it right to keep the list out of the visitor's view and out of the stored Debate artefact?
