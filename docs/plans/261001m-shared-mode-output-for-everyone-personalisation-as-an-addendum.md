# Shared mode output for everyone; personalisation as an addendum on top

Report: spya-j5f7yv (Greg's own, from production). Owner entry point:
[reader-profile.md](../project/reader-profile.md).

**Status: deferred — someday maybe. Nothing from it is on `dev` except this doc.** Greg, 2026-10-01,
answering the question below (relayed by the Overseer):

> I have vacillated about this a lot. I really don't know what's best. I would say that at the
> moment, making things be really personalized and relevant for the reader is the most important
> thing. Because if it's not valuable for individual readers, then nobody's going to end up using
> enough to bother sharing anything. ... Obviously in an ideal world we try and get the best of both
> worlds, so we try and make it be really personalised for the reader who owns the article and make
> it be more generically useful perhaps for the public version. I think I'm hesitating to suggest
> that we do that for now because A, it adds complexity and B, there's even an argument that maybe
> if I'm sharing something because I think the whatever summaries and everything else are really
> good, it might be a surprise. To find that what I've shared does not look like what I'm seeing.
> I'm less fussed about that second point but it does rankle. And so maybe you could imagine for
> each of these modes that are personalised as a way to switch the personalisation on and off, but
> it all just seems like a lot more complexity than it's worth for now. So I'm saying let's just
> optimise for the individual reader and add this somewhere as a 'someday maybe' set of
> improvements.
>
> — Greg, 2026-10-01

So everything stays personalised for the owner, as before, and the make-public dialog keeps naming
the artefacts written for the owner's profile. What is below is kept as the design to pick up if
this comes back, with two additions from the answer:

- **A per-mode on/off switch for personalisation** is the other shape Greg named. It is close to
  what existed until 2026-09-13 (the *Use your profile* checkbox,
  [reader-profile.md § What was here before](../project/reader-profile.md#what-was-here-before-and-why-it-went))
  and would bring back its problems: a control beside every button that spends, and regenerate-and-wait
  to see the other version.
- **Greg's second worry cuts against this design**: a sharer who likes what they see would find the
  public page different from their own view. The addendum shape softens that (the shared text is the
  same, only the marks are missing) but does not remove it.

**The built code is parked, not lost.** Stages 1 and 2 below were built and tested in a worktree
before the answer arrived, and are on the branch `parked/261001m-shared-output-addendum` (tip
`0007ee1ae`; not merged, not reviewed by Sol at code stage, and its migration
`20261001145857_glossary_for_you` was undone on the local database so it does not jump the migration
watermark). What it holds:

- **Stage 1** (`86ec4a181`): `PERSONAL_STEPS` in `src/profile.ts` (quiz, simple, trajectory,
  illustrated); `stepContextFor` in `src/jobs.ts` hands the profile only to those; `POST /api/jobs`
  resolves a profile only when a personal step is present; a glossary top-up onto a legacy profiled
  list keeps its stamp; Find more stops sending `useProfile`. Simple and Trajectory were left
  profiled pending the answer.
- **Stage 2** (`5aa44ead4`): the owner-only `glossaryForYou` step (`src/glossary-for-you.ts`), a
  `glossary_for_you` revision column classified `carry` and absent from every public projection,
  `MarkedForYou` in the glossary band with *Mark again*, the make-public dialog excluding it, reset
  skipping it without a profile. A failed marks call is recorded rather than thrown so it cannot
  sink the glossary it shares a job with. Two real calls (~$0.002) showed notes that tend to restate
  the definition rather than bridge from the reader's background — the prompt needs work.
- Picking it up means merging `dev` into that branch (expect conflicts; `src/web/GlossaryPanel.tsx`
  and `drizzle/meta` already conflicted once), regenerating the migration, and a Sol code review.

> These two things, having public documents and personalizing, are somewhat in tension because if
> it's personalized, then if I make it public, then it, you know, may not suit everybody. And so I
> think what I'm proposing is that perhaps we always do this, we always generate the stuff for those
> modes the same way, no matter what my background, but then we add some kind of, we do some extra
> processing afterwards that takes into account my background and my interests that personalize it.
> So, for example, maybe I might generate a glossary, and I always do that the same way, but then
> Then the post-processing personalization would flag some of those as being particularly relevant,
> or add a postscript that provides extra context that will be useful for me. […] So you don't
> change what everyone sees. You don't change the version that everyone sees. You add extra
> information to it that contextualizes it or makes it more useful, or metadata that makes it more
> useful for this reader. […] I guess let's not try and make this be too complicated. Look for a way
> to do this simply first, at least for a v1, even if it isn't perfect.
>
> — Greg, 2026-10-01 (spya-j5f7yv)

## Where we are today

The reader profile (*About you* + *Why you're reading this one*, joined into one string by
`src/profile.ts`) is put into the prompt of **eight stored artefacts**, every one of which a visitor
to a public article reads exactly as the owner's model wrote it:

| Artefact | Public? | Profiled today |
|---|---|---|
| glossary, ideas, quotes, tweets | yes | yes (`profileHash`) |
| simple (Brief / Simple / Fuller) | yes | yes, since 2026-10-01 (261001b) |
| sketch, and illustrated (inherits sketch's) | sketch yes | yes |
| trajectory | yes (route; stamp withheld) | yes — ordered for the reader's purpose (260930e) |

The make-public dialog lists which of them were written for the owner's profile
(`sharingPersonalisedList`, `src/messages.ts`) and says *"what it made the model leave out is still
visible in what it kept"*. That is a disclosure of the leak, not a fix.

Personal by nature and **never public**: chat, explain, quiz, Remember, live conversation, link
summaries, citation investigation. They stay exactly as they are.

## The design (v1)

Two rules, and one new thing.

**Rule 1 — anything a visitor can see is written for nobody in particular.** The eight artefacts
above stop receiving the profile. One place enforces it: the job runner builds `StepContext`, and
`profile` is put on it only for steps in a named set `PERSONAL_STEPS` (today: `quiz`, plus the new
step below). Every other step's `ctx.profile` is `undefined`, so their existing `profile: ctx.profile
?? null` lines write `profileHash: null` and send no `WHO IS READING` section, with no edit to the
stages themselves. A test holds it: for every step not in `PERSONAL_STEPS`, a job carrying a profile
produces a prompt without the profile text. (A type-level fence — `StepContext` without `profile`
for shared steps — is nicer but touches every step signature; named as the follow-up, not v1.)

**Rule 2 — what is written for you is stored beside the shared artefact, never inside it, and never
read by the public path.** A new owner-only column on the revision, like `quiz` already is, which
`PUBLIC_PROJECTIONS` (an allowlist) does not name. `tests/public-reads.test.ts` gets a line asserting
it is absent from every projection.

**The one new thing — "For you" marks on the glossary.** After a glossary is written (or found
already written), one cheap call reads the term list (name + gloss, no article text) and the
reader's profile, and returns a few terms worth this reader's attention with a one-line reason each:

```ts
interface GlossaryForYou {
  version: string;
  glossaryHash: string;     // which glossary it annotates (hash of the entry ids+names)
  profileHash: string;      // whose profile — never null: no profile, no addendum
  marks: { termId: string; note: string }[];  // ≤ 8; termId must exist in the glossary
}
```

On screen, owner only: a small *for you* mark on each flagged entry and its note as one line under
the entry's gloss. Nothing else on the glossary changes. A visitor sees the glossary without marks,
because the column is not in the public payload.

```
  GLOSSARY                                    ⓤ for you
  ─────────────────────────────────────────────────────
  Integrated information (Φ)            ★ for you
    A measure of how much a system is more than its parts.
    ↳ The paper's version differs from Tononi's IIT 3.0 you'll know.
  Synergy
    Information available only from the parts together.
```

Why the glossary first: it is the artefact the profile was "really for" (reader-profile.md § The
glossary is the case this feature is really for), and Greg's own example is flags on glossary terms.
It is the simplest shape (a pointer + one line), and one consumer proves the pattern before we copy
it.

**When it runs.** As its own step, `glossaryForYou`, which the glossary route appends to the job
when the owner has a profile. Its freshness is `(glossaryHash, profileHash, version)`, so it re-runs
alone when the profile changes, without rewriting the glossary. When the stored marks are for an
older profile, the existing *older profile* label (`WrittenForYou`) moves from the glossary onto the
marks and offers *Mark again*, which queues the step alone. Arriving spends nothing (the door rule).

**Cost.** One small call per glossary write per owner who has a profile: input is the term list
(~40–80 terms × a gloss, a few thousand tokens) plus the profile; output ≤ 8 lines. Cheap tier.
Order of a tenth of a cent. No change to the cost of anything else; the shared artefacts get
marginally cheaper (no profile section).

## What this changes for readers

- **Owner, after this ships:** new glossaries, ideas, quotes, tweets, sketches, plain-words summaries
  and trajectories are pitched at a general reader, not at them. The glossary gains *for you* marks.
  The others lose their tailoring with nothing in its place — **this is the real cost**, and it
  reverses two of Greg's own asks from the last two days: plain-words summaries shaped by profile
  and goal (261001b, SPIDERYARN-READING2-7A) and a trajectory ordered for the reason you're reading
  (260930e). See the open questions below.
- **Visitor:** nothing generated after this ships was shaped by a stranger's profile.
- **Existing artefacts are left alone.** They keep their `profileHash`, the make-public dialog goes
  on naming them, and they are replaced next time anybody presses *write it again*. No backfill, no
  migration of data.
- **The make-public dialog** gains nothing new; for a fresh article it now says *"Nothing here was
  written for your reader profile."* — which is true.

### Edge: *Find more* on an old, profiled glossary or quotes list

*Find more* passes the list's own setting (`profiled`) so as not to rewrite a list under a button
that says "more" (reader-profile.md § Find more). Under rule 1 the server never profiles a shared
step, so on a legacy profiled glossary `existingFor` would see a difference and **rewrite**. v1:
`existingFor` treats a stored hash with an unprofiled incoming run as appendable (the new terms are
unprofiled; the list keeps its old stamp, which is still true of most of it and keeps the dialog
warning). The client's `profiled` flag on Find more becomes dead and is removed.

## Stages

1. **Rule 1 + rule 2's test fence.** `PERSONAL_STEPS` in the job runner; the per-step prompt test;
   `existingFor` edge; drop the dead `useProfile:false` on Find more; docs (reader-profile.md,
   summaries.md, glossary.md, trajectory.md, the dialog copy note). Red first: the prompt test fails
   today for all eight.
2. **`glossaryForYou`.** Migration (one nullable `jsonb` column on `article_revisions`), the step
   (prompt per prompting-guide.md, validated: unknown termIds dropped, ≤ 8, notes ≤ 160 chars), the
   route wiring, the owner read, the public-projection test, the UI marks, the *Mark again* label.
   Red first: public-reads test for the column; a step test that drops an invented termId.
3. **Browser check** (Playwright, desktop + 390px), Sol code review, note in
   `docs/user-feedback/`.

## Simpler options passed over

- **Hide personalised artefacts from visitors** (make-public shows only unprofiled ones). Less code,
  no loss for the owner, but a visitor misses exactly the expensive artefacts the public page exists
  to share, and the owner has to regenerate to share. Greg asked for the opposite shape.
- **Profile only while private, regenerate on making public.** Pays twice, and the dialog becomes a
  spend.
- **Store both copies** (profiled for owner, plain for public). Doubles every write; already
  deferred in 260826t for that reason.
- **A free-text postscript under every mode, one generic prompt.** One table and one component for
  all modes, which is tempting, but a generic paragraph tends to restate the output; pointers to
  items are more useful and keep the shared text authoritative. Kept as the shape for summaries in
  v2 (open question 1).

## The questions put to Greg (answered: neither — see the top)

1. **Plain-words summaries and the trajectory lose their tailoring in v1.** Recommended: accept it
   for v1; v2 adds a postscript to Simple (*"for your purpose, ¶2 and ¶4 matter most, because…"*)
   and lets Trajectory's route be re-ordered per reader as an addendum. Alternative: keep those two
   profiled and treat them as personal — i.e. stop showing them to visitors.
2. **Only the glossary gets an addendum in v1.** Ideas and quotes could take the identical
   pointer-plus-note shape cheaply once the glossary one has been seen working.

## Review log

### GPT Sol, plan review, 2026-10-01 — "reframe, then build"; no P0, five P1s, all accepted

Answer kept in the session scratchpad; the changes it forces, each checked against the code:

1. **Seven public outputs, not eight.** Illustrated is not in `PUBLIC_PROJECTIONS`; its prompt
   already gets `null` and its stamp inherits the Sketch's. It stays owner-only and simply inherits
   `null` from a fresh shared Sketch. **But** stripping `ctx.profile` makes the `wrong-profile`
   refusal pass a legacy profiled Sketch (`profileIsStale(hash, null)` is false): keep illustrated
   reading the profile for that check only — i.e. the check compares against the *route's* profile
   — or accept it. Decision: illustrated is in `PERSONAL_STEPS` for the check (it puts `null` in its
   prompt already, `src/pipeline.ts` § illustrated), and a test pins fresh Sketch → illustrated
   `profileHash: null`.
2. **Find more on a legacy profiled glossary keeps the old stamp**, as quotes already does
   (`src/quotes.ts` § `profileHash: opts.existing ? …`). Otherwise the top-up stamps `null`, the
   make-public dialog stops naming a list still full of profiled terms. Test: stored hash after a
   real top-up.
3. **Trajectory's GET route uses a stricter comparison** (`null !== current`), so every fresh
   shared route would say *older profile* forever. A recorded `null` becomes "shared, never stale";
   a legacy non-null hash still compares.
4. **The dialog's exhaustive `ProfileCarrying` would sweep the addendum in** and call it "shared
   exactly as written". Exclude it explicitly (it is not public), with the type check kept.
5. **`glossaryHash` covers the exact prompt input** — id, name, gloss, order — from the same
   serializer that builds the prompt.
6. **Wiring:** the generic jobs route expands `["glossary"]` to add `glossaryForYou` (owner has a
   profile) before enqueue/work-key/ordering; it sits after `quotes` in `STEP_ORDER` so the
   glossary/quotes cache adjacency holds; `reads: ["glossary"]` in sharing-steps; classified in
   `reset-role.ts` so a reset with no profile does not queue it.
7. **The route resolves and attaches the profile only when the expanded job contains a personal
   step**, so profile edits stop defeating dedup on shared jobs and shared jobs stop carrying the
   text.
8. **Column is `carry`** in `pg-revisions.ts`; the owner read hides marks whose `glossaryHash` no
   longer matches or when the reader has no profile now. The owner export will include it in
   `revision.json`; owner-scoped, so fine, stated in export.md.
9. **A small `MarkedForYou` label**, not `WrittenForYou` stretched: it needs an action (*Mark
   again*), which `WrittenForYou` deliberately never has. The glossary's whole-list badge goes.
10. Greg approves the Simple/Trajectory reversal before building — sent via the Overseer.
