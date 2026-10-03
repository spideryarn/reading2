# Review: a plan to make Citations' influence score "unknown unless confident", and have Dig deeper fill it in from the web

Repo: this worktree (branch worktree-citations-influence-unknown), TypeScript + ESM, Postgres via drizzle.
READ-ONLY: do not change any file. This is a plan review; nothing is built yet.

## The candidate

Live pre-commit: base aa5d4d6491fb0986d6e82dfd1d233a5a61e82eb3; untracked:
- docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md (the plan)

Start with the plan, then: docs/project/citations.md, docs/project/prompting-guide.md,
src/citations.ts (SYSTEM prompt near line 1700, CITATIONS_OUTPUT_SCHEMA, scoreCounting, toDrafts, the fold near line 1314),
src/web/CitationsPanel.tsx (priorityOf, orderWorks, scoresOf), src/web/threshold.ts,
src/citation-investigate.ts, src/citation-paper-passages.ts (the model for a small checked JSON call inside a press),
src/citation-lookup.ts, src/dig-deeper.ts (searchFirst, DigFindings), src/db/schema.ts (citationInvestigations),
src/store/citation-investigation-row.ts, src/chat-tools.ts (article_citations), src/public/dto.ts, src/store/export.ts.
That is where to begin, not the limit.

## What it is meant to do

Greg's decision, verbatim, is quoted at the top of the plan. The plan must build exactly that, in the
simplest version that is honest: (1) the list prompt gives influence only when the model is confident,
otherwise unknown; the row says Unknown plainly; the prioritised order handles unknown sensibly;
(2) Dig deeper fills influence in from what it finds on the web, says where it came from, stores it.
House rules that bind it: every stored fact gets a timestamp; a model's output is a pointer and code
decides what is kept; strict JSON schemas via the shared adapter (required-nullable, no optional);
a visitor never sees Dig deeper's results; prefer simple over easy.

## What I want from you

An independent attack on the plan first: is each statement about today's code accurate (check them
against the source), what will this break that the plan does not mention (callers of influence,
priorityOf, the threshold's unscored handling, the fold/inherit-id logic, the cache key / ARTICLE_OUTPUT_FORMAT,
the public DTO, export, chat tool, tests that pin the prompt or schema), is the stage-2 design sound
(where exactly the new call can sit in makeInvestigateCitation, what DigFindings actually carries, whether
findQuote/pageNamesTitle can do what the plan says, the fingerprint decision, the lease and budget),
and is there a simpler design that gets the same result.

Severity: P0 data loss / security / wrong charging; P1 user-visible wrong behaviour or a contract violated;
P2 design or maintainability risk; P3 prose. Give every finding an ID F1, F2, … Say for each whether it is
established (direct evidence in source, cite file:line) or reasoned. End with one verdict line:
"build as written", "build after fixes" or "do not build".

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Thresholding an unknown-influence row on relevance alone mixes two scales under one bar.
- Whether the search's extracts ever actually say anything about a work's standing, so stage 2 may store nothing most of the time.
- Whether replacing a confident model number with a web one is right, or only filling unknowns.
