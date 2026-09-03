# Referee mode — helping a peer reviewer read, without reading for them

**Status, 2026-09-01: all four sub-modes are built, and all four work in the store that deploys.**

**Criteria works end to end** — write a criterion, it streams, its hits are marked in the prose and
ranked in the panel, and on a `diverging` criterion each passage carries a signed valence. Verified
in a browser, not only by tests: one real criterion run, 11 ranked passages, marks in the prose, and
a colour-vision simulation over the result (see the scale note below).

**Mirror is reachable** as of 2026-09-01. `POST /api/referee/mirror/:slug` streams a run over the
referee's own comments, [`src/web/useMirror.ts`](../../src/web/useMirror.ts) holds the terminal
contract, and [`src/web/MirrorPanel.tsx`](../../src/web/MirrorPanel.tsx) draws it. Nothing is
stored: a run is a prompt to look at your own sentence again, not an artefact. The panel's one
non-cosmetic rule is that **every row prints, in words, whether a trial tested feedback of that
shape** — see § *What the evidence says* below, and
[`tests/referee-mirror-panel.test.tsx`](../../tests/referee-mirror-panel.test.tsx), which counts
both halves so "the two are distinguishable" is a claim rather than a hope.

**Claims works end to end** as of 2026-09-01 — press Pull, the paper's claims stream in, each one
carrying the passages where the paper takes it up, and ticking a claim marks those passages in the
prose. `GET`/`POST /api/referee/claims/:slug`,
[`src/referee-claims.ts`](../../src/referee-claims.ts) for what a claim is,
[`src/web/ClaimsPanel.tsx`](../../src/web/ClaimsPanel.tsx) for what a referee sees.

**Claims runs in the store that deploys, as of 2026-09-01.** It was files-only for a day: under
`SPIDERYARN_STORE=postgres` every method refused with a 501, so on a deployed server *"Pull the
paper's claims"* could not load, start or persist a run — which is how the cross-family review found
it ([260831an-referee-mode-submodes-review-sol.md](../plans/260831an-referee-mode-submodes-review-sol.md),
finding 4). Both adapters are real now and [`src/store/index.ts`](../../src/store/index.ts) picks
between them like every other pair.

**The table is an interim and says so.** A claims run is an article-derived reusable artefact whose
right home is a **pipeline artefact** — a `StepName`, an `ArtifactKind`, an `article_revisions`
column — which the plan says out loud, and that has not changed;
[`drizzle/0051_referee_claims.sql`](../../drizzle/0051_referee_claims.sql) records it in its own
header so the day it is replaced is a decision rather than a discovery. What *had* also been true was
that [`src/store/export.ts`](../../src/store/export.ts) was being rewritten in another session, so a
table could only have landed without an `ARTICLE_TABLE_COVERAGE` entry — the accident of the day
before, when `db:export` silently dropped every criterion for a day. That file is settled, so the
table landed with its entry and with a fixture that inserts a row and requires it back out of
`referee-claims.json`.

**One run per article, and no id.** A referee writes several criteria and asks the paper what *it*
claims exactly once, so the primary key is `article_id` alone and starting a run **replaces** what is
there. `created_at` doubles as the sweep's clock, which is how the Postgres store gets the grace
window `RefereeClaimsStore.sweep`'s one boolean cannot express — without it a second Vercel process
loading the panel would error a run the first one is still streaming
([`src/store/pg-referee-claims.ts`](../../src/store/pg-referee-claims.ts)).

**Candidates works end to end** as of 2026-09-01 — open the sub-mode, press **Build the reviewer
brief**, and that press creates the thread and sends the opening ask; then scope the search in the
composer and names arrive with the shortlist above the transcript. **The brief used to arrive
unprompted**, on a `useEffect` the first time the sub-mode was opened, and that is why the button
exists: the other three chips are inert, so a first-time referee clicking through the radiogroup paid
for a model call and sent paper-derived terms to a search engine without having asked for either
(2026-09-02). It is a third `ThreadKind` on chat's own machinery
(`drizzle/0050_candidates_thread_kind.sql`, [`src/converse.ts`](../../src/converse.ts) § `systemFor`,
[`src/referee-candidates.ts`](../../src/referee-candidates.ts),
[`src/web/CandidatesPanel.tsx`](../../src/web/CandidatesPanel.tsx)). See § 4 below for where each of
its four rules is enforced, and for the two that are only half-enforceable.

**The deterministic injection scan is wired**, as of 2026-09-01, and it is the one part of the mode
that calls no model. For a day it had a fixture corpus, 82 passing tests and **no production
caller**, which the cross-family review put plainly: *"it does not run before a model, its findings
cannot reach a referee, and its `coverage` cannot stop any UI from saying 'nothing found'."*
`GET /api/referee/scan/:slug` now runs it over the stored **raw source**
([`src/source-scan.ts`](../../src/source-scan.ts)), and
[`src/web/SourceScanNotice.tsx`](../../src/web/SourceScanNotice.tsx) draws the answer at the
**mode** level — above the sub-mode chips, on screen whichever panel is open — because a hidden
instruction is a fact about the document and bears on Criteria, Claims, Mirror and Candidates
alike. Rule 5 below says where each of its rules is enforced.

**The referee's own judgement is built, reachable and editable**, as of 2026-09-01 — and for one
day it was none of those while looking finished from a test file, which is worth keeping in view:

- The `comments.criterionId` and `comments.valence` columns crossed the application boundary a day
  before anything on screen could make one. `Comment` and `NewComment` carried them, the route
  validated them, both stores wrote and read them, `db:export` carried them, and eleven tests
  passed — with **no way for a referee to record a single placement**. That is the mode's own
  instance of the shape [silent-success.md](../reusable/silent-success.md) collects: a green check
  standing between two things that were never connected. Now: select a passage in Referee mode and
  the comment box offers five labelled positions on one of your `diverging` criteria; change one
  through `PATCH /api/comments/:slug/:id/mark`; and the panel prints it beside the model's
  (§ *The referee's own mark*).

**Plan**: [260831an-referee-mode-for-peer-reviewers.md](../plans/260831an-referee-mode-for-peer-reviewers.md).
**Cross-family review**: [260831an-referee-mode-review-sol.md](../plans/260831an-referee-mode-review-sol.md)
— returned "do not build as written" on the first draft; eleven of its twelve findings reshaped the
plan before anything was built, and the plan's own § *Where this plan still disagrees with the
review* is candid about the one it did not take.
**Research**: [260831e-helping-peer-reviewers/](../research/260831e-helping-peer-reviewers/README.md).

## The job, and the tension it was built to hold

Greg, 2026-08-31:

> One of the core ideas behind Spideryarn was to help peer reviewers, e.g. in science. On the one
> hand, it felt like a useful service to help them scan a document efficiently, and flag
> useful/relevant stuff. At the same time, I'm wary about handing off too much of the intellectual
> labour to AI and leading to cognitive surrender.

That is the whole design problem, and the research says the tension is measured rather than merely
plausible: across 28,028 ICLR reviews, AI-assisted reviews scored the same paper higher than human
reviews in 53.4% of matched pairs, and lifted acceptance by 4.9 points for borderline papers. An AI
that hands a referee a verdict makes the referee more lenient, and neither of them can tell.

So the mode leans on the one shape in this literature with a controlled result behind it: an AI
aimed at the referee's own thinking does better than one aimed at the paper. That is what Mirror is
— see below — and it is the reason the other three sub-modes are built the way they are rather than
the more obvious way: every one of them stops short of telling the referee what to conclude.

## Why the mode is `referee`, not `reviewer`

`review` is already a mode — the reader says what they took from a piece they have read for
themselves and the model shows them where it comes apart
([remember-mode.md](remember-mode.md); `review` was renamed to `remember` on 2026-09-01, after this
name was chosen). A `reviewer` mode beside a `review` mode would be one word meaning two things,
which this repo has already paid a rename to get out of once
([`src/modes.ts`](../../src/modes.ts) on `toc`/`hierarchy`,
[260831ak-rename-the-toc-step-to-hierarchy-everywhere.md](../plans/260831ak-rename-the-toc-step-to-hierarchy-everywhere.md)).
`referee` is also what journals call the person, so it is the plainer word as well as the free one.
Greg had not seen the name when the plan was written; the button's word is **one** string in
`MODE_LABEL` ([`src/title-text.ts`](../../src/title-text.ts)) if he wants "Reviewer" there instead.
It was three until 2026-09-02 — the dock and the visitor's owners-only sentence each kept their own
copy — and now everything that names a mode reads that record.

## The four sub-modes

`?mode=referee` with `?referee=criteria|claims|mirror|candidates`
([`src/web/referee-views.ts`](../../src/web/referee-views.ts)), following Diagram's `?diagram=`
precedent — a `role="radiogroup"` of buttons, each its own tab stop, arrow-key *selection*
deliberately withheld so the article's own arrow keys still reach the article
([keyboard.md](keyboard.md)).

### 1. Criteria — the referee's own criteria, marked in the prose

The referee writes what they are being judged against ("are the controls adequate?", "does this
cite the relevant prior work?"). Each becomes a saved, coloured, re-runnable pass over the article
whose hits are marked in the prose — Search's machinery
([search.md](search.md)), with a criterion kind (`single`, `diverging`, `literature`), and on a
`diverging` criterion a signed **valence** per passage. It is deliberately not a column bolted onto
`search_runs`: `SearchHit.confidence` is a 0–100 match strength whose validator clamps negatives to
zero, so a signed valence pushed through that field would arrive silently as `0`. Confidence and
valence are two separate numbers that are never the same field —
[`src/referee-criteria.ts`](../../src/referee-criteria.ts) is where that rule is written down and
tested, and `referee_criteria` is its own table
([`src/db/schema.ts`](../../src/db/schema.ts) § *referee criteria*).

**The prose stripe carries the valence, and until 2026-09-02 it carried criterion identity
instead.** Greg read a paper with the old rule and found the two halves of the screen contradicting
each other:

> I'm not convinced that the highlighting colour in the text matches the colour in the Referee
> Claims. Here, "So if extrapolation" counts against on the left, and yet it is highlighted with a
> green line in the text on the right. … I was thinking that it should match the colour of the
> left-hand panel. If that's set to red/green, so should the prose be.
>
> — Greg, 2026-09-02

That was not a rendering glitch. A `diverging` criterion's passages were painted twice from two
palettes with nothing on screen saying they were two: the mark in the prose from `Found.slot`, an
Okabe–Ito identity hue one of which is green, and the swatch in the panel from `valenceToken`, red ↔
green. A criterion that drew the green identity slot underlined *every* one of its passages green,
including the ones the panel called "counts against" in red. So the stripe is the direction now —
`resolveCriterion` carries the number, `hitMarks` resolves the ramp token, and
[`src/web/annotate.ts`](../../src/web/annotate.ts) deduplicates hue-bearing marks on that token so a
criterion's own −90 and +70 over one phrase stay two stripes rather than collapsing into one.
(The plan also asked for the valence in the prose gutter, beside the marked block. That is **not
built**; the gutter holds the permalink and the chat button.)

**What that gives up, said plainly.** The stripe no longer answers *which criterion made this red
phrase*. The **bar down the left of the paragraph** and the rail still read `slot` and are
deliberately untouched, so they still say which criteria are live around here — but the bar is
paragraph-wide, capped at eight, and collapses two criteria that share a slot, so it is a coarser
answer than the stripe used to give. Pressing a result now rings its exact phrase
(`mark.hit[data-hit-open]`, which Referee mode was passing `null` for and Search was not), which is
the panel→prose direction a referee actually travels. Prose→panel is not fixed: seeing a red mark
and asking which criterion said so still needs the bar or the panel. Marks are inert to the click by
design, so that was never really answered before either — the old stripe answered it only for a
reader who had memorised eight hues.
[260902f-make-referee-mode-understandable.md](../plans/260902f-make-referee-mode-understandable.md)
has the whole argument, including the alternative (one marked diverging criterion at a time) that
was not taken and stays the fallback.

**What pays for it.** [colour-scales.md](colour-scales.md) forbids colour being the only carrier of
a good/bad judgement, and the panel's four carriers are not beside the mark. So a valence-painted
mark also carries a **sign** — `−` counts against, `+` counts for, `·` counts neither way, `±` where
two results point opposite ways over one phrase and both stripes are drawn. It is written as
`data-dir` and drawn by CSS `::after`, so it is generated content rather than text: it cannot be
copied out of the article and cannot reach the block's rendered-text offsets, which
[block-ids.md](block-ids.md) would never forgive. Its **alt text is the direction in words** —
`content: "−" / "counts against"`, from `directionWords` in
[`src/web/valence.ts`](../../src/web/valence.ts) — so a reader using a screen reader hears the
carrier at the mark rather than only in the panel they may never have opened. It was empty for a
day, and the argument for that (a stray minus inside the author's sentence is worse than silence)
lost to the plainer one: a carrier nothing announces is not a carrier. And the Criteria panel prints
a **key** — *in the paper: a swatch, `−`, counts against; a swatch, `·`, counts neither way; a
swatch, `+`, counts for; `±`, counts both ways* — whenever a for/against criterion is switched on,
in the mode's own ramp rather than in the words "red" and "green".

**Where the reader has commented on a phrase a criterion also marked**, the mark prints both the
sign and the comment's `✳`, from one higher-specificity rule
([`src/web/styles.css`](../../src/web/styles.css)). An element has one `::after`, and the two rules
had equal specificity until 2026-09-02, so ours won and the reader's own marker silently
disappeared. The cascade is the only place that is visible, so
[`tests/mark-sign-in-chrome.test.ts`](../../tests/mark-sign-in-chrome.test.ts) reads the computed
content out of a real browser.

**One ramp for the whole mode**, `?refscale=rg|br`, defaulting to red ↔ green
([`--div-rg-*`](colour-scales.md#--div-rg--is-red-green-and-it-is-here-because-it-was-asked-for)),
which Greg asked for three times; [`--div-*`, blue ↔
red](colour-scales.md#--div--is-blue-red-and-it-is-the-one-to-use) is the other value. It used to be
per-criterion, and that was a second bug nobody had noticed: `valenceStep` sends −100 → 0 and
+100 → 8, so `--div-rg-0` is red for *against* where `--div-8` is red for *favour*. While the prose
carried identity the panel's words rescued it; once the prose carries direction, two criteria on one
ramp each would have put opposite verdicts behind the same red underline. In the URL rather than in a
column so it needs no migration, so a shared link carries it, and so the colour-vision switch works
*retroactively* over criteria already run. Every surface that paints a valence takes it — the panel
row's swatch, the key, and both the current-placement swatch and the five instrument positions in
[`PlaceOnCriterion`](../../src/web/PlaceOnCriterion.tsx). `referee_criteria.scale` is still written
by new rows so the column does not start lying, and is no longer read for display; there is no
control for `?refscale=` yet.

Red ↔ green is allowed only because **colour is never the carrier**: every row prints the ordinal
rank, the direction in words, the referee's own pole label and the signed number beside the swatch,
and every mark in the prose prints a sign. A browser pass on 2026-09-01 simulated deuteranopia and
protanopia and confirmed the panel half of that — every swatch collapses to the same khaki (a +70
green and a −60 red land within a few points of each other), and the four text carriers stay fully
legible. `DEFAULT_DIVERGING_SCALE` in [`src/referee-criteria.ts`](../../src/referee-criteria.ts)
writes down the condition under which this default has to move to `br`: if the panel ever stops
printing the direction in words.

#### The referee's own mark <a id="the-referees-own-mark"></a>

The referee can place a passage on the same scale themselves — a comment's own `valence` — and the
two are never averaged, because the interesting thing is the *gap* between the model's judgement and
the referee's own, not an agreement neither of them asked for (`valenceGap`,
[`src/referee-criteria.ts`](../../src/referee-criteria.ts)). It also cannot be used to avoid
reading: you cannot appear in a disagreement list without having placed the passage yourself first.

**Their mark is a comment**, not a table of its own — their words, anchored to a passage, in the
store that already has the anchoring discipline, the API and the export. That is also how a review
comment is told from a reading note: a comment with a `criterionId` is a review comment, one without
is a reading note, and nothing separate has to be kept in step.
[comments.md § the referee's own placement](comments.md#the-referees-own-placement) has the wire
shape and what the route refuses.

**Built, as of 2026-09-01**: `Comment.criterionId` and `Comment.valence`, the create input, the
validation on `POST /api/comments/:slug`, and both stores — so a **negative** placement survives the
real API rather than arriving as `0`. `db:export` carries it, and carries the criteria themselves.
**The referee makes one from the prose, not from the panel.** Select a passage in Referee mode and
the comment box grows a *"Place on a criterion"* section: a picker of their `diverging` criteria —
only those, because `markProblem` refuses the rest — and five labelled positions written in that
criterion's own pole words. [`src/web/PlaceOnCriterion.tsx`](../../src/web/PlaceOnCriterion.tsx)
carries the argument for that entry point over the obvious one, a control beside each model result:
**a control that renders the model's judgement while soliciting the referee's is measuring their
willingness to copy a number.** So the section shows no model valence at all, and
`tests/referee-anchoring.test.tsx` mounts the criteria panel and the instrument **together** — the
panel printing −87, the instrument printing no number at all — to check that it does not.

**What that does not prove, and nothing currently does.** Both halves are on one screen. A referee
may read the model's number in the panel, select the passage and then place it, and nothing records
which came first, so *"independent"* here means *"made in a control that does not itself show the
model's number"* — a real property, and a much weaker one than the mode's argument implies. Sol's
one change, if it could only have one: a **sealed-envelope** state that keeps the first pre-reveal
placement, or stop calling later placements independent.

**Greg took the second, on 2026-09-01**, and it is a decision rather than a postponement: record the
claim honestly and leave the envelope unbuilt. So the wording above is the wording, here and in the
plan — a placement is *the referee's own judgement, made after an unknown amount of exposure to the
model's*, and `valenceGap` measures that and not the thing the plan first said it did. The two
options he passed over were a write-once `valence_first` column, which makes the claim true for
placements genuinely made blind at the cost of a migration on the production database, and
withholding the model's valence for a passage until the referee has placed it, which makes
independence structural and fights the panel's own marks-default-off design. The last test in
`tests/referee-anchoring.test.tsx` pins the gap where it runs, so whoever builds the envelope meets
it; until then nothing in this repo may describe a placement as independent of the model.

**Changing one is its own operation**: `PATCH /api/comments/:slug/:id/mark`, and
`CommentStore.patchMark` beneath it on both stores — the fifth, added on 2026-09-01. Both fields
travel every time, each a value or `null`, and both `null` clears the placement back to a plain
reading note with the referee's words and passage untouched. It is a path of its own rather than two
more fields on the body patch, because a route that has to decide what an absent key means is one
missing branch away from destroying a judgement nobody mentioned
([comments.md § the referee's own placement](comments.md#the-referees-own-placement)). A second
`create` under a stored id carrying a different valence is still a 409 rather than a re-score,
deliberately: an edit has to say it is one.

**And the panel reads it back, which is where the gap becomes visible.** A result row the referee
also placed grows a second line with **their judgement first** — *"You: leans underpowered · −50 —
Model: counts against — underpowered — −64"* — and a plain sentence, *"You and the model disagree
here"*, when the two point opposite ways. Below the model's results, **"Yours, that the model did not
turn up"** lists the placements no result matched, which is the model's *misses* and only reachable
because the referee places a passage from the prose.

Matching is on criterion and block, and **it pairs only where a paragraph holds one of each**; span
overlap is deferred until same-block-different-passage is shown to be common. Where a paragraph
holds two model results, or two of the referee's placements, there is no way to say which answers
which, so a third sub-list says so — **"Yours, in a paragraph the model also answered on"**. It
replaced a scheme that handed the first placement on a block to *every* result on it and called the
rest misses: one judgement drawn twice as though the referee had made two, and a placement the model
*had* answered on labelled a miss in words (GPT Sol on the built code, 2026-09-01).

Nothing is averaged and no third number is drawn. `valenceGap` still has no caller, and the reason
is that a referee's −50 is one of five pressed words while a model's −50 is a continuous estimate —
subtracting them asserts a shared scale that does not exist, so a gap-*sorted* list needs shared
bins or an instrument recorded on each number before it can rank by distance. It is **not built**,
and it is also a ranking of the referee's own work, which wants thought first.
[`src/web/CriteriaPanel.tsx`](../../src/web/CriteriaPanel.tsx) and `tests/referee-gap.test.tsx`,
which collects every digit on the row and compares it against the numbers that went in.

### 2. Claims — where the paper addresses its own claims

Pulls the claims the paper makes up front and, for each, lists the passages that address it, by
block id — a door into the prose, not a verdict on it. The first draft ranked claims by how few
supporting passages they had and called an empty row "a finding made of structure rather than
judgement". The review's second finding said that was wrong on both counts: deciding what the
claims are, which passages count, and that nothing supports one are all judgements, and a
zero-result row may just mean the extractor missed a table, a figure, or a differently-worded
sentence. So Claims keeps document order rather than ranking by thinness, says "the model did not
find a passage for this" rather than "none" or "unsupported", and asserts *linkage* only, never
adequacy.

**Built, as of 2026-09-01, and here is where each of the three rules actually lives** — because two
of them are properties of the code and the third is only a prompt rule, and the difference matters:

- **Document order** is enforced twice, and neither comparator can see how many passages a claim has.
  `validateClaims` ([`src/referee-claims.ts`](../../src/referee-claims.ts)) sorts the authoritative
  answer by block position; `inDocumentOrder` ([`src/web/ClaimsPanel.tsx`](../../src/web/ClaimsPanel.tsx))
  sorts what the panel is *holding*, which is what keeps the order right during the stream — a
  streamed claim cannot be placed by the server, because the claims after it have not arrived. There
  is no sort control and no number anywhere on a claim row, which
  [`tests/referee-claims-panel.test.tsx`](../../tests/referee-claims-panel.test.tsx) asserts: a count
  is one glance from a ranking.
- **"The model did not find a passage for this"** is a constant the model never sees, and there are
  **three** empty states rather than two. A claim carries `discarded`, a count of the passages named
  for it that could not be found in the paper, so *the model named none* and *the model named some
  and none of them were there* print different sentences. That distinction is the one that went wrong
  in Criteria and needed a second review to catch (finding 4); it is built in here rather than
  retrofitted. The same split exists for a whole run: `CLAIMS_UNUSABLE` is a **failed** run with a
  Try again, not an empty one.
- **Linkage, never adequacy** is asked for in the prompt, said in words at the top of the panel, and
  since 2026-09-01 also **backed by a fail-safe in code**. The eval is
  [`evals/referee-claims.ts`](../../evals/referee-claims.ts) — five papers written to pull the model
  over the line, a red-first control that runs one of them again with the refusals cut out of the
  prompt, and a committed transcript
  ([`evals/results/referee-claims.md`](../../evals/results/referee-claims.md)). The line held on
  every guarded paper; the ablated control produced six adequacy verdicts in eleven passages, so it
  is the refusals doing the work. The frames the eval built to detect those verdicts — a degree, a
  negation or a comparison bolted to a support verb, with the paper's own four-word runs subtracted
  first — now live in `ADEQUACY_FRAMES` and are applied by `validateClaims`, which **blanks the
  line and keeps the passage** and reports how many it blanked. There is one copy and the eval
  imports it. It is a fail-safe rather than a guarantee: a verdict in ordinary English that avoids
  every frame still reaches the referee.

#### And the failure none of the three rules covered

The same runs found something worse than an ugly sentence, and the eval was not looking for it:
**two papers had a claim from their own abstract silently left off the list** — the same two claims,
the same omissions, on a repeat run — with the dropped claim's words swallowed inside a neighbouring
claim's quote. Every rule above is about the rows that came back, and a claim that never gets a row
is invisible: the zero-passage row and its honest sentence cannot fire when there is no row.

So the panel now prints, under the list, **what the claims did not account for**: for each block a
claim was taken from, the sentences and clauses no claim above is anchored in
(`unaccountedSentences`, [`src/referee-claims.ts`](../../src/referee-claims.ts)). A claim accounts
for the clause its quote *begins* in rather than every clause it covers, which is what makes a
three-claim sentence quoted whole under one claim show its other two.

**The wording is the whole value of it**, and it is a checked constant rather than a string in the
panel. It says *what was not accounted for* and never *the claims you missed*: a block a claim came
from carries background, citation and setup as well as claims, so calling these missed claims would
be the judgement this sub-mode refuses, made in reverse and on worse evidence.
[`tests/referee-copy-is-about-the-model.test.ts`](../../tests/referee-copy-is-about-the-model.test.ts)
holds it there, and no number appears beside them for the same reason no number appears on a claim.
It shows only once a run is **done** — mid-stream every claim that has not arrived yet would read as
an omission. What it deliberately cannot see is a whole block the model ignored, because finding
that would mean asserting where a paper's claims live, and that is a judgement.

**One run per article**, not a list — a referee writes several criteria and asks the paper what *it*
claims once — so there is no id, no colour and no delete, and a second POST replaces the first. The
route reads the article and refuses a paper with no blocks before a header goes out, because a model
asked to find claims in an empty article does not fail: it invents.

### 3. Mirror — the model reads the referee's own notes, never the paper

The referee comments as they always do ([comments.md](comments.md)). Mirror reads those comments and
the passages they are anchored to, and remarks only on the comments — never on whether the paper is
any good, and never by supplying prose the referee could paste. It is never given the article: its
input is the marked passages and the referee's own words, so "it says nothing about the paper" is
true of the input rather than merely asked of the prompt
([`MIRROR_SYSTEM`](../../src/referee-mirror.ts)). Five remark kinds — specificity, possible
misunderstanding (quoting the passage back against the comment), tone, coverage against the
criteria list, and placement (a valence recorded with nothing written under it) — and each carries
whether a trial actually tested feedback of that shape. Two of the five say no; see § *What the
evidence says* below for what that flag means and why it exists.

**Only four of the five are the model's.** `placement` is **minted in code** and the comment behind
it is never sent anywhere: the fact is computable — a valence with no body — and the sentence is
fixed, built only from the number, the criterion's own text and the absence of writing. A model
`placement` is dropped whatever it says. This was not the first design, and the reason for the
change is worth keeping: asked to produce these, the model invented the rationale the prompt
forbade it to guess — *"why lack of participant blinding warrants this weight"* — inside the very
sentence saying the referee gave no reason. A cross-family review and the agent building the
hardening reached the same conclusion separately. It deleted forty-two lines of prompt, removed an
injection surface, and turned *placements always qualify* from a wish into something the code does.
A comment carrying **both** a number and words still goes to the model, because there the writing is
the subject and the number is only context.

Built, as of 2026-09-01, and here is the whole of it:

- **The call** — [`src/referee-mirror.ts`](../../src/referee-mirror.ts): the prompt, the input
  builder, the validator, the stream, and an eval with a committed transcript. Its shapes live in
  [`src/referee-mirror-types.ts`](../../src/referee-mirror-types.ts), a leaf that imports nothing,
  because the browser draws them and nothing under `src/web/` may import a module that reaches
  `node:crypto` (`tests/client-imports.test.ts`).
- **The route** — `POST /api/referee/mirror/:slug`, no body, SSE out. It reads the article, the
  comments and the criteria before a header goes out, and nothing is stored. A `delta` frame carries
  **a character count, not characters**: what streams is one raw JSON object whose pointers the
  validator has not checked yet, so there is nothing in it a panel could honestly show — the count
  buys the one thing streaming buys here, which is the referee being able to tell *waiting* from
  *being answered*.
- **The hook** — [`src/web/useMirror.ts`](../../src/web/useMirror.ts). Zero or more `delta`, then
  exactly one `done` or `error`; a body that ends with neither is a failure. That contract matters
  more here than almost anywhere, because Mirror's correct answer is usually an empty list, and a
  stream that stopped after two bytes looks exactly like a run that found nothing to raise.
- **The panel** — [`src/web/MirrorPanel.tsx`](../../src/web/MirrorPanel.tsx). Every row prints
  whether a trial tested feedback of that shape, as a word rather than a colour; *nothing to raise*
  and *nothing to read back* are two different sentences; and there is no way to copy anything out
  of it, because Greg vetoed a report scaffold and a suggested rewrite is that feature by another
  door.

### 4. Candidates — who could review this, for an editor

The odd one out: not a referee's question but an editor's, added after Greg overruled the plan's own
cut —

> I do want to include candidate reviewers/referees to help editors because a friend explicitly said
> this would help them.
>
> — Greg, 2026-09-01

— and then reshaped, the next morning, from a bespoke panel into a special use of Chat:

> Probably this should be a special reuse of Chat mode, to get access to tools and make it
> interactive and potentially multiple messages back and forth.
>
> — Greg, 2026-09-01

**It is Chat with a third personality, not a panel of its own.** `candidates` is a third
`ThreadKind` beside `chat` and `remember` ([`src/types.ts`](../../src/types.ts)), so it inherits
streaming, the tools, OpenRouter's server-side web search, citation collection, thread persistence
and retry for nothing. What had to change was small and known: the `chat_threads_kind` CHECK
(`drizzle/0050_candidates_thread_kind.sql` — the *widening* direction, which needs no data movement
between the drop and the re-add, unlike 0048), both stores' normalisers, the route's validation, and
one branch in [`src/converse.ts`](../../src/converse.ts). It bills under its own job,
`referee-candidates`, because it is the only conversation here that runs several web searches a turn.

**The thread opens with the fit brief — on one press.** What a competent reviewer of this paper
would need to know — methods, subfield, statistics, the domain knowledge the claims assume — each
requirement anchored to the passage that motivates it. That half has no hallucinated-person failure
mode, is useful on its own, and is the query the conversation then refines. The plan says explicitly
that this is where to stop if the names layer disappoints.

**It used to fire on mount, and that was wrong for a reason larger than the money**, fixed
2026-09-02. The sub-modes are a radiogroup, a first-time referee reads a radiogroup by pressing along
it, and the other three chips are inert to a press. So clicking Candidates to find out what the word
meant bought a run over the paper **and** sent search terms drawn from an unpublished manuscript to a
search engine — *a different third party at a different time* from the model provider the band's
notice is about, and one the notice cannot cover, because it is in the past tense and this had not
happened yet. It is behind a labelled button now, and the button's visible words name both parties
before either is reached. Everything after the first press is unchanged: the thread is stored, and
coming back to the sub-mode finds it and asks nothing.
[`tests/referee-candidates-press.test.tsx`](../../tests/referee-candidates-press.test.tsx).

**Chat steers; a list is what you look at.** The panel keeps a browsable shortlist *above* the
transcript, revised by whichever answer most recently carried one. This is the editor research's
finding rather than a preference: people *like* chat and *perform worse* with it on comparison tasks,
and choosing between candidates is a comparison task
([editors-and-finding-reviewers.md § 7](../research/260831e-helping-peer-reviewers/editors-and-finding-reviewers.md)).
The same research is why the prompt asks for a **long** list rather than a good one — invitation
acceptance has fallen from 56% to 36–39% over a decade and roughly one accepted review in four is
never delivered — and why nothing anywhere ranks by prominence.

#### Where each of the four rules actually lives

Two are properties of the code, one is half of each, and one is a sentence the model cannot talk the
panel out of printing. The difference is the point:

- **No name without a source link the web search actually returned.** Code.
  `readShortlist` ([`src/referee-candidates.ts`](../../src/referee-candidates.ts)) is given the URLs
  OpenRouter's own annotations reported *across the whole conversation*, and a candidate whose
  sources meet none of them is dropped. Not "a URL that parses": `isWebUrl` is necessary and nowhere
  near sufficient, since a plausible name beside a real-looking address is exactly what a model
  produces well. The **title** shown beside a source is the search result's, never the model's.
- **Every candidate answers a fit-requirement and links the passage behind it.** Code. A row with no
  requirement, or with a block id this paper does not have, is dropped.
- **The paper's own authors are excluded.** Half and half, and the panel says which half ran.
  `authorKeys` reduces the byline to surname-plus-initial keys and `readShortlist` drops any
  candidate matching one — so "Jane Doe", "Jane Q. Doe", "J. Doe" and "Doe, Jane" are one person and
  an unrelated namesake is not thrown away. What it cannot see is an author named only inside the
  paper's own prose, or a PDF with no byline at all; the prompt is told separately to exclude those,
  and that is a wish. So the panel prints **which byline the check ran against**, or that there was
  none. This is the one call in Referee mode that legitimately sees the byline (rule 4 below), and
  only to exclude.
- **Conflict of interest is two different things and the panel must not blur them.** Copy, printed
  whatever the answer said. Half of what publishers name — co-authorship inside a 3–5 year window, no
  two of them agreeing on the number; shared current institution; joint grants — is mechanically
  checkable from OpenAlex or ORCID, and **this app checks none of it, because it has no identity
  graph**. The other half — advisor and advisee, which several publishers treat as lifelong;
  rivalry; informal collaboration — is not automatable by anybody, and is what the conversation is
  *for*: *"exclude anyone who trained under X"* is the editor's own knowledge, which no database has.
  Presenting an algorithmic pass as though it caught everything is the specific move the research
  says editors already distrust.

**Where rule 1's evidence comes from, measured on the wire.** The rule can only check what
OpenRouter's `url_citation` annotations report, and **the search engine decides whether those arrive
at all**. Under the default engine the search runs inside Anthropic and an annotation appears only
where the model attributes a result *in its prose*: the first live run of Candidates ran four
searches, produced six well-sourced people, emitted **zero** annotations, and had all six dropped as
uncited — the rule doing the exact opposite of its job. A probe on 2026-09-01 settled it. Identical
prompt both ways, two searches each, the answer told to reply with the single word `DONE` and
attribute nothing:

| | searches | annotations |
| --- | --- | --- |
| default engine | 2 | **0** |
| `engine: "exa"` | 2 | **9** |

Every one of the nine arrived *before the first content token*, with `start_index === end_index === 0`,
carrying `url`, `title` and a 250–5,300 character extract of the page. So under Exa the results are
delivered at search time rather than at attribution time, which is what turns rule 1 from a hope into
a check — and it is why [`webSearchTool`](../../src/converse.ts) asks for that engine on Candidates
turns and no others. The earlier note here recommending `plugins: [{ id: "web" }]` was wrong twice
over: OpenRouter documents that plugin as deprecated in favour of this server tool, and the server
tool solves the problem better, since the plugin always runs exactly one search.

**There is no search budget, and the code must not claim one.** The same probe sent `max_uses: 2` and
asked for six searches; OpenRouter reported `web_search_requests: 6` and `tool_calls_executed: 6`.
`max_total_results` *was* honoured to the row — four asked for, four returned, out of those six
searches — so that is the cap Candidates sets. What is limited is how much comes back, not how often
it searches.

**Rule 1 governs the screen, not the JSON.** A cross-family review found the hole on 2026-09-01: the
validator ran on the fenced block, the panel then stripped the fence and rendered the surrounding
prose, and a model that listed six people in the block and introduced the same six in the paragraph
above it put all six on screen beside an empty shortlist. So the names are now cut out of the prose
too — `redactNames` in [`referee-candidates.ts`](../../src/referee-candidates.ts), against the exact
strings the block put forward, so no guess is needed about what a name looks like in running text.
The paragraph itself stays: what was searched and why somebody fits is the point of the sub-mode, and
an editor who lost the transcript would be worse off than one who read a name too many. The prompt
now forbids names in prose outright, which leaves one residual and it is stated rather than left to
be found — **a name the model writes in prose and omits from the block entirely is not known here and
is not cut.**

**A citation cannot reach backwards.** The allowed-URL pool is every citation from the start of the
thread **up to and including** the answer being validated, and not one message further. More than one
answer, because the model re-emits the whole shortlist every turn and a person found at turn two is
still in turn five's fence; but nothing later, because a search run at turn five standing up a name
written at turn two is a rule that can be satisfied by waiting. What the pool still does **not**
prove is that the page is about the person it is filed under: a hallucinated name paired with a real
URL from an earlier search passes. Closing that means matching the person's name against the search
result's own title and snippet — now feasible, since the Exa probe shows the wire supplies both, but
it needs `Citation` to carry the snippet through [`types.ts`](../../src/types.ts),
[`openrouter-stream.ts`](../../src/openrouter-stream.ts) and the thread store. That is the first
follow-up job here.

**What was dropped is counted on screen, and so is what the cap never read.** *The model named
nobody* and *the model named eleven people and none of them could be shown* are different sentences
and the panel prints different ones — Claims' lesson rather than Criteria's, built in from the start.
Past forty rows the panel says how many more were listed and not read, the way Mirror surfaces
`placementsOmitted`: a list that silently truncates has made *position* a ranking, in the one panel
built to have none. **And the bias is labelled rather
than denied**: the panel says the list leans towards people the web indexes well, which is the honest
version and the useful one, because it tells the editor what they are looking at.

**No number beside a name, and no sort control.** Rule 1 is *no verdict, ever*, and an ordinal on a
person's row is one glance from a ranking of people — which is also what the matching research warns
against, since every sort key an editor would reach for is prominence-shaped. 20% of researchers
already do 69–94% of all reviewing, and editor gender-homophily in selection is measured at 33%
against 27%. [`tests/referee-candidates-panel.test.tsx`](../../tests/referee-candidates-panel.test.tsx)
asserts there is no digit on a candidate row that is not a block id.

**Not in v1: any scholarly identity graph.** OpenAlex, ORCID and Crossref could back real
co-authorship COI checks and that is the obvious next step. It is also a different project, and
Greg's own framing was *"see how far we can get in a stage or two"*.

## Every control says what it does

> The new Referee mode is very confusing. Add lots of explanatory tooltips to buttons etc.
>
> — Greg, 2026-09-02

The mode had **no** hover cards at all until that ask: four one-word sub-mode chips over four
unrelated things, a coloured square with no glyph, a large numeral that reads like a severity score,
and a `<select>` that throws a judgement away when you use it. Every control now carries a
`ControlTip` — [tooltips.md § `ControlTip`](tooltips.md#controltip-which-is-what-most-of-them-are-now)
is the shape and the rule, which is that the second sentence must be the half a press would *not*
tell you. Here that half is nearly always one of three things: **a model call is about to be spent**,
**something is about to be overwritten**, or **this is not the judgement it looks like**.

Where the cards are, and the one thing each says that the label cannot:

| Control | The half a press would not tell you |
|---|---|
| the four sub-mode chips ([`App.tsx`](../../src/web/App.tsx) § `RefereeViews`) | Criteria never scores; Claims asserts linkage and not adequacy; Mirror is never given the paper and stores nothing; Candidates reaches a search engine and checks no conflicts |
| the three kind chips | `KIND_NOTE` — the same string the panel prints under the selected kind, so the two kinds a referee has *not* pressed explain themselves too |
| the preset chips | they replace the whole form: text, kind and both poles |
| *Run this criterion*, *Pull the paper's claims*, *Try again* | one model call over the whole paper, at full price, nothing resumed |
| the colour swatch, and *Automatic* | on a for/against criterion it colours the paragraph bar and the rail and **not** the marks; automatic is a hash of the criterion's id, and there are eight |
| Candidates' *Build the reviewer brief* button | an AI turn starts, it may take several provider requests, and it **may** run a web search — the only place in the mode that reaches a search engine |
| Claims' tick, and *other text in quotes* | the passages are the model's pick and not a verified linkage; marks are off until asked for; and that list is **not** the claims the model missed |
| Mirror's coverage row | it has nowhere to send you, which is the whole of what it is saying |
| Mirror's jump button | the passage is where **you** anchored the comment — Mirror chose the remark and never the passage, and is not given the paper to pick one from |
| Candidates' shortlist heading and tool strip | each turn **replaces** the shortlist; the strip is the check on *"never claim a tool you did not run"* rather than decoration |
| [`PlaceOnCriterion`](../../src/web/PlaceOnCriterion.tsx)'s criterion picker | switching criterion clears the position you pressed — the highest-value sentence in the mode |

**Four labels changed, because a tooltip is not read by anybody in a hurry**, which is what a
referee is and what [`MirrorPanel.tsx`](../../src/web/MirrorPanel.tsx) already says about itself.
Where the words on the control were themselves misleading, a card is not the fix:

- **"Two ends" → "For / against."** Ours named the shape of the data; the referee's names the
  question, and it says what the two fields that appear underneath are for.
- **"Tested in a trial" → "A kind tested in a trial"**, and its negative. Beside one remark the old
  wording read as a claim that *this* remark had been checked and had held. What the ICLR 2025 trial
  tested is the **category**; whether any one remark is right is untested and untestable, and
  `EVIDENCE_NOTE` says so in a line a hurried referee does not reach.
- **Mirror's `title="Go to this passage"` became a real card**, which is the anti-pattern
  [`Tooltip.tsx`](../../src/web/Tooltip.tsx) argues against in its own docstring: a second's wait,
  unstyleable, truncated, and absent altogether on a touch device.
- **"Find reviewers — one model call and a web search" → "Build the reviewer brief."** Both halves
  of the old label were false, in opposite directions. The press buys the **fit brief**, and
  `CANDIDATES_OPENING` in [`src/referee-candidates.ts`](../../src/referee-candidates.ts) ends *"No
  names yet"*; and the count was wrong twice over, because web search is offered on every round and
  the model decides whether to use it — so it may run **zero** times — while each tool round is a
  fresh provider request, up to `MAX_TOOL_ROUNDS + 1` of them
  ([`src/converse.ts`](../../src/converse.ts)). A disclosure that names a number is a disclosure
  that can be wrong. The other route on offer was to suppress search and multi-round tools for the
  opening turn so the promise came true; it was not taken, because it means a per-turn tool policy
  threaded from a button through the chat route into `converse` — a client deciding what the server
  may call, in the one place "what did this cost" has to stay answerable from the server alone. The
  words were what was wrong, so the words changed.

**And two cards were deleted, because a card that repeats what is already on the screen is worse
than no card** — a cross-family review's finding, 2026-09-02:

- **The rank numeral's.** It was hover-only and could not be otherwise, and once
  `WHAT_THE_RANK_IS` was a visible line above the list (below) the card was a second copy for the
  one group that already had the first.
- **Mirror's evidence badge's.** Its first paragraph restated the badge and its second *was*
  `EVIDENCE_NOTE`, which the panel prints in full, visibly, under that same list. What pays for the
  removal is the label change above: *"A kind tested in a trial"* is where the misreading actually
  lived.

**And one message stopped offering an action Claims does not have.** `ANSWER_OVERFLOWED` in
[`src/messages.ts`](../../src/messages.ts) said *"Asking for something narrower usually fits"*, flat.
`parseHits` in [`src/search.ts`](../../src/search.ts) is Search's parser *and* this mode's, so a
criterion run, a claims pull and a Mirror run all end there — and none of those three has a scoping
control of any kind. [copy.md](copy.md) rule 3.

The first fix **conditioned** the clause — *"where you asked a question of your own"* — and a
cross-family review showed that still misses: **a criterion is precisely the referee's own
question**, so the condition reads as satisfied on the very screen it was written to exclude, and an
errored criterion offers *Try again* and nothing else. So the message **split**, which is
`MARK_CUT_OFF`'s shape rather than a new idea — one diagnosis, a caller who cannot take the advice,
its own code, because [`tests/messages.test.ts`](../../tests/messages.test.ts) refuses two sentences
under one code and is right to:

- `ANSWER_OVERFLOWED`, `[ai-overflowed]`, keeps the narrowing advice and goes to **Search**, whose
  reader typed the ask. It keeps the code because that is the one already quoted in the wild.
- `ANSWER_OVERFLOWED_FIXED_ASK`, `[ai-overflowed-no-ask]`, is the retry and nothing else, and it is
  what the mode's three callers get.

`parseHits` takes an `AskKind` to choose, defaulting to the one that promises least, so a sub-mode
added later cannot inherit advice about a control it does not have.

**Which caller gets which sentence is proved at the four public entry points**, not at the parser:
[`tests/overflow-message-reaches-its-caller.test.ts`](../../tests/overflow-message-reaches-its-caller.test.ts)
drives `findPassagesStream`, `runCriterionStream`, `runClaimsStream` and `mirrorStream` over a
cut-off answer and asserts the exact sentence and code each one ends with. Testing the parser alone
proved only that it branches: removing `"editable"` from Search's one call site, or adding it to a
Referee caller, left the whole suite green until 2026-09-02.

**What the cards are not.** They are not where a rule lives. Everything load-bearing is still visible
text on the panel — `LINKAGE_NOT_ADEQUACY`, `WHAT_THE_TICK_DOES`, `DOCUMENT_ORDER_NOTE`, the
evidence badge on every Mirror row, `COI_NOT_CHECKED` — and the cards sit on top of those rather than
in place of them. [`tests/referee-tooltips.test.tsx`](../../tests/referee-tooltips.test.tsx) pins
that each control has a card, that the card is that control's, that a `title` attribute has not crept
back, and the changed labels as literals.

**And that a card is worth its hover.** Its generic check was `body.length > 80`, which passed long
repetition — the exact failure the review found in four cards — so it now compares the two paragraphs
against each other and against the label. It also reaches Claims, Candidates and `PlaceOnCriterion`,
which it did not import at all until 2026-09-02: deleting any of their cards left the whole suite
green.

**It is a floor and not a reader.** It ignores any label under three content words, and Mirror's jump
card lived in exactly that gap: *"Scrolls the paper to the passage this remark is about"* under *Go
to this passage*, which reduces to the single word *passage*. Lowering the floor was measured and
rejected — at two the card is still missed, and at one the check fires on any honest sentence that
uses the noun its control is named after, the replacement copy included. Important cards get an
explicit assertion instead, which is what the jump card now has. That card's first paragraph is now
its **provenance**: the passage is where the referee anchored their own comment.

### The two gaps a card could not close

Both were found by stage 2 and recorded rather than accepted, and both have the same shape: a card
that cannot be reached is not an explanation.

- **The *Run this criterion* card was unreadable in the state that needed it.** A `disabled` button
  emits no pointer and no focus events, so nothing opens a card on one — and the referee who wants to
  know what the button costs, or why it is dead, is standing in front of exactly that. It carries
  `aria-disabled` now, so it stays hoverable, focusable and announced as unavailable, with
  `.crit-run[aria-disabled="true"]` in [`styles.css`](../../src/web/styles.css) doing what `:disabled`
  used to. **`aria-disabled` does not stop an activation**, so the inertness stays where it already
  was: the form's `onSubmit` returns on an incomplete criterion, which catches the click, the Enter
  and the Space alike.
- **The rank numeral's card was hover-only and could not be otherwise.** The numeral is a `<span>`
  inside the jump button, so it takes no focus, and a `tabIndex` there would put a tab stop inside a
  button. So the fact itself is now a **visible line above the list** — *the number is the model's
  ordering of its own answers for that criterion, not a score* — printed once a run has returned
  something, beside `WHAT_THE_TICK_DOES`. **And the card is gone**, 2026-09-02: once the line
  existed the card said the same thing again to the one group that could already read it.

[`tests/referee-criteria-explained.test.tsx`](../../tests/referee-criteria-explained.test.tsx) holds
both, including the part jsdom cannot demonstrate: it dispatches events to `disabled` elements
happily, so the old spelling passed a "the card opens" test here and failed it in every browser.

## The card that says what the mode is for

The cards above answer *what does this control do*. They cannot answer *what is this mode*, because a
card only opens on a control you already suspected. So there is one **"How Referee mode works"** card,
under the sub-mode chips at the top of the panel:
[`src/web/RefereeCard.tsx`](../../src/web/RefereeCard.tsx).

**Two short paragraphs.** The refusal — *you are the referee; nothing here scores the paper or drafts
your review* — and what the colours mean, which is stated as the *shape* of the rule rather than as
red and green, since `?refscale=br` paints the same two directions blue and red.

**It had a third part and it was cut**, 2026-09-02. A line each on the four sub-modes sat between
those two, and it was an artefact of the order the work landed in: stage 2 had already put a
`ControlTip` on each of the four chips directly above this card, so every one of those lines had a
second copy that opens on the chip it is about. The card is kept short deliberately — *a card longer
on screen than the panel underneath it has failed at the thing it is for* — and it was breaking its
own rule. Measured in Chrome at 1280×900 on an article with no criteria: **409.5px** before,
**203.1px** after, against a 269.9px empty-state Criteria composer underneath it.

**It is in `.ref-panel`, not `.ref-brief`.** That matters more than it looks. `.ref-brief` holds the
confidentiality notice and the injection scan, and neither of those may ever be dismissed — a
closable card sitting beside a non-closable one invites closing the wrong one, and teaches a referee
that the box above ought to close too. The card is in the scroller with the sub-mode, where
everything is transient by construction.

**Shut it and it stays shut; the header's *How this works* button brings it back.** One bit, in
`localStorage`, and reopening clears it rather than opening the card for one mount — otherwise the
button works once and the card is gone again on the next paper, which reads as the button not having
worked. [`src/web/referee-card.ts`](../../src/web/referee-card.ts) is the store and the whole argument
for it; [`tests/referee-how-card.test.tsx`](../../tests/referee-how-card.test.tsx) pins both
directions and the case where the browser refuses to keep anything.

**Why `localStorage` at all**, when `RefereeBand`'s own docstring used to say it was banned outright
citing [url-state.md](url-state.md): that was the flat version of a real rule rather than the rule.
View state — *how you are looking at an article* — goes in the URL because it has to survive a reload
and travel when the address is pasted to somebody else. A per-device *"I have read this"* bit is
neither: it is not about this article, and pasting it at somebody else would be pasting your own
reading history at them. The install hint was already the exception; this is the second, and it is the
same kind of thing rather than a new kind. The alternative considered and dropped was a
reader-profile column, which is a migration for a checkbox.

**What the card is not** is a way to dismiss the confidentiality notice. That notice collapses, is
never dismissed, remembers nothing, and starts shut on every visit — see § Confidentiality below.

## The rules the whole mode obeys

Each is meant to be a test rather than an intention, whichever sub-mode eventually enforces it:

1. **No verdict, ever.** No accept/reject, no overall score, no per-criterion grade.
2. **Every row is an index into the piece** — no finding without a block id.
3. **Hedged and labelled**, reusing Search's own copy: the model's own judgement about its own
   answer, not a measurement of anything.
4. **Referee calls are identity-stripped.** The research's own finding is that models rate papers
   higher for prestigious institutions and famous authors, the same bias human reviewers carry.
   [`article-prompt.ts`](../../src/article-prompt.ts)'s `head()` normally emits `BY:`,
   `PUBLISHED IN:` and `URL:` into every prompt; an `ArticleIdentity` of `"anonymous"` drops all
   three and keeps only `TITLE:`, and it is additive — nothing else changes. Candidates is the one
   stated exception, and only to exclude the paper's own authors from its own suggestions.
   **Read the name narrowly: it strips the metadata labels, not the identity.** Every byte of every
   block still goes, and a PDF's title page routinely carries the authors, their institutions and
   their email addresses as ordinary prose — so "anonymous" means *this app did not prepend a
   byline*, not *the model cannot tell who wrote it*. The cross-family review called the earlier
   claim an overstatement (finding 7) and the test that appeared to prove it theatre, because its
   fixture contained no identity to strip;
   [`tests/article-prompt.test.ts`](../../tests/article-prompt.test.ts) now asserts the limit
   instead, with a title-page block. Closing the gap means changing extraction or the prompt, not
   `head()`.
5. **A deterministic injection scan, before the model, not by it.** The first draft made
   hidden-instruction detection a *criterion* — asking the possibly-compromised model to find the
   attack on itself, which is detection after exposure by the component under attack. Instead:
   [`src/injection-scan.ts`](../../src/injection-scan.ts) scans the stored raw source, before any
   model call, for the known tricks — white-on-white text, zero or near-zero font size, off-screen
   positioning, invisible Unicode, and a plainly-printed instruction, which is its own finding kind
   with its own caveat because hidden text has no innocent explanation and visible text usually
   does. In July 2025, 18 arXiv preprints from 14 universities carried hidden *GIVE A POSITIVE
   REVIEW ONLY* text ([arXiv:2507.06185](https://arxiv.org/abs/2507.06185)).

   **The result says what it did not look at.** `SourceScan` is a discriminated union whose
   `findings` exist only on the examined arm, so a PDF — which is not scanned at all — cannot render
   as "nothing found"; and `blindSpots` is never empty, because the cascade is always an
   approximation. Inheritance, specificity and the `!important` tier are implemented; masks and
   `z-index` layering are deliberately not, since neither can be decided without rendering and the
   only cheap rule fires on every decorative element. [security.md](security.md) has the full list
   of what it cannot see, which matters more than what it can.

   **Where it runs, and where a referee reads it.** `GET /api/referee/scan/:slug` →
   [`src/source-scan.ts`](../../src/source-scan.ts) → `scanRawSource`, over the document `loadSource`
   hands back — the **raw source**, never the extracted blocks, because extraction throws hidden
   text away with everything else it does not keep. The panel is
   [`src/web/SourceScanNotice.tsx`](../../src/web/SourceScanNotice.tsx), drawn by
   [`RefereeBand`](../../src/web/App.tsx) above the sub-mode chips rather than as a fifth chip: rule
   5 says *before anything else*, and a chip is one more thing a referee can fail to press. The band
   opens at once and the answer lands when it lands ([`useSourceScan`](../../src/web/useSourceScan.ts)),
   because a scan is hundreds of milliseconds on a short paper and about nine seconds on a 1.3 MB
   one.

   **Five rules, and each is code rather than an intention.** A PDF says *not checked* and can never
   say *nothing found* — the `switch` on `examined` is exhaustive and that arm has no `findings` to
   count. A clean result never travels without its caveat. A finding wearing an `ordinary` label is
   **sorted last and still drawn**, with the sentence saying the label is read off class names and
   is therefore forgeable. A `visible-instruction` prints its required `caveat`, because hidden text
   has no innocent explanation and visible text usually does. And the panel is **shut unless
   something was found**. `tests/source-scan-notice.test.tsx` holds all five,
   `tests/referee-scan-route.test.ts` holds the wire, and `tests/source-scan.test.ts` holds the
   cache.

   **Shut, and what that costs rule 2.** Greg, 2026-09-02:

   > Make the "hidden instructions" default-collapsed unless something has been found. Explain in
   > tooltip much more clearly what the intent is, and how worried to be based on the results (in
   > this case, it didn't run any test, so we have no information one way or the other, so not very
   > worried).

   The default is **computed from the result rather than remembered**: open when the scan looked and
   found something — a labelled finding counts, because the label is forgeable — and shut otherwise,
   including for a PDF, which is no news in either direction. Nothing is persisted, so a referee
   meets the same first screen every visit and one press opens it.

   The cost lands on rule 2, which used to be *`blindSpots` is printed beside every clean result,
   never behind a disclosure* — and the list is now behind one. So **the caveat moved into the
   headline**: the line a referee reads shut says *nothing found in the HTML source — which is not a
   clean bill*, and the list of what was missed is what opening it gets you. The headline is the
   one thing on screen in every state, and `tests/source-scan-notice.test.tsx` § *shut unless
   something was found* holds that.

   **The tooltip on the heading says how worried to be**, and it is different in each of the seven
   states, because *no check ran* and *a check ran and found nothing* call for different amounts of
   worry and neither of them is much. Its first paragraph — what the scan is for at all — is also
   the last line inside the open panel, from one constant, because a tooltip does not exist on a
   touch device.

   **The result is cached in memory on the sha256 of the bytes that were scanned, and nowhere
   else.** That is a decision rather than a stage on the way to a table, and the reasoning is on
   [`src/source-scan.ts`](../../src/source-scan.ts): the scan costs no money and is deterministic,
   so a cache miss is CPU rather than a different answer; a *durable* cache would need a scanner
   fingerprint somebody has to remember to bump, which is the bug
   [`src/pdf-read.ts`](../../src/pdf-read.ts) shipped and wrote up; and a result that cannot outlive
   the code that made it cannot go stale. If a cold scan ever proves too slow in production the next
   step is a **pipeline artefact produced at ingest**, not a bespoke table. Unlike Claims, nothing
   here is store-shaped, so a Postgres deployment gets a real scan rather than a `notMigrated`
   refusal.
6. **Confidentiality**, below.

## Confidentiality: exact, and unflinching about the tense

By the time a reader reaches Referee mode, the article's text has already gone to a third-party
model provider — `DEFAULT_INGEST_STEPS` runs extraction, hierarchy and gists at ingest
([`src/pipeline.ts`](../../src/pipeline.ts)), and a PDF is read by a model before it is anything
else. The first draft of this plan put a notice about that fact *inside* Referee mode, phrased as
something still to decide. The cross-family review called that the single most serious finding in
the draft: a notice at that point warns about something the app has already done, and an
acknowledgement there would be worse than none, because it would imply that ticking a box makes
prohibited use permissible.

So there are three sentences, in three places, and the **tense is the whole point**:

- **Present tense, at the point of adding an article, before ingestion runs** —
  `ADDING_SENDS_TEXT_AWAY` ([`src/messages.ts`](../../src/messages.ts)), shown under both the URL
  box and the upload picker in [`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx). One
  sentence, no gate, no checkbox. It is true of everything this app does and belongs there whatever
  happens to Referee mode.
- **Past tense, on the direct-add pages, because they never got to ask** — `DIRECT_ADD_SENT_TEXT_AWAY`
  (`src/messages.ts`), shown by [`src/web/AddPage.tsx`](../../src/web/AddPage.tsx). `/add/<url>` and
  `/add/upload/<id>` exist so that a bookmarklet or a share sheet can hand us an article in a single
  address, which means there is no form and no Add button: the page queues the ingest from its first
  effect, so the POST has already gone by the time anybody can read a word on it. The cross-family
  review of the *built* code found the sentence missing here entirely — finding 1, and the same
  finding as the one above, only on the path that has no pause in it. A present-tense warning would
  have been false, so this one is `ADDING_SENDS_TEXT_AWAY` with its tense corrected. It is behind
  the page's `ok` flag, because an address we refused to queue is the one case where nothing was
  sent. `tests/direct-add-says-the-text-has-gone.test.tsx` asserts both the sentence and the
  asymmetry, so that making the three disclosures "consistent" goes red.
- **Past tense, inside Referee mode itself** — `REFEREE_TEXT_ALREADY_SENT`
  (`src/messages.ts`), shown by `RefereeBand` ([`src/web/App.tsx`](../../src/web/App.tsx)), and
  **collapsed since 2026-09-02** at Greg's asking. The *fact* is the label on the control —
  `REFEREE_TEXT_ALREADY_SENT_SHORT`, which is the long sentence's own opening clause — so shutting
  the box hides the venues and the audience, never that the text has gone; and `noticeOpen` is a
  `useState` that remembers nothing, so every visit starts shut. That is the difference between a
  collapse and a dismissal, and it is why the storage objection below does not apply: there is
  nothing to store. It does
  not pretend a choice is still open: this article's text has already been sent, that happened when
  it was added, and here is what NIH, NSF, Elsevier, Springer Nature, Wiley, NeurIPS and ICLR all say
  about that as a confidentiality breach in itself, separate from who writes the review. It names
  the audience the mode is honestly for — public preprints, open-review submissions, and drafts
  shared with the reader with the author's consent — rather than telling somebody to go check an
  agreement the app has already breached on their behalf. A second sentence,
  `REFEREE_DECLARE_IT`, adds the fact for the venues that do permit AI assistance: they still nearly
  always require the referee to disclose it.

There is deliberately no acknowledgement to tick in any of the three — a box reading "I understand" in
front of something already done would itself imply that ticking it makes prohibited use
permissible. A blocking attestation at ingest is a real product question and is Greg's to make, not
this mode's.

## The band has to fit, and for a day it did not

Both of the boxes above the sub-mode chips were always on screen and open, in full, on every visit.
What nobody had checked is what they cost. Measured in Chrome on
2026-09-01 at **1280 × 720**, an ordinary window, on an article whose scan found **three** things:
the head 41px + the notice 214 + the scan 386 + the chips 46 = **687px inside a 636px band**. The
chips started below the fold, `.ref-panel` was **0px tall with 321px of content in it**, and
`.mode-band` is `position: fixed` with `overflow: visible`, so there was nothing to scroll and
nothing clipped — Criteria, Claims, Mirror and Candidates were all simply unreachable, on any window
shorter than about 1400px. Every test was green throughout, because jsdom has no layout engine.

The fix is a `.ref-brief` wrapper around the notice and the scan, capped at 40% of the band with its
own scroll, and a `min-height` floor under `.ref-panel` so it is no longer the one child flexbox is
willing to squeeze — [`src/web/styles.css`](../../src/web/styles.css) § *referee mode* carries the
measurements and the two fixes that were passed over. A referee still meets the whole
confidentiality notice without scrolling at 1280 × 720; below the notice, the scan is one scroll
away behind a trailing fade, and the panel keeps 294px. Verified across four sub-modes at seven
viewport sizes from 1280 × 1400 down to 390 × 560 and 900 × 337.

[`tests/referee-band-fits.test.ts`](../../tests/referee-band-fits.test.ts) holds the half a test can
reach: the rules exist and say the right thing, and the markup they are aimed at still puts the
notice and the scan inside the wrapper and the chips and the panel outside it. It is explicit that
it cannot measure anything, and why a test that tried would have passed before the fix.

**Both boxes collapse now** — 2026-09-02, and it is a product change rather than a second layout
fix. The ordinary first screen of the preamble is two lines, so the cap and its trailing fade are
what hold the *open* case rather than the every-visit one; the measurements above are of that open
case and are still the ones to design against.

## What the evidence actually says, and where the plan overstated it

Two numbers carry nearly all of the design:

- **53.4%** — the share of matched ICLR review pairs where an AI-assisted review scored the same
  paper higher than the human one, with acceptance lifted 4.9 points for borderline papers. This is
  why no sub-mode produces a verdict, a score, or anything that reads as one.
- **27%** — the share of ICLR 2025 reviewers who revised their own review after a tool critiqued it
  for vagueness, overlooked content, or unprofessional tone ([arXiv:2504.09737](https://arxiv.org/html/2504.09737)),
  in a randomised trial. This is the shape Mirror copies: aimed at the referee's own words, never at
  the paper.

**The plan overstated that second trial twice, and both are worth keeping on record rather than
quietly fixing.** First, an early draft read "27% revised" as evidence that reviewers *liked* the
tool — it is evidence of an effect on behaviour, not of preference, and the blinded quality
comparison behind it was run on a selected subset of revised reviews, not the whole randomised
population. Second, a brief for Mirror's fourth remark kind claimed that a valence placement with
nothing written under it was "precisely the specificity failure the ICLR trial targeted" — the
agent building it pushed back correctly: that trial tested vague *prose*, and had no placement scale
in it at all. Mirror's fix for this is structural rather than a one-off correction: every remark
kind carries a `trialTested` flag, and `coverage` and `placement` both read `false` — not because
either is unlikely to be right, but because `trialTested` records *whether a trial has tested
feedback of this shape*, which is a different question from how confident anyone is in it.

## Website copy notes, kept for later

The website leads with the general deep reader, not the referee — Greg, 2026-09-02, answering
which person the homepage speaks to first:

> make sure we have stored the notes for Peer Reviewer/Referee in our .md docs for when we add extra
> website copy for them in future.

This section is those notes. They are the raw material for a referee page when there is one, drawn
from the 2025 marketing thinking in the original app and from the research behind this mode. The
whole synthesis is [260902k-spideryarn-reading-intent-brief.md](../research/260902k-spideryarn-reading-intent-brief.md).

**Why reviewers were the 2025 way in.** Greg, in an email quoted in the original app's vision doc:

> I'm thinking of focusing on scientific peer reviewers & journal editors, where: the human has to
> make a decision; based on evidence/criteria; it's a drudge job, where they don't want to do a
> terrible job, but they also very much want to be efficient; I can think of lots of ways to speed
> things up. It's not 100% aligned with the vision of helping experts to read & understand new
> difficult material deeply, but a stepping stone in roughly the right direction with a fighting
> chance of being enough of a pain that people might pay…

And the same day he chose it, on why the pain is a sellable one (2025-07-14): reviewing *"doesn't
feel like a creative act in quite the same way. So maybe they'll be less threatened by AI helping
them with it … it feels more like a pain that they're going to want a painkiller for."* The
marketing-persona AI's proposal, which Greg called plausible and worth an experiment: market to
reviewers on efficiency, deliver the deep-reading experience underneath.

**The feeling to preserve.** Greg, 2025-07-14, on what a couple of real reviewers told him:

> My sense is that they want to feel like they have control, and this would preserve that feeling of
> control and awareness, and that they're still in the driving seat. And yes, being able to see
> specifics of the actual text verbatim, in context, and perhaps notice other related areas, and be
> able to scan the actual text in a rapid assisted way (highlighting relevant passages, using
> different colours for different criteria, say), feels potentially very helpful.

Which is Criteria, described a year before it was built.

**The 2025 messaging, for the record.** The original app's brand guidelines proposed a hierarchy for
reviewers — lead with pain relief (*"Stop hunting through papers for methodology issues"*), build on
efficiency (*"Review papers faster without missing critical details"*), reinforce control (*"Stay in
the driver's seat with AI assistance"*) — and two sample lines: *"See exactly where authors support
their claims"* and *"Your expertise drives the analysis — our AI just helps you get there faster."*
One of those proposals, *"Review papers 3x faster"*, is a number nobody measured and the kind of
claim the site does not make; time saved is acceptable but never emphasised
([positioning.md](positioning.md)).

**What the research changed.** Three findings from
[260831e-helping-peer-reviewers/](../research/260831e-helping-peer-reviewers/README.md) that any
referee copy has to be written around:

- **Confidentiality is the bright line.** Nearly every publisher and funder treats uploading an
  unpublished manuscript to a third-party AI service as a violation, whatever the AI does with it.
  The honest v1 audience is preprints, open-review venues, public review, drafts shared with consent,
  and journal clubs. The copy should say this plainly rather than leave it out — and the app already
  does, in three tenses (§ *Confidentiality* above).
- **Reviewers want help saying what they think, not being told what to think.** The one deployment
  with trial evidence of doing good critiques the reviewer's *own draft* — which is Mirror. Copy that
  promises "AI reviews the paper for you" is both off-principle and, on the evidence, unwanted.
- **Showing an AI's judgment first biases the human toward it, mistakes included.** So the pitch is
  structure, retrieval and a mirror, never a verdict. The mode's own rule — the AI on structure and
  on the referee's output, the human on judgment — is the pitch.

**The line between this and the general page.** A referee is a deep reader with a deadline and a
form to fill in. Everything on the general page is true for them; what the referee page adds is the
four sub-modes, the confidentiality sentence, and the promise that nothing here forms the judgment
for you.

## See also

- [260831an-referee-mode-for-peer-reviewers.md](../plans/260831an-referee-mode-for-peer-reviewers.md)
  — the plan in full, including the stages, what was cut and why, and the appendix of ideas
  considered and not picked (Number Hound, Rank Before Reveal, Sealed Second Opinion, a draft
  referee report).
- [260831an-referee-mode-review-sol.md](../plans/260831an-referee-mode-review-sol.md) — the
  cross-family review that reshaped the first draft.
- [260831e-helping-peer-reviewers/](../research/260831e-helping-peer-reviewers/README.md) — the
  research behind both: what journals and funders will let AI touch, the prior art and its cognitive
  offloading evidence, and the editor's side of the desk.
- [`src/web/referee-views.ts`](../../src/web/referee-views.ts) — the four sub-modes, named once.
- [`src/referee-criteria.ts`](../../src/referee-criteria.ts), [`src/referee-mirror.ts`](../../src/referee-mirror.ts),
  [`src/referee-claims.ts`](../../src/referee-claims.ts),
  [`src/referee-candidates.ts`](../../src/referee-candidates.ts) — the four model-facing modules.
- [`src/injection-scan.ts`](../../src/injection-scan.ts) — the deterministic scan, and
  [`src/injection-scan-types.ts`](../../src/injection-scan-types.ts), the one declaration of its
  answer that both the server and the browser import.
  [`src/source-scan.ts`](../../src/source-scan.ts) calls it and caches it;
  [`src/web/SourceScanNotice.tsx`](../../src/web/SourceScanNotice.tsx) is what a referee reads.
- [`src/messages.ts`](../../src/messages.ts) § *referee* — the confidentiality copy, in full, with
  the reasoning for the tense written beside it.
- [search.md](search.md) — the machinery Criteria is built on.
- [remember-mode.md](remember-mode.md) — the other reader-authored mode, and the reason this one is
  not named after it.
- [colour-scales.md](colour-scales.md) — the diverging scales Criteria's valence uses.
- [block-ids.md](block-ids.md) — the anchoring contract every row in every sub-mode is required to
  keep.

---

Up: [reading-view-overview.md](reading-view-overview.md)
