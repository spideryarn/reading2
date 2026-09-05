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

So `Citation.excerpt` is real and free, and Stage 1 of the plan stands exactly as written. The
2026-09-01 range (250–5,300) is confirmed for Exa.

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
   beside the other per-step costs, since this is a step a reader can press.

---

Up: [260905f-debate-mode-what-the-web-says-about-this-piece.md](260905f-debate-mode-what-the-web-says-about-this-piece.md)
