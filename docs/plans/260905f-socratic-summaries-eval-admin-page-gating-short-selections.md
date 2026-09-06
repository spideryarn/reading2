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


## The other two-thirds of the brief, which the eval was never going to settle

Greg asked for three things and the eval only ever addressed the first:

> I sometimes wish the language was slightly simpler. And the coarser top-level summary should be
> briefer, and the more granular-level summaries be a bit longer.

### The defect, measured on 1,239 real gists

Every gist in every published tree on the local database — 38 articles, 1,239 internal nodes:

| depth | nodes | mean words | min | max |
|---|---|---|---|---|
| 0 (the root — the coarsest line, the shelf blurb) | 38 | **28.8** | 17 | 53 |
| 1 | 247 | 23.1 | 11 | 47 |
| 2 | 852 | 20.1 | 4 | 58 |
| 3 | 102 | 14.9 | 8 | 28 |

**Monotonically the opposite of what he asked for.** The coarsest line is the longest in the tree and
they shorten all the way down.

**And the cause is one line of prompt.** `GISTS` said *"Exactly ONE sentence"* and said it at every
depth. A root sentence has a whole article to cover, so it grows clauses until it fits; a depth-3
sentence covers two paragraphs and does not. Nobody chose this gradient — it fell out of applying one
rule to four jobs.

### The variant already written for this does not work

`variants.md` § *The GISTS block* — the `gists-only` arm of the eval — was written specifically to
make the root briefer, and gave root brevity **a mechanism rather than a word count**, which its own
notes call *"the part worth keeping"*.

Measured against the incumbent over the same seven documents in the run above:

| | root mean | all nodes mean |
|---|---|---|
| incumbent | 22.9 | 23.7 |
| `gists-only` | **25.1** | **26.0** |

It made the root **longer**, on five of the seven articles. Its one clear win — noema, 32 → 22 — is
the single article the rule was written against, which is what overfitting looks like when you can
see it. **So the mechanism is dropped and a number is used**, which is the boring option the variant
was written to avoid.

*(Note also that the eval's roots average 22.9 words while the stored roots average 28.8. The bakeoff
does not reproduce the production gradient, because production asks for structure, titles, gists and
questions in **one** long-context response and the bakeoff asks only for wording over a fixed tree.
So the eval could never have found this defect; only the stored data could.)*

### What changed — `toc/6` and `expand/3`

- **A ceiling per depth, stated as running the opposite way to intuition**: root ≤18 words, depth 1
  ≤25, deeper 22–32 *"and use them"*. The reasoning is given to the model rather than only the
  number: a fine gist is read **instead of** the paragraphs under it, so it can afford a subordinate
  clause the root cannot.
- **The no-meta-narration rule** — *"never 'the essay opens by', 'this section explores', 'the author
  then turns to'"*. [granularity-zoom.md:215](../project/granularity-zoom.md) has listed this as a
  rule for some time and **the prompt did not contain it**; the doc is now true.
- **"Where a shorter, commoner word loses nothing, use it"** for the simpler-language ask. The
  existing *"plainer than the article, never further from it"* stays; this sharpens it.
- The same three, adapted, in `EXPAND_SYSTEM` (`src/hierarchy-expand.ts`) — the deepening cascade
  writes the fine gists, so a change that skipped it would have produced a tree obeying two budgets.

### Two costs, named at the point of choosing

- **Token headroom.** `TOKENS_PER_NODE` is 175 against a worst observed per-node cost of 145
  (re-measured 2026-09-04). Longer deep gists eat into that 30-token cushion, and 852 of the 1,239
  nodes are at the depth being lengthened. This is why the ask is 22–32 words rather than the two
  sentences the earlier plan deferred, and it is being **re-measured on the produced trees** rather
  than assumed.
- **The expansion prefix crossed the caching floor.** `EXPAND_SYSTEM` was 893 estimated tokens and is
  now 1,022, against a `CACHE_FLOOR_TOKENS` of **1,024**. So the prefix was never cacheable before and
  now becomes cacheable the moment there is any outline at all — a small win, and a **two-token
  margin**, which is not a comfortable distance. `tests/hierarchy-expand.test.ts` now asserts the
  margin directly, because the case that used to prove `estimatedCacheable` *false* can no longer be
  produced by any caller and pretending otherwise would have meant inventing a fixture.

### Where a longer fine gist actually lands

Checked rather than assumed, because "a bit longer" is only safe if something renders it.

- **Summary mode does not clamp.** `.summ-text` has no `line-clamp`, so the mode Greg was looking at
  when he asked shows the whole sentence however long it is.
- **The gist column does clamp, adaptively.** `.ctx-clamp` takes `--ctx-lines` from `landmarkLines`
  (`context.ts`) — one line where the level is long, up to four where it is short. So a longer deep
  gist shows more clipped text in the fisheye, and the clamp is already the mechanism that decides
  how much. Not a blocker; the trade is that the column shows a smaller fraction of a longer line.
- **The shelf card takes the root gist**, which is the line getting shorter, so that one improves.

### Measured, and one half of it did nothing

Two arms over four documents at depth 2 — `gists-toc5` carrying the block as it stood, `gists-toc6`
carrying the new one **character-for-character from the live `SYSTEM`** (1,417 characters both sides,
asserted in a test watched red by changing "18 words" to "17"). Sonnet 5, no judge, $0.6717.

**A trap avoided, and worth recording:** the harness's `incumbent` arm slices the *live* `SYSTEM`, so
once `src/hierarchy.ts` changed it became byte-identical to the new block. Running it would have
bought a second sample of the after and no before. Hence a pinned `gists-toc5`.

| arm | depth | budget | nodes | mean | max | over | **under 22** |
|---|---|---|---|---|---|---|---|
| stored (the database) | 0 | ≤18 | 3 | 35.7 | 49 | 3 | — |
| stored | 1 | ≤25 | 31 | 24.9 | 38 | 15 | — |
| stored | 2 | 22–32 | 134 | 22.6 | 39 | 9 | 54 (40%) |
| `gists-toc5` | 0 | ≤18 | 3 | 25.3 | 35 | 3 | — |
| `gists-toc5` | 1 | ≤25 | 31 | 22.1 | 33 | 7 | — |
| `gists-toc5` | 2 | 22–32 | 134 | 20.9 | 34 | 1 | 68 (51%) |
| **`gists-toc6`** | **0** | **≤18** | 3 | **19.7** | 23 | 2 | — |
| **`gists-toc6`** | **1** | **≤25** | 31 | **20.0** | 27 | 3 | — |
| **`gists-toc6`** | **2** | **22–32** | 134 | **21.0** | 31 | 0 | **63 (47%)** |

**The inversion is gone.** The gradient runs 19.7 / 20.0 / 21.0 against the stored trees'
35.7 / 24.9 / 22.6 — the direction Greg asked for, and the root is 45% shorter.

**The root ceiling is overshot by about two words** (19.7 against ≤18, two of three over). Accepted
rather than tightened: the thing that mattered was the inversion, and the same block forbids a topic
label two lines earlier, so squeezing a root below 18 risks trading a long claim for a short label.

**And the depth-2 half did nothing at all: 20.9 → 21.0.** The diagnosis is the sentence to keep:

> A ceiling the model can satisfy by writing *less* is not a floor.

*"22-32 words, and use them"* reads to a model as an upper bound with some scenery. Nothing in the
block penalised a short gist, so 63 of 134 stayed under 22 — barely different from `gists-toc5`'s 68.
One of them was *"The work is labelled simply as 'A Lecture.'"*, eight words.

**So the rule was rewritten to state the floor as a floor**, name it as the half that will feel
wrong, and give the model somewhere to put the words — *"give them the claim AND the ground it
stands on"* — with an escape hatch that is also a structural hint: *"if 22 words cannot be filled
honestly, the section was too slight to be its own node."*

### The token cost, which turned out to be the easy part

> **Superseded.** These numbers are the *ceiling-only* draft's, and the cushion they claim did not
> survive the floor — see § *Two claims of mine that were wrong* below. Kept because the method is
> the one still being used, not because the figures hold.


Mean gist characters per node: stored **163** → `toc/5` **146** → `toc/6` **149**. So `toc/6` is
**+0.8 estimator tokens per node** over `toc/5` and **fourteen characters below what is already in the
database**. Worst-document per-node reconstruction: `toc/6` at 0.93× the stored trees, ≈135 on the
145 scale, against a `TOKENS_PER_NODE` of 175.

**With the caveat stated rather than buried:** the reconstruction reads 90.8 for the worst of 31
exported trees where the documented figure is 145, because that figure came off a real call's answer
tokens. The absolute numbers are ~1.6× apart and **only the ratios transfer.** The one document
`toc/6` inflates is `fowler-phrenology`, ×1.11 — short stored gists getting longer, which is the
change working — and if that ratio landed on the worst-cost document it would be ≈161, still under
175.

### The cache floor moved again, and this time comfortably

The floor rewrite lengthened `EXPAND_SYSTEM` further: **893 → 1,022 → 1,058** estimated tokens
against `CACHE_FLOOR_TOKENS` of 1,024. The two-token margin is gone and there are now thirty tokens
of daylight. `tests/hierarchy-expand.test.ts` pins the margin rather than the boundary, because the
boundary test's padding length went negative and there is no honest fixture for the `false` branch
any more: every caller's prefix contains `EXPAND_SYSTEM`.

### Stated as a floor, it is obeyed — and the model still refuses to pad an empty node

Same four documents, same depth, `gists-toc6` re-run against the unchanged `gists-toc5` numbers.
$0.4054, running total $1.077.

| arm | depth 2 mean | max | over 32 | **under 22** |
|---|---|---|---|---|
| stored (the database) | 22.6 | 39 | 9 | 54 (40%) |
| `gists-toc5` | 20.9 | 34 | 1 | 68 (51%) |
| `toc/6`, ceiling only | 21.0 | 31 | 0 | 63 (47%) |
| **`toc/6`, floor stated** | **23.4** | **32** | **0** | **33 (25%)** |

**And the root got shorter rather than longer**: 19.7 → **18.0**, exactly the ceiling, one of three
over instead of two. Depth 1 moved 20.0 → 21.0 with its max and over-count unchanged — the direction
a leak would take, but one word on n=31 with no noise floor for the pair is not signal.

**The 33 still under the floor are two populations and only one is a miss.** Fourteen are apparatus
— *Bibliography*, *Backlinks*, *Persistent URL*, *Publisher's Address*, *License and attribution* —
where there is no 22-word claim to be made, and the model did not invent one. That is the escape
clause working: *"if 22 words cannot be filled honestly, the section was too slight to be its own
node."* The rest sit at 17–21 words, a word or two short rather than a category error.

**The lines were read, not only counted**, because a word count cannot tell substance from padding
and a floor is exactly the rule that invites padding. Checked against the source text:

- *"…unexpectedly reaches a cluster that cannot be grown further after 9 steps"* (21) →
  *"…unexpectedly produces a cluster that cannot be extended further after 9 steps, **akin to a
  puzzle's halting state**"* (29). The article says *"It's a bit like what might happen in a puzzle
  or a game … here a halting state."* The addition is the piece's own sentence.
- *"Even great men have flaws paired with their gifts, and Phrenology exposes the hypocrisy of those
  who appear virtuous only when watched…"* (27, from 21) — Byron and Scott lame, Homer blind,
  Napoleon's will his undoing; and *"more honest when watched"*. Both halves grounded.
- *"States the lecture's title, 'Utility of Phrenology.'"* — **seven words, unchanged**. The best
  line in the report: asked for a floor, the model left the empty node empty.

One that is still not right: *"Article Overview"* went from *"This is a brief introductory
overview."* to *"The article introduces bugs as a subject for a ruliological theory…"* — better, and
still faintly narrating. The meta-narration ban catches the stock phrases and not the habit.

### The two things to watch, recorded rather than fixed

- **`fowler-phrenology` inflates most**, ×1.154 per-node against the stored tree (was ×1.110 before
  the floor) — it is the article whose stored gists were shortest, so it has the most to gain. If
  that ratio ever landed on the worst-cost document it would be ≈167 against a `TOKENS_PER_NODE` of
  175: an eight-token cushion rather than thirty. It does not today, and `fowler` is nowhere near the
  worst-cost document. It is the direction to watch if the floor rises again.
- **Two of thirteen live calls came back as unparseable JSON**, both on `toc/6`, none on `toc/5`,
  breaking mid-answer at 1,174 of 9,107 and 460 of 9,165 characters — not truncations. The numbers
  are far too small to attribute to the longer prompt, and both re-ran clean. But it is the same
  failure shape twice, **production's hierarchy call parses the same way, and nothing keeps the raw
  text**, so there would be no evidence to diagnose it from if it happened to a reader. Worth its own
  look; not a reason to hold this.

### The review, and the three things it stopped

[260905f-gist-length-review-sol.md](260905f-gist-length-review-sol.md). Verdict:

> The core change is sound. The hard universal floor, its structural escape hatch, and the
> now-stale cost claim are not ready.

**1. The escape hatch was the serious one, and it is deleted.** *"If 22 words cannot be filled
honestly, the section was too slight to be its own node"* looked like a graceful way to stop the
model padding. It is not:

> The same model call chooses boundaries and writes gists, so … it tells it to merge or avoid a
> legitimate section to satisfy a prose constraint. The fixed-tree eval cannot reveal this
> interaction by construction.

A word-count rule was being handed the power to redesign the article's structure, and the harness
that measured it holds the structure fixed, so no number it produced could ever have caught it.
*(It also means the two paths were not mirrored after all: `EXPAND_SYSTEM` never had the hatch.
Deleting it makes them match.)*

**2. The hard floor is now normative.** *"Never pad, never invent support, and never change a
boundary to reach a word count"*, with 22–30 as what a **substantive** node normally takes and an
explicit licence to be shorter when *"the range holds no second substantive element"*. Sol's argument
is that "claim AND ground" fits an argumentative section and not a definition, an event, a list, a
transition or a bibliography — and that 22–32 words in exactly one sentence pushes toward the clause
chaining the root rule forbids, which also works against *"slightly simpler language"*.

**3. The root ceiling went 18 → 20, because the root evidence was three nodes and not four.**
`scaling-hypothesis`'s root is silently skipped when its stored range does not resolve wholly inside
the body (`evals/summaries/generate.ts:94`). Sol also notes the observed minimum of 17 is not a
quality boundary, only one unconstrained generation that happened to be short. 20 is still a ~30% cut
from 28.8 without forcing every article into headline copy. *"The one claim the piece makes"* became
*"the central claim or governing move"* — some works have neither a single claim nor a thesis.

**Two smaller ones, both taken:** the *"length runs the opposite way to what you would expect"*
framing is model psychology that adds salience without specifying behaviour, so the interface reason
is given instead (shelf card / chapter orientation / substitutes for the prose); and the
meta-narration ban no longer forbids bare **"then"** and **"next"**, because *"if X, then Y"* can be
the claim.

### Two claims of mine that were wrong, corrected

- **The token cushion.** The paragraph above measured the *pre-floor* wording. Mean gist characters
  actually rose 148.9 → **163.3**, and per-document ratios ran to **×1.186** — so by my own
  ratio-transfer method `145 × 1.186 ≈ 172`, leaving about **three** tokens under `TOKENS_PER_NODE`
  = 175, not thirty. Not proof of imminent truncation (the estimator over-counts nodes heavily, and
  expansion budgets separately at 200 tokens per child) but **the cushion claim is no longer
  established**, and it is being re-measured on the current wording rather than restated.
  Sol also notes the count was wrong: *"deeper than depth 1"* is **954** of 1,239 stored nodes, not
  852, across two different call paths.
- **The cache floor.** *"Never cacheable → always cacheable"* is false, and I wrote it in three
  places. `EXPAND_SYSTEM` alone was under the floor, but `EXPAND_SYSTEM + outline` could already
  clear it — which is exactly what the old test padded an outline to demonstrate. What changed is
  that eligibility went from **outline-dependent to estimated-always**, which is a smaller thing.
  And `estimatedCacheable` means our four-characters-per-token *estimate* clears the floor, not that
  the provider took the prefix or that any call got a hit. Corrected at the test, which is where
  somebody would read it.

### Deferred, on the record

Sol's § 7 lists eight further measurements — full production structure calls with two draws per arm
against within-arm boundary noise, human paired review of the root ceiling stratified by genre,
faithfulness checks for qualifications lost at the root, a padding analysis, a cascade root-gist
ablation (current / shortened / omitted / deliberately misleading), real answer tokens and stop
reasons, and a lexical simplicity measure. **None of it is being done here.** Greg filed these as
*"other minor requests"*; that programme is a research project, and the honest position is that this
change is verified for instruction-following on four documents and one draw per arm, and for nothing
else.

**The cascade interaction is the one worth naming separately**, because Sol is right that it is real
and unmeasured: the root gist is carried into every descendant's ancestor chain
(`src/hierarchy-deepen.ts`, `src/hierarchy-expand.ts` § `chainRung`), so a much shorter root could in
principle change child boundaries, titles and verdicts. The clean experiment is the four-way ablation
above. Not run.

### Draft C measured: half the gain given back, and almost none of it where it mattered

Sol's normative floor, same four documents, third draw. The measurement that makes this readable is
**a split by how many words of prose the node's range actually covers** — the block's own criterion,
made countable, instead of a judgment about "substantive".

| draft | depth-2 mean | **under 22** | of which range &lt;40w | 40–120w | **&gt;120w** |
|---|---|---|---|---|---|
| stored | 22.6 | 54 (40%) | 14 | 11 | 29 |
| `gists-toc5` | 20.9 | 68 (51%) | 16 | 16 | 36 |
| A — ceiling only | 21.0 | 63 (47%) | 15 | 15 | 33 |
| B — hard floor | 23.4 | 33 (25%) | 16 | 6 | 11 |
| C — normative | 22.1 | 47 (35%) | 15 | 17 | **15** |

B recovered 30 nodes from A and **C keeps 16 of those 30** — but the give-back is concentrated in the
40–120-word band (6 → 17), which is exactly where the new exception is meant to fire. Above 120
words, where "no second substantive element" is rarely a true excuse, C holds 15 against B's 11 and
A's 33: **about 85% of the gain, kept where a short gist really is a miss.** A real partial retreat,
mostly in the right place.

**But C is worse than B on precisely the nodes the floor exists for**, and the lines say it better
than the counts:

- *A Multiway System Halts* (range 186 words): B *"…after 9 steps, **akin to a puzzle's halting
  state**"* → C *"…a rare halting outcome."* The article's own sentence, dropped.
- *Visually Obvious Correctness* (60 words): B *"…will always **correctly double their input**,
  without needing further proof"* → C *"…that no bug can ever occur."* The claim itself, dropped.
- *Human Imperfection and Hypocrisy* (193 words): 27 words → 17, losing Byron, Homer and Napoleon.

**And Sol's fear about the hard floor did not materialise.** The padding signature he named —
participle tails, *"showing that…"*, *"underscoring…"* — is 4% of C's depth-2 lines against 5% of B's
and 3% of `toc/5`'s. The model does not pad. The nodes with nothing in their range stayed short in
every draft: *"The lecture is titled Utility of Phrenology."*, seven words, over a three-word range.

**The root moved the wrong way when the ceiling was loosened.** Ceiling 18 → mean 18.0, one of three
over. Ceiling 20 → mean **22.0**, two of three over the new line and three of three over the old one.
Raising the number bought no compliance: the model tracks it loosely and follows it *upward*,
overshooting by about two either way. So the instruction has to say 18 for the output to land at 20,
which is the number Sol wanted. n=3, so a signal to watch rather than a finding — but it is the only
evidence there is, and it points one way.

### Draft D, which is what is being landed

Two changes, both out of the numbers above rather than anyone's taste:

- **The root ceiling goes back to 18**, for the compliance reason. Sol's caution was about claim-ness
  at 18, and he checked the 16–21-word roots himself and found them *"claims rather than labels"* —
  a risk he could not see materialising, against a cost the measurement shows plainly.
- **The licence to be short is tied to the range rather than to a judgment.** *"No second substantive
  element"* asks the model to judge substance; *"where the range runs to a paragraph or more, 22-30
  words is what it takes … shorter is right only where the range itself is slight: a title, a credit
  line, a URL, a heading with nothing under it"* asks it to look. The guardrails and the deleted
  escape hatch are unchanged.

### The cushion, corrected: about fifteen tokens, not thirty and not three

**Sol's arithmetic was right and his transfer was not, and the distinction matters enough to write
down.** His ×1.186 is the *gist-only* growth ratio, applied to the whole node. A node also carries a
title, a range, an id and often a `sourceHeading`, none of which grow — so the ratio that matches
what the 145 figure measures is the **whole-node** one.

| draft | worst whole-node ratio | → on the 145 scale | worst gist-only ratio | → on the 145 scale |
|---|---|---|---|---|
| A | ×1.110 | 161 | ×1.199 | 174 |
| B | ×1.154 | 167 | ×1.280 | **186 — over 175** |
| C | ×1.106 | **160** | ×1.193 | 173 |

So `TOKENS_PER_NODE` = 175 stands, and **the plan's earlier "thirty-token cushion" should be read as
about fifteen**. Both worsts are `fowler-phrenology`, the document whose stored gists were shortest;
and the figure compounds two worst cases, since the worst-inflating document is not the worst-cost
one.

**The durable fix is to stop transferring ratios at all.** The reconstruction reads 90.8 for the
corpus's worst tree where the documented figure is 145 — a 1.6× scale gap nobody has closed, and
ratio transfer only holds if prose is the same *share* of cost on both scales, which it probably is
not (a tokenizer charges more for `"spya-k3m9qt":{"range":[` than for prose). Take answer tokens ÷
internal nodes off one real production hierarchy call once `toc/6` ships, the way Kuhn's 132 was got.

### Draft D failed, both of its inferences were mine, and the real variable was neither

D was worse than every other draft **and worse than having no depth-2 rule at all**:

| draft | wording register | depth-2 mean | **under 22** | of which range &gt;120w | root mean (ceiling) |
|---|---|---|---|---|---|
| stored | — | 22.6 | 54 | 29 | 28.8 |
| `toc/5` | no rule | 20.9 | 68 | 36 | 25.3 |
| A | descriptive ceiling | 21.0 | 63 | 33 | 19.7 (18) |
| **B** | **blunt imperative** | **23.4** | **33** | **11** | **18.0 (18)** |
| C | softened norm | 22.1 | 47 | 15 | 22.0 (20) |
| **D** | descriptive, range-tied | **20.2** | **76** | **38** | **22.3 (18)** |

**Both changes I made after the last review were wrong, and each was an inference of mine rather than
a measurement:**

- **"The model overshoots the ceiling by about two, so say 18 to land at 20."** D says 18 and lands
  at **22.3**, against B's 18.0 at the same ceiling. The ceiling is not what held B's roots down. The
  only root difference between the two is that B said *"the one claim the piece makes"* and D said
  *"the central claim or governing move"* — Sol's genre hedge, which measurably cost four words.
- **"Tie the licence to the range rather than to a judgment, and the model will look rather than
  judge."** It did keep C's restraint below 40 words, which was never the problem, and it lost
  everything above 120.

**And the variable is the register, not the content.** This is the finding of the whole exercise and
it belongs to the measurement rather than to anybody's reasoning about prompts:

> A and D are descriptive and land on the model's own default (`toc/5`, 20.9). C softens B and gives
> back half. Only B's blunt imperative — *"AT LEAST 22 words … the floor is the half that will feel
> wrong, so obey it … too SHORT, not admirably terse"* — moved it.

So Sol's escape-hatch deletion and D's range-tied exception both look right *on the lines* and buy
nothing on the numbers. They cost nothing either, which is why they stay.

**Checked against the obvious confound**: D's worst document is `towards-a-theory-of-bugs`, which was
a first draw with nothing re-bought, and both first-draw documents are well behind B. The ordering
holds across all four documents.

**And the cushion moves with the draft, so it has to be quoted with one.** Worst whole-node ratio:
`toc/5` ×1.056 → 153; A ×1.110 → 161; **B ×1.154 → 167, a cushion of 8**; C ×1.106 → 160; D ×1.068 →
155. D's cushion is generous because D writes less, which is not a reason to prefer it. **If B's
register is what ships, the number to carry is 8, not 15 and not 30.**

### Draft E — B's register, D's exception, Sol's guardrails, no hatch

The criterion was declared before the run rather than argued after it, which is the lesson the
calibration gate taught earlier in this same plan:

> Land E if its under-22 count on ranges over 120 words is **≤ 15** *and* its root mean is **≤ 20**.
> If it misses either, land **B minus the escape hatch** — measured wording with one sentence
> deleted — and record E as a failed attempt.

The root line restores B's *"THE ONE claim the piece makes"* with Sol's hedge folded in as a
subordinate clause (*"or its one governing move if it makes no single claim"*) rather than replacing
it, since that substitution is the only root difference between B and D and it cost four words.

### The trailing comma is worse than the first report suggested

Not occasional slippage — **the model's habit**. One captured answer carries **twenty** trailing
commas, one on essentially every depth-2 node: `"gist": "…",}` where the omitted `question` would
have followed. Any count above zero fails the whole parse, so the 5-in-20 broken-answer rate
understates how close the clean answers are to breaking.

`src/parse-json.ts` has no trailing-comma tolerance, and `src/hierarchy.ts`'s real structure call
emits the same optional-`question` shape through the same parser. The repair is one line applied
**only after a strict parse has already failed**, and logged when it fires. Its own piece of work,
and the raw bytes are the evidence — promoted out of gitignored `output/` into
`evals/results/summaries/`, since they are model-written JSON with no article prose in them.

### Draft E cleared the criterion it was given before it ran — landed

| | criterion | E |
|---|---|---|
| under 22 words on ranges over 120 words | ≤ 15 | **9** — better than B's 11 |
| root mean | ≤ 20 | **19.7**, max 20, nothing over |

Depth-2 mean **23.9** and **27 of 134** under the floor (20%), the best of the five drafts, against
`toc/5`'s 68 and the stored trees' 54. The win is in all four documents, and E's strongest —
`towards-a-theory-of-bugs`, 4 short against B's 9 — was a first draw, not a re-bought cell.

**The three lines the whole argument turned on all got their ground back**, and the middle one is the
clearest:

- *Visually Obvious Correctness*: B *"…will always **correctly double their input**"* → C 16w and D
  19w both dropped the claim → **E**: *"Some **doubling** cellular automata have visually simple
  patterns that make it obvious they will **always work correctly**, with no possibility of bugs."*
- *A Multiway System Halts*: the surprise structure is back at 26 words; B's puzzle analogy is not.
- *Human Imperfection and Hypocrisy*: 24 words with its reason, grounded in the range — different
  ground from B's Byron and Homer, not worse.

Apparatus held everywhere: *License and attribution*, over a three-word range, is nine words. No
padding in any draft, in any round.

### What E costs, named rather than discovered later

**The register that makes a floor stick pushes on the ceilings too — the last round's finding running
the other way.**

- **The depth-2 ceiling stops holding.** Six gists over 32 words, max 39, where B had none over 32.
  The stored trees had nine, so at the top end this is back where it started. 4.5% of nodes, against
  a 20% floor miss that went to 27 — a trade worth making, but a real one.
- **Depth 1 is the weakest `toc/6` draft**: 8 of 31 over the ≤25 ceiling. Against the actual baseline
  it is a wash — `toc/5` was 7 over with a mean of 22.1 and a max of 33, and E is 8 over with a mean
  of **21.5** and a max of **32**. Better mean, better max, one more over the line. Six of the eight
  are in one document, the same one as the depth-2 overshoot.
- **The roots treat the ceiling as a target**: all three land at 19–20 against a ceiling of 18, none
  under 18. Still claims — *"Phrenology offers practical, verifiable benefits across nearly every
  domain of life, from health and parenting to law, business, and marriage"* — not labels.
- **Cushion: 11 tokens.** Worst whole-node ratio ×1.129 → 164 against `TOKENS_PER_NODE` = 175. Mean
  gist characters per node 166.4, the longest of any draft and above the stored trees' 162.9. **Carry
  11**, and quote it with the draft it belongs to, because the number moved between 8 and 22 across
  five drafts of the same change.

**Neither side effect reopens the decision.** The criterion was declared before the run precisely so
that a result which passes is not then re-argued against a standard invented afterwards — which is
the mistake the calibration gate at the top of this plan exists to prevent, and which this plan has
now had two chances to make.

### Five drafts, and the lesson that outlived all of them

> The **register** of an instruction moves the number; its content mostly does not.

Descriptive wordings (A, D) land on the model's own default. A softened norm (C) gives back half. Only
a blunt imperative (B, E) moves it — and it moves the ceilings as well as the floor, in both
directions, which is the cost. Three separate pieces of reasoning about *content* — mine about the
ceiling, mine and Sol's about substance-versus-range — were each measured and each turned out to buy
nothing. They cost nothing either, so they stayed; but not one of them was the variable.

$2.41 over five rounds, 20 live calls.
