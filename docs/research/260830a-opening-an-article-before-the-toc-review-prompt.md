# Review request: opening an article before the ToC has been built

You are reviewing a **research doc, before any plan is written**, in the Spideryarn repo (an
AI-assisted reading app). You have read-only access to the working tree — **please read the files
rather than trusting my summaries of them.** Where I quote a docstring, check I have not quoted it
selectively, and where I cite a line number, check it says what I claim.

**The doc is `docs/research/260830a-opening-an-article-before-the-toc.md`.** Read it in full first.

## Background

The ingest pipeline is stages 1–6, in `src/pipeline.ts`. `DEFAULT_INGEST_STEPS` is currently
`["fetch", "extract", "blocks", "toc", "assets"]` — `arc` was taken out on 2026-08-29
(`docs/plans/260829f-defer-arc-and-rename-hierarchy.md`), which is the immediately preceding piece of work
and worth skimming for the machinery it left behind.

Greg's ask, verbatim (2026-08-30):

> Now let's talk about how to make the ToC build as an optional step outside the pipeline when the
> user chooses that mode.

and, replying to three options I put to him:

> 1 Yes, or even an empty tree?
> 2 This sounds promising.
> 3 Could we use NDJSON instead of JSON? Would that help with displaying while streaming?

Nothing is decided. This doc is meant to become a plan after your review, and Greg will choose the
order. **Please do not write the plan** — review the research.

## The claims I most want checked

These are load-bearing. If one is wrong the priority order changes.

1. **"An empty tree — root and nothing else — is rejected by `checkTree`."** I rest this on
   `src/tree-invariants.ts:149` deciding leaf-vs-internal by `children.length === 0`, so a childless
   root is a leaf and must span exactly one block, plus the every-block-covered check. Is that right?
   And is the smallest *valid* tree really root + one leaf per block?

2. **"A placeholder tree fails the internal-node gist rule, and the fix must be an explicit marker,
   not an absence."** I am arguing from the `treatment` precedent in the same file
   ("Never infer the role from a missing gist"). Do you agree that is the right analogy? Is a
   tree-level flag or a node-level `treatment` the better shape, and is there a third option I have
   missed — e.g. letting the root's gist come from `meta.excerpt`, which would make the flat tree
   valid with no schema change at all? What breaks if we do that?

3. **"A flat tree makes `buildOutline` return one blank spine band per paragraph."** From
   `src/web/tree.ts:402` returning `root.children`, and leaves having no title/gist/navLabel. Check
   this — it is the main reason I argue against the empty tree, and if I have it wrong the empty
   tree gets much cheaper.

4. **The NDJSON arithmetic.** From `data/_ai-calls.jsonl`: two structure calls, 163.1s with 18,369
   output tokens of which 13,716 reasoning, and 320.4s with 34,175 of which 28,800. I take
   `reasoning_tokens` to be a **subset** of output tokens because it arrives inside
   `completion_tokens_details` (`src/ai-call.ts:287`) — please confirm that reading, since the whole
   conclusion inverts if it is additive. I then assume an even token rate to get "first JSON at
   ~75–84% of the call". How wrong is that assumption likely to be for an Anthropic model with
   adaptive thinking via OpenRouter, and is there a better way to estimate it without burning a call?

5. **The three NDJSON objections in § 4** — that validation cannot go early, that a partial tree is
   always a `checkTree` failure, and that truncation stops being loud. Are these right, and is there
   a fourth I have missed? In particular: is asking the structure model for flat NDJSON with explicit
   parent pointers a real quality risk versus nested JSON, or am I over-weighting that?

6. **The five "no tree" gates in § 1**, especially my claim that `loadArticle` falling through to
   `example/` would serve a reader the fixture's prose. Check `candidateDirs` and the fixture
   fallback. Have I missed a gate, or named one that is not really one?

## Also worth your view

7. **The priority order in § 6** — A (split the toc step) before B (heading tree) before C (NDJSON).
   Ease × value. Would you order them differently? Is there a fourth option none of us has named?

8. **Question 2 in § 7**: while a tree is provisional, should `arc`/`ideas`/`glossary`/`summary` be
   refused outright, or allowed and stamped stale? Refusing is simpler; allowing means a reader who
   asks for a glossary in the first two minutes gets one. Check `src/jobs.ts` and `src/pipeline.ts`
   for whether refusing is even expressible today.

9. **What would you measure before building any of this?** § 7 question 3 is the one I think matters
   most — how many real articles have usable headings — and nobody has counted. Is there something
   cheaper that would change the plan more.

10. Anything in the doc that is simply wrong, or any risk I have not named. Be specific about which
    findings you read the code for and which you inferred; I will verify each one myself.
