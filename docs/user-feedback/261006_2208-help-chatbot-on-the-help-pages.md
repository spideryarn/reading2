---
reports: spya-ucftjt
ending: shipped
parts: 3
comment: Part 2 of 3 shipped for signed-in readers: Ask about Spideryarn on every Help page. Waiting on you: may people who are not signed in use it too? Part 3, the guide, is its own entry.
---
# Ask about Spideryarn: a chatbot on the Help pages

SPIDERYARN-READING2-E9, from Greg (admin, proven by `scripts/feedback-reporter.ts` on the production
row), a suggestion, filed 2026-10-06 22:08 UTC on production from the reading view. **Part 2 of 3**,
Overseer queue item `qi-e6ksaejb`. Part 1 (`qi-pvded3hd`, the Help as pages) has its own note,
[261006_2208-help-back-in-the-bar-and-help-as-pages.md](261006_2208-help-back-in-the-bar-and-help-as-pages.md);
part 3 (`qi-gjvvvc6n`, the guide) has its own session and note.

The words this part covers:

> For a lot of extra points, I think it would be great if the help page had some kind of LLM chatbot
> that would be free, I think, to use because it would be, you know, it'd have a prompt that says,
> look, your only job is to answer questions about how Spideryarn works. And so maybe it can do that
> based on the help page alone. My hunch is that you might want to give it, I don't know, could it
> have access to the Spideryarn codebase via web search or curl or something like that? Presumably,
> yeah, presumably it could read the raw .md. files in docs project. […] But if anything else, it
> would kind of know, like, Hang on, yeah, that's not what I'm here for. […] the help page agent
> really, it can work for non-logged-in users, and it's available for non-logged-in users, which is
> one of the reasons why you have to make sure that it can't be abused in other ways. Probably the
> help page agent uses a much dumber model, so it's cheaper, and the help page agent can only answer
> questions about Spideryarn functionality

**Ending: Shipped, signed in; the signed-out half awaits Greg.** On `dev`. Plan
[261007k](../plans/261007k-help-chatbot.md); measurements in
[investigation 261007a](../investigations/261007a-help-chat-model-and-refusals.md).

- **A box on every Help page**, *Ask about Spideryarn*: in the sidebar on a page, under the search
  on `/help`. One question at a time, answered in a second or two, streamed, from the Help pages
  only, with links to the page the answer came from. Off-topic questions get one sentence saying
  that is not what it is for.
- **Free**: no article slot. Bounded by its own allowance: 30 an hour and 100 a day a reader, one
  at a time, and 1,300 a day across everybody (about $10 on a day with nothing cached).
- **Cheap**: GPT-5.6 Luna. About $0.007 a cold question, $0.0006 warm; the Help pages stay cached
  across questions whoever asks. In 24 test questions it declined every off-topic question and
  every attempt to make it do something else. Nothing is stored or logged.
- **Signed out, the box says "Sign in to ask a question about Spideryarn."** Opening it to strangers
  is the first request on the site that lets somebody with no account spend money, and it edits the
  dispatch in front of the sign-in check, a listed defence. Asked as question
  [q-vvhb55](questions/q-vvhb55.md); queued as `qi-dk83dfn8`, waiting on the answer.
- **Not `docs/project/`**: it is 5.5 MB and written for us, naming every defence. Deferred with
  follow-up questions as `qi-zjvgstd7`.
- The guide (part 3) can carry the same Help pages: `qi-7cgxpdda` now points at the generated file.
