# Review prompt — stage 1 of `reusable/`: the docs move

## What this repo is, in one paragraph

Spideryarn is an AI-assisted reading app: a TypeScript/ESM monorepo-in-one-package with a Vite
client (`src/web/`), a node-side pipeline and API (`src/`, `api/`), a large `tests/` suite run by
vitest, and — separately from the product — a set of box tools under `tools/` that watch and steer a
fleet of coding agents running on one Hetzner machine (`tools/fleet/`, `tools/overseer/`). Its docs
are unusually load-bearing: `AGENTS.md` is loaded into every agent's context, and `docs/` holds the
project's memory (plans, postmortems, research). `tests/doc-links.test.ts` is a real gate over all
of it — every relative link and anchor in every doc, *and* every doc reference written in a source
comment, has to resolve.

## What Greg asked for

> I'd like to create a `reusable` top-level folder that we can eventually pull out as its own repo,
> completely separate from the rest of the Spideryarn repo, that other agents can make use of. Move
> docs/reusable into reusable/docs/, same for reusable scripts, and all the stuff around
> docs/project/overseer.md and the web dashboard and anything related. … In practice I don't imagine
> it'll be quite so straightforward. Do the easy stuff, with review from GPT Sol. Then let's discuss
> the tricky stuff that needs decisions/tradeoffs.

**This review covers only the easy half: the docs move.** No code has moved. The tooling
(`tools/fleet/`, `tools/overseer/`, `gjd-remote`, `run-claude.ts`, `run-codex.ts`, `tmux-job.ts`,
the worktree scripts) is still where it was, because moving it raises questions — where its ~130
test files live, whether it keeps sharing this repo's `package.json`, `tsconfig.json` and
`vitest.config.ts` — that are Greg's to answer. Those are being put to him separately. **Do not
review the code move; it has not happened.** You may note anything the docs move has made harder for
it, as a P3.

## The candidate

Working tree at `/home/greg/code/spideryarn2/.claude/worktrees/reusable-folder`, branch
`worktree-reusable-folder`, against `HEAD` = `db7a98c8`. Nothing is committed yet, so
`git diff` and `git status` in that directory are the candidate. 1,322 files changed.

Read the tree directly. Three artefacts are prepared for you as a starting point, all under
`/tmp/claude-1000/-home-greg-code-spideryarn2/ea571c4e-52c8-4d7e-8148-89a70b86c61e/scratchpad/`:

- `structural.diff` — the six files where something other than a path was decided. **This is the
  part with judgement in it.**
- `rw-reusable.py` — the script that did the mechanical rewrite, with its four rules.
- `sample-mechanical.diff` and `nondoc-stat.txt` — a sample of the mechanical change, and the
  per-file stat for everything outside `docs/` and `reusable/`.

## What was done

1. `git mv docs/reusable reusable/docs` — 39 files, byte-identical apart from their own outbound
   links.
2. A scripted rewrite of every reference, in four rules (see `rw-reusable.py` for the exact strings
   and the order, which matters):
   - **R1** `docs/reusable/` → `reusable/docs/`, everywhere. Depth-preserving, so `../../docs/reusable/x`
     becomes `../../reusable/docs/x` and stays correct from wherever it was written.
   - **R2** `../reusable/` → `../../reusable/docs/`, in files at `docs/<dir>/*` only.
   - **R3** `../../reusable/` → `../../../reusable/docs/`, in files at `docs/<dir>/<dir>/*` only.
   - **R4** inside `reusable/docs/*`, `../<docs-subdir>/` → `../../docs/<docs-subdir>/`, for the six
     subdirectories of `docs/`.
   Counts: R1 1,414 · R2 1,033 · R3 18 · R4 60, plus 14 hits fixed by hand afterwards (files whose
   extension the script did not walk, and references written without a trailing slash).
3. Structural edits, in `structural.diff`:
   - `tests/doc-links.test.ts` — `SEARCH_ROOTS` and the `EVERGREEN` glob repointed; `reusable/**/*.md`
     added to `DOC_FILES`; `"reusable"` added to `REPO_ROOTS`.
   - `tools/overseer/standing-jobs.ts` — both standing jobs re-pinned, with the reasoning in a
     comment. See § The re-pin below.
   - `tools/overseer/idea-queue-seed.ts`, `scripts/count-lines.ts` — one path each.
   - `.vercelignore` — `reusable` added beside `docs`.
   - `AGENTS.md` — the signpost, plus one link-text tidy.
4. A new `reusable/README.md` saying what the directory is for and what has not moved yet.

## The re-pin, which is the one thing here that touches an authorisation

`tools/overseer/standing-jobs.ts` pins a fingerprint per standing job, and the daemon refuses to
dispatch a job whose fingerprint has moved. `tools/overseer/jobs.ts` § `BEHAVIOUR_ENCODERS` puts
both the document's **path** and its **sha256** inside that fingerprint. So:

- `get-ready-to-deploy` moved because its document's path moved.
- `feedback-sweep` moved because its document — `docs/project/feedback-reports.md`, which did **not**
  move — cites four docs that did, so its bytes changed.

Both were re-pinned from `npx tsx scripts/overseer-pins.ts`. Both jobs are currently switched off
(`OVERSEER_JOBS_ENABLED` is set by nothing in `infra/hetzner/`).

**Please attack this specifically.** Is a link-path rewrite inside a pinned document a legitimate
re-pin, or has a gate been walked past? Is the comment's account of *why each hash moved* actually
true — check it, do not take it from me. And is there a third pinned thing (`rule-jobs.ts`, or
anything else that digests a file) that should have moved and did not?

## What I want from you

Ranked findings, most severe first, each with an ID (`F1`, `F2`, …) and a severity:

- **P0** — this is wrong and will break something, or a gate is now weaker than it was.
- **P1** — this is wrong in a way that will mislead a reader or an agent.
- **P2** — worth changing, but the work is correct without it.
- **P3** — observation, or something for the code move later.

Please look hardest at these, in this order:

1. **Did the gate get weaker?** `tests/doc-links.test.ts` is the only oracle for this whole change.
   Its `SEARCH_ROOTS`, `REPO_ROOTS`, `DOC_FILES` and `EVERGREEN` all had to move together. If any of
   them now covers *less* than it did — or if `reusable/` sits in a blind spot that `docs/` did not —
   that is a P0 and it is exactly the failure this repo calls *silent success*
   (`reusable/docs/silent-success.md`): the test still passes, and it has stopped asking.
2. **Is the depth arithmetic in R2/R3/R4 right in every case, and did any file get the wrong rule?**
   The script decides by path depth. A file at an unexpected depth gets a link that resolves to
   nothing — or, worse, to something. `docs/project/original-version/` is the only depth-3 case I
   know of; find any I missed.
3. **Did anything that resolves a docs path at *runtime* get missed?** I found three
   (`standing-jobs.ts`, `idea-queue-seed.ts`, `count-lines.ts`). Prose in a comment is cheap to get
   wrong; a string a program reads is not. Sweep for more.
4. **The re-pin**, as above.
5. **Anything that now says something false.** The rewrite changed the *text* of 1,300 files. A
   sentence that named `docs/reusable/` as a *location* is fine; a sentence that reasoned about it
   being *inside* `docs/` may not be. `reusable/docs/README.md`, `AGENTS.md` and
   `docs/project/documentation-policy.md`'s neighbours are where I would look.
6. **`.vercelignore`.** `reusable` was added beside `docs`. `scripts/deploy.ts`'s build gate renames
   these aside before building, to prove nothing reaches into them. Is that safe today, and is there
   anything in `reusable/` a deployed function could reach?
7. **The conclusion itself.** I am claiming this change is complete and correct, that the only
   remaining `docs/reusable` occurrences are deliberate history (two `.diff` files in `docs/plans/`,
   one captured transcript fixture, and three comments that describe the move itself), and that the
   three `tests/doc-links.test.ts` anchor failures that remain are pre-existing and belong to another
   session's in-flight plan doc (`docs/plans/260909g-…`, whose stage headings were renumbered without
   its own cross-references being updated). **Check each of those three claims rather than assuming
   them.** If the conclusion is wrong, that is the finding.

## Fix what you find

Per this repo's workflow, you have `workspace-write`: **fix what you find inside this stage**, keep
the fixes minimal and mechanical, and report anything wider for a person to decide rather than doing
it. Do not commit; leave the working tree changed and say what you changed. Do not run `npm run
check` or the full `npm test` — the unit lane is already running in a tmux job and the box is shared
and busy. `npx vitest run tests/doc-links.test.ts --project unit` is cheap and is the one to use.

## My own suspicions, last, so they do not steer you

- R1 is depth-preserving and I believe it is universally safe, but I have only reasoned about it, not
  proved it.
- I left historical artefacts alone — `a/docs/reusable/…` diff headers inside plan docs, absolute
  `/home/greg/…` paths quoted from old terminal sessions. I think that is right (they are records of
  what was true then) but it is a judgement and you may disagree.
- `reusable/docs/get-ready-to-deploy.md` and several of its neighbours name this repo's commands
  (`npm run db:migrate`, `npm run check`). That was true before the move too, and it is the thing
  that will actually make this directory hard to lift out. I did not touch it. P3 at most, but say
  so if you think the new `reusable/README.md` over-claims about it.
