# Product view: Opus, on the Annotations mode brief

The answer an Opus subagent gave to
[261001d-annotations-mode-product-brief.md](261001d-annotations-mode-product-brief.md), 2026-10-01,
independently of GPT Sol's ([261001d-annotations-mode-product-sol.md](261001d-annotations-mode-product-sol.md)).
It arrived as a message rather than a file, so it is transcribed here verbatim. Parent:
[261001d-annotations-mode-marginalia-in-a-right-hand-column.md](261001d-annotations-mode-marginalia-in-a-right-hand-column.md).

---

**1. Make it a mode for v1.** Plain and Hierarchy already return `null` from `modeBand()`, and `DRAWS` has a `kind: "none"` row that names what is on screen instead. So a mode needs no new URL state, no layout for two side columns at once, and no width breakpoints. A separate toggle would need all of that before Greg could try anything. Hand-off for the implementer:
- Keep the prose exactly where it sits in `plain`. The column should only add space on the right, never move the text.
- Build the column as its own component that takes block ids and notes, and knows nothing about modes. Turning it into a toggle later should then be a URL param plus a layout change, not a rewrite.
- Lay the notes out against the document, not the viewport, so they scroll with the text.
- Re-run the layout when any block changes height: a ResizeObserver on the table catches granularity zoom, images, maths and fonts loading late. Block heights in this view change after first paint, and a one-off measure will drift.

**2. Rank the five ideas by value for the effort:**
- **Socratic questions** come first. They cost nothing, there are only a handful per article, and reading to answer a question is the most vision-aligned of the five. Show the question only, never its answer.
- **Breadcrumbs plus the arc sentence** in a sticky head come second. They are free and serve "stay oriented". Two caveats:
  - The arc exists only once the owner has opened the article, so the head must look complete with breadcrumbs alone.
  - By Greg's own split (left = unanchored, right = anchored), this belongs on the left. It is fine in the right head for v1 because it follows your current block, but write that down as a known tension.
- **Ideas as notes** come third, and only when the reader has already generated them. That is fine. In the note, show a few words; put the full statement in the tooltip. In the playground, "the idea-links/tooltips are good" was Greg's one unqualified approval.
- **Cut auto ask-for-help.** It spends money and writes into the reader's data without being asked. It needs a difficulty score we don't have. And it asks the question on the reader's behalf, which is the forklift truck in the vision doc's gym metaphor. Leave it deferred, not on the v1 list.
- **Dashed underlines in the prose** stay deferred, as you have it. Anchoring by quote is fragile: the research doc found ideas occurrences that miss because of curly versus straight apostrophes. That cost does not belong in stage 1.

Your staging is right.

**3. Relation words: yes, as stage 2, but only after Greg has tried stage 1.**
- Generate one per prose block, choosing from a fixed list: so, but, why, e.g., closer, wider, vs, new, and-also. Spell out in the schema that the answer is one word. The playground got clause-length "marks" where the prompt was vague about length.
- **Store every one and draw only the turns.** "And also" stays in the data but never reaches the column. Thirty-four faded chips in a row is clutter in a margin that is meant to be sparse.
- Make the mark a word, with a tooltip giving the reason, never a symbol. That is the playground's hardest-won rule.
- The press spends money, so it goes in `SPENDS`, and you need to decide what a visitor sees.

**4. Risks against the vision doc:**
- **"A second article down the margin" is the main risk.** Keep the density low: questions at the top-level sections only, relations only where the argument turns, and never labels or gists per paragraph. The research doc rejected margin labels, three sources to one, for exactly this reason.
- **The right margin was reserved for the reader.** The research doc's channel budget gives that margin, and the accent colour, to the reader's own comments and bookmarks. Greg's request (7K) overrides that, and that's fine, but generated notes must stay visibly machine: small caps, faint ink, no colour. Then comments can join the column later without anyone mistaking them for ours.
- **Keep the column out of copy-paste.** Make it `user-select: none` and keep it outside the table, so that copying paragraphs never carries our notes into the clipboard.
- "Earn the ink" (notes appear only after a reader has dwelt on the passage) is a good later experiment. It is not v1.

**5. On a narrow window, hide the notes but keep the sticky head**, drawn as a top bar so the mode still visibly does something. Don't put notes inline after their blocks:
- It puts generated text inside the prose, the thing the research doc's channel budget rules out.
- It risks our notes landing in what readers copy.
- It is a second layout to build and test.

A mode that silently draws nothing at some widths will look broken, and the sticky head avoids that.
