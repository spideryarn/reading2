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
never heard of — this app calls it "the AI service" throughout, because which
company is answering is our business and not theirs.

**2. Say whose problem it is.** This is the rule that earns its keep, and the one
`messages.ts` encodes as a type. There are exactly three kinds:

| Kind | Means | The reader should |
|---|---|---|
| `retry` | transient — busy, slow, a blip | try again |
| `ours` | this app's account or configuration — no credit, bad key | stop, and tell somebody |
| `bug` | a defect here | stop, and tell somebody |

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
exists so that a person reporting a problem can quote four characters instead of
paraphrasing a sentence, and so that whoever is helping them can find the exact
branch without guessing.

**Tests match on the code, not the prose.** That is the other reason it exists:
copy should be freely rewritable without turning a test suite red, and a test
that pins a sentence quietly makes the sentence permanent. If you are writing a
test about a failure, match `/\[ai-stalled\]/`.

Codes are stable once shipped. Reword the sentence as often as you like; changing
the code orphans every support conversation that quoted it.

## Writing a new one

Add it to `src/messages.ts`, give it a `kind`, give it a code, and check it
against the four rules. Two habits worth having:

- **Read it aloud as the reader.** "The AI service rejected this request as
  malformed" passes; "Request validation failed" does not.
- **Ask what they will do next.** If you cannot answer that, the message is not
  finished.

Avoid: "Oops", "Something went wrong" (says nothing), "Please try again later"
(how much later?), exclamation marks, and apologising. A failure that explains
itself does not need to apologise.

## What this does not cover yet

Only the model-call failures are written down here. The rest of the interface —
empty states, button labels, the panel headings — is still written wherever it is
used, and has not been through this. That is a gap rather than a decision; when
somebody rewrites a batch of it, the messages should move here too.

Nothing here is about tone in the *documentation*, which is
[AGENTS.md § How we write docs here](../../AGENTS.md).

## See also

- [`src/messages.ts`](../../src/messages.ts) — every sentence, and the `kind` on each
- [logging.md](logging.md) — why the provider's own words reach neither the reader nor a log
- [vision.md](vision.md) — who this is for
