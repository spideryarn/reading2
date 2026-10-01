# Summaries skip the paperwork and lead with the takeaway, and Brief gets shorter

For two suggestions from Greg (admin; `scripts/feedback-reporter.ts` exited 0 on both), both sent
from `jco-2005-01-libre-spya-hk9cc7`, a 2005 *Journal of Clinical Oncology* paper on tamoxifen
resistance:

> The structure, summary, tweet thread, and other such modes don't really need to include summaries
> of stuff like acknowledgements or conflicts of interest or affiliations or, you know, stuff like
> that that isn't really the content of the paper. The prompt should kind of say, yeah, we don't
> really need to emphasize that or include those in the summaries or tweet threads. And I guess
> perhaps the prompt could slightly more emphasize, like, what is the news you can use? What is the
> takeaway, you know, the conclusion from the paper?
>
> — Greg, 2026-10-01, [SPIDERYARN-READING2-8M](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8M)

> In Summary mode, tweak the prompt for the Brief sub-mode to produce slightly shorter output.
>
> — Greg, 2026-10-01, [SPIDERYARN-READING2-8F](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8F)

Queue entry `qi-nyxxcrcp`. Both are prompt changes, so
[prompting-guide.md](../project/prompting-guide.md) governs, including § Measuring a prompt change.

## What the reader actually got

Read from production, read-only, on the article's current revision:

- **Summary › Brief: 186 words in three dense paragraphs.** The prompt asks for *about 100 words,
  and never more than 150*. So it is not only that Greg wants it shorter: it is already a third
  over its own ceiling, which is the drift the comment above `PITCH` in `src/simple-summary.ts`
  measured (*"the model runs about a third over a total it is given"*). It leads with what the
  paper is and ends on its findings; the conclusion (*the wiring can shift, so target the
  crosstalk*) is not in it at all.
- **Tweets: post 1 lists all nine authors** (*"This paper, by Gutierrez, Detre, Johnston, Mohsin,
  Shou, Allred, Schiff, Osborne and Dowsett, asks…"*). The cause is ours: the user prompt says
  *"Written by ${byline}. Refer to them by surname."* and the byline is nine names. **The last post
  is the conflicts of interest** (*"some authors disclose consulting, honoraria, or research
  funding ties to AstraZeneca"*), because THE LAST POST asks for what the piece leaves open, and
  a disclosure reads to the model as a caveat.
- **Structure: two depth-1 parts are paperwork, gisted as content.** *"This paper identifies its
  authors, institutions, and title…"* with a child *"The authors are affiliated with Baylor College
  of Medicine in Houston and the Royal Marsden Hospital in London."*, and *"Several authors
  disclose financial ties, including consulting, honoraria, and research funding relationships
  with AstraZeneca."* The tree has to cover those blocks (every block is tiled by exactly one
  leaf, `src/tree-invariants.ts`), so the node stays; what goes is the summarising.

The root gist and the Simple/Fuller levels were fine on paperwork; Fuller does end on the
conclusion. So the change is mostly Brief, Tweets and the Structure gists.

## The change (v1, prompts only)

### 1. One shared rule for the paperwork — `src/paperwork.ts`

The same list of what counts as paperwork goes into three prompts, so it is written once, the way
`plainWords` is (`src/plain-words.ts`). `paperwork(kind)` returns a `PAPERWORK` section:

```
PAPERWORK IS NOT THE PIECE

Around the article's content there is paperwork: the list of authors and where
they work, contact and correspondence details, acknowledgements and thanks,
funding and grants, conflict-of-interest and other disclosures, ethics
approval, author contributions, data-availability statements, and the
publisher's notices. It tells a reader nothing about what the piece says.
<kind's sentence>

This is about the paperwork around the piece, not a subject the piece itself
discusses: an article ABOUT research funding or conflicts of interest is about
them, and they are its content.
```

with two kinds:

- `"summary"` — *Never summarise it or spend a sentence on it, and do not count it among the
  piece's caveats or limits. Name an author only to say who argues something.*
- `"structure"` — *A range that is only paperwork still gets its node, because every block must be
  covered. Its gist says in a few plain words WHAT it is ("The authors and where they work.",
  "Funding and conflict-of-interest statements."), never what it says, and the deeper-gist word
  floor does not apply to it. No other gist, the root's included, mentions it.*

Interpolated beside `plainWords(...)` near the end of each SYSTEM.

**The simpler option passed over:** one bullet pasted into each of the three prompts. Three
copies of a list drift, and the fourth mode Greg means by *"other such modes"* would get a fourth.

**The bigger option passed over:** teach stage 3 to mark these blocks `treatment: "supplement"`
(the machinery is half there: `src/supplement.ts` already titles an `"acknowledgment"` run), so no
model ever sees them. It is deterministic and would cover every mode at once, but it changes what
counts as body for every stage, and affiliations sit at the *front* of the article, which
`splitBlocks` falls back on entirely (a supplement block outside the trailing run). Deferred by
name below.

### 2. Lean on the takeaway

- **Summary, all three levels** — THE SHAPE's last step goes from *"Then: its key ideas or
  findings."* to *"Then: its key ideas or findings, ending on the takeaway: what the piece
  concludes, and what that means for a reader. Only what the piece itself concludes; never advice
  it does not give."* The fidelity clause is the guard against *"news you can use"* becoming
  invented advice.
- **Brief's own line** (`NOTCH_UP.brief`) — from *"the one thing the piece is about, why it
  matters, and at most two key ideas"* to *"the one thing the piece is about, why it matters, and
  what it concludes. At most one other key idea."*
- **Tweets, THE LAST POST** — from *"what the piece leaves open"* to *"what the piece concludes and
  what it means — the takeaway — and, where the piece says so, what it leaves open."* Not a call to
  action, not credits, as before.
- **Structure** — nothing beyond the paperwork rule. The root gist is already *"THE ONE claim the
  piece makes"*, and on this article it was the conclusion.

### 3. Brief, slightly shorter

`PITCH.brief`: `words` 100 → **80** (so the stated ceiling moves 150 → 130), and the shape from
*"Two or three short paragraphs, each two or three sentences"* to *"Two short paragraphs, each two
or three sentences; three only if the piece truly needs it"*. The stored limits
(`SIMPLE_LIMITS.brief`: 2–3 paragraphs, 240 words) **do not change**: they are the read-boundary
contract for every stored Brief, and lowering them would throw away summaries readers already
have. The ask moves; the guard stays where it is.

### 4. Tweets: no author lists

`renderPrompt`'s byline line: *"Written by X. Refer to them by surname."* gains *"If there are more
than two, name only the first, as "<surname> and colleagues". Never list the authors."* This is the
direct cause of post 1 above, and it is the paperwork rule's *"name an author only to say who
argues"* made concrete where the byline arrives.

### Stamps

- **Structure: `toc/9` → `toc/10`.** SYSTEM's bytes change, the structure checkpoint is keyed on
  the stamp, and a tree half-written under each would be a visible defect. New articles only, as
  every earlier bump ([hierarchy.md § A new prompt reaches new articles only](../project/hierarchy.md#prompt-versions)). The pinned
  request (`tests/hierarchy-structure-request-parity.test.ts`), the hoist test and the expansion
  stamp (`toc/10+expand/6`) move with it. The GISTS block is what `evals/summaries` slices as
  production's, so that eval's live arm moves too; its pinned `toc/6` controls do not.
- **Tweets: `tweets/5` → `tweets/6`.** A stored thread then reads as *outdated*, which is not
  announced (`isStale`'s comment); `sentIds` is `>= 5`, so still true.
- **Summary: no stamp moves.** `SIMPLE_VERSION` *is* `SIMPLE_ARTIFACT_VERSION`, the stored-shape
  version that `isUsableSimpleSummary` requires to match exactly, so bumping it would make every
  stored summary unreadable — a shape change for a wording change. Existing summaries stay until
  the reader presses *Write it again*, which is how 261001b's wording changes reached readers too.
  A separate prompt stamp for Simple is deferred by name below.

## Measuring it

[prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md), as written:

- **Articles:** three local papers that carry the paperwork: `entropy-24-00930-spya-pywwkq` (8.6k
  words; affiliations, funding, conflicts), `source-spya-f550ta` (ball lightning, 10k;
  affiliation, correspondence, competing interests, acknowledgements),
  `analog-cognition-and-consciousness-4-28-26-spya-f03kqf` (6.5k; competing interests,
  acknowledgements). The reported article itself is in production only, and writing it locally is
  not worth an import.
- **Arms:** `before`, `before-2` (on this commit's parent, the control), `after`. Separated in time.
- **What runs:** production's own functions — `structureRequest` + `streamMessage` for the gists
  (as `evals/plain-words/run.ts` does), `generateSimpleSummary` (all three levels, no profile), and
  `generateTweets`. One new harness, `evals/paperwork/run.ts`, written for this, recording a hash of
  each prompt source.
- **Screens, not evidence:** Brief's word count per run (it must fall, and land nearer 80 than
  186); a count of paperwork sentences/posts/gists, by regex and then by reading each hit.
- **Blind judge**, a fresh subagent reading only a pairs file with shuffled sides (`blindCoin`,
  key in its own file, balance counted): for each article, Brief vs Brief and thread vs thread,
  asking (a) which spends less on paperwork, (b) which gives the reader the piece's conclusion
  more clearly, (c) did either lose, bend or invent a claim — *before* vs *after* against *before*
  vs *before-2*.
- **Read the outputs anyway**, especially for invented advice in the takeaway lines.

Budget: under $5.

## Deferred, by name

- **The other modes Greg's *"other such modes"* may cover**: Sketch, FAQ, Quiz, Ideas, Trajectory,
  Debate, Illustrated. Each writes from the whole article and may pick up the paperwork. v1 is the
  three he named; the shared `paperwork()` makes each of them a one-line import plus its own
  measurement.
- **The deepening cascade's gists** (`EXPAND_SYSTEM`, `src/hierarchy-expand.ts`). A paperwork
  range is rarely long enough to be deepened; the stamp still moves with `toc/10`.
- **Marking paperwork blocks as supplement at stage 3**, so no model sees them — see *The bigger
  option passed over*.
- **A prompt stamp for Simple separate from its stored-shape version**, so a wording change can
  mark summaries outdated without making them unreadable.

## Ledger

(filled in as the work lands)
