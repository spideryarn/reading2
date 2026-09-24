# Review: offer "Choose them again" on an outdated quote list, and make a forced run on one replace

Repo: /home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924, branch
worktree-feedback-suggestions-0924. TypeScript/ESM, React client under src/web, vitest.

## The candidate

A PLAN, not code. Live pre-commit: base 3ddb24dc (HEAD). Untracked:
docs/plans/260924d-choose-them-again-on-an-outdated-quote-list.md (the plan). Nothing else changed yet
by me. Other agents are editing other files in this tree; ignore them.

Start with: the plan; src/quotes.ts (`existingFor`, `idsByText`, `inheritIds`, `buildQuotes`,
`generateQuotes` ~line 1540); src/web/QuotesPanel.tsx (~lines 600-775, the banner and the foot);
src/web/useQuotes.ts (`regenerate`); src/store/pg.ts ~3148 (`outdated`); docs/project/quotes.md
§ "Find more appends. Only a stale list is replaced." and § What is still open;
docs/plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md § What the plan review
changed (finding 1, and why the replace action was declined then); docs/plans/260912e-quotes-long-enough-to-stand-on-their-own.md
finding 1. Also look for every other caller that forces the `quotes` step (e.g. src/web/Metadata.tsx),
since the behaviour change reaches them.

## What it is meant to do

Greg's report 3C, decided on his delegated authority: an outdated list (older PROMPT_VERSION, same
article) cannot be repaired by Find more because old spans win every overlap, so `quotes/6`'s longer
passages never reach it. The plan: the outdated banner gets the stale banner's "Choose them again",
the foot's Find more is hidden on an outdated list, and a forced run on an outdated list replaces
(via `existingFor` refusing it), with ids inherited by exact normalised words (`idsByText`) — unlike
a stale replace, which mints fresh ids. Invariants: a current list still appends; a stale list still
replaces with fresh ids; a `?quote=` link must never be moved onto different words; a dead one falls
back to the list.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp is writable; you can run one test file (`npx vitest run tests/<one>`).
No network; Postgres-backed tests will skip.

## Attack it

Independently, before reading my questions. Try to break: (1) the id-inheritance argument on a
same-article rewrite; (2) whether the state-decided mechanism has a caller or race where a reader
presses Find more (or another forced path) and silently gets a replace; (3) whether the read path's
`outdated` and the stage's refusal can disagree; (4) anything the plan loses that Greg explicitly
asked for.

For each finding: ID (F1…), severity P0 (data loss/security/charging/broadly unusable), P1
(user-visible wrong behaviour or an authoritative contract violated), P2 (design risk, no wrong
behaviour today), P3 (prose); established or reasoned; (a) the concrete scenario; (b) the smallest
change. Refuse only on an established P0/P1.

## My own suspicions — read last

These are already my doubts; confirming them is worth less than what you find yourself.

- Removing Find more from every existing (outdated) list partly reverses 260911a's Fable
  arbitration. Is the plan's reason (quotes/6 changes what a quote is, which appending cannot
  deliver) enough, or should both buttons stay, with a request flag?
- A deploy that bumps PROMPT_VERSION while a Find more job is queued turns it into a replace.
  Acceptable?

Do not change any file.
