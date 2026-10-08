# 261008a — The guide opens Glossary and Summary by itself when they are already made

Owned by [plans.md](../project/plans.md). Overseer queue item `qi-ztp3w9az`, the follow-up
[261007p](261007p-the-guide-acts-without-a-press-and-opens-every-new-article.md) deferred as
`Q-guide-acts-generating`. **Status: built, plan reviewed by GPT Sol; code review below.**

## What was asked

> err on the side of capability for the guide, unless there's high risk/stakes
>
> — Greg, 2026-10-07, on q-tyvutf

The Overseer's settlement of the deferred question, under that answer: Glossary and Summary are the
guide's commonest suggestions and stay buttons only because opening them can arm a paid run. When
the mode's artefact is already stored, opening it costs nothing and generates nothing, so the guide
opens it by itself like the other movement-only acts; when nothing is stored it stays a button.
Decide "already stored" from the same read the band uses, not a guess. Bookmark stays a press.

## Why opening a stored one is free

A press on Glossary, or on Summary's Brief or Fuller, arms an activation token (`activation.ts`);
the band claims it, waits for its own GET, and **consumes it without a run when the GET answers
`ready`** (`useAutoRun.ts`, step 2 — a `ready` retires the press as a `none` spends it). Neither
band spends on mount otherwise. Summary's **Thread** view does spend on arrival, so it is not in
this, and neither is the bare `mode:summary` key, whose landing view is whatever `?summary=` says
(it can be the thread). Diagram and Marginalia also spend on mount and are not touched.

## The keys, in one place

`src/acts-alone.ts` gains the one table both sides read:

| artefact | the store read (server) | the band's read (page) | keys that open free once it exists |
|---|---|---|---|
| glossary | `loadGlossary` | Reader's `glossaryRead` (handed to the band as `read`) | `mode:glossary` |
| simple | `loadSimpleSummary` | `GET /api/simple/:slug`, as `useSimple` reads it | `submode:summary:brief`, `submode:summary:fuller` |

"Made" means the read answered with an artefact — stale or outdated included, since the band then
shows it with its notice and still runs nothing.

## The prompt (server)

The system prompt stays static and cached. Glossary and Summary › Brief / Fuller keep their
*Button:* marker in `modeWordsSection`; its paragraph gains one sentence: a mode named on the
*ALREADY MADE* line beside their message opens at once for this answer, exactly like an *Opens at
once* one. The line itself goes in the final user message, beside `experienceLine`, resolved per
guide turn by the route (`guideMade`, like `guideExperience`): both reads in parallel,
`ArtefactNotMadeYet` meaning not made, any other failure logged and costing the line (the model then
treats them as buttons, which is the safe direction).

## The act (page)

`GuideAct` gains `made: ReadonlySet<string>` — the keys above that open free **at the moment the
answer finished**. `useGuideAct`, on `Answered`, asks `sources.madeNow()` (a new optional
`ArgumentSources` member Reader builds: `glossaryReady` for the glossary key, and the same
`/api/simple/` read `useSimple` makes, factored out into one function, for the two Summary keys)
and offers the act once that settles. A failed read means not made. `actsAlone(chip, made)` then
allows a `mode` chip whose key is in `made`. The chip's effect stays synchronous, so "the first
eligible chip in the answer" is still decided in draw order: a not-made Glossary button before a
Structure token does not steal Structure's act.

Why resolve it on `Answered` rather than inside the chip: an async check in the chip would have to
spend the act before it knew the answer, so a Glossary button with nothing behind it would silence
the Structure token after it.

The read is ours, not the model's: the model's token only proposes; the page's own read decides,
so a planted instruction can at worst open a Glossary that already exists.

## After the plan review (overrides the above where they differ)

[GPT Sol](261008a-plan-review-sol.md): *build with changes*, three P1s, all accepted. It confirmed
the ordinary stored path is free (a `ready` retires the press whatever the stale, outdated or
changed-profile flags say; Brief and Fuller move mode and sub-mode together, so Thread never
mounts; Marginalia is untouched).

- **F1 — a stored artefact does not make an armed press reliably free.** A reset between two reads
  answers `none` and the armed press spends. **The guide's act never arms**: Reader builds the
  Dock's two activators a second time with `arms` false, `modeDoor` takes both pairs, and the
  executor carries `openModeUnarmed`, which only the chip's act calls. A reader's own press is
  unchanged. Every mode the guide opens goes this way, the free ones too (arming them was a no-op).
- **F2 — a delayed act loses the expiry machinery.** With no page-side read there is no delay: the
  act is offered on `Answered` as before.
- **F3 — two reads can disagree.** **One snapshot per turn, from the server**: `guideMade` reads the
  stores once (`MADE_READS`, total over `MadeArtefact`), the model is told it (`madeLine`), and the
  `done` frame carries the same keys (`opensFree`) to `Answered` and on to `GuideAct.made`. Not
  stored on the message (`reduce.ts` strips it). This is the option passed over below as "the
  server tells the page", which the review showed to be the simpler one after all.

## The simpler options passed over

- **Page only, no prompt change.** The model would go on treating Glossary as a button — offering
  it anywhere in the answer — and the page would open it, so an offered Glossary would steal the
  act from the Structure the model said it had opened.
- **The page reads for itself** (the first draft of this plan: `madeNow` on `Answered`, Reader's
  glossary read and a shared `readSimple`). Rejected after the review: a second read can disagree
  with the one the model was told, and offering the act only after it settled reopened the expiry
  races 261007p had closed.
- **Every generating mode.** Each needs its own stored read on both sides, and three spend on mount
  regardless. Glossary and Summary are the ones asked for; the table extends by a row.
- **Open without arming.** Would make a wrong "made" free as well, but needs a second activation
  path through Dock's activators; the band's own `ready` check already makes the armed press free.

## Stages

1. Red first: `actsAlone` with `made`; `useGuideAct` offers `made` from `madeNow` and offers nothing
   until it settles; a guide answer whose first token is a made Glossary opens it; a not-made
   Glossary stays a button and a later Structure token still acts; the prompt line
   (`madeLine`) and `buildConverseMessages` carrying it for the guide only. Then the code.
2. Docs: chat-tools.md § The guide; security-map.md's chat-commands row only if its wording becomes
   untrue (it says the exception moves the reader — still true); Help on Chat if it names which
   modes open.
3. Sol code review (write-capable), gates, Sonnet browser check at 1440 / 820 / 390, push.

## As built

- Code review ([GPT Sol](261008a-code-review-sol.md), *land with its fixes*): no P0–P2; three P3
  stale comments fixed (one still named the dropped page-side `madeNow`), and `opensFree`
  assertions added on retry, edit and recovery.

## Log

- 2026-10-08: **seen in a browser**, Sonnet subagent, Playwright, local Supabase, about ten paid
  turns, no console errors. `fowler-phrenology` (glossary and plain-words summary stored):
  *"Open the glossary for me please"* opened Glossary by itself as the answer ended, at 1440, 820
  and 390, with only `GET /api/glossary/…` and `GET /api/jobs` — **no `POST /api/jobs`** — the
  answer said *"I've opened the Glossary for you"*, and Back returned to the guide. *"open the
  brief summary"* opened Summary › Brief by itself at 1440, again with no job POST. An article with
  neither (`name-spya-yegmpb`): an *Open Glossary (generates)* button that did nothing, at 1440 and
  390. Structure still opens by itself (1440). **Not seen**: Brief at 820/390, the not-stored case
  at 820. Shots: [Glossary opened](261008a-shot-1-glossary-opened-1440.png),
  [the answer](261008a-shot-2-answer-says-opened-1440.png),
  [not stored: a button](261008a-shot-3-not-stored-button-1440.png),
  [Structure](261008a-shot-4-structure-opened-1440.png),
  [phone](261008a-shot-5-glossary-opened-390.png).
- Noticed, not changed: the chip for a made Glossary still carries the bar's static *generates*
  marker (`modeGenerates`), though pressing it would only reopen it. The marker is the command
  bar's too; making it per-artefact is a separate change.
