# Simple — a plain-words orientation, as a sub-mode of Summary

A second sub-mode of Summary mode: a few short paragraphs, in everyday words, saying what the piece
is about, why it matters and what its key ideas are, each paragraph with a door back to the passages
it came from. Generated on demand, kept, cached on a content hash like the other stages.

Asked for by an admin through the Feedback button, 2026-09-30
([SPIDERYARN-READING2-6E](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6E), on
`dongetal25-spya-vfmvmm`). Greg's words, verbatim:

> Add a sort of sub mode to the summary mode for something like, explain it to me like I'm 12 or 15.
> I'm not sure quite what the level is. You could call the sub mode simple, or even just ELI12 with a
> tooltip. And I guess the idea is that it would give a summary of, at most, I suppose, a few short
> paragraphs using simple language, kind of minimizing jargon, or if it uses jargon, very sparingly
> and with a clear explanation. It just helps the reader orient, like, okay, what is this about and
> why is it important, and what are the key ideas or whatever. You basically provide a short, really
> digestible summary. And maybe actually we include an ELI12 and an ELI15 or something, where one is
> shorter and simpler, and the other is just a little bit longer and just allows itself just a little
> bit more of the complexity. But in both cases, try and use clear language.
>
> — Greg, 2026-09-30

An admin's request is built without debating whether; simplest-first decides how
([feedback-reports.md](../project/feedback-reports.md)). The run is unattended, so decisions and
assumptions are written here rather than asked in chat.

## Checked first: not already built

`git log -300`, `docs/plans/`, `docs/user-feedback/` and `gjd-remote ls`, 2026-09-30: nothing on
ELI / Simple summaries. The nearest work is
[260926a-plainer-summaries-and-glossary.md](260926a-plainer-summaries-and-glossary.md), which made
the *gists* plainer; it did not add a prose summary, and [summaries.md](../project/summaries.md)
§ *What this deliberately does not have* says "Anything generated on demand" and "The expertise
axis" — this plan is the admin's explicit reversal of the first for one sub-mode, and a single
level rather than the second.

## The tension, named

This is the feature closest to [vision.md](../project/vision.md)'s anti-goal — *"trying to replace
the words with quick and easy summaries"*. Greg's own framing is the answer: **it helps the reader
orient**, before reading, not instead of it. Three things keep it on the right side of the line:

1. **Short, and capped by code.** At most four paragraphs, and the prompt asks for well under 250
   words. An orientation, not a digest.
2. **Every paragraph is a door.** Each carries the ids of the passages it rests on, drawn as the
   same `BlockRef` chips the rest of Summary uses; hovering shows the passage, clicking goes there
   ([summaries.md § A summary is a door](../project/summaries.md#a-summary-is-a-door)).
3. **It says what it is.** A one-line foot: written by AI in plain words to help you get your
   bearings; the article says it better, and each paragraph links to where.

## What v1 is

```
 ┌── spine ──┬──────── SUMMARY (the band) ─────────────┬──── the article ────┐
 │           │  SUMMARY    [ Gists | Simple ⓘ ]        │                     │
 │  ▇▇▇▇▇▇   │ ──────────────────────────────────────  │                     │
 │  ▇▇▇▇     │  This paper asks whether a computer     │                     │
 │  ▇▇▇      │  model can learn to … (what it is)      │                     │
 │  ▇▇▇▇▇▇   │     spya-k3m9qt  spya-p7w2dn            │                     │
 │  ▇▇       │                                         │                     │
 │  ▇▇▇▇     │  Why it matters: …                      │                     │
 │  ▇▇▇      │     spya-…                              │                     │
 │  ▇▇▇▇▇    │  The key ideas: …                       │                     │
 │           │     spya-…  spya-…                      │                     │
 │           │ ──────────────────────────────────────  │                     │
 │           │  Written by AI in plain words to help   │                     │
 │           │  you get your bearings. Each paragraph  │                     │
 │           │  links to where the article says it.    │                     │
 └───────────┴─────────────────────────────────────────┴─────────────────────┘
```

- **One level: Simple, pitched at a curious 15-year-old.** The chip is labelled **Simple**, and its
  tooltip says *"Explain it like I'm 15: what this is about, why it matters, and its key ideas, in a
  few short paragraphs of everyday words."* Why 15 and not 12: [prompting-guide.md](../project/prompting-guide.md)
  says *plainer means equally specific*, and on a dense paper a 12-year-old pitch is where a number,
  a direction or a hedge gets dropped. 15 is the level that can stay faithful. **Deferred: ELI12**,
  the shorter, simpler second level Greg floated ("maybe actually we include…") — see *Deferred*.
- **`?summary=simple`** (push), absent for `gists`, the existing panel. The chip is **Gists**, not *Outline*: `outline` is a retired mode name that now resolves to Structure (Sol P2-1). Its own key, as
  `?remember=` and `?referee=` are. `?deep=` keeps its meaning and is simply unused under Simple.
- **Owner, nothing stored:** pressing the Simple chip runs the job
  ([`useAutoRun.ts`](../../src/web/useAutoRun.ts)); arriving on a URL with `?summary=simple` does
  not (the rule in [new-mode.md](../project/new-mode.md)). While it runs, the band says so, the way
  FAQ's does.
- **Visitor on a public article:** sees a stored one; with none stored, a line saying none has been
  made. A generated artefact is readable by a visitor by default
  ([new-mode.md § The artefact](../project/new-mode.md#the-artefact-if-the-mode-shows-one)).
- **Not behind the experimental switch.** Summary is a core mode and Greg asked for this inside it.
  The call is cheap (see *Cost*) and only made on a press.
- **Plain text.** No markdown, rendered as text ([security.md](../project/security.md)).

## The artefact

```ts
/** One plain-words paragraph and the passages it rests on. */
type SimpleParagraph = { text: string; ids: BlockId[] };   // ids: 1–3, deduplicated, body evidence only
type SimpleSummary = {
  version: string; generator: string; slug: string; sourceHash: string;
  generatedAt: string; elapsedMs: number;                   // the stamp fields, as `Faq` has them
  paragraphs: SimpleParagraph[];                            // 2–4, enforced by code
};
```

- **Step `simple`**, artefact kind `simpleSummary`, column `simple_summary jsonb` on
  `article_revisions` (artefacts are columns there — schema `spideryarn`). One additive migration:
  the column and the `revision_step_runs.step_name` CHECK widened
  (`tests/db-step-constraint.test.ts`). A route cannot write a revision column: `writeArtefacts`
  needs a live job that owns the draft revision (`requireLiveJobOwnsDraft`,
  `src/store/artifacts-pg.ts`), which is the main reason this is a step (Opus, below).
- **Input: `articleWithIds` over the body evidence** (`isBodyEvidence`, as `faq` does). It sits
  beside `faq` in `STEP_ORDER`, but **not for a cache share**: a mode press is its own job and shares
  no cached prefix with another press (`src/pipeline.ts` § article-cache groups, `src/models.ts`),
  so the first draft's "mostly a cache read" was wrong (Sol P1-2). Model tier `capable`, like `faq`.
- **Effort `medium`, not `faq`'s `high`**: this is orientation over text the model already has, not
  multi-step inference, and `referee-criteria` went from 35–39s to 19s at `medium` with the same
  results. Measured against `high` on the probe articles in stage 1 before it is fixed.
- **Validation in code, not in the prompt's hope** (Sol P0-2, P1-4), with FAQ's body-evidence
  symmetry as the template:
  - the answer must parse to an object with a `paragraphs` array; malformed JSON, a refusal, an
    empty answer or a `max_tokens` stop is a stage failure and stores nothing;
  - ids are checked against **the exact body-evidence set sent**, deduplicated, capped at three; the
    ones dropped are counted in the step's report;
  - **a paragraph with no surviving id is dropped** — every paragraph is a door, so *why it matters*
    must rest on something the piece says, or go (vision.md: every assertion anchored to a block);
  - empty text is dropped; more than four paragraphs is a failure, not a cut, and so is a total over
    a word ceiling (~320 words, the prompt asks for under 250), because a silently truncated
    orientation is a wrong one;
  - fewer than two surviving paragraphs is a failure: nothing stored, the band says it could not be
    made and offers to try again.
- **Stamped** with one exported `SIMPLE_VERSION` (`simple/1`), used both in the artefact and the
  expected stamp. The owner GET returns `stale` (the article moved: a notice) apart from `outdated`
  (an older prompt: silent) — [new-mode.md](../project/new-mode.md).
- **Every total the compiler asks for**, and the residue nothing checks, from
  [new-mode.md](../project/new-mode.md): the GET route, the export put-chain, the public projection
  and DTO (rebuilt as `{ paragraphs: [{ text, ids }] }` only, no stamp), `JOB_DISPOSITION`,
  Metadata's re-run list, the Messages-wire prompt inventory in
  [ai-gateway.md](../project/ai-gateway.md). FAQ's stage-1 commit (`b31d8b87`) is the template,
  file by file.

## The prompt

`SIMPLE_SYSTEM` in `src/simple-summary.ts`, taking `plainWords("explain")`
([prompting-guide.md](../project/prompting-guide.md)) plus its own field rules:

- The reader: curious, about fifteen, has not studied the field. Everyday words; short sentences.
- **Jargon sparingly, and explained where it appears**; never explain one hard word with another.
  Keep the author's key term as a handhold when the reader will meet it in the text.
- **Plainer means equally specific**: keep the numbers, the direction of a finding, and the hedges.
  Do not claim more certainty than the piece does.
- The shape: what the piece is about → why it matters → its key ideas (one or two paragraphs). Two to
  four paragraphs, each 2–4 sentences; under 250 words in all.
- Only what the piece says; no outside knowledge presented as the piece's. *Why it matters* is why
  the piece says it matters.
- Each paragraph lists the ids of the one to three passages that best support it. No ids, and no
  "block 39", in the prose (`BLOCK_ID_NOTE`).
- **No reader profile in v1**, as `faq` has none: no `profileSection`, no `profileHash`. (The first
  draft conflated the constant `PROFILE_RULES` with the reader's profile — Sol P1-3.)

## Measuring it

It is a new prompt, so there is no *before* arm to pair against
([prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change)
is for changes). Instead: run production's own function on three real local articles of different
difficulty (including a paper), at `medium` and at `high`, record the prompt hash, the wall clock,
and cheap screens — word count, paragraph count, ids that resolved, paragraphs dropped — and **read
them**, against the gist of each article, for a lost number, a bent claim, or outside knowledge.
Results into this doc.

Sol also suggested running an ELI12 pitch beside ELI15 on the same articles before settling the
level. Cheap, and it is exactly Greg's open question, so the probe script takes the pitch as a
parameter and the three ELI12 outputs go in this doc for him to compare — without shipping ELI12.

## Cost and the wait

One call per article, on a press, kept; every later view is instant, for the owner and for a
visitor. Output is ~250 words. The measured cost and wall clock go here from stage 1.

### A departure from CLAUDE.md, named for Greg

CLAUDE.md: *"Stream any model call a person is waiting on."* This does not stream: the first press
waits behind the band's job progress, like FAQ. Both reviewers were asked. GPT Sol said streaming is
required now (P0-1). Opus, asked to arbitrate with the code in front of it, recommended the job:

- a route cannot write a revision column (the job fence above), so streaming *and* storing is either
  a second table built by hand (~30 files, and private by default) or a streamed route *beside* the
  step — two execution paths for a 250-word artefact;
- at adaptive thinking, most of the wait is thinking, which streams nothing; the ~350 output tokens
  are the last few seconds;
- the tweak that takes most of the engineering out is `medium` effort, so the one wait is short.

So v1 is the job, the measured wait is recorded above, and **the one decision for Greg** is whether
that wait is acceptable once per article, or the streamed first press (a route writing through a
job) is wanted as a follow-up.

## Stages

1. **Server** — types, `src/simple-summary.ts` (prompt, request, validation), the step, the column
   and migration, `GET /api/simple/:slug`, every total, export, public projection; tests for
   validation (malformed, overlong, all-unanchored, refusal, truncation), stamp agreement, the
   pipeline store and load, the metadata fallback head, the route contract, export coverage and the
   public DTO; a real run on three local articles, outputs read and recorded. GPT Sol code review,
   fixes, commit.
2. **Client** — the sub-mode chip with its tooltip, `?summary=`, the Simple view (owner and
   visitor), auto-run on press, CSS, tests; [summaries.md](../project/summaries.md) and the rest below.
   The owner/visitor seam: Summary today is one component for both because it fetches nothing
   (`SummaryMode.tsx`); Simple splits it — owners read through an authenticated hook, visitors get
   `simpleSummary` from the public article payload only, with no GET and no job verbs (Sol P1-5).
   Activation (Sol P1-6): the chip arms before checking whether Simple is already selected (a second
   press recovers from a failed read, as `QuizPanel` does); `summary` parsed in `ModeBoundary`, its
   reset key and `bandTarget`; the top-level Summary press arms nothing, so arriving on a retained
   `?summary=simple` spends nothing; `summary` added to last-view's `REMEMBERED`. Tests: the panel,
   chip press and repeated press, URL/Back not arming, the boundary retiring the token, last-view,
   stale shown and outdated not, BlockRef hover and jump, the visitor DTO and zero visitor network
   calls; [summaries.md](../project/summaries.md) gains a section, and its
   *does not have* list is corrected; [url-state.md](../project/url-state.md) gains the row. Browser
   check in a Sonnet subagent. GPT Sol code review, fixes, commit.
3. **Land** — scoped tests, typecheck, one full suite through `tmux-job`, push to `dev`, the
   feedback note under `docs/user-feedback/`.

## Deferred, named

- **ELI12**, the shorter and simpler second level. It comes back as a second chip (or a two-way
  toggle inside Simple) and a second stored level; the column would become a record by level, or a
  second column. Not built until Greg has read ELI15 on a real paper and says the pair is wanted.
- **Streaming the first press** — see *A departure from CLAUDE.md*, above.
- **Profile-aware levels** ("I have a biology background") — the profile already exists; a level
  picked from it is a later step, not v1.

## The simpler option passed over

**No stage: stream it on each press, keep nothing.** Fewer files (no column, no migration, no
totals), and it streams for free. Passed over because the scope asked for *cached on a content hash
like the other stages*, a reader who returns would pay and wait again, and a visitor on a public
article could never see one. The stage is about thirty files of well-trodden totals; FAQ is the
template.

**Also passed over: a streamed route that stores** — see *A departure from CLAUDE.md*.

## Ledger

**Plan review, GPT Sol** ([review](260930i-simple-summaries-eli15-sub-mode-review-sol.md)):
P0-1 stream now — **not taken**, Opus arbitrated, named above for Greg. P0-2 unanchored
paragraphs — taken. P1-1 overbuilt / ship ELI15 first — ELI15 taken; persistence kept (the brief
asked for it); the ELI12 comparison taken as a probe only. P1-2 false cache claim, effort — taken.
P1-3 profile — taken. P1-4 artefact stamp and validation — taken. P1-5 visitor seam — taken. P1-6
activation — taken. P1-7 stale/outdated — taken. P2-1 *Outline* — taken (*Gists*). P2-2 test list,
ai-gateway.md — taken.
