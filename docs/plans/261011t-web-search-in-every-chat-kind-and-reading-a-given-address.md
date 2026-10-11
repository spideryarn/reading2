# Web search in every chat kind, and reading an address the reader gives

Report `spya-drbkvc` (#560, Sentry `SPIDERYARN-READING2-H9`), an admin's, 2026-10-11T01:40Z. Queue
item `qi-bj329ze3`.

> My understanding is that chat mode has a way to kick off web searches. It should also be able to,
> you know, look at specific URLs as well. Secondly, I think some of our chat sub modes, like maybe
> in the learn mode, perhaps recall or something like explore. I saw a user ask a question that
> would have benefited from a web search because they were trying to sort of situate the current
> article relative to others, and it wouldn't do the web search. I think we should allow web
> searches in all of the chat modes because very often users are going to wanting to be situating
> this article relative to other stuff on the web, and it's too strict and limiting to hobble the
> agent.
>
> — Greg, 2026-10-11

## What is there today

Read from the code on 2026-10-11 (`webSearchTool` and `roundTools` in
[`src/converse.ts`](../../src/converse.ts), `toolsFor` in [`src/chat-tools.ts`](../../src/chat-tools.ts)):

| Kind | Web search offered | `read_web_page` offered | What the prompt says about going outside |
|---|---|---|---|
| Chat | yes | yes | search by default for anything about the world |
| Learn › Recall (`learn`) | yes | yes | **stay in the article**; reach out only when the reader's own words do; *"Do NOT search to check the article against the world unless asked"* |
| Learn › Tutorial | yes | yes | stay in the article; reach out only when the reader brings something in or asks |
| Learn › Explore | yes | yes | search readily, to place the piece in the world |
| Referee › Candidates | yes (Exa) | yes | its own rules |
| The guide (Chat's sub-mode) | **no** | **no** | *"You cannot search the web or read any page"* |
| Live (voice) | no (realtime has no server search) | Chat's tools or the guide's | out of scope, see below |

So the two halves of the report are not what they sound like:

1. **Reading a specific URL already exists.** `read_web_page` has been a chat tool since 2026-08-26,
   behind `fetchDocument`'s private-address guard, the URL-length cap and the `untrusted()` fence
   ([chat-tools.md § Security](../project/chat-tools.md#security-a-tool-result-is-data-and-one-of-them-is-a-strangers)).
   Its description never mentions an address the reader hands over, but the baseline below found
   every kind that has it reading such a page 2 of 2 times anyway. Every kind but the guide has it.
2. **No *typed* Learn sub-mode lacks web search.** All three have the tool. If the conversation Greg
   saw was typed, what stopped the search is most likely the *prompt*: Recall and Tutorial are told
   to stay in the article, and "situate this piece among others" is not on either list of reasons
   to leave it. The only typed kind with no web search at all is the guide. **Spoken Recall is the
   known exception**: Live runs Recall (and Chat) on OpenAI realtime with `CHAT_TOOLS`, which
   includes `read_web_page`, but with no provider web search (`liveTools`, `src/live.ts`) — GPT
   Sol's F1 on this plan.

I could not identify the conversation Greg saw (the production read did not get through this
session's sandbox), so the diagnosis is from the prompts, unproved for that conversation, and the
eval measures whether the prompt change moves the behaviour.

## What changes

**What shipped is B, and a line in the guide's prompt. A was built, measured, and backed out**; it
has its own section below, [§ The guide](#the-guide-tried-and-backed-out).

**A. ~~The guide gets web search.~~ Backed out.** As first planned: `webSearchTool("guide")` returns
Chat's default-engine search, the guide's prompt says when to use it, and it gains `WEB_LINKS` and
`CLAIM_ORIGINS`. What ships instead is one paragraph in the guide's YOUR TOOLS: Chat can search the
web and open a page; when the reader asks about the world around the piece, or gives a page, say
in a sentence that Chat can look it up, offer Chat as a next step, and help with what the piece
itself says about where it stands. Before, it said only "I can't search the web from here".

**B. Recall and Tutorial: situating the piece is a reason to search.** Each prompt's list of reasons
to leave the article gains one: *the reader asks where the piece stands — how it relates to other
work, what others have said about it, what has happened since — search the web, answer briefly,
link what you used*; after the first measurement, *ALWAYS search the web for this … You may search
their library as well, but never instead*, because both had answered from the reader's library
alone. Recall's *"Do NOT search
to check the article against the world unless asked"* **stays**, deliberately: Recall exists to test
the reader's memory of *this* piece, and a model that goes off unprompted to fact-check the author
turns the reader's recollection into a seminar on whether the piece is right. That rule is about the
model's own initiative; Greg's report is about the reader's question, and the two do not conflict.
Tutorial's "stay in the article" opening likewise stays, with the same new exception. The length
rules stay — a situating answer in Recall is still a short turn that points at the passage, not an
essay; for a long one it already says Chat is the place.

Recall and Tutorial do not get `CLAIM_ORIGINS`: both already carry `WEB_LINKS`, and adding the whole
section to two short-turn prompts is more text for a case the one-line instruction ("link what you
used") covers. Explore already searches readily, and is unchanged.

**C. ~~An address the reader gives is a reason to read it.~~ Dropped after the baseline.** The plan
was one clause in `read_web_page`'s description and a bullet in Chat's prompt. The baseline (below)
found Recall, Tutorial and Explore each already reading the page the reader handed over, 2 of 2
times, with no instruction — so the clause would have changed wording and nothing else, in a file
[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
lists. Chat's tool and description are the same ones. Nothing in `src/chat-tools.ts` changes.

**D. Not built: `read_web_page` for the guide.** Giving the guide the page tool means adding it to
`GUIDE_TOOL_NAMES`, which changes `toolsFor("guide")` — the list `runTool` treats as a boundary, so
a listed defence. Greg's words authorise web search in every mode; for reading URLs they name only
Chat, which already has it. So it goes to Greg as a question file, `q-w26r6u`, which since A was
backed out asks about the guide's search and page-reading together.

**Out of scope: web search in Live.** A voice conversation runs on OpenAI realtime, which has no
provider-side search; giving it one is its own project
([live-conversation.md](../project/live-conversation.md)), and it gets an overseer-queue entry so it
is not lost. Nothing here reaches Live: its tools are `CHAT_TOOLS` and `GUIDE_TOOLS`, which do not
change, and its prompts are its own. The URL-exfiltration gap recorded in
[chat-tools.md § Still open](../project/chat-tools.md#still-open) — no allowlist, only the query cap
— is unchanged by this plan in either direction.

## Cost

Web search is metered per call already: `webSearches` on the `ai_calls` row
([cost-tracking.md](../project/cost-tracking.md)), so nothing new is needed to see it. Recall and
Tutorial searched before when the reader asked about something from elsewhere; they now search on
one more kind of question, capped like Chat's (`max_results: 5`; `max_uses` is not a hard cap, as
`webSearchTool`'s comment records). The guide spends nothing new. The whole measurement here,
about 150 turns, cost roughly $6 on the local ledger.

## Stages

1. **Code and prompts** — B, and the guide's Chat line (A backed out, with its edits to
   `tests/guide-kind.test.ts`, `tests/guide-route.test.ts` and `tests/guide-next-steps-tool.test.ts`).
   `tests/web-reach-every-kind.test.ts` pins Recall's and Tutorial's new reason, the guide's Chat
   line, that Recall's *"Do NOT search, unprompted, to check the article"* is still there, that
   every kind but the guide has web search and `read_web_page`. Each new assertion seen red first.
2. **Measure** — built and baselined *before* stage 1 touches a prompt (Sol's F3).
   `evals/chat-web-reach.ts` gains `--kind`, and for the non-Chat kinds a case set written for
   them: `situate` and `since` (targets, unanchored), `url` (a page the reader hands over; counts
   `read_web_page`, not scored for the guide, which has no page tool), `remember` and `word`
   (controls). Every non-Chat kind gets a neutral saved reason; the guide also gets the route's
   `saved` fields and an experience bucket, so its baseline measures searching rather than a turn
   spent asking why they are reading. Two runs each, before and after, for `learn`, `tutorial`,
   `explore` and `guide`. The result goes in this plan.
3. **Docs** — chat-tools.md (§ Web search, the guide's lines); learn-mode.md states no tool rule
   for Recall, so it is unchanged; the question file; the feedback note.

GPT Sol reviewed this plan read-only before stage 1
([plan-review-sol](261011t-web-search-in-every-chat-kind-and-reading-a-given-address-plan-review-sol.md),
BUILD WITH CHANGES; all six findings taken, as above), and reviews the code before the push.

## The simpler option, passed over and then taken

**Prompts only, leaving the guide alone.** It fixes the case Greg saw (a Learn sub-mode not
searching) with no tool-list change at all. It was passed over at first because Greg asked for
*all* chat modes and the guide is the one that cannot search. It is what shipped, once the guide
with search turned out to tell readers it had not looked anything up; the guide's half is
`q-w26r6u`.

## Results

`evals/chat-web-reach.ts --kind <kind>`, two articles × five cases per run, anthropic/claude-sonnet-5.5
on the `standard` tier, results in `evals/results/chat-web-reach-<kind>-<label>-*.json`. "Searched"
is how many answers ran at least one web search; "read" how many called `read_web_page`.

| Kind | Case | Baseline (2 runs) | After, first wording (2 runs) | After, final wording (2 runs) |
|---|---|---|---|---|
| Recall | situate — target | **0/4** searched | 2/4 | **2/4** |
| Recall | since — target | 4/4 | 4/4 | 4/4 |
| Recall | url — target | 4/4 read | 4/4 read | 4/4 read |
| Recall | remember, word — controls | 0/8 searched | 0/8 | 0/8 |
| Tutorial | situate — target | **0/4** searched | 3/4 | **4/4** |
| Tutorial | since — target | 4/4 | 4/4 | 4/4 |
| Tutorial | url — target | 4/4 read | 4/4 read | 4/4 read |
| Tutorial | remember, word — controls | 0/8 searched | 0/8 | 0/8 |
| Explore (unchanged, 1 run) | situate / since / url | 2/2 · 2/2 · 2/2 read | — | — |
| Guide with search (A, 1 run baseline) | situate / since | 0/2 · 0/2 (no tool) | 2/4 · 3/3, one turn failed | backed out |

**Recall's two misses** were both on the Seth essay, where the reader's library holds a survey that
places it ("A landscape of consciousness"): Recall searched the library, read the passage, and
answered from it. On the Gwern piece, where the library had nothing, it searched the web both
times. That is a reasonable answer, and pushing further means changing `search_library`'s own
description ("whenever a connection to their own reading would be worth more than a fact from the
web"), which is in `src/chat-tools.ts`; not done. The baseline reproduced Greg's report exactly:
asked where the piece sits, neither Recall nor Tutorial searched once in eight tries, and both
searched the library instead.

The guide's final wording (no search, points to Chat) is the `final` run:
`evals/results/chat-web-reach-guide-final-2026-10-11T11-37-37.json`, one run. All six target answers
(situate, since, url) say Chat can look it up, most also name Sources › Reception, and then point
into the piece's own account of where it stands; none of the four controls mentions Chat; no
failures, one round each. Before, the same questions got "I can't search the web from here". The
eval keeps tool names, not the steps offered, so whether Chat was among the next-step buttons is
not recorded (one answer says "Press Chat below").

## The guide, tried and backed out

Built as A, then measured. On "what has happened with this idea since?" the guide's rounds went:

```
round 1  0 chars of prose · 1 web search · offer_next_steps
round 2  0 chars          ·              · offer_to_save
round 3  0 chars          · 1 web search · offer_next_steps
round 4  "I haven't looked this up, so I can't tell you reliably what has happened since…"
```

Reproduced in most of a dozen tries (raw stream inspected); in the eval one turn failed outright
with `ai-tool-loop`, four rounds of one call and no words, after `roundTools`' guide branch had been
removed. **The mechanism:** OpenRouter's search runs inside one provider response and its results
are never returned to us as messages (the default engine emits `url_citation` annotations only when
the model attributes in prose). The guide is told to end every answer by calling
`offer_next_steps`, and when it searched it called that tool *first*, with no prose. `converse`
then builds the next round from an empty assistant message and our tool results, so whatever the
search found is gone, and the round that finally writes says it never looked. A sentence telling it
to write first and offer the steps after did not help (3 of 6 still ended "I haven't searched").
Chat never meets this because it writes in the round it searches.

GPT Sol's consult
([guide-consult-sol](261011t-web-search-in-every-chat-kind-and-reading-a-given-address-guide-consult-sol.md))
recommends, for the guide only: Exa as its engine (annotations arrive at search time, with url, title
and extract), collect them with the existing `collectSearchEvidence`, and on exactly the shape above
(searched, Exa evidence, no prose, every call settled, accepted next steps last) append the evidence
as an app-authored, fenced message and force one more round with `tool_choice: "none"`. About half
a day, and its first step is a wire probe that annotations still arrive when the round ends in one
of our calls. **Not built here**: it adds a recovery branch to `converse`'s loop and a second
engine, which is complexity Greg should choose rather than inherit, and the guide's job is how to
read the piece. The question is `q-w26r6u` (with page-reading for the guide, the other thing its
tool list lacks), and the work is queue item `qi-zvsky2aj`.
