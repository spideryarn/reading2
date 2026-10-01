# Product view wanted: Spideryarn "Annotations" mode, v1 (experimental)

You are advising on a product/design choice. Do NOT edit any files. Read whatever you like in the repo
(/home/greg/code/spideryarn2/.claude/worktrees/fb7e-annotations-mode): CLAUDE.md, docs/project/vision.md,
docs/project/reading-view-overview.md, docs/project/mode.md, docs/research/260828c-decorated-mode-ideas.md,
experiments/decorated/README.md.

## What Greg asked (admin, two reports, 2026-09-30/10-01, verbatim)

7E: "I think we had suggested in another Feedback report to try adding an experimental Annotations mode, that would
provide marginalia-snippets that scrolls with the text, i.e. anchored to the blocks visible on screen. Some ideas
(taking some inspiration from the `decorated.html` experiments & research: - include the "relation-words", e.g. BUT,
SO - perhaps include socratic-questions for what each section is answering - used dashed-underline with
hover-tooltips for Ideas/Assumptions - add some kind of Arc-rail sentence at the top (and/or the
Structure-breadcrumbs that I think I mentioned in another Feedback report) - if you think a block is really important
but really difficult, we could automatically trigger the ask-for-help question-comments?"

7K: "I would love to play with putting that new Annotations mode as a column on the right-hand-side (i.e. right of
the text). Then left-hand-column (if displayed) would be stuff that's unanchored to the text, middle column for the
text itself, and right-hand-column (if displayed) for annotations anchored to the blocks. This raises lots of
questions about whether both left- and right-hand columns can be visible at the same time (ideally yes, if the
window is wide enough, otherwise probably only one or the other), etc etc. For now, let's say that Annotations mode
is the only one that can appear in this right-hand-column, though we'll see in future."

Also Greg, earlier the same night: modes carry no description line ("they waste space").
Brief from the Overseer: build the simplest useful v1, behind the experimental switch, prioritise ideas by ease and value.

## Facts I've established

- Reading view today: thin spine on the far left; a fixed-position "band" (the active mode's panel) on the left;
  the prose to its right, rendered as one <table>, one <tr data-block> per block. The WINDOW scrolls. Nothing is
  drawn to the right of the prose. Only one mode is open at a time (?mode=…); `plain` opens no band.
- Already available, zero new model cost:
  * Socratic `question` on the root and depth-1 tree nodes (one per top-level section), written by the structure
    call; today shown only in Summary mode.
  * The arc: one sentence per PART of the article saying where in the argument you are (artefact `arc`, generated
    when the owner opens the article). Today shown only as a column in Structure mode's narrow face.
  * The tree (section titles), so breadcrumbs "Part 2 › Methods › …" for the current block are free.
  * Ideas artefact (3-10 propositions the piece assumes/introduces, each with block-id occurrences) — but only if
    the reader has generated it in Ideas mode (a paid model pass, on press).
- Relation words (so / but / why / e.g. / vs / new …, per paragraph, relative to the previous one) need a NEW model
  pass. The experiment did it with a one-off script; in-app it means a new pipeline step + stored artefact (the
  standard, compiler-checked but long checklist). Piggy-backing on the existing nav-label pass is a trap: that pass
  is checkpointed and cannot re-run for an existing article.
- "Ask for help" comments: a comment with the AI tick-box ticked spends money and writes into the reader's own data.
- Library research: no sidenote library worth taking; ~100 lines of own code (measure row tops, single pass
  top_i = max(desired_i, prev_bottom + gap)) is the standard.

## My draft plan (critique it)

Stage 1 — the right-hand column and free content. `annotations` is a new MODE (in MODES, experimental), which
opens NO left band and instead a right-hand column of notes, absolutely positioned level with their blocks (JS
layout + collision pass), scrolling with the text. Content: each top-level section's Socratic question anchored to
its first block; a sticky head at the top of the column with breadcrumbs + the current part's arc sentence; Ideas
(if already generated) as a small note beside each occurrence's block, with a tooltip of the statement. Narrow
window: notes drawn inline after their block instead.
Stage 2 — relation words: a new `relations` step (one cheap model call per article: a word per prose block),
run on pressing the mode; drawn as a small-caps word at the top of each block's note.
Deferred: dashed underlines in the prose for ideas; showing left band + right column at the same time; auto
ask-for-help comments; difficulty/importance scoring.

## Questions

1. Mode vs orthogonal toggle: should Annotations be a mode (mutually exclusive with every left-band mode) for v1, or
   a separate right-column toggle that can coexist with a left band? Which is simplest that still lets Greg "play"?
2. Which of Greg's five ideas give most value per effort for v1, and is my staging right? Anything to cut?
3. Relation words: worth a new step in v1, or defer? If yes, per-paragraph or only where the relation is not
   "and also" (the experiment found most are "and also" and faded them)?
4. Anything in vision.md (augment, don't replace reading) that this design violates — e.g. would the column become
   "a second article down the margin"?
5. Narrow-window behaviour: inline after the block, or just hide?

Answer in under 600 words, decisive, numbered to match.
