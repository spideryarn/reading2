# An eval for Debate mode, and fixing what it finds

Greg, 2026-09-06:

> It sounds like this needs a good eval (with a few representative examples), if we don't have one
> already (although it might be a bit tricky, since the web is always changing, but perhaps we can
> pick at least some older articles where things won't change so fast, or something else to make
> this workable). Get input from Fable.
>
> Then proceed autonomously using engineering-manager.md to get this working well.

**Status:** planning complete, two GPT Sol rounds absorbed
([round one](260906b-plan-review-sol.md) F34–F46, [round two](260906b-plan-review-sol-2.md) F47–F57).
Both refused; all twenty-four findings accepted, none overruled. The mode itself is
[260905f](260905f-debate-mode-what-the-web-says-about-this-piece.md); its measurements are
[the spike results](260905f-debate-mode-stage-0-spike-results.md).

## The one thing to understand before anything else

**Every debate call is two things wearing one coat: a *search* and a *reading*.** The search decides
which pages come back — it is where all the nondeterminism lives, all the cost variance (2.4× run to
run), and all of the moving web. The reading decides which rows are written and what `relation`,
`valence` and `applies` say about them.

Almost everything worth tuning is in the reading. Almost all the reasons an eval is hard are in the
search. So the eval splits along that seam rather than along "articles" or "arms".

> Nearly everything you want to tune is in the reading; nearly all the nondeterminism is in the
> search.
>
> — Fable, 2026-09-06

**And the thing that seam cannot buy you:** freezing the evidence freezes *engagement* too, so a
frozen comparison can rank readings and can never rank discovery. Sol's F48. Both halves are in the
plan for that reason, and neither is allowed to answer the other's question.

## What the live runs left us with

1. **The valence bug.** Three of seven Cargo Cult rows label `valence` from the source's own subject
   rather than the row's target. On screen that is a red **Critical** chip over a source that
   supports the article.
2. **Group one is empty for a reason nobody hardened against.** Both direct rows died at
   `unverifiedSource` — the model's quotations were not in the *search extract*, a 236–4,945
   character slice the engine chose. `directnessUnverified` was zero, so the article-naming rule two
   review rounds were spent on never fired.
3. **The $0.6252 bought no replayable evidence.** Only *kept* rows are stored.

### The overlap between `relation` and `valence`, and what it is not

**Round one of this plan claimed `disputes`+`positive` and `corroborates`+`negative` are
contradictions, and built a metric, a production coercion and a stopping rule on that. Sol's F35
refused it, and is right.** Recorded as a reversal rather than quietly removed.

`relation` names the argumentative move; `valence` is drawn as **Supportive** / **Critical**
([`VALENCE_APPEARANCE`](../../src/web/DebatePanel.tsx)) and summarises overall stance toward the
row's target. Those genuinely diverge, one honest example per group:

- **group two** — *"The stated 10% is wrong; it is at least 30%, which makes the warning stronger."*
  Truthfully `disputes` + `positive`.
- **group one** — *"The reported figures are right, but the conclusion drawn from them is
  indefensible."* Truthfully `corroborates` + `negative`.

So the pairing is **an inspection mark, and not even a router** (F55 tightened this further: every
packet is judged anyway, so it routes nothing). It is printed as `N / all packets` beside the full
`relation` × `valence` contingency table including `unclear` and `unknown`, and **nothing is ordered,
coloured or selected by it** — because an arm that answered `unclear` everywhere would produce no
opposite pairs at all, and must not thereby look better.

**Sol's F9 is untouched.** F9 refused *deriving* valence from relation, and its example was
`follow-up`, which F19 has since cut. Nothing here derives anything.

### And what the judge can measure, which is less than the bug

**Sol's F47, and it is the decisive finding of round two.** An arm emits a categorical `valence` and
nothing else — no subject, no reasoning. So a blinded judge labelling stance toward the *correct*
target can only measure **disagreement**:

- an arm can evaluate the wrong subject and coincidentally return the right label — counted correct;
- an arm can evaluate the right subject and misread it — counted as a mis-target.

The metric is therefore **valence disagreement with the blinded judge**, never "wrong-target rate".
The judge's guess at *the subject it appears to describe instead* is qualitative diagnosis, printed
and never put in a rate. Sol also closed the obvious escape: an explicit "which target did you
evaluate?" field would prove only that the model copied the target back, not that it reasoned about
it.

### A second prompt defect, found while checking the first

[`src/debate.ts`](../../src/debate.ts) § `READING` scopes the two fields to different subjects —
`relation` to the outside **page**, `valence` to the **quoted passage** — so they do not even share a
subject. Both should be about the quoted passage, which is the only thing the reader is shown and the
only thing the row's evidence supports.

**It is a contract change, not a prompt tweak** (F54). `DebateRelation`'s docblock in
[`src/types.ts`](../../src/types.ts) says *"What the outside page does to what it is answering"*, and
the parent plan's § 4 says the same. So the instruction is exactly:

    relation  what the QUOTED PASSAGE does to this row's target:

and **if that arm lands, the same commit changes** the `DebateRelation` docblock, the parent plan's
§ 4 wording, and the panel's explanatory prose. Group-one eligibility and `articleReferenceQuote`
stay page-level; only `relation` and `valence` become passage-level; `applies` and `limits` keep
their outside-piece meaning.

### A bug in shipped code, found by building the corpus

`namesArticle` compares titles with `collapse(...).toLowerCase().includes(...)` — whitespace and case
only. [`src/quote-match.ts`](../../src/quote-match.ts) § `FOLD`, which every other comparison in this
mode goes through, additionally folds curly quotes, the three dashes and the non-breaking space,
deliberately length-preserving.

The stored title of one corpus article is `Claude’s Constitution`, with a curly apostrophe. So:

- a source page writing the straight form does **not** match, and an honest row is lost as
  `directnessUnverified` — naming exactly the failure the rule exists to prevent;
- a source page writing the curly form matches, and passes on title length alone.

Which way any page falls is decided by whose CMS smart-quoted what. This is general to any title
carrying curly punctuation. **The fix is to ask the matcher everything else asks** —
`findQuote(witness, title, undefined, "spaced") !== null`, `findQuote` rather than `locate` because
`locate` additionally applies `isSubstantiveQuote` and a short title is precisely the case the byline
branch exists for. Red test first; Stage B.

## Two things to do before the eval, both nearly free

> The eval is the right second move, not the first.
>
> — Fable, 2026-09-06

### The two-curl experiment, on the path Stage F would ship

**Fetch the pages group one lost and look for the model's quotations in the full text.** If they are
there, the extract is the constraint; if not, the model paraphrased and the repair is in the prompt.

**It only decides anything if it exercises the exact path Stage F will ship** (F53), and
`fetchDocument` does not hand back page prose: `FetchedDocument.text` is decoded **HTML markup**, and
`null` for a PDF. Matching raw markup would miss a quotation split across tags and accept words out
of a `<script>` or a meta tag. So the experiment — and Stage F — run
`fetchDocument` → **bounded HTML-to-visible-text extraction** → `findQuote`, and a PDF is either
taken through an existing bounded PDF-text path or recorded `unsupported`. **`text: null` is never
read as an empty page.**

The result is reported as *"recovered X of Y observed failures"*. **One recovery establishes the
fallback can fix the observed class; zero recoveries defers Stage F and does not establish that
full-page fetching can never help.**

### Capture, as a two-event journal

Every attempted pass writes to an append-only journal keyed by an attempt id. **Round one put a
single record after the provider answered, and Sol refused it twice** — F40 because `runPass` throws
before returning on an unreadable answer, a bad `finish_reason` or a zero search count, so the paid
failure that motivated capture would have been captured as nothing; F52 because one immutable record
written *after* the answer cannot represent an abort before any answer, cannot survive process death,
and cannot also carry a classification decided later.

| event | when | carries |
|---|---|---|
| `attempt-started` | **before dispatch** | pass kind, provider and search configuration, sha256 of the exact system and user prompts, article identity and `inputFingerprint` |
| `provider-response` | at the gateway boundary, **after bytes arrive, before status, JSON or debate validation** | raw assistant text, **raw annotations** (before `collectSearchEvidence` and the self-source filter), raw usage, finish reason, model |
| terminal outcome | in `catch`/`finally` | `ok` / `aborted` / classified error |

An abort with no response has metadata and an abort outcome and **no invented response fields**. **An
unmatched start means the process died or the outcome is unknown** — which is exactly what happened
on 2026-09-05, when an OOM kill between the two passes billed pass A and wrote nothing. Reports
reconcile starts, responses, terminal outcomes and spend records, and never describe an unmatched
attempt as captured successfully.

`admissible` is derived at replay, never stored as raw input. **Nothing changes about what is stored
on the article** — a reader's artefact is not a debugging record.

## What the eval measures, and what it refuses to

| quality | scored how | why |
|---|---|---|
| **Attribution** — quotes real, located | loss-reason counts, free | already enforced in code and unit-tested |
| **Interpretation — valence agreement** | blinded judge labels stance toward the packet's explicit target; deterministic code compares with each arm's raw `valence` | the closest observable proxy for the bug. **Not a targeting rate** — F47 |
| **Engagement** — does the source passage answer the claim? | judged **once, as a corpus audit** in Layer 2; **per arm only on the live path** | frozen packets share one target, quotation and haystack, and the judge sees no arm output, so its engagement answer is identical for every arm. Printing it per arm would duplicate a corpus property under several names — F48 |
| **Discovery** — did the search find the famous replies? | live, against a hand-verified gold URL list | only measurable live |
| **Usefulness of `applies`** | **not scored** | Greg reading two rendered panels — [quotes.md](../project/quotes.md)'s objection |

**No metric is stratified by relation.** Round one excluded `qualifies` and `extends` as ambiguous
while the same table claimed the judge would catch a mis-target *inside* `qualifies` (F37). Every
packet is judged; denominators are printed per relation.

### Coverage, before any quality figure

Sol's F50, and it closes a hole the round-one wording opened. Before anything is computed, **each
arm's output and the judge's output must be an exact permutation of the expected packet ids** — every
id exactly once, nothing missing, duplicated, foreign or malformed. An invalid arm cannot qualify; an
invalid judge run reports no judged metric. `unknown` and `unclear` are **valid answers and stay in
the denominator**.

**Every arm's denominator is the full set of distinct non-anchor packet ids.** Repeats and other arms
are reported separately and never pooled — seven ids across three arms is seven evidence cases, not
twenty-one.

## The moving web, and why it stops being a problem

### Layer 1 — replay the validation, no model at all

Journal records → `collectSearchEvidence` → `parsePass` → `readDirectGroup` / `readClaimGroup`.
Deterministic, free, millisecond. The regression test for every change to the validation layer.

### Layer 2 — one reading per frozen packet, no search, no choosing

**Sol's F36 rebuilt this**, because arms picking their own rows rewards the arm that answers less.
Each packet fixes its id, pass, article identity, URL, source title, exact `sourceQuote`, target
(article identity, or `blockId` + `claimQuote`), exact evidence haystack, and hashes of every input.
**Every arm returns exactly one reading for every packet.** Arms select nothing.

The caveat, carried into every results file: this is not production's path — production searches
inside the generation. Layer 2 ranks readings; it cannot rank discovery, and per F49 it lands
nothing on its own.

### Layer 3 — the live sweep

The production path, on the corpus. `returnedSources`, kept rows per group, losses by reason,
gold-URL hits, `webSearches`, cost, elapsed — **and, from Stage E, judged group-two rows**, because
engagement is only an arm's property here.

### Layer 0 — deterministic packets, and only deterministic ones

Hand-built `(rows, GroupInput)` pairs handed to the group readers. No model, no network, so they live
in `tests/`. **F45 removed one:** *"a same-topic page that answers no claim"* is not deterministically
refusable — that is the engagement question. It moved to the judged corpus.

| # | shape | must come out as |
|---|---|---|
| **P3** | `articleReferenceQuote` locatable but naming no article | `directnessUnverified` |
| **P4** | `sourceQuote` in the full page, absent from the extract | `unverifiedSource` today; **kept** once Stage F exists |
| **P5** | two genuine quotations from an *unrelated* returned page | `directnessUnverified` — Sol's F24, which passed the code for a day |
| **P6** | the article citing itself, everything else valid | `selfSource`, **not** `uncited` |
| **P7** | out-of-vocabulary `relation` and `valence` | `unclear` / `unknown`, **row kept** |
| **P8** | title spelled with the opposite apostrophe | **kept** — the typography bug above |

**P4 earns its keep twice**: today it pins the loss; after Stage F it is the only thing that could
tell a working fetch from one that silently hands back the extract again.

**P7 is the one the prompt work could break.** If an arm's answer vocabulary changes and the mapping
is not extended, `RELATIONS.has` / `VALENCES.has` fall through and **every row silently becomes
`unclear`/`unknown`** — every panel goes grey with nothing red. Exactly the
[silent-success](../reusable/silent-success.md) shape.

## The corpus

**Four of the five roles I first assigned were wrong**, and the corrections came from hand-verified
web research rather than from assumption. Verified means: fetched the page and read the sentence in
which it names the article.

| slug | words | role | why |
|---|---|---|---|
| Carr, *Is Google Making Us Stupid?* (2008) — **needs an ingest** | ~4,000 | **the recall test** | the only one with a decades-stable ecosystem of named argumentative replies. Three verified (Batson 2009, the 40-contributor Edge.org roundtable, Gizmodo 2010); Shirky, Cascio and Sanger attested but their hosts are dead or blocked |
| `writes` — PG, *Writes and Write-Nots* | 561 | **recall test 2, and the cheapest run in the corpus** | three verified direct rebuttals (Shipper, Sullivan, Isham), each naming the essay in its first paragraph. A small high-quality target set |
| `cargocult-spya-rz663q` — Feynman | 3,822 | **a precision test, not a recall test** | the web is saturated with pages that quote and admire it; genuine argument with it is rare and academic. **Volume of citation is not volume of response**, and the debrief's "fifty years of citation and it kept nothing" was unfair to it on exactly that confusion |
| `claudes-constitution-spya-cr8bzk` | 3,295 | **the decoy test** | see below |
| `revistes-ub-30977` | 3,106 | **the honesty case** | searched properly; nothing found, cleanly |

**The decoy, and it is the most valuable entry.** Established from the article's own first block:
this is the *superseded* post, which says *"Update, Jan 21, 2026: We've published a new version of
Claude's constitution."* Essentially all the commentary on the web — Lawfare, the New Yorker, Zvi,
Oxford — answers the **January 2026 document at a different URL**, which is longer and substantively
different. And `namesArticle`'s URL branch is an **accelerator, not a gate**: absent a URL match it
falls through to the title, and *"Claude's Constitution"* is 21 characters against
`MIN_TITLE_EVIDENCE_CHARS = 20`. So a 2026 commentary is kept as a response to a document it has never
discussed, with every counter clean.

**Measured 2026-09-06, and it is not a hypothesis any more.** All **six** direct rows the model
reported answer the 2026 document. Two are established from their own quoted words — Zvi's names
*"the official version of what we previously were calling its 'soul document'"*, and Matt Glassman's
says *"It's completely different in approach to the previous Claude constitution."* **A row that
explicitly distinguishes the two documents was reported as a response to the older one.** The rules
cut six to one, so one false positive reached the kept set — and it survived by the accident of where
a search engine cut its extract, not because any rule noticed.

Whether that is *fixable* is a real question — an article and its successor sharing a title is
genuinely ambiguous, and demanding a URL match would empty group one much further. This plan's job
was to stop it being unknown, and that is done. **What has changed is its priority**: it now gates
Stage F, because fetching the full page would take this article's group one from one wrong row to
six. Raising recall on a rule whose precision is broken makes the product worse, and the two findings
have to be answered together.

**Pinned by production's own fingerprint** (F41): each entry pins
`inputFingerprint(blocks, tree, meta)` — blocks, tree and the cited head — because pass A searches for
the article's URL and every citation is compared against it, so metadata could drift while a
two-file-hash gate stayed green. The loader recomputes and refuses drift; every journal record carries
the same `sourceHash`.

**Two slugs are poison**: `scaling-hypothesis` and every `evalcost-*` carry
`https://cost-eval.invalid/…`, so pass A would search for a domain that does not exist.

**One gap, worth filling rather than skipping:** an article whose author published a later correction
on a separate page — the row type the parent plan calls the most valuable the mode can produce.

## The arms, and the rule for choosing between them, declared before generation

| arm | what it is |
|---|---|
| `incumbent` | production's prompts, unchanged |
| `incumbent-repeat` | the variance control. **Never a candidate for landing** |
| `targeted` | valence's target named per group, plus passage-scoped `relation` |

Group one — *"Overall, is the quoted passage supportive of this article, critical of it, neither, or
impossible to classify?"* Group two — the same with *"of the quoted claim"*. Group-specific because
group one has no quoted claim to point at. Mapped to `positive`/`negative`/`neutral`/`unknown`, with
P7 covering the mapping.

**The selection rule, per F56, recorded now and not revised after seeing the tables:** `targeted`
replaces `incumbent` **only if `targeted` passes every gate and `incumbent` fails at least one**. If
both pass, keep the incumbent. If `targeted` fails, production is unchanged.

**Fable's version is recorded and not taken.** It proposed reframing the field as agreement — *agrees
/ disagrees / mixed / cannot tell*. Refused because the chips a reader sees say **Supportive** and
**Critical**: putting agreement behind them changes a field's meaning without changing its name or
its UI. If agreement is what we want, field and chips are renamed together, which is Greg's call.

## The anchors are a precondition, not evidence

**Sol's F51, and it is the finding that would have quietly invalidated the result.** The seven Cargo
Cult rows motivated the targeted wording — so counting them as evidence that the wording generalises
is training on the test set.

- Anchors live in a **separate pinned manifest** with exact ids, input hashes and expected judgments.
  The loader asserts its exact cardinality and every expected anchor must come back exactly once.
- **Anchors are excluded from every arm metric, denominator and winner decision.**
- The ≥20 stopping denominator is **non-anchor packets that were used neither to devise the targeted
  arm nor to label the anchors** — so no Cargo Cult packet counts toward it, and the manifest is
  built from the other four articles' captures. If it comes up short, the honest answer is
  `not measured` and a sixth article, never a relaxed denominator.
- The gate itself stays strict — **every anchor classified correctly** (F39: six of seven permits a
  miss on one of only three known wrong-target cases, a 33% false-negative rate on the defect the
  judge exists to find). The report prints the anchor confusion matrix, not a fraction. It is a
  sanity gate and not evidence about the judge's population error.

## The write failure — settled, 2026-09-06, and it was neither of my guesses

Job `spya-ttcxz7` generated `1 about this piece, 5 about what it claims` and errored on the write,
losing $0.1948. I guessed twice and was wrong twice, so both are recorded.

**Guess one, at the debrief: another worktree's dev server claimed it.** Wrong — the step's `detail`
string exists only in this branch's `src/pipeline.ts`, so the claiming process had recent code.

**Guess two, in round one of this plan: a lease-lapse requeue leaves a job unable to write.** Also
wrong, and refuted rather than merely doubted. `settleExpired` in
[`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts) deliberately omits `draft_revision_id` from its
requeue `UPDATE`, so the lapse keeps the draft, exactly as `pauseForDeadline` does — true since
2026-09-04, before the incident. A reproduction that assembled the exact state an OOM kill leaves —
claim, open draft, `beginStep`, stop, `settleExpired`, then a genuine second `advanceJob` — came back
with an identical draft revision id and a step that ran, published and finished `done`.

**What actually happened.** The job's row carries the *generic* fallback message (`[jb-step-again]`,
empty `failure_kind`), which is the signature of an unclassified exception from `runStep`'s catch-all
— not `StaleAttemptError` (which answers `busy` and writes no `job.error`) and not `DraftGoneError`
(which has its own sentence). `debate` was the job's only step, so finishing it publishes inside
`commit`, and that is where `PublishRefused` throws with an undeclared `FailureKind` and lands in the
same fallback. It is the bug already written up in
[260905f](../postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md),
whose query independently names **this job's own slug** as one of two local articles with the tree
shape the tightened rule refuses. Verified: the fix commits `724a27c6` and `6e9b9f3e` landed at
22:41 and 22:48 UTC on 2026-09-05 — **about fifty minutes after this job failed at 21:52:59 UTC**.

So two unrelated things happened that evening: an OOM kill cost one paid attempt, and the requeue
machinery then worked correctly; and the successful second attempt was refused at publish by a rule
that had landed hours earlier and been broken for hours more. **No new postmortem — this corroborates
that one.** Nothing here is specific to `debate`, to the lease, or to the draft.

**Worth carrying out of it:** an artefact-producing step whose publish is refused loses the whole
purchase and reports a sentence that says nothing about why. That is a general property of the queue
and not this plan's to fix, but it is the reason a $0.19 loss took three guesses to explain, and the
capture journal above is what would have made it one.

## Stages

Each ends with the suite green and the tree safe to commit. **Nothing lands in production before
Stage E.**

### Stage A — the journal, the runner, and the two-curl verdict — **done, 2026-09-06**

Landed as `0963f85d`. Three articles journalled for **$0.6384** over six calls, all
`scope_kind: 'eval'`; the verdict is `recovered 6 of 6` and is written up in
[the spike results](260905f-debate-mode-stage-0-spike-results.md) §§ 6–7. Both instruments were
watched failing under a deliberate mutation before their green was believed — the free seam check
(17 assertions) and the verification probe's dry run (25).

**One gap found in the doing, not yet closed:** an eval run's `ai_calls` rows carry an empty
`article_slug`, because the runner calls `generateDebate` outside a job and nothing attaches the
article. The run's own `run.json` records the generation ids, so nothing is unattributable — but the
ledger alone cannot say which article an eval call was for, and a later cost report over
`scope_kind: 'eval'` would need the run directories beside it.

- The two-event capture journal above.
- `evals/debate/` with a runner calling `generateDebate` directly — **never the queue**, so no
  artefact is clobbered and no product-spend row is written — under `withLedger("eval", …)`.
- **Cost identity per run** (F43): cost from the spend collector's `SpendRecord`s via `totalSpend`,
  contributing call ids and the `unpriced` count recorded, an assertion that a completed run holds
  **exactly its two search calls**. Never dollars from token `Usage`; any unpriced call makes the
  figure `not measured`.
- One fresh pass A on Cargo Cult with the journal on, then the fetch → extract → `findQuote` path
  over each reported URL.
- ~~The write-failure repro.~~ **Done, 2026-09-06** — see § above. Refuted and explained without
  spending anything, on a free step.

**How many observed failures before the verdict counts — declared before spending.** The experiment
answers *"recovered X of Y"*, and a Y of one or two is not a verdict about anything. **The floor is
four observed failures**: quotations the model reported that miss in the provider extract. Cargo
Cult's earlier run produced exactly two, so if one fresh run does not reach four, the answer is to
run another corpus article rather than to call it on what came back. Those journals are wanted for
Stage C regardless, so the extra runs are brought forward rather than added.

Declared here rather than settled afterwards, for the reason the summaries eval gives about
`MAX_ANCHOR_INVERSIONS`: a threshold argued after the numbers arrive is not a threshold.

**Done:** *"recovered X of Y"* over Y ≥ 4, written into the spike-results doc, and journals on disk
Layer 1 can replay. ~$0.15 per article.

### The 80-20, decided 2026-09-08 — most of this eval is not needed to fix the bug

Greg asked for the 80-20. Here it is, with the reasoning, because it cuts three of the five stages.

**What I found by reading the captures rather than the plan.** Every journalled run stores the raw
OpenRouter response verbatim, and that includes `message.annotations` — **eleven and twelve
`url_citation` objects per pass, each with `url`, `title` and the `content` extract the model was
shown**. So the frozen packets Stage C was going to *capture* are already on disk, in
`output/debate-runs/`, bought with the $0.6384 already spent. Layer 2 needs no capture sweep; it
needs a reader for what is there.

**And the bug is stochastic, which the plan did not say.** The three Feynman rows in
[the spike](260905f-debate-mode-stage-0-spike-results.md) § 4 point valence at the source's own
subject. In the journalled run of the same article a day later, the equivalent
`skepticalinquirer.org` row came back `corroborates` / **positive** — correct. One run cannot show
this fixed, and no single re-run can show it broken. **Any honest evidence here is a rate over
repetitions, not a before-and-after pair.** That is the finding that reshapes the stages.

**What the prompt actually does, read this morning.** The defect is sharper than F54 recorded:

- **Group two defines valence's target in a sentence** — *"Here `valence` is the quoted passage's
  stance toward THE CLAIM you quoted — not toward the article as a whole, and not its tone."*
- **Group one defines it nowhere.** `READING` says *"which way the QUOTED PASSAGE leans toward this
  row's target"* and the word *target* is never bound for this group. The only hint is a comment in
  the answer format, `"applies": "what it says about this article"`.
- **Neither group's negation list covers the observed failure.** Group two rules out *the article as
  a whole* and *its tone*. All three recorded errors are stance toward **whatever the source is
  itself discussing** — psi, Geller — and no sentence in either prompt rules that out.
- And F54 stands: `relation` is scoped to the outside **page** and `valence` to the **quoted
  passage**, so the two fields do not share a subject.

**So the fix is a spec repair, not a matter of taste** — a missing binding and a missing negation.
That matters, because the machinery this plan spends most of its stages on exists to *choose between
candidate wordings* with rigour, and there is nothing here to choose between.

**The cut.** Four things, in place of Stages B–E:

| | what | cost |
|---|---|---|
| **B′** | The free instrument: the scorer over captured journals, Layer 1 replay, Layer 0's packets as tests, the corpus manifest | **nothing** |
| **C′** | Layer 2 from the annotations already on disk — one reading per frozen packet, no search, **repeated N times** so the output is a rate | small; no search billing |
| **D′** | Hand-labelled ground truth for the corpus's rows, committed as a fixture | **nothing but my time** |
| **E′** | The prompt repair, and the same packets re-read to move the rate | one more C′ sweep |

**What this drops, and the condition for bringing it back.** The arms machinery, the blinded judge
with its anchor gate, and the live confirmation sweep. The judge exists to scale labelling past what
a person will do by hand; the corpus is **26 reported rows over three articles**, which is well
inside hand-labelling, and a hand label is better evidence than a judged one at this size. **If D′
turns out too small to separate the arms — if the rate moves by less than the noise across
repetitions — the judge comes back and the arms with it**, and that is a measurement this cut
produces rather than a risk it takes.

**The simpler thing passed over, and why not.** Just fix the prompt and look at the panel. Refused:
the bug appears on roughly half of rows on one run and none of the next, so looking proves nothing in
either direction, and this is the exact failure [silent-success.md](../reusable/silent-success.md)
names — a check that shares an assumption with the thing it checks.

**Correction owed to Greg.** I told him Layer 3 was the only part that costs money. Layer 2 costs
money too — a model call per packet per repetition, without search billing. Layer 3 remains the one
that cannot be replayed, and the one to ask about.

### The bug's own rows were on disk all along — measured 2026-09-08, and it changes the cut

**The plan's premise was wrong in a way that made the job look far more expensive than it is.** § What
the live runs left us with says *"The $0.6252 bought no replayable evidence. Only kept rows are
stored."* That is true of the **validation** question, where the interesting rows are the dropped
ones. It is false of the **valence** question, because valence is a property of a **kept** row — and
every kept row was written to `spideryarn.article_revisions.debate` and is still there.

Six artefacts are in the local database. Revision `f92fc516` (2026-09-05 22:xx) is the spike run
itself, and it holds all three bad rows, verbatim:

| relation / valence | source | what it actually does |
|---|---|---|
| `disputes` / **positive** | `psi-encyclopedia.spr.ac.uk` | disputes Feynman; positive about psi |
| `corroborates` / **negative** | `skepticalinquirer.org` | backs Feynman; negative about Geller |
| `disputes` / **positive** | `psi-encyclopedia.spr.ac.uk` | disputes Feynman; positive about parapsychology |

So the positive cases are **free, recoverable and already paid for**. Nothing needs to be re-run to
obtain them.

**The measured base rate, over everything replayable.** 33 *reported* rows: 7 in the spike revision, 26 across
the three journalled runs. **Three are wrong, all three in the spike run, and the journalled runs
contain none** — hand-labelled row by row against § 4's definition, with two rows on the
constitution article marked questionable rather than wrong (`windowsontheory` reads as praise and
was called `neutral`; `nextgov` confirms the claim and was called `neutral`). The prompt did not
change between the two: the history of `src/debate.ts` shows nothing touching `relation`, `valence`
or either target sentence between 2026-09-05 17:36 and the journalled runs.

**≈9% of reported rows, and 43% on one run of one article. Both numbers are real and the plan was
sized for the second one.**

**Corrected by Sol's F59, 2026-09-08 — the denominator that matters is smaller.** *Reported* is not
*shown*: production kept only 15 of the journals' 26, and one journalled row has no exact matching
annotation. With the spike's 7 kept rows the user-visible denominator is **22**, so the displayed
error rate is **3/22**, not 3/33. The reported-row figure still measures what the model emits; only
the kept figure measures what a reader sees, and the two must never be printed as one number.

### And the pair F35 demoted is the cheapest detector we have

**All three known bad rows are opposite pairs** — two `disputes`+`positive`, one
`corroborates`+`negative`. Sol's F35 was right that an opposite pair is **not a contradiction**, and
the two honest counter-examples above stand. But *not a contradiction* was then read as *only an
inspection mark*, and the measurement says something stronger and more useful:

> The opposite pair has **high recall** for this bug — every instance we have is one — and low
> precision, which is exactly what F35 established.

A high-recall, low-precision mark is worthless as a coercion and **excellent as a sampling frame**.
That is what makes D′'s hand-labelling tractable: you do not label every row a sweep returns, you
label **every opposite pair plus a matched control sample of same-signed rows**, and the control
sample is what stops the frame from measuring only its own bias. Nothing is coerced, ordered or
coloured by the pair — F35's ruling is untouched — it decides only *what a person looks at*.

**Two sources, two completenesses — corrected 2026-09-08 after both were measured.** The
distinction matters and I had it flat:

- **The three spike rows come from the database only, and have no haystack.** F59 is right about
  them: they are regression fixtures, not frozen packets.
- **The 26 journalled rows come with theirs.** All **66** `url_citation` extracts are present and
  non-empty — counted independently twice, by the instrument and by the reviewer. So those packets
  rebuild **complete, haystack included**, which is what lets a repair be replayed against *the same
  extract production verified against* rather than a fresh search. That is a better position than
  either § "The bug's own rows were on disk all along" or F59 described.

**And a Layer 2 packet rebuilds from the database alone.** A stored row carries `id`, `url`,
`title`, `blockId`, `claimQuote`, `sourceQuote`, `relation`, `valence` and `applies` — every field
§ Layer 2 asks a packet to fix except the evidence haystack, and the haystack is not what a reading
is *about*: `READING` opens *"'relation', 'valence', 'applies' and 'limits' are YOUR READING of the
passage you quoted"*. The passage is the `sourceQuote`, and it is stored. So the three cases that
matter can be rebuilt for nothing — **but as regression fixtures, not as frozen packets** (F59): the
haystack is absent, § Layer 2's contract requires it, and the judge design says the Geller case is
invisible without the full extract. The rate is measured on annotation-backed, validation-kept rows;
these three are the preflight. It still earns its place for the **discovery** question, which is a different stage.

**What this does to the cut.** C′ shrinks. Layer 2 was to be repeated N times per packet to find a
rate; with the positive cases already in hand, the first question is no longer *"can we make the bug
appear?"* but *"does the repair stop the three rows we have from coming out wrong?"* — which is
replay against three known packets, not a rate over a sweep. **Sol's F58 corrected this and is right:** a single all-correct response happens under the
incumbent too — the journalled Skeptical Inquirer row proves it — so the three-row replay is a
**preflight, not evidence**. The repeated incumbent-versus-repair comparison stays, and **the
incumbent must reproduce at least one error** or the run did not exercise the defect.

### E′ — the repair, written out before any output is seen

Declared here, not in a commit, so that F60's *"label before repaired outputs exist"* and F61's
*"declare the design before seeing output"* are both satisfiable and checkable afterwards. **Three
changes, one of them a contract change.**

**1. `relation` and `valence` get the same subject and the same target** — F54, in the exact words
that finding specified, plus the matching move on `valence`. Today `READING` (`src/debate.ts` ~1056)
scopes `relation` to the outside **page** and `valence` to the **quoted passage**:

    relation  what the outside page does to the thing it is answering:
    valence   which way the QUOTED PASSAGE leans toward this row's target:

becomes

    relation  what the QUOTED PASSAGE does to this row's target:
    valence   which way the QUOTED PASSAGE leans toward this row's target:

**If this lands, the same commit changes** `DebateRelation`'s docblock in `src/types.ts` (*"What the
outside page does to what it is answering"*), the parent plan's § 4, and the panel's explanatory
prose. Group-one eligibility and `articleReferenceQuote` stay page-level; `applies` and `limits`
keep their outside-piece meaning. That is F54's scope and it is not being widened.

**2. Group one gets a target binding, because it has none.** Group two says *"Here `valence` is the
quoted passage's stance toward THE CLAIM you quoted — not toward the article as a whole, and not its
tone"* (~1168). Group one says nothing; the word *target* is never bound for it, and the only hint is
a comment inside the answer format, `"applies": "what it says about this article"` (~1125). It gets
the parallel sentence, naming the article as the target.

**3. Both groups get the negation the failures actually need.** Group two rules out *the article as a
whole* and *its tone*. **All three recorded errors are stance toward the source's own subject** —
psi, Geller — and no sentence in either prompt rules that out. One clause, in both groups:

> not toward whatever the outside piece is itself discussing.

**Why this is a spec repair and not an arm.** A missing binding and a missing negation are defects on
their face; there is no second wording competing with them on taste. That is the argument the whole
cut rests on, so it is worth being explicit that **change 3 is the one with the least authority
behind it** — 1 and 2 are F54 and a parallelism the code already has on one side, while 3 is inferred
from three observations. If the measurement separates them at all, 3 is the one to hold out.

**What must be true before this is written into `src/debate.ts`:** the hand labels exist and are
committed (D′), the incumbent has been shown to reproduce at least one error (F58), and the raw
vocabulary check is in place (F62) — because change 1 and change 3 both alter the sentence that
introduces the answer vocabulary, which is precisely the edit that could turn every row `unknown`
while looking like a success.

### Stage B — the free instrument, and one shipped bug

- `evals/debate/score.ts`: loss-reason table, the contingency table and opposite-pair mark,
  kept-per-returned, gold-URL hits. No IO, **unit-tested in `tests/debate-eval-score.test.ts`**.
- Layer 1 replay from raw annotations.
- Layer 0's six packets as tests, each watched red first.
- ~~**The `namesArticle` typography fix**, red test first.~~ **Done, 2026-09-06**, brought forward
  into Stage A's commit because it is a shipped bug and the file was already open. Both branches now
  ask `findQuote(..., "spaced")` through one `appearsIn` helper. Watched red on the real failure
  first. One thing checked rather than assumed while writing it, and the comment says so: this is a
  strictly **wider** match than the `includes` it replaced and nothing narrows — a short title still
  matches inside a longer word in both modes, which is why `MIN_TITLE_EVIDENCE_CHARS` and the byline
  branch exist and why neither moved.
- The corpus manifest, pinned by `inputFingerprint`.

**Done:** free repeatable numbers over Stage A's journal, and one real bug closed. No money.

### Stage C — the capture sweep, and the frozen comparison

- `incumbent` live once over the five corpus articles, journalled. This buys two things at once: the
  **non-anchor packet manifest** (≥20 packets from the four non-Cargo-Cult articles) and the
  incumbent's live baseline.
- Layer 2: every arm answers every packet; coverage checked as an exact permutation before any
  quality figure; every arm scored on **raw** output, with no production repair applied.

**Done:** an arm table, and **nothing landed**. Sol's closing note: the frozen comparison is necessary
evidence, not a disposable stage. ~$1.50.

### Stage D — the judge, and a provisional arm

- GPT Sol through `codexJudge`, blinded, empty sandbox.
- **The judge never sees the arm's `relation`, `valence` or `applies`** (F38): ordering questions
  inside one request is not blinding, because the model reads the whole prompt before answering, and
  the summaries eval records that limitation in as many words.
- Per packet it sees article title and byline, the row's target, the source's title and host, the
  `sourceQuote`, **and the full stored extract** — without which it is guessing at the page's subject
  with exactly the information the model had, and the Geller row is invisible.
- The anchor precondition above. Engagement judged **once**, as a corpus audit.
- **Selects a provisional arm and lands nothing.**

### Stage E — the live confirmation, and only then the landing

**Sol's F49.** Round one landed in Stage D and swept in Stage E, so the promised live confirmation
came *after* the landing — and stopping rule 2 needs a judgment on the obscure article, which a
sweep that does no judging cannot produce.

- The **provisional arm only**, through the live production path, over the five articles, two
  repeats.
- **Every kept live group-two row is judged**, which is the only place an arm's effect on engagement
  is observable.
- The complete stopping rule applied, obscure-article clause included.
- **Only then** does the prompt land and `PROMPT_VERSION` bump — and if it lands, the same commit
  carries F54's contract changes. If live judging is incomplete, a denominator insufficient, or the
  obscure case `not exercised`, **production is unchanged**.
- Re-measure `STEP_BUDGET_MS` (120 s is a guess; a real run took 146.7 s). Write
  `evals/results/debate/` and the section in `evals/README.md`; update the parent plan and the spike
  results. ~$2.

### Stage P — the identification level, the one list, and the bar — **gates Stage F**

The product work Greg commissioned, § "The two product questions" below. It is not an eval stage and
it is not optional scaffolding for one: **Stage F may not land before it**, because fetching raises
recall on a rule whose precision is broken, and the level plus its default threshold is what contains
the precision it costs.

Three parts, in this order, each a commit.

**P1 — the field and the matcher.** `identifies` on `DirectDebateRow`, a non-empty array of
`IdentificationSignal`, plus `identificationLevel(row)` returning the strongest — a lookup over a
fixed order, never a sum. The shingle matcher is model-free and lives in its own module beside
`src/quote-match.ts`: article windows of 8 words and ≥ 40 characters, `findQuote(…, "spaced")` as the
one matcher, **coverage as the floor and density as the ceiling** at the numbers measured above.
Refusing a copy is a new drop reason, `sourceIsCopy`, counted and shown — never a silent filter
([silent-success.md](../reusable/silent-success.md)). Artefacts written before the field read as
`named` with the existing `articleReferenceQuote` as witness, so nothing needs re-running and no
migration is required.

**Done — landed 2026-09-06, `35db7d53`.** `src/shingles.ts`, `IdentificationSignal` /
`identifiesOf` / `identificationLevel` in `src/types.ts`, the wiring and `sourceIsCopy` in
`src/debate.ts`, and `blockText` moved up to `GroupInput` (`ClaimGroupInput`, left with nothing in it,
was collapsed). The measured table above is reproduced exactly on the real journals. Seven mutations
were applied and all seven were caught.

**Three things the stage turned up, none of them in the brief:**

- **`anyLost` claimed an exhaustiveness it did not have.** Its docblock said a new `DebateLosses`
  field would be a compile error at its hand-written sum. It was not — `sourceIsCopy` compiled clean,
  and the new counter would have vanished from the reader's foot line in silence. That is F24's shape
  exactly, a docblock stating a rule with no code under it, in the same file. A `...rest` destructure
  assigned to `Record<string, never>` now makes the claim true, checked by adding an unlisted field
  and watching it fail at that line.
- **The matcher was quadratic for this caller.** `findQuote` reduces its haystack per call: 8.6
  seconds a row on Cargo Cult, on a step a reader waits for. `quoteFinder` (src/quote-match.ts)
  prepares it once and lazily, and `findQuote` is now that function asked one question, so there is
  still one definition. **1.76s for twelve rows.** Verified against the pre-refactor implementation
  over **5,548 comparisons** — three articles, both passes, two `near` values, needles damaged with
  double spaces, curly quotes, em-dashes, uppercasing and stripped whitespace — **zero
  disagreements**, and the differential was itself mutated to prove it can fail.
- **The Layer 1 replay guard was in the wrong place.** A *direct* replay without blocks would have
  come back **clean** — no `quoted` signal, no copy refused — which is a fact about the replay
  reported as a fact about the run, and the quieter of its two failure modes. The guard moved above
  the branch.

**P2 — one list.** The panel loses its two headings, two blurbs and two foot lines. Direct rows
first, then claim rows, search order within each — `DEBATE_NO_RANKING` stands and the list is **not**
sorted by level. Each row self-labels: direct rows carry the identification chip with the tooltip
listing every signal found, claim rows keep `On what it claims` and their *Answering "…"* line. The
empty first section becomes the one sentence from § 1.

**§ 1 listed three forms and the panel needed four** — found while building it. The plan's pair covers
only *direct empty, claims present*: if the **claims** search also comes back empty, *"What follows
takes up what it argues"* is false and the claims-side finding vanishes with it. So the lead says both
facts when both are empty, and promises what follows only when something does. The third form
(everything hidden by the bar) stays P3's, and stays silent because `hiddenNote` already says it.

**Done — landed 2026-09-06.** The `Group` component is gone; one list, direct rows then claim rows,
search order within each, no sort by level. Each row self-labels with a chip — *Links this piece* /
*Quotes this piece* / *Names this piece*, or *On what it claims* — and the direct chip's tooltip lists
every signal from `identifiesOf` with the matched URL, the located quote, and coverage and density as
two separately-named percentages. **The three levels are drawn identically**, ordered but not
coloured along that order: a ramp over one fact is the composite this plan refused.

**The bug the browser found and the tests could not.** Every debate artefact in the local database
predates `sourceIsCopy`, and `isDebateDocument` validates two arrays and nothing else — so the counter
read back `undefined`, `Math.min` made it `NaN`, `NaN` failed every clause guard, and the foot line
printed *"offered 5 of these; 3 are shown — ."* with both counts intact and the whole explanation
gone. **That is the exact failure the counter was added to prevent, arriving through the counter
itself.** Reproduced red first, then fixed.

That fix and `anyLost`'s hole — the same field, unguarded, in `src/types.ts` — were consolidated into
one **`lossesOf`**, which fills every counter off a stored artefact *and* is the exhaustiveness gate:
a new field stops its literal compiling, so both readers pick it up instead of dropping it. Checked by
adding an unlisted field and watching it fail. It also hardens against a stored `null`, string or
negative, because the type says `number` and the row came from a database.

**Two findings from the screenshots, both left for the review to judge:**

- **The density ceiling catches a *near-self* mirror, which `sameTarget` cannot.** Cargo Cult's own
  address is `calteches.library.caltech.edu/51/2/CargoCult.htm`, and the search returned a different
  path on that same host — admissible, 65% density. `selfSource` misses it because the paths differ,
  and the plan cut "same host, different path" as zero information because anthropic.com hosts both
  constitutions. Density answers both cases without a host rule.
- **Two different numbers on one screen are both called "pages".** The panel header shows
  `distinctSources` of the rows shown (*"7 pages"*), and the lead sentence shows the direct pass's
  `returnedSources` (*"found 10 pages"*). Both are true and they are different facts. The header
  predates this stage, but the headings that used to scope the sentence are gone, so the collision is
  new. A wording call, not a counting bug.

**P3 — the bar.** `src/web/threshold.ts` unchanged and reused, on the one fact, over direct rows only;
claim rows carry no level and never sit under it. Three stops labelled with the words. New `?name` in
the URL state. **Default hides `named`-only rows**, and the default is re-measured on the corpus: if
`writes` or Carr loses a verified reply at it, the default moves and that is a product fact worth
recording here.

**Done — landed 2026-09-06.** `src/web/debate-levels.ts` (the three stops, the rank, the default and
the one pass), `nameParam` in params.ts, `NameBar` in the panel, `?name=` in `REMEMBERED`.
`src/web/threshold.ts` was reused **unchanged** and expressed this without a complaint: the rank
accessor is the only new thing, and it never leaves the module that defines it.

**The re-measurement, and it did not move the default.** Layer 1 replay over the three journals, with
`identificationLevel` read off every kept direct row:

| article | direct rows kept | levels | at the default (`quoted`) |
|---|---|---|---|
| `writes` | 1 of 2 reported | `quoted`+`named` — hamtyped's rebuttal, 22.3% coverage | **kept** |
| `cargocult-spya-rz663q` | 0 of 2 reported | — | nothing to hide |
| `claudes-constitution-spya-cr8bzk` | 1 of 6 reported | `named` — Lawfare, on the 2026 document | **hidden** |

So **no genuine reply loses its row at the default**, and the one row it hides is precisely the false
positive § "The corpus" identified. The other direction is refuted by the same table: a default of
`linked` would hide hamtyped's rebuttal, which quotes the essay at length and simply does not link it,
and that is a verified reply. `named` — hide nothing — leaves the decoy. **`quoted` is the only one of
the three the corpus permits.** Carr is not in this measurement because that article still needs an
ingest and has no journal; `writes` and Cargo Cult are the two the brief named as decisive.

**One correction, worth keeping.** The expectation was that *the constitution's six rows are all hidden
at the default*. Six is what the model **reported**; production's rules cut them to **one kept row**,
which § "The corpus" above already says (*"the rules cut six to one, so one false positive reached the
kept set"*). What the bar hides there is one row, not six — the other five never reached the panel.

**Three sentences changed that the stage did not set out to change, each because the bar made an
existing one false:**

- **`keptNote` says *were kept*, not *are shown*.** It is arithmetic about the run, and the reader now
  has a control that decides what is shown: *"4 are shown"* over two rows is the
  count-disagrees-with-the-list failure `threshold.ts` names, arriving through the one sentence on this
  panel whose job is to be trustworthy about numbers.
- **`sourcesNote` is handed the rows the bar left**, because it ends *"contribute to the rows shown"*.
  Leaving it on the whole group would have kept the figure looking right while the words went false.
- **The head count counts the rows on screen**, so it moves with the bar — which is most of the answer
  to the *"two numbers both called pages"* finding below.

**The third empty state stays silent, and that is confirmed rather than assumed.** `leadNote` fires on
the artefact's own row count, so a group emptied by the reader's own threshold says nothing extra and
`hiddenNote` is the only sentence about it — checked in a browser, and in
`tests/debate-panel.test.tsx` § *"says nothing extra when the bar has hidden every response"* with the
genuinely-empty group as its positive control.

**The three counts on one screen — answered rather than deferred.** The panel can now show *pages* in
the head, *responses hidden* at the bar, and *pages returned* in the lead and foot lines. They stay
three facts said in three places with **two** nouns rather than three: the head and the searches both
count pages, correctly, and `sourcesNote` is the bridge between them (*returned evidence from N pages;
M contribute to the rows shown*) now that it moves with the bar. The bar counts **rows**, not pages, so
it uses the word the lead sentence already uses for what a direct row is — a page that *responds* to
this piece — and says *"2 responses are hidden by this threshold"*.

**What the browser showed** (a fixture with four direct rows — one `quoted`, one `linked`, two
`named`-only — and two claim rows): at the default, four rows, *quotes it · 2 of 4*, and *"2 responses
are hidden by this threshold"*; one stop left, six rows, *names it · 4 of 4*, *"Nothing is hidden"*, and
`?name=named` in the address; `?name=linked` opened cold puts the thumb on the third stop with one
direct row and both claim rows; `?name=sideways` opens at the default. Screenshots in the session's
scratchpad, `p3-1-default.png`, `p3-2-dragged-left.png`, `p3-3-name-linked.png`.

**Mutations, all caught.** The bar ignored → 12 tests; the rank order inverted → 16, including the two
that pin the track against the strength order; claim rows let into the bar's count → 4, the ones that
put a `0 of 1` over a list of three rows.

**Then the obligatory Sol review**, on all three commits together.

**Two merges of `dev`, and what each cost.** Both are recorded because the second one is the more
instructive.

- **2026-09-06, `c7f7a348`.** `styles.css` had been split into 37 sheets under `src/web/styles/`
  while Stage P was being built, so P3's 61-line `.dbt-bar` block had to move into
  `styles/debate.css` at its identical position. Neither conflict revealed the actual breakage:
  dev's new `tests/every-mode-draws-its-surface.test.tsx` gave its Debate fixture a `named`-only
  row, and the default bar is `quoted`, so the band drew nothing but chrome. **The fixture was
  wrong, not the default** — hiding a title-only row is the feature. Fixed by giving the fixture a
  `quoted` signal on a *prose* block, prose being the only place quotation evidence may come from.
- **2026-09-07, in progress.** `App.tsx` went from ~6,100 lines to 462
  ([260906c](260906c-separate-article-access-reader-composition-and-mode-controllers.md)): every
  mode's controller moved to `src/web/modes/<feature>/`. The conflict was the whole file; the debt
  was 13 lines, which moved to `src/web/modes/debate/DebateMode.tsx`. Again the conflict was not the
  problem — dev's new `tests/mode-surface-changes-no-markup.test.tsx` built a `DebatePanel` without
  the props P3 made required, and pinned a Debate band shape with no `.dbt-bar` in it. Both were
  updated, the second with the reason recorded beside the shape.

**The class, twice over: a merge conflict marks where two edits touched the same lines, not where
one branch invalidated the other's assumption.** Both real breakages were in files that merged
cleanly, and both were found by `npm run typecheck` and the suite rather than by reading the
conflict. The instrument that caught them is dev's own — two new tests that enumerate every mode's
surface — which is the argument for that kind of test.

### Stage F — full-page verification fallback — **Stage A said yes, and it must not land alone**

**Answered 2026-09-06: `recovered 6 of 6`.** Every quotation the model reported that was missing from
the provider extract, and whose page could be fetched, was found in the full page. The model was not
paraphrasing; the slice was too small. Numbers and the three ways a naïve instrument would have got
this wrong are in
[the spike results](260905f-debate-mode-stage-0-spike-results.md) § 6.

Two things that came with the verdict and change the stage:

- **The haystack is decided: whole-body visible text, not Readability.** 6 of 6 against 2 of 6, with
  four found in whole-body text *only* because Readability discards the sections they live in. The
  precision risk that buys — a quotation matching a *"you may also like"* blurb — is to be
  **measured**, since nothing so far exercised it.
- **PDFs are a recurring case for group one, not an edge one.** On an academic subject the genuine
  responses are papers, and one of Cargo Cult's two lost rows is Gelman's. `text: null` means Stage F
  as specified still loses it. `src/pdf-read.ts` exists; wiring it in is a real question.

**And the constraint that outranks the stage.** § "The decoy" below: on the constitution article
full-page fetching would take group one from **one** false positive to **six**, because it raises
recall on a rule whose precision is already broken there. **Stage F does not land before the decoy is
measured and answered** — a fallback that finds more of the wrong thing is worse than no fallback.

**Verification order matters**: the provider extract first, and only a quotation that misses there
invokes the fallback. **A fetch or extraction failure never removes a row already verified from the
extract** (F53).

Through [`fetchDocument`](../../src/fetch.ts) → bounded HTML-to-visible-text → `findQuote`, never
bare `fetch` and never raw markup as the haystack, keeping its HTTP(S)-only rule, private-address and
DNS-pinning checks on every redirect, redirect cap, byte cap, type sniff and deadline, plus an
explicit whole-run concurrency, byte and elapsed budget. **12 per pass and 24 per run** — round one
said 12 per run, and the caps are per pass (F44). Fetched text is a haystack and enters no prompt.
The journal records final URL, content hash, outcome and the exact bounded haystack, so Layer 1 stays
network-free.

## Stopping rule, declared before the runs

1. **Valence disagreement with the blinded judge ≤ 1/20**, over at least 20 **distinct, non-anchor**
   packet ids. Every rate prints numerator over denominator; an undersized denominator is
   `not measured` and cannot satisfy a gate.
2. **Group-two engagement ≥ 80%** over its printed denominator, on the **live** rows. The obscure
   article requires at least one kept and judged row and zero `no` judgments; if it returns no rows
   the report says **`not exercised`**, never *"zero no"* (F42 — empty output is valid here, so the
   round-one wording could have passed over nothing).
3. Carr and `writes` keep ≥ 1 direct row in both repeats — and if that is unreachable even after
   fetching, **that is a product answer, not a tuning target**.
4. Median run ≤ $0.40, worst ≤ $0.60 — a disclosure figure, not a gate, and `not measured` if any
   contributing call is unpriced.
5. Greg reads two rendered panels and is happy.

*Good enough to ship as experimental* is 1, 2 and 5.

## The two product questions — answered by Greg, decided 2026-09-06

Greg, after seeing the decoy measurement:

> 1 Maybe there's a way to clarify the phrasing to be clearer what it does and why it didn't find
> any? Or combine them somehow? Not sure. Maybe there's a better approach.
>
> 2 I think it's important that the commentary be about the article being read here. However, it's
> not always obvious whether different urls are hosting the exact same version as possible. So
> perhaps report some kind of score for "how sure we are that this is about this particular exact
> version", with a tooltip for each showing the reasons for the score? And then the user can
> threshold by that in the "Prioritised" sub-mode?
>
> — Greg, 2026-09-06

### 2 — a level that *is* one of the facts, not a score over them

**My reading was half wrong and Fable caught the wrong half.** I argued Greg's score escapes both of
this plan's refusals because its inputs are facts we computed rather than model opinions. It escapes
§ 3 — a fact about our own evidence is not a verdict handed to a reader mid-read. It does **not**
escape [quotes.md](../project/quotes.md), and re-reading the sentence I had cited shows why:

> Both raw numbers are on a prioritised row and the composite never is — that is our arithmetic
> dressed as the model's judgment.

The raw scores there are on screen and checkable too. **What was refused is the combination**, because
the weights are ours and a `0.7` means nothing a reader can verify. `link = 0.5, byline = 0.2,
quote = 0.3` fails that identically. *"Every input is checkable"* saves the inputs; it does not save
the arithmetic.

So what survives is narrower and better: **the level is the name of the strongest evidence found.** No
weights, no sum — a lookup, not arithmetic.

```ts
identifies:
  | { kind: "linked"; url: string }
  | { kind: "quoted"; quote: string; blockId: BlockId }
  | { kind: "named"; by: "title" | "title-and-byline"; witness: string }
```

A row may have several; the level is the best, and **the tooltip lists every one found** — which is
the tooltip Greg asked for, and it is the evidence rather than a gloss on it. Artefacts written before
the field read as `named` with the existing `articleReferenceQuote` as witness, so nobody pays for a
re-run.

**And it is not called confidence.** The signals establish *how a page identifies this piece*, not
*which version its author read*; calling it confidence invites the percentage we just refused.

#### The quoting signal, measured before it was chosen

The one signal that separates the decoy per row: **does the page quote words that are actually in this
article?** We hold the article; the extract is in the journal; `findQuote` already exists. No model
judgment — we *find* the span, and the span goes in the tooltip.

Fable's caveat was that 2026 phrases might turn up in the 2023 text, which would make the signal
weaker than hoped. **Checked, at its proposed floor of 8-word windows over 40 characters:**

| corpus | windows | result |
|---|---|---|
| Claude's Constitution (the decoy) | 2,308 | **0 hits on all eight third-party commentaries.** The only hit is anthropic.com's own other page |
| `writes` (Paul Graham) | 349 | **5 of 7 sources quote it** — 1.4%, 2.6%, 4.9%, 22.3%, and two at 100% |

So it does not leak, and it has real positive power on ordinary replies out of extracts as short as
765 characters.

**The two at 100% are the finding that was not in anybody's design.** `archive.ph` and
`www.paulgraham.com` matched *every window* — they are copies of the essay, not responses to it. Raw
hit count would rank a mirror above every genuine reply: maximal identification, minimal reason to
show it. It is `selfSource` wearing a new hat, and `sameTarget` does not catch it because a `www.`
host and an archive are different addresses.

**So the measure carries a ceiling as well as a floor.** What the ceiling *counts* changed once it was
measured on more than one article — see below, because the first answer was wrong.

##### The ceiling counts density, not coverage — corrected 2026-09-06, after measuring

The paragraph above chose the obvious ceiling: **coverage**, the share of the article's windows found
in the extract, refusing a page at ~100%. That is the number `writes` produced, and it is an artefact
of `writes` being short. The essay is 3,146 characters, so a copy of it *fits inside one extract* and
scores 100%. **On a long article a mirror is truncated like everything else**, its coverage collapses,
and the ceiling never fires.

The alternative asks the question the other way round. **Density** is the share of the *extract's own*
windows that are found in the article: a copy is almost entirely article words however little of it we
were handed, a commentary is mostly its own words. Both computed over the same sources:

| source | article | extract | coverage | **density** |
|---|---|---|---|---|
| `archive.ph` | `writes` (349 windows) | 3,209 | 100.0% | **95.3%** |
| `www.paulgraham.com` | `writes` | 3,136 | 100.0% | **79.5%** |
| `www.hamtyped.com` (real reply) | `writes` | 3,760 | 22.3% | **16.4%** |
| `robinsonraju.blog` (real reply) | `writes` | 765 | 4.9% | **17.3%** |
| **`www.anthropic.com`** | constitution (2,308) | 253 | **1.3%** | **100.0%** |
| **`calteches.library.caltech.edu`** | Cargo Cult (2,455) | 252 | **0.5%** | **65.0%** |
| `sites.stat.columbia.edu` (real reply) | Cargo Cult | 5,287 | 4.0% | **13.9%** |

**The last three rows are the whole finding.** Caltech's library hosts the original text of Cargo Cult
Science and `www.anthropic.com` was serving a slice of the constitution — both copies, both invisible
to a coverage ceiling at 0.5% and 1.3%, both obvious to density at 65% and 100%. Under the coverage
rule a row citing either is kept and shown as a page that quotes the piece, which is the failure the
ceiling exists to prevent, and only the density form of it fires.

**What the ceiling does not do — corrected before it was built.** I first wrote here that the
`anthropic.com` copy was *the one decoy row that reached the kept set*, which conflated two different
things: it was an admissible **source**, and the kept row was a different page. Running production's
own `parsePass` over the three journals says so plainly — of the ten rows the model reported across
`writes`, Cargo Cult and the constitution, **not one cites a mirror**, and not one has a `sourceQuote`
that is article text. So:

- **The ceiling's positive case is unmeasured.** No mirror has yet been *reported as a row*;
  `sourceIsCopy` will read `0` on today's whole corpus. It is a precaution, not a fix, and it is worth
  building because a mirror row would carry the strongest chip on the panel — a copy of the article
  presented as the best-identified response to it — but the plan should not claim it repairs anything
  observed. **A counter that has only ever read zero is indistinguishable from a broken one**, so the
  ceiling's proof is the unit tests at the measured densities, not the corpus.
- **What actually fixes the decoy is the floor plus the default threshold.** All six reported rows
  have zero coverage — none of them quotes the 2023 article — so all six are `named`-only, and § "The
  bar" hides `named`-only rows by default. That is Stage P3's job, not the ceiling's.
- **A sharper per-row guard exists and is deliberately not built** — *built after all, 2026-09-06,
  and as a **precondition** rather than a second guard; see the round-3 ledger below.* A mirror has
  no words of its own, so a row citing one must have a `sourceQuote` that is article text; testing
  that is nearly free. Measured: it would refuse **none** of the ten rows we have. Building a second
  guard with no demonstrated positive case is the machinery *"simplest version first"* refuses —
  recorded here so the next reader knows it was considered, and it is what to reach for if a mirror
  ever does surface as a row. **What changed:** Sol reproduced a *false positive* on the drop, which
  is a demonstrated case for the conjunction and a different argument from the one weighed here.

**Threshold 50%**, sitting in an empty band: every copy measured is ≥ 65%, every genuine reply ≤ 17.3%.
The ceiling requires **at least 5 extract windows** before it may fire, because a 250-character extract
carries only a couple of dozen and a ratio over three of them is noise.

**Coverage is still computed and still shown** — it is the floor (any hit at all makes the row
`quoted`) and it is a number for the tooltip. What it is not is the copy test.

#### What is built, and what is cut

| signal | decision |
|---|---|
| links the exact URL (`sameTarget`) | **keep, free** — already computed inside `namesArticle`; surface which branch fired |
| quotes text that is in this article | **build** — shingles, model-free, floor 8 words / 40 chars, **density ceiling for mirrors** at 50% over ≥ 5 extract windows |
| title + byline vs title alone | **tooltip detail, not a level** — free, but Anthropic is the byline of both versions, so it does not discriminate here |
| source date vs article date | **cut.** `SearchEvidence` carries no date; it would need Stage F plus meta parsing, and the decoy's commentary is *later* than both documents, so it never fires |
| the article announcing a successor | **cut as a detector** — no reliable structure, and a heuristic banner is the shape [silent-success](../reusable/silent-success.md) warns about. Six rows all at the bottom level *is* the tell |
| same host, different path | **cut** — anthropic.com hosts both versions; zero information |

#### The bar, and what "Prioritised" turns out to mean

One checkable fact is not a composite, so the `prioritised` refusal does not apply — **but this is not
Prioritised either.** It is the same threshold bar Glossary, Quotes and Search already share
([`src/web/threshold.ts`](../../src/web/threshold.ts)), on one fact, filtering direct rows only; claim
rows carry no level and are never under it. Three stops labelled with the words rather than digits,
per Quotes' *"the stops are the data, not a grid"*. New `?name` in the URL state.

**Default: hide `named`-only rows.** Greg's own reason — *"important that the commentary be about the
article being read here"* — and on the decoy the alternative is six wrong rows with a small chip on
each, which a first-time reader takes for reception. Hidden rows say so through the existing
`hiddenNote`, unchanged. **The default is re-measured on the corpus**: if `writes` or Carr lose a
verified reply at it, the default moves, and that is a product fact worth knowing.

**Measured 2026-09-06, and it stays at `quoted`** — no genuine reply loses its row, `linked` would lose
one, and the table is in § Stage P above.

### 1 — combine them, because the empty section was the symptom

**Fable's answer, adopted:** the two-group split exists because two metered passes are what let us say
*"no reply found"* truthfully. That is **our epistemics, not the reader's question**, and on Cargo
Cult it currently produces two headings, two blurbs, an empty-state paragraph and two foot lines
stacked over zero rows, followed by the three rows that are the actual product.

**One list.** Direct rows first, then claim rows, search order within each — `DEBATE_NO_RANKING`
stands, and it is **not** sorted by level, because the chip already says it. Each row self-labels:
direct rows carry the identification chip, claim rows carry `On what it claims` and their existing
*Answering "…"* line. Not grouped by `relation`, either: a section heading is a claim we stand behind,
and relation is fenced as the model's reading. **Structure by what we can verify; keep the model's
readings inside rows.**

The empty first section becomes one sentence at the top:

- nothing returned: *"No page the search found responds to this piece by name. What follows takes up
  what it argues."*
- returned but all lost: *"The search found 4 pages that might respond to this piece, but none could
  be checked against the words it returned. What follows takes up what it argues."*
- all hidden by the bar: nothing extra — `hiddenNote` already says it.

On a famous article that reads as a finding rather than a broken panel, which is the honest empty
state Greg asked for said in the reader's terms instead of ours.

### Where this sits in the order of work

It is **not** an eval stage, and it now gates one. Sequence: the `identifies` field and the shingle
matcher, then the panel's one list, then the bar, and **only then Stage F** — fetching widens the
haystack for `linked` and `quoted` as much as for recall, and the default threshold is what contains
the precision it costs.

**The simpler option passed over**, recorded because it is the obvious one: tighten `namesArticle` to
require link-or-quote and drop title-only rows into `directnessUnverified`. Same default screen,
fewer parts — and worse, because the rows become an invisible counter and Greg asked to *see* them
with their reasons. The level plus a default threshold is that gate with a slider on it.

## ~~The one product question, held for Greg~~ — asked and answered above

Fable's original framing, kept because the decision above went further than it:

> lead the panel with group two, show group one as a short line above it.
>
> — Fable, 2026-09-06

Greg's answer was *"combine them somehow… maybe there's a better approach"*, and the better approach
is § 1 above: **one list**, with the two-pass distinction on each row and in a single sentence rather
than in two sections of chrome. Reordering the sections would have kept the structure that was the
problem.

## Deliberately not in this job

- **Pairwise arm-vs-arm comparison on live runs** — n=2 at 2.4× variance supports a large-effect
  call and nothing finer.
- **Scoring `applies`.**
- **Coercing an inconsistent valence** — proposed in round one, removed by F35: the premise was that
  the pair was impossible, and it is not.
- **Renaming `valence` to `agreement`** — a product change, and Greg's.
- **Deciding what to do about the decoy** — measured here, decided elsewhere.
- **An admin page that runs evals** — none exists for any of the eleven evals in the tree.
- **Stage 4 of the parent plan** — the shared link, still unbuilt, and worth building for a mode that
  produces something worth sharing, which is the proposition this job settles.

## The simpler option passed over

**Just fix the valence prompt and re-run twice.** Genuinely less work, and it would probably improve
the bug. Refused because the same two runs would tell us nothing about *engagement* — whether a
source passage really answers the claim it is filed under — which is the one relationship no code in
this mode can check, and the one a reader's trust rests on. A mode that files a plausible stranger
under a claim it does not address fails quietly, forever, and no amount of re-running spots it.

## Review ledger — GPT Sol, round 1, 2026-09-06

[The review](260906b-plan-review-sol.md). **Refused**; all thirteen accepted.

| ID | Finding | Disposition |
|---|---|---|
| F34 | coercion could manufacture the stopping-rule result | **moot** (coercion cut by F35); the rule *score raw output, never a repaired projection* kept |
| F35 | the "impossible" pairs are not impossible under the shipped contract | **accepted — the reversal.** A mark, not a gate; coercion cut; Fable's rewording refused |
| F36 | Layer 2 could compare different rows and reward omission | **accepted.** Frozen packets; every arm answers every packet |
| F37 | landing a winner before the metric that identifies it; contradiction at the `qualifies` exclusion | **accepted.** No metric stratified by relation |
| F38 | ordering questions inside one request is not blinding | **accepted.** The judge never sees the arm's labels |
| F39 | six of seven cannot calibrate a 1-in-20 claim | **accepted.** Every anchor must be right; confusion matrix printed |
| F40 | capture sat downstream of the failures it claimed to preserve | **accepted**, then superseded by F52 |
| F41 | the corpus pin omitted a production input | **accepted.** Pinned on `inputFingerprint` |
| F42 | two stopping clauses could pass over nothing | **accepted.** `not measured` and `not exercised` are outcomes |
| F43 | no specified source for per-run cost | **accepted.** `SpendRecord`s via `totalSpend`; two-call assertion |
| F44 | **P0** — Stage F specified no safe network path; cap is per pass | **accepted.** `fetchDocument` with every check; 24 per run |
| F45 | one "no-model" packet needed semantic judgment | **accepted.** Layer 0 is deterministic only |
| F46 | the candidate inventory was incomplete | **accepted** |

## Review ledger — GPT Sol, round 2, 2026-09-06

[The review](260906b-plan-review-sol-2.md). **Refused again**; all eleven accepted, none overruled.
Discovery closes here, per [engineering-manager.md](../reusable/engineering-manager.md).

| ID | Finding | Disposition |
|---|---|---|
| F47 | **the judge cannot measure "wrong-target valence"** | **accepted — the decisive one.** The metric is *valence disagreement with the blinded judge*; the apparent-other-subject answer is qualitative and never a rate |
| F48 | Layer 2 engagement cannot distinguish the arms | **accepted.** Engagement judged once as a corpus audit; an arm's effect on it is live-only |
| F49 | the plan still landed before its promised live confirmation | **accepted.** Stage D selects provisionally and lands nothing; Stage E confirms live, judges live rows, then lands |
| F50 | "structurally valid" could recreate omission bias; 21 cells could be called 20 packets | **accepted.** Exact-permutation coverage; denominators are distinct non-anchor ids; repeats never pooled |
| F51 | the anchor rows were also the evaluation rows | **accepted.** Separate pinned manifest, cardinality asserted, excluded from every arm metric; no Cargo Cult packet counts toward the ≥20 |
| F52 | the capture still promised records it could not produce | **accepted.** Two-event append-only journal; unmatched start means the process died |
| F53 | `fetchDocument` does not itself produce the verification haystack | **accepted.** Extract first, fallback second; HTML-to-visible-text; PDFs `unsupported`; *"recovered X of Y"* |
| F54 | passage-scoped `relation` changes an authoritative contract | **accepted.** Exact instruction text fixed; the landing commit carries the docblock, parent § 4 and panel prose |
| F55 | the mark could still make abstention look like improvement | **accepted.** Printed beside the full contingency table; never orders, colours or selects |
| F56 | "winning prompt" had no declared selection rule | **accepted.** Recorded before generation: `targeted` lands only if it passes every gate and `incumbent` fails one |
| F57 | the candidate had already landed | **accepted.** `43e9fc41` from base `538e5191`, inspected through merge `bafebbc3` |

## Review ledger — GPT Sol, round 3, on Stage P's code, 2026-09-06

[The review](260906b-stage-p-code-review-sol.md), over `35db7d53`, `f344a207` and `04f7b367`. Three
findings, all three reproduced red first on the production path from Sol's own inputs, all three
accepted.

| ID | Finding | Disposition |
|---|---|---|
| F1 | **P0** — the article's own H1 is in `blockText`, so a title of ≥ 8 words and ≥ 40 characters is a quotation window: a page repeating the title earned `quoted` and cleared the default bar | **accepted.** Quotation evidence is over **prose**: `GroupInput.blockText` now carries `{ text, kind }` and `articleShingles` takes no window from a heading. Headings stay in `blocks`, which is the copy test's side. A page repeating a heading is `named`, which already covered it |
| F2 | **P0** — `isCopy` judges the *search extract*, so a fisking (long blockquote, short rebuttal) was dropped and the reader told the page was a copy — 22 windows, density 0.50, and the sentence is false | **accepted.** The drop now needs **two** signals: `isCopy(overlap)` **and** the row's own verified `sourceQuote` being article text (`isArticleText`). A mirror has no words of its own; a fisking's are its own. Strictly narrows the drop, so no row can be lost that was kept before |
| F3 | **P1** — `linked` was derived from the model-chosen witness while quotation matching saw the whole extract, so a page whose extract carried the URL was recorded `named` and hidden by the default bar | **accepted.** The directness check stays on the witness — F24's fix, load-bearing — and the `linked` signal comes from the extract, via a shared `linkTo`. The tooltip now lists what is there |

[The second review](260906b-stage-p-fix-review-sol.md) was **the same review again on the fix**, and it found four more — three of them in the fix itself,
all four reproduced red first and accepted:

| ID | Finding | Disposition |
|---|---|---|
| P0 | the first draft's `?? naming.url` fallback **fabricated a link**: the witness is an arbitrary slice, so an address ending it parses as this article there and as a longer `…-2026` successor in the whole extract — the row was shown at `linked` with a tooltip claiming a link the page does not have | **accepted.** No fallback. When neither the extract's link nor the title survives, the row is `directnessUnverified` — which is also what keeps `identifies` non-empty, honestly rather than by invention |
| P0 | a **mirror survived** when its `sourceQuote` crossed a paragraph break: the extract of a copy is the article's blocks with the breaks between them, the spaced matcher reads across one, and `isArticleText` asked per block said false | **accepted.** `isArticleText` asks the joined article. Density stays per block for the opposite reason — a join there would invent windows and inflate the ratio. Across a break the words are still the article's, so joining refuses *more* copies and no more replies |
| P1 | keeping headings on the **density** side contradicted taking them off the quotation side: a title long enough for five windows made a title-only extract read as 100% article words and the row was dropped as `sourceIsCopy` — a second false sentence about the page the first fix had just been taught to let through | **accepted.** Headings leave `blocks` too. **One rule, both sides:** a heading is naming evidence and never text evidence |
| P2 | the tooltip still did not list every signal found — `named` was read off the model-chosen witness while `linked` had moved to the extract | **accepted.** `named` is read off the extract too, showing the extract's own occurrence of the title. It is the weakest arm, so it can never move a level or what the bar shows |

**The corpus did not move — measured again after both rounds.** Layer 1 replay over the three
journals, before and after: `writes` keeps hamtyped at `quoted`, Cargo Cult keeps nothing, the
constitution keeps Lawfare at `named`. Identical loss reasons, identical levels, no `sourceIsCopy` on
either side, and no row gained a `linked` signal — **so the default bar shows exactly what the Stage
P3 table says it shows.**

**What is left, and it is a deliberate trade.** `sourceQuote` is not a fully independent copy signal:
a mirror whose model-chosen `sourceQuote` is the archive's own chrome — *"archived 12 Oct 2024 ·
original · webpage capture"* — is not article text, so the conjunction keeps it. That is the price of
not telling a reader a fisking is a copy, and it is the right way round while the ceiling's positive
case is still unmeasured (no mirror has ever been *reported as a row*). Recorded here rather than
patched, because a third mechanism with no observed case is what *"simplest version first"* refuses.

**Mutations, all caught.** Round one: headings shingled again → 3 tests; the row-level evidence
dropped from the copy refusal → 1; `isArticleText` never firing → 5, including the two mirror tests
that are its positive control; the link read from the witness again → 1. Round two: the directness
refusal disabled → 1; `named` read off the witness again → 1; the join broken → 2; headings back in
`blocks` → 2.

## Review ledger — GPT Sol, round 4, on the 80-20 cut, 2026-09-08

**Verdict: no P0. The cut is directionally right** — "the judge, generic arms framework, and full
five-article live sweep are unnecessary for this prompt repair". Six findings before it is safe to
build, and two of them correct arithmetic of mine.

- **F58 — accepted, and it is my contradiction.** The cut says evidence must be a rate over
  repetitions, then replaces that with one replay of three known cases. A single all-correct
  response happens under the *incumbent* — the journalled Skeptical Inquirer row is the proof. So
  **the three-row replay is a preflight, not evidence**, and the repeated incumbent-versus-repair
  comparison stays, **with the incumbent required to reproduce at least one error** or the
  experiment did not exercise the defect. That last clause is the part I would not have thought of:
  it makes the control's failure a precondition rather than an outcome.
- **F59 — accepted; my denominator was wrong.** "33 replayable rows" mixes reported with kept. The
  journals report 26, but one has no exact matching annotation and **production kept only 15**;
  with the spike's 7 kept that is **22 user-visible rows, so the displayed error rate is 3/22, not
  3/33**. And the database-only packets omit the evidence haystack, which § Layer 2's packet
  contract requires and which the judge design says the Geller case is invisible without. **The
  three source-quote-only cases are regression fixtures, not frozen packets**; the rate is measured
  on annotation-backed, validation-kept rows.
- **F60 — accepted.** D′ inherits F47 and adds selection and confirmation bias on top. A human label
  removes judge calibration error but still compares one categorical answer with another: it
  measures valence disagreement, not which target the model internally evaluated. Three positives
  cannot establish the sampling frame's recall, and matched controls give no population rate without
  declared sampling probabilities. **So: label every evaluable row, show the labeller only target,
  quote and evidence — `relation`, `valence` and `applies` hidden — and label before any repaired
  output exists.** Adjudication of the questionable rows goes to a second reader; there is one
  person here, so that is a different model family, declared as such rather than dressed up as a
  second person.
- **F61 — accepted, and declared here before any output is seen.** Production model and provider
  policy, and **no `temperature` field**, because production sends none (`src/debate.ts`) and
  forcing zero would measure a different distribution. **N=10 per condition, incumbent and repair
  interleaved in randomised order.** Gold disagreement scored separately for the regression anchors
  and the held-out packets. Packet-stratified permutation test, 95% packet-clustered interval, and
  the per-packet rates printed beside it. Inconclusive → extend both to N=20; bringing the judge
  back would not reduce generation noise. **Batch packets by article and pass with exact-ID
  coverage — roughly 120 calls, not 520.**
- **F62 — accepted, and it is the most valuable finding here.** P7 proves only that an
  out-of-vocabulary answer is *coerced* to `unclear`/`unknown`. It does not prove a prompt emits the
  accepted vocabulary. So a repair that made the model answer *"supportive"* would turn every row
  `unknown` — and `unknown` reads as *"the wrong label was removed"*. **The repair would look like a
  success exactly when it had destroyed the field.** Every repeated response is therefore checked
  **before** coercion: raw vocabulary counts printed, zero out-of-vocabulary required, and the run
  fails rather than crediting `unknown` as removal of a wrong label.
- **F63 — accepted, and it costs money, so Greg is being asked.** Frozen packets prevent row
  selection by design, so they cannot detect the repaired shared `READING` paragraph changing which
  sources are selected, which quotations are emitted, or whether the live fenced answer still
  parses. **One non-evidentiary live smoke run through `generateDebate` on the cheap `writes`
  article**, gating integration, raw vocabulary and non-catastrophic row production only. It is not
  evidence of the valence improvement and must never be reported as any.
- **F64 — accepted as a narrowing.** B′ carried most of the old eval: gold-URL discovery,
  kept-per-returned, the full loss table and Layer 0's P3–P6/P8 do not bear on a valence-only
  repair. The instrument needed is: extract and pin eligible packets, enforce exact packet-ID
  coverage, preserve raw vocabulary, score against hand labels, retain P7. Layer 1 replay stays as
  reusable infrastructure.

**And a factual correction to me:** the annotation counts are not uniformly 11/12. The three runs are
**11/12, 9/12 and 12/10**. Everything else in the premises held — the raw responses and extracts are
genuinely journalled, every inspected citation has a non-empty `url`, `title` and `content`, and the
prompt reading is confirmed: group two binds the claim, group one never binds *target*, neither rules
out the source's own subject, and `relation` and `valence` have different scopes.

