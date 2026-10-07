# Plan review: the title is drawn once, and the masthead loses its back arrow

You are reviewing a **plan**, before anything is built. Read-only: change no file.

## The candidate

- Worktree: `/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow`, base commit
  `c25a46a8d18827b13a4fdbf09f1e2c05655127cc` (branch off `dev`).
- The plan, untracked: `docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md`.
- No code has changed yet. One untracked scratch script exists, `scripts/_tmp-title-look.ts` (the
  read-only production query behind the plan's counts); it will be deleted, not committed.

## What it is for

Two feedback reports from the project's owner about the top of the reading view: the article's
title appears twice, and he wants the back arrow above the title removed. The plan's diagnosis is
that stage 2 (`debugPage` in `src/extract.ts`, and the PDF path in `src/pdf-read.ts`) wraps the
article in a page with our own `<h1>` title and a `~N min read` line, stage 3 (`src/blocks.ts`)
turns that header into blocks 0 and 1, and the masthead (`src/web/Masthead.tsx`) then draws the
title again. The plan hides those leading "echo" rows in the prose table at render time, using the
cells-hidden technique `src/web/fold.ts` documents, and defers the root fix at extraction.

## What I want from you

An independent attack on the plan first. Read the plan, then the code it names: `src/extract.ts`
§ `debugPage`, `src/pdf-read.ts` around the rendered `<h1>`, `src/blocks.ts` § `splitIntoBlocks`,
`src/web/Masthead.tsx`, `src/web/TableView.tsx`, `src/web/fold.ts`, `src/web/FoldToggle.tsx`,
`src/web/BackLink.tsx`, `src/web/Dock.tsx` § `DockHome`, and anything else you find that reads the
first block or the masthead's link. This list is where to start, not a limit.

Check in particular, by reading the code rather than trusting the plan:

1. Is the diagnosis right? Is the `<h1>` at block 0 always ours, on the web path and the PDF path?
   Is there any path where an article's first `h1` equal to the title is the author's only copy
   and hiding it loses something the masthead does not show?
2. Is the chosen fix sound? What in the client reads block 0, the first heading, or "the first
   row" and would misbehave when that row has zero height permanently: the spine, reading
   position, reading-time accounting, arrow-key navigation, `scrollToBlock` / `revealBlock`,
   marginalia anchoring, Structure rows positioned before a block, selection and comments, the
   visitor's view, print or export of the page, anything that copies the prose? Name file and
   function.
3. Fold: the plan says the echo heading must not be foldable. Is that right, and what exactly
   does *Fold all* fold today?
4. The matching rule: `meta.title` / `meta.titleOriginal` against the block's text. What does the
   client actually hold after a rename (`titleOverridden`), for a visitor's payload, and for a
   title containing maths or markup that `plainTitle` flattened? Where would the rule miss an
   echo, or hide something that is not one?
5. Removing the arrow: is there any reader, on any window width, signed in or out, for whom the
   masthead's arrow is the only way to `/` from the reading view (for example a state where the
   bottom bar is not drawn)?
6. Is the deferral honest? Is "stop writing the header at extraction" really as expensive as the
   plan says, or is there a cheap version (for new imports only) that should be in this plan
   rather than in a queue entry?
7. Is there a simpler design than the one chosen that the plan did not consider?

## Severity scale

- **P0** — the plan would ship something that loses or corrupts a reader's data, or breaks the
  reading view for existing articles.
- **P1** — the plan is wrong about a fact it depends on, or would ship a visible regression.
- **P2** — a gap, a missed case, a better way; worth fixing but not blocking.
- **P3** — wording, naming, taste.

Give every finding an id (`F1`, `F2`, …), its severity, the file and line that shows it, and what
you would change in the plan. End with one line: **Verdict: build as written / build with the P0
and P1 fixes / do not build**, so that an empty answer cannot be mistaken for approval.

## My own suspicions (already mine, worth less: spend most of the run elsewhere)

- Rule 1's "first three blocks" hides a PDF's own title page heading. I am not sure that is right.
- A renamed article still shows the `~N min read` line under the author's heading, by rule 2.
  I think that is acceptable; say if it is not.
- I have not read `TableView.tsx` closely enough to know whether a class on the row or a rule in a
  style element is the smaller change.
