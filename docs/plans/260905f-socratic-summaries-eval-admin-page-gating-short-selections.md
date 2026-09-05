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

## Decisions and assumptions taken without asking

(To be filled in as they arise — this is an autonomous run, so questions go here rather than to
chat.)
