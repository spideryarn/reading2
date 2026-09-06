# Review: a per-depth length ceiling on the summary gists

Review a prompt change, adversarially, before it lands. Repository: Spideryarn, a reading app.
TypeScript, one model call per pipeline stage. I want the flaw, not encouragement.

## The request

The owner, Greg, after using it:

> I sometimes wish the language was slightly simpler. And the coarser top-level summary should be
> briefer, and the more granular-level summaries be a bit longer.

## The defect, measured before anything changed

A `gist` is one sentence attached to every internal node of an article's tree. The reader sees the
root's gist on the shelf card and at the coarsest zoom, and deeper gists as they zoom in — at a fine
zoom the gist is read *instead of* the paragraphs it covers.

Across every published tree on the local database — 38 articles, 1,239 internal nodes:

| depth | nodes | mean words | min | max |
|---|---|---|---|---|
| 0 (root) | 38 | 28.8 | 17 | 53 |
| 1 | 247 | 23.1 | 11 | 47 |
| 2 | 852 | 20.1 | 4 | 58 |
| 3 | 102 | 14.9 | 8 | 28 |

Monotonically the opposite of what was asked for. The diagnosis: `GISTS` said *"Exactly ONE
sentence"* and said it at every depth. A root sentence has a whole article to cover, so it grows
clauses; a depth-3 sentence covers two paragraphs and does not.

**A previous attempt failed and is instructive.** A variant was written to fix the root specifically,
and deliberately gave root brevity *"a mechanism rather than a word count"* — it forbade the
stringing-together of clauses ("X stems from A and B, so we should C while reaffirming D") rather
than counting words. Measured over seven documents against the incumbent, it made the root **longer**
(25.1 words against 22.9), on five of the seven. Its one clear win was the single article the rule was
written against.

## The change

In `src/hierarchy.ts` § `GISTS (internal nodes)`, and mirrored in `src/hierarchy-expand.ts`
§ `TITLES AND GISTS` (the deepening cascade, which writes the fine gists):

- **A ceiling per depth**, framed to the model as running against intuition: root **≤18 words**,
  depth 1 **≤25**, deeper **22–32 "and use them"**, with the reason given — a fine gist is read
  instead of the paragraphs under it and can afford a subordinate clause the root cannot.
- **A ban on meta-narration** ("the essay opens by", "this section explores", "the author then turns
  to", "then", "next", "goes on to"). `docs/project/granularity-zoom.md` has listed this as a rule
  for some time and the prompt did not contain it.
- **"Where a shorter, commoner word loses nothing, use it"**, for the simpler-language half.

`PROMPT_VERSION` → `toc/6`, `EXPAND_PROMPT_VERSION` → `expand/3`.

## The measurement after the change

Two arms over four documents at depth 2, Sonnet 5, no judge. `gists-toc5` carries the block as it
stood; `gists-toc6` carries the new one, copied character-for-character from the live `SYSTEM` and
asserted equal in a test. (The harness's own `incumbent` arm slices the live `SYSTEM`, so once the
source changed it became the *after* — hence a separately pinned *before*.)

| arm | depth | budget | nodes | mean | max | over | under 22 |
|---|---|---|---|---|---|---|---|
| stored (the live database) | 0 | ≤18 | 3 | 35.7 | 49 | 3 | — |
| stored | 1 | ≤25 | 31 | 24.9 | 38 | 15 | — |
| stored | 2 | 22–32 | 134 | 22.6 | 39 | 9 | 54 (40%) |
| gists-toc5 | 0 | ≤18 | 3 | 25.3 | 35 | 3 | — |
| gists-toc5 | 1 | ≤25 | 31 | 22.1 | 33 | 7 | — |
| gists-toc5 | 2 | 22–32 | 134 | 20.9 | 34 | 1 | 68 (51%) |
| **gists-toc6** | 0 | ≤18 | 3 | **19.7** | 23 | 2 | — |
| **gists-toc6** | 1 | ≤25 | 31 | **20.0** | 27 | 3 | — |
| **gists-toc6** | 2 | 22–32 | 134 | **21.0** | 31 | 0 | **63 (47%)** |

Three findings:

1. **The inversion is fixed.** 19.7 / 20.0 / 21.0 against the stored trees' 35.7 / 24.9 / 22.6.
2. **The root ceiling is overshot by ~2 words** and I am accepting that rather than tightening to 16.
3. **The depth-2 half did nothing**: 20.9 → 21.0, and 63 of 134 gists still under 22. The reason,
   which I think is the real lesson: *a ceiling the model can satisfy by writing less is not a floor.*
   "22-32 words, and use them" reads as an upper bound with scenery.

**So the depth-2 rule was rewritten before this review**, to state the floor as a floor:

```
    - deeper than that: AT LEAST 22 words, and at most 32. The floor is the
      half that will feel wrong, so obey it: down here a one-clause gist is too
      SHORT, not admirably terse. A reader at this zoom is reading your sentence
      INSTEAD of the paragraphs it covers, so give them the claim AND the ground
      it stands on. If 22 words cannot be filled honestly, the section was too
      slight to be its own node.
```

A re-measurement of that rewrite is running; treat the depth-2 number above as the *pre-rewrite*
state.

**Token cost.** Mean gist characters per node: stored 163 → toc/5 146 → toc/6 149, i.e. +0.8
estimator tokens per node and fourteen characters *below* what is already stored. Worst-document
per-node reconstruction is 0.93× the stored trees, ≈135 on the 145 scale. Caveat stated rather than
buried: the reconstruction reads 90.8 where the documented figure is 145, because that figure came
off a real call's answer tokens — the absolute numbers are ~1.6× apart and only ratios transfer.

**Cache floor.** `EXPAND_SYSTEM` went 893 → 1,022 → 1,058 estimated tokens against a
`CACHE_FLOOR_TOKENS` of 1,024, so the expansion prefix went from never cacheable to always cacheable
with thirty tokens of daylight.

## What I want from you

1. **Attack the numbers themselves.** 18 / 25 / 22–32 were chosen by reading the before-distribution
   and Greg's sentence, not derived. Is the root ceiling too aggressive — the mean was 28.8 and the
   minimum observed was 17, so ≤18 puts almost every root at the floor of the current range? Is there
   a real risk that a root gist under 18 words stops being a *claim* and becomes a topic label, which
   is the failure the same block forbids two lines earlier?
2. **Attack the framing.** Telling a model "length runs the opposite way to what you would expect" is
   an instruction about its own priors. Does that help, or is it the kind of line that gets
   paraphrased into the output? Would a bare table of ceilings do better?
3. **The interaction I am most worried about.** The root gist is also fed back as context into the
   later structure waves (`chainRung`, `src/hierarchy-expand.ts`) and is shown in about ten places.
   Does making it much shorter degrade the *structure* the cascade proposes, and is there anything in
   the code that would show that if it happened?
4. **The token headroom.** `TOKENS_PER_NODE` is 175 against a worst-observed per-node cost of 145,
   re-measured 2026-09-04. 852 of the 1,239 nodes are at the depth being lengthened. Is the cushion
   enough, and what is the failure if it is not?
5. **One incidental finding, please sanity-check it.** Lengthening `EXPAND_SYSTEM` took it from 893
   to 1,058 estimated tokens against a `CACHE_FLOOR_TOKENS` of 1,024, so the expansion prefix went
   from never cacheable to always cacheable. A test that used to pin the boundary by padding an
   outline to either side of it can no longer do so — the padding length went negative — and there
   is no honest fixture for the `false` branch, because every caller's prefix contains
   `EXPAND_SYSTEM`. I have replaced it with a pin on the *margin*. Is that the right call, or is
   there a fixture I am not seeing?
6. **The floor itself, which is the newest and least tested thing here.** A minimum word count is a
   blunt instrument: it can be satisfied by padding, and a word count cannot tell padding from
   substance. Is *"give them the claim AND the ground it stands on"* enough of a place to put the
   words, or does a floor of 22 invite exactly the empty subordinate clause the meta-narration ban
   is trying to remove? Is the escape hatch — *"if 22 words cannot be filled honestly, the section
   was too slight to be its own node"* — a good idea or a dangerous one, given that the same model
   call is also choosing the sections?
7. **What would you measure that I have not?**

Lead with the single most serious problem. If the change is right, say so plainly and spend the
effort on questions 1 and 6, which are where I am least sure.
