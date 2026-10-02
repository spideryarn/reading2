# Brief is written for a reader in a hurry (9P, rpqqxb)

Overseer queue item `qi-52z3tb69`, session fb9p. Two reports from Greg.

- **SPIDERYARN-READING2-9P** (`spya-r2auqd`), filed 2026-10-01 19:56 on production build `6bdf24dc`:

  > I still see the "Write it" button if I open up Summary mode for the first time for a given
  > article and move the slider directly to Briefer. So Briefer and Fuller and Simple should all
  > auto-generate as needed when they're first opened without me needing to hit the "Write it"
  > button.
  >
  > Oh, and I think we want Briefer to be the default.

- **`spya-rpqqxb`** (never reached Sentry), filed 2026-10-02 09:51, on the same article:

  > The Briefer summary should also use slightly simpler language, and slightly less jargon, i.e.
  > assume it's for someone with less expertise or in more of a hurry.
  >
  > And in general, do some web research on what makes for a good summary. e.g. perhaps start with
  > the goal of the paper, and end with the conclusion/takeaways?

## 9P was built by 7T and 8N, bar one hole

Greg's build `6bdf24dc` contains neither of the two changes that answer it:

| change | commit | in `6bdf24dc`? | on `main` now? |
|---|---|---|---|
| 7T: pressing Summary writes the levels ([261002a](261002a-summary-generates-on-open.md)) | `3a9e040f4` | no | yes |
| 8N: Summary opens on Brief ([261002c](261002c-summary-opens-on-brief.md)) | `ac466a12e` | no | not yet (on `dev`) |

The slider and its end icons already armed the `simple` write in `6bdf24dc`. What his build lacked was
the bar press arming it. Every level shares one job, so one press writes all three. A pasted or
restored `?mode=summary` still arms nothing, by design: a mount is not a press (`useAutoRun.ts`). The
first slider move after such an arrival does arm.

**Checked in a browser on dev (`337fae41`), on four local articles with nothing stored**, by a Sonnet
subagent driving headless Chrome:

- pressing Summary on the bar started the write ("Writing it in plain words"), with no button;
- arriving by URL showed *Write it*, as designed, until a pointer drag to Brief or a click on the
  Brief end icon, which started the write;
- pressing Summary and then dragging to Brief ran exactly one `simple` job, with no button.

**The hole — GPT Sol's plan review, P1.** During a pointer drag, the level moves on each `input`
event, but the press was armed only on `pointerup`. A touch drag that the browser takes back for
scrolling ends in `pointercancel` instead. The level has already moved, nothing was armed, and the
band sits on Brief with an idle *Write it*. That is Greg's sentence, on a touch screen.
**Fixed:** the drag arms on its first move (`SummaryMode.tsx`), red-first in
`tests/pressing-a-chip-arms-it.test.tsx`.

**Exceptions that stay, by design:** a URL arrival shows *Write it* until a gesture; after an
automatic run fails, *Write it* is the retry, because `useAutoRun` makes one automatic attempt per
session; and *Write it* may flash for a frame between the empty GET and the run starting.

## rpqqxb — what is wrong with Brief

Greg's own Brief, read from production (`simple-prompt/2`, written for his profile):

> This experiment asks whether the hippocampus matters while rats rear up on their hind legs. …
> Rearing, a pause to sample the surroundings, linked with strong theta, had never been tested for
> spatial memory. A depth camera triggered closed-loop optogenetic silencing of dorsal hippocampus
> during rears, only in the study phase. This was done in a delayed win-shift radial maze task. …

It carries more jargon than the Simple level beside it. Simple explains *halorhodopsin* and *theta*;
Brief drops the explanations and keeps the terms. Two causes:

1. **The squeeze.** At about 80 words, the cheapest way to keep every fact is to drop the
   explanations. That is the density–readability trade-off the research below names.
2. **The profile.** `PROFILE_RULES` says *"Assume the background they claim. Do not explain what they
   have told you they already know"*, and Simple's prompt adds that what the reader knows "counts as
   everyday words". Greg's profile claims the field, so each level is licensed to skip the
   explanations, and Brief, being shortest, uses that licence most.

The research write-up is [261002c-what-makes-a-good-summary](../research/261002c-what-makes-a-good-summary.md).
In short: goal, then finding, then takeaway; results over methods; at most a couple of technical
terms, each explained; and a shorter summary drifts denser unless it is told to drop facts rather
than explanations. The shape Greg suggests, starting from the goal and ending on the takeaway, is
already the shape of all three levels (261001p). One word changes there.

## What we build

A prompt change only, in `src/simple-summary.ts`:

- **Brief's own section (`NOTCH_UP.brief`) says who it is for.** It is for a reader in a hurry from
  outside the field, **even when the request describes an expert**. The profile still steers what
  comes first; it no longer licenses field terms at this level. Also:
  - at most two technical terms, each said in everyday words where it appears; a term not needed to
    follow the point is left out, not explained;
  - how it was done gets one plain phrase at most, with no equipment, technique names or conditions;
  - only the numbers the takeaway rests on.
- **Brief's line in THE READER section** (`KNOWN_WORDS`) replaces "what they say they already know
  counts as everyday words": the description may steer what comes first, never the words.
- **A Brief-only section after `PROFILE_RULES`** (`AFTER_PROFILE`) says this version is for an
  outsider even when the reader claims the field, and that it wins over "Assume the background they
  claim". It comes after, so it is the last word on the profile; first drafted inside THE READER,
  where the shared rules would have followed it (Sol's plan review, P1). **`PROFILE_RULES` is not
  edited**: five prompts share it.
- **The shape's first line** becomes *"its goal or question, or its subject"*. That is Greg's
  "start with the goal", for all three levels.
- **`SIMPLE_PROMPT_VERSION` → `simple-prompt/5`.** The stored shape does not change. Stored summaries
  read as outdated, which is deliberately silent (SPIDERYARN-READING2-55), so nobody's summary is
  rewritten unasked.

### Choices named

- **Brief ignores the reader's claimed expertise.** This is Greg's "assume it's for someone with
  less expertise", and it is his own profile that produced the jargon. The cost: an expert who wanted
  a terse expert's Brief no longer gets one. Simple and Fuller are still written to the profile, and
  the slider is one step.
- **Simpler options passed over:**
  - *Lowering Brief's pitch from twelve to ten.* It is already pitched at twelve, and the failure
    is the profile and the squeeze, not the pitch.
  - *Dropping the profile from Brief's call entirely.* That would cost a separate request shape for one
    level and lose the goal steering, which is wanted.
- **Deferred:** a cap enforced in code on technical terms, which has no reliable detector, and any
  change to Simple's or Fuller's pitch, which nobody asked for.

## Measuring it

Per [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md), with
`evals/simple/probe.ts` (production's `generateSimpleSummary`, `--power high`, effort `high`, the
fidelity guard on, exactly as a press runs).

- Five local articles. Greg's own, the rat-rearing paper, imported locally as
  `s41598-023-33209-9-spya-s0qydm` (Sol: the four first chosen left it out). Also
  `entropy-24-00930-spya-pywwkq` (neuroscience), `source-spya-f550ta` (ball lightning, a physics
  review), and two essays, `scaling-hypothesis` and `analog-cognition-…`.
- Two readers: `none`, and `about`, the synthetic expert in `readers.json`. That reader claims
  machine learning, cognitive science and information theory, which is Greg's case on these
  articles.
- Arms separated in time: `fb9pb1`, `fb9pb2` (the old prompt, twice: the control), then `fb9pa1`,
  `fb9pa2`. That is 40 presses, about $8 (the 16 control presses on four articles came to $3.14).
  The probe now records the fidelity guard's own record beside each run (`check`).
- **Screens:** Brief's words, its share of words outside the 6,000 commonest
  (`evals/plain-words/common-words.ts`), and Flesch–Kincaid grade, for each arm and reader.
  Simple's and Fuller's words, as a check that they have not moved.
- **Blind read:** Brief pairs, old against new, same article, reader and draw, interleaved with a
  control set of old against old. Sides come from `crypto.randomInt`, and the balance is printed
  before judging. Each side carries the passages it cites, so the judge can check fidelity against
  the source. A fresh Opus subagent reads only the pairs file. **Q1:** which would a hurried reader
  from outside the field understand faster? **Q2:** did either lose, bend or blur a claim against
  its passages? **Q3:** which opens on the goal and ends on the conclusion?
- **Ship if, declared before the after-runs** (Sol P1). Ties are left out of every ratio.
  - **Q1:** the new Brief wins at least two to one, **separately for `none` and for `about`**.
    Its share of decided test pairs must also exceed the control's larger side by at least 20
    points.
  - **Q2:** no more fidelity faults on the new side than on the old.
  - **Q3:** the new side does not lose the shape question.
  - **No failed runs** in the after arms. The guard's flags are reported, but they are not a gate:
    the control arms ran before the probe recorded them, so there is nothing to compare them with.
- **What it cannot see:** whether the takeaway is the piece's *real* conclusion beyond the passages
  each sentence cites. That is read by hand on Greg's article. Write-up:
  [261002q-brief-plainer-prompt-eval](../investigations/261002q-brief-plainer-prompt-eval.md).

## Tests

- `tests/simple-summary.test.ts`: Brief's system prompt says it is for a reader outside the field
  even when one is described, and says so after `PROFILE_RULES`. Neither Simple's nor Fuller's
  prompt says so, and every level opens on the goal. Red first.
- `tests/pressing-a-chip-arms-it.test.tsx`: a drag that ends in `pointercancel` has armed. Red
  first.
- The version bump needs no test edits: the tests read `SIMPLE_PROMPT_VERSION`.

## Reviews

- Plan: GPT Sol, read-only — `261002h-brief-plainer-plan-review-sol.md`. No P0. Three P1s, all
  taken: the touch hole, the override's position, and the measurement's ship rule (it now includes
  Greg's article and the guard record). Two P2s, both taken: the exceptions are named above, and the
  cost and test fallout are corrected.
- Code: GPT Sol, workspace-write — `261002h-brief-plainer-code-review-sol.md`.
