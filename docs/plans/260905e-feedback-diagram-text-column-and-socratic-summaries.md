# Two feedback reports: the enlarged diagram's text column, and Socratic summaries

Two unrelated reports from Greg, batched into one worktree because they touch disjoint files.
Parent: [260905b-feedback-reports-batch-three.md](260905b-feedback-reports-batch-three.md).

- **SPIDERYARN-READING2-1P** — a text column beside the enlarged Illustrated diagram. **Shipped.**
- **SPIDERYARN-READING2-1V** — make Summary mode's text more Socratic. **Shipped, but not as
  asked** — the literal request was impossible, and § below says why and what was built instead.

Both are from Greg, who is an admin, so
[feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it) says build them.
What is left is *how*, and for 1V the *how* turned out to be the whole question.

---

## 1P — the enlarged diagram's text column

### The ask

> For the Illustrated diagram, if I have clicked Enlarge, show the prompt text in a column to one
> side so I can scroll up down independently through that text while looking at the image it refers
> to.
>
> — Greg, 2026-09-05 (SPIDERYARN-READING2-1P)

### Is it long enough to be worth a column? Yes — measured

The brief asked me to check this rather than build blindly, since a two-line prompt in a column
would be worse than what is there. Measured across the 15 stored plates in `evals/results/`:
**1400–2200 characters, 240–345 words**, which is squarely inside the 200–500 words
`src/illustrated.ts` asks the brief model for. Long enough to lose your place in. The column earns
itself.

### What was built

`plate.prompt` was already on screen — inside a `<details className="ill-brief">` in the shared
`body` fragment, which the full-screen overlay renders as-is. The `<details>` sits *below* the
plate in one scrolling column, so reading the brief against the picture means scrolling the picture
away. That is exactly the complaint.

The change is an `<aside className="ill-aside">` rendered as a **sibling of `.ill-in-full` inside
the existing `<dialog>`**, plus one media query.

**Why a sibling.** The dialog is already `display: flex` with `justify-content: center`, so a second
column needs no new container, no change to the `body` fragment, and no change to any shared
component. The plate column keeps its own `.ill-scroll`; the new one has its own; they scroll
independently because they were always two boxes.

**The simpler option passed over, and the one that looked simpler and was not.** The obvious move
was to reuse [`Lightbox.tsx`](../../src/web/Lightbox.tsx). It is the wrong file: Illustrated's
Enlarge is a *separate, parallel* `<dialog>` (`.ill-full`), and `Lightbox` is only ever mounted by
`TableView.tsx` for zoomed prose figures. Changing `Lightbox` would have risked a surface nobody
asked about and touched nothing this report is about. Verified by a whole-repo grep: `SketchView`,
`IllustratedView`, `FeedbackDialog`, `zoomable.ts` and `external-links.ts` all *mention* Lightbox in
comments as the precedent they copied, and none imports it.

### The narrow-screen judgment, which the brief asked me to make and record

Below 1080px there is no room for a column beside a `min(94vw, 720px)` plate. Three options:

1. **Hide the column and keep the band's `<details>`** — chosen.
2. **Hide the column and nothing else** — rejected outright: the `<details>` is hidden at wide
   widths to avoid showing the prompt twice, so this leaves a narrow-screen reader with no way to
   read the brief at full screen at all. That is a regression, not a trade-off.
3. **Stack the column under the plate** — rejected. `.ill-in-full` is `height: 100dvh`, so a stacked
   column begins one whole screen down. The reader would scroll a screenful of picture to reach the
   text and then scroll it back to look at what it describes, which is the exact motion this report
   is asking us to remove.

So: **one media query flips both copies together.** Hidden is the default and wide is the exception,
which means there is no width at which both are drawn or neither is. Two queries sharing a
breakpoint could disagree by a fraction of a pixel; one cannot.

Breakpoint 1080px = 720 (plate) + 340 (column) + gutters.

### Keyboard and touch, since a lightbox has behaviour a new region can steal

- **Escape still closes it**, because nothing here adds a key handler — the native `<dialog>` owns
  it ([`Lightbox.tsx`](../../src/web/Lightbox.tsx) § the four things `showModal()` gives).
- **The arrows still belong to the article.** No arrow handling was added;
  `tests/arrows-belong-to-the-article.test.tsx` is the repo-wide sweep that keeps it that way.
- **The backdrop click still closes.** The dialog's handler tests `e.target === dialog`, and a click
  inside the aside has the aside as its target, so it does not close by accident.
- **The scroller has `tabIndex={0}`, and is a labelled `<section>`.** It contains no control, so
  without a tab stop a keyboard reader cannot reach the bottom of 350 words — the browser's own
  scroll-box behaviour, not a new key binding. Biome's `noNoninteractiveTabindex` fires on it, and
  the rule is right in general and wrong here; rather than shrug, the element became a `<section>`
  with `aria-labelledby` pointing at the column's heading, so focus lands somewhere named, and the
  remaining suppression carries that reasoning.
- **`overscroll-behavior: contain`**, so a trackpad flick at the end of the brief does not scroll
  the article behind the overlay — `.ill-scroll` has it for the same reason.

### Tests

`tests/illustrated-view.test.tsx` gains *"puts the prompt beside the plate, in its own scrolling
column, once enlarged"*: the column is absent before Enlarge, present inside the dialog after, holds
the prompt text, and its scroller is focusable. **Seen red** (`expected null not to be null`) with
the render disabled, green with it.

jsdom has no layout and no media queries, so what a test can prove here is the markup. That the two
columns sit side by side, and that exactly one copy of the prompt shows at a given width, is CSS —
so it was checked in a real browser.

### The browser pass, and the bug it found that this change did not cause

Checked in Chrome on the box via a throwaway preview page built to the repo's own convention
(`preview-illustrated.html` + `src/web/preview-illustrated.tsx`, beside `preview-sketch.tsx`), which
mounts the **real** `IllustratedView` with the real stylesheet and a stubbed `fetch`. Measured, not
eyeballed — `getComputedStyle`, `getBoundingClientRect`, `scrollTop`, `Element.checkVisibility()`.

All five claims passed: one visible copy of the prompt at 1280 and one at 900, independent
scrolling (the aside scrolled to its end while the plate column and the window both stayed at 0),
no overlap or clipping, and Escape still closing the overlay.

**And it found a real bug that predates this report.** `.ill-in-full` also carries `.ill`, which is
`flex: 1` — and a non-`auto` `flex-basis` beats `width` for the main-axis size, so
`width: min(94vw, 720px)` had **never once applied**. At 1280px of viewport the panel was 1280px
wide. It went unnoticed because `.ill-in-full .ill-plate` caps the picture at 78vh, so the surplus
was empty space rather than the 1920-tall plate the CSS comment warns about; adding a column beside
it is what made it visible. Fixed with `flex: none` and re-verified: the plate column now measures
exactly 720px (left 110, right 830) with the 340px column adjacent (830→1170), the pair centred
symmetrically in 1280, and at 900px the panel is still 720 rather than 94vw's 846.

This is the kind of thing only a browser finds — the unit tests were green throughout, on both
sides of the bug.

---

## 1V — Socratic summaries

### The ask

> Tweak the prompt that generates the Summary mode to be a bit more in the form of Socratic
> questions that encourage the reader to read the actual text to get the full answers
>
> — Greg, 2026-09-05 (SPIDERYARN-READING2-1V)

### There is no prompt that generates Summary mode

Established by reading the code, not assumed.
[summaries.md](../project/summaries.md) says it outright — *"There is no stage, no artefact and no
route: everything on screen arrives inside the article payload"* — and the code agrees. Summary mode
renders the one-sentence **`gist`** that **stage 4** writes onto every internal node of the tree,
from the `GISTS` section of `SYSTEM` in [`src/hierarchy.ts`](../../src/hierarchy.ts).

That same `gist` string is rendered in **ten other places**. Verified by grep of `src/web` on
2026-09-05:

| Surface | File |
|---|---|
| the granularity-zoom gist columns (the flagship) | `TableView.tsx:1047` |
| spine hover tooltips | `Spine.tsx:993` |
| the article's own blurb at the top | `Masthead.tsx:286`, `Metadata.tsx:657` |
| the shelf card blurb, own and public | `ShelfEntry.tsx:186`, `PublicLibraryPage.tsx:296` |
| the prose hover card for a library link | `ProseHoverCard.tsx:617` |
| outline rows | `OutlinePanel.tsx:362` |
| diagram node cards | `DiagramPanel.tsx:2784` |
| the fisheye column context | `ContextList.tsx:81,138` |

**And it is an input, not only an output** — the argument that actually settles it, which Fable
found and I verified. `chainRung` and the outline renderer in
[`hierarchy-expand.ts`](../../src/hierarchy-expand.ts) (lines 331, 337) feed ancestor gists back
into the later structure waves as context. A gist bent towards questions would therefore degrade the
trees the cascade goes on to build, not merely the sentences on screen. One prompt edit, ten
regressions.

So the literal request — edit the `GISTS` lines — is refused, and something better is built.

### Options weighed

Arbitrated by **Fable**, per the brief, since this is a product call with two defensible answers.

- **A. Blend claim-and-question into the shared gist.** One prompt edit, and the cheapest. Rejected:
  turns shelf blurbs into questions and poisons the cascade's own context.
- **B. A new optional `question` field on the same stage-4 call, rendered only in Summary mode.**
  Chosen.
- **C. The question replaces the gist in Summary mode.** Rejected: closer to the literal words, and
  it fails [vision.md](../project/vision.md)'s *scan before you commit*. A reader skimming a long
  piece needs to know what a section says. Greg asked for *"a bit more"*, not a conversion.
- **D. B, restricted by depth.** Adopted **together with B** — see below.

### What was built

`TreeNode.question`: one Socratic question, on the **root and depth-1 nodes only**, written by the
same stage-4 structure call (no extra model call — about 25 more output tokens on each of ~6–10
nodes), and drawn **only** in `SummaryPanel`, under the gist, italic and a step smaller.

**Depth is enforced in code, not merely requested in the prompt.**
[`questionFor`](../../src/hierarchy.ts) drops anything deeper. One question per section on a
fifty-section article is noise; the default cut-off (`deep=1`) draws only these rows anyway; and a
scope the code holds is a fact rather than a hope. It also means
[`hierarchy-expand.ts`](../../src/hierarchy-expand.ts) — which only ever writes depth ≥ 2 — needs no
change at all, including its strict `["start","title","gist"]` field validator.

**The gist stays on every row.** The claim says what the section says; the question is the door.
That pairing is the *"a bit more"* Greg asked for, and it is the same job the block ids already do
in [summaries.md § A summary is a door](../project/summaries.md#a-summary-is-a-door).

### The evidence: one real run, both ways

A prompt change with no before-and-after is unfalsifiable, so I ran the real structure call through
the real `structureRequest` on a real article — **noema-mythology-of-conscious-ai, 141 blocks,
2026-09-05**. One call, no artefact written, nothing else on the box touched.

**Before** (the stored `tree.json`, built under `toc/4`): no `question` on any node. The field did
not exist. Every row of the Summary panel was a gist and nothing else.

**After** (`toc/5`), verbatim, root and all five parts:

| | gist (unchanged in kind) | question (new) |
|---|---|---|
| **article** | Because psychological biases make AI seem conscious while brains' biological, non-computational nature makes real machine consciousness unlikely, we must resist both false belief and false dismissal… | *Could AI ever really be conscious, and how should that shape our behavior?* |
| **1** | Anil Seth, a leading consciousness researcher, opens by asking whether AI is or could become conscious and why that matters. | *Why does the question of conscious AI matter so much?* |
| **2** | Psychological biases—anthropocentrism, exceptionalism, anthropomorphism, language cues…—make us overattribute consciousness to AI. | *Why do we so readily believe AI might be conscious?* |
| **3** | Computational functionalism—the assumption that the right computation suffices for consciousness—is undermined by four arguments… | *Why might computation not be sufficient for consciousness?* |
| **4** | Given deep uncertainty, we should avoid creating conscious AI while also managing the distinct ethical dangers of merely conscious-seeming AI. | *How should we act given uncertainty over AI consciousness?* |
| **5** | Rejecting both silicon-rapture fantasies and human self-erasure, Seth argues our essence lies in embodied, biological aliveness… | *What should conscious AI mean for how we see ourselves* |

**Three things this run settled that reading the prompt could not:**

1. **The model honours the depth restriction on its own** — six questions, none on any depth-2
   section. The code guard is belt-and-braces rather than the only thing holding the line.
2. **The questions are Socratic rather than lookups.** Every one is a *why* / *how* / *what follows*
   that the argument has to answer, not a fact a sentence settles. The gist says *that*
   functionalism is undermined; the question asks *why*, and the answer is in the prose. That is the
   intended relationship.
3. **Part 5's question came back with no question mark.** My first validator required one and would
   have discarded a perfectly good question over punctuation — invisibly. That is a
   [silent success](../reusable/silent-success.md) I built and the run caught.

So the rule changed to add the mark rather than require it. **The first version of that fix also
dropped anything ending in `.` or `!` as a "statement", and GPT Sol was right to kill it** (F5): a
full stop is not evidence of mood. *"How did this affect the U.S."* is a question that rule
discarded — invisibly — while a genuine statement without a mark went straight through. It made the
silent mistake on good input and the visible one on bad, which is exactly backwards.

The rule now is syntactic and does one thing: strip a trailing `!`, append `?`. Not the `.`, because
stripping it turned *"the U.S."* into *"the U.S?"*. And the failure the prompt actually names —
*"never the gist with a question mark on it"* — is caught by **comparing the question with the
gist**, ignoring case and punctuation, which is the only check here that means what it says. Nothing
mechanical can catch a lookup question dressed as a Socratic one; that is what the prompt and
reading the output are for.

The named cost: a genuine statement that is not the gist comes out as *"…something.?"* — ugly and
**visible**, which is the right way round.

**Spend: one structure call, in≈19,767 / out≈2,795 tokens on `anthropic/claude-sonnet-5`, roughly
$0.10.** It ran outside a spend collector (the log said so), so it is in no ledger total; recorded
here instead.

### Caching — what has to happen for existing articles

**Nothing regenerates on its own, and this matters more than it looks.** Stage 4 is checkpointed on
a digest of the request ([`source-hash.ts`](../../src/source-hash.ts)), and a *finished* tree is
simply a finished tree — there is no re-run trigger.

- `PROMPT_VERSION` moved `toc/4` → `toc/5`. That is correct and necessary: it stops an article
  part-way through the stage resuming onto a prompt that no longer asks the same thing, which would
  give it questions on some parts and none on others with nothing to say why.
- It does **not** backfill anything. Every article already in the library keeps its `toc/4` tree and
  shows no questions at all.
- To pick it up: `npm run hierarchy -- <slug> --force`, one structure call per article (~$0.10–0.26
  by [`hierarchy-prompt.ts`](../../src/hierarchy-prompt.ts)'s measured figures).

**For Greg:** the feature is invisible on every existing article until you re-run hierarchy on it.
That is the honest cost of putting the field on the tree rather than in a stage of its own, and the
alternative was rejected as too much machinery for a v1 — see below.

The checkpoint-key pin in `tests/hierarchy-prompt-hoist.test.ts` moved with it
(`2993e1e4b2aaf1d6` → `18e7504c732c5722`), which is that pin doing its job rather than failing at
it: it exists to stop anyone moving those bytes *without meaning to*.

### The GPT Sol review, and what it changed

Round one, on the committed code, with the diff and the tests to run. It reproduced its findings
rather than reasoning to them, which is why three of them stood.

- **F1 (P1) — fixed, and it was a real bug I would have shipped.** `proposalFromTree`
  (`src/hierarchy-cascade.ts`) did not copy `question`, so **deepening any one section rebuilt the
  tree and wiped every question in the article**. Sol reproduced it: four before `deepenTree`, zero
  after. The function's own comment states the rule I broke — *"a field the tree carries must not
  vanish on the way back out"*. The fix is one line; the guard is that the shared round-trip fixture
  in `tests/hierarchy-cascade.test.ts` now carries questions, so `toEqual(proposal)` catches it.
  Seen red.
- **F2 (P1) — counted rather than repaired.** Questions are filtered on *proposal* depth, and
  `collapseRestatedRungs` can splice away a depth-1 rung so its depth-2 children — correctly written
  without questions — become the parts. Those parts show none, and `droppedQuestions` read 0.
  Repairing it properly means asking the model for questions one level deeper on **every** article
  to cover a rung that collapses rarely; that is a worse trade than the absence. So the loss is now
  counted, which makes it diagnosable, and the absence is documented. Test seen red.
- **F3 (P1) — deferred, deliberately.** My claim that expansion only writes depth ≥ 2 is false: a
  flat root can itself land on the deepening frontier, and expanding it creates depth-1 children.
  I had spotted the same hole before the review and Sol reproduced it on a ten-block flat root.
  **Not fixed**, because the fix is to teach `hierarchy-expand.ts`'s *second* prompt and its strict
  field validator to write and carry questions — the scope this change deliberately excluded. The
  consequence is benign and of a kind the design already handles: those parts show no question,
  which is what every pre-2026-09-05 article shows. It affects only the opt-in deepening path on a
  flat article. Named here so the next person meets it as a decision rather than a surprise.
- **F4 (P2) — fixed.** `droppedQuestions` reached the eval's `BuildReport` but was dropped from the
  saved result and the printer, so the harness whose job is to notice prompt drift could not report
  the one new way this prompt can drift. Threaded through, optional, read via `?? []` exactly as
  `collapsedRungs` is, so old result files still print.
- **F5 (P2) — fixed, see above.**

Sol found nothing wrong with the diagram breakpoint or its accessibility, the public-DTO decision,
or the checkpoint-key update, and ran 136 + 94 tests itself.

**Not sent for a round two.** The three fixes are small and each is covered by a test seen red
first; F3 is a deferral rather than a fix, and it is written down here.

### Deferred, and why

- **Questions on sections (depth ≥ 2).** The named follow-up if use shows readers want a hook per
  section. Simplest first; it would also mean changing `hierarchy-expand.ts`'s second prompt and its
  validator, which this change deliberately does not touch.
- **A backfill stage.** A separate light call in the `arc.json` shape could give existing articles
  questions without a full re-run. It costs a stage, an artefact and a route, and with a small beta
  readership and Greg re-running his own articles, the field on the tree is the right v1.
- **Questions on a flat article's parts (GPT Sol F3).** See above — it needs the expansion prompt
  and its validator, and the failure is benign absence.
- **A token-budget bump.** Not needed and deliberately not made: `TOKENS_PER_NODE` is 175 against a
  worst measured per-node cost of 145, and questions are added to ~6–10 nodes at ~25 tokens each
  (~250 total). The headroom already there dwarfs it, and that constant carries its own measurement
  history that a speculative bump would muddy.

### Tests

- `tests/hierarchy-build.test.ts` § *the Socratic question* — kept on root and part; dropped below;
  a statement dropped; a blank dropped; a missing `?` added; a tree never asked for questions
  unchanged; both losses counted. **Each seen red for its own reason**: with the depth guard
  removed, the depth tests fail; with the field never kept, the keep tests fail.
- `tests/summary-expand.test.tsx` § *the Socratic question in the panel* — one line under the
  article and each part, **every gist still present** (the assertion that would catch option C
  arriving by accident), and nothing at all drawn for a pre-2026-09-05 article. Seen red.
- `tests/public-dto.test.ts` — `Required<TreeNode>` forced the decision about whether the field
  crosses the public boundary. It does: Summary mode is a public surface too.
- `tests/hierarchy-structure-request-parity.test.ts` — the byte-for-byte `SYSTEM` pin, updated
  deliberately, which is the point of having it.

`droppedQuestions` is threaded to the run summary and into `pipeline.ts`'s report, so it is a number
somebody reads rather than one that is merely collected.

---

## Assumptions and open questions

Recorded here rather than asked, per the brief — this ran unattended.

1. **1V is not what Greg literally asked for.** He asked for a prompt tweak; he got a new field and
   a new line, because the prompt he meant is shared with ten surfaces and with the cascade's own
   input. If he wanted the gists themselves more interrogative and accepts the shelf-card cost, that
   is option A and it is a small change from here.
2. **Existing articles show nothing until re-run.** Flagged above and in
   [summaries.md](../project/summaries.md); Greg may want a batch re-run of his own library.
3. **The 1080px breakpoint is reasoned, not measured in a browser at every width.** It is
   720 + 340 + gutters.
4. **One article's worth of question quality.** Six questions on one essay is enough to show the
   shape is right and to catch the missing-`?` case; it is not an eval. There is no existing
   summaries eval to lean on — `evals/hierarchy-structure` scores *structure*, not gist or question
   quality.
