# Summaries — the piece in plain words

Up: [reading-view-overview.md](reading-view-overview.md)

A **mode** in the band between the spine and the prose: a few short paragraphs in everyday words
saying what the piece is about, why it matters, and its key ideas, at one of three lengths on a
slider — **Brief**, **Simple**, **Fuller**. Press `Summary` in the bottom bar. Every paragraph links
to the passages it rests on.

**Until 2026-10-01 Summary was also an outline** — one sentence on the article, each part and each
section, the tree's gists at a Parts | Sections depth. That went because Structure already draws the
same tree; [§ History](#history-the-outline-2026-08-26-to-2026-10-01) has what it was and where to
find it.

Code: [`SummaryMode.tsx`](../../src/web/modes/summary/SummaryMode.tsx) (the band and the slider row),
[`SimplePanel.tsx`](../../src/web/SimplePanel.tsx) (the paragraphs and the empty state),
[`useSimple.ts`](../../src/web/useSimple.ts), and `§ summary mode` in
[`styles/summary.css`](../../src/web/styles/summary.css); the stage is
[`src/simple-summary.ts`](../../src/simple-summary.ts).

```
 ┌── spine ──┬──── SUMMARY (the mode band) ─────┬────── the article ──────┐
 │           │  ▤ ○────●────○ ▤▤          ⓤ     │                         │
 │  ▇▇▇▇▇▇▇  │ ──────────────────────────────── │  Being You opens with   │
 │  ▇▇▇▇     │  This book argues that what you  │  a story about waking   │
 │  ▇▇▇      │  experience is your brain's best │  from anaesthesia, and  │
 │  ▇▇▇▇▇▇   │  guess about the world, not a    │  what that tells us     │
 │  ▇▇       │  copy of it.  [spya-k3m9qt]      │  about the self.        │
 │  ▇▇▇▇     │                                  │                         │
 │  ▇▇▇      │  Why it matters: …               │  Pressing a chip        │
 │  ▇▇▇▇▇    │  [spya-tgnssb] [spya-sge6a2]     │  scrolls the article ┐  │
 │  ▇▇       │                                  │  to that passage.    ▼  │
 └───────────┴──────────────────────────────────┴─────────────────────────┘
   ▤ / ▤▤ — the short and long ends of the slider; ⓤ — the owner's "written for you" badge
```

## Simple — a plain-words orientation

**Built 2026-09-30.** Asked for by an admin through the Feedback button (SPIDERYARN-READING2-6E):

> Add a sort of sub mode to the summary mode for something like, explain it to me like I'm 12 or 15.
> … It just helps the reader orient, like, okay, what is this about and why is it important, and
> what are the key ideas or whatever.
>
> — Greg, 2026-09-30

It is the feature closest to [vision.md](vision.md)'s anti-goal, so it is kept an **orientation,
not a digest**: a few paragraphs, capped by code; **every paragraph is a door** (below), and a
paragraph that cites no passage is dropped when it is written. Plain text, never markdown. What it
is — written by AI, the article says it better — is said in the slider's card, not in a line under
the paragraphs.

### Three levels, one row, shaped by the reader (since 2026-10-01)

> let's provide a UI-slider with 3 level (short & very-simple, just-under-current-length and
> fairly-simple, just-over-current-length and moderately-complex)
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-7J)

> the main thing I'm trying to do is avoid wasting vertical space, and use the UI design to give the
> user a clue about how they work and are related to each other. Also, the Very-Simple and
> Moderately-Complex summaries should take into account User-Profile and Why-are-you-reading-it.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-7A)

- **One row, no labels.** The slider is the whole control: **Brief** (short, very simple, pitched at
  twelve), **Simple** (fairly simple, just under the first version's length, at fifteen), **Fuller**
  (moderately complex, just over it, at eighteen). Since 2026-10-01 there is no level name beside it
  (SPIDERYARN-READING2-7R, *"get rid of the "Simple" text - perhaps replace with an icon"*): a
  short-text icon at the left end and a long-text one at the right, each a press on that end's
  level; the tooltip names the three, and `aria-valuetext` names the current one for a screen
  reader. ⓤ is the owner's *written for you* badge.
- **The reader's profile and goal shape all three**, through the shared `PROFILE_RULES` and
  `profileSection` ([src/profile.ts](../../src/profile.ts)): what the reader says they know is not
  explained, and the goal decides what leads. Recorded as `profileHash`, not in the stamp — a changed
  profile makes nothing stale; the badge shows it and *Write it again* picks up the new one. A
  visitor reads the owner's paragraphs, and the owner's *make public* dialog says they were written
  for the owner's profile.
- **One press writes all three**: one model call per level, all or none stored; a level whose answer
  fails validation is asked once more on its own. A `simple/1` row reads as absent and the next press
  replaces it.
- **The three share one cached copy of the article** (since 2026-10-01): Fuller is asked first with
  the article marked, and Brief and Simple start once its stream has begun, so they read the cache
  instead of paying for the article again. About 37% cheaper a press for about 2 s more wait; one
  call for all three was measured and is far slower. Below the cache floor they run together, as
  before. [261001j](../plans/261001j-simple-press-cost-and-latency.md), which also holds the
  streaming question for Greg.
- **The door rule.** Opening Summary spends nothing — the Summary button arms nothing
  ([mode.md](mode.md), `useAutoRun`), and arriving on `?summary=` — a link, Back, a restored view —
  reads what is stored. With nothing stored the owner sees an empty state with **Write it**; choosing
  a level on the slider with nothing stored runs the `simple` job. A visitor on a public article gets
  the stored paragraphs off the payload, or a line saying none has been made. **This is new as a
  cost**: while the outline was the default, Summary showed something free on every article; now an
  article nobody has pressed for opens empty. Whether opening should start the run is the open
  question in [261001p](../plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md)
  § Deferred.
- **It does not stream**, against CLAUDE.md's rule for a call somebody waits on — the first press
  waits behind the job progress, like FAQ. Why, and the one decision left for Greg, are in
  [260930i](../plans/260930i-simple-summaries-eli15-sub-mode.md) § *A departure from CLAUDE.md*.

The design, the measurements and the review are
[261001b](../plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md).

### A summary is a door

> Add block-ids to the summary output (make them clickable, to scroll the text there, and also with
> rich-tooltips).
>
> — Greg, 2026-08-26

This mode sits one inch from the thing [vision.md](vision.md) forbids — *"trying to replace the
words with quick and easy summaries"* — and the difference between a summary that augments reading
and one that replaces it is whether you can get from the summary back into the passage without
effort. So each paragraph carries the passages it rests on as [`BlockRef`](../../src/web/BlockRef.tsx)
chips: press one and the article scrolls there; hover and the card is the paragraph itself,
truncated — enough to check the summary against the article without leaving the sentence you are
on, not enough to read instead of going there. One card for the whole reading view
([`BlockLinkCard.tsx`](../../src/web/BlockLinkCard.tsx)), so a chip here means what it means in
every other band.

### The fidelity guard (since 2026-10-01)

Plain words pull a model towards the everyday name for a thing, and on the PID paper that name was
the paper's word for a different thing: synergy *"grows with more feedback loops"*, where the paper
finds feedback connections lower it. A prompt rule did not make that rare
([261001h](../plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md)). So each
level, once written and valid, is **checked**: one quick-tier call reads every paragraph beside the
text of the blocks it cites and says, per paragraph, whether those passages contradict it.

- **A flag buys the level's one remaining attempt**; the retry is stored whatever its verdict, and if
  the retry itself fails, the flagged first attempt is. The guard can make a press slower (4–5 s,
  more on a retry) but never makes it store nothing.
- **A checker that fails or answers unreadably** leaves the level stored unchecked, and does not
  spend the retry.
- **It cannot catch what the cited passages do not say**: a claim wrong about the article but not
  contradicted by its own passages passes. Measured, it caught 24 of 30 hand-labelled faults and
  alarmed on 1–2% of other paragraphs, for about $0.0027 a press.
- **Each stored summary carries a `check` record** (per level: passed, flagged with the reasons, or
  unchecked, and how many attempts), the owner's and never a visitor's; a summary without one was
  written before the guard or with it off. Every check is also an `ai_calls` row of purpose
  `simple-check`. `npx tsx scripts/simple-check-report.ts` reads both, read-only — what each can and
  cannot see is in its header.
- **Off is one line**: `SIMPLE_CHECK_ENABLED` in [`src/simple-check.ts`](../../src/simple-check.ts),
  then a deploy.

It is Simple's alone; the other summary voices are not checked. The design, the review and the
first real press are in [261001i](../plans/261001i-simple-fidelity-guard-built.md).

**Simple is written on Opus for every article, and the guard stays** (since 2026-10-01,
[261001p](../plans/261001p-simple-on-opus-with-and-without-the-fidelity-guard.md)). The writer was
measured alone, guard off, on the PID paper and on two controls:

| | Sonnet | Opus |
|---|---:|---:|
| "feedback loops" for recurrent, PID paper | 5 / 18 levels | 0 / 36 |
| guard flags: PID · controls | 6 / 18 · 1 / 36 | 2 / 36 · 1 / 36 |
| blind read, 27 levels each: major · minor faults | 3 · 2 | 0 · 1 |
| a press, warm cache · cold | $0.05 · $0.09 | $0.10 · $0.18 |
| a press, three levels, median | 17 s | 20 s |

So the guard rarely fires on Opus and the ~15 s retry mostly goes away. It is kept because Opus
still made a real fault on Gwern that only the guard caught. Opus states the trapped finding in 22
levels of 36, every time correctly, by avoiding the paper's terms rather than naming the contrast,
and it writes nearer the word targets. The switch is `ALWAYS_HIGH_POWER` in
[`src/models.ts`](../../src/models.ts), which the step and `/api/models` both read; taking `simple`
out returns it to the article's High-powered AI setting, and no stored summary goes stale either
way.

## The band is a touch wider (since 2026-10-01)

> Make the Summary mode column ever so slightly wider (if on a wide screen)
>
> — Greg, 2026-10-01 (SPIDERYARN-READING2-7Q)

Summary's band is the **roomy** shape: the standard band, but capped at 28rem (448px at a 16px root)
rather than 25rem. It still takes only what the prose leaves above its minimum, so below about 957px
it is the standard band, and it reaches 448px near 1004px; phones are unchanged. One function picks
every mode's shape — `bandShapeFor` and `ROOMY_IDEAL_REM` in [`layout.ts`](../../src/web/layout.ts);
the other shapes are in [narrow-windows.md](narrow-windows.md).

## The URL

| Parameter | Values | History | Why |
|---|---|---|---|
| `mode=summary` | | push | A mode is where you are, not a glance — [url-state.md](url-state.md) |
| `summary` | `brief`, `simple` (default, absent from the address), `fuller` | push | Which level the slider is on |

`?deep=` and `?summary=gists` went with the outline on 2026-10-01; an old link carrying either lands
on Summary at `simple`, and `deep` is never remembered, so it cannot be restored over a fresh link.

## What this deliberately does not have

**An outline of the article.** That is [Structure](structure.md)'s, drawn from the same tree.

**The expertise axis.** The previous version crossed three lengths with three reading levels behind
two sliders, and there is no evidence anyone used it
([original-version/summaries.md](original-version/summaries.md)). Simple's three levels are one
slider that moves length and plainness together.

**Anything generated as you move around.** The one thing here that spends is the press, once per
article, and kept. Their heading tooltips fetched summaries for headings the granularity filter had
already hidden — real money spent generating text nobody could see.

**Markdown.** Paragraphs are plain text. Rendering arbitrary model output as HTML is what
[security.md](security.md) is about.

## What is still open

- **No evidence it helps.** The same criticism the previous version earned, and repeating their
  mistake would mean never asking. [Q6](open-questions.md) is where "how would we know we are failing
  at this" lives.
- **Whether opening Summary should write it** — or ingest should — now that there is nothing free to
  show first. [261001p](../plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md)
  § Deferred, and the Overseer's queue.
- **Simple can collapse two terms that the paper keeps distinct.** On the PID paper it calls the
  recurrent connections, which raise synergy, "feedback loops", borrowing the paper's term for the
  different kind that lowers it. This happened in 6 of 18 outputs across six fresh unchanged-prompt,
  no-profile runs on 2026-10-01 on Sonnet. Neither of two tested prompt wordings made the fault rare
  enough to ship ([261001h](../plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md)).
  Two answers are built: [the fidelity guard](#the-fidelity-guard-since-2026-10-01), and writing
  Simple on Opus, which made it in none of 36 levels. **Still open:** that is one paper; no second
  article with a contrasting-terms trap has been measured, so how general either answer is remains
  unknown.
- **The hover card is wider than the band it opens in** — 26rem against a band of 18–28rem — so a
  card anchored near the band's left edge draws over the spine rail. It is on top (the tooltip layer
  is `z-index: 100`, portalled into `<body>`) and transient, so this is untidy rather than broken.

## History: the outline (2026-08-26 to 2026-10-01)

Built on 2026-08-26 from Greg's ask for *"hierarchical Summary, taking inspiration from
`docs/project/original-version/`"*. It began as the old version's named length ladder (`gist`,
`short`, `long`), cut back on 2026-08-31 to the tree's one-sentence gists alone
([260831s](../plans/260831s-gist-only-summaries.md)), and became a nested, numbered outline of the
article, its parts and its sections, with a **Depth** control (the `?deep=` cut-off), `+N sections`
badges that opened one node past it, a paragraph count on every row, and a panel that followed the
reader down the page. From 2026-09-05 each part showed its Socratic question instead of its gist
([hierarchy.md § The question under the claim](hierarchy.md#the-question-under-the-claim)). Simple
joined it as a second sub-mode on 2026-09-30, and the two shared one row as Parts | Sections beside
the slider from 2026-10-01 morning.

It went the same afternoon:

> I'm looking at the summary mode, and I think actually getting rid of parts and sections is
> probably the way forward. It was an experiment, and it's just not working that well. We already
> have the structure mode, and so I think that probably overlaps with the summary parts and
> sections, and so let's just get rid of parts and sections.
>
> So that just leaves the slider that ranges from sort of brief to fuller summaries. So we can
> altogether get rid of all of the machinery that does those parts and sections summaries.
>
> — Greg, 2026-10-01 (spya-b3ggv4)

What was removed is the drawing, not the data: the gists, the Hierarchy stage, `buildSummaryTree`
and `TreeNode.question` all stay, because Structure, Marginalia, the masthead, the shelf and others
read them. [261001p](../plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md) is the
removal.

**To read the outline's design**, which was long and careful — three ways for a node to be hidden
and why they are three variables, the root's badge as its own twist, focus handed from a vanishing
badge to the twist, the whole entry as a click target, and the follow-the-reader scroll — read this
doc and the component as they were before the removal:

```
git show 9e5cb2ccac385a0615fecbaea22f28b8472d6cdf^:docs/project/summaries.md
git show 9e5cb2ccac385a0615fecbaea22f28b8472d6cdf^:src/web/SummaryPanel.tsx
```

The follow-the-reader scroll itself lives on in [`follow.ts`](../../src/web/follow.ts), which
Trajectory now uses ([trajectory.md](trajectory.md)); its header holds the reasoning (move only when
the target changes, never fight the reader's own scroll, why the slide is ours and not the
browser's).

## See also

- [hierarchy.md](hierarchy.md) — stage 4, which writes the gists and questions the outline drew
- [structure.md](structure.md) — where the article's outline is drawn now
- [block-ids.md](block-ids.md) — the contract the passage chips rest on
- [reader-profile.md](reader-profile.md) — the profile and goal that shape every level
- [prompting-guide.md](prompting-guide.md) — the plain-words rule the levels share
- [original-version/summaries.md](original-version/summaries.md) — their ladder, their one-call
  batching, and the two failures the first version here was shaped around
- [url-state.md](url-state.md) — `?summary=` among the rest
