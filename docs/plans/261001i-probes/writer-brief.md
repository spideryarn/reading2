# Brief shared by every doc writer in the 261001i sweep

You are one of five writers editing docs in parallel in this worktree. Read these first:
`docs/reusable/documentation-policy.md` (the standard), `docs/reusable/edit-important-docs.md` (what
needs Greg's approval), and `docs/plans/261001i-docs-and-signposting-sweep.md` § Plan review (how
approval is being judged in this sweep).

## What you may and may not change

- **Only the files your own brief names.** Other writers hold the rest. If a fix belongs in a file
  that is not yours, put it in your report rather than making it.
- **Signposting, factual corrections and moved knowledge are yours to write**: a link, an `Up:` line,
  a "see X" pointer, a stale claim replaced by a citation of the code (`` `src/x.ts` § `symbol` ``)
  in place of a copied value, a trap stated as a fact with its source ("X fails because Y — postmortem
  Z"), Greg's exact words put back where a doc paraphrases him.
- **Rule wording is not yours.** A sentence that tells an agent to do something it was not already
  told, or that changes what an existing rule says, is a *proposal*, wherever it would land. So is
  any edit at all to `AGENTS.md` beyond the `↳` lists, to an entry point beyond signposts and factual
  corrections, to anything in `docs/reusable/`, to `version-control.md`, to `feedback-reports.md` or
  `overseer.md` (both are pinned by hash in `tools/overseer/standing-jobs.ts`), or to
  `security-map.md` beyond its signposts. Write proposals into your report file, each as: the file
  and section, **before** (exact text, or "new"), **after**, and a one-line reason.
- **No code changes**, except a header comment in a module that points to the doc owning it.
- **Don't teach to the test.** Probes measured where agents get lost, and you may be told what they
  missed. Write general signposts that would serve *any* task in that area, never a sentence that
  answers one probe's task and nothing else.

- **Do not open** `docs/plans/261001i-probes/holdout-tasks.md`, or any file there named `key-H*`
  or `before-H*`. Those are a held-out measurement and must not shape the edits.

## How to write

- Intent and signposts, not descriptions of code. Cite code by file and stable symbol, never by line
  number. Where a doc copies a number out of code (a count of modes, steps, files), replace it with
  the citation rather than updating the number.
- Quote Greg exactly, in a blockquote, attributed and dated, and give the source file.
- Less is more. A moved trap is one to three sentences plus its source.
- Small, targeted edits. Re-read the region right before each edit; other sessions are editing docs
  on `dev` too. Never rewrite a whole file.
- A new doc under `docs/project/` needs an `Up:` line linking its owner, under its H1, a line under
  its owner's list of docs saying *when you'd open it*, and its name in the owner's `↳` list in
  `AGENTS.md`. Only writer W1 edits `AGENTS.md`; any other writer who adds a doc asks for that line in
  their report.
- Links must resolve, with anchors. When you finish, run `npx vitest run tests/doc-links.test.ts`
  and fix anything of yours that is red. Report anything red that isn't yours.
- Do not commit. Do not run `git add`, `git stash`, `git checkout`, `git restore` or anything that
  changes the index or discards work.

## Report

Write `docs/plans/261001i-probes/report-<your id>.md` (paths in backticks, never markdown links):
what you changed, file by file, in a line each; the proposals (before/after/reason); anything you
found but left for someone else; and the doc-links result. Then reply with the path and three lines.
