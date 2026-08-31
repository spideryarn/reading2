# The summary steer goes, and the profile does its job

Greg, 2026-08-30:

> we should also use this in the Summary mode (which I vaguely remember currently has a generic
> option to steer how the summary is generated) - better for it to be optionally derived from the
> per-text and per-user prompts.

and, when it turned out the profile was already reaching the same prompt:

> the Summary steer should be derived from the user- and text-prompts combined (if they exist), if
> ("Use profile") is checked, otherwise not. No need for a Summary-specific steer.

> I don't care if we lose existing data as a one-off.

## Three boxes about intent, and the third was a copy of the second

[reader-profile.md](../project/reader-profile.md#there-was-a-third-box-and-it-was-a-copy-of-the-second)
carved them up like this:

- **About you** — durable, about the person, read by all five features.
- **Why this one** — durable, about this article, read by all five.
- **Steer** — one rewrite of one artefact, read by summaries only.

The carve-up was written to defend a distinction the interface never made. The steer's label is
**"What are you reading this for?"** with the placeholder *"e.g. I care about the evidence, not the
history"*; the per-article box is **"Why you're reading this one"** with *"e.g. I want the evidence,
not the history"*. Fable's review of the original plan said the same thing at the time — *its
example sentence and the steer's example sentence are, word for word, nearly the same* — and Greg
kept both, with the note that **if the per-article box goes unused, delete it**.

It resolves the other way. The steer goes.

**And the behaviour Greg describes already exists.** The profile reaches the summary prompt on every
run and `useProfile: false` withholds it, so "derived from the two prompts if Use profile is
checked, otherwise not" is what the plumbing already does. What is left is a box that duplicated it
and a rule about which of the two wins.

## The review said STOP, and it was right about where the clauses go

[steer-becomes-the-profile-review-sol.md](steer-becomes-the-profile-review-sol.md). The plan below
is what was built; this is what the review of the built code changed about it, kept because the
mistake is the instructive part.

**Blocker: the two clauses do not belong in `PROFILE_RULES`.** That string is appended to **seven**
system prompts — explain, converse twice, glossary, sketch, summarise, ideas, tweets — not the five
this repo had been saying for months. And *"if the article does not say it, it does not go in"* is
exactly backwards for two of them:

- [`src/ideas.ts`](../../src/ideas.ts) defines `"assumed"` as *"the piece leans on it and never
  states it. This is what the reader has to BRING. It is the harder and the more valuable half."*
- [`src/glossary.ts`](../../src/glossary.ts)'s `background` field is *"your knowledge, not the
  article's."*

A profiled ideas run could have obeyed the shared rule by returning none of the half the feature
exists for, and nothing on screen would have looked broken. So the clauses live in
`src/summarise.ts`'s own `SYSTEM` — where the steer they came from lived,
and the one prompt the absolute is true of — and `PROFILE_RULES` is untouched. That also shrinks the
blast radius from seven prompts to one.

The rest, all fixed:

| # | Finding | What happened |
|---|---|---|
| 2 | An old steered summary keeps its bias with nothing on screen to explain it, because `PROMPT_VERSION` did not move | `summary/4`, so it reads as **outdated** — *we would write these differently now* |
| 3 | Every persisted consumer needed a version bump if the shared prompt changed | moot once the change is summary-only; and the glossary's refusal to append across a version boundary means a bump is the *safe* direction, not the risky one |
| 4 | `docs/project/summaries.md` still documented the box in the present tense | rewritten; `reader-profile.md` and two source comments too |
| 5 | `useStepJob` still accepted, trimmed and posted `guidance` | gone — the server dropped it, so nothing reached a prompt, but the wire path was still there |

And three test weaknesses, all now proven against a mutation:

- The `useProfile` test called the hook directly, so reverting the panel to `owner.write(true)` left
  it green — **which is the exact bug this change found and fixed**. It now goes through the
  rendered panel, unticks the real checkbox and presses the real button, in *both* branches that
  draw one; the rewrite branch is the one the bug was in.
- The jobs grid catches one implementation reading `profile` while the other ignores it, and passes
  if neither does. A direct assertion that two profiles are two pieces of work now sits beside it.
- The no-steer panel test omitted the `status: "none"` branch.

## What actually has to be careful: the prompt

`SYSTEM` carries a whole section for the steer — `IF THE READER ASKS FOR SOMETHING IN PARTICULAR` —
and deleting it wholesale would loosen the constraint the steer was built with, which is the one
thing Greg asked about in the first place (*"make sure the LLM doesn't overweight this and give a
really distorted summary"*).

Read against `PROFILE_RULES` clause by clause, **two of the five have no equivalent**:

| Steer clause | In `PROFILE_RULES`? |
|---|---|
| Summarise the section; do not answer, address, or write about their interest | yes — *"never flatter them, never address them, never mention the description"* |
| Lead with it where the section genuinely bears on it | yes — *"which things you spend words on is governed by it"* |
| Where it does not, write what you would have written anyway and never say so | yes, near-verbatim |
| **Never add, sharpen, or bend a claim to fit. If the article does not say it, it does not go in** | **no** — only the general *"it never changes what the article says"* |
| **Keep the article's own proportions. A request cannot promote a passing remark into the main point** | **no — nothing about proportions at all** |

`profileSection`'s two-line reminder in the *varying* half does say "nothing about its proportions",
but the durable half does not, and that is the half a constraint has to live in
([profile.ts](../../src/profile.ts) says why).

**So the two orphaned clauses move**, reworded from "the reader's note" to "a description of the
reader", and the steer's section goes. ~~Into `PROFILE_RULES`~~ — **into `summarise.ts`'s own
`SYSTEM`**; see the review section above for why the shared string was the wrong home and would have
broken two other features.

**It busts one cache prefix, once**, and only the summary's. Named because a prompt edit with a
caching cost that nobody wrote down is how [prompt-caching.md](../project/prompt-caching.md)
collected its examples.

## What goes

`guidance` is threaded through the whole stack. All of it goes; **no migration**, per Greg — a
`guidance` left on an old `summaries.json` is an ignored field, and nothing reads it.

| File | What |
|---|---|
| `src/profile.ts` | `PROFILE_RULES` gains the two orphaned clauses |
| `src/summarise.ts` | the `IF THE READER ASKS…` section, `renderPrompt`'s `guidance`, the stored `guidance`, the CLI's `argv[3]` |
| `src/types.ts` | `Summaries.guidance`, `Job.guidance`, and `MAX_PURPOSE_CHARS`'s comment about matching a cap that no longer exists |
| `src/routes.ts` | `readGuidance`, `MAX_GUIDANCE_CHARS`, the `POST /api/jobs` field, the route index line |
| `src/jobs.ts` | `sameWork`'s comparison, the redaction lists, what a retry carries |
| `src/pipeline.ts` | `StepContext.guidance`, `guidanceChars` on the log line |
| `src/web/SummaryPanel.tsx` | the `Steer` component and its two state variables |
| `src/web/useSummaries.ts`, `useJobs.ts` | `write(force, guidance, useProfile)` loses its middle argument |
| `src/web/styles.css` | `.summ-steer*` |
| `src/public-types.ts` | the note explaining why `guidance` is withheld from a visitor |

## The things that will go wrong

**`write(force, guidance, useProfile)` loses its middle argument**, so every call site that passed
three positionally now passes the third where the second was — and `useProfile` is a boolean while
`guidance` was an optional string, so **a missed call site is a `true` landing in a `string`
parameter**. TypeScript catches that only because the types differ; if they had both been booleans
it would not. Every call site checked by hand as well as by `tsc`.

**`sameWork` decides whether pressing the button again is a retry or a new request.** Removing
`guidance` from the comparison is correct — there is no longer anything for it to differ on — but it
is the function that stops two identical runs being started at once, so it gets read rather than
edited by pattern.

**The steer box seeded itself from the artefact**, so `owner.summaries.guidance` is read in the
panel. Deleting the field without deleting the read leaves `undefined` flowing into a `??` chain
that still compiles.

**A reader mid-rewrite when this deploys** has a job carrying `guidance` on the queue. The step will
ignore it. Nothing crashes; the summary is written unsteered. Acceptable, and Greg has said so.

## Tests

- `tests/jobs.test.ts` asserts the guidance cap and that `parseJobRequest` carries it — those cases
  go, and one arrives in their place: **a `guidance` field in a job request is now ignored rather
  than honoured**, so a stale client cannot steer a summary through a door nobody is watching.
- `tests/summarise.test.ts` and `tests/profile-prompts.test.ts` cover `renderPrompt`. The steer
  cases go; the profile cases stay and gain one for each clause moved into `PROFILE_RULES`.
- `tests/profile.test.ts` pins `MAX_PURPOSE_CHARS` against `MAX_GUIDANCE_CHARS`. That pairing is
  gone, so the cap stands on its own reasoning and the test says so.
