# Debate mode, Stage 0 — what the wire actually said

Run 2026-09-05, against OpenRouter, `anthropic/claude-sonnet-4.5`, from a throwaway probe using plain
`fetch` (no repo imports). Three calls, ~$0.23 total. Companion to
[260905f-debate-mode-what-the-web-says-about-this-piece.md](260905f-debate-mode-what-the-web-says-about-this-piece.md),
whose Stage 0 this closes.

The probe asked each call to search and then **reply with the single word `DONE`, attributing
nothing** — the same trick the 2026-09-01 Candidates probe used, so that any annotation which arrives
is one the *search* produced rather than one the model's prose earned.

## The four questions

### 1. Does a non-streaming chat-wire call accept `openrouter:web_search`? — **Yes**

All three calls returned HTTP 200 with the tool honoured and searches run. So the stage does **not**
need to stream internally the way `referee-criteria-run.ts` does; `openRouterJson` is enough.

**And the plan's claim that this would be the first pipeline stage on the chat wire is wrong.**
[`src/pdf-read.ts`](../../src/pdf-read.ts) — pipeline stage 2 for a PDF — already calls
`openRouterJson` non-streaming with a top-level `plugins` array that OpenRouter acts on server-side
(`src/pdf-read.ts:810-842`). So the wire is precedented and de-risked; what is genuinely new is only
that a *stage* runs a web search. That is a much smaller claim, and the plan's "single riskiest thing"
paragraph should be cut down to it.

### 2. Does the annotation carry a page extract? — **Yes, under `content`**

`url_citation` has five keys, not the two
[`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) § `Annotation` declares:

```
url  title  start_index  end_index  content
```

| | annotations | extract length (min–max) |
|---|---|---|
| Exa engine, article with reception | 10 | 236 – 4,945 |
| Default engine, same article | 20 | 234 – 9,858 |
| Exa engine, article with none | 9 | 237 – 6,063 |

So the extract is real and already paid for. The 2026-09-01 range (250–5,300) is confirmed for Exa.

> **Corrected 2026-09-05, and left visible rather than deleted.** This paragraph originally ended
> *"So `Citation.excerpt` is real and free, and Stage 1 of the plan stands exactly as written."* It
> did not: a GPT Sol review (F5) showed that widening `Citation` would have started storing
> third-party page extracts on every chat message and comment, for three features that show none of
> them. **Do not add `excerpt` to `Citation`.** What landed instead is a separate `SearchEvidence`
> and an opt-in `collectSearchEvidence`
> ([the plan](260905f-debate-mode-what-the-web-says-about-this-piece.md) § Stage 1). A results doc
> is a dated record, but a recommendation inside one that the next reader would act on is worth
> correcting in place.

### 3. **The engine choice is a cost decision, not an evidence decision** — the plan was wrong here

This is the finding that changes the plan most. It says `engine: "exa"` is *"load-bearing, not a
preference"*, on the strength of the measurement recorded in
[`src/converse.ts`](../../src/converse.ts) § `webSearchTool`: default engine → **0 annotations**.

On the non-streaming path that is not what happens. The default engine returned **20** annotations —
twice Exa's — every one carrying `content`, including a 9,858-character extract of the article
itself.

**This does not mean the 2026-09-01 measurement was wrong**, and nothing here should be read as
saying so. That probe was on the **streaming** path, which is where every current web-search caller
lives, and where annotations are emitted as deltas as the answer is composed. This probe is
non-streaming, where the finished message arrives with its annotations already attached. Those are
different code paths at OpenRouter and they plainly behave differently. What is established is
narrow and sufficient: **for a non-streaming call, both engines supply the evidence rule 1 needs.**

So the choice is made on cost and shape instead:

| | searches | prompt tokens | cost | elapsed |
|---|---|---|---|---|
| Exa | 7 | 15,244 | **$0.066** | 10.3 s |
| default | 8 | 26,587 | $0.115 | 10.0 s |

Exa is **57% of the cost** for half the annotations and a shorter extract. Default's extra breadth is
partly wasted — its longest extract is the article we already have. Recommendation: **Exa**, on cost,
with the reason recorded as cost rather than as evidence-supply, so nobody later "fixes" a comment
that claims the wrong thing.

**Worth passing to whoever owns Referee**, and not acted on here because it is another stage's code
([architecture.md § Stage ownership](../project/architecture.md#stage-ownership)): Candidates' Exa
branch is justified in-code by the zero-annotation measurement, which is a **streaming** result.
That justification is still standing and still plausible; this probe neither confirms nor refutes it,
because it did not test streaming. It is worth one re-probe on their path before anyone treats
"default gives no annotations" as a general fact about OpenRouter.

### 4. On an article nobody has written about, what comes back? — **the danger, confirmed**

The obscure probe named an invented blog post (*"Notes on my sourdough starter, week 3"* at
`gregs-private-baking-notes.example`) and asked for pages responding to **that specific post**.

Three searches ran and **nine annotations came back**: `mlym.gregtech.eu`, `myeclecticbites.com`,
`gratzioso.net`, `nequalsonelifestyle.com`, `sourdoughstarter.com`, `consillar.com`. Every one is a
real page about sourdough starters. **None is a response to anything.** The top hit is somebody's own
day-3 starter notes.

This is the mode's whole failure mode, sitting there in the first probe:

- **The search always returns something.** "Nothing found" is not a state the wire produces; it is a
  state *we* have to produce, by refusing rows.
- **The raw material for a convincing fabrication is present**, correctly cited. A row reading
  *"gratzioso.net — qualifies — argues that day-3 starters need warmer water"* would pass Candidates'
  rule 1 unmodified, because the URL is genuinely one the search returned. Rule 1 proves provenance
  of the *link* and nothing about the *relationship*.

So the plan's group-two bound — a `claim` in the article's words, the `blockId` where it is made, and
an `applies` line saying where it does **not** apply — is not belt-and-braces. It is the only thing
standing between this mode and nine sourdough blogs presented as critical reception. It should be
enforced in code, counted, and the count shown, exactly as planned.

It also means **the empty state is the common case and has to be good**, which is Greg's own
instruction (*"If no one (or few people) have written about this piece, let's just say so"*).

## What this changes in the plan

1. **Stage 0 is done.** Its four questions are answered above.
2. **Cut the "first pipeline stage on the chat wire" framing** to "the first stage to run a web
   search"; `pdf-read.ts` is the precedent for the wire itself.
3. **Rewrite the engine paragraph**: Exa on cost, not on evidence supply, with the streaming /
   non-streaming distinction stated so the two measurements are not read as contradicting.
4. **Stage 2 gains a specific, testable requirement** from finding 4: a fixture built from the
   sourdough probe, asserting that a run over an article with no reception yields an **empty group
   one** and a group two whose every row carries claim + blockId + applies — and that the drop count
   is shown. That is a red-before-green test the plan did not previously name.
5. **`STEP_BUDGET_MS`**: 10 s for a bare probe; the real call adds the article and a JSON schema.
   The neighbouring `timeline` budget is 240 s for measured runs of 78–125 s. A first guess of
   **120 s** is defensible and should be re-measured at the end of Stage 2 rather than left as a
   guess.
6. **Cost is now a known number, not a worry**: ~$0.07 a run at Exa. Worth putting in front of Greg
   beside the other per-step costs, since this is a step a reader can press. — **Superseded by Stage
   0b below: it is a known number and still a worry.**

## Stage 0b — is `max_total_results` an enforced ceiling? Yes. Is it a spend ceiling? **No.**

Two adversarial calls, 2026-09-05, Exa engine, a system prompt ordering **"at least twelve separate
web searches, be thorough, do not stop early"** against a topic with abundant coverage. The question
was whether `max_total_results` is honoured, or advisory the way `max_uses` turned out to be —
[`src/converse.ts`](../../src/converse.ts) records a probe that asked for 2 and got 6.

| `max_total_results` | searches actually run | annotations returned | cost | elapsed |
|---|---|---|---|---|
| 4 | **36** | 4 — capped | $0.1008 | 10.3 s |
| 20 | **24** | 19 — under cap | $0.1352 | 10.0 s |

**The cap is real and holds to the row.** Annotations never exceeded it, under a prompt written
specifically to make them.

**But it bounds what comes back, not what we pay for.** With the cap set to 4 the provider ran
**thirty-six searches** and billed for all of them — ten cents to deliver four results. Nothing in
the request bounds the *number of searches*, and the number of searches is what costs money. Both
`max_uses` and `max_total_results` are result caps, and neither is a budget.

Three consequences, all of which changed the plan:

1. **The prompt must not ask for thoroughness**, which is counter-intuitive enough to be worth
   stating as a rule. The two probes above differ from the well-behaved Stage 0 call ($0.066, 7
   searches) mainly in being *told to be exhaustive* — and that instruction tripled the search count
   while the evidence returned stayed capped. Exhaustiveness buys nothing here and costs triple.
   Write for restraint; let the cap do the limiting.
2. **The honest cost figure is higher than Stage 0's.** Worst observed for a *single* pass is
   **$0.135**, so a two-pass run is **up to ~$0.27**, typically $0.13–0.20 — comparable to the
   illustrated diagram, which
   [experimental-features.md](../project/experimental-features.md) calls the dearest and slowest
   thing in the app. That is for a step a reader can press, so it went in front of Greg rather than
   into a footnote.
3. **The only real bound is the deadline and the ledger.** Since no parameter caps spend, the stage
   needs an abort deadline that actually fires, and `webSearches` on the `ai_calls` row — recorded on
   this wire since 2026-09-02 ([`src/ai-call.ts`](../../src/ai-call.ts)) — is the alarm. A run that
   made 36 searches shows up nowhere else.

**What this did not measure**, and should not be read as measuring: whether a *restrained* prompt on
a *typical* article costs less than $0.135. Both probes were adversarial by design. The real
distribution comes from Stage 2's first runs against the shelf.

## Stage 3½ — the first live runs, 2026-09-05

Two articles, **$0.6252** of real spend, from the `ai_calls` ledger rather than from a probe script.
Everything before this section was measured with a bare prompt; this is the built stage.

| article | pass | searches | cost | ms | outcome |
|---|---|---|---|---|---|
| `cargocult-spya-rz663q` | A | 6 | $0.1747 | 82,784 | **0 direct** — 2 reported, both lost to `unverifiedSource` |
| `cargocult-spya-rz663q` | B | 4 | $0.1780 | 63,833 | **7 claim rows** kept of 8; 1 lost to `claimNotInBlock` |
| `claudes-constitution-…` | A | 2 | $0.0777 | 37,026 | process killed before pass B — **paid for, discarded** |
| `claudes-constitution-…` | A | 2 | $0.0725 | — | produced 1 direct + 5 claim rows … |
| `claudes-constitution-…` | B | 2 | $0.1223 | — | … and then **failed to store them** |

### 1. The cost figure is a range, and the plan's ceiling was too low

A completed run cost **$0.3527** — above § The spend ceiling's "up to ~$0.27", which was measured with
probes carrying **no article** while pass B sends the whole thing. Per-pass cost varied **2.4×**
($0.0725 to $0.1780) with how much the model chose to search, so *any* single figure is a sample.
Quote it as **$0.20–0.40 for a completed run on a short article**, rising with length, and say it is
a range rather than a number.

### 2. `STEP_BUDGET_MS = 120_000` is too small, and would not have fired anyway

The completed run took **146.7 s** wall-clock. The guess was 120 s. It did not abort, because
`STEP_BUDGET_MS` is consulted only between steps (Sol's F31) — so the guess was both wrong and inert.

### 3. Group one's binding constraint is **not** the rule two review rounds were spent hardening

On Feynman — fifty years of citation — group one kept **nothing**, and `directnessUnverified` was
**0**. Both reported rows died earlier, at `unverifiedSource`: the model's quotations were not
findable in the search extract. So `articleReferenceQuote` never got a look in, and the real limit is
the one § Attribution calls out under F18 — the extract is a 236–4,945 character slice chosen by a
search engine, not the page. **Fetching the full page, listed in § Deliberately not in v1, is now the
highest-value deferred item rather than a nicety.**

Group one is *not* impossible: the second article produced **1 direct row**. So the rule admits real
reception; the extract is what usually stops it.

### 4. `valence` is systematically measuring the wrong thing — the one user-visible bug

Three of the seven Feynman rows point valence at the **source's own subject** rather than at the row's
target:

| row | relation | valence | what it actually does |
|---|---|---|---|
| psi-encyclopedia, metal-bending | `disputes` | **positive** | disputes Feynman; positive about psi |
| skepticalinquirer | `corroborates` | **negative** | backs Feynman; negative about Geller |
| psi-encyclopedia, Rhine | `disputes` | **positive** | disputes Feynman; positive about parapsychology |

§ 4 defines the target — *the cited passage's stance toward the row's target* — after Sol's F19, and
the prompt does not enforce it. On screen a source **supporting** the article draws a red *Critical*
chip, which inverts the at-a-glance signal Greg asked for, on roughly half the rows. **Fix the prompt
and re-run**; it is not measurable any other way.

### 5. Two operational findings about spending money on a shared box

- **Atomicity means a process death burns the completed pass.** The two passes are one step (F16,
  correctly), so a kill between them writes nothing and bills pass A anyway — $0.0777, here, to the
  OOM killer. A background job on a loaded box is not a safe place to run this; use tmux.
- **A CLI-queued job may be executed by somebody else's checkout.** The local Supabase is shared, so
  the second run's job was claimed by a dev server in another worktree, ran both passes, produced
  `1 about this piece, 5 about what it claims`, then errored on the write — and **its logs are not in
  this tree**, so the cause is unresolved. `whyUnusable("debate", …)` and `isDebateDocument` both
  accept a one-direct-row document, so the shared validators are not it. To settle it: run the step
  with no other dev server up, or read the logs of whichever server claimed the job.

---

Up: [260905f-debate-mode-what-the-web-says-about-this-piece.md](260905f-debate-mode-what-the-web-says-about-this-piece.md)
