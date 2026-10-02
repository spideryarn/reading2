# Summaries skip the paperwork and lead with the takeaway, and Brief gets shorter

Research write-up: [docs/research/261002g-summaries-skip-the-paperwork-prompt-eval.md](../research/261002g-summaries-skip-the-paperwork-prompt-eval.md).

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
  every earlier bump ([hierarchy.md § A new prompt reaches new articles only](../project/structure-step.md#prompt-versions)). The pinned
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
- **Marking paperwork blocks as supplement at stage 3**, so no model sees them — see *The bigger
  option passed over*.
- **A generation-only cap on Brief's length.** Sol suggested refusing a Brief over 130 words at
  generation while reads keep accepting 240. Not taken in v1: a level that fails validation is asked
  once more and then fails the whole three-level press (`LEVEL_ATTEMPTS`, "all or none"), so a cap
  the model overshoots costs the reader all three summaries, not a long one. The measurement
  decides whether the ask alone is enough.

## What GPT Sol's plan review changed

[261001p-summaries-skip-the-paperwork-plan-review-sol.md](261001p-summaries-skip-the-paperwork-plan-review-sol.md),
no P0, five P1s. The sections above are the plan as first written; the code differs from them in
these places, all taken from the review:

- **P1-1, paperwork by role, not label.** "It tells a reader nothing" and "never summarise" were too
  categorical: a sponsor's role can qualify the evidence, an ethics rule can shape the method. The
  rule now says paperwork is what *only records how the piece was produced and published*, and
  anything the piece uses as evidence, reasoning, method or a limit is content
  (`src/paperwork.ts`).
- **P1-2, Structure's exception made whole.** A paperwork range's gist is the sole exception to
  "a CLAIM or a MOVE" and to the word floor, it is asked **no question at any depth** (an absent
  question is already a valid stored state, `questionFor`), and every other gist ignores it. The
  deepening cascade is **no longer deferred**: `EXPAND_SYSTEM` carries the same section, and
  `expand/6` → `expand/7`, so the stamp is `toc/10+expand/7`.
- **P1-3, a prompt stamp for Simple, now rather than later.** Not bumping the shape was right, but
  with no prompt stamp at all `outdated` could never be true and Metadata would call every old
  summary current, so the change would reach no existing article. `SimpleSummary` gains an optional
  `promptVersion`, written as `SIMPLE_PROMPT_VERSION = "simple-prompt/2"`; a row without it reads
  as `simple-prompt/1`, usable and outdated (`simplePromptVersion`). The pipeline's stamp,
  Metadata and the owner's `outdated` compare it; `isUsableSimpleSummary` still requires
  `simple/2` exactly.
- **P1-5, Metadata's Tweets row asks about the prompt.** It compared only the article, so a
  `tweets/5` thread was "current" for ever and `tweets/6` would have reached nobody. It now asks
  `sameStamp` for the prompt version and model as its neighbours do. Held by a new case in
  `tests/store-tweets-stale.test.ts`, seen red with the comparison removed.
- **P2-7, takeaway wording.** "What that means for a reader" invited invented advice. Summary now
  ends *"on the takeaway: the piece's main conclusion, and any implication it states itself. Never
  advice or a consequence it does not give."* Tweets' last post *"Ends on the piece's conclusion …
  If it deliberately reaches no conclusion, end on the central question it leaves open."*
- **P2-9, authors.** When the structured `meta.authors` has more than two, the prompt says how many
  and asks for "the authors" or the first author and "colleagues", rather than asking the model to
  count a free-text byline. Without the list it is asked to count.
- **P2-8, not taken:** adding `BLOCK_ID_NOTE` to the hierarchy at this bump. Its first line
  ("Each block below starts with its id") is not true of the hierarchy's `[i] id <tag>:` lines and
  no leak has been seen; `src/article-prompt.ts` and prompting-guide.md now say so rather than
  promising the next bump. The other half of P2-8 was right: the `PAPERWORK` section sits after
  OUTPUT, outside the GISTS and QUESTIONS slices, so `evals/summaries`' live arm does **not** move.
- **P1-4, the measurement**: two draws of the new prompt, and a fourth article that is not a
  paper (`scaling-hypothesis`, a gwern essay where OpenAI's funding is part of the argument) as
  the boundary case. The intended boundary, `replication-crisis-spya-hrjamq`, belongs to another
  local owner and the harness could not load it.

## Ledger

### The result

Four articles, two draws of each prompt (`before`, `before-2` on the parent commit; `after`,
`after-2` on this one), every call through production's own functions, about $9 in all.
Results under `evals/results/paperwork/`. Three blind judges (Opus subagents, each reading only
one `pairs.md`, never its `key.json`), unblinded afterwards:

| blind read | clearer takeaway (new : old : tie) | less paperwork (new : old : tie) | fidelity faults |
|---|---|---|---|
| `before` vs `after` | **12 : 0 : 8** | 5 : 0 : 15 | old side ≈13 rows, new ≈5; all three "most serious" were old-prompt outputs |
| `before-2` vs `after-2` | **12 : 0 : 7** | 3 : 2 : 14 | old 8, new 4 |
| control: `before` vs `before-2` (old against itself) | 7 : 5 : 8 (split by side, no prompt difference) | 4 : 1 : 15 | 6 : 7 |

The takeaway result is far outside the control's spread. Paperwork is mostly a tie because on these
papers the old summaries already left it out most of the time; where the difference shows is
**Structure**, where the old gists named the grant agencies and the institutions and the new ones are
labels (*"Funding sources and institutional support for the research."*, *"The authors and their
institutional affiliations and contact details."*), and the thread, where the old prompt opened
*"…at MIT's Picower Institute… The authors report no conflicts of interest."* One of the judges'
worst old-prompt faults is the one this change was aimed at: a last post adding *"The authors leave
open exactly how…"*, a caveat the piece does not state, because the old last-post rule asked for
what is left open.

**The boundary held.** On `scaling-hypothesis`, OpenAI restructuring itself to fund its bet is
argument, not paperwork, and the new prompt kept it in the gists and the thread.

**Brief** (8 runs each):

| | words | paragraphs |
|---|---|---|
| old prompt | 121–154, mean 139 | 3 every time |
| new prompt | 99–170, mean 124 | 2 in seven of eight |

Slightly shorter, which is what was asked, and two paragraphs rather than three is the visible
change. One run still came out at 170, so the 80-word ask does not hold the length on its own;
a generation cap stays deferred (above) rather than taken.

### A structure answer that writes JavaScript — not this change, but found by it

Some structure answers are not JSON: the model corrects a block id it is copying by writing
`"spya-c5z6sr".replace("spya-c5z6sr","spya-c5z6sr")` inside the document. `parseJsonAnswer` rejects
it, the stage fails, and the reader gets a Retry button. It is the same habit
[260928a](260928a-trajectory-mode-stage1-real-runs.md) found in Trajectory, where the fix was to
stop showing the model ids at all.

Measured with `evals/paperwork/structure-parse.ts` (production's parse, the raw answer kept):
**`toc/9` 1 in 20 answers** (plus 0 in 8 in the eval arms), **`toc/10` 2 in 12** (plus 1 in 8):
1 in 28 against 3 in 20, every failure the `.replace(` shape, three of the four on
`analog-cognition` and one on the ball-lightning review. At these counts that difference is not distinguishable
from chance (Fisher's exact, two-sided, p ≈ 0.3), and the old prompt does it too, so it is a
**pre-existing failure class**, not a regression this change introduces. It is not fixed here: the
mend belongs in the shared parser or in how the hierarchy shows ids, which is every stage's
contract, and it wants its own plan and postmortem. **It should not be lost**: it costs a reader
a failed ingest at a few per cent of articles. Raised with Greg in the feedback note and the
hand-off. **Picked up and fixed** by
[261001s](261001s-structure-answer-writes-code-to-correct-an-id.md): structured outputs for every
compatible response-JSON call, named exceptions for the rest, and Structure on `toc/11` (starts
only). Postmortem
[261002b](../postmortems/261002b-an-unconstrained-json-answer-fails-the-step.md).

**One thing the measurement did not see.** A peer's work that landed the same evening
(`ef04cfd5a`, plan name shared by the collision the plan-name tool allows) moved Simple to the
high-power model for every article. Every Summary call above ran at `power: "standard"`, on Sonnet.
The prompt's direction should carry over; the word counts on Opus are not measured.

### What happened along the way

- `before` and `before-2` ran first, on the parent's prompt files written back for the run.
- The first `after` and `after-2` runs hit `402 … [ai-no-credit]` on the box's **development**
  OpenRouter key (production's key is a different one, compared by hash only). The partial runs
  are kept as `after-partial-402/` and `after-2-partial-402/`. The credit came back within the hour
  and both arms were run again in full.
- The first harness borrowed `evals/plain-words`' strict parse; it now uses production's
  `parseJsonAnswer` and keeps any raw answer it cannot parse, which is how the `.replace(` shape
  above was found.
