# Review prompt, round two — the reviewer's own fixes, and two sections written after it

A narrow fix check. Work in the current directory (a git worktree). You may edit files under
`docs/project/`; do not commit; do not touch `AGENTS.md`, `docs/reusable/` or any code.

## The candidate

Two commits, and nothing else is in scope:

- `f64676ebc` — round one's reviewer (a GPT model, not you in this session) made 31 corrections in
  25 docs. `git show f64676ebc -- docs/project` is the diff; its findings table is
  `docs/plans/261007a-docs-sweep-signposts-truth-and-coverage-review-sol.md`. **These are unreviewed
  edits by someone else.** For each of R1–R31, check the new sentence against the code.
- the commit after it (`git log --oneline f64676ebc..HEAD`) — two sections written by a Claude
  subagent after round one: `## Renaming a mode` in `docs/project/mode.md`, and the paragraph in
  `docs/project/fetching.md` on why OSF is not a paper source; plus a blockquote added to
  `docs/project/browser-testing-playwright.md` § Signing in.

## What to do

1. For each R-numbered fix: does the code say what the doc now says? Run the grep; read the source.
2. `mode.md` § Renaming a mode: check every path, symbol and line of "where a mode's name is stored"
   against the code, each "loud"/"silent" verdict, and what it says the two precedent plans
   (`docs/plans/261001r-*`, `docs/plans/261006a-*`) did. Somebody will follow this list to rename a
   mode in the database; a place missing from it is the failure that matters. Grep `debate` across
   `src/db/schema.ts`, `src/`, `package.json` and `drizzle/` for a stored form the list omits.
3. `fetching.md`'s OSF paragraph: check it against `docs/plans/261006i-*` and its evidence file, and
   against `src/jobs.ts` and `src/store/find-article.ts` where it cites them. It must state only
   what those establish.
4. The blockquote in `browser-testing-playwright.md` must be character for character what
   `docs/plans/260901j-a-signed-in-browser-on-the-box-with-no-human.md` records.

Fix what is wrong, with the smallest edit; keep every heading's text; never edit a quote. Run
`npx vitest run tests/doc-links.test.ts` at the end; it must pass. No other tests: you have no
network and no Postgres.

## Severity

P0: tells an agent to do something that loses data or weakens a defence. P1: a statement that is
false against the code, or a stored form of a mode's name missing from the list. P2: true but
vaguer than it was. P3: wording.

Return: a verdict line (`ship` / `not ready`; refuse only on an established P0 or P1 you could not
fix), a table of findings with IDs (S1, S2, …), severity, doc:line, evidence and whether fixed, and
the list of what you changed.
