---
reports: spya-furs26
ending: shipped
comment: Chats now pick the clearest example rather than one from your job by default; your field is still used where it is clearest, or when you ask. Measured: forced examples fell from about 10 in 27 replies to 0–1.
---
# Chat picks the clearest example, not your field by default

Admin report from Greg (`feedback-reporter.ts` exit 0, no addenda), #699, Sentry event
`5cbfb0d5d0c847ad9c13b18a8a2810a0`, filed from a block chat (`spya-ypk02m`) on *Consciousness in
Artificial Intelligence* (`arxiv-2308-08708-spya-xax6v4`):

> It's nice how the chat seems to take into account my background in the examples that they
> choose, but perhaps we can make a minimal update so that they don't do that too much. There may be
> a simpler or better analogy that doesn't involve my specific background, and it would be a shame
> if they are too iterated to choosing analogies and examples or whatever based on my background
> etc.
>
> — Greg, 2026-10-24 17:12 UTC (`spya-furs26`)

His thread: asked to help him understand a paragraph on the report confound, the reply (Opus 5.5)
offered *"you're hunting the code path that causes a bug, but you only compare runs that wrote a log
line"*, built from the "CTO" in his profile. Nothing in the prompt asked for that; the model read
"pitched to who they are" as "built from who they are".

**Ending: shipped**, on `dev`. Two small parts, both conversations only (Chat, Recall, Explore, the
guide):

- One sentence on `CHAT_PRINCIPLES`' pitch bullet (src/chat-principles.ts): choose the clearest
  example or analogy; their job or field can make one clearer, but is not by itself a reason to use
  it, and a plain everyday one often works as well or better. Worded so the field is still allowed,
  since Greg likes it when it fits.
- Its echo beside the profile, two lines (`withExampleReminder`, src/converse.ts). The sentence
  alone cut forced examples by about a third and missed the bar set before the run; with the echo
  they fell from 9–11 per 27 replies to 0–1, and blind preference went 22–3 and 16–9 against a 13–12
  control. `profileSection` itself, which summaries, glossary, quotes and others share, is untouched.

Field examples stayed where they fit: an anaesthetist still got clinical cases, a teacher who asked
for classroom terms got them, a "?" press still got an analogy, and Explore still tried the piece on
the reader's own project. Greg's own turn was replayed on his article: it rarely used an analogy in
any arm, so his case could not show the fall; the lawyer, chef, nurse and plumber cases did. Plan
[261024v](../plans/261024v-chat-picks-the-clearest-example-not-the-reader-s-field.md), measurement
[261024e](../investigations/261024e-chat-examples-not-the-reader-s-field-measured.md), reviewed by
GPT Sol at plan and code.

**Consistent with the expert half of `spya-bq9wv5`** (Overseer `qi-jq3tckr5`, still a proposal):
both say the profile is a hint about pitch, not a licence to tailor everything to it. This change
does not touch `PROFILE_RULES` ("Assume the background they claim"), which that item is about, so
it stays Greg's to authorise. Live's spoken prompts carry neither the principles nor this, as
before.
