# 261020ac — Chat is told how much of the article you have read

Owned by [plans.md](../project/plans.md). Greg's answer to question
[q-rwkq2e](../user-feedback/questions/q-rwkq2e.md) (report `spya-yyc7te`, queue item
`qi-bkdxh4kb`). Stage 2 of [261020d](261020d-principles-every-chat-shares.md), in the simpler shape
that plan's review asked for.

> I'm leaning towards A. But also perhaps a minimal prompt to tell the chats not too assume too much
> knowledge, unless the user exhibits it in the chat/profile/why-i'm-reading (to be on the safe
> side)?
>
> — Greg, 2026-10-20 16:24 UTC, reply `spya-p9bhxh`

Option A, as the question put it: *"Each chat turn gets a line like 'about a quarter of the piece
read so far', worked out the same way the quiz already decides what you have read. The chat uses it
to pitch its answer and never mentions it. … the privacy page has to say so, and that page changes
first."*

## Status, and what the plan review changed

**Built.** GPT Sol reviewed this plan ([261020ac-plan-review-sol.md](261020ac-plan-review-sol.md),
seven findings, "revise first"). Where the rest of this doc disagrees with this section, this
section wins.

- **F1 (taken):** the line contradicted Learn ("until they say they have read it…") and the guide.
  It now says it *does not count as their telling you they have read any of it*, and that it does
  not say which parts, so those rules stand as they are.
- **F2 (accepted, written down):** the server reads stored totals, which trail the browser by up to
  the 60-second flush; the quiz sees the live figure. On a rough six-step phrase that is within
  "a rough guide", and the alternative (the browser sends a bucket) puts a new field on every path
  that starts a turn. Said in reading-time.md.
- **F3 (taken in part):** "search" and "tool" are gone from the line — a help turn's final message
  may not name either (tests/help-prompt.test.ts). The rule stays beside the data rather than in
  the system prompts: the data is the reader's own, a coarse phrase, and an article that talked the
  model into repeating it would tell the reader something they already know.
- **F4 (taken):** "never mention it" would make a candid chat dodge *"what do you know about my
  reading?"*. Unasked, it is silent; asked, it says plainly what it is told. The eval now records
  every tool argument, adds that question as a case, and asks the judge whether a reply reveals or
  implies the reader's reading unasked. Provider-side web search queries are not visible to the
  harness and are not claimed measured.
- **F5 (taken):** the reading arms use only whole-piece cases (no passage from the second half),
  the result file stores which arm it was, each pair prints what the reader has read, and the judge
  is told it is rough whole-piece evidence and to count a passage-specific assumption as a problem.
  `outside` is out (live search confound).
- **F6 (taken):** gated on the stored thread kind (`thread.kind !== "candidates"`), not on
  `wantsProfile`; privacy.md names the four kinds and the failed-read case instead of "every turn".
- **F7 (taken):** `tests/chat-reading-route.test.ts` — a send, a retry and an edit each carry the
  line, Learn does, Candidates does not, nothing recorded is "little or none" and read totals move
  it; seen red with the route's `reading` removed. `tests/reading-so-far.test.ts` holds the quiz's
  rule, the coarse phrases, no number or id, the help-turn words, and the cached prefix unchanged.
  Tool rounds reuse `base`, so the line is read once per turn by construction.

**The code review** ([261020ac-code-review-sol.md](261020ac-code-review-sol.md), four findings,
fixed in place by the reviewer): F2 corrected the investigation's counts (6 problem notes against
the new wording, not 4; 4 of the 13 tool calls were in line-bearing arms) and bounded "never
leaked" to the runs tested; F3 adds `reading-so-far.ts` to the eval's provenance hashes; F4 adds
tests that Candidates never reads the store, that a failed read answers with no line, and that a
composed help turn keeps its word rule. **F1 was taken in the docs and not on the page**: the
reviewer made `/privacy` name the four kinds and the failed-read case; that is the which-mode detail
Greg asked the page to leave out (2026-10-01), so the page says *"when you chat about one of your
articles"* and `privacy.md § Reading time` carries the precise list.

## What changes

**1. The privacy page first.** In `src/web/PrivacyPage.tsx`:

- The reading-time bullet gains one sentence: when you chat about one of your articles, the AI model
  is told roughly how much of it you have read ("about a quarter", say), and nothing about which
  parts.
- The models paragraph, where it already says the guide is told "roughly how many other articles
  you have opened here", says a chat about one of your articles is also told roughly how much of it
  you have read.
- `LAST_UPDATED` already reads 20 October 2026 (today), so it stays. `docs/project/privacy.md §
  Reading time` records the change and replaces its "reconsider before sending to a model" sentence
  with what is now sent and the rule for anything more (section names, per-part detail: rewrite
  the bullet first).

**2. One line per turn, `READING SO FAR`.** A new `src/reading-so-far.ts`:

```ts
readingSoFarLine(seconds: Record<string, number>, blocks: Block[]): string
```

- **The quiz's rule, not a new one.** Levels by `readLevel(seconds, block.words)`
  (src/web/reading-time.ts), share by `shareRead` (src/web/read-filter.ts) over body blocks only
  (`countsTowardReadingTime`, src/block-policy.ts) — exactly what `Reader.tsx` hands the quiz. Only
  blocks in the current article count, so a removed block's leftover total does not.
  The server already imports pure modules from `src/web/` (src/matter-labels.ts does).
- **Coarse words, not a percentage.** The figure is rough (seconds on screen, not reading), so the
  line says one of: *little or none of it yet* (under 5%), *a small part* (under 15%), *about a
  quarter*, *about half*, *about three quarters*, *most or all of it* (from 87.5%). A percentage
  would invite the model to treat it as precise.
- **Its rule travels with it**, in the line itself, the way the plan proposed:

  ```
  READING SO FAR (a rough guide, from how long each part has been on their screen): about a quarter of the piece.
  Use it only to pitch your answer. Never mention it or what you can see of their reading, and never put it in a search or a tool argument.
  ```

- **Where.** The final user message, beside the profile, below the cache breakpoint — like
  `profile` and `experience`, so the cached article prefix stays byte-identical. A new
  `reading?: string | null` on `ConverseRequest` and `buildConverseMessages`; it goes after `who`
  and `used`.
- **Which turns.** Chat, Learn, Explore and the guide — every kind that carries the principles. Not
  `candidates` (its reader is an editor, and its turns already send no profile): dropped in
  `buildConverseMessages`, the way `notes` is dropped for every kind but Explore.
- **When there is no figure, no line.** The route calls `readingTimeStore.read(slug)` (owner-scoped)
  once per turn, beside `resolveProfileParts`, only when `wantsProfile`. A read that throws is
  logged as a warning and the turn goes on with no line — never "none read", because a failed read
  and nothing read are different facts. A successful read with no totals is "little or none of it
  yet": the reader is chatting with the article open, the client is recording, and the line is no
  stronger than the principle already in force (do not assume they have read it).

**3. One clause in the shared principles.** `CHAT_PRINCIPLES`' fourth bullet, currently *"Do not
assume they have read the piece, or the part you are discussing, unless they say so."*, becomes:

```
- Do not assume they have read the piece, or the part you are discussing,
  unless they say so; nor that they know its field, unless they show it here,
  in their profile or in why they are reading.
```

Greg asked for minimal; this is one clause on the bullet that already holds the closest rule, about
eighteen words. The word cap in tests/chat-principles.test.ts (under 200) moves to under 220 with a
comment saying why. `plainWords` already pitches at "a curious reader who has not studied this
field, unless … the reader's own profile says otherwise"; this extends the same rule to what they
show in the conversation and to why they are reading, and puts it in every chat.

## Measuring it

Per [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change),
on `evals/chat-principles/run.ts` (production's `converse`, the two committed fixtures):

- **The reading line.** A `--reading <none|quarter|most>` flag renders a line through
  `readingSoFarLine`'s wording function and passes it on every case; no flag sends none. Cases: the
  existing `term`, `surrender`, `outside`, `guide-overreach`, `explore-idea`, `learn-overreach`,
  plus two new ones that depend on what they have read: *"What did they find?"* and a question about
  a term from the second half of the piece. Arms, all on the built commit and separated by flag:
  `noline`, `noline2` (control), `read-none`, `read-most`. Pairs `noline` vs `read-none`, `noline`
  vs `read-most`, `noline` vs `noline2`. The blind judge is told what the reader has read (from the
  arm being compared) but not which reply had the line, and asks which is pitched better for that
  reader, and whether either loses or bends a claim.
- **The leak screen, the one that must be zero.** A regex over every reply in the line arms for
  talk of their reading: *you've / you have / you haven't read*, *so far*, *your screen*, *your
  progress*, *a quarter of*, a percentage of the piece. Any hit is read by hand; a real leak blocks
  shipping until the line's wording is fixed.
- **The principles clause.** `before` (current dev) vs `after` on the cases the clause touches —
  `term`, `not-read`, `overreach` (profile: software engineer) — plus two new ones: `expert-term`
  (profile: philosopher of mind, asking a term in the piece) and `jargon-shown` (the reader's
  earlier turn uses the field's vocabulary fluently). Plus `before2` as control. The judge is asked
  whether each reply is pitched to what the reader has shown, neither over- nor under-explaining.
- Two runs each. Budget a few dollars. Written up in
  [261020g](../investigations/261020g-chat-reading-so-far-measured.md).

If the line shows no gain inside the control's spread and no leak, it still ships: Greg chose A,
and the principle it serves is a safety default. If it leaks, the wording is fixed first.

## The simpler options passed over

- **Reuse `readShareLabel` ("about 40%").** One function fewer, but a percentage overstates a rough
  measure to a model that will treat numbers as facts; the quiz shows its figure to the reader, who
  knows where it came from.
- **Compute the share in the browser and send it with the turn.** No server read, but the server
  would then trust a client figure into the prompt, and every client path that starts a turn would
  have to remember to send it. The server already owns the totals.
- **Put the rule in each system prompt rather than in the line.** That changes every cached prefix
  and splits the data from its rule; the line is below the breakpoint and costs nothing in cache.

## Deferred, by name

- **Live** gets no line: its prompt is built once per voice session (the 261020d plan's § Deferred).
- **Section-by-section** (option B) was not chosen.
- **No off switch.** Reading time has none yet; when it gets one, the line goes with it.

## Bookkeeping

`q-rwkq2e`: Greg's reply quoted under the body, `acted: spya-p9bhxh`, `status: answered`. The
report note `261019_2015-the-principles-every-chat-shares.md` keeps `ending: shipped` and its
comment drops "Still waiting on you". `npx tsx scripts/feedback-endings.ts`. Docs:
`prompting-guide.md` or `chat-tools.md` gets a pointer where the per-turn lines are listed;
`reading-time.md § Who uses it` names chat.
