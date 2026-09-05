# Socratic summaries, admin page gating, and selections under eight characters

Greg's answers to the six open items left by
[260905b](260905b-feedback-reports-batch-three.md), 2026-09-05. Three of the six became work; two
were closed with a word ("don't worry about backfill", "good enough for now"); the sixth is a
judgement he made himself.

**Status:** planning. Written before the work, per
[engineering-manager.md](../reusable/engineering-manager.md).

## What he asked for, verbatim

> 1+2 Hmmm, your example there looks a bit crap. The idea was to replace the current Summary output
> with something a bit more Socratic (i.e. what question is this answering). But it needs to be
> detailed enough to be interesting. So maybe the question could be "Computational functionalism -
> why isn't computation sufficient for consciousness? (4 arguments)" or something like that, that
> gives you a sense of what to expect without answering the question it poses? Perhaps create a
> little eval (e.g. Sonnet to gather a bunch of example sections, then get Fable's help to tweak the
> Summary-generation prompts a few different ways for all the examples, then ask GPT Sol to judge
> which is best, and then update the prompt accordingly). This is tricky though, because the current
> Summary is quite good, so I'm wary of throwing out the baby with the bathwater. Don't push tooooo
> hard towards this Socratic-question approach if it's going to make things less valuable for the
> user. Other minor requests: I sometimes wish the language was slightly simpler. And the coarser
> top-level summary should be briefer, and the more granular-level summaries be a bit longer.

> 3 Don't worry about backfill

> 4 Do we have a nice reusable/general way to gate a page for Admins? If not, we should create one,
> and then use it for /design

> 5 Good enough for now

> 6 Hmm, let's try and fix the issue with not being able to select <8 characters.

## The one thing most likely to go wrong

**An eval that asks "which is more Socratic?" will answer "the most Socratic one", and that is not
the question.** Greg's constraint is the opposite of his request: the current summary is good, and
the Socratic form is a means, not the goal. So the judge is asked about **reader value** — does this
help me decide what to read, and orient me once I am reading — and the Socratic arms have to win
*that* to land. The control arm is the current prompt, unlabelled and indistinguishable, so
"change nothing" is an outcome the eval can actually return.

That is written here first because it is the assumption everything else rests on, and it is the one
a later reader would otherwise have to reverse-engineer from the rubric.

## Three requests, not one

Greg's paragraph contains three changes that are independent, and conflating them would let a good
one ride in on a bad one:

| | change | scope |
|---|---|---|
| **i** | the Socratic form — topic, the question it answers, a hint of the shape of the answer | Summary mode only (see below) |
| **ii** | simpler language | every gist, everywhere |
| **iii** | top level briefer, deeper levels longer | every gist, everywhere |

**ii and iii are true regardless of how i turns out**, so they are scored as separate axes and can
land even if the Socratic arms lose.

## The architectural crux, stated before the eval

The gist is rendered in about ten places — shelf cards, hover tooltips, diagram nodes, the article
blurb. **This is exactly why [1V](../user-feedback/260905_0954-socratic-questions-in-summary-mode.md)
put the question in a second field rather than changing the gist**: a Socratic gist turns shelf
blurbs into questions.

Greg has now asked for the Summary output *itself* to change, which reads as reversing that. It
probably is not: his example is a single line — *"Computational functionalism — why isn't computation
sufficient for consciousness? (4 arguments)"* — that belongs in the Summary panel and nowhere near a
shelf card. So the leading hypothesis is that **1V's second field is right and its content is
wrong**: make that field carry the whole Socratic line, and have Summary mode render it *instead of*
the gist rather than beside it. The other nine surfaces keep the declarative gist untouched.

To be confirmed against the code, not assumed — recon is out.

## Stages

- **Stage A — `/design`, and a reusable admin gate.** Smallest, and independent of everything else.
- **Stage B — selections under eight characters.** Reproduce first: the fix is "lower the floor" or
  "say why", and which one depends on what the reader currently sees.
- **Stage C — the summaries eval.** The long pole, and the one that can return "change nothing".
- **Stage D — act on what C found.**

A and B first because they are small and land value early; C is where the thinking is.

## Stage A — the admin gate, as found

Greg asked whether a reusable way exists. **It does not.** What exists is:

- **one real gate**, server-side and deliberately above the route table: `src/routes.ts:6430`
  computes an `/api/admin` namespace prefix, `:6750` enforces it with a 403. The comment at
  `:6730-6741` says why it sits above rather than inside — a per-route check has to be *remembered*
  by whoever adds the next route.
- **two cosmetic client checks**, hand-rolled and unrelated to each other: `src/web/App.tsx:617`
  (non-admin at `/admin*` gets the shelf) and `src/web/Library.tsx:346` (draws the nav link).

So the shape to build is the **client mirror of the server's namespace check** — one predicate over
the parsed route, consulted once at the top of `SignedIn()`, with the existing `/admin` check
collapsing into it. Not a `<RequireAdmin>` wrapper: `SignedIn()` is a flat chain of early returns,
and a wrapper is precisely the thing the next person forgets.

### The part that must not be overstated

**Any gate on `/design` is cosmetic, and the code and docs have to say so.** `DesignPage` is in the
bundle every signed-in reader downloads, and `vercel.json:37-48` rewrites every non-`/api/` address
to `index.html`, so `/design` returns 200 for anyone who types it. A real gate would need an edge
function of the kind `/read/:slug` already uses (`src/public/page.ts`).

This is worth the care because the commit that moved the link, `a04dc7f5`, was already honest about
it — *"moving the *link* gates nothing"* — and it would be a poor trade to replace an accurate
comment with a reassuring one. `/design` has no data behind it, so what is at stake is product
surface, not privacy.

## Stage C — the diagnosis, which was not what anyone assumed

Fable was asked for the product call, and found the cause in the prompt rather than in the
architecture. **Verified here, by reading the file, not taken on report** —
`src/hierarchy.ts` § `SYSTEM`, QUESTIONS block:

> It is the question this node's text answers **and its gist does NOT**.

That is why this morning's questions are generic: *the prompt told the model to strip out everything
the gist already carried*, so the only honest residual is a bare why-question. "Why might computation
not be sufficient for consciousness?" is the **correct** output of that instruction. The output was
not a failure of the model; it was the prompt working as written.

Greg's line does the opposite. *"Computational functionalism — why isn't computation sufficient for
consciousness? (4 arguments)"* carries the same information as the gist, in a different **mood**. So
what he is asking for is a different **primary** line, not a better secondary one — and "beside",
as built this morning, cannot reach it: a second line with the gist's specificity is a near-duplicate
of the gist, while he simultaneously wants the top rows *briefer*.

**This retires the leading hypothesis above.** 1V's second field is right as a *field*; what is wrong
is both its content and the decision to render it alongside rather than instead.

### The three moves, and the one that is load-bearing

Greg's example decomposes into three, and Fable adds the property that makes it work:

1. **Name the topic in the author's own term** — "Computational functionalism". This morning's
   question had the subject but not the term, which is why it reads as though it could be about any
   essay on the topic.
2. **Pose the question the section is built to answer, presupposing its conclusion.** *"Why isn't X
   sufficient"* carries the claim's direction; *"Is X sufficient?"* hides it. **This is the move that
   decides whether the whole idea works**, because it is what lets a question still serve the reader
   who is deciding whether to read at all. A neutral question fails that; Greg's shape passes.
3. **Signal the shape of the answer without giving it** — "(4 arguments)". A count is safe, a kind
   is safe ("a thought experiment", "two case studies"); content is not, and a helpful model drifts
   there.

And the thing the decomposition misses: it is **the author's question, not the reader's** — the
question the section is *structured* to answer. That is a better prompt instruction than
"encourage the reader", which is what 1V reached for.

### Where the form holds and where it breaks

Root and depth-1 (parts): yes, and the root may be where it helps most, because root gists are the
worst gists — the last hop of the telephone game. Depth 2 (sections): no — twenty-seven sections
with a question each is a quiz sheet, and a reader at that depth is already reading, where a claim
is what orients. Leaves: no, twice over.

`MAX_QUESTION_DEPTH = 1` (`src/hierarchy.ts:219`) already draws exactly that line, so the cap needs
no change.

**The test that separates a door from a wall:** can the reader decide whether to descend from the
line alone? That is the criterion for the eval's rubric, and it is stated here so the rubric cannot
quietly become "which is most Socratic".

### The two smaller asks, with what the code actually shows

- **Simpler language.** `docs/project/granularity-zoom.md:215` lists *"No meta-narration ('this
  section explores…', 'the author then turns to…')"* as a prompt rule. **The GISTS block does not
  contain it** — verified by reading `src/hierarchy.ts:117-125`. The arc prompt does have the rule.
  So this is a doc claiming a rule the prompt lacks, and adding it is most of the "simpler language"
  ask on its own, across all ten surfaces at once.
- **Length by depth.** Fable measured the stored tree: root **38** words, parts 19–31, sections
  12–30. The current shape is *inverted* from what Greg wants — the root is the longest thing in it.
  The prompt says "Exactly ONE sentence" at every level, which was uniformity for simplicity rather
  than a design. Do it as "one sentence at root and parts, one or two at sections" rather than word
  counts per depth.

### What it costs, and the honest limit on the eval

Any of this is a `PROMPT_VERSION` bump: every existing article shows nothing new until
`npm run hierarchy -- <slug> --force`, at roughly $0.10 an article. And **there is no summaries
eval** — `evals/hierarchy-structure` scores structure, not gist quality — so one has to be built.

Fable's view is that the real instrument is Greg reading three or four articles, and it is right
that a judge model cannot settle taste. The eval's job is narrower and worth stating: **pick among
variants and catch the failure modes** — a leaked answer, a lookup question, a neutral question, a
gist with a question mark on it — so that what Greg reads is the best of four rather than the first
of one.

### The gist's form is not on the table, and the sweep is why

The plan doc for 1V listed ten *render* surfaces. The grep it was scoped to missed the ones that
matter more: **seven downstream prompts read gists as model input** — `src/arc.ts:174-177`,
`src/ideas.ts:801`, `src/tweets.ts:272`, `src/quotes.ts:1027`, `src/timeline.ts:1115`,
`src/labels.ts:779`, and the expansion cascade's frozen outline
(`src/hierarchy-expand.ts:331,337`), which is *the map every scoped deepening call navigates by*.

Two more render surfaces were also missing from that table, both public:
`src/public/page-head.ts:216-219` — the root gist is the `og:description` on **every shared
Spideryarn link** — and `src/library-scalars.ts:122`, where `root_gist` is a **stored column
computed at publish**, so the shelf card and public shelf only change on re-publish, not on re-run.

**So the gist's wording may improve; its form and job may not change.** That is a firmer constraint
than 1V worked under, and it is the reason the changes below are confined to the question, plus two
wording rules inside the gist prompt.

### What changes, precisely

1. **The QUESTIONS block becomes Greg's shape** — topic in the author's term, a question that
   presupposes the conclusion, and a hint at the shape of the answer. In particular the line
   *"the question this node's text answers and its gist does NOT"* is what has to go; it is the
   instruction that produced the generic output.
2. **`SummaryPanel` draws the question INSTEAD of the gist on root and depth-1 rows.** Depth-2 rows
   are unchanged — gist, no question — which is what `MAX_QUESTION_DEPTH = 1` already enforces.
3. **The GISTS block gains the no-meta-narration rule** that `granularity-zoom.md:215` already
   claims it has, and an example of the register failure rather than a new rule.
4. **Depth-2 gists may run to two sentences**; root and parts stay at one. Expressed as sentences,
   not word counts.
5. **`EXPAND_SYSTEM` (`src/hierarchy-expand.ts:253-258`) moves in step**, or the tree reads as
   though two people wrote it — which that file's own comment at `:210-213` says in as many words.

**Replacing rather than sitting beside contradicts a comment written this morning**
(`SummaryPanel.tsx:450-469`: *"a reader deciding whether to descend needs to know what the section
says"*). That comment is right about the question form it was written for. It stops being right when
the question presupposes the claim and names its size — which is exactly what changes in (1). The
comment gets rewritten to say so, rather than deleted.

### The eval, at the size the job deserves

`evals/hierarchy-structure/` is the template: arms as data, a corpus manifest pinned by sha256, a
blind judge with a Fisher–Yates shuffle and a **non-model anchor in every lineup**, and a rubric that
already carries a per-arm gist verdict field (`blind.ts:110-119`).

**But the cheap design is the right one here.** Running whole structure calls is $0.10–0.26 and
150–320 s per article per arm — four arms over twenty articles is $8–20 and a couple of hours. Since
nothing being changed alters the *structure*, the variants can be run over a **fixed existing tree**,
asking only for the gist and question wording. That is far cheaper and tests exactly what changed.

**The honesty cost of that shortcut, stated rather than buried:** it is not the shipped call, so by
`evals/hierarchy-structure/arms.ts`'s own discipline it is a `bakeoff`, not an `isolated` arm, and
must be labelled one. What it cannot catch is an interaction between the new wording and the
structure the model proposes in the same breath.

Two guards the harness must keep from its template: the **incumbent run twice** as a noise floor,
so a judge who cannot separate arms by more than the floor is not allowed to rank them; and the
**current prompt as an unlabelled arm**, so "change nothing" can win.

### The inversion, measured across the corpus rather than one article

Every tree in the local `data/` root, gist length in words by depth:

| article | root | depth-1 | depth-2 |
|---|---|---|---|
| `constitution` | **29** | 21 | 19 |
| `noema-mythology-of-conscious-ai` | **38** | 22 | 21 |
| `openai-huggingface` | **27** | 27 | 22 |
| `todo` | **23** | 21 | 24 |
| `writes` | **31** | 22 | 17 |

(medians; run 2026-09-05 in this worktree. **Caveat:** `worktree:setup` copies `data/` from
`tests/fixtures/data-root/`, so these are the fixture cut rather than the full articles —
[[eval-corpus-in-a-worktree-is-the-fixture-cut]]. The gists were still written by the real pipeline,
and all five trees are `version: toc/2`, so none carries a `question`.)

**The root gist is the longest row in five articles out of five**, which is the exact opposite of
what Greg asked for. This is not a tendency to nudge; it is a consistent shape, and it comes from
"Exactly ONE sentence" being the only length rule at every depth — the model writes the root last
and from its children, so it packs. Worth stating as a measurement rather than an impression,
because it means the length change has a defined direction and a way to check it landed.

## The plan review, and what it changed

GPT Sol, 2026-09-05, on the plan before anything was built. Verdict: *"I would not build Stage C
exactly as written. The prompt diagnosis is sound, but the plan has promoted an attractive
hypothesis — question replaces gist — into a decision before the proposed evidence exists."*

No P0s, six P1s. **Five are accepted outright and one is accepted with a narrowing.** Three were
verified in code and would each have shipped a defect:

- **P1-4 — the shape Greg asked for cannot survive the current contract.** The prompt requires the
  string to end in `?` and `questionFor` (`src/hierarchy.ts:231`) *appends* one to anything without.
  Greg's example ends `"(4 arguments)"`, so the stored value becomes
  *"…sufficient for consciousness? (4 arguments)?"*. The punctuation order has to be specified —
  something like *"Computational functionalism (four arguments): why …?"* — and the shape hint has
  to be **optional**, because many sections honestly contain no enumerable set. A claimed count also
  needs grounding: a child count is not an argument count. And `.summ-question` is styled *secondary*
  — smaller, italic, faint (`styles.css:7942`) — so promoting it without restyling produces a
  weak-looking primary line.
- **P1-5 — the depth cap does not do what this plan said it does.** `MAX_QUESTION_DEPTH = 1` only
  **drops** questions generated too deep; it never **produces** missing ones, and `EXPAND_SYSTEM` has
  no question field at all (`hierarchy-expand.ts:245`). So a flat root deepened by the cascade gets
  depth-1 children with no question, and a collapsed rung can promote questionless children to depth
  1. The panel then mixes question-primary and gist-primary rows *at the same depth*. Benign while
  the question is an optional second line; not benign when it is the only line.
- **P1-6 — a UI-only deploy would make things worse before it made them better.** `question` is
  optional and a `PROMPT_VERSION` bump does not regenerate stored trees. Every existing `toc/5` tree
  carries **exactly the generic questions Greg disliked**, so replacing the gist in the renderer
  would hide good gists behind bad stored questions on day one. Needs `question ?? gist` and an
  explicit version boundary for "this question may replace a gist" — the presence of the field is
  not the same claim.

### The central call, reversed

**P1-1 is accepted, and it is the important one.** The plan asserted that Greg's line *"carries the
same information as the gist"*. Sol's reply is that it generally carries **less, deliberately** — it
preserves the *direction* of a claim but not its substance, and the substance is what tells a reader
which section is distinctive rather than which is on-topic. Worse, a presuppositional question
**misrepresents genuinely exploratory, descriptive or inconclusive sections** by forcing a settled
conclusion onto them.

So *"the question replaces the gist"* moves out of § What changes, precisely and becomes **an outcome
the eval is allowed to return**, alongside gist-only and gist-plus-question. That also matches the
brief better than the plan did: Greg's word was *"maybe"*, hedged twice.

**Both advisers now agree the final instrument is Greg reading rendered examples**, and they reached
it from opposite directions — Fable from what the reader is doing in the panel, Sol from what a model
judge cannot settle. That is worth more than either saying it alone.

### The eval, cut down

P1-2: the local corpus is five fixture-cut `toc/2` trees, so it is not ready for the twenty-article
design, and the fixed-tree run *"tests exactly what changed"* was an overclaim — production asks for
structure, titles, gists and questions in **one** long-context response, so even the control arm is
not byte-identical to production. The staging Sol recommends, and this plan now adopts:

1. fixed-tree generation to **reject** obviously bad variants — a screen, not a verdict;
2. Greg blind-reads three or four variants **rendered**, on three varied articles;
3. the winner and the incumbent run **end to end** on three hard articles — about six calls, not
   eighty — to check production coupling and token behaviour.

P1-3: an unlabelled control does not blind the intervention, because a question visibly identifies
itself, and a judge primed to value "a door" will prefer it. The guards that follow from that:
**negative anchors the judge must order correctly before its ranking is trusted at all** — a
fabricated count, a neutral lookup question, an answer-leaking question, a title-only line — and
**separate axes scored before any overall preference**. Judge the same frozen outputs repeatedly with
shuffled order, since the incumbent-twice floor measures generation variance and not judge
instability.

### The one thing narrowed rather than accepted

P2 on the token estimator: raising gist length without raising `TOKENS_PER_NODE` does not cause
pre-call refusals, it causes **under-budgeted paid truncations** — and raising it honestly *does*
push long articles over the refusal line (Sol's worked figure: a heading-dense handbook at 117,700
today, 125,300 at 200/node, refused at 210/node). Also `evals/hierarchy-structure/score.ts` counts a
multi-sentence gist as a **defect**, so change (4) breaks the existing baseline.

**So two-sentence depth-2 gists are deferred out of this run**, rather than solved. The root-briefer
half of Greg's ask is kept, because it needs no extra tokens and the measurement above gives it a
direction. Making section gists longer is a change to a shared contract with a paid failure mode and
an eval baseline behind it, and it deserves its own piece of work.

## Stage C as built, and the six places it differs from this plan

The harness is `evals/summaries/` — [`evals/README.md` § `summaries/`](../../evals/README.md) is the
map, and this section records only what changed from the design above. **No paid call has been
made**; the plumbing was proved with `--stub` and `--stub-judge good|bad`, and the calibration gate
has been watched passing and failing.

1. **The corpus is real articles, not the fixture cut.** § *The eval, cut down* recorded that the
   local `data/` root is five fixture-cut `toc/2` trees, and that was true of `data/`. The database
   is a different matter: `npm run db:export -- --out output/summaries-corpus` returned **31 articles
   with a current revision**, printing `Target: postgresql://postgres@127.0.0.1:54362/postgres` —
   read rather than assumed. Ten are pinned in `evals/summaries/corpus.ts`, seven of them in the
   default run: 72 to 357 blocks, one to twenty-five headings, three carrying the current generic
   questions. The export is byte-deterministic, verified by exporting twice and comparing twelve
   hashes, so **both `blocks.json` and `tree.json` are pinned** — the tree is an *input* here, so a
   re-carve is a different measurement wearing the same slug.
2. **The inversion holds on real articles.** § *The inversion, measured across the corpus* carried a
   caveat that its five documents were the fixture cut. On the exported corpus the root gist is the
   longest median row in **nine of ten**, the exception being `openai-huggingface` where root and
   depth-1 tie at 27 words. The worst root is Wolfram's, at 49. `tests/summaries-eval.test.ts` pins
   the claim and names the exception.
3. **Seven arms, not four, because the GISTS change needed its own.** § *Three requests, not one*
   says the language and length changes "are true regardless of how i turns out" — so there is a
   `gists-only` arm, and V1–V4 are one block away from *it* rather than two blocks away from
   production. `ArmSpec.isolatedAgainst` is a field the template did not have: `comparison` alone
   could say either "two variables changed" or "one did", and both were true of different pairs.
4. **The gist and the question are judged in separate lineups.** The anchors are all question-shaped
   single lines; in a lineup where every other candidate was a gist-and-question pair the judge could
   have clustered them by shape and rejected them for looking odd — the gate passing for the wrong
   reason. Whether the row wants the gist, the question or both is asked afterwards, as its own
   question, which is where P1-1's open outcome actually lands.
5. **Judge instability is measured as a mean-rank spread, and two earlier versions were wrong.**
   Averaging how far one arm moves *inside one lineup* between repeats gives about 2.3 ranks for a
   random judge over seven arms, while the mean ranks it would be compared against are averages over
   a hundred-odd lineups and differ by tenths — a threshold that would have swallowed every real gap
   and printed *"not separable"* for ever, a wrong answer wearing the clothes of caution. So the
   threshold is the spread of an arm's **mean** rank across repeats. The code review then killed the
   rest of it: the generation floor was a difference of means between two *exchangeable* recipes, so
   it cancels and trends to zero as the corpus grows, and `max()` of two statistics on different
   sampling scales is not a test. The floor is **paired** per lineup now and is reported rather than
   used as the threshold, and a leader must additionally **lead in every repeat's own table** and sit
   on a clean bill.
6. **The judge gets no repo.** GPT Sol through `scripts/run-codex.ts`, `--sandbox read-only` against
   an empty temp directory: a judge that can open `evals/summaries/variants.md` can read the arms,
   the anchors and the key, and the blinding would be decoration.

**V4 is the only variant that needs a change to `src/hierarchy.ts`** — the two-line `questionFor`
patch in `evals/summaries/variants.md`, since Greg's literal reading order puts the hint after the
question mark and `questionFor` appends a second one. Stage C builds the instrument only, so the
harness applies V4's rule to V4's lines and **the test asserts production's own `questionFor` doing
the mangling**: P1-4 is now a red test rather than a sentence.

## The code review, and the six defects it found before a penny was spent

GPT Sol on the built harness, 2026-09-05: *"The fixed-tree bakeoff is a defensible cheap screen. I
would not run the paid panel yet: several guards can go green without supporting the result they
claim to support."* Six P0s, all fixed, each now with a test that would have been red:

- **The calibration gate passed over a ranking with nothing real in it.** A judgement naming the five
  anchors and none of the seven arms produced no inversions, no unranked anchors, and `passed: true`.
  The ranking must be a permutation of the lineup, and now is.
- **The judge saw the first 1,800 characters of a 30,187-character section.** The material anchors 3
  and 5 quote is nowhere in that opening, so the judge could have ranked the two anchors that matter
  at the bottom for being *unsupported by the excerpt* — the gate passing while measuring excerpt
  coverage. It sees windows sampled across the range now, and is told it is reading one.
- **Coverage was clean over an arm that wrote no questions at all.** A gist counted as the whole of
  what an arm was asked for, so an arm with every question dropped — or one that answered only its
  easy sections — was clean, ranked over fewer lineups, and could still lead. The denominator is the
  plan (gists **and** questions), and a run that is not clean cannot name a leader.
- **The instability calculation compared two different articles' roots.** Node ids are per-tree, so
  `n0001` is every article's root; the repeat-to-repeat comparison keyed on the node id alone. Plus
  the noise-floor and threshold errors in point 5 above.
- **Stub and live could be mixed into a convincing fake report.** Live generation judged by the stub
  produced a full ranking with no STUB banner. Both directions are refused, and the report names its
  judge.
- **Judging materials — real article prose — were written under `evals/results/`, which is
  committed.** A run lives under `output/summaries-runs/` now; only `results.md` is promoted by hand.

Three P1s were fixed alongside: the outline the arm saw contained only the rows it was asked to
write for, while both GISTS blocks say *"write a parent's gist from its children"* and those children
are a depth below (it goes to depth 2 as context now); the axes were collected and never displayed, so the harness could not
support its own independent claims, and the key file was written *before* judging where a tool-using
judge could read it. Two are recorded rather than fixed and are visible in the output: "axes before
preference" is a request a single response cannot enforce (two calls would fix it), and the row-form
question cannot see an arm's gist beside its own question, so it cannot settle the rendering.

**And nothing here covers the cascade.** `EXPAND_SYSTEM` has no question field (P1-5), so whichever
variant wins still needs the same block there. The harness says so in `arms.ts`, in every run file
and in every results file, rather than letting a reader assume otherwise.

## The harness, and the six ways it was lying before it was reviewed

Built 2026-09-05, `evals/summaries/`, seven arms over seven real articles. GPT Sol reviewed the
**built code** — the second review, which engineering-manager says to weight above the plan review,
and which earned that here: *"a defensible cheap screen. I would not run the paid panel yet: several
guards can go green without supporting the result they claim to support."*

**Six P0s, all real, all fixed, each now held by a test that goes red under perturbation.** Every one
of them is the same class — a check that passes while measuring something other than what it claims —
which is the class [silent-success.md](../reusable/silent-success.md) exists for and the one this
repo keeps paying for:

1. **The calibration gate passed over a ranking with nothing real in it.** A judgement naming the
   five anchors and none of the seven arms produced no inversions, no unranked anchors, and
   `passed: true`. The ranking must now be a permutation of the lineup.
2. **The judge saw the first 1,800 characters of a 30,187-character section**, and the material
   anchors 3 and 5 quote is nowhere in that opening. So it could have rejected *the two anchors that
   matter* for being unsupported by an excerpt it was never told was an excerpt — and the gate would
   have passed while measuring excerpt coverage. It sees sampled windows now, and is told so.
3. **Coverage came back clean over an arm that wrote no questions at all**, because a gist counted as
   the whole ask. An arm answering only its easy sections was clean, ranked over fewer lineups, and
   could still lead. The denominator is the plan now — gists *and* questions, read from `run.json` —
   so a cell nobody wrote counts against its arm, and an unclean run cannot name a leader.
4. **The instability figure compared different articles' roots**, `n0001` being every article's root
   id. And the noise floor was `|mean(A) − mean(B)|` between two *exchangeable* recipes, which
   cancels and trends to zero as the corpus grows — a floor that gets easier to clear the more
   evidence you gather.
5. **Stub and live results could be mixed** into a convincing fake report.
6. **Judging materials — real article prose — were written under the committed `evals/results/`.**

Two limits are **recorded rather than fixed**, and both print in the output: "axes before preference"
is a request a single response cannot enforce, and the row-form question cannot show an arm's gist
beside its own question — **so this eval cannot settle whether the question should replace the
gist.** That was always Greg's read to make, and now the harness says so itself rather than leaving
it to a plan nobody re-reads.

### What the real corpus settled

`npm run db:export` printed `Target: postgresql://postgres@127.0.0.1:54362/postgres` — read, per
[database.md](../project/database.md), rather than trusting the success line — and returned **31
articles with a current revision**. Ten are pinned by sha256 on **both** `blocks.json` and
`tree.json`, because the tree is an *input* here: a re-carve is a different measurement wearing the
same slug.

- **The root-gist inversion holds on real articles, not just the fixture cut**: the root is the
  longest median row in **nine of ten**, the exception being `openai-huggingface` at 27 = 27. The
  worst is 49 words. This upgrades the measurement above from a fixture-cut caveat to a fact about
  the product.
- **`antikythera` carries ten of the current questions in the wild**, and they are the diagnosed
  failure exactly: *"What physical pieces of the mechanism survive today?"* is a lookup, *"Was the
  mechanism a unique invention?"* is yes/no, and *"How did the front dial track the calendar and
  zodiac?"* is the gist, asked. Nobody had to construct an example of the problem — production is
  already full of them.

## Five more reports arrived mid-run, and one of them answered the open question

The 3-hourly loop found five new reports at 19:30, all from Greg, all filed while reading
`dhammapada`. They are folded into this plan rather than a new one, because one of them **is** this
plan's central open question and the rest are small.

| | report | outcome |
|---|---|---|
| **24** | show only the Socratic question, not both | shipped |
| **23** | spinner on the feedback Send button | with an agent |
| **22** | remove `greg@gregdetre.com` from the UI | with the same agent |
| **1Z** | expand quotes mode: importance, ordering, highlight in prose | mostly already built |
| **21** | quiz questions too hard | prompt half built, rest deferred |

### 24 settled the argument this plan could not

> I quite like some of these new Socratic questions in the summary mode, but the intent wasn't that
> we would show both the gist and the Socratic question, the intent was that we would show only the
> Socratic question when we have one.

GPT Sol's P1-1 said *"make replace-the-gist an eval outcome, not a decision"*, and that was the right
advice **to an agent guessing**. It stops applying the moment the person whose call it is makes the
call. Note he also says he *likes some of them*, having read the version this plan was treating as
too weak to stand alone — which softens P1-6 as well: he has seen the stored questions and wants
them shown alone.

**What the eval is still for** is unchanged and arguably more important now: the question is the only
line on the row, so its wording carries the whole weight.

### 1Z and 21 are mostly already built, which is the finding

Recon before any building, and it changed both jobs:

- **1Z's entire ordering paragraph shipped on 2026-08-31.** `Quote.importance` and `Quote.striking`,
  `?rank=prioritised`, the `?bar=` threshold slider modelled on the glossary — all live, behind the
  experimental-features switch. And *"the highlights should be a span rather than a block"* is
  already true: a quote is `blockId` + verbatim text + `start`, and already draws through the same
  mark machinery a search hit uses. **The real gap is one memo** — `src/web/App.tsx:4828` marks only
  the *selected* quote, where search marks all its hits at once.
- **21's metadata is already there too** — `band` and `value` on every question, already sorted
  easy-first-then-central. What is missing is that the questions are too hard, which is a prompt
  edit.

**The one piece Greg names as the model is already shared**: `src/web/threshold.ts`, three pure
functions, reused by glossary, quotes and search. What is duplicated is ~70 lines of JSX per site,
and `threshold.ts:41-45` records the decision not to unify it — the track, the unit and the noun
genuinely differ. **So neither report is blocked on an extraction, and grouping them buys nothing:
they share close to zero lines.**

### Report 21's slider is deferred, and here is what Greg has to decide

He asked for *"thresholding by a combination of centrality and easiness"*. That collides with three
decisions already on the record, and the first is fatal rather than awkward:

1. **A blended `ease + value` score was proposed and killed on review** (`src/quiz.ts:39,54-59`):
   hard-central `(1,5)` and easy-peripheral `(5,1)` both sum to 6, so the tie-break leads with the
   hardest question — the exact complaint report 21 opens with.
2. **The quiz panel deliberately never shows `band` or `value`** (`src/quiz.ts:344-351`), while the
   glossary's condition for keeping model scores is that *the number you sorted by is shown on every
   row*. Both rules cannot hold at once.
3. **Quiz sorts on the server, once**, and `QuizPanel.tsx:18-20` says why: *"a panel that sorted
   would be a second opinion about the same list, and two lists drift."* A reader-facing order
   control reverses that.

Half an hour of Greg's time on those three is worth more than a week building against a guess. The
prompt half — make them easier — needs none of it and is being built.

## Decisions and assumptions taken without asking

- **The eval lives at `evals/summaries/`, and `variants.md` is the source of the prompt text** rather
  than a description of it: `variants-file.ts` parses the fenced blocks and the arms send them
  verbatim. Transcribing four forty-line blocks into TypeScript would have been two homes for one
  fact, and the day somebody fixed a typo in V2 the arm on the wire would be the one nobody edited.
  The parse throws on every failure, because a lenient one yields an empty QUESTIONS block, plausible
  output anyway, and a variant that scored.
- **The incumbent arm's rules are sliced out of the live `SYSTEM`** through the exported
  `structureRequest`, for the reason `tests/hierarchy-eval-incumbent-parity.test.ts` exists: a
  literal here would drift the way `hierarchy-structure`'s `effort` did, and a paragraph of prose
  looks right at a glance in a way a wrong enum does not.
- **`withLedger("eval", …)`, not `evals/cost/harness.ts`.** That harness is job-queue plumbing — an
  eval-scoped step registry, a fixture stage-1 step, a local-database gate — and none of it applies
  to an eval that calls `streamMessage` directly. `withLedger` is what `evals/quiz.ts`,
  `evals/referee-*.ts` and `evals/prompt-caching.ts` use, and because the calls go through the
  gateway seam at production's model and effort there is **no declared bypass to add** to
  `src/spend-declarations.ts`.
- **Default depth 1**, which is `MAX_QUESTION_DEPTH`. `--depth 2` exists because the
  no-meta-narration rule applies at every depth, but every extra depth multiplies every arm's output
  tokens and the plan defers longer depth-2 gists anyway.
- A full run is 49 calls, roughly 660k input and 50k output tokens. Prompt caching does not help: the
  system block differs per arm and comes first, so each arm re-reads the article.


## The result: the gate held, and it is anchor 2 that tripped it

Run `output/summaries-runs/2026-09-05T18-04-46`, seven arms, seven documents, three judging repeats,
854 of 854 calls returned, $2.5853 all in.

**No ranking is reported**, and that is the declared outcome rather than a disappointment. The
calibration gate is `MAX_ANCHOR_INVERSIONS = 0`, written down before the run, and the run produced
fifteen inversions across three repeats.

**But the shape of the failure is the finding.** Fourteen of the fifteen are one anchor:

| anchor | its designed defect | where the judge put it (r1 / r2 / r3 of 12) |
|---|---|---|
| 1 | fabricated count — "(6 arguments)" where the text says four | **12th / 12th / 12th**, fidelity `1` every time |
| 3 | answer-leaking | 10th / 10th / 10th, leakage 4–5 |
| 5 | the gist with a `?` on it | 11th / 11th / 11th, leakage 5 |
| 4 | title-only | 8th / 9th / 9th — clean in two of three |
| **2** | *"neutral lookup question"* | **4th / 2nd / 4th**, scored `5,5,5,5,5` with leakage `1`|

So the judge caught, three times out of three, exactly the two traps `anchors.ts` names as the ones
that matter — the lines that are *most informative* and therefore most tempting to a judge measuring
information instead of triage value. It also put the fabricated count at the bottom of every lineup
with a fidelity of 1, which is the check that the judge is reading the prose rather than the label.

It simply does not agree that anchor 2 is bad. Anchor 2 is

> `Computational functionalism: what four arguments does the section cover?`

and on inspection **it is not a bad line**: the count is right, the topic is named, nothing leaks, and
a reader can decide from it whether to descend. It was labelled a wall at design time on a theory
about lookup questions. The judge is scoring it as a door, and the judge is closer to right.

**The gate is not being relaxed, and the run is not being re-scored.** `anchors.ts` says the
tolerance is *"declared before any run rather than argued after one"*, and reclassifying an anchor
after seeing where it landed is precisely the argument that rule forbids. The legitimate repair is to
rewrite or drop anchor 2 **before** the next run — a genuine lookup question is one with no content
at all in it, e.g. *"What does this section discuss?"*, and anchor 2 has four arguments and a named
theory in it.

Which means: **the eval spent $2.59 and returned no ranking, and the money was not wasted.** It
established that this judge, on this criterion, ranks answer-leaking and fabricated lines last with
perfect consistency — which is the property a future run needs and could not previously assume.

### What the run does say, without the judge

The shape table is observational and survives the gate failure. Against Greg's three asks:

- **His example shape is V4's, near verbatim.** He wrote *"Computational functionalism — why isn't
  computation sufficient for consciousness? (4 arguments)"*. V4 produced, unprompted, for that exact
  node: *"Computational functionalism — why might computation not be sufficient for consciousness?
  (four arguments)"*. V1 has the same content with the hint in front instead.
- **V4 needs the one-line `questionFor` patch** (`variants.md` § *The code change V4 needs*), because
  its hint follows the question mark and `questionFor` would otherwise append a second one.
- **V3 is out on its own evidence**: 39% of its questions are yes/no, against 13–20% everywhere else.
  A yes/no question is a door with the answer painted on it.
- **Length runs the wrong way for the rest of the brief.** Incumbent's median question is 10 words;
  V1 is 16, V4 is 18. Greg also asked for *simpler* language and a *briefer* top-level line, and the
  variants that hit his shape are the longest ones on the page.

### The lines themselves, which is what the decision should be made on

`noema-mythology-of-conscious-ai`, six depth-1 sections, one judge-free comparison:

| section | incumbent | V1 | V4 |
|---|---|---|---|
| n0001 | Could AI ever really be conscious, and why does the answer matter? | conscious AI (an argument): why is machine consciousness unlikely, and what should we do about AI that merely seems conscious? | Conscious AI — could machines ever really be conscious, and how should that shape what we do? (an argument and a set of recommendations) |
| n0020 | Why do we so readily assume intelligent AI must be conscious? | temptations of conscious AI (several biases): why are we so tempted to see consciousness in AI? | The temptations of conscious AI — why do we keep imagining AI is conscious when it may not be? (six psychological temptations) |
| n0048 | Why might computation alone never be enough to produce consciousness? | computational functionalism (four arguments): why is computation not sufficient for consciousness? | Computational functionalism — why might computation not be sufficient for consciousness? (four arguments) |
| n0133 | How should we act ethically given uncertainty about machine consciousness? | what to do (a recommendation): how should we act given uncertainty about machine consciousness? | Conscious AI's uncertainty — what should we do about it given we can't be sure either way? (a set of recommendations) |
| n0155 | What should we learn about ourselves from the myth of conscious AI? | soul machine (a closing argument): what does mistaking machines for conscious beings cost us, and how do we reclaim our own nature? | Conscious AI's implications — what does the pursuit of machine consciousness reveal about what we value in being human? (a closing reflection) |

**Nothing is being shipped off the back of this.** Greg's own instruction was *"Don't push tooooo
hard towards this Socratic-question approach if it's going to make things less valuable for the
user"*, and n0155 is the row that shows the cost: the incumbent line is short and clean, and both
variants talk more while saying about as much. n0048 is the row that shows the gain, and it is the row
he wrote the brief from.

The remaining two-thirds of his brief — simpler language, a briefer root line, longer leaf lines —
are untouched by any of this and are a separate, cheaper change.
