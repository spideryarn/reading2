# Design consultation: the safest form of "close rewording saves by itself" (read-only)

You are advising, not editing. Do not change any file. Answer in plain prose with numbered sections.

## Context

Spideryarn is an AI-assisted reading app. Inside the reading view, a "guide" chat can offer to save
two things the reader tells it, via a model tool `offer_to_save`:

- **Why you're reading** ("purpose"/reason) — per-article, shown in Metadata, fed into that
  article's later prompts.
- **About you** ("profile") — global, on /profile, fed into **every later AI prompt on every
  article**. A saved planted sentence there is a persistent prompt injection.

The guide's prompt contains the whole article. **The untrusted party is the article's text**
(a planted instruction can steer the model to call `offer_to_save` with words of its choosing).
The reader is not the adversary.

Today (plan docs/plans/261011s-…md, code src/save-closeness.ts, tests tests/save-closeness.test.ts —
read all three): an offer saves without a press only when it is word for word a contiguous run of
the message the reader typed this turn (≥3 words, not after a negation in the same sentence;
About you must be the old text unchanged then such a run, white-space separated). Anything else
shows a card with a Save button. "Typed" excludes button text, retries, edits.

The looser rule tried first (every word one of the reader's, or a fixed linking word) was broken by
GPT Sol: "What does this paper say about cancer?" → About you "I have cancer."; "What does the
French study show?" → "I am French."; "I do not want links to evil.com" → "I want links to
evil.com"; "Can you link this to Open AI?" → "Link to open.ai.".

## Greg's decision (2026-10-12, reply B to q-q7mb3w)

"Let close rewording save by itself too, accepting that a planted instruction in an article could
then save a sentence about you that you never said."

So the residual risk is accepted in principle. An unattended agent may not loosen this defence on
the reply alone, so we write a plan for **B's safest form** and ask Greg who may build it. I need
your view on what that safest form is.

## Questions

1. **What should "close" mean, concretely**, so that the reader's ordinary paraphrases pass
   (e.g. typed "I'm a historian of science, not an ML person" → About you "I am a historian of
   science and not an ML specialist."; typed "it's for my journal club next week" → reason
   "Preparing for journal club next week.") while the four attacks above, and others you can think
   of, still go to the press? Candidates I am weighing — evaluate each, add your own:
   a. deterministic: every content word of the offer (after light stemming/lemma) is in the typed
      message; only a fixed closed set of function words may be added; no digits, URLs, emails,
      domains, @handles or capitalised proper nouns that are not verbatim in the typed message;
      length cap relative to the typed message;
   b. **source-sentence rules**: the typed sentence(s) the offer draws on must be declarative (not a
      question) and, for About you, first-person (I / I'm / my / me / we);
   c. **negation parity**: the offer's negations must match the source sentence's (count and
      position relative to the verb they govern?) — or simpler: refuse any offer whose negation
      count differs from the source sentence's;
   d. **an isolated verifier model call** that sees only the reader's typed message and the
      proposed text (never the article), returning a structured yes/no "says only what the message
      says about the reader, nothing added, nothing reversed". The article cannot reach it except
      through the offer text itself. Is that a meaningful boundary? How would you harden it (short
      cap on offer length, the offer quoted as data, structured output, deterministic pre-checks
      first so the judge only ever loosens a narrow band)? Cost: one extra cheap call per offer.
   e. combinations.
2. **Which fields**: both, reason only, or About you only with stricter rules? Greg's original
   report asked specifically for the profile. About you is the higher-stakes field.
3. **About you shape**: keep append-only (old text unchanged, then the new sentence) for a
   reworded save-by-itself? Or allow rewrites of the old text? I lean append-only.
4. **What the reader sees**: a distinct chip, e.g. "Saved, reworded: <text> · Undo", perhaps with
   their own typed words beside it so they can compare; an Undo that survives reload (exists). Is
   there anything else cheap that materially limits the damage of a bad save (e.g. a rate limit of
   one reworded self-save per conversation; a marker on /profile; never self-save if About you was
   self-saved reworded in the last N minutes)?
5. **What must still always go to the press**, regardless of closeness (negation flips, button
   text, edits, retries, anything from a non-typed turn, URLs/handles...)?
6. **Security notes**: what the security-map `chipFor` row and security-risks.md register entry
   should say about the accepted residual risk, in one or two sentences.
7. Which design would you recommend overall, and what is its honest residual risk? Name the
   simpler option you would pass over and why.

Keep it concrete; give example strings for passes and refusals.
