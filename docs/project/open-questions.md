# Open questions

Up: [vision.md](vision.md)

Undecided calls, each with a recommendation so work isn't blocked. When one gets decided, write the
decision into the doc that owns it and delete it from here — this file should shrink over time.
Three are open: [Q6](#q6), [Q11](#q11) and [Q12](#q12). [§ Closed](#closed) at the bottom says where
each of the others went.

---

## Q6 — How do we know it's working? <a id="q6"></a>

[vision.md](vision.md) claims we're augmenting rather than replacing cognition. That claim needs a
test, or it's just a slogan. Candidate signals: do readers actually scroll right? Can they
reconstruct the argument afterwards? Do they quote the piece?

**Recommendation:** unresolved, and worth resolving early — it's the difference between this being an
experiment and a demo. Explicitly *not* time-in-app or articles-completed
([anti-goals](vision.md#anti-goals)).

A study that would answer it, for Greg to run:
[260910a-reader-study-protocol-do-the-reading-tools-help-understanding.md](../investigations/260910a-reader-study-protocol-do-the-reading-tools-help-understanding.md)
— written 2026-09-10, not yet run.

---

## Q11 — Should the pipeline decide which figures need a light sheet? <a id="q11"></a>

Article figures currently sit on `--figure-sheet` **unconditionally** — every image in the reading
column gets an off-white ground, because a transparent PNG carrying black ink is otherwise invisible
on our page ([design-css-overview.md § the light sheet under a
figure](typography.md#content-that-cannot-be-read-at-all-the-light-sheet-under-a-figure),
[../plans/260828az-figures-in-the-prose.md](../plans/260828az-figures-in-the-prose.md)). Greg, 2026-08-29:

> Perhaps this could be part of the post-processing that the LLM does after Readability to notice
> images that need this?

The stage is right and the tool is not. **There is no model in stage 2's HTML branch** — Readability
is free and deterministic, and the only model on that path reads *PDF* pages
([content-extraction.md § Two extractors](content-extraction.md#two-extractors-one-artefact)). And
the question is not a judgement call: "does this file have an alpha channel, and is the ink behind it
dark?" is a fact you get by decoding the bytes. A vision model would be paying per image to guess at
what `sharp` answers exactly.

**What makes the pipeline the right place is not the LLM — it is the server.** The reason this cannot
be detected in the browser is CORS: article images are hot-linked cross-origin with no `crossorigin`
attribute, so a canvas drawn from one is tainted and `getImageData` throws. Node has no such rule.

| Option | For | Against |
|---|---|---|
| **The sheet on every figure** (today) | one CSS rule; no fetching, no artefact, no new dependency; cannot be wrong in the direction that costs a reader the content | a mat around every photograph; a figure drawn *for* a dark page (light ink on transparent) is made invisible, which is the one case this makes worse |
| Decode each image at ingest and record the treatment | exact, deterministic, cacheable; no mat on photographs; the light-ink case is left alone | images become something we fetch — N requests per article; an image-decode dependency; a new artefact and a client-side join; a fetch that fails needs a default |
| A vision model looks at each image | could also answer "is this a diagram or a photograph" | pays per image for something a decoder knows; non-deterministic; nobody has asked the second question |

**Recommendation: the second, when the mat starts to annoy someone — not before.** Three things a
plan for it would have to settle:

- **Where the answer rides.** Not as a `data-` attribute on the `<img>` in `article.html`. The
  browser sanitiser has to strip our own attributes from stored markup, or a publisher can forge one
  ([security.md](security.md), and `SANITIZER_VERSION` 3). So it would be a `src` → treatment map in
  an artefact, applied client-side — the same shape as marks.
- **The default when the fetch fails.** Hotlink protection and 403s are ordinary. *Unknown* must mean
  *sheet*, because the failure of omission is an unreadable equation and the failure of commission is
  a mat.
- **Whose stage it is.** Stage 4.5's, which already has the bytes
  ([`src/collect-assets.ts`](../../src/collect-assets.ts)).

**The fetching this option was charged with has since been built for another reason.** Stage 4.5
attempts to download and host supported images within its caps ([article-images.md](article-images.md)), so successfully stored images' bytes are already in
hand at ingest and the first two "against"s in the table are paid for those images. What is left of the cost is the
decode, the map and the client-side join.

---

## Q12 — Which live-conversation engine survives? <a id="q12"></a>

Live conversation has two engines: OpenAI Realtime, which every reader gets, and GPT-Live, offered
beside it with Experimental features on
([live-conversation.md § The second engine](live-conversation.md#the-second-engine-gpt-live-behind-experimental)).
They were built side by side to be compared, and the comparison ends:

> But eventually I think we only want one.
>
> — Greg, 2026-10-02

**This is Greg's to answer, on real articles with a real microphone.** Everything measured so far
used a synthetic voice or a silent track, so speech in a room, echo and street noise are untried on
GPT-Live. What to look at, from the four conditions in
[261002r](../investigations/261002r-gpt-live-spike.md#recommendation) and GPT Sol's consult for
[261003a](../plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md):

| | What would count against an engine |
|---|---|
| Grounded answers | a claim about the article that no passage backs, or no passage shown |
| Fulfilled delegations (GPT-Live) | "let me check" and then nothing, or an answer given without asking the backend |
| Time to a useful answer | the wait before the first words that are the answer, not filler |
| False interruptions | the reply cut off by a cough, a bystander or its own echo |
| Stalls | a reply owed and never spoken; a turn held open by noise |
| Saved-history fidelity | the Chat rows afterwards missing words, or in the wrong order |
| Cost | per conversation as actually held, pauses for reading included — GPT-Live bills open minutes, Realtime bills turns |

**Recommendation:** none yet. On paper Realtime is ahead on article answers and GPT-Live on quick
back-and-forth and cost per dense minute; Greg's own report is that GPT-Live "seems to be working
better" in WhatNext. When it is decided, the loser's files are deleted under a follow-up plan and
this question goes.

---

## Closed

One line each, so an old link still lands on a pointer. The decision itself is in the doc named.

| | Question | Where it went |
|---|---|---|
| <a id="q1"></a>Q1 | Where does the tree come from? | Adopted: the author's headings as hard boundaries, a model subdividing the gaps — [granularity-zoom.md § Where the tree comes from](granularity-zoom.md#where-the-tree-comes-from) |
| <a id="q2"></a>Q2 | Who assigns block ids, and how stable are they? | 2026-08-24: stage 3, and random — [block-ids.md § Why random](block-ids.md#why-random-and-not-sequential) |
| <a id="q3"></a>Q3 | What is a "block"? | 2026-08-24: the finest unit a reader takes in as one thing — [architecture.md § What a block is](architecture.md#what-a-block-is) |
| <a id="q4"></a>Q4 | Discrete levels or continuous zoom? | Moot: it was a question about the gist columns, removed 2026-09-29 — [granularity-zoom.md § Interaction](granularity-zoom.md#interaction) |
| <a id="q5"></a>Q5 | Uniform-level zoom, or focus+context? | Moot, the same way — [granularity-zoom.md § What would make this fail](granularity-zoom.md#what-would-make-this-fail) |
| <a id="q7"></a>Q7 | Which model, and how much does a tree cost? | 2026-09-07: Sonnet, one call, about a tenth of a cent per block — [ai-gateway.md § What an article costs to arrive](ai-gateway.md#what-an-article-costs) |
| <a id="q8"></a>Q8 | Where does a sentence's rank come from, in the fisheye view? | Never decided; the view was never built — [granularity-zoom.md § The other view: fisheye](granularity-zoom.md#the-other-view-fisheye) holds the options |
| <a id="q9"></a>Q9 | Could a hostile article run JavaScript in the reading view? | 2026-08-25: it could, and DOMPurify now runs at stage 3 — [security.md](security.md) |
| <a id="q10"></a>Q10 | Should a tooltip be hoverable? | 2026-10-02: per use — [tooltips.md § A card the pointer can enter](tooltips.md#a-card-the-pointer-can-enter) |
