# The privacy page names all AI processing, not three modes

**Status: done, 2026-09-29.** Parent: [privacy.md](../project/privacy.md).

> In /privacy, I noticed it said something like "To make the summaries, answers and diagrams...".
> This was written ages ago when we only had those 3 modes. Please update/generalise to refer to all
> AI-related processing (perhaps with those as examples), and anywhere else that needs updating.
>
> — Greg, 2026-09-29

## What changed

Five sentences that described what the AI does using the product's older, much smaller set of
features:

- `/privacy`, the short version: *"To make the summaries, answers and diagrams, we send the article
  and your questions to AI providers"* now names examples across the product and says the provider
  receives what each feature needs. That is usually the article, and sometimes what the reader gives
  it, "such as a question, a quiz answer or your profile" — examples, not a list. The draft's "whatever you ask or
  write" went because it would also have covered ordinary notes, comments and highlights, which do
  not go to a model merely because the reader wrote them.
- `/privacy`, *What the models make for you*: adds stored quotes, timelines, quiz questions and saved
  search results. It says these are examples rather than implying that every model response is
  stored. "Search indexes" went: Postgres makes the stored full-text index without a model, and the
  model-made embedding vectors are held in memory rather than stored. `LAST_UPDATED` moves to 29
  September 2026.
- `/features`, the confidentiality line: *"to make the notes and summaries"* now says providers
  prepare the article and make features such as summaries and the glossary. The AI does not make
  notes, and not every AI call receives the article.
- `/features`, the reader-profile tile: *"the notes are written for you"* now says "what the AI writes
  is written for you". Notes are the reader's own.
- `/features/public-readable-sharing`, *What the AI adds*: adds quotes and "and more". A shared link
  does carry the owner's stored Quotes when they exist, along with other modes that
  `shared-inventory.ts` places in its shared column. The next sentence now distinguishes the
  model-written additions from the author's verbatim quotes, which the model only chooses.

GPT Sol reviewed the diff against the code and corrected four of the first draft's claims (the
search index, "whatever you write", quotes contradicting "not quotations", and the stale notes tile);
"your notes are not sent" was drafted and taken out again, because a new negative promise is
exactly what this change was not meant to make.

Every example was checked against `MODES` in `src/modes.ts`, the jobs in `src/models.ts`, the model
call paths and the Postgres columns that keep the result.

## Not a change to what we promise

Nothing new is sent, kept or shared; the practices are the same, the lists are just no longer
short. The provider paragraph was already right — OpenRouter for every call bar one, the live voice
mode straight to OpenAI ([ai-gateway.md](../project/ai-gateway.md)) — and is untouched. So no
approval round, per the brief.

**The simpler option passed over**: appending mode names to the old sentence. It would go stale
again with the next mode; "and the rest" with a few examples does not.
