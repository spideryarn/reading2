# Review and fix: stage 2 of 261003m — Dig deeper fills a citation's influence in from the web

Repo: this worktree (branch worktree-citations-influence-unknown), TypeScript + ESM, Postgres via drizzle.
You may WRITE in this worktree. Fix what is inside this stage, narrowly and red-first. Report, do
not fix, anything wider. Do not commit. Do not touch evals/results/. Do not run any migration or
any DDL (you have no database; and the shared one must only ever be changed by `npm run db:migrate`).

## The candidate

Committed: commit a2e9977cd (stage 2), on top of fd897959e.
  git diff fd897959e..a2e9977cd
  changed paths: git diff --name-only fd897959e..a2e9977cd
Stage 1 (2b2dc6b7e, and your own fixes in fd897959e) is underneath; your stage 1 fixes are code
nobody but you has reviewed.

Start with: src/citation-influence.ts (new: prompt, schema, keepInfluence, findInfluence),
src/citation-effective-influence.ts (new: the one read path), src/citation-investigate.ts (where
the call sits in a press, the lease, the budget comment), src/store/citation-investigation-row.ts,
src/db/schema.ts + drizzle/20261003194854_citation_investigation_influence.sql,
src/web/CitationsPanel.tsx (influenceOf, WebInfluence), src/web/useCitations.ts (the done frame),
src/chat-tools.ts. That is where to begin, not the limit.

## What it is meant to do

The plan: docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md
§ Stage 2, and the table answering your plan review F1–F9. Check each of those answers was actually
built. The guarantee, stated at its true strength — please judge whether THIS STATEMENT is accurate,
not whether the mechanism is "sound":

  "A web influence is kept only when (a) its source is one of this press's own search pages,
  chosen by index, with URL and title copied by code; (b) that page's title names the work by
  resultIsTheWork's title rule (called with no anchor); (c) the quote is found word for word, by
  the strict spaced pass, in that same page's extract, and the stored quote is the extract's own
  slice; (d) the number is finite and within 0–1. It is NOT established that the quoted words are
  about the work rather than something else on that page; the row says so. It is attached to a row
  only while the investigation's fingerprint matches and its influence_version is current. The
  list's own influence is never overwritten, and a visitor's payload never carries the web one.
  The call settles before the stream starts and so never outlives the press's allowance; its
  failure never fails the press."

The implementer's departures from the plan, each for you to judge: resultIsTheWork is called with
anchor null (so a Wikipedia or Semantic Scholar page about the work can be the source); the call is
skipped when no page's title names the work; no new progress stage (an existing label reworded);
the budget constant and the global fuse are unchanged (the call's worst case is estimated at about
3 cents, not measured); a stored number with a missing quote/url/version reads back as no influence
rather than throwing.

## What I want

1. An independent attack first, on the statement above and on everything a reader, a visitor, the
   exports, the chat tool and the cost ledger now see.
2. The migration: additive only? CHECKs right? Does every writer name all five columns so a later
   press that keeps nothing clears an earlier value? Journal/snapshot consistent?
3. The prompt (CITATION_INFLUENCE_SYSTEM) against docs/project/prompting-guide.md, and the
   fencing of web text as untrusted.
4. Every sentence added to docs/project/citations.md, Help, and comments: true of the code?
5. Run the tests that need nothing outside the tree: tests/citation-influence.test.ts,
   tests/citation-effective-influence.test.ts, tests/citation-investigate.test.ts,
   tests/citations-panel.test.tsx, tests/citations-investigate-client.test.ts (or .tsx),
   tests/chat-citations-tool.test.ts, tests/public-dto.test.ts. Raw result lines please. The
   Postgres suites are mine to run; name any you want run and what you expect.
6. Mutate two finished lines and say whether a test noticed.

Severity: P0 data loss / security / wrong charging; P1 user-visible wrong behaviour or a contract
violated; P2 design or maintainability risk; P3 prose. IDs continue the chain: start at F15. For
each: established (file:line or a failing run) or reasoned; fixed-by-you or reported. End with a
list of every file you changed and one verdict line: "land", "land after fixes" or "do not land".

## My own suspicions (already mine, worth less)

- anchor null loosens identity for a row that HAS a DOI: a different work with the same opening title.
- The row's card wording is long.
- `evals/dig-deeper/capture.ts` now makes the influence call for real money when it runs a press.
- Whether the tooltip's date is the press's `at` and is shown in the reader's zone consistently with the rest of the row.
