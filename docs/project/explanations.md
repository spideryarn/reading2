# Explanations — the places a reader would get stuck, explained beside the words

Up: [reading-view-overview.md](reading-view-overview.md).

A list of the few passages a reader is likely to find confusing, each with a short explanation of
**the missing piece**: the skipped step, the point of a move, the background the author assumes,
or the claim a tangled sentence hides. It lives in the margin first and in a mode of its own under
*More* second, because that is how Greg expects it to be used. Asked for by Greg (admin) through
the Feedback button, report spya-nkq6rj, 2026-10-28:

> if you can tell that a user is going to be confused by a paragraph, then perhaps you could flag
> it with an explanation, or at least have a button that makes it easy. I suppose it's already
> fairly easy to ask for an explanation. So actually what I'd love is if it did it proactively, in
> much the same way that the glossary is proactive. There's just a little underlying waiting for
> me.
>
> … And if Opus is unsure itself, it should say so. And there should be an option to sort of, you
> know, ask in chat for more information. I suppose it should be allowed to search the web if that
> will help, but it should be clear if some of its responses are based on stuff that came from out
> the article.
>
> … Model the UI for it on the glossary mode, and perhaps put it as a mode within the more three
> dots. Because I don't think users are going to want to use that mode directly. They're mostly
> going to benefit from it in the, in the marginalia, and probably that explanation mode should run
> automatically on for all new articles. And I guess you should take into account readers'
> backgrounds, etc.

The plan, with GPT Sol's review that reshaped it, is
[261028c](../plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md).
It is step 7 of [explain-this-vision.md](explain-this-vision.md), built smaller than that sketch.

## Where it stands (2026-10-28)

**Behind the [experimental switch](experimental-features.md), owner only, and run only when the
owner presses into the mode** — not on import, not when the margin opens. Two things move it:
Greg's answer to **q-gkrkf5** (on import, at about 10–15 cents an article, or later), and one live
run read by a person. Model calls could not be made when it was built (the key was over its monthly
limit until 1 November), so **nothing here has met a real answer yet**; the tests run on canned
ones. What waits for that is in the plan's § What waits for 1 November, and on the
[Overseer's queue](overseer-queue.md).

## What it is, and what it is not

- **One capable call** (Sonnet, or Opus under [high-powered AI](high-powered-ai.md)) reads the
  article as the reader in [their profile](reader-profile.md) — or as a curious reader new to the
  field — picks the places and writes each explanation, at most 60 words. Greg suggested a Haiku
  pass to find the places and Opus to write; that shape has to beat the one call on real articles
  before it is built.
- **Not a lone term's meaning.** That is [Glossary](glossary.md)'s job, and the prompt says so.
- **Not a paraphrase.** The reader has the passage; the explanation says what is missing from it.
- **Two labels the model sets**, because nothing in code can check them: *Not sure* (and the text
  says what it is unsure of) and *Draws on AI memory, unchecked* (it used something not in the
  article — the margin's Origin notes' wording).
- **No web search** in the explanation itself; *Ask in chat* searches. Greg allowed search; it is
  left out until the live runs show whether the `outside` items need it, and q-gkrkf5 says so.
- **Ask in chat** opens the ordinary chat about a passage ([chat-from-a-mode.md](chat-from-a-mode.md)
  has the alternatives), with the quote and the explanation in its first question.

## The rules the code keeps

In `src/explanations.ts`, each tested in `tests/explanations.test.ts`:

- **Every quote is checked against its block** (`findQuote`, spaced, as [faq.md](faq.md)'s
  passages), the article's own characters stored, and **dropped if the words occur twice in the
  block**, so the underline still to come can always find the one meant. Overlong is dropped,
  never cut.
- **One per block; at most `clamp(ceil(paragraphs / 6), 3, 15)`**, applied after every other rule.
  The cap is what keeps a mark beside a passage worth trusting — explain-this-vision.md's worry
  about marking too much.
- **An empty list is an answer**; a non-empty one that the checks empty is a failure, as FAQ's.
- **Freshness is the ordinary stamp** (article fingerprint, prompt version, model, profile hash):
  *stale* is not drawn in the margin; *outdated* and *written for an older profile* stay, with
  *Write it again*.
- **Owner only**: never in the public read, never in a visitor's margin.

In the margin, a block with a fresh Explanation does not also draw the relations call's `explain`
note ([marginalia.md](marginalia.md)); whether those notes are now redundant is one of the things
the live runs decide.

## Not built yet

- **The underline in the prose** Greg asked for. It has to share the text with glossary underlines,
  citation marks, cross-references and comments, so it needs a design for who wins where, drawn
  against real explanations. Queued.
- A copy for visitors to a shared article; a chat thread of its own per explanation.
