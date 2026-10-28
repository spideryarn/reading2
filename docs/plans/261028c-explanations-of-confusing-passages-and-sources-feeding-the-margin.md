# Explanations of confusing passages, and Sources feeding the margin

Report `spya-nkq6rj` (#724), Greg, admin (proved with `scripts/feedback-reporter.ts`, exit 0),
2026-10-28, filed from Skim with the margin open on LeCun's *A Path Towards Autonomous Machine
Intelligence*. He would have filed it as a discussion. Part of
[marginalia.md](../project/marginalia.md) and [sources.md](../project/sources.md); the direction it
continues is [explain-this-vision.md](../project/explain-this-vision.md).

> I think we've done a good job of incorporating new stuff from sources about the wider web, about
> what people say about the article, about whether its claims are supported. Basically I would just
> like to lean into that. So I think ideally sources would run more proactively, require fewer
> options from the user, and populate the marginalia mode more.
>
> […] if something's confusing, if you can tell that a user is going to be confused by a paragraph,
> then perhaps you could flag it with an explanation […] what I'd love is if it did it proactively,
> in much the same way that the glossary is proactive. There's just a little underlying waiting for
> me.
>
> And so one way to figure out what's confusing might be to run a small model like Haiku on the
> whole article and ask it what it finds confusing, and then use our bigger model, perhaps Opus, to
> generate short explanations for each of the confusing sections to the extent that you can. And if
> Opus is unsure itself, it should say so. And there should be an option to sort of, you know, ask
> in chat for more information. I suppose it should be allowed to search the web if that will help,
> but it should be clear if some of its responses are based on stuff that came from out the article.
>
> […] Now I did consider actually creating an explanations mode or a confusing sections mode or
> something. Maybe we should do that, or it's a sub mode or something, and then the marginalia mode
> can reference that. And that way, explanations has its own sort of approach.
>
> Model the UI for it on the glossary mode, and perhaps put it as a mode within the more three dots.
> Because I don't think users are going to want to use that mode directly. They're mostly going to
> benefit from it in the, in the marginalia, and probably that explanation mode should run
> automatically on for all new articles. And I guess you should take into account readers'
> backgrounds, etc.
>
> — Greg, 2026-10-28 (`spya-nkq6rj`)

Two ideas. **Idea 2, Explanations, is clear enough to build** and is most of this plan. **Idea 1,
Sources running more proactively, reverses a cost rule Greg set three days ago**, so it is a
question (q-sxfwqq below) and nothing of it is built until he answers.

**Constraint tonight:** the box's OpenRouter key is over its monthly limit until 1 November, so
every model call fails. Everything here is built and tested against canned model answers
(`vi.mock` of `streamMessage`, the house pattern, `tests/faq.test.ts`). What waits for the reset is
listed in [§ What waits for 1 November](#what-waits-for-1-november-queue-entry). **No backfill**
([principles.md § 1](../project/principles.md)): articles already on the shelf get Explanations
only if their owner opens the mode.

## What exists already

- **The margin's own `explain` notes.** Since 2026-10-11 the `relations` call (Marginalia's relation
  words) may write a few notes, one kind of which is `explain`: *"a step, term or move here that is
  likely to confuse this reader, unpicked in a sentence"*. At most one per eight paragraphs, two to
  eight per article, 35 words, article-only, owner-only, made the first time the column is shown,
  stamped *Note*. That is Greg's idea in miniature, and why he can say *"it's already fairly easy"*.
  What it lacks: it is a by-product of a call whose job is relation words, so it is sparse and not
  shaped by a confusion pass; it is not underlined in the prose; it has no *Ask in chat*; and it is
  made only when the margin opens.
- **Glossary** is the model for the shape Greg asks for: made on import (`AUTO_MODE_STEPS`), the
  reader's profile in the prompt, an underline in the prose in every mode, a hover card with *Ask in
  chat*, a band under *More*.
- **explain-this-vision.md** step 7, *"Explain this sentence", underlined*, is this feature, and that
  doc records the evidence's worry: an underline marking a sentence as hard takes away the reader's
  own confusion signal, and an explanation of a sentence can become the thing read instead of it.
  Greg has now asked for it with eyes open, so it is built, with the doc's own mitigations: the
  explanation sits **beside** the author's words (a card, a margin line), never in place of them;
  the prompt asks for **the missing piece** (the skipped step, the assumed background, what the
  sentence's structure hides), not a paraphrase of the passage; and the count is capped so the
  underline stays a claim worth making. The doc's other idea, asking *what do you think it means?*
  first, is not built (named in § Not built).

## Idea 2: Explanations

**Revised after GPT Sol's plan review** ([261028c-plan-review-sol.md](261028c-plan-review-sol.md),
"build with the listed changes"; § Review below says what was taken and what was not). The first
draft built Greg's two-model shape, an underline in the prose, a new chat origin, and switched it on
for every import, all before one real answer had been seen. This version builds the smallest
thing that carries his idea end to end, and leaves each of those to be earned.

### What the reader gets in this version

```
 margin (?margin=1)                         More (⋯) › Explanations  (behind the experimental
 ┌──────────────────────────────┐           switch until q-gkrkf5 is answered and one live run
 │ Explained  "minimised over   │           has been read)
 │ the latent variable"     ▸   │  shut     ┌───────────────────────────────────────────────┐
 └──────────────────────────────┘  line     │ "minimised over the latent variable"  ← jump  │
        pressed:                            │ The model is not given z; it tries every value │
 ┌──────────────────────────────┐           │ and keeps the one that fits best, so z stands  │
 │ The model is not given z; it │           │ for whatever the input leaves open.            │
 │ tries every value and keeps… │           │ Not sure · Draws on AI memory, unchecked       │
 │ Not sure                     │           │ [Ask in chat]                                  │
 │ [Ask in chat] [Open in Expl.]│           └───────────────────────────────────────────────┘
 └──────────────────────────────┘
```

The labels appear only when they apply. **The prose underline Greg asked for (*"a little underline
waiting for me"*) is the next stage, not this one** (§ Stage 3, deferred).

### The step: `explanations`, one call

One capable call (Sonnet 5.5 at standard power, Opus 5.5 under
[high-powered AI](../project/high-powered-ai.md)) over the whole article with block ids, and the
reader's profile. It reads as that reader (or, with no profile, *a curious reader who has not
studied this field*), picks the places a reader would get stuck — a skipped step, a move whose point
is not said, background the author assumes, a sentence whose structure hides its point — and
writes for each a short explanation (at most 60 words) of **the missing piece**, not a paraphrase
of the passage. **Not a lone term's meaning**: that is Glossary's. Each item carries:

- `blockId` and `quote`: the exact words, checked in code against the block (`findQuote`, spaced,
  as FAQ's `verifyPassage`), the article's own characters stored, and **dropped if the words occur
  more than once in the block**, so a later prose underline can always find them (Sol's PR-7). The
  prompt asks for enough words to be unique.
- `text`: the explanation.
- `sure` (false → the label *Not sure*, and the text says what it is unsure of) and `outside` (true
  → *Draws on AI memory, unchecked*, the label the margin's Origin notes already use). Greg: *"if
  Opus is unsure itself, it should say so"*, *"it should be clear if some of its responses are based
  on stuff that came from out the article"*.

A failed check drops the item and is counted; a non-empty answer with every item dropped fails the
run, as FAQ's does; an empty list is a valid answer. Caps in code: one per block, at most
`clamp(ceil(paragraphs / 6), 3, 15)`. Prompts carry `plainWords("explain")`, `paperwork("pick")`
and `PROFILE_RULES`, the profile in the user message after the cached article. One model and one
prompt version, so the ordinary `StepStamp` holds its provenance (Sol's PR-5 was about two calls).
Item ids are a short hash of block id and quote: stable when a re-run finds the same words, a new
id otherwise (best effort, Sol's PR-14).

**States** (Sol's PR-5): *stale* (the article changed) is not drawn in the margin; *outdated* (a
newer prompt) and *written for an older profile* stay visible, the band offering *Write it again*.

Stored in a new `article_revisions.explanations` column (one migration, widening the step-name
CHECK). **Owner only** in this version, as the margin's relation notes are: no public projection,
and a visitor's band says the mode is the owner's. Sol pointed out (PR-4) that Glossary does show
a visitor the owner's profile-written list, so this is a choice, not a rule; a public copy is a
follow-up if Greg wants one.

**Ask in chat** opens a chat anchored on the passage, the ordinary *chat about a passage*, with the
quote and the explanation in its first question, rather than a new `ThreadOrigin` kind. The new
origin is a dozen seams (Sol's PR-3); the anchored chat already exists. What that gives up: one
chat per item and a way back from Chat's list to the explanation. Named in § Not built.

**The margin's `explain` notes stay**, written by the relations call, but a block that has a fresh
Explanation whose quote still holds does not also draw one (a pure rule in `notes.ts`). Dropping
the kind from the relations prompt waits on the measurement.

**Web search: not in this version.** The structured Messages call has no web search, and a search
per item is a different price. *Ask in chat* searches already, and `outside` says when the short
answer leaned on memory. Sol (PR-13) is right that this is less than Greg allowed (*"I suppose it
should be allowed to search the web if that will help"*): it is named in q-gkrkf5's details so he
can say otherwise, and a search pass for the `outside` and not-`sure` items is queued.

**When it runs, in this version:** when the owner presses into the Explanations mode, as every
other list mode does (`useAutoRun`), and never on arrival. Not on import, and not in the margin's
first open, until Greg answers q-gkrkf5 and one live run has been read (Sol's PR-1, PR-8). **No
backfill**: at the estimate below, the 89 articles in production would cost about $11, over
[principles.md § 1](../project/principles.md)'s $5 line.

### What it would cost on every import

**An estimate, not a measurement**: model calls fail until 1 November. The figure is built from
what production's ledger records (read-only, 2026-10-28, job-step calls over 30 days, every power)
for comparable steps, Sonnet over the whole article writing short items: Glossary median $0.11
(38 articles), Quotes $0.12 (39), FAQ $0.10 (8). Token arithmetic alone gave a third of that,
because it cannot see thinking.

- **Explanations at standard power: roughly $0.10–0.15 an ordinary article**, more for a long one.
- **On Opus (twice Sonnet's price): roughly $0.20–0.30.**

For scale, the medians of the steps an import already queues add up to about $1.15 (Simple $0.28,
Ideas $0.19, Bibliography $0.16, Structure $0.15, Quotes $0.12, Glossary $0.11, Cross-refs $0.09,
Skim $0.04, notes from abstracts $0.01). That is a sum of separate medians, not a measured median
import, so "about a tenth more" is a rough scale, not a measurement (Sol's PR-6). The last six weeks
saw 2–15 imports a week. After 1 November the real figure comes from the ledger, grouped by import.

## Idea 1: Sources more proactive — question q-sxfwqq

The literature search (*Where it sits*) is the part of Sources that reaches the margin: its findings
sit beside the passages they concern, for every owner since 2026-10-26. It starts only when the owner
**presses** into *Where it sits*, because Greg's rule of 2026-10-25 (q-vg2b69) was *"If there's
something that's going to cost money, only do that when we open the sources mode"*. Its documented
cost is about $0.30 at standard power and $0.52 under high-powered AI; the ledger's three runs
average $0.47. Running it sooner is the lever for *"populate the marginalia mode more"*, and it
reverses that rule, so it is his call. The options, distinguishing a press from an arrival as Sol
asked (PR-9):

- **A. The press that turns the margin on** (recommended): the first press of the margin button on
  an article starts the search if it has never run. A reload, a pasted link or a restored view with
  the margin already on does not.
- **B. Any time the margin is showing**, arrivals included: findings for every article whose margin
  you look at, at the cost of spending on a reload.
- **C. Every new article**: about $0.30–0.50 more per import, on articles that may never be opened.
- **D. Leave it** as the press into *Where it sits*.

The rest of *"fewer options"* (Sol's PR-10): Reception's web search and Claims' list each still
wait for their own button, and Claims' checks do not reach the margin. They are named in the
question's details as the next candidates, not decided here.

## Stages

1. **The step.** The `explanations` task (tier, wire, cost category); `src/explanations.ts`
   (prompt, schema, checks, caps); the pipeline step with stamp and freshness; the migration;
   store wiring, Metadata, export, `GET /api/explanations/:slug` with `withProfileChanged`; tests
   against canned answers, red first on the checks. Commit.
2. **The mode and the margin.** `explanations` in the catalogue behind the experimental switch,
   under *More* after Glossary; `useExplanationsRead` / `useExplanations` with `useAutoRun`; the
   band (list, labels, jump, Ask in chat as an anchored chat, Write it again); the margin kind
   (a shut line), its card in `tips.ts`, the `explain`-note rule; read-hook and margin tests. The
   checklist is [mode.md](../project/mode.md), including its silent seams (Sol's PR-12): read-error
   and rewrite-hold matrices, help page, stylesheet manifest, visitor policy. Commit.
3. **Deferred: the prose underline.** Needs the overlap design Sol's PR-2 asks for (Explanation ×
   term, citation, cross-reference, comment, chat, search, quote: which visual channel each keeps,
   whose card wins, first and second taps, keyboard) and a browser specimen against real output.
   Queued.
4. **Docs and bookkeeping**: `docs/project/explanations.md` under reading-view-overview;
   marginalia.md; explain-this-vision.md; experimental-features.md; the questions published; the
   queue entries; the note.

Each built stage: tests and typecheck green, a GPT Sol review of the code, commit; push to `dev` at
the end.

## What waits for 1 November (queue entry)

- **A live comparison** on a few local articles (short, long, technical; no profile and two
  profiles): one call against a Haiku flag pass then the writer, Sonnet against Opus. Read every
  explanation: right, labels honest, count about right. A few dollars.
- **The real cost** from the ledger, into the doc and q-gkrkf5.
- **Then, if Greg's answer says so**: out of the switch and into `AUTO_MODE_STEPS` (which a reader's
  automatic-modes setting already governs).
- **Whether the margin's `explain` notes are now redundant.**

## Not built, and why

- **The prose underline** (stage 3, above).
- **The Haiku pass**: earned or not by the comparison.
- **Web search inside the batch**: queued with the comparison.
- **A chat origin** (one chat per item, a way back from Chat's list): the anchored chat stands in.
- **A visitor's copy**: owner only for now.
- **Asking *what do you think it means?* first** (explain-this-vision's self-explanation idea): a
  different interaction from the proactive one asked for.
- **Any change to Sources** until q-sxfwqq is answered.

## The simpler option passed over

**Have the relations call write more `explain` notes.** One call, no new step, no new mode. Passed
over because Greg asked for a mode of its own, the reader's profile and an *Ask in chat*, and
because a confusion pass loaded onto the call whose contract is a hundred relation words would make
both worse: the notes already had to come first in that answer to be written at all.

## Review

GPT Sol on the first draft: [261028c-plan-review-sol.md](261028c-plan-review-sol.md). Taken: PR-1
(one call, not on import, earn the rest), PR-2 (underline deferred to its own design), PR-3
(anchored chat instead of a new origin), PR-5 (states; one stamp is enough for one call), PR-6
(cost softened, method stated), PR-7 (uniqueness checked before storage), PR-8 (the questions
written; the writer model comes after the comparison), PR-9 and PR-10 (q-sxfwqq's options), PR-11
(the backfill counted: about $11), PR-14 (ids best effort). Taken as a decision rather than a
question: PR-4 (owner only for now, said so) and PR-13 (no search in v1, said so in q-gkrkf5 so
Greg can overrule). PR-12 is the stage 2 checklist.

## Decisions taken without asking

- One capable call, following the article's power; Haiku and Opus wait for the comparison.
- Behind the experimental switch, run by the press into the mode, until q-gkrkf5.
- No web search in v1; *Ask in chat* is the deeper path.
- Owner only; anchored chat; shut in the margin.
- Lone terms left to Glossary.
