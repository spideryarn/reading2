# Open questions

Undecided calls, each with a recommendation so work isn't blocked. When one gets decided, write the
decision into the relevant doc ([vision](vision.md) / [granularity-zoom](granularity-zoom.md) /
[architecture](architecture.md)) and delete it from here — this file should shrink over time.

---

## Q1 — Where does the hierarchy come from? <a id="q1"></a>

Greg's framing was structural:

> imagine a book, you could think of the book as being divided into chapters, which are divided into
> sections, which are divided into, I don't know, pages or paragraphs

But most web essays aren't books. The test article (Noema, Anil Seth —
`output/noema-mythology-of-conscious-ai.html`) is ~54 minutes of largely bare `<p>` with few
subheads, so "chapters → sections" mostly has to be *invented* rather than read off the document.

| Option | For | Against |
|---|---|---|
| Source headings only | faithful, free, the author's own seams | depth varies wildly; flat articles collapse to 2 levels, which kills the left-right axis |
| LLM segments semantically | uniform depth on any article | boundaries are the model's opinion; costs a structuring pass |
| **Headings as hard boundaries, LLM subdivides the gaps** | keeps the author's seams where they exist, gives flat articles real depth | tree shape differs between articles; more code paths |

**Recommendation: the third.** Provisionally adopted in
[granularity-zoom.md § Where the tree comes from](granularity-zoom.md#where-the-tree-comes-from).
Target branching factor ~5–9 so levels feel like even strides.

---

## Q2, Q3 — decided <a id="q2"></a><a id="q3"></a>

Both settled on 2026-08-24 and written up where they belong. Anchors kept so older links still land.

- **Q2 — who assigns block ids, and how stable are they?** Stage 3 (blocks + hierarchy agent), and ids are
  **random**, not sequential, because sequential ids silently break on re-extraction. See
  [block-ids.md](block-ids.md#why-random-and-not-sequential). Note this went *against* the
  recommendation recorded here, which was sequential-plus-`textHash`; the hash-migration step it
  proposed is unnecessary once ids simply survive.
- **Q3 — what is a "block"?** The **finest** unit a reader takes in as one thing: an `<li>` is a
  block, the `<ul>` is a tree node. See
  [architecture.md § What a block is](architecture.md#what-a-block-is). Also against the
  recommendation here, which was one block per top-level flow element — that would have made
  "a ToC row per list item" permanently unreachable.

---

## Q4 — Discrete levels or continuous zoom? <a id="q4"></a>

Greg described it as continuous motion:

> by scrolling rightwards, you get more detail. By scrolling downwards, you progress through the
> chronology of the article

A true continuous axis would need interpolation between compression levels, which nothing about the
tree gives us for free.

**Recommendation:** discrete depths with animated transitions in v1; a continuous-feeling *gesture*
(horizontal scroll / trackpad swipe) that snaps to depths. Revisit only if the snapping feels wrong
in the hand.

---

## Q5 — Uniform-level zoom, or focus+context? <a id="q5"></a>

The brief describes the whole article at a uniform granularity. But the likely real usage is: scan
the coarse level, spot the one part you care about, and drop into *that* alone while the rest stays
coarse.

**Recommendation:** build both, default to uniform, instrument which gets used. Noted as a failure
mode in [granularity-zoom.md § What would make this fail](granularity-zoom.md#what-would-make-this-fail).

---

## Q6 — How do we know it's working? <a id="q6"></a>

[vision.md](vision.md) claims we're augmenting rather than replacing cognition. That claim needs a
test, or it's just a slogan. Candidate signals: do readers actually scroll right? Can they
reconstruct the argument afterwards? Do they quote the piece?

**Recommendation:** unresolved, and worth resolving early — it's the difference between this being an
experiment and a demo. Explicitly *not* time-in-app or articles-completed
([anti-goals](vision.md#anti-goals)).

---

## Q7 — Which model, and how much does a tree cost? — **answered 2026-09-07** <a id="q7"></a>

**Sonnet 5, and about six cents.** Measured on two fresh ingests against the local database, with the
dollars taken from the ledger rather than from arithmetic —
[ai-gateway.md § What an article costs to arrive](ai-gateway.md#what-an-article-costs) is the answer
and the method; the headline is here because eight things link to this anchor.

| | blocks | words | **hierarchy** | labels | total |
|---|---:|---:|---:|---:|---:|
| *How to Work Hard* | 96 | 3,341 | **$0.0620** | $0.0437 | $0.1057 |
| *How to Do Great Work* | 330 | 11,890 | **$0.1671** | $0.2144 | $0.3815 |

About **a tenth of a cent per block**, and close to linear. **The tree is one model call** whatever
the size, and it is the only paid step in the default ingest — so the money between pasting a URL and
being able to read is the hierarchy column alone. `labels` is bigger on a long article and the reader
does not wait for it. These are credits; the bank sees about 5.5% more.

**Two things this question assumed that turned out to be wrong**, which is most of why it stayed open:

- *"bottom-up generation is roughly one call per node plus one per leaf batch"* — no. It is **one
  long-context call for the whole tree**, and has been since the structure prompt was written. The
  per-node estimate would have been an order of magnitude out on a long article.
- *"still unmeasured for the tree"* — it needed no experiment built for it in the end.
  `src/pipeline.ts` already logged the four token counters per step, and `ai_calls` already held the
  settled cost, so the answer was two ingests and a query.

The 2026-08-26 caching numbers below are kept because they answer a different question — the
per-token economics of a *search* pass, and what a warm prefix saves.

What 2026-08-26 established, from `npm run eval:caching` against the live API
([evals/results/](../../evals/results/README.md)) — these are *search* calls, not tree generation, so
they answer the per-token economics rather than the question as asked:

| | tokens | cold | warm | uncached |
|---|---:|---:|---:|---:|
| `constitution`, 360 blocks | 47,739 | $0.11945 | $0.00965 | $0.09558 |
| `noema`, 141 blocks | 18,793 | — | $0.00386 | $0.03769 |

So one pass over the constitution's text costs about **10 cents** uncached, and about **1 cent** once
the prefix is cached. A tree is more than one pass — the structure call plus a label batch per
section — but the unit price is now known rather than guessed, and
[prompt-caching.md](prompt-caching.md) means the repeat passes are the cheap ones.

**Nothing is left** — that was done on 2026-09-07 and is the table at the top of this question.
[260907d](../plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md) § *Stage 5* has the
commands, the two slugs, and the labels failure that the long article's figure includes.

---

## Q8 — Where does a sentence's rank come from, in the fisheye view? <a id="q8"></a>

Only bites once the [fisheye view](granularity-zoom.md#the-other-view-fisheye) is built; the
[tabular view](granularity-zoom.md#the-tabular-view) needs only per-node gists and is unaffected.

Fisheye varies granularity *within* one screen, so it needs a number per sentence, not per node.
Two ways to get one:

| Option | For | Against |
|---|---|---|
| **Hierarchical budget** — each node promotes its best sentence, which inherits the node's depth | coverage is guaranteed even; the far-left view is literally "one sentence per chapter", which is what the brief asked for; only local judgments, which LLMs are good at | a dull section gets the same airtime as the crux |
| Global salience score | honest about where the substance actually is | clumps badly; whole sections render as nothing when zoomed out, so the map develops blind spots |
| Global score with a per-section quota floor | strictly better output than either | two interacting mechanisms to tune and debug |

**Recommendation: the hierarchical budget**, because it delivers the brief's own description of the
leftmost column and because it degrades gracefully. Revisit if the coarse levels feel like they are
giving equal weight to unequal material.

Related and also open: the fisheye sketch leans toward showing the author's **real sentences** where
the tabular view shows **generated gists**. Those are different bargains with
[principle 1](vision.md#principles) and should be reconciled deliberately.


---

## Q9 — decided <a id="q9"></a>

**A hostile article could run JavaScript in the reading view.** Settled 2026-08-25 and written up in
[security.md](security.md), which is now the place for anything on this. Anchor kept so older links
still land.

Short version: Readability is not a sanitiser and never claimed to be, so `<img onerror>`,
`<svg onload>`, `<span onmouseover>` and `<video onerror>` all reached `dangerouslySetInnerHTML`.
DOMPurify now runs at **stage 3** in [`src/blocks.ts`](../../src/blocks.ts), before ids are minted,
so `blocks.json` is clean and every later consumer inherits that. Video embeds survive behind an
exact-origin allowlist; author CSS does not.

Two things worth carrying forward rather than burying:

- The payload table originally written here **was wrong in a reassuring direction** — it had
  `onmouseover` and `<iframe>` as stripped, which is true only for the cases it happened to test.
  Corrected in [security.md § What was wrong](security.md#what-was-wrong).
- The linter found this (`lint/security/noDangerouslySetInnerHtml`), and the rule was deliberately
  left unsuppressed until it was really fixed. It stayed useful precisely because nobody silenced it.

---

## Q10 — Should a tooltip be hoverable? <a id="q10"></a>

Every card in the app is `pointer-events: none`, so the pointer cannot enter one: move onto it and
it closes. WCAG 2.1 § 1.4.13 asks for the opposite — hover content must stay available while the
pointer moves onto it — and while the native `title` attribute is exempt from that criterion, a card
we draw ourselves is not. The homepage masthead's three links were conforming by exemption until
2026-08-28, when they stopped being `title` attributes. Raised by ⟨Sol⟩ reviewing that change.

| Option | For | Against |
|---|---|---|
| **Leave it** | the rail is most of the tooltips in the app, and a spine card that took hover would sit on the band you are pointing at and hold itself open | a known 1.4.13 failure, worst for anyone using magnification or a large cursor, where crossing the gap is easy to do by accident |
| Hoverable everywhere | one behaviour, conforming | breaks the rail, which is the surface the tooltip was built for |
| **Per-use**: `Tooltip` takes a prop that adds `.tooltip-anchor.interactive` and a `safePolygon()` corridor | the masthead and any future prose-ish card conform; the spine keeps what it has | a second interaction mode inside a shared component, and `safePolygon` is the fiddliest part of Floating UI to get right |

**Recommendation: per-use, when something needs it.** Nothing in these three cards is worth
travelling to — no link, no button, nothing to select but a sentence and an address — so the cost
today is the standard, not the reader. The machinery already exists (`ProseHoverCard` uses
`.interactive` for real reasons), so this is a prop and a corridor rather than a design.
[tooltips.md § The pointer cannot enter a card](tooltips.md#the-pointer-cannot-enter-a-card-and-that-used-to-be-exempt)
has the detail.

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
- **Whose stage it is.** Fetching images is acquisition, which is stage 1's job
  ([fetching.md](fetching.md)) — but nothing there fetches anything but the document today.

**And there is a larger prize behind the same door.** If we are fetching every image at ingest, we
could *host* them: hotlinks rot, publishers block by referer, and today every reader's browser
announces itself to the publisher's CDN on every read. That is a bigger piece of work than this
question, and it would make this one free.

---

## Q12 — Does "briefly broken is fine" apply to `dev`, or only to production? <a id="q12"></a>

[CLAUDE.md](../../CLAUDE.md) says, under *This is a beta, and speed still wins*:

> It is not the end of the world if something is briefly broken — a database migration that lands
> before the code that matches it, and breaks production for the minutes in between, is fine.

Both readings are natural and at least two agents have taken the wider one for weeks. But the
example is about **production**, where the readership is small and knows what it signed up for —
and the cost of a red **`dev`** is a different thing entirely, because `npm run deploy` gates the
exact sha it ships — `scripts/deploy.ts` runs the full suite against a worktree of that sha, not
just a typecheck. So a broken trunk never reaches a reader. It reaches *agents*.

**Measured on the night of 2026-09-08**, from one shared-fixture collision I pushed: one session
spent **twenty minutes** proving an earlier red was not theirs; another spent a **full 24-minute
gate**; a `Next deploy` and a `get-ready-for-deploy` run were both about to spend a third and a
fourth before they were told. Roughly an hour of other agents' time from one uuid, on a box running
forty of them.

**Recommendation: say which one it means.** A sentence like *"this is about production; on `dev`,
push the fix rather than batching it — a red trunk costs other agents' gates, not readers'
minutes"* would settle it. That is an edit to CLAUDE.md, whose wording is a rule, so it wants
Greg's approval one set at a time ([edit-important-docs.md](../reusable/edit-important-docs.md))
rather than an agent deciding it.

**The argument from the sentence's own reasoning, added 2026-09-08**, because it is stronger than
the argument from cost and does not depend on the hour above being typical. The licence in CLAUDE.md
is granted with a reason attached: *"the readership is small and knows what it signed up for"*. That
is not a claim about how much breakage costs — it is a claim about **who absorbs the cost, and
whether they consented to it.** Readers of a beta did consent. **Agents cannot.** A red trunk is
inherited silently by every worktree that pulls, and the cost lands as somebody debugging what they
believe is their own breakage — which is worse than the same minutes spent knowingly, and is the one
thing the original sentence's reasoning does not cover. So the licence really is narrower on `dev`
than on `main`, for a reason that has nothing to do with readers.

Raised jointly with `spideryarn2-4c`, which had read it the same way.

---

## Q13 — A new `docs/reusable/` note: a name is evidence, not an identity <a id="q13"></a>

**Proposed, not written.** `docs/reusable/` wording is a rule, so a new note there wants approval one
set at a time ([edit-important-docs.md](../reusable/edit-important-docs.md)). Two agents reached this
independently on 2026-09-08 and agreed one of us should write it rather than both.

**The shape.** In a system where a name is assigned by one mechanism and consumed by another, the
name is *evidence about* identity — with its own provenance, its own decay, and its own failure to
be unique — and code that treats it as identity addresses the wrong object silently. Five instances
in one night, all in the fleet work, none of which looked like the others at the time:

- **Five processes in one chain carry `run-codex.ts`; exactly one carries `codex exec`.** A
  recogniser matching the wrapper counts one review five times. The visible name appears at every
  depth of the chain; the thing itself appears once.
- **`claudeSessionId` is set before Claude runs and never updated**, so a pane whose conversation was
  replaced keeps the old one. A uuid that *changes* is evidence; a uuid that *does not* is not.
- **Renaming a session without clearing `GJD_PROVISIONAL`** gets it renamed straight back by
  `adoptTitles` — the name is owned by a mechanism that will reassert it.
- **`dir` and `branch` arrive as two independent claims off one row**, and nothing downstream put
  them back together: the check runs in the directory, the sweep removes by branch. Two names for one
  thing, trusted separately.
- **`repo` is not one value** — across a single snapshot it was the repo, `null`, the literal string
  `"unknown"`, and a different repo entirely.
- **And the one that started it, which predates the fleet work by a week.** `tmux -t` accepts a
  session *name* where you meant a handle, and resolves it happily; tmux reassigns a name when a
  session dies. So a keystroke aimed at a row somebody read ten minutes ago lands in whatever now
  wears that name. It is the hardest-won rule in
  [orchestrator-direction.md](orchestrator-direction.md), and it is this class in its purest form:
  the API offered the name and the handle as interchangeable, and they are not.

The last one is worth keeping at the front of the note, because it shows the shape arriving from
*outside* — not a convention we invented and then trusted, but an interface that presented a name and
an identity as the same argument. Most instances of this class are somebody else's `-t`.

**The rule it would carry.** When you match on a name, ask three things: *who wrote it, when, and
what would make it stale.* Prefer a key you can **verify** over one you can only **read** — and when
a name occurs at several depths of one structure, matching it counts one thing many times, which
reads as a busy system rather than as a bug.

**Why it is not just [silent-success.md](../reusable/silent-success.md).** That doc is about a check
that reports success while doing nothing. This is about code that does exactly what it says, to the
wrong object — every step succeeds, and the answer is about something else. The two meet only in
that both produce a confident, wrong, quiet result.

---

## Q14 — Two additions to `silent-success.md`, from the fleet work <a id="q14"></a>

**Proposed, not written**, because `docs/reusable/` wording is a rule and edits there go one approved
set at a time ([edit-important-docs.md](../reusable/edit-important-docs.md)). Both were earned on
2026-09-08 and both are the same family as what that file already says.

**1. A metric that can legitimately be zero is indistinguishable from a broken one, so record its
positive control beside the number — permanently.** The Overseer's work classifier answered *zero*:
of 623 fleet rows the dashboard called `idle`, none had child work under them. That is a true and
useful answer, and it is also exactly what a silently broken probe returns. The fleet dashboard
agent's framing:

> A metric that can honestly be zero needs its *positive control* recorded next to the number,
> permanently, not just at the moment of building. In six weeks the number will be in a dashboard and
> the control will be in a session transcript nobody can find.

This is the third face of the failure that file is about — after *a check that reports success while
doing nothing*, and *a guard whose silence is not evidence*. The answer is the same each time: make
the instrument prove it can still see, in a place that travels with the reading.

**"Beside the number" is the weak form and "asserted by the same run" is the strong one**, and the
difference is worth spelling out because only the second survives. A control recorded once is a
snapshot of a probe that worked in September; a control the measuring run performs itself cannot go
stale without going red. S6 already does the strong version — it names the suite fixtures that keep
the control true, next to the zero — and that is the shape to describe, because the weak version
decays into a paragraph nobody re-runs. Where the strong version is impossible, say which of the two
you have.

**2. A hazard that is easy to describe and impossible to arrange is telling you a seam is missing.**
The dashboard's collector wedged for thirty minutes and reported `error: null`, because a `bash` in
uninterruptible IO does not die on the `SIGTERM` its timeout sends, and `promisify(execFile)` waited
for a process that was never coming back. It had no test, and the reason it had no test is the rule:

> A promise that never settles is the one behaviour no real tmux can arrange — which is precisely why
> this had no test.

The corollary is the practical half, and it is the agent's, not mine: **being unable to write the
test is itself the finding.** They did not go looking for a seam and then write a test; they found
they could not write the test. So when a hazard is easy to describe and impossible to arrange, stop
and add the parameter — the difficulty is the design telling you something, not the test being
awkward. "Untestable" is usually this sentence undiscovered.

**And the limit, without which this rule does harm.** Followed without one it says *add a seam for
every hazard*, and a seam is a path the test takes and production does not — so a codebase that
obeys it enthusiastically ends up with a production path no test has ever run, which is a worse
version of the thing it was avoiding. The boundary is small and mechanical: **the seam's default
must be the real thing.** `collectWithDeadline(run = collect)` is safe because production calls it
with no argument and executes the same function body the test does; only the leaf differs. A seam
whose default is a stub, or which production must be configured to avoid, has moved the untested
region rather than shrunk it. If injecting the hazard means production stops running the code under
test, the answer is not a seam — it is that this hazard is one you accept and write down.

Both raised with `claude-agents-dashboard`, which is pointing at this entry rather than duplicating
it. This entry is meant to be **deleted** once decided.
