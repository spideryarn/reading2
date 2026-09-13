# The reader profile — telling the model who is reading

Every model call in this app used to write for a reader it knew nothing about. The glossary
explained *entropy* to a physicist; chat pitched an answer at nobody in particular. This is the box
where you say who you are, and the plumbing that carries it to the calls that should care.

Built 2026-08-26 from [reader-profile.md (the plan)](../plans/260826t-reader-profile.md), which has the
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
| **About you** | you, always | `reader_profiles.profile` | `/profile` |
| **Why you're reading this one** | one article | `articles.purpose` | `/read/<slug>/metadata` |

Both were files until 2026-09-05 — `data/reader.json` and `data/<slug>/shelf.json` — deleted along
with the rest of the filesystem store.

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
is one the reader believes they gave and did not. The 600 was chosen to match the summary steer's
cap, the two boxes sitting next to each other in the reader's head; that steer is gone (below), so
the number now rests on its own reasoning — a paragraph about who you are is a life, a paragraph
about why you opened *this* is usually a sentence. **Never logged, only its length**: this one is
about the person rather than about the article ([logging.md](logging.md)).

**Normalised before rendering, and hashed from the rendering.** Trim, `\r\n` → `\n`, whitespace-only
is empty. Two spellings of one profile must be one profile, or a trailing newline from a paste marks
every artefact on the shelf stale and writes a second cache entry for the privilege.

### There was a third box, and it was a copy of the second

The summary panel had a **steer** — a free-text note beside the button that rewrites the summaries,
predating this feature. Three boxes about intent, carved up like this:

- **About you** — durable, about the person, read by every profiled feature.
- **Why this one** — durable, about this article, read by the same.
- **Steer** — ~~one rewrite of one artefact, read by summaries only~~. **Gone, 2026-08-30.**

The carve-up defended a distinction the interface never made. The steer's label was *"What are you
reading this for?"*, placeholder *"e.g. I care about the evidence, not the history"*; the
per-article box asks *"Why you're reading this one"*, placeholder *"e.g. I want the evidence, not
the history"*. Fable's review said so when it was built — *its example sentence and the steer's
example sentence are, word for word, nearly the same* — and Greg kept both, with the note that **if
the per-article box goes unused, delete it**.

It resolved the other way. Greg, 2026-08-30:

> the Summary steer should be derived from the user- and text-prompts combined (if they exist), if
> ("Use profile") is checked, otherwise not. No need for a Summary-specific steer.

And the behaviour he describes was already the plumbing: the profile reaches the summary prompt on
every run, and `useProfile: false` withholds it. What was left was a second box asking the same
question and a precedence rule between the two answers — *where the steer and the purpose disagree,
the steer wins* — which existed only because there were two.

**The care was in the prompt, not in the deletion.** `SYSTEM` carried a whole section holding the
steer to emphasis, and Greg's original ask for the box had been *"make sure the LLM doesn't
overweight this and give a really distorted summary"*. Read clause by clause against `PROFILE_RULES`,
three of its five rules already had an equivalent and **two did not**: *never add, sharpen, or bend a
claim to fit*, and *keep the piece's own proportions* — and there was nothing about proportions in
`PROFILE_RULES` at all. Those two moved rather than going in the bin — **into
`src/summarise.ts`'s own `SYSTEM`, not into `PROFILE_RULES`**, and that
distinction was a correction rather than a preference. The shared string reaches *seven* prompts, and
*"if the article does not say it, it does not go in"* is exactly backwards for two of them: `ideas`
defines its more valuable half as what the piece *never states*, and a glossary entry's `background`
is explicitly not the article's knowledge. A profiled ideas run could have obeyed the shared rule by
returning none of the half the feature exists for. GPT Sol caught it before it shipped.
[260830o-steer-becomes-the-profile.md](../plans/260830o-steer-becomes-the-profile.md) has the working, and
`tests/profile.test.ts` pins both clauses where they landed — a moved rule is the easiest kind to
lose, because both halves of the move compile and nothing anywhere goes red.

A `jobs.guidance` column and a `guidance` inside older stored summaries both survive, unread.
Dropping the column is a migration against real readers' work, which is Greg's call every time.

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
| `summarise` | the user prompt — not cached, on purpose | near the top, with the other framing |

The positioning rule inside the varying part is one rule, not two: **the thing the model must
actually do goes last.** So chat and explain put the profile before the question; the batch stages
put it near the top with the other framing.

**Not the structural stages.** The hierarchy, the arc and the section labels never see it. The tree is
[the one structure](granularity-zoom.md#the-tree) that Hierarchy, the zoom, the summaries and the spine
all address, and a reader-specific tree is one that shifts under a reader who edits their profile.
Structure stays shared; only the prose *about* it is personalised. **Not semantic search** either:
"where does this piece say X" has an answer that does not depend on who is asking.

**Not tool arguments — and this one is an instruction, not a boundary.** Chat and explain can call
web search, and the profile is in the same prompt as the tool. `PROFILE_RULES` tells the model not to
put it in a query, and that is all we have: a prompt is not an enforcement mechanism, and nothing in
the code inspects a search query before it goes out. Written down plainly because the first version
of this doc claimed the promise rather than the instruction, and a privacy claim that is really a
request is worse than no claim. GPT Sol's review, 2026-08-26. The real fence, if this ever matters
enough, is a check on the tool call's arguments in [`src/chat-tools.ts`](../../src/chat-tools.ts) —
not more prompt.

### The rules live in `SYSTEM`, and they are always there

`PROFILE_RULES` in [`src/profile.ts`](../../src/profile.ts) is appended to all seven profiled system prompts —
explain, converse (twice), glossary, sketch, summarise, ideas and tweets —
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

**`null` is never stale**, and that line is the whole design. A plain artefact was written on
purpose: until 2026-09-13 by a reader who unticked the *Use your profile* box and paid for it, and
since then by a reader with no profile, or by a Find more continuing a list that was already plain
(§ [No control, one label](#no-control-one-label)). Telling them it is out of date would be the app
complaining about its own result. `undefined` is never stale for a gentler reason: nobody's existing
artefacts should light up about a profile they never had.

**Clearing your profile marks nothing stale — but only if you clear *both* boxes.** `profileIsStale`
compares against the *rendered* profile, and that is the join of the global half and the article's
purpose. Empty the global box while a purpose remains and the rendered string is still non-empty
with a different hash, so the artefact really has gone stale — which is correct, since what the model
would be told has genuinely changed. The rule is therefore about the whole profile going away, not
about either box. An earlier version of this paragraph said it without the qualification; GPT Sol's
review, 2026-08-26.

`profileIsStale` in [`src/profile.ts`](../../src/profile.ts) is the one place those rules live.
`GET /api/{glossary,summary,tweets,ideas}/:slug` answers it as `profileChanged`, a third boolean beside
`stale` and `outdated`, because it needs a third sentence: *stale* means the article moved,
*outdated* means we would write it differently now, *profileChanged* means you are not who you were.

**A hash rather than a `usedProfile: true`**, because a boolean cannot tell "written for the profile
you have now" from "written for the profile you had last week", and from every surface in this app
those two look identical.

### Reading the stamp no longer waits for the artefact

Answering `profileChanged` means reading the reader's profile, which is two queries of its own and
has nothing to do with the artefact being fetched. The four routes used to await the artefact and
*then* call `withProfileChanged`, so a reader waiting on a panel waited for both in series. They now
start together.

`withProfileChanged` takes a **thunk** — `() => Promise<T>` — rather than the artefact or a promise
of it. That is the whole design: a promise parameter would leave the overlap a caller convention,
and every route could go on awaiting first and hand over something already settled, with a test of
the helper passing regardless. Taking the thunk moves the responsibility into the one function where
it can be proved, and `tests/route-profile-concurrency.test.ts` proves it by holding both reads and
asserting the profile was asked for while the artefact was still outstanding.

**Neither `Promise.all` nor `Promise.allSettled`**, and both were tried. `all` rejects with whichever
failed soonest, so a reader asking for an article that does not exist could be told their profile
store fell over instead of getting a 404 — the error would name the wrong thing. `allSettled` picks
the right error but waits for both before looking at either, so a profile read that hung would hold
up a 404 the old serial code answered at once, and the reader would see a timeout instead.

What it does is start both, `await` the artefact, and `await` the profile only after that. The
artefact's failure arrives at exactly the moment it always did; a profile failure still surfaces when
the artefact was fine, rather than being swallowed into `profileChanged: false`, which would be a
wrong answer nobody could see. A bare `void profile.catch(() => {})` before the awaits keeps the
both-failed case from reporting an unhandled rejection for the error we deliberately drop.

**It overlaps work rather than removing it, and that has a price.** One request's peak concurrent
queries go from two to four against a pool whose default `max` is 5: `resolveProfile` fans out to
the reader's profile and the article's shelf row, and the Postgres glossary read fans out to the
block hashes and the stored lookups. So under enough load this moves latency rather than removing
it. Worth it for the single reader waiting on a panel, which is the case that matters; nobody has
measured the loaded case. The full reasoning is in
[260828c-library-read-latency.md § 8](../plans/260828c-library-read-latency.md).

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
and carried on the job — `Job.profile` → `StepContext.profile` → the step. (A `guidance` steer
travelled the same way and is gone: [260830o-steer-becomes-the-profile.md](../plans/260830o-steer-becomes-the-profile.md).) A summary run is several batches at once, and a reader who edits their box mid-run would
otherwise get one artefact written from two profiles and stamped with whichever finished last.

It is also part of `sameWork` in [`src/jobs.ts`](../../src/jobs.ts). Unticking the box and pressing
the button again is a request for a *different artefact*, not a retry of the one already running.

Chat and explain resolve it **per turn** instead, and the difference is deliberate: a turn is one
call, so there is no window in which half an answer could be written to each.

### The client says whether, never who

The API takes `useProfile: boolean`, never the profile text. Absent means **yes** everywhere it is
offered. A client that could supply the text would be a way to spend tokens on a string of its
choosing and a way to put arbitrary text into a prompt that writes an artefact.

**Since 2026-09-13 the client sends `false` in exactly two places**, neither of them a control:
*Find more* on a plain glossary or quotes list, continuing it in its own recorded setting
(§ [No control, one label](#no-control-one-label)); and `CandidatesPanel`, whose list of articles to
read next must not be pitched at the reader. Every other request sends nothing. The API still takes
`false` from anyone, because both of those need it and jobs' `sameWork` keys on it.

Note this is the mirror of `deep` on explain, and the asymmetry is on purpose: deep search is an
extra you ask for, so absent means no; the profile is the default this app now writes with.

## No control, one label

> All the places where it has a little checkbox saying "use your profile", and remove that from the
> UI. Just always have it as on. So just assume that we're always going to use the profile, and we
> don't need to include it in the UI to ask them. So the UI is a bit tidier and more compact.
>
> — Greg, 2026-09-12, from an iPad, reading an article in summary mode

**Every new run uses the profile, and nothing in a reading view offers to change that.** The one
thing on screen about the profile is a *label* on the text — *written for you*, or *older profile*
([`src/web/WrittenForYou.tsx`](../../src/web/WrittenForYou.tsx)) — and it opens the profile panel
below. The profile itself is edited on `/profile` (the Command bar's Profile row reaches it) and, for
the per-article half, on the metadata page. The way to not be profiled is to empty both boxes; that
is a real loss of control, and it is the one Greg asked for.

```
  ┌─ GLOSSARY ─────────────────────────── ✓ written for you ─┐   ← the LABEL, which
  │  Threshold ▁▂▃▅▇                                          │     opens THE PANEL
  │  ⚠ These terms describe an older version of the article.   │
  │                                   [ Find them again ]      │   ← nothing beside
  └────────────────────────────────────────────────────────────┘     the spend
```

### Find more continues the list in its own setting

**The one exception is Find more**, on the glossary and on the quotes, and it is not a control
either: it passes the list's own recorded setting (`profiled`, from `profileHash != null`), so a
plain list is topped up plainly and a profiled one for the profile. Always sending the profile would
have been simpler and wrong, for a different reason on each stage (GPT Sol's review of
[260913a](../plans/260913a-drop-the-use-your-profile-checkbox.md)):

- **Glossary** — `existingFor` refuses to append across a profile difference, so a profiled Find
  more on a plain list would **rewrite** it, dropping every term the model did not return again,
  under a button that says "more".
- **Quotes** — an append keeps the stamp of the pass that started the list
  ([quotes.md § Find more appends](quotes.md)), so a profiled pass onto a plain list would sit under
  a stamp saying it was not profiled.

*Find them again*, *Choose them again*, *Write it again* and every first run write a list of their
own, and those always use the profile.

### What was here before, and why it went

From 2026-08-26 to 2026-09-13 there were **two** things, and the split was the design. Greg had asked
for *"a checkbox (default-true, with fully-explanatory tooltip) in all the places where we're taking
into account that we have done so"*. Fable's review objected that a checkbox reads as something to
*set* when what it records is something that *happened* — the shape the glossary already solved with
[a label instead of a warning triangle](glossary.md) — and that flipping it means
regenerate-and-wait, a model call hidden behind the lightest control in the interface. So the label
went on the text, and a row reading *☑ Use your profile 👤* went beside every button that spends —
the glossary's Find / Find them again / Find more, quotes, ideas, tweets, sketch, and the chat and
Remember composer. The checkbox was seeded from the artefact on screen, so it needed no storage; it
was absent for a reader with no profile; the 👤 button beside it opened the panel and, alone, read
*Your profile*, because that reader most needed to know what "your profile" meant (2026-08-30). A run
that had started itself showed *Using your profile* in the checkbox's place (2026-08-31).

**All of that row is gone**, not only the checkbox: an explanation of a choice nobody is offered is
clutter, and Greg's reason was a tidier, more compact interface. The label's half of Fable's split
still stands. What is lost with the row is the way into the panel for a reader with **no** profile —
the badge appears only on text written for one — so a first profile is now found through `/profile`
and the Command bar, not from beside a button. `useHasProfile`, the hook that asked whether to draw
the checkbox, went with it.

One thing the label does **not** do: it goes on describing an artefact that was written for a profile
after the reader clears theirs. That is deliberate — it *was* written for you, and the badge is about
the text rather than about the current state of the world. The label stays until the artefact is
rewritten.

Where the label is:

| Surface | Label |
|---|---|
| glossary | on the head line |
| ideas | on the head line |
| quotes | on the head line |
| tweets | beside the counts |
| sketch, summaries, chat, Remember, explain | — |

(The summaries panel lost its label and its checkbox before this; the table said otherwise until
2026-09-13.)

**Chat gets no label**, because an answer is not an artefact anybody rewrites, so there is nothing
for a label to describe. Every answer uses the profile, except the reading-candidates list
(`CandidatesPanel`), which asks for none on purpose.

**Explain never had a control, deliberately.** It has no pre-flight moment — the call fires when you
select a sentence — so a checkbox in the dialog could only have affected a *re-ask*, a control that
appears after the thing it would have governed. And it is the call the profile helps most: a wrong
pitch wastes the whole answer, where a wrong pitch in a glossary wastes one entry. Explain always
uses the profile.

### And the third thing, which is where the two boxes are actually shown

The label above is also the way in to a **profile panel** — what your
profile currently says, and a working link to each of the two pages that edit
it ([`src/web/ProfilePanel.tsx`](../../src/web/ProfilePanel.tsx), built
2026-08-30 from [the plan](../plans/260830c-profile-panel.md)). Until
2026-09-13 the 👤 button in the *Use your profile* row opened it too.

```
  ✓ written for you
          │ click
          ▼
  ┌─────────────────────────────────────────┐
  │ What the glossary, summaries, chat  [×] │
  │ and explanations are written for. It    │
  │ changes what gets explained and how     │
  │ much — never what the article says.     │
  │                                         │
  │ ABOUT YOU                       Edit →  │
  │ Cognitive scientist, twenty years,      │
  │ mostly memory and learning.             │
  │                                         │
  │ WHY YOU'RE READING THIS ONE     Edit →  │
  │ I want the evidence, not the history.   │
  └─────────────────────────────────────────┘
```

Greg asked for this as a *"rich tooltip"*, and **a tooltip in this app cannot
hold a link**. `.tooltip-anchor` is `pointer-events: none` and `Tooltip` passes
`handleClose: null` — every card here is read, never entered. The badge had
carried an `Edit your profile →` link since it was written and **it had never
been clickable**: measured in headless Chrome, `document.elementFromPoint` at
the link's own centre returns the page behind it, while the same test on an
ordinary in-flow link on the same page returns the link. jsdom has no layout and
reports both as reachable, which is how it shipped —
[silent-success.md](../reusable/silent-success.md).

So the panel follows `ColourPicker` in
[`SearchPanel.tsx`](../../src/web/SearchPanel.tsx), the one click-popover this
app already had: `useClick`, `useDismiss`, `useRole({role: "dialog"})`, and
`FloatingFocusManager` at `modal={false}`. **A browser gate, not a unit test,
proves the links are reachable** — jsdom structurally cannot see it, and that is
the same shared assumption that let the dead link through.

**It is read-only, and that was decided against the alternative.** The plan's
second draft put both textareas in the panel, editable. GPT Sol's review found
that [`useDictation`](../../src/web/useDictation.ts)'s unmount cleanup *aborts
rather than stops, on purpose* — so a popover dismissed on outside press throws
away whatever was being dictated into it, and on the browsers where words arrive
only after stopping, throws away all of them. Save-on-blur has the matching
hole: the outside `pointerdown` unmounts the textarea, so the blur that would
have flushed it need never fire. Greg chose read-only knowing that, 2026-08-30.

**It fetches when it is opened.** The justification first written here was
wrong and the correction is the useful part: it claimed the separate fetch
avoided sending the profile repeatedly on a page. It did not. Six callers used
`useHasProfile`, which fetched `/api/reader` — `profile` and `purpose` included
— for a boolean, so the panel's request was another fetch, not a substitute for
theirs (GPT Sol's review of the built code, 2026-08-30). Those callers went with
the *Use your profile* checkbox they served, on 2026-09-13.

**And "always fresh" was only true after a one-line fix.** `apiFetch` caches
`/api/reader` offline, and a `PATCH /api/library/<slug>` — which is how a
purpose is saved — invalidated only its own prefix. So the panel could serve
last week's sentence as current (and, while the checkbox existed, `hasProfile`
could go on saying `false` to a reader who had just written their first
purpose, hiding every tick from them).
`resourceOf` maps a URL to *its own* resource and is right to; a write that
makes a *second* resource wrong has to name it, and now does
([`lib/api.ts` § `saving`](../../src/web/lib/api.ts)).

**A shelf read that fails is not a box nobody filled in.** `resolveProfileParts`
swallows a shelf failure — right for a prompt, because a job must not die over a
purpose nobody may have written — and answers `purpose: null`. For a panel whose
job is to say what your profile *is*, that renders as "you haven't said why
you're reading this one" to somebody who has. So the route carries
`purposeFailed` beside it, and the panel says it could not read that half rather
than that the half is empty. Same three-states-not-two rule the whole panel is
built on.

`GET /api/reader?slug=` therefore answers `purpose` as well, **always present
and `null` without a slug** rather than sometimes absent. This is the one place
the rule in [`useProfile.ts`](../../src/web/useProfile.ts) — *"the text never
reaches these panels"* — is reversed, and narrowly: it is the reader's own words
being shown back to the reader. `useProfile: boolean` on a generate request is
unchanged, because a client that could *supply* profile text is a way to put an
arbitrary string into a prompt.

## What editing your profile costs

**One typo fix marks every artefact in the library `profileChanged` at once.** Hash equality has no
notion of a trivial edit. Nothing regenerates on its own — stale is a *sentence*, not a rewrite — but
it will look like something broke the first time it happens to a shelf with thirty articles on it.
If that ever becomes intolerable the fix is not fuzzy hashing (there is no honest version of it); it
is a "mark everything current" button, which is its own small design problem.

## The microphone, and what it took to make it believable

There is a microphone on both boxes — and, since 2026-08-27, on the chat composer and the comment
follow-up box too.

**It transcribes twice, and the second pass is the one that counts.** The browser's own recogniser
gives live words while you talk; when you stop, the recording of the same track goes to a model and
what comes back replaces them. The reason is not a better ear, it is a **vocabulary**: measured that
day, every dedicated speech-to-text model on OpenRouter mangled this app's own words — `Spideryarn`
as *Spiderion*, the block id `spya-k3m9qt` as *"Spire k three m nine q t"* — and a chat model handed
the article's glossary got them right every run. **How it works now is [dictation.md](dictation.md)** — it stopped being a
property of this page the moment the button went into chat and the comment box too. The argument,
the numbers and the nine things GPT Sol found wrong with it are in
[260827x-dictation-two-pass.md](../plans/260827x-dictation-two-pass.md). What stays here is the day of debugging
that got the microphone itself believable, because that is what this page was the scene of.

Two consequences worth having in mind before reading the rest of this section, because both reverse
something it used to say:

- **The audio now leaves the machine.** *"Free, no server, and no audio of the reader's voice
  crossing anything of ours"* was the argument for the browser's recogniser, and it is over — Greg's
  call, with the trade put to him in those words. What is true now: the recording is held in memory
  for one request, base64'd into one OpenRouter call, never written to disk by us and never logged.
  One sentence beside the button says so, as the button's own `aria-describedby`.
  **The routing half of that sentence went on 2026-09-07**, and it went because the vocabulary won:
  dictation moved to `openai/gpt-transcribe` on the transcription endpoint, where OpenRouter does not
  apply routing preferences or `zdr`, so "routed only through zero-data-retention providers" is a
  thing we can no longer say. What we still control — memory only, no disk, no logs — is unchanged.
  [privacy.md](privacy.md) owns the current claim and the evidence for it;
  [260907c](../plans/260907c-dictation-onto-an-openai-transcriber.md) is the trade.
- **Safari and Firefox no longer get live words, and Firefox gets dictation at all.** WebKit allows
  one microphone source at a time, so on Safari the choice is live text *or* a recording. We take the
  recording, because the transcript is the half that gets saved. Firefox, which had no button at
  all, now has all of it except the live text.

The rest of this section is about the part that was wrong for a day before any of that, because the
lesson generalises well past dictation.

**Greg pressed it and reported that "nothing seemed to happen".** Nothing was broken. Measured in
Chrome: the microphone does not open until **1.1 seconds** after the button is pressed, and no
transcript comes back for several seconds after that — while the button turned orange *immediately*,
a claim to be listening made a second before it could hear anything. The only other feedback, the
interim text, was rendered conditionally on there being interim text, so until the first transcript
the page was byte-for-byte what it had been before the press.

So the whole of the first four seconds was: a 26-pixel icon in the corner changed colour, and nothing
else in the world was different — while the reader watched the textarea, which is where the words are
supposed to appear.

Three things fixed it, and the third is the interesting one:

1. **Three phases rather than two** — `idle | opening | listening`. The orange is only worn once
   `audiostart` has fired, and `opening` says *"Opening the microphone…"* in words.
2. **A strip that exists whenever the microphone is armed**, not only when it has something to say.
3. **A live level meter** — Greg's ask, *"so that the user has a sense of whether it's working"*.

### The meter is the only thing that can answer the question

Bars moving with your voice mean the microphone works and the recogniser is merely thinking. Bars
flat while you talk mean the audio device is wrong or muted. Nothing else on the page distinguishes
those, and they are the two cases a reader most needs told apart.

**That case is not hypothetical.** During the build every reading dropped to exactly zero, because
macOS had silently switched the default input to *"Microsoft Teams Audio Device (Virtual)"*, which
delivers digital silence — while `getUserMedia`, `readyState`, `muted` and `enabled` all reported
perfect health. The feature caught its own motivating bug by accident.

Two decisions inside it are worth carrying elsewhere:

- **One capture, never two.** `SpeechRecognition` does not expose its `MediaStream`, so the obvious
  design opens a second `getUserMedia` for the meter. That is unsafe: WebKit supports one microphone
  source at a time, and a second capture can kill the first or switch the routing — the meter would
  then be drawn from a *different microphone* than the one being transcribed. Recent Chromium
  implements the spec's `recognition.start(audioTrack)`, so one track feeds both; Safari, which has
  no such overload, opens no second stream and drives the bars from the recogniser's own
  `soundstart`/`soundend` instead.
- **Nothing is invented.** Both sources are real observations of real audio — one continuous, one
  binary. A meter that moves when the microphone is dead answers the reader's question wrongly and
  confidently, which is worse than no meter at all.

### The threshold that says nothing rather than accusing

After ten seconds with nothing above the activity threshold the strip says *"Listening — no sound
detected yet"*. It said something much more useful for one draft — *"No sound reaching the
microphone. Check your input device."* — and that was removed on review. Somebody presses the button,
thinks, and then speaks; a headset with heavy noise gating delivers exact silence until the first
syllable. Both produce the accusation, and a reader told their hardware is broken goes and changes
settings that were fine. **Only `audio-capture`, a dead track or a refused `getUserMedia` earns that
sentence**, because those are facts rather than inferences. Everything else gets an observation.

### And the errors that used to vanish

The handler named four codes: two it swallowed, two it apologised for. Everything else — including
`network`, which is what a captive portal or a plane produces, and `audio-capture`, which is a
disconnected headset — **disarmed and turned the button off with no message at all**. That is
[silent-success](../reusable/silent-success.md) with the polarity reversed, and the check anybody
would naturally run ("did the button light up?") gives the reassuring answer either way.
[`dictation-errors.ts`](../../src/web/dictation-errors.ts) is now total: every code produces either a
sentence or a deliberate silence, never an accident.

The full diagnosis, the measurements, the two reviews and the traps are in
[260827f-microphone-level-meter.md](../plans/260827f-microphone-level-meter.md) — including the one that costs the
most time: **`requestAnimationFrame` does not run in a hidden tab**, so the meter reads a flat zero
when driven from browser automation that is not frontmost, with every other part of the audio graph
checking out perfectly.

## And then it was still broken, and the microphone was not

Greg pressed it again a few hours later: *"I just tried and it still doesn't seem to be working, and
doesn't show any indication of input volume."* Nothing was broken this time either. What
`getUserMedia({ audio: true })` handed the page was:

```
track = "Microsoft Teams Audio Device (Virtual)"   readyState=live   muted=false
```

A conferencing loopback. Every sample it produced was **exactly `0.0`** — not a quiet room, which
measures −70 to −51 dBFS, but digital silence. Measured against the built-in microphone in the same
minute, on the same page: `0.044` peak, −27 dBFS. The recogniser transcribed nothing because there
was nothing to transcribe; the meter drew a flat line because the line was flat. Both instruments
were correct and neither was any use, **because nothing on the page said which microphone had
produced that zero.**

That is the same failure the meter itself was built to end, one layer further down. An observation
without the thing observed is half an instrument. So:

- **The strip names the device**, at the moment it is diagnostic — on the quiet line, not all the
  time. *"No sound detected yet · Microsoft Teams Audio Device (Virtual) · Change"*: two facts side
  by side rather than one sentence joining them, because *"no sound **from** X"* turns a
  ten-second threshold into a verdict about a device, which is exactly the accusation the section
  above exists to refuse.
- **The reader can pick a different one.** [`mic-devices.ts`](../../src/web/mic-devices.ts), stored
  in `localStorage`, sent as `{ deviceId: { exact } }` — `exact` rather than `ideal`, because
  `ideal` silently substitutes another device when the named one is gone, which is this whole bug
  wearing a constraint. We deliberately do **not** guess: no preferring `'default'`, no skipping
  labels matching `/virtual|teams|zoom/`. Both would override a decision the reader made in their
  own browser settings.

### The button says what pressing it does, and for how long

Two smaller things Greg asked for in the same breath. The armed button wore `MicOff`, which is the
icon for *muted* — so the one moment the microphone was live it showed the glyph for dead. It is now
a filled **square** in both armed phases, on the rule that the icon says what the *press* does; the
phase is carried by colour, the pulse, and the strip's own words. And there is an `m:ss` timer,
whose zero is the first `audiostart` rather than the press, because the 1.1 seconds before the
device opens are not seconds of anything.

### What we heard, when nothing came back

Greg also asked for the audio to be kept on failure, with *"a button to reveal it in the OS file
explorer"*. **A web page cannot reveal a file in the OS file explorer** — no API, sandbox boundary,
not a gap. The nearest true thing is a download, after which Chrome's own downloads UI carries a
*Show in Folder*, so the reveal happens one click along and at the reader's request. The button
promises only what it does: *Save 0:14*.

The trigger is **not** "if there's an error", which is what was asked for and would have been silent
through the entire failure that prompted it — a silent device produces `no-speech`, which is
suppressed, and Chrome restarts happily. It is **"the dictation ended having transcribed nothing"**,
which covers the silence, the `network` error and the failed Safari restart alike. A recording of
Greg's session would have been fourteen seconds of digital silence, which is the proof.

The rules that keep it honest, all in [`mic-recording.ts`](../../src/web/mic-recording.ts): nothing
is offered unless the recorder started, never errored, finished, produced bytes, and ran at least
two seconds; the recorder is drained *before* the track is released, or the tail of the file goes
missing; it is dropped when the dictation produced text, on unmount, on the next press, and by hand;
it is never uploaded anywhere.

The container is AAC-in-MP4, so the file opens on a double-click — bare `audio/mp4` reports
supported and gives you **Opus in MP4**, which macOS will not play, and a file the reader's machine
cannot open fails the whole point while passing every check. But the sharper lesson came from the
browser: **`isTypeSupported` is a claim about the codec, not about the options you pass with it.**
AAC-in-MP4 is supported and works — until you add `audioBitsPerSecond: 32000`, at which point
Chrome's encoder fires `EncodingError` 307ms in and hands over nothing. Three configurations out of
three. So the app always chose AAC, always sent the hint, and **never once produced a file**, in
total silence. Nothing you can ask beforehand would have caught it, so the recorder now has to prove
itself: one that fails before producing a byte is replaced with the next container, one that fails
after is a real failure and offers nothing.

The measurements, both reviews and the two bugs the tests found after the reviews are in
[260827k-microphone-device-and-recording.md](../plans/260827k-microphone-device-and-recording.md).

## Where the pieces are

| | |
|---|---|
| [`src/profile.ts`](../../src/profile.ts) | render, normalise, hash, the staleness rule, `PROFILE_RULES`, `profileSection` — the filesystem store was deleted 2026-09-05 |
| [`src/shelf.ts`](../../src/shelf.ts) | `MAX_TITLE_CHARS`, and `loadShelf` for fixtures — `purpose` writes moved to Postgres |
| [`src/store/contracts.ts`](../../src/store/contracts.ts) | `ReaderStore`, and `ShelfStore.patch`'s third key |
| [`src/store/pg-reader.ts`](../../src/store/pg-reader.ts) | `reader_profiles`, one row per owner |
| [`src/store/pg-shelf.ts`](../../src/store/pg-shelf.ts) | `articles.purpose` — the per-article half |
| [`src/routes.ts`](../../src/routes.ts) | `GET`/`PATCH /api/reader`, `resolveProfile`, `withProfileChanged` |
| [`src/web/SettingsSection.tsx`](../../src/web/SettingsSection.tsx) | the Settings card on the same page — [experimental-features.md](experimental-features.md), which is about what the app shows rather than what the model is told |
| [`tests/profile.test.ts`](../../tests/profile.test.ts) | the pure rules, including the staleness table exhaustively |
| [`tests/route-profile-concurrency.test.ts`](../../tests/route-profile-concurrency.test.ts) | that the profile read really starts before the artefact read has finished, and that the artefact's error still wins |
| [`tests/profile-prompts.test.ts`](../../tests/profile-prompts.test.ts) | the batch prompts — which `article-prompt.test.ts` never covered |
| [`tests/article-prompt.test.ts`](../../tests/article-prompt.test.ts) | that the cached prefix is untouched by any profile |
| [`src/web/ProfileBox.tsx`](../../src/web/ProfileBox.tsx) | the textarea, the hint and the counter — shared by `/profile` and the metadata page. The microphone moved out of it on 2026-08-27 |
| [`src/web/useDictation.ts`](../../src/web/useDictation.ts) | the microphone: four phases, the one owned track, the recorder, the upload |
| [`src/web/useDictationField.ts`](../../src/web/useDictationField.ts) | wiring it to a text box: the caret, the span the words occupy, the box closed while the transcript is on its way |
| [`src/web/DictationStrip.tsx`](../../src/web/DictationStrip.tsx) | the button and the strip, so every box that adopts a microphone gets the same one |
| [`src/web/mic-lock.ts`](../../src/web/mic-lock.ts) | one microphone per **page**, however many boxes have a button |
| [`src/web/dictation-upload.ts`](../../src/web/dictation-upload.ts) | the client half of `POST /api/transcribe` |
| [`src/transcribe.ts`](../../src/transcribe.ts) | the server half: the vocabulary, the model call, and why it is a transcriber rather than a chat model |
| [`src/dictation-limits.ts`](../../src/dictation-limits.ts) | how big a dictation may be and what containers we can send — shared by both ends |
| [`src/web/useAudioLevel.ts`](../../src/web/useAudioLevel.ts) | the analyser and the frame loop, and everything that must not be mistaken for silence |
| [`src/web/audio-level.ts`](../../src/web/audio-level.ts) | pure: RMS, the decibel mapping, the measured floor, the smoothing |
| [`src/web/dictation-errors.ts`](../../src/web/dictation-errors.ts) | pure: every error code to a sentence, totally |
| [`src/web/MicLevel.tsx`](../../src/web/MicLevel.tsx) | the five bars, and the frame loop that never re-renders |
| [`src/web/mic-devices.ts`](../../src/web/mic-devices.ts) | which microphone: the list, the remembered choice, and why the constraint is `exact` |
| [`src/web/mic-recording.ts`](../../src/web/mic-recording.ts) | keeping the audio of a dictation that produced nothing, and the container that opens on a Mac |

## What is still open

- **No evidence it helps.** The same criticism [summaries.md](summaries.md) already levels at itself.
  The cheapest check is two glossaries of one article, one for a beginner and one for an expert, read
  side by side — and the sharper question is not *"are they different"* but **does the expert version
  ever mention the expertise?**
- **No counter on the register yet.** The plan proposes logging profile-echo words and second-person
  pronouns, which would turn "never mention the profile" from a rule into a number the log can
  contradict. Not built.
- **Stored answers carry no provenance.** Chat messages, comments and
  `glossary-lookups.json` all hold model output pitched at the reader, and none
  of them records a `profileHash`. So there is no badge beside a six-week-old
  answer — which is the *right* absence for now, because a badge there would
  start lying the moment the profile changed. Adding the field to those three is
  the next piece.
- **Instant switching between a profiled and a plain artefact** is not built, and since the checkbox
  went on 2026-09-13 there is no way to ask for a plain artefact at all short of emptying both boxes;
  storing both copies is
  [deferred with reasons](../plans/260826t-reader-profile.md#storing-both-copies-is-deferred-and-the-deferral-now-has-teeth).
- **Two tabs.** Last write wins, which is what `shelf.json` already does.
- **Not multi-user.** One reader, one profile, which is what [auth.md](auth.md) says this app is —
  though the Postgres half is keyed by `owner_id` from the start.

## The sticker came off

Greg, 2026-08-27, after the encoder bug had been chased down and the microphone still would not
do the job:

> I still couldn't get it to work properly, but don't have time to work on it. For now, add
> a warning message and/or under-construction icon next to or whenever someone uses the
> microphone button to warn users.

So for a day there was a `Construction` mark and the word *unreliable* beside the button. Later
the same day:

> We've marked the microphone in /profile as unreliable. It seems better now.

It was. The bug the sticker was about — an AAC encoder that refuses one channel at 48 kHz and
32 kbps while every probe available says it will accept it — had been found and worked around;
what was left was a transcript that got this app's own words wrong, which is a different
complaint and now has a different fix. The mark is gone, and
[`tests/profile-mic-button.test.tsx`](../../tests/profile-mic-button.test.tsx) asserts the word
is nowhere on the page, so it cannot drift back.

**What took its place is a promise rather than a warning**, and it keeps three of the four things
that made the sticker good:

- It sits in the same slot — the button's `aria-describedby`, before the button in the DOM, so
  focusing the control reads the name and then the sentence, and somebody arriving by keyboard
  meets it on the way to the button rather than after it.
- It exists **once** in the source and is used wherever it is needed, because two copies of a
  promise are two promises that drift.
- It is not an error state and does not look like one.

What it drops is the fourth: it no longer says *"type instead, whatever is in the box is safe"*,
because that sentence was reassurance about a defect and the defect is fixed. What it says now is
what a reader needs to know before pressing a button that was free and is not any more: where their
voice goes, and what we can and cannot promise about it.

**It said *"and it isn't stored"* until 2026-09-07, and that clause is the thing this section is
really about.** It was true while dictation was routed only through zero-data-retention providers,
and it stopped being true the day dictation moved to a transcription endpoint that does not apply
that routing — so the sentence had to change on a day when nothing a reader could see had changed.
The sentence itself lives once, in `DICTATION_PROMISE`
([`src/web/DictationStrip.tsx`](../../src/web/DictationStrip.tsx)); read it there rather than
here, and read [privacy.md](privacy.md) for why it says what it says. Quoting it in a second place
is how the promise above outlived the routing that made it true.

A word like *unreliable*, left on a control after it stops being true, is worse than no label at
all — it teaches people not to use something that works, and it teaches whoever reads the code
next that nobody is checking. That is why the removal has a test and not just a commit.

## See also

- [reader-profile.md (the plan)](../plans/260826t-reader-profile.md) · [glossary.md](glossary.md) ·
  [summaries.md](summaries.md) · [comments.md](comments.md) · [prompt-caching.md](prompt-caching.md)
- [260827f-microphone-level-meter.md](../plans/260827f-microphone-level-meter.md) — the microphone's diagnosis and
  rebuild, and the two GPT Sol reviews behind it
- [260827k-microphone-device-and-recording.md](../plans/260827k-microphone-device-and-recording.md) — the device that
  emitted digital silence, the stop glyph, the timer, and the audio kept when nothing came back
- [260827b-microphone-library-options.md](../research/260827b-microphone-library-options.md) — **should a library
  have done all this?** No, in all four areas — though recording got there the long way, by being
  rejected, un-rejected on review, and then **rejected on measurement**. The candidate that came
  close and the file-size number that killed it; the spike that reproduced the encoder failure and
  found that WebCodecs' better probe answers `supported: true` for the config that throws, that
  `mediabunny` fails at the identical one because it is the same encoder, and that it *hangs*
  where our ladder recovers in 382ms; why the iPad is irrelevant to a path Safari cannot reach;
  and the button that announced its state twice
- [browser-testing.md](browser-testing.md) — why a hidden tab makes the level meter read zero
- [library.md](library.md) — the shelf record `purpose` joins
- [experimental-features.md](experimental-features.md) — the other thing on `/profile`: a switch for
  features that are not finished. Same page, same row in the database, different question
- [silent-success.md](../reusable/silent-success.md) — a profile that silently stops reaching a
  prompt returns a perfectly good answer
