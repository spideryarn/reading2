# An executive summary, and the other summaries at the front, fold like the abstract

Report `spya-hnw9xq` (#698, Greg, admin, 2026-10-24), on the Consciousness in AI report
(`arxiv-2308-08708-spya-xax6v4`):

> Now, firstly, actually, I think probably the executive summary in the abstract should be default
> folded, and I think we now have mechanisms, if we were to rerun this import, that would notice
> them and default fold them, because we have our own summary and structure modes that do a lot of
> this kind of work that we'd rather use.

Asked as [q-r8kumx](../user-feedback/questions/q-r8kumx.md); Greg answered on 2026-10-25
(`spya-p6gmn7`): **"B"** — fold the executive summary, and the other summaries an author puts at the
front too: *Key points*, *Highlights*, *Significance*, *Author summary*. It stays a row in
Structure, one press opens it, and the stub says which kind it is.

This overturns one line of
[261018a § Decided here, for Greg to overturn](261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md#decided-here-for-greg-to-overturn):
*"Appendices, glossaries, notes and executive summaries are not folded."* Appendices, glossaries
and notes still are not.

## What is there now

The `matter` step ([front-and-back-matter.md](../project/front-and-back-matter.md)) has two
sources, unioned and held by the same checks: a free label rule (`src/matter-labels.ts`) and one
Haiku call (`src/matter.ts`). The prompt tells the model a *Significance* or *Key points* box and an
executive summary are **not** matter; the label rule's `LABELS` has none of them; the linked-contents
rule vetoes a run under one of those labels.

In the local corpus (52 articles, the 261018b eval) three are real front summaries:

| article | label | where | extent |
|---|---|---|---|
| arXiv 2308.08708 (the reported one) | *Executive Summary*, a 2-word **paragraph** | block 39 of 667, opening window ends at 53; no heading before it | 40–53, ~1,180 words, ends at the *Contents* heading |
| NIST AI 100-1 | *Executive Summary*, `h1` | block 46 of 306, opening ends at 65; only `h2`s and labels before it | 47–60, ~1,200 words, ends at `h1` *Part 1* |
| PMC 5828643 (Europe PMC) | *Significance*, `h2` | block 1 of 130 | 2 (122 words), then a *Keywords:* line, then `h2` *Abstract* |

No *Key points*, *Highlights* or *Author summary* is in the corpus (the sites that print them —
JAMA, Elsevier, Cell, PLOS Comp Bio, PNAS — were missing or refused the fetch). So the eval can show
this adds no prose folds elsewhere and finds these three; it cannot show recall on the other labels.
Stage 3 adds a small free check on live pages for those.

## The change

**A new kind, `summary`, found by the label rule alone.** One kind, as the question said; the stub
says which one from the label (below).

- **Labels, closed, matched on the whole text** (normalised as `normaliseLabel` does, a section
  number allowed in front): *executive summary*, *key points*, *highlights*, *research highlights*,
  *significance*, *significance statement*, *author summary*. Not *Summary*, *TL;DR*, *In brief* or
  *Key findings*: *Summary* is as often a body section (four in the corpus, all deep in the piece:
  *8. Summary*, *7 Summary*, *2.5 Summary*), and the others were not in Greg's list. A heading or a
  short paragraph of only the label, as the existing rule takes *Abstract*.
- **Where it may sit — the false positive Greg named.** *"A body section titled Key points or
  Highlights deep in the piece is not front matter."* Two conditions, both:
  1. the label is **inside the opening window** (`matterWindows`: at most 40% of the blocks, 120
     blocks, 6,000 characters) — stricter than the quarter-of-the-article allowance the other front
     kinds get;
  2. **nothing of the article's own outranks it before it**: no heading before the label at its own
     level or higher, other than the title repeated and a known label (*Contents*, *Abstract*, …).
     A paragraph label ranks below every heading, so for it: no such heading before it at all. A
     *Highlights* `h3` under *Results* `h2`, or a *Key points* `h2` after an *Introduction* `h2`,
     fails; NIST's `h1` after only `h2`s and labels passes.
- **How far it runs.**
  - Under a heading: its section (`sectionRanges`, to the next heading at its level or above).
    Sub-headings deeper than it are part of it.
  - Under a paragraph label: the blocks after it, up to the first heading, the next label of any
    kind (a known label, a summary label, a block opening *Abstract* or *Keywords*), or a short line
    that reads as a numbered section title extracted as text (*"1 Introduction"*).
  - Either way it **also stops at an *Abstract* or *Keywords* line** (Europe PMC's *Keywords:* inside
    the *Significance* section stays its own).
  - **Whole or not at all**: over `MAX_RANGE_WORDS` (1,500) and it is not folded, rather than cut,
    because a summary folded halfway reads as two different things. Both corpus executive summaries
    are about 1,200.
- **Its evidence** (`stretchEvidence`): a `summary` stretch must start at a summary label and lie
  within that label's extent above. Prose is allowed inside it — that is what a summary is — so the
  label, the position and the extent are the evidence, not the words. Footnotes still refuse.
- **Everything else still holds it**: the half-the-article-showing floor, no overlap, the one-short-block
  rule, the masthead echo.
- **Its own stub, like the abstract**: `combineMatter` never joins a summary segment to a segment
  that is not one (as it does now for the abstract), so a one-line *Keywords* beside it is not
  swallowed into a stub that says *Significance*.

**The model is not told about it, and its request does not change.** The kind goes into
`MATTER_KINDS` (and `MatterKindName`, `MATTER_KIND_NAMES`) for storage, but the request's schema
enum is the model's kinds, without `summary`, and `parseMatterAnswer` refuses `summary` from the
model. The system prompt still says these boxes are not matter, which is now *"not yours to
mark"*: the label rule owns them, and a model that claimed one would have nothing but its guess to
go on. So the request is byte-identical, every cached eval answer still hits, and this is **not a
prompt change** (prompting-guide.md's measurement is not triggered). Passed over: teaching the
model the kind, which would let it find an unlabelled executive summary, at the price of a prompt
change, a re-measure, and a judgement call on prose with no label — the very thing the checks exist
to refuse.

**The stub says which kind.** `stubLabel` names the kind from the label of the stretch's first
block, through a closed map in a leaf module both sides import (`src/matter-summary.ts`):
*Executive summary*, *Key points*, *Highlights*, *Research highlights*, *Significance*,
*Significance statement*, *Author summary*; *Summary* if the first block is somehow not one of them.
Still never the article's or a model's words: the article's text only selects one of ours. The count
is words, as the abstract's is. The ⓘ line: *"The authors' own summary of the piece, which Summary
and Structure also cover."*

**The version moves to `matter/4`; `matter/3` and `matter/2` stay readable.** It only adds a source,
so an older stored value's folds stay sound (`MATTER_READABLE_VERSIONS`'s rule), and the bump makes
*Read this again* re-run the step. **No backfill** (q-f7zp3t, 1A, stands): the reported article
folds its executive summary only when re-imported.

**Passed over: five kinds** (*executive-summary*, *key-points*, …). It would keep the label on the
server, but five entries in four closed lists, the schema split and the eval's kind table for one
behaviour; one kind plus a label map is fewer parts, and the map is read where the stub is drawn.

## The gold changes too

The eval's gold marks these three as not matter, because that was the rule. Greg's answer changes
the definition, so the gold for those three articles gains a `summary` stretch over the label and its
extent (a copy of the gold directory; the original stays as the before). Every other gold label is
unchanged.

## Stages

1. **This plan**, GPT Sol plan review (read-only), the before arms of the eval (done: 0/0 prose
   folded on all three sets, as 261024h left it).
2. **Build**: the kind in the four lists; `src/matter-summary.ts` (labels, display names);
   `summaryRuns` in the label rule, with the placement and extent above; the evidence branch;
   `combineMatter`'s own-stub rule; the model's schema and parser without the kind; the stub label,
   count and ⓘ; `matter/4`. Red-first tests: the three corpus shapes fold; negatives — a *Key points*
   `h2` after *Introduction*, a *Highlights* `h3` under *Results*, a label past the opening window,
   a paragraph label after a non-label heading, a *Summary* heading, a summary over the cap, a
   *Significance* followed by a *Keywords:* line; the request unchanged by the kind (a test on the
   schema enum); a model answer claiming `summary` refused. Each guard removed in turn turns a test
   red.
3. **Measure**: the eval on all three sets after, with the old gold and the new; a free check on a
   few live pages that print *Key points*, *Highlights*, *Author summary* or *Significance*, fetched
   and run through extraction, blocks and `matterByLabels` locally (nothing stored); the reported
   article's local copy through the step.
4. **Docs, review, land**: front-and-back-matter.md (the *never folded* line, the kinds, the
   stub labels), 261018a's decided line marked overturned with a link here, the eval investigation's
   addendum; GPT Sol code review (it fixes inside the stage); gates; push to `dev`; the bookkeeping.

## The plan review, and what building changed

GPT Sol on the plan
([review](261025f-an-executive-summary-and-the-other-front-summaries-fold-like-the-abstract-plan-review-sol.md)),
seven findings, all real; each is now a test that goes red without its fix.

1. **Inverted levels** (an *Introduction* `h2`, then *Key points* `h1`) passed the rank rule. Its
   simpler fix, *no earlier heading at all*, would miss NIST, whose *Update Schedule and Versions*
   `h2` is not a label. Kept the rank rule and added (2).
2. **Unheaded prose before a paragraph label.** A second guard: at most
   `SUMMARY_PROSE_BEFORE_MAX_WORDS` of the article's own prose before the label, counting long text
   blocks with none of the cheap matter evidence, outside an abstract or an earlier summary. Set
   at 300, not the first draft's 150, because NIST has 208 (a disclaimer and a note on its update
   schedule).
3. **A coarse summary heading swallowing body sections.** A sub-heading inside the section that is
   not a structured summary's part refuses the fold, rather than folding it halfway or with the body.
   The live check then found PLOS Medicine's *Author summary* is all question sub-headings over
   bullets (*Why was this study done?*), so a question with only list items under it is a part too.
4. **Loose stops.** Now: a whole label, an *Abstract*/*Keywords*/*Index terms* line, a short
   inline label that is not a summary's own part (*Citation:*, *Received:*, *Funding:*, which PLOS
   prints inside its *Author summary* section), or a bare *Introduction*. A numbered point no
   longer stops it.
5. **The model's contents claim splitting a summary.** In the union a summary keeps its blocks.
6. **Two summaries back to back** joined into one stub named for the first. They no longer join.
7. **The request test**: a summary heading between the windows is not given a label's priority,
   and the eval's 165 cache hits show the request unchanged.

Found while building, not in the review:

- **A summary that is a list ends at its last item.** The old linked-contents tests had a *Key
  points* list followed by an unheaded introduction, which the first draft folded with it. The rule
  reads whether a block is a list item from its stored markup, so that bit joined
  `matterInputHash` (`m3`); `matter/3` values keep their `m2` hash and stay readable.
- **A heading with no words under it** (PLOS's *Figures* strip) is not the article's own.
- The acknowledgements label's run needed no stop at a summary label: its shrink-to-evidence loop
  already stops there, and a guard no test can turn red was taken out.

## Not in scope

- An unlabelled executive summary (the model would have to judge prose).
- *Summary*, *TL;DR*, *In brief*, *Key findings*, eLife's *digest*: not in Greg's list; a line in the
  note offers them.
- Taking folded summaries out of what Summary or other modes read (queue `qi-2byhh6nc`, as for all
  matter).
- Re-importing the reported article (a production write; Greg's no-backfill answer).
