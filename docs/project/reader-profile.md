# The reader profile — telling the model who is reading

Every model call in this app used to write for a reader it knew nothing about. The glossary
explained *entropy* to a physicist; chat pitched an answer at nobody in particular. This is the box
where you say who you are, and the plumbing that carries it to the calls that should care.

Built 2026-08-26 from [reader-profile.md (the plan)](../plans/reader-profile.md), which has the
reasoning, the two reviews that reshaped it, and what was deliberately left out.

> Add a multi-line-text-input box to the Metadata for the user to describe their
> background/experience/interests/purpose in reading this. Then feed that in if non-empty as part of
> the prompt … to any relevant tasks.
>
> — Greg, 2026-08-26

**The previous version built this box twice and read it never.** `profiles.background` and a
per-document "Reading Intent" were both stored, both displayed, and neither ever reached a prompt.
So the textareas are the easy half and the least of it. That is why this doc is mostly about the
wiring.

## Two boxes, one string

| Box | Scope | Stored | Edited at |
|---|---|---|---|
| **About you** | you, always | `data/reader.json` / `reader_profiles.profile` | `/profile` |
| **Why you're reading this one** | one article | `shelf.json` → `ShelfState.purpose` / `articles.purpose` | `/read/<slug>/metadata` |

Both are **reader state**: they survive re-extraction and the pipeline cannot undo them. That is the
argument [`src/shelf.ts`](../../src/shelf.ts) already makes for the renamed title, and it holds here
word for word — a re-extraction rewrites `meta.json`, and anything of the reader's stored in there
dies quietly weeks later.

[`src/profile.ts`](../../src/profile.ts) joins the two into **one string**, and it is the only module
that knows there were two:

```
About the reader: Cognitive scientist, twenty years. Rusty on transformer internals.
Why they are reading this piece: I want the evidence, not the history.
```

Caps are **1,500 and 600 characters, refused rather than truncated** — a silently shortened profile
is one the reader believes they gave and did not. The 600 matches `MAX_GUIDANCE_CHARS` on the summary
steer, because the two boxes sit next to each other in the reader's head. **Never logged, only its
length**: this one is about the person rather than about the article ([logging.md](logging.md)).

**Normalised before rendering, and hashed from the rendering.** Trim, `\r\n` → `\n`, whitespace-only
is empty. Two spellings of one profile must be one profile, or a trailing newline from a paste marks
every artefact on the shelf stale and writes a second cache entry for the privilege.

### There is a third box, and the rule that keeps them apart

The summary panel's **steer** predates this and stays. Three free-text boxes about intent, and this
is the carve-up:

- **About you** — durable, about the person, read by all five features.
- **Why this one** — durable, about this article, read by all five.
- **Steer** — one rewrite of one artefact, read by summaries only.

**Where the steer and the purpose disagree, the steer wins**, and `SYSTEM` says so out loud. It is
the more recent and more specific act. Leaving it to the model would be two instructions about
emphasis with no ordering between them, which is how you get an answer that follows neither.

Fable's review argued for cutting the per-article box entirely — its example sentence and the
steer's example sentence are, word for word, nearly the same. Greg kept both
([the plan](../plans/reader-profile.md#the-second-box-was-argued-against-and-kept-anyway) has the
argument, so nobody has to make it again). **If the per-article box goes unused, delete it** rather
than leave it as furniture.

## Where it goes in the prompt

**After the breakpoint, in the last user part, everywhere.** The obvious alternative — the system
prompt, where "who is reading" naturally belongs — buys a separate cache entry per distinct profile,
rewritten from cold every time the reader edits their box, on a prompt whose whole point is that the
article never changes. [prompt-caching.md](prompt-caching.md) records the same mistake twice already.

| Call | Article is at | Profile goes |
|---|---|---|
| `explain` | user part 1, breakpoint on it | user part 2, with the quote |
| `converse` | user message 2, breakpoint on it | the final user message, with the question |
| `glossary` | `system[0]`, breakpoint on it | the user message |
| `tweets` | `system[0]`, breakpoint on it | the user message |
| `summarise` | the user prompt — not cached, on purpose | beside the steer, near the top |

The positioning rule inside the varying part is one rule, not two: **the thing the model must
actually do goes last.** So chat and explain put the profile before the question; the batch stages
put it near the top with the other framing, where summaries already puts its steer.

**Not the structural stages.** The ToC, the arc and the section labels never see it. The tree is
[the one structure](granularity-zoom.md#the-tree) that the ToC, the zoom, the summaries and the spine
all address, and a reader-specific tree is one that shifts under a reader who edits their profile.
Structure stays shared; only the prose *about* it is personalised. **Not semantic search** either:
"where does this piece say X" has an answer that does not depend on who is asking.

**Not tool arguments.** Chat and explain can call web search; the profile must never reach a query
string. It is the reader's description of themselves and a search provider is a third party.

### The rules live in `SYSTEM`, and they are always there

`PROFILE_RULES` in [`src/profile.ts`](../../src/profile.ts) is appended to all five system prompts,
**whether or not the reader has a profile**. Two reasons, and the second decided it: `SYSTEM` sits
ahead of the article in explain and converse, so a varying one would split the cache in two and
re-write the whole article whenever the reader toggled; and a rule that only appears alongside the
thing it constrains is a rule somebody will one day interpolate the profile *into*. So every clause
is written conditionally — "if a description appears" — because it has to read correctly on the
majority of calls, which carry none.

The clause doing most of the work: **which things you spend words on is governed by the profile;
every sentence you write is still about the article.** Framing it as an input to *choosing* rather
than to *addressing* is what stops a model performing the adaptation instead of making it.

And a **forbidden example, written out verbatim** — *"As a cognitive scientist, you'll appreciate
that…"*. [glossary.md](glossary.md) learned twice that **a prompt ban relocates a register, it does
not delete one**, and its own fix was a real bad entry carried in the prompt as a negative example.
"Never flatter the reader" reliably produces flattery in a different costume; the sentences do not.

## The glossary is the case this feature is really for

Elsewhere a profile changes how a paragraph is pitched. In the glossary it changes **which terms get
an entry at all**, and what `difficulty` means. A term is hard *relative to a reader*, so under a
profile that score stops being a property of the term and becomes a property of the pair — which
makes the threshold slider a reader is already dragging ([glossary.md](glossary.md)) mean something
personal.

It is also why `profileHash` is not bookkeeping: a difficulty score written for last month's profile
is **wrong**, not merely old.

## Provenance: what was this written with, and is it still true

Every generated artefact carries one field:

```ts
profileHash?: string | null;
```

| Value | Means | Stale? |
|---|---|---|
| absent | written before this existed | **no** |
| `null` | written deliberately *without* a profile | **no** |
| a hash | written from that profile | only if it differs from now |

**`null` is never stale**, and that line is the whole design. A reader who unticked the box and paid
for a plain glossary must not then be told it is out of date — that would be a control whose result
the app immediately complains about. `undefined` is never stale for a gentler reason: nobody's
existing artefacts should light up about a profile they never had. And **clearing your profile marks
nothing stale**: you have not changed what you want from the article, you have stopped telling us.

`profileIsStale` in [`src/profile.ts`](../../src/profile.ts) is the one place those rules live.
`GET /api/{glossary,summary,tweets}/:slug` answers it as `profileChanged`, a third boolean beside
`stale` and `outdated`, because it needs a third sentence: *stale* means the article moved,
*outdated* means we would write it differently now, *profileChanged* means you are not who you were.

**A hash rather than a `usedProfile: true`**, because a boolean cannot tell "written for the profile
you have now" from "written for the profile you had last week", and from every surface in this app
those two look identical.

### `existingFor` is the sharp edge

`isStale` is **not** the gate on the glossary's top-up path — `existingFor`
([`src/glossary.ts`](../../src/glossary.ts)) is. Folding the profile into `isStale` and stopping
would have left top-up untouched: new profiled terms appended to old unprofiled ones, and the whole
list then stamped with the new hash. A lie about provenance, written by us, into a file.

So `existingFor` takes the incoming profile hash and refuses on any difference, which sends the run
down the rewrite path where `idsByTerm` keeps the reader's `?term=` links alive. Note it is
**stricter than `profileIsStale`**: there, `null` never counts, because a reader should not be
nagged. Here any difference counts, because the question is not "should we warn them" but "may these
two lists be merged" — and entries written for a physicist may not be merged with entries written for
nobody in particular.

### One profile per job, frozen at the start

The profile is resolved **once**, by the route (`resolveProfile` in [`src/routes.ts`](../../src/routes.ts)),
and carried on the job exactly as `guidance` already is — `Job.profile` → `StepContext.profile` →
the step. A summary run is several batches at once, and a reader who edits their box mid-run would
otherwise get one artefact written from two profiles and stamped with whichever finished last.

It is also part of `sameWork` in [`src/jobs.ts`](../../src/jobs.ts). Unticking the box and pressing
the button again is a request for a *different artefact*, not a retry of the one already running.

Chat and explain resolve it **per turn** instead, and the difference is deliberate: a turn is one
call, so there is no window in which half an answer could be written to each.

### The client says whether, never who

The API takes `useProfile: boolean`, never the profile text. Absent means **yes** everywhere it is
offered. A client that could supply the text would be a way to spend tokens on a string of its
choosing and a way to put arbitrary text into a prompt that writes an artefact.

Note this is the mirror of `deep` on explain, and the asymmetry is on purpose: deep search is an
extra you ask for, so absent means no; the profile is the default this app now writes with.

## What editing your profile costs

**One typo fix marks every artefact in the library `profileChanged` at once.** Hash equality has no
notion of a trivial edit. Nothing regenerates on its own — stale is a *sentence*, not a rewrite — but
it will look like something broke the first time it happens to a shelf with thirty articles on it.
If that ever becomes intolerable the fix is not fuzzy hashing (there is no honest version of it); it
is a "mark everything current" button, which is its own small design problem.

## Where the pieces are

| | |
|---|---|
| [`src/profile.ts`](../../src/profile.ts) | render, normalise, hash, the staleness rule, `PROFILE_RULES`, `profileSection`, and the filesystem half of the global store |
| [`src/shelf.ts`](../../src/shelf.ts) | `ShelfState.purpose` — the per-article half |
| [`src/store/contracts.ts`](../../src/store/contracts.ts) | `ReaderStore`, and `ShelfStore.patch`'s third key |
| [`src/store/pg-reader.ts`](../../src/store/pg-reader.ts) | the Postgres half; `reader_profiles`, one row per owner |
| [`src/routes.ts`](../../src/routes.ts) | `GET`/`PATCH /api/reader`, `resolveProfile`, `withProfileChanged` |
| [`tests/profile.test.ts`](../../tests/profile.test.ts) | the pure rules, including the staleness table exhaustively |
| [`tests/profile-prompts.test.ts`](../../tests/profile-prompts.test.ts) | the batch prompts — which `article-prompt.test.ts` never covered |
| [`tests/article-prompt.test.ts`](../../tests/article-prompt.test.ts) | that the cached prefix is untouched by any profile |

## What is still open

- **No evidence it helps.** The same criticism [summaries.md](summaries.md) already levels at itself.
  The cheapest check is two glossaries of one article, one for a beginner and one for an expert, read
  side by side — and the sharper question is not *"are they different"* but **does the expert version
  ever mention the expertise?**
- **No counter on the register yet.** The plan proposes logging profile-echo words and second-person
  pronouns, which would turn "never mention the profile" from a rule into a number the log can
  contradict. Not built.
- **Instant switching between a profiled and a plain artefact** is not built. Flipping the checkbox
  and pressing "Write them again" is the whole feature minus the instant part; storing both copies is
  [deferred with reasons](../plans/reader-profile.md#storing-both-copies-is-deferred-and-the-deferral-now-has-teeth).
- **Two tabs.** Last write wins, which is what `shelf.json` already does.
- **Not multi-user.** One reader, one profile, which is what [auth.md](auth.md) says this app is —
  though the Postgres half is keyed by `owner_id` from the start.

## See also

- [reader-profile.md (the plan)](../plans/reader-profile.md) · [glossary.md](glossary.md) ·
  [summaries.md](summaries.md) · [comments.md](comments.md) · [prompt-caching.md](prompt-caching.md)
- [library.md](library.md) — the shelf record `purpose` joins
- [silent-success.md](../reusable/silent-success.md) — a profile that silently stops reaching a
  prompt returns a perfectly good answer
