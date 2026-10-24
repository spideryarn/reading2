# A citation's card streams a note on what this paragraph cites the work for

Report `spya-mxk20e` (#678), Greg (admin: `feedback-reporter.ts` exit 0), 2026-10-23 22:15 UTC, a
suggestion, filed from `/read/effective-expressiveness-spya-z8dehh?mode=structure&thread=spya-tt3zzc`:

> I think any time I hover over a source, let's automatically start, you know, initiating some kind
> of deeper dive, which could be the same as initiating an ask in chat with a default input and just
> stream in the response so that I can just hover over a source or a link or whatever and find out
> more without having to click and ask for it and be taken somewhere else.

The brief added: cost matters. A model call on every hover is expensive and noisy, so design the
trigger (a dwell, a per-source cache, a cap) and name the trade-off. If there is a real product
choice, ask, and build the simplest version meanwhile.

## What is already there

- **A link already does this.** Hover a hyperlink in the prose and, once the server has fetched the
  page, the card streams *in relation to what you're reading*: what is on the other end and how it
  stands to the paragraph the link sits in (`/api/link-summary`, [links.md § And what it has to do
  with the piece in your hands](../project/links.md#and-what-it-has-to-do-with-the-piece-in-your-hands)).
  Quick tier (GPT Luna), measured at **$0.00015 a call**, cached per reader, article, address and
  paragraph for a fortnight, capped at 30 fills an hour, 100 a day per reader and 1,000 a day across
  everybody. The "or a link" half of the report is therefore already met, with two known gaps
  (an article already on the shelf, a page we could not fetch), both left as they are here.
- **A citation does not.** The card on a cited work (`CiteCard` in
  [`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx)) shows the title, authors, the article's
  own entry, the stored *note from the abstract* where there is one, and the jumps to each citing
  paragraph, plus three presses: *Ask in chat*, *Does it say that?* and *Open in Sources*. All of
  that is stored, nothing is written on hover, and anything deeper is a press that leaves the card
  for Chat ([bibliography.md § Marked in the prose](../project/bibliography.md#marked-in-the-prose-in-every-mode)).

So the gap the report names is the citation card: hover, and something deeper arrives without a
press and without leaving.

## What we build (the simplest version, without waiting for Greg)

**The citation card gets the link card's section, for a cited work.** When the owner rests on a
citation in a paragraph that cites the work, and stays for a moment, a short note streams into the
card under a label like the link card's, *in relation to this paragraph*:

```
┌──────────────────────────────────────────────┐
│ Attention Is All You Need ↗                  │
│ Vaswani et al. · 2017                        │
│ The Transformer replaces recurrence with…    │  ← the stored abstract note (as now)
│   From the abstract · arXiv                  │
│ ✦ in relation to this paragraph              │  ← new, streamed
│ Cited here as the source of the claim that   │
│ self-attention alone suffices for…; the      │
│ abstract's "dispensing with recurrence…"     │
│ bears that out. ▍                            │
│ cited in 4 paragraphs: 1 2 3 4               │
│ arxiv.org · …     Does it say that? 💬 Open  │
└──────────────────────────────────────────────┘
```

What the note says, and what it may rest on:

- **The role the work plays in this paragraph**, said specifically: the source of a claim, a method
  or dataset borrowed, an example, a contrast, a position argued against, background. That is about
  *the article*, so it does not breach Greg's 2026-10-03 rule for this mode, *"err on the side of
  saying … nothing about a paper beyond what's available in the bibliography"*.
- **Whether what we hold of the work bears the paragraph out**, only from what was fetched from a
  public catalogue and checked: the stored abstract note's sentences and the abstract quotes code
  found for them. Where we hold nothing of the work beyond the article's own entry, it says the role
  and stops. The prompt forbids the model's memory of the work outright, as the abstract notes'
  prompt does.
- **The link card's test**, adapted: if what you wrote would be just as true for any paragraph that
  cites this work, it is the wrong answer.
- Plain prose, under about seventy words, no markdown. Article text and the entry are fenced as data
  (they come from the web, [security-map.md](../project/security-map.md)); **no tools on the call**.

**The trigger, and why it is cheap enough to fire on hover:**

- **Owner only, and only on a card opened from a body paragraph that cites the work** (`here` is in
  `work.citedAt`, the condition *Does it say that?* already uses). Not on the reference entry, not
  for a visitor, not in a chat answer.
- **A dwell.** The card opens after 320 ms (`HOVER_DELAY.open`). The note is asked for only once the
  card has been open a further **600 ms**, so a pointer crossing a paragraph on its way somewhere
  else buys nothing. A tab already holding the answer shows it at once.
- **Cached on the server per reader, article, work and paragraph**, for a fortnight, and checked
  against fingerprints of everything the prompt carried (the work's entry and note, the paragraph
  and the article's gist, the reader's profile, the prompt version and the model). A second hover,
  in any tab or next week, costs nothing. A tab cache in front of it, fenced and emptied on a profile
  save, as the link card's is.
- **Its own bucket in the limiter**, `cite-note-fill`, with the link card's numbers: 30 fills an hour,
  100 a day per reader, concurrency 2, a global daily fuse of 1,000. Quick tier, low effort, the same
  model as the link card.
- **Cost**: the prompt is smaller than the link card's (a paragraph, an entry and two sentences, no
  page), so about $0.0001 a fill. An article with 40 cited works, each hovered once in each of two
  paragraphs, is under a penny; the daily fuse bounds a runaway at about 10p a day.
- **A failure draws nothing**: no spinner before the first word, no error line. The card is complete
  without it, which is the link card's rule (`LinkRelation`).

**What it does not do: start a chat.** No thread is created. *Ask in chat* stays the press for the
real deeper dive. Whether a hover should start one is the question below.

## The question for Greg

**Should resting on a source also start a real Ask in chat, streamed into the card?**

- **A — the quick note only (built, recommended).** Under a penny an article, an answer in one to
  three seconds, nothing written into Chat. Shallower: no web search and no reading of the paper.
- **B — also start the real chat after a longer rest (say two seconds), streamed into the card.**
  The full chat model with web search and `read_cited_work`: roughly 2p–10p and 15–60 seconds each,
  and every one becomes a chat thread in Chat's list, so a skim through ten citations leaves ten
  threads. Deeper, and nothing to press.
- **C — A now, and *Ask in chat* answers inside the card** rather than taking the reader to Chat.
  Keeps the press (so the spend is chosen), gives the "without being taken somewhere else" half.

Recommended: A, with C as the next step if the press-and-leave is the part that grates. B spends
real money on accidental hovers and fills Chat with threads nobody asked for.

## Stages

### Stage 1 — the server: `GET /api/cite-note?slug=&work=&block=`, streamed

- `src/cite-note.ts`, shaped on [`src/link-summary.ts`](../../src/link-summary.ts): the prompt
  (`CITE_NOTE_PROMPT_VERSION = 1`), a pure `citeNoteRequest`, the streamed call, and
  `citeNoteStream` with link-summary's order of steps: refuse what is malformed; load the owner's
  article (route, before headers); load the owner's Bibliography and find the work by id; refuse a
  block not in its `citedAt`; read the cache (a hit ends there); claim; take an allowance; call;
  fenced fill. Events: the `LinkSummaryEvent` shape (`delta`, then one of `ready`, `unavailable`,
  `refused`, `pending`), under a name of its own.
- A table `cite_notes`, keyed `(owner_id, article_id, work_id, block_id)`, with link_summaries'
  status/claim/fingerprint/expiry columns, its shape check and expiry index, and its store
  `pg-cite-notes.ts` following `LinkSummaryStore` (the contract's comment says the claim protocol is
  copied deliberately rather than made generic; the plan review may argue otherwise). An additive
  migration. The expired-row sweep, wherever link_summaries' runs, takes this table too.
- Registered everywhere an article-owned table is, beside `link_summaries`:
  `src/store/article-rows.ts`, `src/store/pg-article-transfer.ts` (reader-state),
  `src/admin-articles.ts`, `scripts/never-published-tidy.ts`.
- Registered everywhere a job is: `models.ts` (`cite-note`, quick tier, its env override), the AI
  route and `CHAT_REASONING` (`low`) in `ai-call.ts`, `cost-categories.ts`, the limiter's bucket.
- Tests: the request body (no tools, `max_completion_tokens`), refusals (unknown work, block not
  citing it, a visitor), cache hit spends nothing, the fingerprint test, a red first for each.

### Stage 2 — the card

- A small client loader for the note (tab cache, partial text while streaming, single-flight,
  generation fence, emptied by the same profile save that empties link summaries), reusing the
  stream reader the link card uses rather than a third copy if it can be shared.
- `CiteCard` gets the section, drawn by the same component as the link card's (`LinkRelation`
  generalised to take its label), under the abstract note. Asked for after the 600 ms dwell, only
  for the owner and only when `here` cites the work. Marginalia's card reuses `CiteCard`, so it
  gets it too.
- Tests in jsdom: no request before the dwell, none on a reference entry or for a visitor, the
  stream drawn with its caret, nothing drawn on a failure.
- A browser check by a Sonnet subagent on a real article with citations.

### Stage 3 — docs, the question, the note

- [bibliography.md § Marked in the prose](../project/bibliography.md#marked-in-the-prose-in-every-mode)
  gets the section; [links.md](../project/links.md) a line pointing at it as the citation twin; the
  reader's help page for Sources a sentence.
- The question file (above), published; the feedback note, `ending: awaiting` with a comment saying
  what shipped.

## Simpler options passed over

- **No server cache, the tab's only.** Fewer parts, but every new session pays again for the same
  paragraph, and the report's own brief names caching per source.
- **Reuse `link_summaries` with a made-up target such as `cite:<id>`.** No migration and no new
  store, but a key that means two things by convention is the shape [sql.md](../project/sql.md)
  warns against ("keys over good intentions").
- **Show the stored `why` on every card instead of a model call.** Free, but it is one sentence for
  the whole article, not this paragraph, and it is hidden today unless a verdict checked it, for a
  reason (`showsWhy`).

## After GPT Sol's plan review (2026-10-24)

The review is [261024m-plan-review-sol.md](261024m-plan-review-sol.md) (prompt beside it). No P0;
every finding taken. What changes above:

- **F1: evidence or nothing.** No note on a work without a checked abstract note (`work.blurb`): the
  route answers `unavailable` before it claims or spends, and the card draws nothing. A
  paragraph-only role sentence is the stored `why` again, which is hidden on purpose, and links.md's
  "same failure in a better costume". The note must rest on both the paragraph and the supplied
  sentences and quotes, and speak narrowly ("the abstract excerpt we hold says…", "does not
  establish…"). `webNote` as a second evidence source is a later extension, not v1.
- **F2: one work only.** The note runs only when the open card holds exactly one cited work (a prose
  mark can name several; so can a Marginalia *Cites* line). Tested both ways.
- **F3: fingerprints over exact strings.** Two pure, capped context strings (article + passage;
  work + evidence) are what the prompt carries and what is hashed, plus profile hash, prompt version,
  model. No completed-answer tab cache keyed on `(slug, work, block)` alone: the client keeps only
  in-flight dedupe and lets the server cache answer (a hit is ~90 ms).
- **F4: freshness.** The route refuses unless: owner, not view-as (left off the allowlist, and the
  client's `viewAsNonce()` guard), a **non-stale** Bibliography, a known work, the block a current
  body block of the article, and in `work.citedAt`.
- **F5: everything external is fenced and defused** (title, authors, entry, note sentences, quotes,
  article text), the rule repeated after the fence, no tools, React text only, no full work URL,
  `plainWords("explain")`.
- **F6: the question re-cut** — the real full-chat action to compare against is *Does it say that?*
  (a fresh passage chat that reads the paper), not the work's *Ask in chat*; and "answer inside the
  card" is a second, separate question.
- **F7: the timer lives in a loader mounted only inside an open, eligible, single-work card**:
  920 ms on a cold mouse hover, 660 ms on a warm swap, 600 ms after focus or a tap. Marginalia
  (mouse and keyboard only, its tooltip skips touch) needs the slug plumbed in.
- **F8: a small eval** before calling it done, through the production request function:
  strong/weak evidence, contrast roles, insufficient excerpt, adversarial text; time, tokens, cost.
  Under `docs/investigations/`.
- **F9: own store, own advisory-lock namespace, own bounded sweep** on its own cold-fill path, not
  link-summary's. Own `RateBucket` member and database bucket CHECK.
- **F10:** reuse `readEvents` from `web/lib/sse.ts`; the loader is its own small state machine.

## Then: nothing built, Greg asked first (2026-10-24)

**Measured, read-only, on production**: of 790 cited works across the 72 articles with a stored
`citation_blurbs`, **86 (11%) have a checked abstract note**; 698 have no evidence (mostly no
abstract or no identifier), 4 failed the check, 2 were declined. The article the report was filed
from has one cited work, with no abstract note.

So the v1 above, after Sol's F1 (evidence or nothing), would appear on about one cited work in
nine, and never on Greg's own article. Every version that would reach most works spends on fetching
evidence on a hover (the web-note search, or *Does it say that?*), which reverses Greg's explicit
choice on [q-ny49p3](../user-feedback/questions/q-ny49p3.md), 1B: the web search runs on a press
for the clicked work only, never for every work.

Opus, asked to arbitrate between building the evidence-only v1 now, building something smaller, or
asking first, chose asking first: about a thousand lines of permanent surface for a feature mostly
invisible, and the one decision that makes it worth building is a cost choice that is Greg's. Taken.
The plan and both sections above stay as the build spec for whichever option he picks; the dwell,
cache, cap, single-work and freshness rules carry over to each.

The question is [q-hc4y2j](../user-feedback/questions/q-hc4y2j.md).
