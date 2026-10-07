# Illustrated

Up: [reading-view-overview.md](reading-view-overview.md)

## In this doc

- [§ The picture carries words](#lettering) — why plates are lettered, and the rule that every drawn scene gets a title or none does
- [§ The reader can say how it should come out](#steering) — the steering note: what it touches, what it never does
- [§ It is an interpretation](#it-is-an-interpretation-and-the-app-says-so) — the label, the brief, what is checked and what cannot be
- [§ At full screen the brief is a column](#at-full-screen-the-brief-is-a-column-not-a-details) — Enlarge's two-column layout
- [§ Nothing in the picture is a control](#nothing-in-the-picture-is-a-control) — why there are no hotspots on the plate
- [§ The paper's own figures go in](#figures) — figures from stage 4.5 handed to the illustrator
- [§ The wire, and what it costs](#the-wire-and-what-it-costs) — OpenRouter images, the price table, PNG storage
- [§ Where the pieces are](#where-the-pieces-are-and-the-two-things-that-are-unlike-every-other-mode) — files and routes; Sketch-then-paint chaining, freshness, plate-route safety

One of Diagram mode's pictures: the [Sketch](sketch.md) scene, painted by an image model. It moved
here from [diagram.md](diagram.md) on 2026-10-01 with its wording kept; the mode and the other
pictures are still there.

> It should use the latest OpenAI Images image-generation model to generate a
> more engaging version of Sketch, based on the data from Sketch. … it could
> illustrate it like those old-timey maps that had little pictures and
> illustrations, or monk-illustrated copies of fancy books pre-printing-press. …
> Most importantly, it should restrict itself to what's in the article.
>
> — Greg, 2026-09-03

Sketch decides what shape the argument is and draws it in boxes. **Illustrated
takes that same scene and has it painted.** Two calls: a model reads the article
and the scene and writes an illustration brief, and `google/gemini-3.1-flash-image`
draws the brief. On the Anil Seth essay it chose an illuminated manuscript page
and said why —

> the essay itself invokes golems, Scala Naturae, souls and psychē — vellum,
> gold leaf, and marginalia are the article's own idiom, not an imported one

— and drew the Scala Naturae ladder, the hallucinated relative at the foot of
the bed, and Mother Teresa's face in a cinnamon bun. On the constitution it chose
an antique route-chart instead, because that article is a governing text rather
than a cosmology. The two cannot be swapped, which was the acceptance test.

The whole design, every measured number, and the four things it deliberately does
*not* do are in
[260903c-illustrated-diagram-sub-mode.md](../plans/260903c-illustrated-diagram-sub-mode.md).
What follows is what a reader touches and the three facts that decide everything
else.

## The picture carries words now, and that was the reader's complaint

<a id="lettering"></a>

> the images that are generated don't have any text. So they're just the images,
> and without the text, it's almost impossible to make sense of what the image is
> about. … we want the text to be readable even when the image is in thumbnail.
>
> — a reader, 2026-09-04 (report -12)

Until 2026-09-04 the plates carried **no text at all, deliberately** — the ban is
still written into the history of [`src/illustrated.ts`](../../src/illustrated.ts),
and its reasoning was never wrong: *a misspelt word is a confident-looking lie*,
and `openai/gpt-image-2` returned "SΩUL MACHINE" on the first heading it was asked
for. What changed is the premise, not the argument.
[260904a](../investigations/260904a-nano-banana-text-in-generated-images.md) put **111
supplied strings across 15 plates** through `google/gemini-3.1-flash-image` and
got **not one character wrong** — proper nouns, an umlaut, a hyphen, and five
verbatim article sentences included. So the ban was costing the reader a legible
picture to prevent a failure the new model does not have.

Four things came out of that, and each was measured rather than reasoned to:

- **Every scene the composition draws gets a title, or the plate carries no
  lettering at all.** This is the one to know, and it is **structural rather than
  an instruction**. The model's *only* misspelling in the whole spike was a word
  nobody supplied: handed a composition drawing eleven things and a list naming
  ten, it captioned the eleventh itself.
  [`lettersFor`](../../src/illustrated-plate.ts) builds that list, and
  [`plateLettering`](../../src/illustrated.ts) is a second gate on the same rule
  at the prompt.

  **The load-bearing word is *drawn*, and it is not the same list as *kept*.** A
  vignette dropped for a quote that is not in the block it names is still on the
  page — a drop cannot be excised from the composition prose without mangling it
  (§ *A drop protects the navigation, not the picture*) — so it gets its caption
  too. What it does not get is a row in the reader's legend, which is where the
  claims live and where the checking happened.

  **The first version had this backwards, and the picture said so.** It stripped
  every title from a plate that had lost one, meaning to fall back on the old
  wordless plate. Run for real on 2026-09-04, the plate came back **lettered
  anyway** — because the brief model writes its titles into the composition prose
  as well, `(SWARM OF AGENTS)` in place, where our "render no text" envelope
  simply lost the argument. Ten of eleven scenes came out correct and one caption
  was repeated on the twelfth: exactly the failure the rule was written to
  prevent, wearing the rule's own clothes. A guarantee the picture ignores is not
  a guarantee, and a wordless branch nothing can deliver is worse than no branch
  because it is written down.

  So the wordless branch is now rare and real: it fires when a drawn scene has no
  title we can use at all — none given, one over the 40-character cap, one carrying control
  characters — and then there genuinely is a scene nobody can name.
- **`1K`, not `2K`, and it is not a compromise.** Cheaper ($0.068 against
  $0.101), 40% faster, and *more* legible at 288 px — 10.5 px of cap height
  against 7.3. A larger plate makes the enlarged view better and the thumbnail
  worse, because the model spends the extra pixels on detail rather than on type.
- **The size clause is a number or it does nothing.** *"at least one fortieth of
  the page's height"* produced 56 px where a fortieth is 63; *"large enough to be
  read easily"* produced 7 px and meant nothing.
- **Don't compose scenes made of writing.** A scribe at a scroll comes back
  covered in glyph-shapes that are not words — unchanged on both Gemini models
  and on the OpenAI one. It carries no misspelling because it carries no word,
  and a reader could still fairly call it lettering. The fix is in the brief
  prompt, not in a rule about text, and on an article *about* transcripts and
  tampered logs the brief model writes scrolls anyway: a run on 2026-09-04 came
  back with banner-glyphs on a plate whose eight captions were all correct.

**What eleven real plates looked like, 2026-09-04.** Nine of nine captioned
plates spelled every supplied string correctly, and every caption was readable at
288 px. The caption's size is not constant — it falls as the plate gets more
crowded, and one plate that drew twelve roundels for eight vignettes came back at
the edge of legible where a nine-roundel plate was comfortable. So *how many
vignettes* remains the lever on how readable the thumbnail is, which is the same
thing § *Ornament may not crowd the scenes* already says for a different
reason.

**A caption in the picture is not a row in the legend, and the gap is on
purpose.** A dropped vignette's caption is on the page with nothing beneath the
plate to click; that is the same bargain the drop already made — the picture was
never checkable, the legend always was — and it is the price of not leaving an
uncaptioned scene for the model to name itself.

**The HTML legend beneath the plate is unchanged, and that is a firm decision
rather than an oversight.** The title in the picture is *wayfinding*; the checked,
block-local quote in the row beneath is the claim. A correctly-spelt caption on
the wrong vignette is a better-looking lie than a garbled one, and the legend is
what makes the plate answerable at all. The row now shows the caption above what
it depicts, so a reader who has just read a title off a vignette can find the row
it belongs to.

## The reader can say how it should come out

<a id="steering"></a>

> There should be a text input box with a microphone next to it for me to add something to the
> prompt for how I want the image to come out.
>
> — a reader, 2026-09-04 (report spya-wxd4nq)

Under the picture, and in the empty state, is one box — *How should it come out?* — with the shared
microphone ([dictation.md](dictation.md)). Whatever is in it goes with the next paint: *Paint the
argument*, *Draw the Sketch, then paint*, or *Paint again*, which sits beside a picture that is
already there and is forced. The design and its review are
[261002j](../plans/261002j-illustrated-steering-note.md).

*Paint again* is held from the press until the new painting has been read, so one press cannot buy
two paintings: [reader-profile.md § Regenerate waits for its own result](reader-profile.md#regenerate-waits-for-its-own-result).
While it is held with nothing running, the band says *The new picture hasn't loaded yet.* and offers
*Try again*, which only reads.

Four things to know before touching it:

- **The note is the job's, not the article's.** It is a field of `POST /api/jobs`
  (`illustrationNote`), frozen onto the job (`jobs.illustration_note`), and recorded on the picture
  it produced as `Illustrated.note`. Nothing stores it anywhere else — the box is filled from the
  picture's own note, so *Paint again* untouched keeps the steer and clearing the box paints plain.
  A Retry carries it; a command-line run (`npx tsx scripts/stage.ts illustrated <slug>`) and a
  reset's regeneration do not, and repaint plainly. The article-scoped alternative, which would have
  kept those two, is in the plan with why it was passed over.
- **It is in the fingerprint as a request, never as a drifting input.** The step stamps with the
  job's note and the two read sites with the picture's own, so a press with a different note is not
  skipped as done, and no picture ever goes stale because of one. A line enters `inputFingerprint`
  and the work key only when there is a note, so nothing painted before it moved.
- **It reaches the brief, not the illustrator.** A fenced, quoted section of the brief's user
  message, present only when there is a note — so a plate without one is asked exactly what it was
  asked before and `ILLUSTRATED_VERSION` did not move. The section says what a note may change
  (style, emphasis, how many vignettes, how crowded, how large the lettering) and that it adds
  nothing the article does not say.
- **That is a bar, not a boundary**, said plainly: the brief model can copy note text into its
  composition or a title, and both reach the illustrator. It is the residual
  [§ an article's author can influence](#it-is-an-interpretation-and-the-app-says-so) already
  accepts, with the owner as the persuader on their own picture. What holds is structural and does
  not read the note: block-local quotes, the title caps, *caption every drawn vignette or none*.
  The note itself is capped at 400 characters and refused — never cut — for control, zero-width
  and bidi characters, by the predicate the brief's own fields use; it is never logged (its length
  is) and is stripped from `publicJob`.

## It is an interpretation, and the app says so

**This is the one picture here that cannot be checked**, and
[§ What is deliberately not here](diagram.md#not-doing) is where that objection was
originally raised and sustained. Illustrated does not answer it — it accepts it.
A genuine, verbatim, block-local quote can still be paired with an invented
scene, and the image model can ignore the brief entirely.

So three things are owed to the reader and are not decoration: a **visible label**
saying this is an illustration of the argument rather than a diagram of it; the
**brief itself** under the picture, because a prompt can be read against
the article where a picture cannot; and **Sketch one chip to the left**, still the
diagram of record.

The label is a line of its own and never a tooltip — a thing you have to go looking
for has not been said. The brief is one press behind a `<details>` rather than
open: it is 200–500 words of composition plus the register the model chose, which
open by default pushed the *what it depicts* list off the bottom of a 1280-tall
screen. The one that must be readable without a gesture is the label.

### At full screen the brief is a column, not a `<details>`

Greg, 2026-09-05 (SPIDERYARN-READING2-1P):

> For the Illustrated diagram, if I have clicked Enlarge, show the prompt text in
> a column to one side so I can scroll up down independently through that text
> while looking at the image it refers to.

Which names the one thing a `<details>` under the picture cannot do. It sits
*below* the plate in a single scrolling column, so reading the brief against the
picture means scrolling the picture off the screen — and reading it against the
picture is the entire reason the brief is shown at all.

So above 1080px the overlay has two columns: the plate with its list, and the
brief with its own scroller, `.ill-aside`. They are siblings inside the same
`<dialog>`, which was already a centred flex row, so neither knows about the
other and each scrolls alone.

**The prompt is on screen exactly once at any width.** One media query flips both
copies together — below the breakpoint there is no room for a column, so the
column is not drawn and the band's `<details>` stays; above it, they swap. Two
queries would leave a width where both showed or neither did.

Stacking was the alternative for narrow screens and is worse: `.ill-in-full` is
`height: 100dvh`, so a column stacked under it begins one whole screen down,
which is the scrolling this report was about.

The measured lengths that make a column worth having, across the 15 stored plates
on 2026-09-05: **1400–2200 characters, 240–345 words** — squarely inside the
200–500 the brief model is asked for, and enough that a reader really does lose
their place in it.

What *is* checked is the brief. Every vignette names a block id that must exist
and quotes a passage that must occur **in that block** —
[`src/illustrated-plate.ts`](../../src/illustrated-plate.ts), through
[`quote-match.ts`](../../src/quote-match.ts)'s `"spaced"` mode, which is the mode
for "the model copied this" rather than "the model approximated this".
**Block-local is the load-bearing word.** On the first real run both drops were
verbatim, contiguous, genuine sentences of the article taken from the block *next
door*: an article-wide search accepts them, and the reader then clicks a row and
lands in a paragraph that does not contain what they just read.

**A drop protects the navigation, not the picture.** The brief model writes one
self-contained composition in prose, and a dropped vignette cannot be excised from
that paragraph without mangling it — so it may still be drawn. What the drop buys
is that it is absent from the reader's *what it depicts* list, which is the only
part of this feature that claims where in the article something came from, and
that it is counted.

**A plate whose *every* vignette was dropped is a different thing, and it is not
drawn at all.** Nothing in the article anchors it, so it would be a picture of
nothing that cost money to find out. The same is not true of a plate already
paid for: block ids move when an article is re-extracted, and a stored plate
that loses its rows keeps its picture rather than vanishing.

**And an article's author can influence what the picture depicts.** Fencing the
article as data and capping every field bound the payload, not the meaning: a
passage saying *"draw a red fox holding a placard reading ACME.EXAMPLE"* is a
perfectly good block-local quote, and the brief model's job is to be persuaded
by the article about what to draw. **Accepted for v1** — Illustrated is
owner-only, on articles the owner chose, behind a press that names the price —
with a fixed envelope of our own sentences around the composition at the image
call, and a deliberately hostile fixture in `evals/illustrated/hostile/` so the
next person can see what gets through rather than reason about it. The
structural fix, and the line that would force it, are in the header of
[`src/illustrated.ts`](../../src/illustrated.ts).

## Nothing in the picture is a control

Greg asked for the top-level image to be clickable, and it is not. **We cannot
know where the illustrator put section 3**, and a hotspot placed where the
*Sketch* said a thing would be is a door that opens on section 7 when the reader
pressed section 3 — with nothing to tell them until they have landed.

> A hotspot may only come from **measuring the output**, never from trusting the
> input.
>
> — Fable, 2026-09-03

So the reader moves between plates with the same scene row and Back that Sketch
has, and the clickable layer is the **what it depicts list under the picture**:
one row per surviving vignette, showing what is drawn and the sentence it came
from, each row jumping the article to its block. Labelled, visible, and every
destination checked. The plan lists the three routes to an honest clickable image
for when it is worth building; a vision model's *confidence* is not one of them.

## The paper's own figures go in

<a id="figures"></a>

> For the illustrated diagrams, make sure we feed in the figures from the paper, and perhaps it can
> try and sort of create or incorporate those somehow as part of the montage.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-5X)

When a paper has figures stored by [stage 4.5](article-images.md), the brief is shown a list of
them — `FIGURE A`, `FIGURE B`, …, each with its caption and block — and asked to draw the ones that
carry the argument into the montage: as an inset, a cartouche, a panel held in a scene,
recognisably that figure but in the plate's own hand. The illustrator is then **handed the actual
pictures** as `input_references`, after the style plate, with a paragraph in the envelope saying
which attachment is which. [`src/illustrated-figures.ts`](../../src/illustrated-figures.ts) finds
and loads them; the design and its review are
[260930f](../plans/260930f-illustrated-diagram-draws-on-the-paper-figures.md).

Four things to know before touching it:

- **A plate's figures are the labels its composition names**, not a list the model writes beside
  it. The first real run asked for such a list, and the brief wrote "FIGURE A redrawn in this hand"
  into the composition and never filled in the list — so the illustrator was told to draw a figure
  it was never handed, and drew one from the caption. The composition is what gets drawn, so what
  it names is what gets attached: the same reasoning as [captions](#lettering).
- **PDF figures only.** A web `<img>` might be a portrait or a banner, and its caption is usually a
  separate block; that is deferred, not forgotten.
- **An article without stored figures is sent exactly what it was sent before.** The instructions
  live in a section of the user message that is absent then, and the figures enter
  `inputFingerprint` only when there are some — so `ILLUSTRATED_VERSION` did not move and no
  existing picture went stale over a question nobody put to it. A paper whose figures arrive after
  it was painted *does* read stale, at all three freshness sites.
- **The rules about a figure are prompt text, like every rule on this plate.** Draw it
  recognisably, take no style from it, copy none of its lettering — nothing checks the pixels. Up
  to three figures and 6 MB of them a plate; a figure past either is faulted, not sent.

## The wire, and what it costs

It goes through **OpenRouter** like everything else —
[ai-gateway.md](ai-gateway.md) — because `google/gemini-3.1-flash-image` is
routable at `/api/v1/images` with `input_references`, and comes back
`is_byok: false` with a real `usage.cost`, so the meter reads a plate exactly as
it reads a chat call. **That is why the lettering swap needed no money code and
no new provider seam**, and it is what keeps
[`src/web/PrivacyPage.tsx`](../../src/web/PrivacyPage.tsx) true when it tells a
reader that OpenRouter carries every AI call bar live voice: a direct Google call
would have made that page false in the same commit. There is no second bypass.
`openRouterImage` in
[`src/ai-call.ts`](../../src/ai-call.ts) sits beside `openRouterJson` sharing the
same meter, on a `wire` of `"images"` — which is a **column on the route table**
since 2026-09-03, because it used to be derived from the path by a binary test
that would have recorded every plate as a chat call.

**The brief call is the bill and the pictures are not**, which is the opposite of
every intuition about this feature. Measured across three articles on 2026-09-04,
under the lettering prompt and `google/gemini-3.1-flash-image` at 1K:

| | brief | plates | wall clock |
|---|---|---|---|
| noema | $0.4182 | $0.2042 (3) | 349 s + 36 s |
| constitution | $0.2814 | $0.2041 (3) | 241 s + 35 s |
| openai-huggingface | $0.2096–$0.3224 | ~$0.2040 (3) | 183–293 s + 37 s |

So **$0.41–$0.62 an article, two thirds of it the brief**, against Sketch's
$0.20 (about $0.10 since it moved to `low` effort on 2026-10-01), and comfortably inside the 760 s lease. Two things moved on 2026-09-04 and
they moved in opposite directions: a plate went from about $0.013 to **$0.068**,
because it is priced on the wire now rather than arriving as a BYOK figure; and
the brief got longer, because it writes a title for every vignette. The earlier
numbers — $0.23–$0.38 an article, 80–88% of it the brief — are in
[`evals/results/illustrated-v2b/README.md`](../../evals/results/illustrated-v2b/README.md),
and the before-and-after of the prompt that produced them is
[§ Tuning the prompt](../plans/260903c-illustrated-diagram-sub-mode.md#tuning-the-prompt-illustrated2).

**The brief call stays at `high` effort**, measured on 2026-10-01: at `low` and at `medium` both
judges found the briefs worse — generic styles and riddle captions —
[261001c § Illustrated](../investigations/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md).

Plates are stored content-addressed in the blob store, never base64 in the
artefact, and a plate's media type is decided **from the signature, never from
what the provider claimed**.
[`src/illustrated-image.ts`](../../src/illustrated-image.ts) accepts exactly two
— JPEG and PNG — and refuses anything else rather than writing an object under a
name that is not true.

**They are PNGs now, and that is a cost worth naming.** The old model honoured
`output_format: "jpeg"` despite not advertising it, and this file used to warn
that such a thing "stops being true one day without anybody being told". It did:
`google/gemini-3.1-flash-image` ignores the field and returns PNG whatever it is
asked. So a 1K plate is about **1.9 MB** where a JPEG was about 150 KB — roughly
7.6 MB of storage per illustrated article, and one of those down the wire when a
reader opens the mode. Re-encoding was weighed and refused: the only decoder here
is `@napi-rs/canvas`, which
[`tests/pdf-bundle-trace.test.ts`](../../tests/pdf-bundle-trace.test.ts) keeps out
of the API bundle because it costs **34 MB** there, and a hand-rolled JPEG encoder
is a DCT and a Huffman table. Beside $0.27–$0.40 of model spend an article, the
bytes are the cheap part. If the *download* turns out to matter, the two ways
forward are the 34 MB or an encoder, and that is Greg's call.

Both extensions are live at once, because an article painted before 2026-09-04
still holds JPEG plates. The extension in the plate URL must **match** the stored
record, so a `.jpeg` URL can never be answered from a PNG — the URL is a promise
about the bytes exactly as the storage key is.

## Where the pieces are, and the two things that are unlike every other mode

| | |
|---|---|
| the brief's schema and its two readers | [`src/illustrated-plate.ts`](../../src/illustrated-plate.ts) |
| the two calls, and what it was painted from | [`src/illustrated.ts`](../../src/illustrated.ts) |
| a plate's bytes, validated and content-addressed | [`src/illustrated-image.ts`](../../src/illustrated-image.ts) |
| the paper's own figures, found and loaded | [`src/illustrated-figures.ts`](../../src/illustrated-figures.ts) |
| the step | `illustrated` in [`src/pipeline.ts`](../../src/pipeline.ts) |
| the routes | `/api/illustrated/:slug` and `/api/illustrated/:slug/:hash.(jpeg\|png)`, [`src/routes.ts`](../../src/routes.ts) |
| the read (the painting and its flags as one value: [sketch.md § The scene is checked again in the browser](sketch.md#the-scene-is-checked-again-in-the-browser)), and whether the button would be refused | [`src/web/useIllustrated.ts`](../../src/web/useIllustrated.ts) |
| the plate, the plate row, Enlarge, and the *what it depicts* list | [`src/web/IllustratedView.tsx`](../../src/web/IllustratedView.tsx) |
| the harness that paints one offline | [`evals/illustrated/`](../../evals/illustrated/) |
| the tests | [`illustrated-plate.test.ts`](../../tests/illustrated-plate.test.ts), [`illustrated-run.test.ts`](../../tests/illustrated-run.test.ts), [`illustrated-image.test.ts`](../../tests/illustrated-image.test.ts), [`illustrated-figures.test.ts`](../../tests/illustrated-figures.test.ts), [`illustrated-route.test.ts`](../../tests/illustrated-route.test.ts), [`illustrated-view.test.tsx`](../../tests/illustrated-view.test.tsx) |

**It is the only step whose input is another step's artefact**, and that has two
consequences worth knowing before touching either.

**The step refuses rather than pulls, and the panel offers to do both.** A run
naming `illustrated` alone still fails when the Sketch is **absent, stale, or
drawn for a different reader profile**, with a sentence ending *"Draw the Sketch
first — it is the chip one to the left"* — always before the brief call, so
nothing is spent finding out. What changed on 2026-09-03 is the panel:

> Also, let's have a way to generate it in one click even if there's no Sketch
> ready yet (it should first trigger that and then append the Illustrated to the
> queue after it automatically in one click).
>
> — Greg, 2026-09-03

**The chain had been refused the day before, and that reasoning is why the button
looks the way it does** rather than something to delete: *"not
`enqueue(["sketch", "illustrated"])`, which turns one press into a hidden $0.20
charge and a three-minute wait that nothing warned about"*. **The objection was
to the hiding, not to the chain** — so the chain landed and the price did not.
Each of the three refusal branches keeps its explanatory sentence and its "press
the chip one to the left" route — a reader who would rather look at the Sketch
before buying a painting is not doing anything wrong — and gains a *"Draw the
Sketch, then paint"* button, sitting under `SKETCH_THEN_PAINT`
([`IllustratedView.tsx`](../../src/web/IllustratedView.tsx)), which names both
steps and both waits and says that Stop takes effect after the step that is
running. It is built from `SKETCH_WAIT` and `ILLUSTRATED_WORK`/`ILLUSTRATED_WAIT`
rather than from new words, because only one of the two sentences is ever on
screen at a time — nothing would show them disagreeing. It named both *prices*
until 2026-09-30, when what AI processing costs us became the administrator's
alone ([plan 260930k § 3](../plans/260930k-high-power-for-readers-and-cost-only-for-admins.md)).

**The chain is the server's, not the browser's.** `drawThenPaint`
([`useIllustrated.ts`](../../src/web/useIllustrated.ts)) posts one job naming
both steps and `STEP_ORDER` already puts `illustrated` after `sketch`, so
`orderSteps` does the sequencing. The alternative — two POSTs sequenced by the
client — puts the ordering in a tab that can be closed halfway through.

**And it is unforced, deliberately**, which is what makes `stale` and
`profile-changed` **re-draw rather than adopt**: `stepIsDone` decides whether the
Sketch half runs, and the sketch step stamps against the same `sourceHash` and
`profileHash` the route reports those two states from, so a Sketch the panel
calls out of date is one the step cannot call current.

**The reason written here until 2026-09-03 was wrong**, and the correction is
left visible because two other copies of it were wrong the same way
([`useIllustrated.ts`](../../src/web/useIllustrated.ts) and a test's own
docstring). It said *"forcing would have to name `sketch`, and `cascadeForce`
sweeps in every step after the first forced one, so a Sketch that was genuinely
current would be redrawn for nothing"*. A force from that button names
**`illustrated`** — `useStepJob.start` sends `force: [step]`, its own step — and
`sketch` comes *before* it, while [`cascadeForce`](../../src/jobs.ts) starts at
the first forced name and looks only at what follows. Nor could it be swept in
from further back: **both** steps are in `FORCE_ONLY_WHEN_NAMED`. So the Sketch
half is unforced whatever that button does, and `stepIsDone` is the only thing
deciding it. What unforced buys is on the painting half instead — `work_key`
hashes `force` (`workKeyFor`, [`src/store/jobs.ts`](../../src/store/jobs.ts)), so a forced
press and an unforced one are two keys and two $0.27–$0.40 jobs where the queue
would otherwise collapse them into one. GPT Sol, reviewing stages 2–3.

Stale and wrong-profile are refused for reasons of their own. A picture painted
from a stale Sketch is **born stale**, because the panel's `stale` covers the
Sketch's staleness too — $0.30 for something labelled out of date the moment it
lands. And a Sketch drawn for somebody else's profile would loop: the picture
inherits its `profileHash`, the route answers `profileChanged`, the panel offers
to paint again, and the next paint inherits the same hash. All three checks are
in `run` and none is in `stamp`, which is the difference between *would we paint
this again* and *may we paint it now*: a finished illustration whose Sketch has
since drifted stays done, so nothing re-runs on its own and the sentence only
appears when somebody asked.

**Its freshness is about the Sketch, not the article** —
[`inputFingerprint`](../../src/illustrated.ts). A forced Sketch redraw changes
the scene with every article byte identical, so an article-shaped fingerprint
would leave a stale illustration reporting itself current. `profileHash` is
inherited from that Sketch for the matching reason: a picture painted from a
personalised Sketch is personalised, and an owner about to publish is owed that
fact. The panel's `stale` is the wider of the two questions — it is true when
the Sketch has moved **or** when the Sketch has itself gone stale against the
article, because a picture two hops from the piece is not current either.

**The plate route never takes a key from the path.** Plates live in a
content-addressed store shared by every article and every reader, so the hash in
the URL is used only to look a plate up in *this* article's own artefact, and
the key handed to the store is rebuilt from what we wrote —
[security.md](security.md) owns that rule.

**Orphan blobs are accepted and no sweep is built.** The store is
content-addressed and create-only, so a run that draws two plates and then fails
leaves two objects nothing references. They cost about 150 KB each, the next
identical run dedups straight onto them, and a garbage collector over
content-addressed blobs has to be right about every artefact in every revision
that could still hold a hash — getting that wrong deletes a picture somebody is
looking at. Named here so the next person knows it was decided rather than
forgotten.

---

Up: [reading-view-overview.md](reading-view-overview.md) · the other pictures: [diagram.md](diagram.md)
