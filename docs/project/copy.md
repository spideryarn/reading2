# Copy

The words the reader sees, and the rules they follow. Mostly this is about
**error messages**, because those are where writing badly costs the most: an
empty state that reads oddly is a shrug, but a failure the reader misreads sends
them off doing the wrong thing.

The messages themselves live in one file — [`src/messages.ts`](../../src/messages.ts) — and
nowhere else.

**Its siblings are [website-text.md](website-text.md) and [privacy.md](privacy.md)**, and the split
is the reader's situation rather than the subject: this file is what somebody is told when something
goes wrong *while they are doing something*; those are what somebody is told when they come
looking — the landing page, the address they write to, and what we do with their data.

## Who is reading this

Someone who came here to read an article. They did not come to operate an AI
application, they are not necessarily technical, and they have no idea what
sits behind the button they pressed. That is the whole design constraint.

It follows from [vision.md](vision.md): a tool that *augments* reading has to be
legible to the person reading. A message that only a developer can act on has
handed them a problem they cannot hold.

## The four rules

**1. Say what happened, in words that assume nothing.**

> The AI service is busy right now.

not

> OpenRouter 429: rate limit exceeded

An HTTP status is not an explanation. Neither is a provider's name the reader has
never heard of, so **failures call it "the AI service"** — which company is
answering is our business and not theirs.

Note the limit of that rule, because an earlier draft of this line said
"throughout" and that was not true even on the day it was written: the *waiting*
copy says "the whole piece goes to the model". Two nouns for the same thing, and
nobody has decided which. Failures are the half that is settled.

**2. Say whose problem it is.** This is the rule that earns its keep, and the one
`messages.ts` encodes as a type. There are four kinds:

| Kind | Means | The reader should |
|---|---|---|
| `retry` | transient — busy, slow, a blip | try again |
| `ours` | this app's account or configuration — no credit, bad key | stop, and tell somebody |
| `bug` | a defect here | stop, and tell somebody |
| `blocked` | the service refused *this request* and will refuse it again unchanged — a safety filter, a size limit | ask for less, or accept the no |

`blocked` was added on 2026-08-26, after review found 403 being reported as a
broken API key. It is worth having as its own kind rather than folded into
`ours`, because it is the only one of the three non-retryable kinds where **the
reader can still get an answer** — by asking about a shorter stretch, or a
narrower question. Nothing is misconfigured and nothing is broken.

Its messages share a sentence pattern worth copying, because it states the
futility and the way out in one breath:

> Asking the same thing again will most likely get the same refusal; asking
> something narrower sometimes gets through.

Note the hedge. "Will get the same answer" is false for the one `blocked` case
that resets on its own — a spend limit at midnight — and a message that is wrong
by tomorrow morning is worse than one that is vaguer today.

Getting this wrong in the `ours` direction is the expensive mistake: **telling
someone to try again when retrying cannot possibly work**, so they do it, four or
five times, and conclude the app is broken rather than that it needs topping up.
Every message says which kind it is in plain words — *"trying again will not
help"*, *"nothing you can do from here"*, *"that is a bug in this app"*.

**3. Say what to do next**, when there is anything to do. "Waiting a few seconds
and trying again usually works" is better than "try again", because it says how
long and sets the expectation that it will probably work. Where the answer is
"nothing", say that too — it is information.

**4. Never repeat what the provider said.** Its error body is the one place an
upstream might echo the article back at us, so it does not reach the reader and
it does not reach a log. The full account is in
[logging.md](logging.md) and at `providerRefused` in
[`src/openrouter-stream.ts`](../../src/openrouter-stream.ts). This is a
**privacy rule, not a style rule**, and it is the reason none of these messages
can simply pass the upstream's own explanation through.

## The bracketed code

Every message ends with a short code in square brackets: `[ai-busy]`,
`[ai-no-credit]`, `[ai-stalled]`.

It is **last** so a reader who does not want it can stop at the full stop, and
**bracketed** so it reads as a reference rather than as part of the sentence. It
exists so that a person reporting a problem can quote a handful of characters
instead of paraphrasing a sentence, and so that whoever is helping them can find
the exact branch without guessing.

**The interface reads it too, and that is newer than the rest of this section.**
`kindOfMessage` in [`src/messages.ts`](../../src/messages.ts) recovers the
`kind` from the code, and `worthRetrying` uses it to decide whether to offer the
reader another go. So the code is no longer only a support reference — it is
parsed. That widening is deliberate and it is what makes the stability rule
below load-bearing rather than merely polite: renaming a code now changes which
buttons appear under errors already stored on disk.

The ingest queue reads it too, as a **fallback only**. A job is a struct, so it
carries a `failureKind` field of its own rather than a code parsed out of a
sentence — see
[ingest-queue.md § The failures Retry is not offered under](ingest-queue.md#the-failures-retry-is-not-offered-under).
The code is what `failureKindOf` ([`src/job-failure.ts`](../../src/job-failure.ts))
falls back to for a failure thrown by the model-call layer, which is the layer
with nowhere else to put it.

**Tests match on the code, not the prose.** That is the other reason it exists:
copy should be freely rewritable without turning a test suite red, and a test
that pins a sentence quietly makes the sentence permanent. If you are writing a
test about a failure, match `/\[ai-stalled\]/`.

**The prefix says which thing failed.** `ai-` is a model call. `mic-` is
dictation — the microphone, the recorder, or the transcription round trip; see
[dictation.md](dictation.md). `db-` is this app's own database, and there are two
of them: `[db-busy]` for a connection that
dropped or a deadlock that lost, `[db-failed]` for a database that answered "no"
and will answer "no" again. A reader quoting four characters, and whoever they
quote them to, can tell those apart without looking anything up — which was the
argument for not folding a failed write in with `[ai-unexpected]`.

**The `mic-` family is the exception to the paragraph after next**, and worth
knowing about before you go looking for it in `src/messages.ts`: it is not there.
Those sentences live beside the code that raises them —
[`dictation-errors.ts`](../../src/web/dictation-errors.ts) for what the browser's
recogniser reports, [`useDictation.ts`](../../src/web/useDictation.ts) and
[`dictation-upload.ts`](../../src/web/dictation-upload.ts) for the rest — because
`src/messages.ts` is about **failures a model call can return**, and most of
these are not that. A blocked microphone permission, a headset unplugged mid
sentence and a recorder that hit its cap have nothing to do with a model and
nothing to say to `worthRetrying`. What they take from this section is the part
that is about the reader: a code, last, in brackets, so somebody can quote four
characters. Added 2026-08-27 with the two-pass rewrite, when they were the one
family of reader-facing messages in the app without one.

**The import-state sentences are the second exception**, and they differ from the
`mic-` family in the one way that matters: they carry **no bracketed code at
all**. They live in [`src/job-state.ts`](../../src/job-state.ts) —
`WAITING_TO_CONTINUE`, `TAKING_LONGER`, `STOPPING_AFTER_STEP`, `KEEP_A_TAB_OPEN`,
`DRIVER_STALLED`, `RUNNING_A_WHILE` and `STEP_USUALLY_A_COUPLE_OF_MINUTES` — beside `displayJob`,
which is the one place that decides what state an import is in.

Not in `src/messages.ts` for the same reason as the `mic-` family: that file is
about **failures a model call can return**, and *"Waiting to continue."* is not a
failure. Nor is a step being slow, nor a Stop that is waiting for a step to
finish. They have nothing to say to `worthRetrying`.

And no codes, which is the part worth arguing rather than copying. A code exists
so somebody can quote four characters when reporting a problem. **None of these
is a problem** — they are an import doing exactly what an import does, described
honestly while the reader waits. A code on *"This step has been
running for a while"* would invite a bug report about a step that is working. The failures an
import can have already have codes, and they come from `src/messages.ts` through
`failureKind` as they always did.

**There was a `ARTICLE_IS_BUSY` in that family and it is worth saying why it went**, because the
argument it was used to test is still the argument. It was the 409 you got for asking for work on an
article that already had a job in flight — the first of the family the *server* raised, and the first
that was a refusal — and it carried no code, on the reasoning that **a 409 there was an answer, not a
fault**: the reader asked for something, the reply said why not and put a Stop button beside the job
in the way, and a code would have invited a bug report about the system working.

The refusal is gone. A second, different job on one article is queued now rather than turned away
([ingest-queue.md](ingest-queue.md)), so the sentence has nothing to be about and was deleted with
it on 2026-09-02, along with `WORKING_ON_THIS_ARTICLE`, the label its band borrowed. What survives is
the rule: **a refusal that is an answer gets no code**, and a server sentence says nothing about
*state* — the old one said "already running" of a job that might be idle in `queued`, and the client
has the job itself, so `displayJob` says *Building the hierarchy · 2m 14s* or *Waiting to continue.*
live, from the one vocabulary. A state word baked into a server sentence is a second account, and it
arrives stale.

The `db-` pair also marks the **second widening of `src/messages.ts`**, after
`UNEXPECTED_FAILURE`: these sentences exist because a failed Drizzle query puts
every bound parameter into `Error.message`, and the bound parameters are the
reader's quote and the model's answer. Rule 4 above, arriving from a direction
nobody was watching — the provider whose words must not be repeated turned out
to include the database. See
[260826p-error-boundary.md](../plans/260826p-error-boundary.md) and
[`src/store/db-errors.ts`](../../src/store/db-errors.ts).

**A code names a branch, not a status.** 500, 502 and 503 all answer to
`[ai-upstream]`, because there is one thing to say about all three. What must
never happen is two *different* sentences sharing a code, which
[`tests/messages.test.ts`](../../tests/messages.test.ts) checks.

Codes are stable once shipped. Reword the sentence as often as you like; changing
the code orphans every support conversation that quoted it.

## Writing a new one

Add it to `src/messages.ts`, give it a `kind`, give it a code, and then **two
steps that are not optional**. The first has a failure with no symptom; the
second had one until 2026-09-04 and is now a red compile:

1. **Register the code in `CODE_KINDS`.** Miss it and `kindOfMessage` returns
   null, `worthRetrying` says yes, and a permanent failure quietly grows a Retry
   button.
2. **If it is a *factory* — a function that takes an argument — add it to
   `FROM_FACTORIES` in [`tests/messages.test.ts`](../../tests/messages.test.ts),
   with arguments that reach each branch.** Miss the entry and `npm run
   typecheck` goes red: `FROM_FACTORIES` is keyed by `FactoryName`, a mapped
   type over the module's own exports, so a forgotten factory is a missing key
   rather than — as until 2026-09-04, when `placingFailed` had never been
   through a single invariant — a message that quietly skips every invariant in
   that file. What no type can check is the **arguments**: too few and a branch
   goes untested with nothing to say so, which is why each entry's comment names
   the branches it reaches. An exported `const` needs nothing: those are
   collected out of the module by `Object.values`, which is the half of this
   that used to be hand-maintained and is not any more.

Those two lists check each other — the test asserts the table's keys are exactly
the codes the messages carry — so doing one and forgetting the other is a red
test rather than a silent gap. Doing neither is not.

Then check it against the four rules. Two habits worth having:

- **Read it aloud as the reader.** "The AI service rejected this request as
  malformed" passes; "Request validation failed" does not.
- **Ask what they will do next.** If you cannot answer that, the message is not
  finished.

Avoid: "Oops", "Something went wrong" (says nothing), "Please try again later"
(how much later?), exclamation marks, and apologising. A failure that explains
itself does not need to apologise.

## The seam between the two audiences

A pipeline step's failure has two readers and they want different sentences.
Until 2026-09-03 it had one string for both, and that string was
`Error.message`: [`src/jobs.ts`](../../src/jobs.ts) copied it onto `step.error`
and `job.error`, which are persisted, read back unchanged, and rendered — the
job's on the band ([`JobProgress.tsx`](../../src/web/JobProgress.tsx)), the
step's on the shelf card ([`AddArticle.tsx`](../../src/web/AddArticle.tsx)).

**Whatever a step happened to put in an exception was published.** That is not a
risk, it is a count: six pipeline stages threw `Model refused: ${…stop_details}`
until 2026-08-26 (`MODEL_REFUSED` in [`src/messages.ts`](../../src/messages.ts));
`truncatedMessage` in [`src/token-budget.ts`](../../src/token-budget.ts) put two
token figures and *"see src/token-budget.ts"* on a reader's screen, and was
recorded here as *"the same string has two audiences"* and left; and on
2026-09-03 the quiz showed Greg a source-file reference and an instruction
addressed to whoever tunes its prompt. Three write-ups, one shape.

So the seam is split rather than the sentences reworded:

- **`Error.message` is the diagnostic.** It goes to the log. It may carry
  arithmetic, a file reference, a section name. It is still held to
  [logging.md](logging.md) — *safe to log* is not *anything at all*, and a
  provider's error body is out on both counts.
- **A `ReaderFacingFailure` is the reader's**, declared at the throw site with
  `stageFailure(failure, detail)` ([`src/job-failure.ts`](../../src/job-failure.ts)),
  and it is the only thing `src/jobs.ts` persists — from the step catch, from a
  refused publication, and from a run the reader stopped.
- **Anything undeclared gets generic copy** — `stepGaveUp` in `src/messages.ts`,
  one sentence per `FailureKind`, naming the step and nothing else. An allowlist
  of trusted steps was rejected: one new `throw` inside an approved step leaks
  immediately and nothing goes red. Type-level enforcement is not available at
  all — TypeScript has no checked throws, so `PipelineStep.run()` cannot
  constrain what comes through it.

The cost is real and was accepted knowingly: **an unmigrated failure says less
than its diagnostic did.** That is temporary and recoverable; publishing an
unaudited internal string is neither. Migrate a failure by declaring it, which
is one line at the throw site — and prefer the shared constructors, where one
line covers ten stages (`anthropicCallFailed`, `truncationFailure`).

There is a **second cost, and it is not the reader's**: a diagnostic reaches the
log and **not Sentry**. `authored` in
[`src/monitoring-scrub.ts`](../../src/monitoring-scrub.ts) forwards a message
only when it ends in a registered code, because a code is the one proof
available that we wrote every word — and a diagnostic is free text a step wrote.
The event still arrives with its exception name, its frames and a
`message_withheld` marker; the sentence does not.

**The tempting fix is the one that must not be taken.** Appending the reader
sentence's code to *every* diagnostic so it looks authored was in the tree for
six hours on 2026-09-03, and it lets *any* text buy that proof —
`stageFailure(MODEL_REFUSED, "<a stretch of the article>")` arrived at Sentry
intact. Found by GPT Sol, reproduced, and now pinned by a test that drives
`sanitise` itself.

**The channel that is allowed is an explicit claim**, not a suffix: a second
form of the argument, `stageFailure(failure, { authored: "…" })`, in which the
throw site says it wrote every character and none of it arrived from a provider,
a document or a reader. The code goes on and the sentence travels. Two places
have earned it — `anthropicCallFailed`, whose diagnostic is a fixed sentence and
a status the SDK handed over as a number, and the ten `MODEL_REFUSED` throw
sites — and there the split costs nothing. It is one word so that grepping
`authored:` returns every claim ever made; what it must never wrap is an
interpolation of anything from outside.

**The kind-only form makes the mirror-image claim**, and for the mirror-image
reason. `stageFailure(kind, { generic: "…" })` is a throw site saying *I know
the reader gets `stepGaveUp`'s copy here, and that is correct* — CLI misuse, a
broken invariant, a step run out of order, nothing true and useful to tell a
reader. It replaced a bare second string on 2026-09-04, after **eight throw
sites wrote a reader a real sentence and used the form that keeps only the
kind** — a 142-page PDF refused for its length among them
([260903k](../plans/260903k-pdf-page-cap-refused-with-no-reason-given.md)). The
compiler now refuses the bare string, so whoever writes the throw has to say
which audience they meant. It narrows the class rather than closing it: a bare
`throw new Error("…")` written for a reader still arrives as the generic
sentence, and no type can tell that string from a diagnostic.

That code is not only about Sentry. `tests/stop-details.test.ts` reads it off
the **log** line, because absence proves nothing on its own: a stage that died
before it ever reached a model contains no sentinel either, and the code is what
tells the two apart.

`tests/step-failure-seam.test.ts` is the guard. It inspects **both** persisted
fields — the band and the card deliberately render different ones — reads them
back off the file the queue wrote rather than off an in-memory clone, and covers
the two writers of `job.error` that are not the step catch: a refused
publication, and a run the reader stopped.

**A run the reader stopped and a run that ran out of time are two of those, not
one**, and telling them apart is the same rule as rule 2 — say whose it is. Stop
and the claimant's own 740 s deadline abort the *same* signal, so until
2026-09-04 an overrun was shown *"You stopped this before it finished"* to
somebody who had pressed nothing, watched happening on a 144-page PDF. The
deadline case says `INTERRUPTED` (`[jb-gone]`) now, on both fields; the
distinguishing fact is a typed abort reason rather than a matched sentence,
because copy stays freely rewritable and a message match would quietly stop
working when somebody rewrote one — [`src/jobs.ts`](../../src/jobs.ts) §
`DeadlineReached`.

## What this does not cover yet

**One near-miss first**, because it is the kind of thing this section exists to
stop being invisible: `"Couldn't start the job."` lives in `Tweets.tsx`,
`useGlossary.ts` and `useSummaries.ts`, three times over. It is a failure
message the reader sees, so by the rule above it belongs here — it says nothing
about what happened, nothing about whose problem it is, and has no code. It has
not moved yet.

Otherwise: only the model-call failures are written down here. The rest of the interface —
empty states, button labels, the panel headings — is still written wherever it is
used, and has not been through this. That is a gap rather than a decision; when
somebody rewrites a batch of it, the messages should move here too.

**One batch has moved, and it is worth knowing the shape it took.** The sharing inventory —
`ALWAYS_SHARED`, `NEVER_SHARED`, `OWNER_MODE_NOTE` and the three headings in
[`src/messages.ts`](../../src/messages.ts) — is a *table* of sentences rather than a sentence, and
none of them carries a code because none of them is a failure. The rule they keep instead is that
**a note describes what a thing is and never which list it is in**: which bucket a mode lands in is
decided by `sharedInventory` sweeping `visitorGap`
([shared-inventory.ts](../../src/web/shared-inventory.ts)), and a sentence that also claimed the
bucket would be a second answer in a file that cannot see it. Timeline is the live case — it is
withheld today and Greg has said he would like it public-readable — and when it moves, its row moves
and its wording does not.

Nothing here is about tone in the *documentation*, which is
[AGENTS.md § How we write docs here](../../AGENTS.md).

## See also

- [`src/messages.ts`](../../src/messages.ts) — every sentence, and the `kind` on each
- [logging.md](logging.md) — why the provider's own words reach neither the reader nor a log
- [vision.md](vision.md) — who this is for
