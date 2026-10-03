# Summary and Structure skip the front matter: the title, the abstract, the references

For a suggestion from Greg (admin; `scripts/feedback-reporter.ts` exited 0), report `spya-abs6bj`,
Overseer queue item `qi-ta8cqa26`, sent from Summary on a PMC paper
(`pmc13013618-spya-uekgh6`, `mode=summary … depth=2`):

> Make a minor tweak to the prompt for generating the summary mode to sort of skip or be very
> minimal for kind of non-content sections like, I don't know, title or abstract or references or
> acknowledgments. Like, I think maybe they don't need a summary at all, or maybe it's just very
> brief because we want the summary text to focus on kind of substantive content.
>
> — Greg, 2026-09-30

A prompt change, so [prompting-guide.md](../project/prompting-guide.md) governs, including
§ Measuring a prompt change.

## What has already happened since he wrote it

- **Summary is no longer the outline he was looking at.** On 2026-09-30, `depth=2` meant Summary
  showed one gist per part and section of the tree. Since 2026-10-01 those gists are only in
  Structure, and Summary is three whole-piece levels, Brief, Simple and Fuller
  ([261001p-summary-loses-parts-and-sections-a-touch-wider.md](261001p-summary-loses-parts-and-sections-a-touch-wider.md)).
  So his "summary of each section" is today **Structure's node gists**. The "summary text" of today
  is the three levels.
- **Acknowledgements are done.** [261001p](261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md)
  added the shared paperwork rule, `src/paperwork.ts`, to Summary, Tweets and both structure-step
  prompts, after a sibling report (`spya-k930hy`). It covers authors, affiliations,
  acknowledgements, funding and disclosures.

## What the reader gets now

The saved outputs of 261001p's `after-2` arm (`evals/results/paperwork/after-2/`, `toc/10`, on
local papers; the production article was not read) show Structure:

- **The title and references already come out as labels**, though the rule does not name them.
  Examples: *"Title and Authors :: The title, authors, and their institutional affiliation."* and
  *"References :: The list of works cited in the article."*, and on scaling-hypothesis
  *"Bibliography :: The bibliography of sources cited in this article."*. The model is
  generalising from the list. Naming them makes that a rule rather than luck.
- **The abstract gets a full content gist, and a question when it is a part.** On
  analog-cognition, depth 1: *"Abstract :: Cognition and consciousness emerge from interacting brain
  waves and neuron spikes, with waves providing flexible, analog top-down control."* plus a
  question. The root gist directly above it says nearly the same thing (*"Brain waves, not synapses
  alone, organize neuron activity…"*). On entropy-24, a depth-1 *"Abstract and Framing"* node does
  the same, with a question. On scaling-hypothesis, a depth-2 *"Abstract"* leaf restates its
  sibling. So the abstract is what is left of Greg's list, and it is the one item that really is
  content. It is the author's own summary of the piece, which the root gist and the parts already
  carry.

The whole-piece Summary rests about one paragraph in four on the abstract, at every level, in
both `before` arms. That is a fair use of the author's own summary, not a defect Greg reported,
so v1 leaves it alone (§ Deferred).

## The change (v1, prompts only)

### 1. The shared list names the front matter and the back matter — `src/paperwork.ts`

The paperwork list gains **the title block** (title, subtitle, byline, dates, DOI, keywords, the
journal's running header) and **the reference list or bibliography**, with backlinks and
related-links lists. Nothing else changes in the list, and "judge it by what it does" stays. A piece
whose argument is its citations, such as a review that reasons about its sources, is still content
where its prose does that; the list of references itself is not.

### 2. A paragraph for the abstract, in Structure only — still `src/paperwork.ts`

The abstract is not paperwork, so it is not added to the list. `paperwork("structure")` gains one
paragraph after the list; `paperwork("summary")` gains nothing, because a whole-piece summary may
use what the abstract claims.

- **A genuine abstract at the start of a paper**: the root and the parts already say what it says.
  A node whose range is only the abstract, or only the abstract and paperwork, gets the paperwork
  node's treatment: a short plain label of what it is (*"The authors' summary of the paper."*), no
  claim, no word floor, and no question.
- **A front summary or key-points box only by role** (Sol, P1-4): it gets the same treatment only
  where the body goes on to make each of its claims. An executive summary or a chapter preview
  that says something the body does not is content, and labelling it would lose that claim at the
  coarse zoom.
- **A closing "Summary" or "Conclusions" section is the body.** `8. Summary` on entropy-24 tests
  that.
- **"Leave `question` empty", not "send none"** (Sol, P1-1). The whole-document schema requires a
  depth-1 `question` (`src/structure.ts` § `depth1Schema`), so a model told to send none must write
  something. `questionFor` reads an empty string as no question, and that is how the existing
  paperwork nodes at depth 1 already come out without one. So the wording says what the schema
  allows, and the schema is unchanged.

**Greg offered two options, and this takes "no summary at all" for Structure.** His other was "very
brief". For the abstract node, a one-line gist is a third copy of what the root and the parts say.
A label also shows where the abstract is, which a reader skimming the tree wants to know. The
fallback, if the blind read finds the label loses something, is one short sentence of its main
claim.

### 3. Version stamps

`toc/11` → `toc/12`, `expand/7` → `expand/8`, `simple-prompt/5` → `simple-prompt/6`, and `tweets/7` →
`tweets/8`, because the shared list reaches all four. Their effects differ (Sol, P1-2):

- **Structure trees stay current.** The stored tree records only its input hash
  (`src/pipeline.ts`), so `toc/12` and `expand/8` reach new articles, explicit regenerations and
  checkpoint identity, and nothing is marked outdated.
- **Summaries and threads go outdated for their owner.** `simple-prompt/6` is compared by the
  pipeline and by the owner's read (`src/store/pg.ts`), and Tweets shows as not current in
  Metadata. The change to them is only the two new list entries.

### Simpler options passed over

- **Strip the front and back matter before any model sees it.** This is deterministic, and it is
  already deferred in 261001p § Deferred. It needs a reliable detector of what counts as an
  abstract across PDF, PMC and HTML, and Structure must still tile every block. That is a stage-2
  job, not a prompt tweak.
- **Only name title and references.** It codifies what the model already does, so it changes
  almost nothing the reader sees. The abstract is the part of Greg's ask that is actually unmet.

## Measuring it

The harness is `evals/paperwork/run.ts`, extended with a `--set front-matter` results folder
(`evals/results/front-matter/`) so 261001p's arms stay untouched. It runs on four local papers that
have an abstract and a reference list: analog-cognition, entropy-24, scaling-hypothesis, and
s41598-023-33209-9 (Scientific Reports, the shape nearest Greg's PMC paper).

- **Arms:** `before`, `before-2` (the control) on the commit before the change; `after`, `after-2`
  on the commit with it. All at `power: "standard"`, all production's own functions.
- **The Structure screen is by position, not title** (Sol, P2-1). Each paper's abstract is
  hand-marked in the harness as a block range, from its first block to the last block before the
  body. A node is **abstract-only** when it ends inside that range, so a node that runs on into
  the body is not counted, whatever it is called. scaling-hypothesis's "Abstract" node runs into
  the opening blockquote and is rightly not counted.
- **The `before` baseline**, per arm, `before` / `before-2`:
  - abstract-only nodes with a content gist: 4 / 4;
  - abstract-only nodes with a question: 2 / 2 (analog-cognition's and s41598's depth-1
    "Abstract");
  - Summary paragraphs resting on the abstract: about one in four at every level.
- **Also screened:** Brief's word count, so 261002h is not undone, and the Summary's
  abstract-id share, for information only.
- **A blind read.** Pairs `before`/`after` and `before-2`/`after-2`, and the control
  `before`/`before-2`. Three Opus judges in fresh subagents read only the pairs file. Per pair:
  (a) which spends less on the title, abstract, references and other paperwork; (b) which keeps
  the reader on the piece's substance; (c) did either lose, bend or invent a claim. The judges are
  Opus, the same family as the generator, so this is weaker than a cross-family read, and the
  write-up says so.
- **Ship rule:**
  - both `after` arms have **no question** on an abstract-only node (against 2 and 2);
  - at most **one** abstract-only node with a content gist (against 4 and 4);
  - the judges' Structure wins on (a) exceed the control's split;
  - (c) is no worse;
  - `8. Summary` on entropy-24 keeps a content gist;
  - Brief's mean word count is not above `before`'s.
- **Not measured:** `expand/8`, because the harness calls only the whole-document request, and a
  front executive-summary or key-points box, because the corpus has none. Both are caveats in the
  write-up.

## GPT Sol's plan review

`261003c-…-plan-review-sol.md`: no P0. Four P1s and three P2s, taken as follows. The schema
contradiction and the false `outdated` claim are fixed above. The ship rule is now numeric, and
by position. The summary and key-points box is now judged by role. The Summary/Tweets
"ids go to the body" rule was dropped (P2-2, P2-3): Greg did not ask for it, and it would have
overridden the "best support" rule. A node-title screen was replaced with a position one. A
no-heading abstract is in the corpus already (entropy-24's *"Abstract: …"* paragraph); an
executive-summary case is not, and is said as a caveat rather than built.

## Deferred

- **The deterministic strip**, as above.
- **Summary links into the abstract.** About one paragraph in four rests on it. Moving those
  links to the body passage would be a separate change, with its own measurement of dropped
  paragraphs and of Tweets' links.
- **Reaching Greg's own article.** The production article was not read in this session. Its
  Structure tree stays as it is until its owner regenerates it.
