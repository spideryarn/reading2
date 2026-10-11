# Skim: More always longer than Gist, a line that sets up each pass, shorter stops, and a skim-for box

Overseer queue item `qi-g8pdgfgg`. One admin report and one answer from Greg, both proven an
administrator's in production (`feedback-reporter.ts` exit 0; `feedback-questions.ts --answers`).
The mode is [skim.md](../project/skim.md).

> B (and maybe that means that the more detailed sub-modes get longer, rather than the least
> detailed one getting shorter)
>
> — Greg, 2026-10-11, reply `spya-sfm0g4` to [q-vzd2xt](../user-feedback/questions/q-vzd2xt.md)

> I wonder if we could provide a way for the user to specify how they want to skim in skim mode. I
> think it, or alternatively, maybe it should be generated based on the reading goals. I think it
> perhaps already is, I'm not sure. And if the reading goals have changed, maybe it offers to
> regenerate with a way to dismiss that. Maybe it already does that. But even beyond that, I
> wondered if we provide an optional input box so that you could say what it is that you're trying
> to skim for. In that way, it wouldn't be so different from the search box. Let's experiment with
> that. If you don't think it'll add too much complexity, if it will add a lot of complexity, then
> push back. One more idea for improving the skim mode. Can we, beyond just providing lots of
> quotes, can we somehow situate them? So maybe we include guidance or brief kind of introductory or
> summary or linking statements, because right now. It feels a bit disorienting and disjointed. And
> one final thing, there was one example of a quote that was like an entire large paragraph long. I
> mean, maybe that's necessary, but I think we should have a bias towards the quotes not being too
> enormous.
>
> — Greg, 2026-10-11 (`spya-wu83xh`, #565)

## What already exists (the prior-work check)

- **The route is already planned for the reading goals.** The reader's profile and the article's
  purpose (*"What do you want from this piece?"*) are in the prompt, and their hash is in the
  route's stamp ([skim.md § The route says what it was planned for](../project/skim.md)).
- **A changed goal already offers a re-plan, and it can be dismissed**: the profile-changed banner
  with *Plan it again* and an × (since 2026-10-09, plan 261009i). A changed purpose moves the same
  hash (`renderProfile` in `src/profile.ts` puts it in the profile), so it raises the same banner.
- **The purpose box exists, but only when nothing is set.** Over a ready route with a purpose, the
  band shows *Reading for: … · Edit*, and *Edit* leaves Skim for Metadata (`SkimPurpose.tsx`).
- **Situating a quote has been tried at the stop level.** The cue above a quote may set the scene
  (`skim/10`) and is written only where it adds something (`skim/11`). A scene on every cue was
  measured and declined: it gave findings away twice as often and misstated context one cue in ten
  (261006b; Greg, 2026-10-06: *"don't change things too much - the Skim questions were mostly
  good"*). A cue never refers to another stop, because a reader can arrive at any stop from anywhere.
- **Quote length** is set by the Quotes step: up to 1,200 characters since `quotes/6` (2026-09-12),
  because Greg asked for quotes *long enough to stand on their own*. Skim offers them as they are.

## The four changes

### 1. More always walks more stops than Gist (q-vzd2xt, answer B) — `skim/13`

Today, with 8 or more quotes, the rule is `1 ≤ Gist ≤ More < Most` as walked (own stops plus
carried). Greg's answer makes it `Gist < More < Most`, and he prefers that the deeper passes get
longer rather than Gist shorter. The earlier measured B shrank Gist to 2 stops on 11–13-quote
articles, which cost Gist 4–5 of 49 Ideas. This version keeps Gist's target as it is and finds the
extra length below it:

- **Targets** (`targetsFor`, q ≥ 8): Gist unchanged (`ceil(q/5)`, 1–5); More's own target at least
  Gist + 1 and at most half the rest; Most the rest. `3g + 2 ≤ q` holds for every q ≥ 8, so More's
  own target alone already beats Gist. At q = 8 and q = 11 More's own target equals Most's
  (2/3/3, 3/4/4), so Most is longer only with a stop carried into it, which the prompt asks for.
- **Prompt** section 2: "MORE walks more stops than GIST, and MOST more than MORE, counting the
  stops carried into each", and where the own targets tie, carry a stop into the deeper pass.
- **Rule** (`growthFailure`): with ≥ 8 quotes, `1 ≤ w₁ < w₂ < w₃`. Below 8 the short spiral keeps
  its present rule (no offered pass shorter than the one before): with 2–7 quotes three strictly
  growing passes often do not exist at all, and a route that fails the rule writes nothing.
- **Repair** (`growPasses`): a new first phase that **lengthens** before anything shrinks. While a
  pair of adjacent offered passes does not grow, and the deeper pass has carry room left
  (`maxCarried`, the existing cap), carry into it the most important stop (quote priority, as
  today; earlier in route order on a tie) that sits in a shallower pass and is not yet walked
  there. Counted as `growCarried`. Only additions, bounded by the cap, so it ends. Then the
  existing phase runs unchanged (drop a carried entry, then move the least important stop one
  pass deeper), and `growthFailure` judges the result. Two sequential phases, so an added entry
  can never be dropped and re-added in a cycle.

The simpler option passed over: shrink Gist to make room, the B that was measured on 2026-10-10.
Greg's reply asks for the other direction.

### 2. A line that sets up each pass — the "situate them" half

Each offered pass gets a short **intro**: one or two sentences, at most 240 characters, saying what
this walk goes through and in what order, as the ground it covers or the questions it visits,
naming the article's parts and key ideas in the records' own terms; for More and Most, what this
walk adds. Never a finding, a conclusion or a number; never the reader. Written by the same call
(no new call; a few hundred output tokens at most), stored on the route as
`intros: [gist, more, most]` (each a string or `null`), shown at the top of the band's list for the
pass being walked, in the model's face (`--font-ai`, [fonts.md](../project/fonts.md)), muted, with
the band's (i) saying what it is.

Why a pass intro and not a link on every stop: a stop can be walked in more than one pass, after a
different stop in each, and a reader can arrive at any stop from anywhere (a `?stop=` link, a row
press, ← and → across a carried stop). A per-stop bridge would have to be written per stop *per
pass* and would read wrong after any jump; and every line written beside a quote is one more chance
to give its finding away, which is what sank the every-cue scene. One intro per pass orients the
whole walk — the map before the stops — without either problem. Linking statements between stops
are deferred to the Overseer's queue with this reasoning, for Greg to ask for if the intro is not
enough.

**Owner only in v1.** A visitor's route is built by an allowlist in `src/public/dto.ts`, a listed
defence ([security-map.md](../project/security-map.md)); a new field there is a security edit,
and the intro is written with the owner's profile in the prompt. The DTO constructs the visitor's
route field by field, so the new field cannot leak by accident (a test says so).

### 3. A bias to shorter stops

The quote records in the prompt gain their length in words (`· 42 words`), and section 2 gains
one rule: a reader is skimming, so for GIST and MORE, of two quotes that carry the same idea, prefer
the shorter. As built (after the measurement below), a quote over 60 words is marked `LONG`, and Gist
may hold one, More two, each only when it carries a key idea no shorter quote carries; the first
wording, a 90-word bar with no mark, moved nothing. The Quotes step is not changed: its length
was Greg's own ask (*long enough to stand on their own*), and Quotes is its own mode.
The word count is derived from text already in the input hash, so the hash is unchanged.

### 4. A skim-for box: the purpose, edited where the route is

The experiment Greg asked for, at its simplest: the purpose *is* what you want from this piece, it
is already in the route's stamp, and saving it already re-plans. So:

- *Reading for: … · Edit*: **Edit** now opens the box in place, filled with the sentence, instead
  of leaving for Metadata. *Plan the route for this* saves and re-plans, as the empty box does
  today. *Cancel* closes it. An empty box does not save (clearing stays in Metadata).
- The question becomes **"What are you skimming for?"**, with a note under it that the same
  sentence is this piece's purpose in Metadata, so other modes use it too.

The option passed over: a Skim-only focus, separate from the purpose, more like a search query
(several routes per article, one per focus, or a route that forgets the purpose). That needs its
own column, its own stamp field, a second route or a decision about which route wins, and a way
back; it is the "a lot of complexity" Greg said to push back on. If the shared purpose feels wrong
in use, that is the next step, queued.

## Stages

1. **Server: `skim/13`** — targets, rule, two-phase repair, intros (schema, validation, type), the
   word counts and the short-stop rule. Unit tests first: a route at q = 8 and q = 11 that ties
   More with Gist is lengthened by a carry, never by shrinking Gist; the repair never cycles; the
   largest permitted answer still fits `ANSWER_TOKENS` with intros; an intro over the cap or for
   an absent pass is dropped and counted; the visitor DTO carries no intro.
2. **Measure** with `scripts/eval/skim-coverage-eval.ts`, `skim/12` twice against `skim/13` twice,
   on the six articles of 261010a. Bars: 0 runs that fail `w₁ < w₂ < w₃`; `shrinkMoved > 0` in at
   most 2 of 12; Gist Ideas coverage within the control's spread of `skim/12`; mean words per stop
   in Gist and More lower than the control, and fewer stops over 90 words there; intros read by
   eye and by a fresh blind judge for a stated finding, a misstatement or a word about the reader.
   Written up under `docs/investigations/`.
3. **Client** — the intro line in the band; the purpose box editable in place with the new
   question; the (i) text; help page and skim.md.
4. **Review, gates, land.** GPT Sol code review (fixes in-stage), `npm test`, `npm run typecheck`,
   push to `dev`; bookkeeping for `spya-wu83xh` and `q-vzd2xt`.

## What stays the same

Stored routes keep their shape until re-planned (an older prompt is not announced, plan 260929c).
The caps, the carry cap, the abstract rule and the cue rules do not change.

## What the plan review changed

GPT Sol, read-only, before building ([261011r-skim-plan-review-sol.md](261011r-skim-plan-review-sol.md)):
*build with these changes*. Taken:

- **F1 (high): the two-phase repair was not complete.** Greedy lengthening and then shrinking could
  leave a route broken that another order fixes (own 2/1/1 can walk 1/2/3). So `growPasses` now
  plans the sizes first (`repairSizes`): every reachable choice of moves and carry counts, ranked
  most Gist stops, fewest moves, fewest of the model's carries dropped, fewest added; then applies
  it. An exhaustive test over own and carried counts checks it succeeds whenever any reachable
  state grows, and keeps the most of Gist.
- **F2**: the caps hold (More ≤ 10 and Gist ≤ 5 keep the cumulative 15; Most is capped at
  36 − g − m); the q = 8 and 11 test is named for the More/Most tie.
- **F3**: an intro whose pass's own stops the repair moved is dropped (`movedIntro`). A carry
  added or dropped keeps it. The deterministic section-itinerary fallback Sol offered was not built:
  the moves it covers measured at zero.
- **F4 (high): the eval script's metrics were cumulative.** The new
  `scripts/eval/skim-walked-metrics.ts` measures the passes as walked, and quote length by the same
  count the prompt states.
- **F5**: four production articles (two chosen for long quotes), two 11-quote and one 6-quote local
  ones, two profiled runs, the control's spread, a blind judge for the Gist walks against an
  old-against-old control, and intros rated for orientation as well as harm. No 8-quote article
  offered eight (cephalometry offers six); the exhaustive unit test covers q = 8.
- **F6**: no *Edit* under a banner, *Edit* and the box held while a route is planned or a forced
  result awaits its read, and the double-press guard held until `ensure()` has been called. Sol
  suggested keeping *What do you want from this piece?*; kept *What are you skimming for?*, Greg's
  own words for the experiment, with the note under it saying it is the shared purpose.
- **F7**: Sol is right that the intro is text and safe to show; but `src/public/dto.ts` is a listed
  defence, so it is Greg's call: [q-t5xjqn](../user-feedback/questions/q-t5xjqn.md).
- **F8, F9**: the word count is over the record's own text, pinned by a test; no deterministic
  demotion; stored `intros` optional, the answer's required.

## Measured

[261011b](../investigations/261011b-skim-more-beats-gist-intros-and-short-stops.md): every route of
eight or more quotes grew strictly and none had to give up a Gist stop; Gist's Idea coverage
matched the control; the marked 60-word rule halved the long stops in Gist and More; a blind judge
preferred the new Gist walk 10–3 (control 3–2); 37 of 48 intros clearly orient, none gives a finding
away or mentions the reader, 4 name a topic not in their pass.
