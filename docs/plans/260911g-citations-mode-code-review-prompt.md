# Review: Citations mode, stages 1–3 — the owed code review (findings only)

Repo: this worktree (spideryarn2), branch `worktree-citations-owed-review`, merged with `origin/dev`
at 493604fc. TypeScript + ESM, `tsx`, one Node server (`src/routes.ts`), Postgres via Drizzle
(`src/db/schema.ts`, migrations in `drizzle/`), a React client under `src/web/`.

Citations mode was built on 2026-09-11/12 with one GPT Sol **plan** review
(`docs/plans/260911g-citations-mode-review-sol.md`) and **no code review**, because the Codex window
was exhausted. This is that code review, over all three stages at once. Weight it as the review that
counts: a plan review cannot find a handler that writes and then rejects.

## The candidate

Committed, all on `dev`:

    85631f9b  Citations stage 1: the artefact, the step and the read route
    abde65f7  Citations stage 2: the mode, behind the experimental switch
    1e54a7f8  Citations stage 3: Find it on the web, per searched row
    8d523739  Citations stage 3: the four reds the full suite found

    git show <sha>                    # each is self-contained
    git show --stat <sha>             # the complete changed-path manifest for each

No later commit on `dev` touches the Citations files. Do not use a merge-base range — `dev` is shared
and a range sweeps up other people's work.

Start with: `src/citation-find.ts`, the two routes in `src/routes.ts` (search `/api/citations/`),
`src/store/pg-citation-finds.ts`, `src/store/pg.ts` (`loadCitations`, `attachFinds`, the citation
finds store), the three migrations `drizzle/20260911220212_citations.sql`,
`drizzle/20260912000232_citation_finds.sql`, `drizzle/20260912000251_citation_finds_owner_fk.sql`,
`src/citations.ts` (the stage: prompt, parse, `findQuote` verification, footnote expansion, dedupe,
id inheritance, `linkFor`), `src/web/CitationsPanel.tsx`, `src/web/useCitations.ts`. That is where
to begin, not the limit — the four manifests are the scope.

## What it is meant to do

The plan is `docs/plans/260911g-citations-mode.md` (read it in full, including its Progress and its
plan-review ledger); what is built is `docs/project/citations.md`. In short:

- One model pass over the article (`citations` step) returns cited works with `{block, quote}`
  occurrences; code verifies every quote against its block, expands footnotes, mints/inherits ids by
  a dedupe key, and **derives every link itself** (DOI → arXiv → unique title-matching anchor →
  unique mention anchor → Scholar search). **The model never writes a URL we keep.**
- `GET /api/citations/:slug` reads the list; it never spends.
- `POST /api/citations/:slug/:id/find` makes one chat-wire call with Exa web search for one `search`
  row, keeps a page only if the model's pick is exactly one of the call's own `url_citation`
  annotation URLs **and** that result names the work; stores the annotation's url/title in table
  `citation_finds` keyed `(article_id, entry_id)`.
- **Owner-only** for v1, and behind the experimental switch. A visitor gets an explanatory band, no
  list.

Invariants that must not break:

1. No URL a row presents as the work's own came from a model's text (stage 1 or stage 3).
2. Only the article's owner can read the list or spend on *Find it*; nothing about another owner's
   article is readable or writable through these routes, and a visitor/public-readable path does
   not leak the list.
3. A write happens only for a kept find, only on a `search` row, only for the owner, and a failure
   is never drawn as found.
4. The three migrations are additive and safe to apply to production (they ride the next deploy).
5. Block ids are the addressing contract (`docs/project/block-ids.md`); nothing addresses text by
   offset.

Deliberately out of scope (the plan's "not built" list): *Find more* past the 80 cap, `?cite=`
selection, real influence counts, batch search, visitors.

## What you can and cannot run, and what you may change

**Findings only. The tree is read-only; do not change any file.**

Under the read-only profile, /tmp and the node_modules caches are writable. You can run one test
file (`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and you can
build a throwaway harness under /tmp. You have no network, not even loopback, so anything needing
Postgres will skip or fail — and a red test in the sandbox is not yet a finding (a test that spawns
or writes a temp file can go red there and green in a normal shell). I have run the Citations-related
test files in a normal shell against the local database; the raw output is
`docs/plans/260911g-citations-mode-owed-review-test-results.txt` in this tree.

## Attack it

Independently, before you read my questions below. **Spend the most on the security surface**:

- The *Find it on the web* route: who can reach it, what it reads, what it spends, what it writes.
  Is the owner gate real on every path (the GET, the POST, the store's `save`, the export)? Can a
  caller make it search for text of their choosing, or run it on someone else's article, or on a
  row that is not `search`? Is there anything a caller can repeat to spend without bound? How does
  the route's auth/CSRF treatment compare with the other owner-only POSTs
  (`tests/authenticated-api-route-contract.test.ts`)?
- Table `citation_finds`: the owner column vs. the article's owner, the foreign keys and their
  ON DELETE behaviour, what the read joins on, whether a row written for one owner can surface for
  another (e.g. after a revision, a re-run that inherits ids, an article's ownership changing, a
  public-readable share), the CHECKs, and whether the migrations are safe on a populated production
  database.
- The owner-only gate and the experimental switch: is either enforced only in the client? What does
  a visitor or a public-readable share see from the GET?
- Anything else that writes: the pipeline step's artefact write, the export put-chain, id
  inheritance on a re-run.
- Then the rest: invariant 1 (any path where a model-written URL, or an attacker-controlled
  `href` such as `javascript:`, reaches an `<a href>`), quote verification and footnote expansion,
  the four orders and the bar, stale/outdated handling, the budget.

For each finding give:
  - an ID (F1, F2, … — this chain's plan review already used F1–F10, so **start at F11**), a
    severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) what shows it fails its own claim — the input or mutation I can run
  - (b) the smallest change that closes it — a code block, or exact replacement wording
A finding with no (a) goes last.

Severity, by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it. End with a one-line verdict:
ship / ship after fixes / do not ship.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- The POST has no rate limit (the comment says so, citing the glossary `lookup`). Is "the owner can
  press it repeatedly and each press is billed" an incorrect-charging P0, or the accepted shape?
- `findCitation` reads the reference block's text with `loadArticle(slug)` — is that the same
  revision the citations list was built from?
- The progress notes say the ledger records `upstream: "OpenAI"` for an `anthropic/claude-sonnet-5`
  call under `order: ["anthropic"], require_parameters: true`, and for every Exa-backed call. Is
  there anything in this diff's request that makes that likelier, or is it outside it as claimed?

Do not change any file.
