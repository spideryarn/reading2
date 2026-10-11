# 261011w — Does the cited work say that? At the citing sentence

Up: [plans.md](../project/plans.md) · queue item `qi-sq25xqqf` · session
`fbh5aypq-cited-work-says-that` · idea 2 (Greg's 4B) of
[261009b](../research/261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md) ·
question [q-fkq30v](../user-feedback/questions/q-fkq30v.md)

**Status: built and code-reviewed (2026-10-11); fixes applied, but the security-map wording still
needs approval before push. Not pushed or deployed.**

## What Greg asked for

> 4 all? Use your judgment based on that combination of ease and value.
>
> — Greg, 2026-10-10 (reply `spya-dbfeqh` to q-fkq30v, part 4)

Part 4 B was the research's idea 2:

> **Sources: "does the cited work say that?"** At a citing sentence, the cited work's own passage,
> when we can read it (open access, or already in Spideryarn). Quotation errors run at 14–25% of
> citations in the published literature (Mogull 2017; Jergas and Baethge 2015). Bibliography's
> *Investigate* already reads one work. This would aim the reading at the sentence.

The queue item adds: *the cited paper is a stranger's text reaching a model (security-map.md), so
fence it the way link-summary does.*

## What is there today (read on `e249762c5`)

- **The machinery to read a cited paper exists and is unused by anything a reader can press.**
  `readPaperEvidence` ([`src/paper-evidence.ts`](../../src/paper-evidence.ts)) takes a row's DOI or
  arXiv link (or a page the quick check matched), fetches the PDF, confirms by code that it is this
  work (title on page one plus an identifier or the first author; a registry check against a
  mistyped DOI), chunks it, and picks the chunks that share the most words with what the article
  uses the work for. Its one caller was *Dig deeper*, whose button went on 2026-10-09 (plan
  [261009k](261009k-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md)); D5 there
  says *"Remove the Dig deeper server half … or reuse it as a chat tool."*
- **Chat cannot read a paper.** `read_web_page` refuses a PDF in so many words
  ([`src/chat-tools.ts`](../../src/chat-tools.ts) § `readWebPage`: *"served a PDF, which this tool
  cannot read. Say so rather than guessing"*). Most cited papers are PDFs (arXiv, a publisher's
  PDF). So today *Ask in chat* on a cited work answers from web-search snippets and HTML landing
  pages: the abstract at best.
- **Greg's direction is chat, not another button with its own answer.** *Dig deeper* was replaced
  by *Ask in chat* at his request (261009k), and [chat-from-a-mode.md](../project/chat-from-a-mode.md)
  quotes him: *"a lot of the more advanced functionality for extra research/digging/searching could
  piggyback on the advanced Chat functionality & tools"*.
- **The citation's card in the prose knows the citing paragraph.** `CiteCard`
  ([`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx)) is handed `here`, the block the mark
  sits in, and the mark's own words are the article's characters (`citeMarks`).
- **A chat about a passage already exists**: `askPassageInChat` in `Reader.tsx` sends
  `askAboutBlock(...)` with a whole-block anchor `{ blockId }`, and `converse` renders the anchored
  block into every turn. No new origin shape is needed for a question *about a sentence*.

## The design

Two pieces, each small, each reusing what is there.

### 1. A chat tool that reads the cited paper: `read_cited_work`

```
chat model ──read_cited_work({ work: "Attention is all you need", claim: "…the sentence…" })──▶
  loadBibliography(slug)          the stored list (owner's; chat is owner-only)
  └─ one row, by its title words  (none, or several → a sentence naming the candidates)
  readPaperEvidence(row as input) paper-evidence.ts: DOI/arXiv/matched page → PDF → identity by code
  └─ selectChunks against the claim the model passed (plus the row's own `why`)
◀── provenance line in OUR words (outside the fence):
      "We read the paper itself: a PDF from arxiv.org, 11,200 words. You are shown 1,800 of them:
       the title and abstract, and the chunks sharing the most words with the claim."
    + untrusted("cited paper", "[c1, page 1]\n…\n\n[c7, page 4]\n…")
    + "Quote the paper only from the text above, naming the page. If it does not speak to the
       claim, say the passages you were shown do not, not that the paper does not."
```

- **Arguments**: `work` (words from the title, as `article_citations` lists it; matched like that
  tool's `query`, and it must narrow to exactly one row) and `claim` (what the article cites the
  work for, in the article's words where possible). The claim steers chunk selection; it is never
  trusted for anything else.
- **Every outcome that is not a read is a sentence, never a throw** (chat-tools' rule 3), and each
  says what to do next: no address (*the article gives no DOI or arXiv link and no page was matched;
  you may search the web, and say that you have not read the paper*), unreadable, not the full text
  (an HTML landing page: *read_web_page may read its abstract*), not confirmed (*the PDF at that
  address could not be confirmed as this work; do not describe it as the work*), identity conflict.
- **Fenced** with `untrusted()`, the one fence every stranger's text in chat goes through, as
  `read_web_page` does; our provenance line sits outside it. Unlike link summary, chat's model has
  tools, so this is a mitigation rather than a boundary: a hostile PDF can still steer a later tool
  call.
- **Capped smaller than Dig deeper's 5,000 words** (`selectChunks` gets an optional budget;
  chat-tools' rule 2: tool output is re-sent every later round). Proposed: 2,000 words, about the
  same characters as `read_web_page`'s `WEB_PAGE_CHARS`.
- **Offered to `chat` and `explore` kinds only**, beside `reader_notes` in `toolsFor`. Not Live (a
  25-second PDF read in a voice turn), not Learn, Tutorial, Candidates or the guide. `runTool`
  already refuses a name the kind was not offered.
- **No model call of its own, no allowance bucket of its own.** It is a fetch, like
  `read_web_page`, bounded by `PAPER_READ_MS` and the turn's own limits. The registry lookup is
  `lookupWork`'s, already rate-paced and cached.
- **A narrow dependency seam, not `ToolContext`**: `readCitedWork`'s third argument defaults to the
  real `readPaperEvidence`, while tests supply a fake and never fetch a paper.
- **The tool description says when**: when the reader asks whether a cited work says, supports or
  shows something, or what it actually says; prefer it to `read_web_page` for a work in the
  citations list. And when not: a question the article answers.

### 2. At the citing sentence: *Does it say that?* on the citation's card

The owner's citation card in the prose (`CiteCard`) gets one more button beside its chat button,
*Does it say that?* (a text button: the chat icon is taken by the work's own chat). A press sends a
fresh chat **anchored on the citing paragraph**, through the existing passage path:

```
About block k3m9qt ("TV episodes [8]"):

Does this work say what this passage cites it for? Read it if you can, and say what you read.

  """
  Recall of TV episodes — Smith et al., 2019
  """
```

- The anchor is `{ blockId: here }`, so `converse` keeps the paragraph in
  front of the model on every turn, and Chat's existing anchored-chat way back works.
- **No origin, no migration.** It is a question about a passage, which is exactly what an anchor
  is. The work's own *Ask in chat* chat (one per work) is untouched.
- **Each press is a fresh chat**, like any passage question. "One chat per item" is for items;
  this is a question, and the same work cited in two paragraphs is two questions.
- Only on a card opened from a citing paragraph (`here` names a block that is not the reference
  entry's), owner only, and only for a work the card can name.

## The simpler options passed over, and why

- **Only the card's button, no tool** (prompt chat to check): chat would answer from snippets and
  abstracts while sounding as if it had checked. The research's point is the cited work's *own
  passage*; without the paper there is none. The tool is most of the value.
- **Only the tool, no button**: the reader would have to know to ask. The research's idea is
  explicitly *at the citing sentence*; the button is the cheap half.
- **Let `read_web_page` read PDFs**: wider (any PDF on the web), but it cannot confirm the PDF is
  the cited work, and Greg asked specifically *"be really careful to be clear about whether you
  could get the actual paper, so that we can be sure you're not hallucinating"* (5G). The keyed tool
  says which paper, confirmed how.
- **Bring back a Dig-deeper-style press with code-verified passages** (`citation-paper-passages`):
  stronger guarantees on quotes, but it is the button Greg removed, and an extra model call per
  press. Chat's quotes of the paper are not verified by code; the tool says where they must come
  from. Named as a limit below.
- **A new origin (work + block) so the sentence's chat can be found again**: a CHECK change, a union
  arm, a way-back arm. Not needed for v1.

## Limits, said plainly

- **Chat's quotes of the paper are the model's**, told to quote only from the fenced text. Not
  checked by code, as no chat answer's quotes are. The provenance line, which *is* code's, says what
  was read.
- **Paywalled and HTML-only works stay unread.** Only a PDF text layer counts, as for Dig deeper.
- **"Already in Spideryarn"** (the research's other source) is not read by this tool in v1: a work
  on the reader's shelf could be read from the store. A follow-up if the PDF route leaves too many
  works unread.
- A stranger's PDF can still steer the answer inside the fence: the fence is a mitigation, the same
  residual risk as `read_web_page` ([security.md § Chat tools](../project/security.md)).

## Overlap with `qi-8x3vrr8z`

Greg's report `spya-xv3q97` (chat about a citation should say how it relates to the article and
whether it is justified) is close ground and not this item. This plan does not change
`askAboutCitedWork`'s question or chat's prompt for it. The new tool will make that item's answer
better (chat can now read the paper), and the note will say so.

## Stages

1. **The tool.** `read_cited_work` in `chat-tools.ts` (description, `describeCall`, dispatch,
   `toolsFor`), an optional budget on `selectChunks`, `readPaper` behind `readCitedWork`'s dependency
   argument, the outcome sentences. Tests first: a read (fenced, provenance outside,
   capped), each not-read state, no list, no match, several matches, not offered to Live or the
   guide. chat-tools.md gets the tool.
2. **Measure** on real arXiv- and DOI-citing articles in the local database: does chat call the
   tool, does it read, what does the answer say. This is the gate before the button; write it up in
   `docs/investigations/` and link the raw result and this plan.
3. **The card's button.** `CiteCard` gets `onCheckCited(work, blockId)`, Reader sends it
   through `askPassageInChat`'s path with a new `askDoesItSayThat` in `chat-handoff.ts`. Tests: the
   button only for an owner on a citing paragraph; the press hands an anchored draft with the
   work fenced. bibliography.md § Marked in the prose and chat-from-a-mode.md get a line.

GPT Sol reviews the plan (read-only) before stage 1 and the code after stage 3.

## Questions for Greg (none blocks)

- The button's words, *Does it say that?* Alternatives: *Check the source*, *Does the work say
  this?*

## GPT Sol's plan review, and what changed

[261011w-…-plan-review-sol.md](261011w-does-the-cited-work-say-that-plan-review-sol.md), verdict
*build with changes*. Each finding checked against the code; all eight taken.

- **S1 (high).** `{ blockId, quote }` is not a legal `ChatAnchor` (a selection needs a rendered
  `start` too, and the card does not know it). **The anchor is `{ blockId: here }`**, a whole-block
  anchor, and the work's title goes fenced in the question. `converse` names the anchored block
  every turn; the article is already in context.
- **S2 (high).** The tool builds the paper's input with `investigateContext(row, blockText)` and
  passes `matchedPageUrl` only from `matchedPageOf(row, freshly loaded find)`, never a row's
  `article` or `web` url. The model's `claim` is a separate selection input (`selectChunks` gains
  `extra` terms and a budget), not relabelled as a citing passage.
- **S3 (medium).** A stale list is refused (as `article_citations` does), *not made* and *could not
  be read* stay distinct, and the work is matched by **title only**, normalised, exactly one row.
  Candidate titles in an ambiguity reply go inside `untrusted()`.
- **S4 (medium).** `readPaperEvidence` takes the tool's `AbortSignal`, and the whole read (registry
  plus paper) sits under one outer deadline. The dependency seam is `readCitedWork`'s third
  argument, not another field on `ToolContext`.
- **S5 (medium).** Not "link-summary handling": link summary's model has no tools, chat's does. The
  honest description is *the same mitigation as `read_web_page`*: fenced, our words outside, and the
  residual risk that a hostile PDF asks for a later `read_web_page` that carries text out (capped by
  that tool's URL rules, not prevented). Tests cover a PDF whose text tries to close the fence; the
  security docs get the line.
- **S6 (medium).** Whether chat calls the tool is the silent-success risk. **Stage 3 (measure) moves
  before the button, and is a gate**: tool-call rate, read rate, and whether the answer separates
  *the passages shown do not address it* from *the paper does not*.
- **S7 (low).** A separate tool definition added only to chat/explore's list. The provenance line
  uses `evidence.sentWords`.
- **S8 (low).** The button shows only when `here !== null && work.citedAt.includes(here)`; it is a
  labelled text button, bound per work, closes the card, and starts a fresh originless chat.

Stages are now: 1 the tool; 2 measure (gate); 3 the card's button.

## Results

### Stage 1, the tool (built 2026-10-11)

`src/read-cited-work.ts`, offered by `toolsFor` to chat and explore. `selectChunks` takes an
optional claim and budget; Dig deeper's call is unchanged. `readPaperEvidence` takes a signal.
`tests/read-cited-work.test.ts`: four were watched red by mutation (passing the row's url as
the matched page; matching `why` as well as titles).

### Stage 2, the gate: does chat call it? (measured 2026-10-11)

`npx tsx evals/read-cited-work.ts --label v1 --max 4`: one real chat turn per article, sent exactly
as the card's button sends it (anchored on the citing paragraph, `askDoesItSayThat`). The four
local articles with a DOI or arXiv citation; $0.54 for nine model calls. Results file:
`evals/results/read-cited-work-v1-2026-10-11T12-45-35-631Z.json`; investigation:
[does chat read the cited work?](../investigations/261011d-does-chat-read-the-cited-work.md).

| Article · work | Tools | Paper read | What the answer said |
|---|---|---|---|
| Attention is all you need · *Exploring the limits of language modeling* (arXiv) | `read_cited_work` | yes, 1,927 of 5,927 words | supports the "recurrent language models" half; *"I read only the parts of it that were shown to me"* |
| Antikythera · *The Initial Calibration Date…* (arXiv) | `read_cited_work` | yes, 2,000 of 9,498 | partly: the date holds (quotes, pages 1 and 24); *"the passages I was shown say nothing about the second half"* |
| Scaling hypothesis · *Santoro et al 2016* (arXiv) | `article_citations`, `read_cited_work` | no: not confirmed | *"I couldn't confirm that I read the paper"*. The list's title is a label, not the paper's title, so page one could not match it: correct refusal |
| Spider silk · *Silk feeding as an alternative foraging tactic…* (DOI) | `read_cited_work`, web search | no: Wiley refused | said it could not read the paper, answered from an abstract it found and named the page |

**Called 4 of 4; read 2 of 4; every unread case said so.** Both reads kept "the passages shown"
apart from "the paper". Gate passed, so stage 3 (the button) was built.

### Stage 3, the button (built 2026-10-11)

`CiteCard` draws *Does it say that?* when the card was opened from a paragraph in the work's
`citedAt`; Reader's `checkCitedWorkInChat` hands an anchored, originless question to Chat. Tests in
`citation-hover-card.test.tsx` (the reference-entry rule watched red) and a Reader-level one in
`glossary-and-bibliography-ask-in-chat.test.tsx` (watched red by dropping the prop at Reader).
