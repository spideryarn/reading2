# Plan review: 261006e — Skim's cue situates the quote; a term chip opens the glossary's card

You are reviewing a **plan**, read-only. Change no file.

## The candidate

Live, uncommitted, one untracked file in this worktree:

- `docs/plans/261006e-skim-cue-situates-the-quote-and-term-chips-use-the-glossary-card.md`

Base: `origin/dev` at `b52465e0`. No code has been written.

## What it is for

Two feedback reports from Greg (the product owner), quoted verbatim in the plan. One asks for a
prompt change to the Skim route's per-stop cue; the other for a UI change to the glossary term chips
under a Skim stop. He asked for the simplest version that gets most of the value.

## Where to start (not a limit on scope)

- `src/skim.ts` — `SKIM_SYSTEM`, `MAX_CUE_CHARS`, `PROMPT_VERSION`, `skimInputHash`, `validateRoute`
- `src/web/SkimPanel.tsx` § `StopCardView`; `src/web/stop-card.ts`; `src/web/modes/skim/SkimMode.tsx`
- `src/web/ProseHoverCard.tsx` § `TermCard`, `TermActions`; `src/web/Tooltip.tsx` § `interactive`, controlled `open`
- `src/web/Spine.tsx` for how a controlled tooltip is opened by a tap
- `docs/project/skim.md`, `docs/project/prompting-guide.md` § Measuring a prompt change, `docs/project/tooltips.md`

## Your independent pass first

Attack the plan: is each stage buildable as written against the code that exists? Is anything
claimed about the code false? Does stage 1 break something (keyboard, touch, a visitor's band, the
"one snippet open at a time" rule, focus when the chip is pressed, a card inside a scrolling band or
a band that covers the prose on a phone)? Is stage 2's measurement able to show what it claims, and
is the ship rule sound? Is there a simpler version that gets most of the value?

Severity: **P0** would ship something wrong to readers or lose data; **P1** the stage cannot be
built as written or will produce a wrong result; **P2** worth fixing; **P3** note. Give every
finding an id (F1, F2, …), the file and line it rests on, and what you would do instead. End with
one line: `VERDICT: ready` or `VERDICT: not ready` (not ready needs at least one P0/P1).

## My own suspicions (already mine; spend most of the run elsewhere)

- Whether `Tooltip` can be both hover-opened and tap-pinned on one trigger without the two fighting,
  and whether `TermCard` can be exported without dragging the prose hover machinery with it.
- Whether the cue cap should simply go to 200 up front.
- The sentence I would least like to be wrong about: "an older prompt over the same article is
  outdated, not stale, and is not announced", i.e. bumping `PROMPT_VERSION` to `skim/10` shows no
  banner on existing routes.
