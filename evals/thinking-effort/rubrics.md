# Rubrics for the thinking-effort eval (plan 261001p)

One rubric per mode, written from that mode's doc in `docs/project/`. Each judge is given the
article (with block ids) and one lineup of four outputs, W/X/Y/Z, for that article. The judges are
not told what differs between the four.

The anchors (1 / 3 / 5) are for the scoring judge; the ranking judge uses the same criteria.

---

## Sketch — a model's drawing of the shape of the argument

From [sketch.md](../../docs/project/sketch.md): *"the goal is to provide some kind of helpful sense of
the whole document's structure … if the writer says they're going to make 3 arguments for X, that
might be represented as 3 columns that converge back"* (Greg). The model decides what shape the
argument is and lays it out itself. Its characteristic failure: **the shapes make claims** stronger
than the article's (a numbered ladder on a list the author calls unordered; a decision diamond on a
question the essay says cannot be settled), and a picture that is true but unreadable.

1. **Shape fidelity** — does the layout show the argument's actual shape (its main moves, how they
   relate, where they converge or branch), rather than a generic list of boxes?
   1 = a generic stack or grid that would fit any article · 3 = recognisably this argument, but one
   major move missing or misplaced · 5 = a reader who had not read the piece would get its shape right.
2. **No overclaiming** — does every device (order, arrows, hierarchy, opposition, decision points)
   claim only what the article supports?
   1 = a device asserts something the article denies · 3 = one device stronger than the prose ·
   5 = every device is earned.
3. **Coverage** — are the parts a reader needs to see there, with nothing important left out and
   no space spent on trivia? 1 = whole sections absent · 3 = one notable gap · 5 = complete at the right grain.
4. **Legibility** — can the picture be read: no overlaps, text that fits, a clear reading order?
   1 = hard to read at all · 3 = readable with effort · 5 = reads at a glance.
5. **Text accuracy** — are labels true to the article, in its own terms?
   1 = a wrong or invented claim · 3 = paraphrase that drifts in one place · 5 = accurate throughout.

## Illustrated — the Sketch, painted (judged on the brief)

From [illustrated.md](../../docs/project/illustrated.md): *"a more engaging version of Sketch, based on
the data from Sketch … like those old-timey maps … Most importantly, it should restrict itself to
what's in the article"* (Greg). The brief chooses a register and writes the compositions an image
model paints; on the Anil Seth essay it chose an illuminated manuscript *because the essay invokes
golems, Scala Naturae, souls*. The plates now carry lettering, because without it *"it's almost
impossible to make sense of what the image is about"* (a reader). When the paper has figures, the
brief should draw the ones that carry the argument into the montage.

You judge the **brief**, all four of which were written from the same Sketch.

1. **Grounded in the article** — is every scene, object and caption something the article contains?
   1 = invented scenes or claims · 3 = one decorative element with no basis · 5 = all of it traceable.
2. **Carries the argument** — would the painted plate convey the argument's shape (the Sketch's
   structure), not just its mood? 1 = a mood piece · 3 = the main idea but not its structure ·
   5 = the structure is legible in the composition.
3. **Register chosen for this article** — is the visual idiom justified by the article's own
   material, and would it not fit an arbitrary other piece? 1 = generic · 3 = plausible but
   unexplained · 5 = clearly this article's idiom, with the reason given.
4. **Lettering that makes sense of it** — short, correct captions/headings that would let a reader
   decode the image, even as a thumbnail. 1 = none or misleading · 3 = present but vague or too
   long · 5 = few, short, exact.
5. **Paintable** — is the composition concrete and coherent enough for an image model to draw well
   (and, where figures were offered, are the right ones used)? 1 = vague or self-contradictory ·
   3 = drawable with gaps · 5 = specific and coherent.

## Ideas — the propositions this piece needs you to hold

From [ideas.md](../../docs/project/ideas.md): *"pull out new ideas that the text introduces and/or key
ideas that the text requires the user to understand"* (Greg). An idea is a **proposition**, not a
term (*"can you say it as a proposition?"*). An **introduced** idea quotes where it is stated; an
**assumed** idea quotes **the passages that would stop making sense without it**, and must name the
local inferential move — not *"institutions shape behaviour"*, true of almost any text. Its worst
failure is an assumed idea that launders the model's own reading through the article's ids.

1. **Load-bearing** — are these the ideas the piece actually turns on, not topics or trivia?
   1 = mostly topics or truisms · 3 = a mix · 5 = each one matters to the argument.
2. **Propositions, not terms** — is each a claim you could carry to another article and use?
   1 = noun phrases · 3 = some · 5 = all.
3. **Assumed ideas are argued and bounded** — does each assumed idea's reasoning name what fails
   in that passage without it, specifically? 1 = generic background or no argument · 3 = argued
   but loose · 5 = a precise local move every time.
4. **Anchors are right** — do the quoted passages actually state (introduced) or presuppose
   (assumed) the idea? 1 = mostly unrelated · 3 = some weak · 5 = every anchor fits.
5. **Coverage and balance** — the important ideas present, both kinds where the piece has both,
   no padding. 1 = major ideas missing · 3 = one notable miss · 5 = complete, no padding.

## Hierarchy — the tree Structure, the zoom and the gists all read

From [hierarchy.md](../../docs/project/hierarchy.md) and
[granularity-zoom.md](../../docs/project/granularity-zoom.md): a nested structure of the article
(ranges, nesting, titles, a one-sentence gist on each internal node) that every reading mode
depends on. **Held to a higher bar**: a structural regression is disqualifying on its own.

1. **Sections follow the article's real divisions** — boundaries where the argument actually turns,
   respecting the author's headings where there are some. 1 = boundaries cut through arguments ·
   3 = one or two misplaced · 5 = every boundary is where a careful reader would put it.
2. **Nesting** — does the depth reflect real sub-structure, neither flat nor needlessly deep?
   1 = flat or arbitrary · 3 = partly right · 5 = the nesting is the argument's.
3. **Titles** — short, specific, informative about that section. 1 = generic · 3 = mixed · 5 = all sharp.
4. **Gists** — does each gist say what the section claims, accurately?
   1 = vague or wrong · 3 = mostly right · 5 = accurate and specific.
5. **Completeness** — nothing dropped, nothing duplicated, the whole article covered.
   1 = sections lost · 3 = an awkward catch-all · 5 = complete and clean.
