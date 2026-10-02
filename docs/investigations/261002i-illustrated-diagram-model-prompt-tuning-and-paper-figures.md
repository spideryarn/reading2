# Illustrated: the image model, the brief prompt, and feeding in the paper's figures

Written 2026-10-02 from the runs of 2026-09-03 and 2026-09-30. Plans:
[260903c](../plans/260903c-illustrated-diagram-sub-mode.md) (the sub-mode, the first runs and the
`illustrated/1` to `illustrated/2` prompt tuning) and
[260930f](../plans/260930f-illustrated-diagram-draws-on-the-paper-figures.md) (figures). Two
neighbours are written up elsewhere and not repeated: the switch of image model for lettering is
[260904a](260904a-nano-banana-text-in-generated-images.md), and the thinking-effort comparison for
the brief call is
[261001c § Illustrated](261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md).
The live design is [illustrated.md](../project/illustrated.md), which also carries the current cost
table.

## The questions

1. Can an image model draw a more engaging version of Sketch from Sketch's data without inventing
   things outside the article? Greg, 2026-09-03 (from 260903c): *"Most importantly, it should
   restrict itself to what's in the article, i.e. no extemporising or generalising or stuff from
   outside the article."*
2. What does it cost, and which of the two calls (the brief, the plates) is the bill?
3. Does the first prompt (`illustrated/1`) hold up across different articles?
4. Greg, 2026-09-30 (feedback 5X): *"For the illustrated diagrams, make sure we feed in the figures
   from the paper..."* Does the image model accept them, and does the brief use them?

## What was measured

**Model and wire** (260903c, spikes of 2026-09-03). `openai/gpt-image-2` through OpenRouter's images
endpoint (not direct OpenAI, a deliberate variance from Greg's "use OPENAI_API_KEY", flagged in the
plan for ratification). `low` quality, 2:3 portrait, JPEG at compression 82. A plate took 19-43 s
and about $0.008 (text only) to $0.013-0.020 (one reference image); `low` was judged already good and
medium/high cost roughly 4x and 10x the output tokens for a picture that is scaled into a 288 px band.

**Cost, `illustrated/1`** ([illustrated-2026-09-03b](../../evals/results/illustrated-2026-09-03b/README.md),
[illustrated-oaihf-base](../../evals/results/illustrated-oaihf-base/README.md), and the older
[illustrated-2026-09-03](../../evals/results/illustrated-2026-09-03/README.md), drawn before JPEG
was requested): the brief call, not the pictures, is the bill. `noema` $0.2222 and $0.2740 for the
brief against about $0.044 for three plates; `constitution` $0.3593; `openai-huggingface` $0.2025.
The plan's summary: $0.27-0.40 an article, 86-89% of it the brief.

**Prompt tuning, `illustrated/1` to `illustrated/2`** (the table in 260903c § "What changed,
measured"; `illustrated-v2`, `illustrated-v2b`):
- `constitution`: 18 kept (0 dropped) to 26 kept (0 dropped), brief $0.3593 to $0.3322.
- `openai-huggingface`: 28 kept (2 of 30 dropped) to 25 kept (0 of 25), $0.2025 to $0.1829.
- `noema`: 26 kept (4 of 30 dropped) to 26 kept (1 of 27 dropped), $0.2740 to $0.2987.
- Six edits, each tied to a thing seen in the plates: the quote must name the thing drawn (six of
  fourteen noema overview roundels were emblems on real quotes); a tier for abstract articles; a
  zoom plate is the inside of one part of the overview; the "section headings may be lettered"
  exception removed (one heading in three came out correct, misspelt, or omitted across three
  draws of one brief, the first being "SOUL MACHINE" rendered "S-omega-UL MACHINE"); ornament capped and 8-11
  vignettes rather than 8-14; copy the article's punctuation exactly.

**Figures** ([illustrated-figures-260930](../../evals/results/illustrated-figures-260930/README.md),
local paper `entropy-24-00930`, four stored figures):
- `google/gemini-3.1-flash-image` advertises image input, priced as prompt tokens at $0.50 per
  million, so a figure is a fraction of a cent (OpenRouter's live model list, read 2026-09-30).
- Run 1 ($0.53): the brief put "FIGURE A" in the overview composition but never wrote the separate
  `figures` list, so 0 figures were attached and the image model drew a Venn diagram from the caption.
- Run 2 ($0.51), after making "a plate's figures are the labels its composition names": 6 figures
  across 3 plates; Figure A recognisably redrawn as an inset, one lettering leak ("RC").
- An ordering probe ($0.14 a run, two runs; the PNGs were lost): numbering was honoured in the
  overview position; in the zoom position the order was reversed, but confounded, so unproven.

## Decisions and where they live

- Illustrated stays a second picture, never a replacement for Sketch (checkable diagram of record).
  [illustrated.md](../project/illustrated.md).
- The brief prompt is `illustrated/2` (and has moved on since); "the brief is the bill" is why the
  brief's effort was later tested (stays `high`: 261001c).
- Figures: PDF figures only, at most 8 offered and 3 a plate (6 MB), exactly-matched labels, no
  `ILLUSTRATED_VERSION` bump, figure hashes in the freshness fingerprint only when a paper has
  figures. Plan 260930f § "The design".

## Dead ends and surprises

- **Passing Sketch's rendered PNG as a reference image** (Greg suggested "that data structure and/or
  SVG"). Spike of 2026-09-03: the same brief drawn three times, once with the PNG and twice without,
  so variance had a control. No structural gain (all three kept the convergences, fork and loop); a
  stylistic loss (cold blue-grey ground, wire-like connectors, squared frames); $0.0203 against $0.008
  a plate. So the brief carries the topology in words. Passing the *overview plate* to zoom plates
  as a style reference was kept: it measurably gives one illustrator's hand.
- **Reusing the Sketch and drawing in the browser each time, storing nothing.** Rejected: a bill
  nobody agreed to and a picture that changes under the reader. 260903c § "The simpler option".
- **The register is a lottery.** Same noema Sketch: an illuminated page under `/1`, an antique map
  under `/2`. A regenerating reader gets a different look. Widening the register list was not taken.
- **A modern subject in a medieval register turns into monks** (`openai-huggingface`).
- **Zoom plates re-draw the overview** (the style reference is used as a base to edit), seen in
  both figure runs, and not fixed.
- **The brief naming a figure but not listing it** (run 1) is why the design moved from a separate
  list to reading the composition.
- **A latent bug**: `ILLUSTRATED_VERSION` and `PROMPT_VERSION` were two equal literals, so bumping one
  made every fresh artefact read `outdated`. Now one constant.

## Caveats

Three articles for the prompt tuning, two of them at the final wording (noema's `/2` plates predate the
last width instruction); one article for figures, two runs; no check of pixels anywhere. Costs here
are the BYOK-era figures; plate cost on the Gemini wire is higher ($0.068 each, per illustrated.md),
so use illustrated.md for current numbers.

## Re-run

```
npx tsx evals/illustrated/run.ts   # see its header for flags (--check); paid
```
The figures runs went through the queue, not the harness (260930f says the harness passes no figures).

Up: [research.md](../project/research.md)
