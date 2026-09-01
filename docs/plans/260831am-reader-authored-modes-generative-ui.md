# Reader-authored modes, and the generative-UI question

**Status: someday/maybe.** Written 2026-08-31. Nothing here is being built. This is the thinking,
kept so the next person to have the same idea starts from the answer rather than from the question.
[What would make us pick this up](#what-would-make-us-pick-this-up) says what has to change first.

## Goal

Greg, 2026-08-31:

> I'm interested in the idea of generative UI. Indeed, that was part of the inspiration for the
> Sketch Diagram sub-mode.
>
> But I built modes for Ideas, and Quotes, and Timeline — and it occurred to me that it would be
> better if users could build their own! One simple option would be to extend the `Feedback`
> functionality that another agent is working on to include feature-requests, and have a way to
> auto-build new features, or something like that.
>
> Another idea would be to encourage people to build browser extensions (and to provide tools/docs
> to make this easier), e.g. to modify the DOM or something. But this seems a bit
> crude/slow to iterate/fragile.
>
> Another idea would be to build Spideryarn itself to be extensible. For example, there could be a
> DIY-Mode which takes in instructions, and runs an LLM that generates React code in response to the
> request, including being able to generate SVG and make LLM calls. Ignore the risks/expense/latency,
> and just dream about how to make this as powerful and easy and rich and robust and flexible and
> beautiful as possible.

Two passes were run, as asked: Claude Fable dreaming with the brakes off, then GPT Sol as devil's
advocate. Both are kept beside this file. Sol read the real code, and its three central objections
were checked against it and hold.

## The fact that reframes the question

**Meaning Search is already a reader-authored lens**, and it is further along than either model
realised. A reader types a criterion in their own words, presses **find**, and gets anchored
passages with a confidence and a line of reasoning. The run is *saved* beside the article. Several
can be on at once, each with its own hue, its own lane down the spine, and its marks in the prose —
[search.md § Several searches at once](../project/search.md#several-searches-at-once-each-with-a-colour).

So "let readers make their own Ideas mode" is most of the way built under a different name. What is
missing is not the authoring. It is **typed fields and a chosen presentation** — and that is the
expensive part.

## What the dreaming pass proposed, and where it breaks

Fable's central claim: Sketch already answered the hard question and the answer generalises. A mode
becomes a small JSON document — an `ask` (prompt, scope, typed fields whose types carry their own
validators) and a `show` (layout, slots, grouping, what it paints) — interpreted by one generic
panel, scored the way `readSketch` scores a scene. Ideas, Quotes and Timeline become three rows in a
table.

**That last claim is false**, and the three counter-examples were each verified in the code:

- **Quotes.** The model is deliberately never given a block id. It returns words; the server finds
  their location — [quotes.md § The model returns words, never a block id](../project/quotes.md#the-model-returns-words-never-a-block-id).
  The proposed schema hands the model both a `quote` field and a `blockref` field, which reintroduces
  exactly the failure the real mode is built to exclude.
- **Timeline.** Greg, 2026-08-31: *"don't sort by date at all — use the model's reading"*
  ([timeline.md § The order is the model's reading](../project/timeline.md#the-order-is-the-models-reading-and-the-dates-move-nothing)).
  The proposed `layout: "axis"` is the design that was rejected. Behind the one-line "`timepoint`
  field with real parse semantics" sits [`src/timeline-time.ts`](../../src/timeline-time.ts), which
  is 839 lines.
- **Ideas.** One idea has several occurrences, each with its own reasoning, and an occurrence of an
  *assumed* idea means something different from an occurrence of an *introduced* one
  ([ideas.md](../project/ideas.md)). Flat scalar fields lose that.

Sol's summary of it is the right one: a grouped list with a title, a badge and a quote is the
**silhouette** of those modes, not the modes. What makes their confident-looking output honest is the
careful handling — of uncertainty, of provenance, of emptiness — and that handling is editorial
policy, not data plus layout.

## The three approaches

### A — Lenses out of what is already built

Reframe a saved meaning-search as a named lens. Four to six good presets ("claims the author
hedges", "counterarguments the piece considers"), the free-text box still the authoring route, and
"suggest a mode" added to the Feedback dialog. No new storage, no new panel, no new schema. Reuses
the existing search endpoint, `SearchRun` storage, streaming, validation, marks and spine lanes.

Rough size: 3–9 files, 100–450 LOC, 1–3 days depending on whether it goes behind the experimental
switch.

### B — A narrow `LensDef`: a mode as data

One *new* mode that can be instantiated many times — not a replacement for the hand-built ones. A
small document: a name, an instruction, and a typed row shape whose types carry their own checks (a
quote must be verbatim in its block; a block id must resolve). One anchored-list renderer. No colour
and no pixel anywhere in the document, so the house style is the only output the system can produce —
Sketch's rule, one level up. Scored the way a scene is: share of rows anchored, verbatim rate, the
longest run of article nothing points into.

Both models converge here from opposite directions. Fable calls it `ModeDef` and wants it to eat the
built-ins; Sol calls it `LensDef` and says keep it small and leave the built-ins alone. **Sol is
right about that boundary**, and it is the single most important line in this document.

### C — Feature request → an agent builds a real mode

The Feedback extension gains "request a mode". An agent writes a plan and a PR; it goes through the
ordinary gates and ships to everyone. Latency is days, so it cannot be the authoring loop — but it is
the right promotion path, and with roughly one reader it is arguably the whole appropriate system
today.

### Rejected, by both passes

- **Generated React in the app's own bundle.** It converts "what the model returns is untrusted"
  into a falsehood, and that sentence is one of the four the whole security posture stands on —
  [security-map.md](../project/security-map.md).
- **Sandboxed generated code.** A real sandbox is compilation, CSP and origin decisions, message
  validation, CPU and memory limits, call quotas, versioning and crash handling. And if the code may
  only ask the host to draw kit components, it is an imperative DSL with a far larger attack surface
  than a declarative one.
- **Browser extensions.** They cannot see the tree or the block ids properly, cannot paint the
  spine, cannot be shared, and break on every change to the app.

## Recommendation

**If this is picked up: A first, and one thing neither pass led with.**

The strongest signal in the original observation is not "readers should build modes" — there is
roughly one reader. It is **"adding a mode costs too much"**, which is a builder problem before it is
a reader problem, and the one that pays today. So alongside A, extract the narrow seams a new mode
keeps rebuilding: anchored-occurrence validation, job lifecycle, the staleness banner, mark
resolution. That is the honest version of Fable's "make the built-ins consume the plugin API",
without the rewrite.

**Long-term best: B, kept narrow, sitting beside the hand-built modes rather than replacing them**,
with C as the graduation path — a lens that earns its keep gets handed to an agent with its
definition as the spec.

**The one idea from the dreaming pass that survives the review**: a chat turn promoted into a lens.
Nobody designs a mode cold; they notice a question they keep asking. That is the natural front door
and it is cheap.

## What would make us pick this up

Deliberately concrete, so this does not get built on enthusiasm:

- [ ] More than a handful of readers, at least one of whom is not Greg.
- [ ] Evidence from real use — the free-text meaning-search box collects it for nothing — that people
      re-ask the same question across articles, and that the answer wants **fields and a
      presentation** rather than just passages.
- [ ] Spend attribution and per-owner limits exist. [ai-gateway.md](../project/ai-gateway.md) says
      there is accounting but **no spend limit**, and a shared lens running model calls on somebody
      else's wallet becomes real with the *first* non-Greg reader, not at scale.
- [ ] An answer to mode proliferation. There are already twelve values in
      [`src/modes.ts`](../../src/modes.ts). An unlimited number of tabs is a navigation problem, not
      empowerment.

## The simpler option passed over, and why

**Building nothing at all**, which is Sol's actual verdict and is close to what this status records.
It is not quite chosen, because A is cheap, reuses machinery that already exists, and is the thing
that *generates the evidence* the rest of the decision needs. Everything past A waits.

**The universal `ModeDef` that eats the built-ins** was passed over for the reason set out above: it
would cost a large rewrite, and the readers' side of the ledger is worse, not better — exact
empty-state behaviour lost, controls that do not fit generic slots dropped, provenance flattened into
a badge.

## Stages

None. Nothing is scheduled. If A is taken up it should get its own plan, because its shape is a
question about Search rather than about modes.

## Other things worth keeping from the two passes

From Fable, beyond the chat-turn promotion above: modes the *article* proposes during the pipeline
(a Dramatis Personae for the profile, an Experiments table for the paper); lens composition, where
one lens's rows are another's scope; library-wide scope, which the chat tools already believe in via
`search_library`; and "read it the way she did" — a friend's reading, their marks and their rows,
rendered beside the same piece.

From Sol, the traps that are easy to walk into later: a fixture row proves one row still parses, not
that a prompt generalises across genres — the real fixture is a corpus with expected omissions; a
definition authored and judged on the article that provoked it is being overfitted by construction;
cross-reader cache reuse is wrong by default, because
[a cache hit is itself a disclosure](../../src/db/schema.ts) and reuse must be scoped by owner,
article revision, definition version, prompt version, model and profile; and gallery metrics like
"kept in the bar after a week" drift uncomfortably close to the engagement mechanics
[vision.md § Anti-goals](../project/vision.md#anti-goals) rules out.

## References

- [260831am-reader-authored-modes-generative-ui-fable-ideas.md](260831am-reader-authored-modes-generative-ui-fable-ideas.md) —
  the dreaming pass in full: five architectures, the `ModeDef` schema, the `ModeContext` capability
  API, the component kit, the scoring, the wilder ideas.
- [260831am-reader-authored-modes-generative-ui-review-sol.md](260831am-reader-authored-modes-generative-ui-review-sol.md) — the
  devil's advocate pass, with the code citations behind every objection.
- [search.md](../project/search.md) — the mode that is already most of this. Two matchers, one box,
  saved runs, several at once, one hue and one spine lane each.
- [diagram.md § The fourth: Sketch](../project/diagram.md#the-fourth-sketch) and
  [`src/sketch-scene.ts`](../../src/sketch-scene.ts) — the precedent the whole idea rests on: the
  model chooses the arrangement, never the markup, and numbers can be checked.
- [quotes.md](../project/quotes.md), [timeline.md](../project/timeline.md),
  [ideas.md](../project/ideas.md) — the three modes the DSL claimed to subsume, and the three places
  it does not.
- [260831aj-feedback-button-and-bug-reports-to-sentry.md](260831aj-feedback-button-and-bug-reports-to-sentry.md)
  — the Feedback work approach C would extend.
- [experimental-features.md](../project/experimental-features.md) — where any of this would live
  first.
- [ai-gateway.md](../project/ai-gateway.md) — the spend accounting, and the limit that does not exist.
- [vision.md § Simpler first](../project/vision.md#simpler-first) — the rule this status is an
  application of.
