# Copy

The words the reader sees, and the rules they follow. Mostly this is about
**error messages**, because those are where writing badly costs the most: an
empty state that reads oddly is a shrug, but a failure the reader misreads sends
them off doing the wrong thing.

The messages themselves live in one file — [`src/messages.ts`](../../src/messages.ts) — and
nowhere else.

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

**Tests match on the code, not the prose.** That is the other reason it exists:
copy should be freely rewritable without turning a test suite red, and a test
that pins a sentence quietly makes the sentence permanent. If you are writing a
test about a failure, match `/\[ai-stalled\]/`.

**A code names a branch, not a status.** 500, 502 and 503 all answer to
`[ai-upstream]`, because there is one thing to say about all three. What must
never happen is two *different* sentences sharing a code, which
[`tests/messages.test.ts`](../../tests/messages.test.ts) checks.

Codes are stable once shipped. Reword the sentence as often as you like; changing
the code orphans every support conversation that quoted it.

## Writing a new one

Add it to `src/messages.ts`, give it a `kind`, give it a code, and then **two
steps that are not optional**, because each has a failure with no symptom:

1. **Register the code in `CODE_KINDS`.** Miss it and `kindOfMessage` returns
   null, `worthRetrying` says yes, and a permanent failure quietly grows a Retry
   button.
2. **Add the failure to `EVERY` in [`tests/messages.test.ts`](../../tests/messages.test.ts).**
   Miss it and your message skips every invariant in that file.

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

Nothing here is about tone in the *documentation*, which is
[AGENTS.md § How we write docs here](../../AGENTS.md).

## See also

- [`src/messages.ts`](../../src/messages.ts) — every sentence, and the `kind` on each
- [logging.md](logging.md) — why the provider's own words reach neither the reader nor a log
- [vision.md](vision.md) — who this is for
