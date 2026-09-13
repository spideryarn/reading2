# Questions about a passage reach for the web, say which half came from where, and can look at the citations

Two feedback reports from Greg, four minutes apart, about the same thing: what the model can reach for
when a reader asks about a passage. They are one piece of work, built in two stages.

- **SPIDERYARN-READING2-3D**, 2026-09-12 08:27Z, iPad, production, build `607b57a0`. He pressed the
  "?" on a block, typed into the box, and got an answer drawn only from the article.
- **SPIDERYARN-READING2-3F**, 2026-09-12 08:31Z. Give chat and comments a tool that reads the
  article's citations list, so the model can use it to aim its web searches.

His words are verbatim in [the note](../user-feedback/260912_0827-comment-questions-reach-for-the-web-and-the-citations-list.md).
The two sentences that set the goal:

> So, in other words, asking a question with the comments panel has the full power of Chat, but is
> really crystal clear about what is and what is not from the article and always provides sort of
> evidentiary links back.
>
> — Greg, 2026-09-12 (3D)

> We don't want to overemphasize this. It's just one more tool that potentially the LLM could make use
> of, and we want to kind of enable it to ask to search the citations as a tool.
>
> — Greg, 2026-09-12 (3F)

## What is actually going on (the diagnosis)

**The comments panel already has the full power of Chat, on the wire.** Neither way of asking about a
passage has its own model call any more:

- the gutter **"?"** mints a chat draft with `help: true` (`helpAboutBlock` in
  [`reader/Reader.tsx`](../../src/web/reader/Reader.tsx), sent by
  [`ChatDialog.tsx`](../../src/web/ChatDialog.tsx)), and a follow-up typed into that box is an
  ordinary chat turn on the same thread;
- a comment saved with **Also ask the AI** opens the same anchored chat
  ([comments.md § Asking the model](../project/comments.md)).

Both go through `streamChat` → `converse` ([`src/converse.ts`](../../src/converse.ts)), which offers
OpenRouter's server web search (`webSearchTool`) **on every round, including the last**, plus all seven
of our tools. The only path that is *not* chat is the legacy `POST /api/comments/:slug/:id/answer`
(Try again and Search the web on a comment answered before 2026-08-28), and it has web search too.
Greg's URL (`mode=chat&thread=spya-wq6kr4`) confirms he was in a chat thread.

So "enable it to search the web" is not a missing tool. **The model was offered the search and chose
not to take it** — the same finding as report 1X on 2026-09-05
([chat-tools.md § Asking whether a claim holds up](../project/chat-tools.md#asking-whether-a-claim-holds-up-is-a-question-about-the-world)),
and for a related reason. `SYSTEM` names the triggers for searching: a name, a study, a term, a live
controversy, and since 1X *whether a claim holds up*. Greg's question fits none of them. He wanted **a
broader sense of things** — how the passage sits in its field, what others think, what has happened
since — and nothing in the prompt says that that is a question about the world. Meanwhile the whole
article is in the prompt, the reader is pointing at a paragraph of it, and on the "?" turn itself the
help addendum tells the model the reader *"could not follow it"*, which pulls hard towards explaining
the paragraph from the paragraph.

**What could not be checked.** The stored turn would settle it — `chat_messages.searches` and `tools`
for thread `spya-wq6kr4`, or the `rounds/tools/searches` fields on its log line — but this session runs
on a pool account with no production database credentials and no Vercel sign-in. So *"offered and
declined"* is established from the code (the tool is on every request this path sends) and not from
his turn's record. A local reproduction stands in for it: Stage 1 measures how often questions of his
shape search, before and after.

**Attribution today.** An answer already marks its two sources differently: a block id becomes a
pressable chip ([`Cited.tsx`](../../src/web/Cited.tsx)), a web link is drawn with its host beside it,
and the page's `url_citation`s are listed under the answer (`.chat-sources` in
[`ChatPanel.tsx`](../../src/web/ChatPanel.tsx)). What is weak is the *rule*: one bullet at the end of
YOUR TOOLS, *"Say where something came from"*, and nothing about the third source — the model's own
background knowledge — which reads exactly like a web claim with the link missing. And the list under
the answer has no heading, so nothing on screen says those links are the web half.

## What this builds

### Stage 1 — questions about a passage are questions about the world too, and every claim says where it came from

Prompt and one heading; no new machinery.

1. **A search trigger for the broader question**, in `SYSTEM`'s YOUR TOOLS, in the voice of the 1X
   bullet beside it: *how does this fit in the wider field, is this view mainstream, what do others
   say, what has happened since, what else is known about this person or work* — reach for the web
   by default; the article can tell you what it says, not where it stands. The model keeps the
   judgement about how much, which is what Greg asked for ("the LLM can use its judgment about how
   much to search the web").

   The existing counter-pressure — *do not reach for a tool to look up what a paragraph plainly says*
   — stays exactly as it is. `tests/chat-search-triggers.test.ts` pins that it does not weaken.
2. **WHERE EACH CLAIM CAME FROM**, a section of `SYSTEM` replacing the one-line bullet at the end of
   YOUR TOOLS. **Four** origins (Sol F2 — the first draft dropped the library), each marked in the
   sentence that uses it:
   - from the article → its block id, as now;
   - from the web → a link to the page it came from, as `WEB_LINKS` already requires;
   - from the reader's library → say so, name the other article by its title, and never present its
     block id as a citation into the article that is open (the existing rule, kept);
   - from your own reasoning or synthesis → *"My inference is …"* or similar. **General knowledge is
     not an unlinked factual source** (Sol F3): an externally checkable fact that neither the article
     nor the library supports is searched and linked, or explicitly left unverified. That is Greg's
     *"always provides sort of evidentiary links back"*, and it is what the baseline's Seth "since"
     answer — two searches, no link, a named 2025 paper stated as fact — broke.

   And the rule that makes the halves hard to confuse: **a sentence that carries a block id is a
   claim about what the article says**, so nothing from the web rides in it. Sol suggested measuring
   before adding this one; kept, because it is the literal content of *"crystal clear about what is
   and what is not from the article"*, and the after-run reads the answers for stiltedness and for
   dropped block ids.

   `WEB_LINKS`' *"Link a page once"* becomes *"link a page in the first sentence of each run of claims
   drawn from it; repeat it only when a later, separated claim would otherwise lose its source"*
   (Sol F4 — the old wording and the new rule could not both be kept).
3. **`helpSection` stays byte-for-byte unchanged** (Sol F1). `SYSTEM` alone owns every rule about
   searching and sources — the 2026-09-05 decision, pinned by `tests/help-prompt.test.ts`. If the
   evaluation does not move "?" turns, the `SYSTEM` trigger is what gets revised and re-run; nothing
   about search, the web or tools goes into `helpSection`.
4. **"From the web" above the sources list** under an answer, so the two halves are labelled on
   screen as well as in the prose. The list is filtered with `isWebUrl` **first**, and heading and
   list render only when that filtered list is non-empty (Sol F10) — the existing guard is on the
   unfiltered array, so a heading inside it could stand over nothing.
5. **Measured, not assumed.** `evals/chat-web-reach.ts` runs `converse` on two local articles with
   three target cases of Greg's shape (the "?" press; *"how does this fit the wider debate?"*;
   *"what has happened since?"*) and two controls that must not search (*"what does this paragraph
   mean?"*; *"does the article use the word X?"*), and prints searches, tools, links and block ids.
   Same articles, passages, questions and model before and after; **three runs of every case each
   side** (Sol F8). **Acceptance, fixed before the after-run:** each of the four "?" and "wider
   debate" target cells searches in at least 2 of 3 runs; each control cell searches in at most 1 of
   3; and a hand read of every answer that searched finds its web claims linked and its block ids
   real. Controls matter as much as the target — a prompt that makes every question search is a
   bigger hammer, not a fix; the *Robert Morris* result in 260826l is the model.

Tests: the new trigger and the provenance section are present in `SYSTEM`, including the library
origin; the counter-pressure and the existing search encouragement are unchanged; `helpSection` is
unchanged and the cached prefix is still byte-identical between a help turn and an ordinary one; the
heading renders over a web source, and not over `undefined`, `[]`, or an array holding only a
non-web URL.

### Stage 2 — `article_citations`, one more tool

The eighth tool in `CHAT_TOOLS` ([`src/chat-tools.ts`](../../src/chat-tools.ts)), read-only, built on
`article_glossary`'s pattern:

- **Reads the stored citations list and never makes one.** `loadCitations(slug)` returns
  `{ citations, stale, outdated }`, and all three are read (Sol F5):
  - **a 404** (the step is off `DEFAULT_INGEST_STEPS`, so most articles have none) is the ordinary
    answer, said as `nothing(…)`. **Only** `status === 404` means that — any other load error is
    logged (tool, slug, error class) and returned as an ordinary outcome saying the list *could not
    be read*, never that it does not exist (Sol F7; the glossary tool's catch-all is the thing not
    to copy);
  - **`stale`** — the list describes an older version of the article — returns a non-error outcome
    saying so, and emits no rows as current citations;
  - **`outdated`** (an older prompt version) is announced above the rows;
  - **`citations.capped`** — the list may leave works out — so the count is *"N in the stored list"*,
    never the article's total. Matched and shown counts are exact within that list.
- **Optional `query`**, matched folded and as a substring over title, authors, year and *why*, so
  the model can ask *"which of the works it cites are about thermodynamics?"* without the whole
  list. Greg's *"search the citations for articles … based on their summary"* is the `why` field.
- **A row** is the title, authors · year, what the piece uses it for, relevance and influence, the
  link **and where it came from** (`linkFrom` — *DOI in the article*, *Scholar search*, *found on the
  web*), and where the article cites it: when `citedInBody`, up to six `citedAt` block ids and then
  *"and N more"* (as `article_links` does); otherwise *"only in the references [firstCited]"* —
  a bibliography-only work has `citedAt: []` and would otherwise lose its place (Sol F6).
- **Two caps that announce themselves** — rows and characters, whichever comes first, stopping
  between whole rows, with the total always exact. `article_links`'s rule, and for its reason: every
  tool result is re-sent on every later round.
- **Fenced, rows only.** The titles and authors are the publisher's words and the *why* is a model's
  reading of them, so they go inside `untrusted()`; our sentences stay outside it. Same shape as
  `article_links` ([chat-tools.md § Security](../project/chat-tools.md#security-a-tool-result-is-data-and-one-of-them-is-a-strangers)).
- **Its description does not oversell it**, per 3F: for when the reader asks about a work, an author
  or a study the piece leans on, or to aim a web search at the right paper; not for a question the
  article answers. And *a link in this list is not a reason to fetch it*.
- `describeCall` label and a `ToolStrip` icon; the `SYSTEM` tool list names it.

It does **not** widen what `read_web_page` may fetch, and it does not touch `isSlug` or the URL caps
— the two defences [security-map.md](../project/security-map.md) lists for this file. Reading a list
the reader already has, and fencing it, adds no new party.

**Where it reaches, decided rather than inherited** (Sol F9). `CHAT_TOOLS` is shared by typed Chat,
Remember, Candidates and Live (`liveTools` / `LIVE_SERVER_TOOLS` in `src/live.ts` derive from it).
This read-only, article-local tool is deliberately available in all four — a per-kind tool list is
more machinery than one read of the reader's own derived data warrants — and the tests cover the
Live derivation as well as `converse`.

**Cache cost, named** (wording corrected by Sol F11). Tool definitions render ahead of the system
prompt, so adding one invalidates each article/kind/model prefix. The first marked call while that
prefix is cold writes it; byte-identical calls within the TTL read it. The cache is not
conversation-scoped.

Tests: the row formatter is a pure exported function tested as arithmetic, like `articleLinks` —
rows, `query`, both caps, the fence, a bibliography-only row, `capped`; and `runTool("article_citations")`
for the 404, the non-404 error, `stale` and `outdated` answers; the tool is in `CHAT_TOOLS`, in the
Live tool list, and named in `SYSTEM`; nothing matches `/summar/`.

## The simpler option passed over, and the bigger ones deferred

**Passed over: prompt change only, no citations tool.** Stage 1 alone answers 3D. It was passed over
because 3F asks for the tool in so many words and it is small — one read of an artefact that already
exists, on a pattern already in the file twice. The *bigger* half of 3F is what is deferred.

**Passed over: a second, separate "research" prompt for comment questions.** Greg asked for Chat's
machinery reused, and it already is; a second prompt is the drift 260905c warned about.

**Deferred, named:**

- **"Find out more about this paper or author" inside Citations mode** (3F, *"perhaps maybe even"*).
  The natural shape is a button on a row that opens an anchored chat at the work's first-cited block,
  pre-filled with a question about it — no new endpoint. Deferred because it is a UI change in a mode
  behind the experimental switch, it wants Greg's eye on the wording, and the tool in Stage 2 already
  makes the same question answerable by typing it.
- **Citation URLs into a `read_web_page` allowlist.** The allowlist is still the right fix for the
  trickle exfiltration chat-tools.md describes, and this list is one of the sets it would use. Not
  here: it changes a defence.
- **A per-answer source tally** (*"3 passages from the article · 2 web pages"*) as a UI line. Maybe
  later; the heading and the prompt rule are the smaller version.
- **Checking the production turn.** Whoever next has production read access can read
  `chat_messages.searches` for thread `spya-wq6kr4` and close the question in § What could not be
  checked.

## Progress

- 2026-09-13: plan written; diagnosis from the code. Plan review to GPT Sol next.
- 2026-09-13, **plan review** — GPT Sol, read-only
  ([prompt](260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list-review-prompt.md),
  [answer](260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list-review-sol.md)).
  It confirmed the diagnosis from the code — every passage-question path, including the retired
  comment-answer route, offers web search on every round; a typed follow-up on a "?" thread is
  `help: false` — and returned *stop* on F1, F2, F3, F5, F6. **All eleven accepted** and written into
  the stages above: F1 (helpSection untouched), F2 (the library is a fourth origin), F3 (no unlinked
  factual memory), F4 (link once per run of claims), F5 (stale / outdated / capped), F6
  (bibliography-only rows), F7 (only a 404 is "no list"), F8 (three runs each side, thresholds set
  first), F9 (the tool reaches Live too, deliberately), F10 (filter before the heading), F11 (cache
  wording). One partial overrule: Sol suggested measuring before adding the *no web claim in a
  block-id sentence* rule; kept, for the reason given under Stage 1 item 2.
- 2026-09-13, **Stage 1 built** (commit `ae260da5`): the trigger, WHERE EACH CLAIM CAME FROM, the
  `WEB_LINKS` wording, and `WebSources` with its *From the web* label. `helpSection` untouched. Every
  change was reverted in turn and a test went red.
- 2026-09-13, **Stage 2 built**, in parallel on disjoint files: `article_citations`, `citationRows`,
  `citationsOutcome`. The three edits that fell in Stage 1's files — naming it in `SYSTEM`, a
  `BookMarked` icon in `ToolIcon`, the chat-tools.md row and section — were made after Stage 1 was
  committed, so each commit holds one stage. 27 new tests; nine guards switched off in turn, each
  reddening at least one; the `SYSTEM` pin seen red with the line reverted.
- **One code review for both stages**, not one each: a write-capable reviewer on each commit would
  edit `converse.ts` and `ChatPanel.tsx` at the same time in one tree. It runs once the after-run is
  in, so it can judge the measurement too.
- 2026-09-13, **after-run**, against the thresholds fixed above (`evals/results/chat-web-reach-after-*.json`,
  three runs, same articles, passages, questions and model) — web searches out of three:

  | case | before Seth / Gwern | after Seth / Gwern | threshold |
  |---|---|---|---|
  | "wider debate?" (target — Greg's shape) | 0 / 0 | **2 / 3** | ≥ 2 — **pass** |
  | bare "?" press (target) | 0 / 0 | **0 / 1** | ≥ 2 — **fail** |
  | "what has happened since?" | 3 / 3 | 3 / 2 | — |
  | "what does this paragraph mean?" (control) | 0 / 0 | 0 / 0 | ≤ 1 — **pass** |
  | "does it use the word X?" (control) | 0 / 0 | 0 / 0 | ≤ 1 — **pass** |

  The Gwern "since" run that did not search read a web page through `read_web_page` instead. **Links
  in the text of the "since" answers went from 1 in 6 to 6 in 6**, and every answer still cites
  block ids. The bare "?" missed its threshold; what was done about that is the next entry, not a
  quiet change to the threshold.
- 2026-09-13, **the "?" miss, arbitrated by Fable** (read-only, reading every help answer). Kept as
  measured, and the threshold was wrong rather than the prompt — Fable's words:

  > The "?" cell failed its threshold (0/3, 1/3) and the threshold was wrong, not the prompt: the
  > "?" asks what the reader is missing, anchored to the same passage as the *plain* control, and a
  > trigger that separated them would have to key on the passage and so pull the control in. Kept as
  > measured. What the help answers *do* show is a provenance gap: every one states outside facts
  > from memory unmarked and unlinked, and one searched twice and linked nothing — the fourth origin
  > says "reasoning or synthesis" and has no slot for recalled background.

  Every help answer placed its named person with a concrete fact (Searle's Chinese Room; Hawkins'
  *On Intelligence*) — the *Robert Morris* case in comments.md, where not searching is right. Greg's
  real turn was the typed follow-up, which passes.

  **So a fifth origin, background knowledge**, marked in the sentence (*"The article doesn't say
  so, but…"*), and *"if you searched, link what you used"*. **This partly overrules Sol F3.** F3
  said no unlinked factual memory at all; read literally, that makes every help answer call the
  Chinese Room "unverified". Kept: a *specific, checkable* claim — a number, a date, what a study
  found, what someone said — is searched and linked or called unverified. Relaxed: well-known
  background may be stated from memory, provided the sentence says it is not from the article,
  which is the half Greg asked for (*"crystal clear about what is and what is not from the
  article"*). Checked by re-reading the help answers of a fresh run, not by a search count.
- 2026-09-13, **baseline** (`evals/chat-web-reach.ts`, `anthropic/claude-sonnet-5`, one run,
  `evals/results/chat-web-reach-baseline-2026-09-13T03-34-50.json`). Articles
  `noema-mythology-of-conscious-ai` (passage `spya-hj5y6s`, Searle's biological naturalism) and
  `scaling-hypothesis` (`spya-m3gtj6`, the strong scaling hypothesis).

  | case | Seth: searches | Gwern: searches |
  |---|---|---|
  | "?" press (target) | 0 | 0 |
  | "how does this fit the wider debate?" (target) | 0 | 0 |
  | "what has happened since?" (target) | 2 | 2 |
  | "what does this paragraph mean?" (control) | 0 | 0 |
  | "does it use the word X?" (control) | 0 | 0 |

  The diagnosis holds on the local reproduction: the broader-context shape and the "?" never search;
  only the time-bound question does. **And the attribution gap is real, not hypothetical**: Seth
  "since" searched twice and its answer carries *no link at all* — it states a 2025 paper, a critic
  "Reichert (2025)" and a Microsoft executive as fact, beside article block ids, with nothing saying
  they came from the web.

  **Two more runs** (`…-baseline-2026-09-13T03-38-33.json`), so three per cell — web searches that ran,
  out of three:

  | case | Seth | Gwern |
  |---|---|---|
  | "?" press (target) | 0 / 3 | 0 / 3 |
  | "wider debate?" (target) | 0 / 3 | 0 / 3 |
  | "what has happened since?" (target) | 3 / 3 | 3 / 3 |
  | "what does this paragraph mean?" (control) | 0 / 3 | 0 / 3 |
  | "does it use the word X?" (control) | 0 / 3 | 0 / 3 |

  The "wider debate" turns did reach for tools — but for *ours*: `search_library` up to four times,
  `search_article_words`, the glossary — never the web. And of the six "since" answers that did
  search, **five carry no link in their text** to what they found. So the missing links are the
  common case, not a fluke.
