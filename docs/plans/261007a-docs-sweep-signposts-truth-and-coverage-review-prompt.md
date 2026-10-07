# Review prompt — the docs sweep's corrections, checked against the code

You are reviewing, and fixing, a documentation change in the Spideryarn repo. Work in the current
directory (a git worktree). You may edit files under `docs/project/` and the comment-only code
changes listed below. Do not commit; do not touch `AGENTS.md`, `docs/reusable/`, or any code beyond
comments.

## The candidate

Three commits on this branch, on top of `5bdee3e47`:

- `bb90fab92` — `open-questions.md` shrunk; the plan.
- the two commits after it (run `git log --oneline 5bdee3e47..HEAD`) — round one and round two of
  the sweep.

`git diff --stat 5bdee3e47..HEAD` lists every changed path; `git diff 5bdee3e47..HEAD -- <path>`
shows one. About 125 files, almost all under `docs/project/`. Two are new:
`docs/project/fleet-and-overseer-overview.md` and `docs/project/chat-from-a-mode.md`. The plan is
`docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md`; read it first. It does not limit
your scope.

## What the change claims

Cheap subagents (Claude Sonnet, one per group of docs) read `docs/project/` and did three things:

1. **Corrected statements that were false against the code** — about 230 small edits. Each was
   supposed to be verified by grep or by reading the file before the edit. **This is the part to
   attack.** A wrong "correction" is worse than the stale sentence it replaced: it carries today's
   date and reads as checked.
2. Added a `## In this doc` section map near the top of every doc over 400 lines, and `Up:` lines.
3. Added signposts: links to code, tests and neighbouring docs; a few short new sections (a list
   for adding a bot-check provider in `content-extraction.md`; "A new migration, in five lines" in
   `database.md`; "To reproduce something at a phone's width" in `phone-and-touch.md`; what can make
   a quote appear twice in `quotes.md`).

And two Opus subagents wrote the two new docs and corrected the entry-point docs
(`architecture.md`, `reading-view-overview.md`, `design-css-overview.md`, `security-map.md`) where
they were false against the code. Entry-point wording is normally a rule needing the owner's
approval; the standing permission is that a fix which only makes the doc match the code needs none,
and a change to what a rule *says* does. **Flag any edit in those four, or in `block-ids.md`,
`version-control.md` or `overseer.md`, that changes an instruction rather than a fact.**

## What to do

**Independent pass first.** For each changed doc, read its diff and check every factual change
against the code: does the function, file, route, script, column, constant or count the new text
names exist and say what the doc now says? Run greps; read the source. Spend most of the run here,
and most of that on the docs where being wrong costs most: `security.md`, `auth.md`,
`security-map.md`, `billing.md`, `deployment.md`, `database.md`, `worktrees.md`, `setup-dev.md`,
`supabase-local.md`, `ingest-queue.md`, `ai-gateway.md`, `structure-step.md`, `comments.md`,
`public-shelf.md`, `privacy.md`.

Check the new short sections as if they were instructions somebody will follow tonight: every
command, flag and path in "A new migration, in five lines", in the bot-check provider list, and in
the phone-width recipe.

Check the two new docs the same way: every file and symbol they name, every "loud"/"silent" verdict
in `chat-from-a-mode.md`'s checklist, and that each blockquote attributed to Greg is character for
character what the cited source file says.

**Fix what you find**, narrowly: the smallest edit that makes the sentence true. Where the original
(pre-sweep) sentence was right and the "correction" is wrong, restore the original. Do not rewrite
for style. Do not change any heading's text (anchors are linked from hundreds of places). Never edit
a quote from Greg. Report, do not fix, anything wider than a sentence or two.

You have no network and no Postgres. Do not run the test suite, except
`npx vitest run tests/doc-links.test.ts` at the end, which must pass.

## Severity

| | |
|---|---|
| **P0** | a doc now tells an agent to do something that loses data, weakens a defence, or mis-states what a reader is charged |
| **P1** | a correction that is itself false, or an instruction changed in a rule doc without approval |
| **P2** | a true statement made vaguer or less useful; a map entry that misdescribes its section |
| **P3** | wording |

Give every finding an ID (R1, R2, …), its severity, the doc and line, the evidence, and whether you
fixed it.

## My own suspicions — worth less than your independent pass; spend most of the run elsewhere

These were left unedited by the readers as doubtful. Verify each and fix it if the code settles it;
say so if it needs the owner:

- `auth.md` ~354: "403 and the beta message, never 200" — reportedly no 403 path exists
  (`src/auth.ts`), and the same doc says there is no allowlist.
- `auth.md` ~563, `security.md` ~1107 and ~1132: "a spend limit … is the control that is actually
  missing" — against the tier and slot limits `billing.md` describes.
- `security.md` ~461-464: a test said to assert that `loadArticle` calls the sanitising helper;
  `loadArticle` is reportedly gone and `tests/sanitize-stale-artefact.test.ts` pins a READERS list.
- `security.md` ~432-436 and ~493: the sanitiser stamp described as written into `blocks.json` and
  compared at the read seam; reportedly Postgres has no stamp column and every read re-sanitises.
- `security.md` ~1210-1213: "only the page cap is built" — `refuseAnOverlongPdf` and an abort signal
  on `countPdfPages` reportedly landed.
- `prompt-caching.md`: a statement about "five pipeline groups" sharing a cache, against
  `sharesArticleCache` in `src/step-order.ts`.
- `AGENTS.md` (do not edit; report): its line for `ai-gateway.md` says "every paid call goes through
  OpenRouter, bar one declared exception". `UNMETERED_SPEND` in `src/spend-declarations.ts`
  reportedly has five entries and `Provider` is `"openrouter" | "openai"`. Is "one" still true in
  the sense the line means?
- `feedback-reports.md` ~131: "the party security-map.md counts fifth" — is the fifth party there
  still the one this sentence means?
- `structure-step.md` ~1001: "`npm run labels` (retired 2026-09-05)" while `package.json` has a
  `labels` script.
- The sentence I would least like to be wrong about: `public-shelf.md`'s rewritten paragraph on
  `robots.txt` and `noindex` — it replaced "`Disallow: /` and stays that way" with a description of
  what `public/robots.txt` and `vercel.json` do now. If that paragraph is wrong, an agent will
  reason wrongly about what a search engine may index.

## What to return

A verdict line — `ship` or `not ready`, refusing only on an established P0 or P1 you could not fix —
then the findings table, then a list of what you changed, then anything wider you noticed.
