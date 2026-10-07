# Review: the plan for a document too long for one structure answer (D, then E)

Repo: this worktree (`.claude/worktrees/long-documents-d-then-e`), branch
`worktree-long-documents-d-then-e`. TypeScript, ESM, one server process, Postgres. An article is a
sequence of blocks; the `structure` pipeline step (`generateStructure`, `src/structure.ts`) builds
the table-of-contents tree; the `labels` step (`src/labels.ts`) then writes a short label per
paragraph in batches.

## The candidate

A plan, committed:
`docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md`
(the commit is the head of this branch; `git log -1 -- <that path>`). Nothing is built.

Start with: the plan; `src/heading-tree.ts`; `src/structure.ts` § `generateStructure` (about line
2452 on) and § `wholeDocumentRequest` (about 693); `src/labels.ts` § `planBatches`,
`assertCoversEveryBlock`, `MAX_BATCH`, `runBatch`; `src/tree-invariants.ts` § `checkTree`;
`src/tree-parts.ts`; `src/structure-starts.ts`; `src/structure-deepen.ts` § `deepenTree`;
`tests/stated-limits.test.ts`. Background:
`docs/investigations/261004b-big-document-imports-at-the-limits.md` and
`docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md`. This is
where to begin, not the limit of scope.

## What it is meant to do

Today a document over about 2,890 body blocks is refused by `structure` before any model call
(`TooLongForOnePass`), after its transcription has been paid for. Greg chose: D (a tree from the
document's own headings with no model, so the reader can read) and then E (fill that tree in a
section at a time).

The plan claims, and each of these is a statement to check for accuracy against the code:

1. A bare `buildHeadingTree` in the catch is not enough: a flat tree (root plus thousands of
   leaves) makes the labels step throw or refuse, and long leaf runs under one heading produce
   label batches far over the size the labels step was tuned at.
2. Bounding every sibling leaf run at `MAX_BATCH` (60) by cutting it into consecutive "windows",
   titled by the opening words of their first paragraph, yields a tree that passes `checkTree` as
   `provisional`, that `planBatches` covers completely (with and without a supplement appended),
   and that every later consumer can take.
3. Nothing downstream treats `provisional: "headings"` on a published tree as "not finished", and
   nothing requires internal nodes to have a gist except the rule `checkTree` waives for a
   provisional tree.
4. For E, the switched-off cascade (`deepenTree`) cannot produce a finished, non-provisional tree
   from a headings seed without four new mechanisms (a recursion loop, per-wave publication or a
   requeue, cutting an oversized target, a bottom-up gist pass), and the smaller route is the
   ordinary whole-document call run once per group of consecutive top-level parts, the part trees
   stitched under one root, one small call for the root's gist, and D's tree as the fallback when
   any group fails.

Out of scope: Relations' own ceiling, the 4.5 MB response question, the transcription observations.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and build a
throwaway harness under /tmp, for instance one that calls the real `buildHeadingTree`,
`mergeLabels`, `checkTree` and `planBatches` on a synthetic document
(`tests/helpers/synthetic-blocks.ts`). You have no network, not even loopback, so anything needing
Postgres skips.

## Attack it

Independently, before you read my questions below. The invariant to break: **after D, no document
that passes the page and size caps fails at `structure` or at `labels` because of its length, and
the article it becomes is one every view and mode can open.** Then: is E's recommended route
sound, and is it really smaller than the cascade route?

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the code it contradicts (file:line)
  - (b) the smallest change to the plan that closes it, as exact wording
A finding with no (a) goes last.

P0: data loss, exploitable security, incorrect charging, or the service broadly unusable.
P1: user-visible wrong behaviour, or an authoritative contract violated.
P2: design or maintainability risk with no wrong behaviour today.
P3: non-behavioural prose defect.

Give a verdict: build, build with changes, or do not build. Refuse only on an established P0 or
P1, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Depth. The headings tree caps at internal depth 2; windows under a depth-2 section make internal
  depth 3. Does any consumer or invariant assume a maximum depth, or that depth-1 nodes carry
  questions?
- Whether a window should exist under a heading section at all, or whether the labels step should
  instead cut an oversized sibling set itself. I chose the tree because the reader's views also
  suffer from a 258-row section, but the labels step is the thing that actually throws.
- The title rule for a window, and whether `sourceHeading` or any title invariant
  (`sameHeading`, the redundant-rung collapse) reacts badly to a title made of body text.
- In E, whether `MAX_QUESTION_DEPTH`, the checkpoint entry's validation against the whole body, or
  `buildTree`'s "covers the whole article" guard obstruct stitching part trees, and whether
  dropping each group's own root (keeping its children as the book's top-level sections) loses
  anything the tree needs.
- In E, time: several whole-document calls side by side inside the step's 700 s budget, each with
  64,000 tokens of thinking room.
- Whether the dialog's "250 pages" is really true after D for a 250-page dense paper with about
  450 headings, given labels and the other steps.

Do not change any file.
