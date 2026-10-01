# Design critique: Spideryarn's new Annotations mode (read-only; do not edit files)

Repo worktree: /home/greg/code/spideryarn2/.claude/worktrees/fb7e-annotations-mode (commit a6631c60 plus doc edits).

Spideryarn is a reading app that augments rather than replaces reading (docs/project/vision.md). Greg (the
founder) asked for an experimental "Annotations" mode: marginalia in a column to the RIGHT of the article text,
each note anchored to (level with) the paragraph it belongs to and scrolling with it. His words:

> I would love to play with putting that new Annotations mode as a column on the right-hand-side (i.e. right of the
> text). Then left-hand-column (if displayed) would be stuff that's unanchored to the text, middle column for the
> text itself, and right-hand-column (if displayed) for annotations anchored to the blocks. … Use Playwright and
> screenshots etc to try and get this working nicely. Get help from GPT Astra.

v1 draws: each part's Socratic question (italic, left rule) beside its first paragraph; an "assumes"/"introduces"
stamp (small caps + the idea's short name, dashed underline, a button opening a card) at each Idea's first
occurrence; and a fixed "head" box at the top of the column with the current Part › Section (small caps) and an
"arc" sentence saying where the argument has got to. On a narrow window: no column, a one-line message at the foot.
Design constraints from the research (docs/research/260828c-decorated-mode-ideas.md § The channel budget): our
notes must read as visibly the machine's, not the author's — small sans, no hue (the accent orange belongs to the
reader's own marks), no persistent highlighter; the margin must stay sparse, never "a second article down the
margin".

Look at these screenshots (open the PNGs; the app is in dark theme):
- logs/fb7e/shots/1600-annotations.png — 1600×1000, top of article
- logs/fb7e/shots/1600-annotations-mid.png — scrolled to the middle
- logs/fb7e/shots/1100-annotations.png — 1100 wide
- logs/fb7e/shots/800-annotations.png — 800 wide
- logs/fb7e/shots/500-annotations.png — phone width
- logs/fb7e/shots/tooltip.png — an idea card open
- logs/fb7e/shots/1600-dark.png

The CSS is src/web/styles/marginalia.css; the components src/web/annotations/AnnotationsColumn.tsx; the tokens
src/web/styles/tokens.css. Known issues from a browser pass: the opaque fixed head box hides notes scrolling under
it (one peeks through an 8px gap above it); the head can be ~160px tall (a 5-6 line arc sentence); idea stamps look
dim and like body text; the narrow message floats over prose.

Give a concrete, prioritised design critique and specific CSS/markup changes (values, not adjectives), at most
~10 items, each: the problem as seen in a named screenshot, the change, and why. Consider especially:
1. The head: should it be a box at all? Typographic treatment, height, how notes should pass beneath it
   (fade mask? flush to the bar? collapse the arc to a line with the rest on hover?).
2. Hierarchy between question, idea stamp, head; contrast in both light and dark themes using the existing tokens.
3. Alignment: the note's first line vs its paragraph's first line (baseline), left gutter between prose and column.
4. Anything that makes it read as a second article, or as the author's voice.
Answer in under 700 words.
