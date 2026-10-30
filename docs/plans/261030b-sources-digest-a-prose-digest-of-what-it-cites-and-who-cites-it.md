# Sources digest: a prose digest of what it cites and who cites it

Written 2026-10-30. Acts on report `spya-vqmfrs` (#740), Greg (admin, `feedback-reporter.ts` exit
0), filed 2026-10-30 08:52 UTC from Sources on `arxiv-2308-08708-spya-xax6v4`. Queue item
`qi-rc3k5z2t`, session `fbvqmfrs-sources-digest`. The research behind it:
[261030a](../research/261030a-sources-digest-how-others-show-a-papers-citations.md).

> let's do this as new submodes in sources, because I don't want to screw with what we already
> have. It's easier to generate a bunch of new submodes and then iterate on them and then throw
> things away. […] one for now that generates a sort of a summary of all of those, I think, four
> points I made before: outbound, inbound, anything missed, and anything that doesn't quite say what
> the article purports them to say. And that as you scroll the article, it highlights in that
> sources digest […] there should be a text input box underneath so that you can […] continue the
> conversation underneath. And actually, there probably should be a text input box at the bottom of
> the summaries as well […] And then they would be their own special types of chats that would also
> be listed in the list of chats. […] Let's just try and make this be as valuable as possible, and
> then we'll figure out what costs the most afterwards. […] first stage, it looks at the article
> and it spins off just a crapload of web searches about claims made and about maybe pretty much
> all the different citations […] Perhaps feed them all to Haiku […] Maybe Haiku is allowed to spin
> off a bunch of further web searches and even read a few targeted web pages itself. […] hand that
> back to our main big model, which would synthesize it all. […] maybe it's only a few paragraphs,
> but each one has, you know, collapsible sections underneath or buttons to dig deeper […] probably
> making it just be a click to see more would be ideal.
>
> — Greg, 2026-10-30 (`spya-vqmfrs`, abridged; every word is in the report)

He also asks for two principles to be written up (progressive disclosure; "build a version and let
me play with it", with the alternatives as several small questions and ASCII diagrams). Those are
rule wording, so they go to him as a question, not into `principles.md`
([edit-important-docs.md](../reusable/edit-important-docs.md)): § Stage 4.

## What already exists, and how this differs

*Where it sits* already runs a literature search ([sources.md § Where this piece
sits](../project/sources.md#where-this-piece-sits), plan 261024o): Sonnet plans ~16 searches, Exa
runs them, Haiku shortlists, Sonnet writes **findings** — cards grouped by kind (Challenged,
Citation?, Since, Not cited?, Reception, Supported), each anchored to a passage. That is most of
Greg's four points, as a list of cards.

The digest is the other shape he is asking for: **one text you read, like Summary's Fuller**, whose
sentences are tied to the passages, in four headed sections, each paragraph short with *More* under
it. And the research behind it is deeper: one Haiku reader *per question*, which may search again,
instead of one shortlisting call over everything. It is a sibling to the dossier, not a change to
it, as Greg asked ("I don't want to screw with what we already have").

**The simpler option passed over: write the digest from the stored dossier.** One Opus call over
the dossier's findings, no new searches, maybe $0.10. It would ship faster, but it is the dossier
reworded: no per-citation research (the dossier's ~16 searches cover the whole piece), no readers
that dig further, and it would tie the digest to the dossier's lifecycle. Greg asked explicitly for
the many-searches-and-readers version and to make it "as valuable as possible" first, so this plan
builds that and records the cheap version as the fallback if the cost does not pay.

**Not reused either: the dossier's evidence as extra input** to the digest. It would save a few
cents of searches and couple two steps' staleness; left for later if the two are kept.

Queue items on the same ground, checked 2026-10-30: `qi-hw3ptdmd` (the dossier overview's sentences
linked to passages) and `qi-mbh8appj` (fold Reception and Claims into the dossier) touch the
dossier, not this; `qi-vj7p4sbh` (a way back from a Summary paragraph's chat) is the paragraph
button, which this leaves alone; `qi-mzfxw3q2` (the Sources rename's contract migration) is live in
another worktree and touches stored `debate`/`citations` names, which this does not. No live session
holds Sources.

## The design

### The pipeline: one step, `sources-digest`, four phases

An owner-only pipeline step like `situate`: its own column (`article_revisions.sources_digest`,
jsonb), its own rate bucket, run by `POST /api/jobs` and read by `GET /api/sources-digest/:slug`.

```
 article + Bibliography (if made) + OpenAlex citers (free)
        │
  1. PLAN      digest-plan     capable (Sonnet; Opus under high-powered AI); no profile
        │      → up to 16 LEADS, each: angle (cites | cited-by | missed | check),
        │        a question, 1–3 passages (block ids), 1–2 web searches
        │      queries through situate's validateQueries; ≤ 32 in all, plus the piece query
  2. SEARCH    digest-search   Exa via OpenRouter, ≤ 33 queries, 8 in flight
        │      (situate's searchOne, its own task name for the ledger)
  3. READ      digest-read     Haiku, ONE call per lead, 6 in flight, no tools
        │      the lead, its passages, its results (≤ 8 pages, ≤ 6,000 chars each),
        │      the article's passages and every page fenced as untrusted (untrusted())
        │      → REPORT: verdict, 2–4 sentences, quotes [{evidence id, words}],
        │        and "dig further": what a reader would still want to know (words only)
        │      quotes checked in code against the fetched text; unchecked ones dropped
  4. WRITE     sources-digest  capable, on Opus for every article (ALWAYS_HIGH_POWER, as Summary)
               the article (cached) + every report with its checked quotes
               → overview + four sections of short paragraphs, each:
                 sentences [{text, block id | null}], ids, more (the detail), sources [evidence ids]
               validated as Summary's paragraphs are; a source must be a checked quote's
```

- **Leads, not one search list.** Each lead is one question a reader can answer: *does Smith 2019
  say that attention is ignition?*, *who has replied to the global-workspace argument since 2023?*,
  *is there a well-known result on X this piece does not cite?* The planner is told the angles and
  rough shares (most leads on what it cites and what it may have missed; cited-by leads lean on the
  OpenAlex citers it is shown). The caps (16 leads, 3 searches each, 2 follow-ups each, 2 rounds)
  are the research's lesson: cap the fan-out rather than let a model choose it. **The caps are
  enforced in code**, not only asked for: leads cut at 16, searches per lead at 2, queries at 32
  plus the piece query, pages per reader at 8, characters per page at 6,000.
- **No searches written after reading a page (GPT Sol's F1 on the plan).** Greg imagined the Haiku
  readers spinning off further searches. `situate.ts` already forbids exactly that — *"a query
  written after reading web pages is a search steered by those pages"*: a page could steer what we
  search for, or get article text echoed into a query sent to Exa. So every search is planned up
  front by the planner, which reads only the article; the readers have no tools. What a reader
  would still dig into is returned as words, shown in the digest's *More* as an open question, and
  the digest's chat (which the reader starts, with its own web search) is where that digging
  happens. Whether readers may search again is asked of Greg as a security decision (question 7).
- **"Read a few pages"** is v1'd as **longer extracts** of the pages the searches returned (Exa
  sends the text; the reader gets up to 6,000 characters per page against the dossier's 2,500).
  Fetching a URL a model picked from an untrusted page is a server-side fetch steered by a
  stranger ([security-map.md](../project/security-map.md)); deferred, as above.
- **A reader is one call, not a tool loop.** There is no server-side agent loop to reuse
  (`converse` is tied to a chat thread), and a fixed shape is cheaper to bound and to test. It is
  "Haiku sub-agents" in the sense Greg means: each does its own bit of reading and reports.
- **Untrusted text is fenced at both boundaries (F2).** The reader gets the article's passages
  and every page inside `untrusted()` fences with its instructions after them, as `situate`'s
  `evidencePrompt` does; the writer gets the article fenced (cached) and the readers' reports and
  checked quotes fenced again, since a report is model text that read a stranger's page. Neither
  call has tools. Tests plant an instruction in a page and in a report, and a fence-closing
  string, and check the output is still only the schema's shape and the planted words are not
  obeyed (as far as a double can show: the structural part, that the fence cannot be closed, is
  the testable one).
- **Every quote is checked in code** against the text the run fetched, the way `checkFindings`
  checks the dossier's. The writer sees only checked quotes and may cite only them (evidence ids it
  was given); its block ids are checked against the article. A paragraph left with no valid id is
  dropped, as Summary's is.
- **Verdicts in plain words.** A *check* lead's verdict is *says it*, *partly*, *does not say it*
  or *could not tell* (the research: models give false entailment on partial support, so *partly*
  is its own answer). The section is headed as something to check, never "wrong".
- **Found nothing is said**: if no search found anything, the digest is *nothing found*, with the
  searches listed, never an "all clear" (the dossier's rule).
- **Stored with what it paid for**: the leads, each search's outcome, each reader's report and the
  digest, with `generatedAt` and each phase's model. *What was searched*, folded at the foot, shows
  the leads and reports, so the digest's working is one press away.
- **Staleness and versions** copy `situate`: an input fingerprint over the article; a
  `PROMPT_VERSION`; outdated when a phase's model would differ; profile hash for the
  *written for you* badge (the writer sees the reader's profile, the planner and readers do not).
- **Rate and time**: its own bucket, `SOURCES_DIGEST_RATE_POLICY`, three an hour and eight a day per
  reader, 50 a day across everyone, one at a time. Tighter than the dossier's because it costs more.
  Every call has a timeout; `STEP_BUDGET_MS["sources-digest"]` is derived pessimistically from the
  phases (plan, then searches in waves of 8, then readers in waves of 6, then the write), and the
  allowance's `leaseMs` covers the whole budget, as `SITUATE_RATE_POLICY`'s does, so a slot cannot
  expire mid-run (F5). A test pins lease ≥ budget.

**Cost, estimated, not measured** (the box's OpenRouter key is at its monthly limit until
1 November), from the enforced caps (F6):

| Phase | Expected | Worst case (all caps hit) |
|---|---|---|
| Plan (Sonnet; Opus under high-powered AI) | ~$0.05 (~$0.09) | ~$0.08 (~$0.14) |
| Searches at the dossier's measured ~$0.0075 | 25 → ~$0.19 | 33 → ~$0.25 |
| Readers, Haiku, ~15k–50k tokens in each | 12 → ~$0.25 | 16 × 50k → ~$0.85 |
| Write, Opus, ~50k in (article cached) and ~4k out | ~$0.35 | ~$0.55 |
| **A run** | **~$0.85** | **~$1.80** |

Three to six times the dossier. Greg: *"make this be as valuable as possible, and then we'll figure
out what costs the most afterwards."* The ledger rows (`digest-plan`, `digest-search`,
`digest-read`, `sources-digest`) are what that later look reads.

### On screen: a fourth chip, *Digest*, behind the experimental switch

```
 ┌ Where it sits │ Digest │ Bibliography 42 │ Links 61 ┐                         (i)
 │ What its sources say  ·  a review from 2023                      written for you
 │ Two or three sentences: the shape of it. Each sentence lit while its passage
 │ is on screen, a press jumps to it.
 │
 │ WHAT IT BUILDS ON (i)                                   ← outbound: cites and links
 │   Short paragraph, sentences as links to passages.  [spya-k3m9qt] [More ▾] [💬]
 │     ┆ More: the detail, then its sources —
 │     ┆   Smith 2019 ↗  "the exact words the reader checked"
 │ WHO HAS TAKEN IT UP (i)                                 ← inbound
 │ WHAT IT MAY HAVE MISSED (i)
 │ WORTH CHECKING: CITATIONS THAT MAY NOT SAY THAT (i)     ← miscited
 │   ... "Smith 2019 says it only for adults" — partly ...
 │
 │ ▸ What was searched (14 questions, 52 searches)
 │ ┌──────────────────────────────────────────────────────┐
 │ │ Ask about this digest…                         [Send] │
 │ └──────────────────────────────────────────────────────┘
```

- **A chip, not a tool or an experiment.** Greg asked for a sub-mode; a chip is one press from the
  band. **Behind the experimental switch**, so a reader who has not opted in is not offered a $1+
  press while Greg plays with it. That takes two things (F7): `experimental: true` on its
  `SOURCES_SUB_MODES` row, which hides the command-bar row, and the switch threaded into the chip row
  (`SourcesViews` maps `SOURCES_CHIPS` directly today), filtered through `shownBehindTheSwitch` so a
  pasted `?sources=digest` still shows its own chip lit. Moving it out is those two edits.
- **Opening it is the request**, the rule *Where it sits* already follows: the press on its chip
  (or its command-bar row) starts the run when none is stored; arriving by link, Back or reload
  starts nothing ([sources.md § Opening it is the request](../project/sources.md#opening-it-is-the-request)).
  A stored digest is never re-run by a press; *Write it again* is a button.
- **Every sentence is a door**, by drawing them as Summary does: a sentence with a block id is a
  `BlockRef`, so the band's on-screen wash lights it while its passage is on screen and a press
  jumps there, with no new code (`OnScreenLinksStyle`, `on-screen.ts`). The paragraph's ids are the
  usual chips.
- **Progressive disclosure**: each section starts with its paragraphs, each paragraph shows its
  first two or three sentences; *More* opens the detail and the sources with their checked quotes,
  each a link out. Each heading has an (i) saying what the section is and how it was found. The
  folded *What was searched* is the working.
- **Owner only, as a decision, not a default (F3).** mode.md's default is that a stored generated
  artefact is readable by a visitor. The digest departs from it, as the dossier does (`NeverShared`
  in `pg.ts`), for two reasons: the writer is given the owner's profile, so the text is written for
  them; and it carries quotes from strangers' pages that the owner's press fetched, which a public
  page would republish. So a visitor's band never offers it and a shared `?sources=digest` draws
  Bibliography (`visitorSourcesView`). Asked of Greg as question 8; a public projection, should he
  want one, is a later stage. The owner's export carries it (Stage 1 adds the line).
- **Whose words** ([fonts.md](../project/fonts.md)): the digest is the model's face; a source's
  quote is a stranger's page, in the UI face as the dossier draws it.

### The ask box, under the digest and under Summary

Greg: a text box underneath to continue the conversation, under the digest and under Summaries,
each its own kind of chat in Chat's list.

- **One chat per digest, and one per summary level**, by the existing rule
  ([chat-from-a-mode.md § One chat per item](../project/chat-from-a-mode.md#one-chat-per-item)).
  The box's first Send starts the chat with the reader's words and the text they are asking about
  (fenced and marked as quoted: the chat model reads the article, not the digest or the summary),
  and it opens in Chat's band like every *Ask in chat*. From then on the box gives way to the
  chat's mark (its gist and *Continue the conversation*), which reopens that chat beside the mode,
  where its own composer carries on. A handoff cannot post into an existing thread today, and
  reopening is the rule the other modes follow, so this adds no machinery.
- **Two new origins**, each id-shaped (`itemId` and a quote snapshot), each listed in Chat:
  - `sources-digest`: the digest (`sd-` and its `generatedAt` digits) and each paragraph's own
    *Ask in chat* (`sd-…-p3`), so a new digest gets new chats. Listed as *Started from the digest in
    Sources › Digest*; the way back opens the digest on that paragraph.
  - `summary`: a level (`ss-brief-…`, `ss-fuller-…`, with that summary's time). The word is already
    reserved in the database CHECK with no shape; the migration lets it carry the item shape. Listed
    as *Started from Summary › Fuller*; the way back opens Summary on that level.
- **Summary's paragraph button is left as it is** (it waits in the composer and stores no origin;
  its way back is `qi-vj7p4sbh`). The new box sits under the Brief and Fuller text, owner only, not
  under Thread.
- **The first message fits (F4).** Chat refuses a question over `MAX_CHAT_QUESTION_CHARS` (4,000),
  context included, and a Fuller can be 1,400 words. One shared builder in `chat-handoff.ts` takes
  the reader's words whole, the fixed headings, and fences the digest's or summary's text (quotes
  escaped as `fencedQuote` does) cut, with `…`, to whatever room is left. Tested at the maximum
  Fuller, a maximum digest, a fence-breaking quote, a cut inside a surrogate pair, and a
  maximum-length question.
- **The box is one shared component**, lifted from Investigate's private `QuestionBox`, not a third
  copy ([controls.md § Controls that do the same job look the same](../project/controls.md#controls-that-do-the-same-job-look-the-same)).

## Stages

Each ends green and committed, with this plan updated, and a GPT Sol code review (write-capable, in
this worktree) before the next. Gates: `npm run typecheck`, the touched suites and `npm test`,
`npm run lint` on touched files, doc-links.

**Stage 1 — the step, server side.** Types (`SourcesDigest`, leads, reports, paragraphs), the four
tasks in `models.ts` and their tables (`digest-read` pinned to Haiku as `situate-triage` is;
`sources-digest` in `ALWAYS_HIGH_POWER`), `JOB_DISPOSITION`, the step in every registration site the
compiler and `mode.md § The artefact` list, the migration (column, step CHECK, rate bucket CHECK),
`src/sources-digest.ts` (plan, search, read, write, checks, staleness), the GET route, the export
line. Tests with injected model and search doubles: caps hold (leads, queries, pages,
characters); a reader is one call with no tools; fences hold against a planted instruction and a
fence-closing string; lease ≥ budget; an unchecked quote is dropped; a writer's unknown evidence id or block id is dropped; found
nothing is stored as such; the rate bucket refuses. Red first.

**Stage 2 — the chip and the panel.** `digest` in `SOURCES_VIEWS`, `SOURCES_CHIPS`, `chipOf`,
`SOURCES_SUB_MODES` (experimental, aliases *digest*, *sources digest*), `activationForSources`
(armed on the chip's press), the visitor exclusion, the panel (read hook with `ReadError`,
`useRewriteHold` for *Write it again*, the waiting state, nothing-found, stale banner), the help
page's line under Sources. Tests: the press starts it and arriving does not; the sentences are
`BlockRef`s; visitor never asks the route; switch off hides the chip and a pasted address still
draws it. Browser pass (Sonnet subagent, Playwright on the box) with a seeded digest, desktop and
phone, screenshots looked at.

**Stage 3 — the ask box and the two origins.** The shared box; the `sources-digest` and `summary`
origins through every step of [chat-from-a-mode.md § Adding it to another
mode](../project/chat-from-a-mode.md#adding-it-to-another-mode) (union, `ORIGIN_MODES`,
`sameOrigin`, migration for the item shape, `originColumns`/`originFromColumns`, `parseOrigin`,
title, `originPlace`, `originBack`, `openOrigin`, `CHAT_FROM_WORDS`, the handoff wording, the
senders wrapped in `reopenItemChat`); the box under the digest and under Summary's Brief and Fuller;
each digest paragraph's chat button. Tests copied from the origin suites named in that section, each
watched red first; the round trip through the columns for both new modes.

**Stage 4 — docs, the question, the bookkeeping.** `sources.md` § Digest, `summaries.md` § Ask
about the summary, the table in `chat-from-a-mode.md`, `privacy.md` (what leaves: the piece to the
AI, its searches to Exa, the profile only to the writer), the help pages. The question file for
Greg (below), published. The deferred halves queued. The note in `docs/user-feedback/`.

## What Greg is asked (Stage 4's question file)

Built first, asked after, as he said: *"the easiest thing is for you to build a version and for me
to play with it."* Several small questions, each with an ASCII sketch, not one big A/B/C:

1. **The two principles' wording** — *progressive disclosure* and *build a version, then ask in
   small pieces* — proposed for `principles.md` as 2 and 3.
2. **Where the digest lives**: its own chip (built) / a tool under *Where it sits* / replacing the
   dossier's card list in *Where it sits* once he prefers it.
3. **How a paragraph opens**: *More* fold (built) / every paragraph open / a hover card.
4. **The ask box's chat**: in Chat's band, then beside the mode (built) / inline under the box,
   growing in place.
5. **Briefer and Fuller levels**: one level with *More* (built) / Brief and Fuller like Summary.
6. **Out of the experimental switch** once measured, or not yet.
7. **May the readers search again** after reading a page (a security trade-off: what a page could
   steer, against deeper digging), or does the planner's up-front list and the chat stay the way?
8. **Visitors**: keep the digest owner-only (built), or show a stored one on a public article?

## Deferred, each queued before the note says shipped

- **Measure a real run** (cost, time, quality on three or four articles beside the dossier) once
  the OpenRouter key resets on 1 November; written up under `docs/investigations/`.
- **Readers that search again or fetch a page themselves**, waiting on Greg's answer to question 7
  and a security design reviewed on its own (F1).
- **Brief and Fuller levels**, if Greg's answer to question 5 says so.
- **An abort signal through the OpenAlex citer lookup** (GPT Sol's SD1-04): the digest stops
  waiting at 40 s or on cancellation, but the lookup itself runs on in the background (free, each
  request under its own 8 s fetch deadline). Threading a signal through `situateCiters`, the
  citation index and the limiter's sleep is shared code, so it is its own small job.

## Risks

- **Cost per press** is the dearest in the app; bounded by the caps, the rate bucket and the switch.
- **The writer smooths over thin evidence.** Mitigated by citing only checked quotes, *partly* as a
  verdict, and the sources one press away; measured live after 1 November.
- **Registration breadth**: a new step touches ~20 sites. The compiler catches most; mode.md's
  residue list is the checklist for the rest, and the suite is run whole.

## Progress

- 2026-10-30: plan written; research doc 261030a.
- 2026-10-30: GPT Sol plan review ([261030b-plan-review-sol.md](261030b-plan-review-sol.md)),
  verdict *revise*, seven findings, all taken: F1 (no page-steered follow-up searches; the biggest
  change, and question 7), F2 (fences at both boundaries, planted-instruction tests), F3 (owner-only
  made an explicit decision, question 8), F4 (the first message cut to fit), F5 and F6 (caps in
  code, step budget and lease, the cost table), F7 (the switch threaded into the chip row). Its
  check of my doubts: a summary has one `generatedAt` for both levels, so `level + generatedAt`
  names a level's chat; and a chip press that starts the run breaks no rule. Next: Stage 1.
- 2026-10-30: Stage 1 built (48b535ec8): the step, migration `20261030215639_sources_digest`
  (additive; not yet applied to the shared local database, whose ledger holds another worktree's
  unlanded migration), 18 tests. Brief claims that proved false: situate's reader did not use
  `PROFILE_RULES`, its model calls had no clock of their own, and the piece has no stored "kind".
  GPT Sol's code review ([261030b-stage1-code-review-sol.md](261030b-stage1-code-review-sol.md)),
  verdict *revise*, four findings: SD1-01 (a trusted instruction after the last fence at both the
  planner and the writer; prompt version 2), SD1-02 (the publication year in the freshness hash)
  and SD1-03 (two validators split under the complexity limit) fixed by Sol; SD1-04 (the citer
  lookup is not aborted) fixed here for cancellation, the rest deferred above. 23 digest tests,
  288 across digest, situate and the database-backed freshness deciders.
- 2026-10-30: Stage 2 built (ea1959879): the chip, the panel, press-only start, the switch
  threaded into the chip row, visitors mapped to Bibliography. Plan claims that proved false:
  "digest" cannot be an alias of a row labelled Digest (its label is already its first alias),
  and all of a paragraph's sentences show rather than the first two or three, since paragraphs
  are short. Browser pass (Sonnet, Playwright, a seeded digest on `clark-chalmers-1998-spya-uwb4tn`
  locally, desktop and phone): works, console clean; the (i) label doubled a word (fixed); the
  phone chip row overflowing is the part-switcher's designed sideways scroll. GPT Sol's review
  ([261030b-stage2-code-review-sol.md](261030b-stage2-code-review-sol.md)), *approve with
  changes*: SD2-01 (another tab's finished run could start a second paid one; fixed by Sol, with
  postmortem 261030c), SD2-05 and SD2-06 fixed by Sol; SD2-02 (Where it sits has the same race)
  fixed in its own commit; SD2-03 (a writer answer empty once checked is a failed answer, not a
  blank `written` digest) fixed here, red first; SD2-04 (admin view-as sees the digest as the owner
  does) kept as the standing view-as design and written into sources.md in Stage 4.
