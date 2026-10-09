# Skim: the question before a quote is optional, smaller and explained; the left bar is one bar

Three admin reports from Greg on 2026-10-09 07:50–07:53 UTC, all from Skim on
`arxiv-1706-03762-spya-wyt7j0` (`feedback-reporter.ts` exit 0 on each): `spya-qpgvq9`,
`spya-zdkqx4` and `spya-x0rfs2`. The mode is [skim.md](../project/skim.md).

> In skim mode, we show a quote on each step, often. Okay, that's good. For the quote, we generate a
> little question to contextualize the quote. [...] I think this is most valuable in cases where the
> quote doesn't stand on its own. So maybe we should say that the question is optional, but that when
> we include it, it should perhaps contextualize the quote. It should make it easier to then
> understand what the quote is saying. Perhaps we might make a slight tweak so that sometimes there
> question indicates why we've picked the quote. And I guess the key thing is that if one were to
> read the question, then the quote, that it should make more sense or be easier to process. I
> suppose the alternative is we could give the AI the option to say something *after* the quote, or
> not at all. [...] perhaps you can try and find some examples and see if there are cases when it
> would actually help more to say it afterwards, and it's optional, or why it was chosen.
>
> In all these cases, the point is that only include that extra AI-generated contextualization if
> it'll make the quote easier to understand, easier to situate, easier to see why the quote is
> important. [...] And perhaps include a brief tooltip to explain what the question is and is
> before, if we don't have one already.
>
> And because the question is less important than the quote, let's make the question font slightly
> smaller than the quote.
>
> — Greg, 2026-10-09 (`spya-qpgvq9`)

> I think there's no point in having a question that sort of almost verbatim sets up the quote as
> the answer, because that adds nothing. In that case, we don't need the question. The point is for
> the question to add something so that the quote means more for having read the question.
>
> — Greg, 2026-10-09 (`spya-zdkqx4`)

> Take a screenshot, skip mode, and you'll see that there's a kind of orange left-hand border for
> each step. That border seems to compose of, comprised two parts, with a rounded edge and the
> bottom part of the first part kind of rounds a little bit before it breaks off for the second
> part. In general, it looks a bit janky, and I wonder if there's something we can do about that and
> skip mode in general just to make it slightly easier to process.
>
> Take some screenshots, ask some sub-agents prompted to work variously as product managers or UI
> designers or naive users to try and see if we can make the graphic layout more appealing and
> easier to understand.
>
> — Greg, 2026-10-09 (`spya-x0rfs2`)

## Outcome (2026-10-09)

Built, with these changes from the plan below. GPT Sol's plan review is
[261009j-plan-review-sol.md](261009j-plan-review-sol.md). Its concrete product and implementation
fixes were taken. F2's route-quality gate and F3's article-blocked confidence test were not built;
the investigation now quantifies the route movement and treats its pair-level statistics as
descriptive rather than claiming those two gates.

- **The prompt took three wordings**, and the plan's ship rule was not met by any of them. The third
  was built on an Opus arbiter's call, and the reasons and the cost are written down:
  [261009b](../investigations/261009b-skim-cue-optional-eval.md).
  - Round 1 let "why this passage" cues invent the passage's role.
  - Round 2 dropped the cue on Greg's own "the latter interpretation" quote from 2026-10-06.
  - Round 3 makes that case expected and prefers a question.
- **The question's size is a named exception** (0.78rem) in `tests/type-roles.test.ts`, not the
  `meta` role, which is for "where, when, from whom" (Sol F6).
- **The explanation is in the band's (i)**, which a keyboard and a finger reach, as well as on a
  hover card on the line itself (Sol F5).
- **The door takes `.prose`'s measure in `.prose`'s face** (`--font-author`). A first try with
  `--font-reading`, which is Geist, came out 160px too wide (Sol F8, and the browser check).
- `noCue` starts at 0 on every new route (Sol F10). The Help page, the students' guide, the public
  type and the Features page no longer promise a cue on every stop (Sol F9).
- The wider layout went to Greg as [q-u04sye](../user-feedback/questions/q-u04sye.md).

## Prior work

- The cue (Skim's name for this question) has been reworked three times:
  [261001n](261001n-trajectory-question-above-quote-and-highlight-on-screen-block-links.md) put it above the quote;
  [261006e](261006e-skim-cue-situates-the-quote-and-term-chips-use-the-glossary-card.md) and
  [investigation 261006b](../investigations/261006b-skim-cue-situates-the-quote-eval.md) made it
  set the scene when the quote leans on something unsaid (`skim/10`), and a round-three middle
  wording failed. **None made it optional**: today every stop is asked for a cue, and an empty one is
  counted as a fault (`badCue`).
- The eval harness from 261006b is reused: `scripts/eval/skim-coverage-eval.ts` runs production's
  `generateSkim`, `scripts/eval/skim-inputs-from-production.ts` reads one production article's
  inputs read-only.
- Session `fbud2w92` (261009i) changed Skim's profile banner only; `fbpqae7m` (excerpt formatting)
  touches how quotes' text is rendered, not the cue or the row's bar. No overlap found.

## What is there now

**The question.** Of the 11 cues on Greg's route (production, `skim/10`), most turn the quote into
a question. *"What does one attention head lose that several heads keep?"* stands before *"With a
single attention head, averaging inhibits this"*; *"How do they sum up what replaced the recurrent
layers?"* before the conclusion's summary sentence. A few earn their place:
*"Why does step-by-step processing hurt training…?"* tells the reader what the quote's *"This
inherently sequential nature"* refers to.

An Opus subagent classified all 68 cues on five routes (Greg's, and four local ones; the working
was in the session scratchpad and is summarised here). **9 add something (13%), 56 are echoes
(82%) and 3 do harm (4%)**. Two of the harmful ones ask a question the quote does not answer:
*"what is traded off"* over a quote that says there is no trade-off. For about 49 of the 68 it
judged no cue better than the one there. The prompt causes the echoes. Section 3 says *"MOST
QUOTES STAND ON THEIR OWN, AND THEIR CUE ONLY POINTS … a short cue is a good cue"*, and a pointer
at a quote that already stands alone is an echo by construction.

**Its size.** `.skim-cue` is `--type-body` (0.85rem) in `--font-ai`, IBM Plex Mono; the quote under
it is `--type-quote` (0.88rem) in the author's face. A monospace face at nearly the same size reads
as the *larger* of the two.

**The tooltip.** None. The band's foot says *"The order and the cues are the model's reading"*; the
cue itself is unexplained.

**The bar.** The current row is two boxes: the row's button (`.skim-go`, radius 10px on every
corner) and the stop card under it (`.skim-card`, radius `0 0 10px 10px`). Each paints the same
background and a 3px inset `box-shadow` as the bar, and they touch with no gap. The inset shadow
follows the button's rounded bottom-left corner, so the bar curls away, then restarts straight on
the card a pixel lower: [before-2](261009j-shots/before-2-desktop-row-crop.png),
[zoom](261009j-shots/before-2b-desktop-bar-join-zoom.png). The iPad and the phone show the same.

**The critique.** Three subagents read the screenshots: a product manager, a UI designer and a
first-time reader (Sonnet). All three called the bar broken (*"two glued-together boxes"*). All
three found that the quote, the point of the stop, is the third-loudest thing in its own row. It
sits under a bold two-line section path and a monospace question at its own size. Two found the
next stop's cue under **Next stop ›** running across the prose's right-hand rule
([before-6](261009j-shots/before-6-desktop-prose-door.png)). Their other proposals are below,
either in the change or in the question to Greg.

## The change

### 1. The question is optional (`skim/11`)

Section 3 of the prompt is rewritten along the lines of the Opus study's draft:

- **A cue or none.** The prompt says `"cue": ""` is a good answer. It is the default whenever a
  cue cannot add something the passage does not already say. A cue has one job: the passage means
  more for having read it, because it is easier to understand, to place, or to see why it matters.
- **The echo test**, which the model can run itself. Read the cue with the quote hidden. What
  does the reader know now that the quote's own words would not have told them? If nothing, `""`.
- **Three ways a cue earns its place**:
  - it says what the quote's "this" or "the latter" stands for;
  - it names the question the passage settles;
  - **it says why this passage**: the reason for a choice the piece makes, the evidence for one
    of its key ideas, or the frame the rest is built on. Never what the passage says. This one is
    new, from Greg's *"sometimes there question indicates why we've picked the quote"*.
- **Ask only what the quote answers.** New, for the harmful cues above.
- **Kept, shorter**: never state the finding; only what the records say (a wrong scene is worse
  than none, and when unsure, `""`); whole sentences; no reference to another stop.
- Examples on topics outside the eval set, and one `"cue": ""` in the OUTPUT example.

**Code.** The schema stays `cue: string`: "no cue" is an empty string, not a nullable field,
because of OpenAI-strict schemas and the "omit the field" comma trap
([prompting-guide.md § What the model writes back](../project/prompting-guide.md#what-the-model-writes-back)).
`cueOf` already turns `""` into `null`, but counts it as `badCue`. An empty cue is now not a fault
and gets its own count (`noCue`), so a route's log still says how many it left out, and `badCue`
keeps meaning a malformed or over-long one. The band and the door already draw nothing for a
`null` cue. `PROMPT_VERSION` → `skim/11`. Older routes are *outdated*, not stale, so they keep
their cues until planned again ([skim.md](../project/skim.md)).

**Not an after-the-quote line.** Greg asked us to look for cases where a line *after* the quote
would help more. In the 68 cues the Opus study found none that worked only after the quote. Two
or three read a little more naturally there (*"This is the reason their attention divides by
√d_k"*), and each can be said before the quote as well. Three things count against it:

- the reader would finish on the model's words rather than the author's, which turns "augments
  reading" upside down;
- a line after a passage slides into summary ("This shows that…");
- two optional fields per stop are two things to get wrong.

So there is one optional line, before the quote, and it may now say why the passage matters.

**Measured before it ships**, by
[prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change):

- **The runs.** Six articles, through production's `generateSkim`, with
  `scripts/eval/skim-coverage-eval.ts`. Two are Greg's, read from production read-only with
  `skim-inputs-from-production.ts`: `arxiv-1706-03762-spya-wyt7j0` and `2608-13566v1-spya-yurten`.
  Four are local: `entropy-24-00930-spya-pywwkq`, `arxiv-2010-spya-tkm7nm`,
  `cargocult-spya-rz663q` and `source-spya-furjgs`. The arms are **A1** and **A2**, `skim/10`
  twice (the control; already run, $0.17 each), and **B**, `skim/11`.
- **Screens.** The share of empty cues per article; expected roughly half, and an article with
  every cue empty, or none, is a failure. The cues B keeps are read by hand.
- **Blind pairs.** A new `scripts/eval/skim-cue-optional-pairs.ts` sets sides with `blindCoin`,
  keeps the key in its own file and checks it is balanced. A pair is a quote that is a stop in
  both arms, shown with its paragraph and the one before it, and each arm's cue **or "(no
  question)"**. For each pair the judge answers:
  - which one leaves a reader better placed to understand the quote, situate it, or see why it
    matters: 1, 2, or tie;
  - for each side that has a cue: is it an echo, does it give the finding away, and does it say
    or ask something the text does not support?

  The pairs are A1 v A2 (the control), A1 v B and A2 v B.
- **Two judges per comparison, from two families**: a fresh Claude subagent and GPT Sol, each
  reading only the pairs file. The caveat on 261006b was a single same-family judge.
- **It ships if** all of these hold:
  - both judges prefer B to A1 and to A2 by more than the control's own split;
  - B has fewer echoes;
  - B's cues give the finding away, or claim something unsupported, no more often than A's.

  Otherwise the wording is revised once and measured again, or the change goes to Greg.

The write-up is an investigation under `docs/investigations/`.

### 2. The question is smaller, and explained

- **Smaller.** `.skim-cue` moves from `--type-body` (0.85rem) to `--type-meta` (0.78rem), and
  `tests/type-roles.test.ts` is updated to match. The designer explained why "slightly smaller"
  takes more than one step. Plex Mono is wider than Source Serif 4 and has a taller x-height, so
  at 13.6px the question already reads larger than the 14.08px quote. 0.78rem mono against
  0.88rem serif is a visible step down. It stays `--ink-soft`, for contrast.
- **A card on the question**, since there is none. It uses the shared `Tooltip`, opened by
  hovering over the question on the current row, and says what the question is and that it
  appears only where it helps: *"A question to read the quote with, written by AI. It is here
  only when it helps: to say what the quote is answering, what it refers to, or why it matters."*
  The row's own tooltip (the quote's whole words) is off on the current row, which shows the
  words whole, so the two never meet. A finger pressing the row still jumps to the stop, as now;
  the card is for a mouse.

### 3. One bar

The `<li class="skim-row current">` already holds both the row and the card. It takes the
background, the radius and the bar, and the button and the card inside it paint none of them. The
bar is a `::before` strip set in from the rounded corners, not an inset `box-shadow`, which bends
at any rounded corner (the designer's point). Hover on the other rows is unchanged. A jsdom test
cannot see a corner, so the check is screenshots after the change, on desktop, iPad and phone.

### 4. The next stop's cue keeps off the prose's rule

The door's cue is limited so it does not cross the vertical rule at the prose's right edge (which
rule, exactly, is found when building, from `before-6`). This is a bug fix with no trade-off.

## Not built: the wider layout, put to Greg as one question

The critics proposed these. Each is a judgement about how loud something should be, so they are
Greg's call:

- **A quieter section path.** On the current row, one size down and `--ink-soft`, weight 600
  rather than bold ink. It is now the loudest thing in the stop (PM, designer).
- **Outlined chips, not black-filled ones.** The black chips on the raised grey are the
  highest-contrast blocks on the screen and pull the eye off the quote (PM, designer, first-time
  reader).
- **The door's cue upright, not italic** (designer). Italic mono reads poorly, and the face
  already marks the words as the model's.

They go to Greg as one `[Q-...]` with before/after screenshots, taken with the CSS injected into
the page, so he sees them before any is built.

Left out entirely, and why:

- **The profile banner on one line** (PM; the first-time reader found it baffling). It was changed
  this morning by 261009i, and it is not part of these reports.
- **The other rows' paths on one line, and the other rows quieter** (PM, designer). This trades
  away scanning the route as a list, and nobody asked for it. It is mentioned in the question's
  background, not offered as an option.
- **A label such as "Ask yourself:" before the question** (first-time reader). The card says what
  the question is without spending a line on every stop.
- **The route's own faults** the Opus study saw: near-duplicate stops, and one stop placed before
  the stop it depends on. They come from a different part of the prompt and were not reported;
  they are noted in the investigation.

## Stages

1. **Plan**, then a GPT Sol plan review (read-only).
2. **The prompt** (`skim/11`, `noCue`) and its test. Then the B arm, the pairs and the two judges,
   and the investigation written up. It ships only if it meets the bar above.
3. **The band**: one bar, the smaller question and its card, and the door's cue, with tests. Then
   screenshots after the change on desktop, iPad and phone (Sonnet, Playwright), and the
   before/after shots of the proposals for the question.
4. **Finish**: GPT Sol code review (it fixes what it finds inside the stage), the gates, the docs
   (skim.md; fonts.md and typography.md if a rule moves; tooltips.md if needed), the feedback note,
   and a push to `dev`.
