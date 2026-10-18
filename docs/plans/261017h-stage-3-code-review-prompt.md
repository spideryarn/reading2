# GPT Sol code review: plan 261017h Stage 3 (a note per cited work, from its abstract)

You are reviewing code in the git worktree `/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs`
(branch `worktree-fbm53cdk-sources-scroll-and-blurbs`). **Fix what you find inside this stage**, and
report anything wider for me to decide. You can write files; you may not commit, push, deploy,
stash, reset, checkout, restore or rebase, and you may not touch `.env.local`, `infra/`, systemd or
any remote database. Make no paid model calls and no calls to the registries (Crossref, DataCite,
OpenAlex). The local database is shared with other agents; tests may go red for reasons not ours.

## Read first

- `CLAUDE.md` (the working rules), `docs/project/security-map.md` (the public DTO is a boundary;
  a model's output and a stranger's abstract are untrusted), `docs/project/prompting-guide.md`.
- The plan: `docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md`.
- The design: `docs/plans/261017h-stage-3-design-citation-blurbs.md`. **G1–G10 at its end override
  the sections above them.** Your own design review is
  `docs/plans/261017h-stage-3-design-review-sol.md`.
- The spike and the post-build eval: `docs/investigations/261017c-citation-blurbs-cost-and-quality.md`.

## The code under review

Three commits (the merges between them are from `origin/dev` and not under review):

- `a34253620` 3a: abstracts in `bibliographic_records`, `src/citation-evidence.ts` (the cascade).
- `d8933fe53` 3b: the `citation-blurbs` step (`src/citation-blurbs.ts`,
  `src/citation-blurbs-identity.ts`), the successor trigger in `src/pipeline.ts`, storage, the
  migration `drizzle/20261018002749_citation_blurbs.sql`, privacy text.
- `c288a99ff` 3c: `shownBlurb` / `attachBlurbs`, the owner read (`src/store/pg.ts`), the visitor
  read (`src/store/public-reader.ts`, `src/public/dto.ts`), `BibliographyPanel.tsx`,
  `ProseHoverCard.tsx`, chat (`src/chat-tools.ts`), docs.

`git show <sha>` each. Read the code, not only the diff, where a seam needs it.

## What I most want checked

1. **Faithfulness and identity.** Can a stored or shown note be about the wrong work, or say what
   its abstract does not? The quote check, the per-work check call, index handling in a batch,
   an abstract that writes instructions, the title-search rule (G6, G10).
2. **The visitor path.** Can anything reach a signed-out reader that the guard did not rebuild?
   Can a note show on a row whose identity changed? (G5, G8.)
3. **Freshness and the stamp.** G1 (stamp shape), G2 (`:partial`), G9 (`:recheck` after 7 days),
   the forced-run inference ("if the stored artefact is already current, the only reason it is
   running is a force"), and the successor trigger with `boundToOlderBase` (G3). Can a job loop,
   be lost, or skip work it should do?
4. **A known problem, please fix it: one Crossref cooldown blanks most of a list.** In the eval,
   3 of 5 runs met a 429/503 from Crossref, which cools it for a minute; every row not yet asked
   ended `transient: cooling-down` (36 of 70 on the reported paper, leaving 19% with a note), and
   under G2 nothing retries until the next publication or press. Waiting out a short cooldown
   inside the run, bounded by the claim's deadline (`DEADLINE_MARGIN_MS`, `LOOKUP_BUDGET_MS`),
   is the engineering fix with no product trade-off; a re-run queued from an open read would
   spend a second cent and is a product call, so do not build that one. Respect Crossref's
   `Retry-After` if we already read it. Test it red first.
5. **Prompt and limits.** 26 of 49 notes had two sentences though the prompt asks for one by
   default; `too-long` refused 4 of 16 in 3b's run (now split out as `quote-too-long`); a batch
   of 20 used ~6.5k of a 16k output ceiling. Change these only where the evidence supports it;
   a prompt change that cannot be measured here should be reported, not made.
6. **Cost and spend.** Every call through the gateway and the ledger (`docs/project/ai-gateway.md`,
   `cost-tracking.md`); nothing unbounded (batches, retries, title searches capped at 60).
7. **The step contract** (`docs/project/architecture.md § Conventions`): runnable on its own,
   carried forward, shared, reset, exported; every list of steps told.
8. **Copy.** The plain-words rule; the card says honestly what a note is and is not. Greg's bar:
   *"better to say nothing than hallucinate if you can't find any primary/authoritative sources"*.
9. **Docs that this made false**, anywhere under `docs/project/` (architecture.md's step list,
   setup-dev.md's model table, database.md).

## Gates, before you answer

`npm run typecheck`; the test files you touched and the stage's own
(`tests/citation-blurbs*.test.ts`, `tests/citation-evidence.test.ts`, `tests/public-dto*.test.ts`,
`tests/bibliography-panel.test.tsx`, `tests/citation-hover-card.test.tsx`,
`tests/chat-citations-tool.test.ts`, `tests/doc-links.test.ts`). Do not run the full suite.

## Answer

Write to the output file:

1. **Verdict**, one line: `ship`, `ship after fixes (made)`, or `do not ship`, with why.
2. **Findings**, most severe first: P0–P3, file:line, the failure as concrete inputs → wrong
   output, and whether you fixed it (and the test that shows it, red first) or left it, and why.
3. **Files you changed.**
4. **Gate results**, as printed.
