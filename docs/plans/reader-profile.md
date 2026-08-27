# The reader profile — telling the model who is reading

**Status: plan, not built.** Written 2026-08-26. Revised the same day after two reviews — GPT Sol on
the engineering, which found seven things wrong with the first draft including a **live caching bug
in chat that this feature would have made worse** (now step 0), and Fable on the design, which
argued for cutting a third of it. What Fable won and what Greg overruled are both recorded below,
in place, rather than tidied away.

Every model call in this app writes for a reader it knows nothing about. The glossary explains
*entropy* to a physicist. Chat pitches an answer at nobody in particular. This is the box where you
say who you are, and the plumbing that carries it to the calls that should care.

It is also a debt being paid. The previous version had this and called it **Reading Intent** —
*"What's your purpose for reading this document?"*, free text stored against
`(user_id, document_id)`. [metadata-page.md](metadata-page.md#reading-intent-worth-remembering-not-worth-building-yet)
looked at it in 2026-08-25 and deferred it for one specific reason:

> It is a genuinely good question to ask … But it is reader state, we have exactly one reader-state
> store today (`comments.json`), and inventing a second one for a text field is the wrong order to
> do things in.

That reason has expired. `shelf.json` exists, `ShelfStore` exists, and the second store is already
built.

Greg, 2026-08-26:

> Add a multi-line-text-input box to the Metadata for the user to describe their
> background/experience/interests/purpose in reading this.
>
> Then feed that in if non-empty as part of the prompt (perhaps at the end of the prompt to preserve
> prompt caching …) to any relevant tasks (e.g. Glossary, Summary, Chat, etc).
>
> Ideally also add a microphone button next to this text-input box.

---

## Step 0 — the bug this feature would have hidden

**Chat's prompt cache stops working on the second turn, and has since the day it was built.**

Not the article's fault and not this feature's. `converse` uses OpenRouter's **automatic** caching:
`cache_control` at the top level of the request body, which marks the *last cacheable block* —
i.e. the final user message ([`src/converse.ts:669`](../../src/converse.ts)). That is fine while
the final user message is exactly what gets stored and replayed. It is not:

```
turn 1 sends   … article … │ "The reader is at spya-k3m9qt.\n\nWhat is entropy?"   ← breakpoint here, written
turn 1 stores                "What is entropy?"                                    ← bare
turn 2 sends   … article … │ "What is entropy?" │ answer │ "The reader is at …\n\nAnd free energy?"
                             └── diverges from what was cached ──┘
```

`buildConverseMessages` prepends `readerPositionLine` to the current question only
([`src/converse.ts:435`](../../src/converse.ts)); history is replayed from the stored bare `m.text`
([`src/converse.ts:431`](../../src/converse.ts)), and the route stores the bare trimmed question
([`src/routes.ts:755`](../../src/routes.ts)). So the cached block is never reproduced, and writes
happen only at the breakpoint — there is no article-only entry to fall back to. Every turn after the
first pays a **full cold write** whenever the reader has scrolled, which is always.

Nothing catches it. [`tests/article-prompt.test.ts:317`](../../tests/article-prompt.test.ts)
deliberately treats the whole conversation as the prefix, because with automatic mode the breakpoint
is a block we never name. And [`evals/prompt-caching.ts`](../../evals/prompt-caching.ts) calls
`findPassages` only — **search**. Chat is in the doc's list of what the eval covers and is not in
the eval. Textbook [silent success](../reusable/silent-success.md).

**Fix: give `converse` an explicit breakpoint immediately after the article, exactly as `explain`
has.** The messages become content arrays. The article is then written once and read on every turn,
and the growing tail is simply uncached, which is what it should have been all along — the tail
changes every turn by construction, so there was never anything there worth caching.

This lands **first, on its own, with its own commit**, because:

- it is a bug with a measurable cost that exists today;
- the profile would have gone into that same final message and made the divergence permanent
  rather than conditional on scrolling;
- and once the breakpoint is explicit, the profile's placement in chat becomes the same decision as
  everywhere else instead of a special case.

It needs a red test first, per `CLAUDE.md`: a `buildConverseMessages` case asserting that turn two's
prefix, through the previous question, is byte-identical to what turn one marked. Then a postmortem
under `docs/postmortems/` — the root cause is not the missing breakpoint, it is that
*`cachedText` returning "everything" for automatic mode was written as a safe default and then relied
on as a measurement*, and the eval's coverage claim was copied from the plan rather than from the
eval.

---

## The shape

Two boxes, not one. Asked whether this should be per-article or global, Greg chose both:

> Both: global "about me" + per-article "why this one"

Because the sentence in the request has two halves that behave differently. *Background* and
*experience* are true of you on every article and you should type them once. *Purpose in reading
this* is true of one article and nothing else.

**Each box lives where its subject lives.** Greg, 2026-08-26:

> The text-level profile should be in the text-level Metadata, and the user-level profile should be
> in its own new `/profile` page (linked to from the Home page). Signpost from the text-level to the
> user-level page.

```
  ┌─ / (Home) ──────────┐          ┌─ /profile ─────────────────────────────┐
  │  Spideryarn         │          │  ABOUT YOU                             │
  │        👤 Profile ──┼─────────►│  ┌──────────────────────────────┐ ┌──┐ │
  │  ┌────────┐┌───────┐│          │  │ Cognitive scientist, twenty  │ │🎤│ │
  │  │ card   ││ card  ││          │  │ years. Rusty on transformer  │ └──┘ │
  │  └────────┘└───────┘│          │  │ internals.                   │      │
  └─────────────────────┘          │  └──────────────────────────────┘      │
                                   │  Used on every article.   0 / 1500     │
  ┌─ /read/<slug>/metadata ──────┐ │                                        │
  │  YOUR READING                │ │  WHAT'S RUNNING · RECENTLY READ · …    │
  │  ┌────────────────────────┐  │ └────────────────────────────────────────┘
  │  │ 🎯 Why you're reading  │  │                    ▲
  │  │    this one            │  │                    │ signpost
  │  │ ┌────────────────┐ ┌──┐│  │                    │
  │  │ │ I want the     │ │🎤││  │                    │
  │  │ │ evidence, not  │ └──┘│  │                    │
  │  │ │ the history.   │     │  │                    │
  │  │ └────────────────┘     │  │                    │
  │  │           0 / 600      │  │                    │
  │  ├────────────────────────┤  │                    │
  │  │ 👤 About you  →────────┼──┼────────────────────┘
  │  │    "Cognitive scientist…"  (read-only preview)  │
  │  └────────────────────────┘  │
  └──────────────────────────────┘
```

The Metadata page shows the global half **read-only**, as a preview with a link. One editable home
per value; the preview is there so a reader looking at "why is this glossary written like this"
sees both halves of the answer without leaving the page.

The two are joined into **one string** before they reach any prompt — `renderProfile()` in a new
`src/profile.ts`. Nothing downstream knows there were two boxes, because nothing downstream has a
reason to treat them differently, and two fields threaded through five call sites is ten chances for
one of them to forget the second.

```
About the reader: Cognitive scientist, twenty years. Rusty on transformer internals.
Why they are reading this piece: I want the evidence, not the history.
```

Either half may be empty. Both empty means **no profile at all**, and that is not the same as an
empty profile — see [Absence must leave no trace](#absence-must-leave-no-trace).

**Normalise before rendering and before hashing**: trim each half, collapse `\r\n` to `\n`, treat
whitespace-only as empty. The hash is of the *rendered* string, not of the two fields, so two ways
of writing the same profile cannot produce two cache entries and two false "you changed your
profile" warnings.

### The second box was argued against, and kept anyway

Fable's review recommended dropping the per-article box entirely, and the argument is good enough to
write down rather than bury:

> The plan's own example gives it away. The per-article box says "I want the evidence, not the
> history." The steer's example in summaries.md says "I care about the evidence, not the history."
> Same sentence, two boxes. … Chat and explain: the reader types their purpose into the question
> itself — a question is a purpose statement. Summaries: the steer already carries it, stored on the
> artefact, edited at the point of rewriting.
>
> — Fable, 2026-08-26

Its alternative was to ship the global box alone and, if per-article intent later proved wanted,
**promote the steer** — back it with `ShelfState.purpose` and share it across features — rather than
add a rival to it.

Greg was shown that and chose **keep both, separate** (2026-08-26). So there are three free-text
boxes about intent in this app, and this is the rule that keeps them apart:

| Box | Scope | Lives on | Read by |
|---|---|---|---|
| **About you** | you, always | `data/reader.json` / `reader_profiles` | all five features |
| **Why this one** | one article, durable | `shelf.json` → `ShelfState.purpose` | all five features |
| **Steer** | one rewrite of one artefact | `Summaries.guidance` | summaries only |

**Precedence, when the steer and the purpose disagree: the steer wins.** It is the more recent and
more specific act — the reader typed it while looking at the thing they were about to rewrite. The
prompt has to *state* that rather than leave the model to guess, because two instructions about
emphasis with no ordering between them is how you get an answer that follows neither.

Fable's real point survives the decision and belongs in [What is still open](#what-is-still-open):
if the per-article box goes unused, delete it. "Watch which one gets typed into" is not a plan in an
app with no telemetry, so the check has to be Greg noticing, and this line is the reminder to look.

---

## Where the two halves live

Both are **reader state**: they must survive re-extraction, and the pipeline must not be able to
undo them. That is the argument [`src/shelf.ts`](../../src/shelf.ts) already makes for the renamed
title, and it holds here word for word.

| | Filesystem | Postgres | Behind |
|---|---|---|---|
| **per-article** | `data/<slug>/shelf.json` → `ShelfState.purpose` | `articles.purpose` (a fifth shelf column beside `archived_at`, `title_override`, `opens`, `last_opened_at` — [`src/db/schema.ts:135`](../../src/db/schema.ts)) | `ShelfStore.patch` |
| **global** | `data/reader.json` | `reader_profiles`, one row per `owner_id` | new `ReaderStore` |

**The first draft said "a new `data/reader.json`" and stopped there. That was wrong**, and Sol was
right about why: the routes no longer call `src/shelf.ts` directly, they call
`shelfStore.patch` ([`src/routes.ts:1278`](../../src/routes.ts)), and a bare filesystem write in
Postgres mode is a write production never reads. Both halves need the store seam
([`src/store/contracts.ts:208`](../../src/store/contracts.ts)) — the contract, both adapters, the
schema, the migration, and the import/export parity tests. `ShelfStore.patch`'s signature widens by
one optional key; `ReaderStore` is two methods.

**This is the plan's largest collision with the in-flight Postgres migration.** See
[Collisions](#collisions).

**Caps: 1,500 characters global, 600 per-article, refused rather than truncated.** The 600 matches
`MAX_GUIDANCE_CHARS`, and the reason there holds here — *"a silently shortened instruction is one
the reader believes they gave and did not"*
([summaries.md](../project/summaries.md#steering-a-rewrite)). The global one is larger because it is
written once and read forever.

**Never logged, only its length.** Same rule as the summary steer, and for a stronger reason: this
one is about the person rather than about the article. [logging.md](../project/logging.md).

### The read path, which the first draft forgot

The Metadata page cannot fill its own textareas from anything that exists today. `Article`
([`src/types.ts:531`](../../src/types.ts)) is artefacts only; `ArticleMetadata`
([`src/types.ts:712`](../../src/types.ts)) has no shelf state; `/api/library` has no single-record
GET.

`GET /api/metadata/:slug` is the right place, and for the reason its own docstring already gives
about the comment count: *"this endpoint is already walking this article's directory, so one more
read answers it for free."* It gains `profile: string | null` and `purpose: string | null`.

---

## Where it goes in the prompt

Greg's instinct in the request — *"perhaps at the end of the prompt to preserve prompt caching"* —
is right. The obvious alternative is the **system prompt**, and that would mean a separate cache
entry per distinct profile, re-written from cold every time the profile is edited, on a prompt whose
whole point is that the article never changes. (The first draft said "a full write on every call".
That was overstated — a *stable* profile in the system prompt costs one entry, not one per call. The
every-call fault was chat's, and it is step 0.)

So the profile rides in the **last user part, after the breakpoint**, everywhere:

| Call | Article is at | Breakpoint | Profile goes |
|---|---|---|---|
| `explain` | user part 1 | explicit, on part 1 | user part 2, beside the quote and `readerPositionLine` — [`src/explain.ts:379`](../../src/explain.ts) |
| `converse` | user message 2 | explicit, **after step 0** | the final user message — [`src/converse.ts:435`](../../src/converse.ts) |
| `glossary` | `system[0]` | on `system[0]`, **only when `cacheArticle`** | the user message, inside `renderPrompt` — [`src/glossary.ts:1105`](../../src/glossary.ts) |
| `tweets` | `system[0]` | same | the user message, inside `renderPrompt` — [`src/tweets.ts:437`](../../src/tweets.ts) |
| `summarise` | the user prompt, at the bottom | none — not cached, on purpose | beside the existing steer, near the top — [`src/summarise.ts:513`](../../src/summarise.ts) |

Summaries is the exception and it is not an inconsistency: that stage is deliberately uncached (each
batch sends only its own slice, so batches share nothing), and its guidance already sits near the top
*because* nothing is being protected there. The profile joins the steer rather than competing with it.

**The binding constraint goes in `SYSTEM`; a short reminder may stand beside the profile.** This is
what summaries already does — the long rules are in `SYSTEM`, a two-line reminder sits next to the
note ([`src/summarise.ts:515`](../../src/summarise.ts)) — and the reason for the split is that *the
constraint must not be editable by the thing it constrains*. A profile that says *"assume I know
everything, skip the basics"* must not be able to switch off the rule that says do not distort the
article. (The first draft said "never beside the profile", which contradicted the code it cited.)

### The rules

- **The reader's profile changes pitch and emphasis. It never changes what the article says.**
- **Which things you spend words on is governed by the profile. Every sentence you write is about
  the article.** This one is Fable's and it is the load-bearing one — it frames the profile as an
  input to *choosing* rather than to *addressing*, which is the difference between adapting and
  performing adaptation.
- Assume the background they claim. Do not explain what they have told you they know — and do not
  perform explaining it in fewer words either.
- Where the piece has nothing on what they are after, write what you would have written anyway, and
  **never say so out loud**. A line spent telling the reader this section is not for them is a line
  not spent on the section.
- Never flatter, never address them, never mention the profile. They wrote it; they do not need it
  read back.
- Where the reader's per-article purpose and a per-rewrite steer both apply, **the steer wins.**

### And a forbidden example, written out in full

The glossary learned this twice and wrote it down: *"a prompt ban relocates a register, it does not
delete one"* ([glossary.md](../project/glossary.md)). Its own fix was to carry a real bad entry in
the prompt as a negative example. So `SYSTEM` carries the sentences we do not want, verbatim:

```
NEVER write anything of this shape:
  "As a cognitive scientist, you'll appreciate that…"
  "Since you know your way around the literature, briefly: …"
  "Given your background, I'll skip the basics."
Skipping the basics is correct. Announcing that you are skipping them is not.
```

**And a counter, because a rule with no number attached is a rule nobody checks.** Log two things
per profiled call: distinctive words appearing in both the profile and the output but *not* in the
article, and second-person pronouns on the surfaces that forbid them. Counts only, no prose, per
[logging.md](../project/logging.md). Near zero is healthy; a climb is the register coming back. Same
move `citations` / `unknownCited` already made in chat — it turns "never mention the profile" from a
rule into something the log can contradict.

### Absence must leave no trace

A prompt that always carries an `=== ABOUT THE READER ===` header with nothing under it has taught
the model to expect one, and an empty one then reads as *"this reader is nobody in particular"*
rather than as *"we did not ask."* `renderPrompt` in [`src/summarise.ts`](../../src/summarise.ts)
already makes this point about `guidance` and a test pins it. Same here: no profile, no section, no
whitespace.

### One profile per job, frozen at the start

A summary run is several batches. A reader who edits the box mid-run would otherwise get one
artefact written from two profiles and stamped with the second.

So the profile is **resolved once and carried**, exactly as `guidance` already is: read at
`POST /api/jobs`, stored on the job ([`src/types.ts:854`](../../src/types.ts)), carried on
`StepContext` ([`src/pipeline.ts:200`](../../src/pipeline.ts)), handed to the step. It also joins
`sameWork` ([`src/jobs.ts:644`](../../src/jobs.ts)) for the same reason guidance is in there: press
the button, change your mind, press again, and you must not be handed the first job.

**Rails that already exist.** This is the single biggest reason the plan is smaller than it looks.

### What it does not reach

**Not the pipeline's structural stages.** Asked whether the profile should steer the ToC, the arc or
the section labels, Greg: *"Let's say no for now."* The reason to agree is stronger than preference:
the tree is [the one structure](../project/granularity-zoom.md#the-tree) that the ToC, the zoom, the
summaries and the spine all address, and a reader-specific tree is one that shifts under a reader
who edits their profile. Structure stays shared; only the prose *about* the structure is personalised.

**Not semantic search.** Greg did not pick it. Search answers *"where does this piece say X"*, which
has an answer that does not depend on who is asking, and a profile-biased ranking returns different
passages on different days with no way to tell why.

**Not tool arguments.** Chat and explain can call web search. The profile must never reach a query
string — it is the reader's description of themselves, and a search provider is a third party.
A rule in [chat-tools.md](../project/chat-tools.md) and a line in
[security.md](../project/security.md).

---

## Provenance, staleness and the checkbox

Greg:

> ideally we should indicate with a checkbox (default-true, with fully-explanatory tooltip) in all
> the places where we're taking into account that we have done so, and if they user checks/unchecks
> then it regenerates with/out this prompt? Ideally it would store both versions if generated, so
> it's easy to flip back and forth between them. And perhaps they should all have a way to
> regenerate and/or a way to know if they're stale (e.g. if either the user-level or text-level
> prompts have changed since the output was generated).
>
> — Greg, 2026-08-26

Three asks with three different costs. Sol found the first draft's version of this self-contradictory
— it declared a deliberately-unprofiled artefact permanently stale, and never said where the
checkbox's state lived. Here is the version that holds together.

### The artefact records the choice. There is no second place to store it.

Each generated artefact gains one field:

```ts
/** The profile this was written from — or null for "written deliberately without one". */
profileHash?: string | null;
```

Sixteen hex characters of the *rendered, normalised* profile string, like
[`hashBlocks`](../../src/source-hash.ts) and for the same reason: compared for equality, never for
closeness.

Three states, and they are the whole design:

| Value | Means | Label | Profile-stale? |
|---|---|---|---|
| absent | written before this feature existed | none | **no** |
| `null` | written deliberately without a profile | none | **no** |
| a hash | written from that profile | "Written for you" (if it matches) | **only if it differs from now** |

**`null` is never stale.** That is the line that dissolves the contradiction: a reader who
deliberately generated a plain glossary is not nagged about it for ever. And absent is never stale
either, so nobody's existing artefacts light up with a warning about a profile they never had.

**The checkbox therefore needs no storage of its own.** It is a *generation* option, not a view mode,
and its default is read off the artefact: checked when `profileHash` is a hash, unchecked when
`null`, checked when there is no artefact yet and a profile exists. Persistence for free, and the
state can never disagree with the thing it describes.

It travels as one boolean on `POST /api/jobs` (`useProfile`), joins `sameWork`, and — being part of
the prompt — is what decides whether `renderProfile()` is called at all.

### A label for what happened; a checkbox where the money is

Fable's second-strongest point, and it changes the UI:

> It reads as something to set when it records something that happened — the exact shape the
> glossary already solved with "a label instead of a warning triangle". And until … two-slot
> storage exists, flipping it means regenerate-and-wait: a model-call spend hidden behind the
> lightest control in the interface.
>
> — Fable, 2026-08-26

So the two jobs are split, and each goes where it belongs:

```
  ┌─ GLOSSARY ─────────────────────────────────────────────┐
  │  Threshold ▁▂▃▅▇          ✓ Written for you  ⓘ         │   ← a LABEL. States a fact.
  │  ⚠ You changed your profile since these were written.  │   ← the stale line
  │  ┌──────────────────────────────────────────────────┐  │
  │  │  ☑ Use your profile          [ Write them again ] │  │   ← the CHECKBOX, beside
  │  └──────────────────────────────────────────────────┘  │      the button that spends
  └────────────────────────────────────────────────────────┘
```

The label carries the tooltip Greg asked for — what we sent, that it changes emphasis and not
content, and a link to `/profile`. The checkbox sits inside the rewrite affordance, next to the
summary steer, where the reader can already see they are about to pay for something. Unchecking it
and pressing the button is *exactly* the "check/uncheck and it regenerates without this prompt"
Greg described; it just does not pretend to be free.

**With no profile written, both are absent — not disabled, not unchecked.** A dead control teaches a
reader they have failed at something; absence is honest, because nothing is being taken into account.

**Chat and explain get the checkbox only**, in the composer, meaning "use my profile for the next
answer". They have no rewrite and should not grow one for this.

### Staleness stops being one boolean

`isStale` today compares one thing ([`src/glossary.ts:668`](../../src/glossary.ts),
[`src/tweets.ts:103`](../../src/tweets.ts), [`src/summarise.ts:743`](../../src/summarise.ts)) and
the API carries one boolean. One boolean cannot say two different sentences, and after this change
there are three:

```ts
type StaleReason = "article" | "prompt" | "profile";
```

- **article** — `sourceHash !== hashBlocks(blocks)`. *"The article changed since these were written."*
- **prompt** — `version !== PROMPT_VERSION`. New, and needed immediately: see below.
- **profile** — `profileHash` is a hash and differs from the current one. *"You changed your profile
  since these were written."*

`stale: boolean` stays as `reasons.length > 0` so nothing that reads it today breaks; `staleReasons`
is added beside it.

**Every prompt version has to be bumped in the same commit.** Adding the four rules to `SYSTEM`
changes what glossary, summaries and tweets send *even when the profile is empty*, and an artefact
written by the old prompt is not one we would write again. The first draft missed this entirely.

### Glossary's top-up is the sharp edge

`existingFor` gates the top-up path and today accepts any glossary whose source hash and prompt
version match ([`src/glossary.ts:339`](../../src/glossary.ts)), feeding it straight into generation
([`src/glossary.ts:1045`](../../src/glossary.ts)). Adding `profileHash` to `isStale` does **nothing**
here — `isStale` is not the gate.

So: **`existingFor` takes the expected profile hash and refuses on a mismatch.** New profiled terms
must not be appended to old unprofiled ones and then stamped with the new hash — that is a lie about
provenance, written by us, into a file. On a mismatch the prose is rewritten wholesale, with
`idsByTerm` used only to preserve term identities so existing `?term=` links and stored lookups
still resolve.

### Chat and explain store their answers. The first draft said they did not.

They do — explain persists the finished answer into the comment
([`src/routes.ts:392`](../../src/routes.ts)), chat persists every assistant turn
([`src/routes.ts:888`](../../src/routes.ts)). So a "Written for you" badge beside a six-week-old
answer would lie the moment the profile changed.

Two honest options, and the plan takes the first:

1. **Stamp the stored answer** with `profileHash` — one optional field on the comment and on the
   chat message, set from what the call actually sent. The badge then describes that answer rather
   than the current state of the world, which is what a badge on a stored thing has to do.
2. Make the toggle explicitly composer-only ("use my profile for the next answer") and put no badge
   on old answers at all.

The toggle itself *is* composer-only in both cases — chat and explain have no "regenerate" and
should not grow one for this.

### Storing both copies is deferred, and the deferral now has teeth

The first draft sketched `<kind>.json` + `<kind>.alt.json`, picked by `profileHash`. Sol is right
that this is not a storage-neutral design and should not be blessed yet:
`ArtifactStore.read`/`stampFor` have no variant argument
([`src/store/artifacts.ts:193`](../../src/store/artifacts.ts)), Postgres holds one JSONB column per
artefact ([`src/db/schema.ts:228`](../../src/db/schema.ts)), and step currency is keyed by
`(revision, step)` only. There is also a problem the file layout hides: two variants of a glossary
would mint **two different ids for the same term**, breaking `?term=` links across the flip.

So: **not built, and not designed either.** What exists today is a "Write them again" button on
every one of these panels; flipping the checkbox and pressing it is the whole feature minus the
instant part. If flipping turns out to be a thing anyone does more than twice, the variant axis gets
designed properly — *before* the Postgres schema lands, because afterwards it is another migration.
If nobody flips, we will have saved all of it. The
[expertise axis](../project/summaries.md#what-this-deliberately-does-not-have) is the precedent, and
it is not encouraging: same shape of control, built, never measured, never used.

### The glossary's difficulty scores are reader-relative, and that is the strongest case here

Worth pulling out of Fable's before/after examples, because it changes what this feature *is* for
one of the five:

> The big effect is *selection*, not prose — difficulty becomes "likely to stop this reader", so the
> whole "worth knowing first" group moves and the threshold slider means something personal.

The glossary already keeps the model's `difficulty` and `centrality` scores and hands the first of
them to the reader as a threshold slider ([glossary.md](../project/glossary.md)). Under a profile
that number stops being a property of the term and becomes a property of the pair — *this term, this
reader*. Which is exactly why `profileHash` is not bookkeeping: a difficulty score written for last
month's profile is **wrong**, not merely old, and the slider built on it is quietly lying about what
it filters.

### The lookups store explain's output too, and the first draft missed them

Beyond comments and chat messages, a third thing stores model output pitched at the reader:
`glossary-lookups.json` ([`src/glossary-lookups.ts`](../../src/glossary-lookups.ts)) — the per-term
web checks, which are *explain with a different selection*. A lookup written for last month's
profile sits beside its entry with no provenance and no stale line. It gets `profileHash` too.

---

## The profile page

`/profile`, linked from Home. Greg, 2026-08-26:

> in the user-level profile page, include other useful stuff, e.g. which are the default models,
> most recent handful of docs, and anything else you think would be useful.

The previous version had this page, and what it had is worth knowing before building it again.

### It built this box, and never once read it

`app/auth/profile/page.tsx` in the old repo had a `BackgroundForm` — one textarea, placeholder
*"Share any relevant background information that might help personalise your reading experience…"*,
stored as free text in `profiles.background`. Its reference doc says it feeds summaries, glossary and
chat personalisation.

**No code path ever read it back into a prompt.** Same for Reading Intent, per-document, in a
`document_users` junction table: saved, displayed, never sent to a model.

So the previous version built *both* of this feature's boxes and wired *neither*. That is the useful
thing to take from it, and it re-sorts this plan: the textareas are the easy half and the least of
it, and anything that lets us ship the boxes while the wiring slips is the failure mode with a
worked precedent. The boxes come **after** the prompts in [Steps](#steps) for exactly this reason.

### What goes on the page

| Section | Where the data comes from | New plumbing |
|---|---|---|
| **About you** | `ReaderStore` | the whole of it |
| **Which models are running** | [`src/models.ts`](../../src/models.ts) — `TASK_TIER` already maps every job to a tier, and the effort table sits beside it | **none** — a static read, one small endpoint or a build-time constant |
| **Recently read** | `GET /api/library` already returns `lastOpenedAt`, `opens`, `words`, `minutes` per article ([`src/types.ts:567`](../../src/types.ts)) | **none** — sort and slice client-side |
| **Your shelf, in totals** | the same payload | none |

The models section is the one worth arguing for: nothing in this app tells the reader which model
wrote what, and `TASK_TIER` is a table that exists, is correct, and is currently visible only to
whoever opens the source. Showing it costs nothing and answers *"why is the glossary slower than the
summaries"* without anybody having to ask.

**Recently read is capped and says so.** The original showed ten and printed *"Showing your 10 most
recent documents"* when it hit the cap — the right instinct, and the same rule chat's tool results
had to learn: [a capped list that says nothing about being capped](../project/chat-tools.md) is one
the reader believes is complete.

### What the page deliberately does not get

- **Expertise sliders.** The original's beginner/intermediate/expert axis, already rejected twice in
  this repo ([summaries.md](../project/summaries.md#what-this-deliberately-does-not-have),
  `original-version/borrow-list.md`). The original's own fallback recommendation was *"a single
  global setting… the reader says once what they know"* — which is this feature. The free-text box
  is the slider done properly, and having both would be having the same setting twice.
- **Typography settings.** Font size, line height, colour scheme — on the original-version
  "deliberately not borrowing" list already: *"a reader who wants bigger text has a browser zoom."*
- **A difficulty score**, for the reason [metadata-page.md](metadata-page.md#reading-difficulty-the-one-we-are-deliberately-not-taking)
  gives: a document-level verdict does the reader's judging for them, which is what
  [vision.md](../project/vision.md) is against.
- **Streaks, or anything that counts at you.** The original's homepage had none and there is nothing
  to inherit. This is a reading tool.

---

## The microphone

Greg: *"Hopefully there's OpenRouter functionality for speech-to-text. Use your judgment about which
to use."*

**There is.** OpenRouter takes audio on the ordinary chat-completions endpoint as an `input_audio`
content part, base64, formats `wav mp3 aiff aac ogg flac m4a pcm16 pcm24`
([docs](https://openrouter.ai/docs/features/multimodal/audio)). No dedicated transcription endpoint;
you ask a multimodal model to transcribe.

**Recommendation: use the browser's own Web Speech API, and do not build the OpenRouter path yet.**

| | Web Speech API | MediaRecorder → OpenRouter |
|---|---|---|
| Cost | nothing | a model call per dictation |
| Server work | none | a route, base64 upload, error copy in [copy.md](../project/copy.md) |
| Chrome / Edge | full support | works |
| Safari 14.1+ / iPadOS 14.5+ | supported, and **runs on-device** | works |
| Firefox | behind a flag — effectively no | works |
| Feedback | live interim text as you speak | a spinner, then a paragraph |
| Recording format | not your problem | **is your problem** |

That last row decides it. Chrome's `MediaRecorder` emits `audio/webm;codecs=opus`, which is **not**
on OpenRouter's list. Safari emits `audio/mp4`, which is. So the cross-browser path is not "record
and upload", it is "capture raw PCM through an `AudioWorklet` and write a RIFF header by hand" —
because the one container Chrome will give you is the one container OpenRouter will not take. That
is a lot of code for a nice-to-have, and its failure mode is a silent empty recording.

Web Speech is about thirty lines, costs nothing, and gives live text while you talk, which for two
sentences into a box is better rather than worse. What we give up: Firefox (feature-detect
`SpeechRecognition ?? webkitSpeechRecognition` and render no button at all), punctuation quality,
and control. Chrome's implementation sends audio to Google — a line in
[security.md](../project/security.md), and the reason the button is armed per press rather than a
mode you can leave running.

Three things that will go wrong:

- **Safari stops on a pause.** `continuous` is honoured loosely. Restart on `onend` while the button
  is armed; stop for real only when the reader presses it again.
- **`no-speech` is not worth showing.** It fires constantly. Only `not-allowed` and
  `service-not-allowed` deserve a message, and that message says the browser blocked the microphone
  — not an error code ([copy.md](../project/copy.md)).
- **Interim results must not be committed.** Confirmed transcript and interim tail in separate
  state, only the confirmed part saved, or a mid-sentence guess gets stored and appended to.

**It ships last and on its own.** Sol's point, and it is right: this turns a storage-and-prompt
change into browser permissions and speech lifecycle work, and none of the rest of the feature
depends on it. If the iPad finds it unusable — the one thing that cannot be checked from here, per
[touch.md](../project/touch.md) — the OpenRouter path is the upgrade and this section is the record
of what it costs.

Fable argued against building it at all — *"a microphone on a write-once field is furniture"* — since
the global box is by design written once and left alone. Put to Greg, 2026-08-26, who chose to build
it. Both boxes get one.

---

## Steps

Each ends green on `npm test` and `npm run typecheck`, and carries its own doc updates rather than
saving them for the end.

0. **The chat cache bug.** Red test, explicit breakpoint in `converse`, postmortem, commit alone.
   Extend [`evals/prompt-caching.ts`](../../evals/prompt-caching.ts) to a two-turn chat call, since
   the coverage the doc claims for it does not exist.
1. **`src/profile.ts`** — normalise, join, cap, hash. `renderProfile(global, purpose)` returning
   `null` when both are empty. Transport-free. Tests: the join, the caps, whitespace-only, that
   empty-plus-empty is `null` and not `""`, and that two spellings of one profile hash the same.
2. **Storage, both halves, through the seam.** `ShelfState.purpose` + `ShelfStore.patch`'s third key
   + both adapters + `articles.purpose` + migration. `ReaderStore` + `data/reader.json` +
   `reader_profiles`. Import/export parity tests. `GET /api/metadata/:slug` gains `profile` and
   `purpose`; `PATCH /api/library/:slug` accepts `purpose`; `GET`/`PATCH /api/reader`.
   **Coordinate with whoever owns `src/store/` before starting** — see below.
3. **Prompts, hash, staleness and prompt-version bumps, in one commit.** The `SYSTEM` rules, the
   profile section in each builder, `profileHash` on `Glossary`/`Summaries`/`TweetThread`,
   `existingFor`'s new argument, `StaleReason[]`, the three `PROMPT_VERSION` bumps, `useProfile`
   on the job and through `StepContext` and `sameWork`.

   These cannot be separated. Step 3-minus-the-hash would generate personalised artefacts with no
   record of it, and every one written in between would be permanently unattributable.

   Tests: extend `tests/article-prompt.test.ts` (the prefix is byte-identical with a profile, without
   one, and after the profile changes) **and add prompt-shape tests for glossary, tweets and
   summaries**, which that file does not cover at all.
4. **`profileHash` on stored answers** — chat messages, comments, and `glossary-lookups.json` — set
   from what the call actually sent.
5. **The label, the stale line and the checkbox**, in `GlossaryPanel`, `SummaryPanel`, `ChatPanel`,
   `CommentDialog` and the tweets page. Two small shared components, not one: `<WrittenForYou>`
   (label + tooltip) and `<UseProfile>` (checkbox, beside a rewrite button).
6. **The `/profile` page** — a new route, the global box, and the rest of its contents (see
   [The profile page](#the-profile-page)). Linked from Home.
7. **The Metadata card** — the per-article textarea in the existing `Your reading` section
   ([`src/web/Metadata.tsx:440`](../../src/web/Metadata.tsx)) plus the read-only preview of the
   global half and its signpost. Debounced save **flushed on blur and on navigation**, a character
   counter, and a visible failure if a save does not land. This is the page's first mutation.
8. **The microphone**, alone, on both boxes.
9. **A quality check before calling step 3 done**: two glossaries of one article, one written for a
   beginner's profile and one for an expert's, read side by side. Not just *"are they different"* —
   Fable's sharper question is **does the expert version ever mention the expertise?** Committed
   under `evals/results/`.

Deferred, deliberately: instant variant switching, and search.

---

## Collisions

Several agents are working this tree, and this plan reaches into two live pieces of work.

- **The Postgres storage migration owns `src/store/` and `src/db/schema.ts`.** Step 2 adds a column
  to `articles`, a table, a contract method and a whole new store. This is not a change to make
  around somebody — **talk to that work's owner first**. If the migration is close to landing, step 2
  should wait for it rather than race it.
- **`profileHash` belongs on `StepStamp`** ([`src/store/artifacts.ts:117`](../../src/store/artifacts.ts)),
  as its **fifth** field, not beside it. Two things follow that the first draft missed: `sameStamp`
  only compares keys the caller *declares*, so "no profile" has to be declared as
  `profileHash: null` rather than omitted; and the filesystem adapter reads only `sourceHash`,
  `version` and `generator` today ([`src/store/artifacts-fs.ts:332`](../../src/store/artifacts-fs.ts)),
  so both the read and write paths need extending or the recorded hash is always `undefined` and a
  glossary tops up for ever.
- **`src/web/SummaryPanel.tsx` is being edited by someone else.** Commit narrowly, by pathspec, per
  `CLAUDE.md`.

## What is still open

- **No evidence it helps.** The same criticism [summaries.md](../project/summaries.md) already
  levels at itself. Step 8 is the cheapest answer available and it is not a strong one.
- **Three overlapping free-text boxes about intent**, kept over a review that said to cut one. If
  the per-article box goes unused, **delete it** — do not leave it as furniture, and do not wait for
  evidence this app has no way of gathering. The check is Greg noticing, and
  [The second box](#the-second-box-was-argued-against-and-kept-anyway) is where the argument for
  cutting it is already written down so nobody has to make it again.

- **One typo fix in the global box marks every artefact in the library stale at once.** Hash
  equality has no notion of a trivial edit. Probably fine — stale is a *sentence*, not a
  regeneration, and nothing regenerates on its own — but it will look like something broke the first
  time it happens to a shelf with thirty articles on it. Say it in the tooltip. If it turns out to
  be intolerable, the fix is not fuzzy hashing (there is no such thing that is honest); it is a
  "mark everything current" button, which is its own small design problem.
- **What the stale line says right after a profile is cleared.** The toggle disappears (no profile),
  the artefacts hold hashes, and `profile` staleness is defined against "the current one" — which is
  now nothing. Decision: clearing the profile does **not** make anything stale. You did not change
  what you want from the article; you stopped telling us. It is the same argument as `null` never
  being stale.
- **Two tabs.** Nothing here handles a second tab editing the global profile. Last write wins, which
  is what `shelf.json` already does, and saying so is better than pretending otherwise.
- **Nothing here is multi-user.** One reader, one profile, which is what
  [auth.md](../project/auth.md) says this app is. It becomes a row keyed by owner when accounts do —
  which is why step 2's Postgres half is keyed by `owner_id` from the start.
