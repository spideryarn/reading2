# Editing an important doc

> **Provenance.** Adapted 2026-08-30 from `EDIT_PROCESS_FOR_IMPORTANT_DOCS.md` and the
> `edit-process-carefully` skill in Greg's MindstoneRebel repo. The process is theirs; the list of
> what counts as important, and the committing rules, are this repo's.

Some documents are load-bearing: their exact wording changes what other people and other agents do.
Editing one is not the same job as writing a new note, and the difference is the process, not the
prose. **Small steps, in the user's hands, one approved set at a time.**

Two aims at once: make the document as good as it can be, and keep it easy to improve next time.

## What counts as important here

- **[AGENTS.md](../../AGENTS.md)**, above everything else — it is loaded into every agent's context
  on every turn, so a sentence added there is paid for thousands of times. `CLAUDE.md` is a symlink
  to it; there is only one file.
- **The seven entry-point docs** listed in AGENTS.md, and
  [block-ids.md](../project/block-ids.md), the contract everything addresses text through.
- **Anything in [`docs/reusable/`](README.md)**, including this file — these are instructions agents
  follow instead of inventing a process.
- **Any doc under `docs/project/` whose wording is a rule** rather than a description — the
  committing recipe in [version-control.md](../project/version-control.md), the gates in
  [code-quality-overview.md](../project/code-quality-overview.md).

A plan, a postmortem or a research note you just wrote is **not** important in this sense. Edit those
freely.

## How to go about it

- **Group first, then prioritise.** Handed a list of ideas, don't work through it in the order given.
  Group the related ones, rank the groups by ease × value, and say what the order is before you
  start.
- **One small related set of changes at a time**, then stop and get approval before the next set.
  A single big diff on a doc like this is unreviewable, and unreviewed is how a rule nobody agreed to
  gets in.
- **Only make changes you were explicitly asked for.** If you spot something else worth doing, raise
  it as a numbered suggestion and leave the file alone.

## In chat

- **Number every suggestion**, so Greg can answer "1 and 3, not 2" without quoting you back at
  yourself.
- **Show the before and the after**, and name the file each one is in.
- **End with a short summary of what actually changed.** A before/after pair makes the diff easy to
  miss; the summary is what gets read.
- **At most three questions at a time**, and only where the ambiguity matters.
- **Say what you think of the approach.** If the change makes the doc worse, or belongs in a
  different doc, say so before making it.

## The edits themselves

- **Keep them surgical** — minimal, specific, and touching nothing you weren't asked about.
- **Where the wording is Greg's, offer two variants** before changing anything: one that stays very
  close to his original language, and one lightly improved. His phrasing carries intent a paraphrase
  loses — see [AGENTS.md § How we write docs here](../../AGENTS.md#how-we-write-docs-here).
- **Signpost, don't duplicate.** Detail belongs in the doc that owns it; everywhere else gets a line
  and a link. Two copies of a rule become two different rules.
- **Fix the links in the same edit.** `npm test` runs
  [`tests/doc-links.test.ts`](../../tests/doc-links.test.ts), which checks the file *and* the anchor
  — a stale anchor lands silently at the top of the page and never looks broken.

## Committing

Commit after each approved set, then move straight on to the next one — don't ask again.

Use the repo recipe, one command, naming only your own files
([AGENTS.md § Working in a tree several agents share](../../AGENTS.md#working-in-a-tree-several-agents-share)).
**A pathspec of `CLAUDE.md` commits nothing** — it is a symlink, and git only sees the link. Name
`AGENTS.md`.
