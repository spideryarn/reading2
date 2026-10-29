# Explanations borrows Glossary's controls and uses the full width; a calmer face for the reader's words

Two reports from Greg (admin, `feedback-reporter.ts` exit 0 on both), filed 2026-10-28 23:26 and
23:27 UTC from production, both on *Consciousness in Artificial Intelligence*
(`arxiv-2308-08708-spya-xax6v4`, `?mode=explanations`). Session `fbay3u4w-explanations-layout-font`.

> For the explanations mode, I suggested that you borrow from the glossary UI. So I was expecting
> different orderings and a prioritized default with thresholding and an option to find more. And
> also, it's not using the full width of the sidebar, so it's wasting a bunch of space on the
> right-hand side. Take screenshots and you'll see.
>
> — Greg, 2026-10-28 (spya-ay3u4w)

> The new font for stuff that's written by the user, I appreciate that it looks like a script,
> which is probably a good thing, and it's distinctive. But it's just a tiny bit sort of, I don't
> know, Comic Sans and irritating. Can you find another font that's sort of in the same family, but
> just a little bit less over the top?
>
> — Greg, 2026-10-28 (spya-xurkmf)

Mode built yesterday from spya-nkq6rj ([explanations.md](../project/explanations.md), plan
[261028c](261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md)). The
reader's face is from 2026-10-25 ([fonts.md](../project/fonts.md)).

**Constraint tonight:** the box's OpenRouter key is over its monthly limit until 1 November. Nothing
here can call a model from the box, so the new prompt fields are tested on canned answers only, and
the threshold's starting position is a borrowed number, not a measured one (§ What waits).

**Production could not be seen as Greg.** The box's browser is signed in to nothing and production
sign-in is Google SSO; the browser agent stopped rather than mint a session. The layout was
reproduced locally instead, with a canned list (§ 3).

## 1. The reader's face: Kalam, replacing Shantell Sans

Nine faces were drawn side by side on Greg's own typed words (a chat bubble at 15px, a margin note
at 14px, a 600-weight thread title), between a line of iA Writer Quattro and a line of Source Serif
for contrast: Shantell Sans, Playpen Sans, Kalam, Mali, Klee One, Caveat, Delius, Handlee and Edu
AU VIC WA NT Hand. All self-hostable through `@fontsource`, all OFL.

- **Out at once:** Playpen Sans and Mali are the same rounded marker as Shantell — exactly as
  comic. Caveat and Edu are true scripts and much harder to read at 14–15px. Handlee is cramped
  and wobbly.
- **The shortlist:** **Kalam** (a pen hand, slightly slanted, clearly written by a person, without
  the cartoon roundness), **Delius** (rounded and upright, the calmest of the marker family, but
  barely reads as handwriting) and **Klee One** (a pencil hand, elegant and very readable, but so
  quiet it is close to Geist at a glance).
- **The pick: Kalam.** It is the only one that keeps what Greg liked — *"looks like a script …
  distinctive"* — while losing what he did not. Delius fixes the comic by giving up most of the
  hand; Klee One gives up the distinctiveness.

What Kalam costs:

- **Three static weights, 300/400/700, and no italic.** Reader text is drawn at 400 and 600; 600
  resolves to 700, which is fine for a title. Italic is synthesised by the browser on a face that
  already leans, so it leans further; reader text is rarely italic (dictation's live guess is the
  main case). `self-hosted-faces.test.ts` currently requires normal and italic at 400–700 for
  `--font-reader`; it changes to what Kalam has (normal, 400 and 700) — the test is about the face
  covering what it is drawn in, and the synthesised italic is a decision, written down in fonts.md.
- It is a taste call between close options, so it ships and **the comparison goes to Greg as a
  question** (screenshots of the shortlist), with Delius as the named alternative.

Change: `package.json` (`@fontsource/kalam` in, `@fontsource-variable/shantell-sans` out),
`src/web/tailwind.css` imports, `styles/tokens.css` `--font-reader`, the test, and fonts.md's table
and § Three faces.

## 2. Explanations gets Glossary's controls

Greg asked for three things by name: **different orderings**, **a prioritised default with a
threshold**, and **an option to find more**. Each is Glossary's, so each reuses Glossary's piece
(controls.md § Controls that do the same job look the same): `OrderGroup` with `.gloss-sort-btn`,
`ThresholdSlider` with `threshold.ts` (`applyThreshold`, `canThreshold`, `thresholdMax`,
`hiddenNote`), and the run row at the top of the column.

### 2a. Two scores per explanation (prompt `explanations/2`)

The ordering has to rest on something the model said, as Glossary's does. Each explanation gains
two required 0–1 numbers:

- **`difficulty`** — how likely this reader is to get stuck here;
- **`centrality`** — how much of the piece's argument depends on getting past this place.

Same names and same range as Glossary's, so the shared helpers and the reader's intuition carry
over. Required by the schema and the prompt; **optional on the type**, because every
`explanations/1` list has none and the read must keep working. A score outside 0–1 or not a number
is dropped (the field, not the explanation) and counted, as `GlossaryScoreDrops` does.

**The prompt change goes in the system block only.** `inputFingerprint` hashes the first pass's
user message, so changing that message would mark every existing list *stale* ("describes an older
version of the article"), which would be false. The version bump makes them *outdated* instead,
which is the honest word and stays quietly visible (explanations.md § The rules the code keeps).

### 2b. The orders, and the prioritised default

Four orders, as Glossary's, with Glossary's labels: **prioritised** (default), **reading order**
(Glossary says *first use*; an explanation has no "use", so the label says what it is), **hardest**,
**most central**.

**Prioritised is Glossary's rule, not FAQ's**: `difficulty × centrality` **gates**, reading order
**orders**. Glossary's product measures the cost of *not* knowing a term; for a passage it is the
cost of *not* getting past it — the same question, so the same arithmetic. (FAQ turns difficulty
round because for a question, easy-and-central is the high-level one Greg wanted first. That does
not apply here.)

- **The bar's starting position is Glossary's `0.10`**, borrowed, not measured: Greg's 2026-09-12
  rule is that most entries come in by default. It is calibrated on real lists after 1 November.
- **The track ends at the data's top score**, the foot line says how many are hidden, an unscored
  explanation survives every position — all of it `threshold.ts`, unchanged.
- **`prioritised` is offered only when the bar can hide something** (`canThreshold`), and a score
  order only when some explanation carries that score, so an `explanations/1` list shows no order
  row at all and looks as it does today.
- **The numbers are on every row** under a score order, as Glossary's (`d·72 c·85`), and both under
  prioritised; the product never is.
- **URL state:** `?explby=` and `?explbar=`, FAQ's pattern (`?faqby=`, `?faqbar=`; the runtime list
  in `params.ts`, the type beside the order helpers). Absent means nobody touched it.

The order helpers go in a pure `src/web/explanations-order.ts`, beside `faq-order.ts`, so a test
calls the rule the reader gets.

### 2c. Find more

The run row goes **at the top of the column, on every finished list**, as Glossary's:

- **Find more** when the forced run will append — the list is not stale, not outdated, and was
  written for the reader's current profile (all three already on the GET response: `stale`,
  `outdated`, `profileChanged`);
- **Write a new list** otherwise.

It replaces the foot's *Write it again* (the foot keeps only a running job's progress). The stale
banner and *Written for you* keep their own rewrite buttons, as today.

Server, copied from Quotes' append (`previousQuotesFrom`, `existingFor`, `lastAdded`):

- **`existingFor(onDisk, sourceHash, profileHash)`** returns the list to extend, or null: same
  `sourceHash`, not `isOutdated`, same `profileHash`. **One predicate** the stage uses; the client's
  label is the same three facts read from the response, and a test pins that they agree.
- The step reads the previous artefact from the store (as Quotes does) and, when `existingFor`
  accepts it, sends a **different user message** naming the places already explained (block id and
  quote) and asking for up to `explanationCap` more, none in a block already used. The first-pass
  message, and so the fingerprint, is unchanged.
- `toExplanations` is seeded with the existing blocks as taken, so one-per-block holds across the
  whole list (`repeated` counts it). The cap applies to the pass, not to the list.
- The result is the old list plus the new, in reading order; ids are unchanged (they are a hash of
  block and quote). New fields on the artefact: `passes` and `lastAdded`, and `addedAt` on each
  explanation (CLAUDE.md: store when it happened). `dropped` is this pass's.
- **An append that adds nothing is a real answer** (`lastAdded: 0`), not a failure, and the band says
  *No more places found* — Quotes' rule.
- Forced runs that do not append (stale, outdated, another profile) rewrite, as today.

**Not in this change:** the command bar's *Explanations › Find more* (`FIND_MORE_MODES`). The mode is
experimental and owner-only; adding it is a third member of a list with four places to tell
(find-more.ts). Named here so it is a choice, not an omission.

**The margin is unchanged**: it shows every fresh explanation, whatever the band's bar says.
Whether the margin should follow the threshold is a question for after the live runs.

## 3. The wasted space on the right

`explanations.css` sets `.mode-band.expl.has-about > .tl-scroll { padding-right:
var(--band-about-room) }`, which **replaces** the scroller's `0.7rem` right padding with the corner
buttons' clearance: `1.9rem` (about 30px) with the (i) alone and about `2.9rem` (46px) when
*Written for you* sits beside it — which it always does here. So every row stops 30–46px short of
the band's edge against 11px on the left, all the way down a list that scrolls, for a button that
sits only over the first row. Outline mode made and undid the same mistake (outline-mode.css § 70).

**The fix falls out of § 2c:** with the run row always at the top of a finished list, *it* owns the
corner's clearance (`.gloss-more`'s rule in glossary.css), and the list goes back to the scroller's
own `0.7rem`. The non-list states (loading, empty, error, stale banner) keep theirs. Verified in a
browser locally against a canned list, measured before and after.

## Stages

1. **The face** — §1. Small; done by me. Gates: `npm test` (self-hosted-faces, voices-css),
   typecheck, screenshots.
2. **Server** — §2a and §2c's server half: types, prompt `explanations/2`, schema, validation with
   score drops, `existingFor`, the append path in the step, tests on canned answers (first pass with
   scores, an append, an append adding nothing, a profile change rewriting, one-per-block across
   passes, the fingerprint unchanged by the bump).
3. **Client** — §2b, §2c's client half and §3: `explanations-order.ts`, URL params, the run row,
   order row, slider, score numbers on rows, the CSS. Tests for the order helpers and the label
   predicate; a browser check on a canned list at 1600 and 1280 wide.
4. **Docs and bookkeeping** — explanations.md, fonts.md, the question file for the face, the two
   notes.

GPT Sol reviews this plan before stage 2, and the code before the push.

## What waits for 1 November

- A real `explanations/2` run: do the two scores come back, and do they spread enough for the bar
  to do anything? (`canThreshold` hides the bar when they do not, so a failure is invisible to the
  reader but must be looked for.)
- Calibrating `0.10` on real lists, as 260915d did for Glossary.
- A real Find more: does the second pass find places worth having, or pad?

## The simpler option passed over

**Only the width fix and the orders, no Find more.** Fewer parts, no server change beyond the
scores. Passed over because Greg named Find more explicitly, and without it a threshold over a
capped list can only ever show fewer — the opposite of what he asked to be able to do.

## Progress

- [ ] Plan reviewed by GPT Sol
- [ ] Stage 1 — the face
- [ ] Stage 2 — server
- [ ] Stage 3 — client
- [ ] Code reviewed by GPT Sol
- [ ] Stage 4 — docs, question, notes
