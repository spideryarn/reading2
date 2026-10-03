# Illustrated: a note, with a microphone, to steer the picture

Up: [plans.md](../project/plans.md) · the mode: [illustrated.md](../project/illustrated.md)

Report spya-wxd4nq (SPIDERYARN-READING2-12), the half that was deferred on 2026-09-04:

> I use the illustrated diagram sub mode. There should be a text input box with a microphone next to
> it for me to add something to the prompt for how I want the image to come out.
>
> — a reader, 2026-09-04 (report spya-wxd4nq)

The other half — legible lettering in the plates — shipped that day
([260904_1244](../user-feedback/260904_1244-illustrated-plates-have-no-text.md)). Its *Deferred*
section says why the box was not a text field bolted onto the button: a job **freezes its inputs**,
so a steer that is not on the job would break retry-after-restart, dedupe, freshness and running the
stage from a slug.

## What the reader gets

Under the picture (and in the empty and "draw the Sketch first" states), one box:

```
  How should it come out?  (optional)
  ┌──────────────────────────────────────────────┐ ┌───┐
  │ fewer scenes, bigger lettering; a medieval   │ │ 🎤 │
  │ map rather than a manuscript                 │ └───┘
  └──────────────────────────────────────────────┘
                                   [ Paint again ]
```

- The microphone is the shared dictation control (`useDictationField`, `DictationButton`,
  `DictationStrip` — [dictation.md § Adding it to a box](../project/dictation.md#adding-it-to-a-box)),
  context `{ kind: "article", slug }`, kept as `illustrated:<slug>`. Paint buttons are disabled
  while it is armed or transcribing, per that section.
- The box is pre-filled with the note the current picture was painted with, so pressing Paint
  again without touching it keeps the steer; clearing it paints plain.
- Whatever note a picture was painted with is shown with it, beside the brief — the picture's
  provenance, like the brief itself.

## The decision: the note lives on the job, not on the article

**Chosen:** the note is a field of the `POST /api/jobs` request, frozen onto the job as
`Job.illustrationNote` (new nullable column `jobs.illustration_note`), handed to the step as
`ctx.illustrationNote`, and recorded on the artefact it produced as `Illustrated.note`.

Against each of the four things the deferred note named:

| | how it holds |
|---|---|
| restart / lease lapse | it is on the job row, so a re-claimed job paints with it |
| Retry | `retryJob` copies it, as it copies `url`, `upload` and `profile` |
| dedupe | `sameWork` and `workKeyFor` both compare it — two presses with different notes are two jobs; the key gains the field **only when present**, so every existing key hashes as before |
| freshness | `inputFingerprint` gains a `note:` line **only when present** (the figures precedent), so no existing picture goes stale; the step's `stamp` uses the job's note, the two read sites (`loadIllustrated`, `illustratedIsCurrent`) use the picture's own recorded note |
| from a slug | **not preserved, deliberately** — `npx tsx scripts/stage.ts illustrated <slug>` goes through `enqueue` and carries no note, so it repaints plainly; see *Consequences*. This is the one of the four the job-scoped design gives up |

**Passed over: an article-scoped stored note** (a column beside `purpose`, edited through
`PATCH /api/library/:slug`, resolved server-side at enqueue like the profile). It is what the
deferred section sketched, and it has one real advantage — the CLI would inherit the note. It costs
a second column, a second write route and store method, a resolve step at enqueue, and a new
staleness question (*"your note has changed since this was painted"*) for a box the reader is
typing in. The reader-facing behaviour is the same either way, because the box pre-fills from the
picture's recorded note. The profile's rule — *the caller must not get to say who the reader is* —
does not carry over: the note is not a claim about the reader, it is the reader's own instruction
on their own article, exactly as a chat message is.

**What the note means to freshness, said once.** The note is a *request parameter*, not an input
that can drift: nothing changes it after the picture is painted. So it can never make a picture
stale at the read sites. It does enter the step's stamp, so that **an unforced job carrying a new
note is not "done"** — otherwise a press with a note on a current picture would run, skip, and
report success having ignored the reader (the silent-success shape).

## How the reader's text is bounded

It is untrusted input to a model, written by the article's owner on their own article — so the
risk is not a stranger, it is the note quietly defeating the rules that make the plate honest.

1. **Shape, at the route.** A string, trimmed; empty is absent; at most 400 characters (refused
   with a 400, not truncated, so nothing the reader said silently vanishes); control characters
   other than newline and tab refused. Only with a request that names `illustrated` — a note on any
   other job is a 400, because no other step reads it and accepting it would be a field that does
   nothing.
2. **Ownership, unchanged.** `enqueue` already refuses a slug the caller does not own (404), and
   Illustrated is owner-only (not on the public shelf; decided in 260929c).
3. **Where it goes in the prompt.** Only into the **brief** call's user message, as its own fenced
   section, `JSON.stringify`-quoted, present only when there is a note — so a plate without one is
   asked byte for byte what it is asked today, and `ILLUSTRATED_VERSION` does not move. The section
   says what the note may change (register and style, which parts to foreground, how many vignettes,
   density, lettering size within our rules) and that it cannot add anything the article does not
   say, and does not override the rules above it; where it asks for something they forbid, follow the
   rules and do the rest.
4. **No direct path to the image call — but no literal guarantee either.** The illustrator gets
   the brief's composition inside our fixed envelope, as now; the note is never placed in the image
   request by our code. The brief model *can* copy note text into its free-form composition or into
   a vignette title, and both reach the illustrator: the composition is only length- and
   control-bounded, and `lettersFor` captions from the model's titles, including a dropped
   vignette's. The envelope is *a bar, not a boundary* (`src/illustrated.ts`). So this is the
   **same accepted residual the mode already carries for an article's author**, now with the owner
   as the persuader, and not a new guarantee. What does hold: the reader-facing *what it depicts*
   list still only shows vignettes whose quote is verbatim and block-local, titles stay capped and
   control-checked, and at most three figures go.
5. **Same character policy as the rest of the plate.** Control, zero-width and bidi-format
   characters are refused by the predicate the brief's own fields already use
   (`src/illustrated-plate.ts`), because the note is both displayed and forwarded.
6. **Logs and the wire.** Never logged — its length only (`noteChars`), like the profile. Stripped
   from `publicJob`, like the profile; the panel reads it from the artefact.

The residual risk is the one the mode already accepts for an article's author: the brief model is
persuadable about *what to draw*. Here the persuader is the owner, about their own picture, with
their own money.

## Consequences, named

- **A command-line run carries no note**, so `npx tsx scripts/stage.ts illustrated <slug>` on a
  steered picture repaints it plainly (its stamp no longer matches). This is the one property of the
  deferred note's four that the job-scoped design gives up; the article-scoped alternative would
  have kept it, and the reset one below. The same is already true of a profiled Sketch run from the
  command line. A `--note` flag is not built.
- **A reset's regeneration paints without the note.** A reset is *as if just imported*, and
  `JobReset` snapshots the profile only. Deferred, not forgotten: if Greg wants the note kept
  across a reset, it goes into `JobReset` beside `profile`.
- **The automatic first paint carries no note** — there is nothing in the box before the first
  picture exists unless the reader types first, and then they press the button themselves.

## Stages

1. **Server.** Migration (one nullable column), `Job`, pg-jobs row mapping, `parseJobRequest`,
   `enqueue`, `sameWork` (a trailing parameter), `workKeyFor` (through `WorkKeyExtras`, spread only
   when present, so `enqueueSuccessorIn`'s positional call and every old key are untouched),
   `retryJob`, `StepContext`, `inputFingerprint` and the three sites — the preflight `stamp` and the
   post-run `sourceHash` assignment both from the one `ctx.illustrationNote` — `renderPrompt`'s
   conditional section, `Illustrated.note` read back by `readStoredIllustrated` (stored path only,
   never from the model's brief), `publicJob`. Tests red first: the work-key grid gains differing
   notes and a successor-shaped call; a no-note brief request is byte-identical to today's; a noted
   one carries the section; an unforced noted job on a current plain picture is not done, and after
   a noted run a second unforced run with the same note is done; stored round trip with and without
   a note; the route refuses a note on a non-illustrated job, an over-long one, and one with a
   control, zero-width or bidi character.
2. **Client.** The box in `IllustratedView`, `useStepJob`'s `StepRun` gains `illustrationNote`,
   `stepRunRequest` sends it (tested directly), `useIllustrated`'s three verbs take it; the note
   shown beside the brief.
3. **One real paint with a note** on a local article, looked at, to prove the note steers rather
   than merely arrives (written up in this plan).
4. Docs: [illustrated.md](../project/illustrated.md) section, [dictation.md](../project/dictation.md)
   box count, the feedback note.

GPT Sol reviews the plan before stage 1 and the code before push.

## Plan review

GPT Sol, 2026-10-03 ([review](261002j-illustrated-steering-note-review-sol.md)): agreed with job
scope, no P0. Taken: the stored reader would have dropped `note` (P1); the prompt-boundary claim was
false and is now stated as the existing residual (P1); `workKeyFor` goes through `WorkKeyExtras`
because `enqueueSuccessorIn` calls it positionally (P1); the run-from-slug trade-off stated honestly
and the command named correctly; a post-run freshness test; the shared character policy;
`stepRunRequest`, not `jobBody`. A paid hostile-note eval is not run: the residual it would measure
is the one the hostile *article* fixture already shows, with the owner as the only party.

## Stage 3: one real paint with a note, 2026-10-03

The shipping stage through the harness (`evals/illustrated/run.ts --note`), Noema, run twice side by
side: once plain, once with *"Draw it as an antique sea chart rather than a manuscript page, with no
more than five scenes on the first plate, and make the lettering large."* Results and overview plates
are in `evals/results/illustrated-261002j-plain/` and `-noted/` (the zoom plates were not kept, to
spare the repository 7 MB of PNG).

| | plain | noted |
|---|---|---|
| register the brief chose | illuminated manuscript page | antique hand-drawn sea chart |
| vignettes on the overview | 11 | **5** |
| vignettes kept / written | 26 / 27 | 20 / 21 |
| brief | $0.4377, 369 s | $0.3615, 309 s |
| plates | $0.2042 | $0.2041 |

**The note steers rather than merely arrives**: the style, the scene count and the size of the
lettering all moved as asked, and the zoom plates, which the note did not mention, kept 8 each. Every
caption on the noted overview is spelt correctly and readable at thumbnail size.

**One finding, and it is an existing one.** The sea-chart register brought its own ornament:
scattered depth soundings ("207", "10d", "25") in open water. They are numbers nobody supplied, so
they are the *"glyph-shapes that are not words"* that [illustrated.md](../project/illustrated.md)
already records under *Don't compose scenes made of writing*, not a misspelt caption. A note that
picks a register full of lettering (charts, ledgers, scrolls) will invite more of it. Nothing is
built against that: the register is the reader's choice, and the captions stay correct.
