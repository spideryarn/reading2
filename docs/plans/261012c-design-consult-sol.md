1. What “close” should mean

Keep the existing exact-quote route, then add a separate, deliberately narrow paraphrase route. “Close” should mean “one meaning-preserving restatement of one identifiable sentence from this typed turn,” not “mostly the same vocabulary.”

I recommend requiring all of these:

- The proposal draws from exactly one sentence in the current typed message. It cannot combine facts across sentences or turns.
- For About you, that sentence must directly assert something about the reader. Merely containing “I” or “my” is insufficient.
- For the reason, it must directly state why the reader is reading or how they intend to use this article. Questions do not qualify.
- The proposal is one plain-text sentence or, for the reason, one short purpose phrase: at least three words, at most 32 words or 240 characters, and no more than 1.5 times the source clause’s length.
- After conservative contraction expansion and lemmatisation, at least two content lemmas are shared; at least 70% of the proposal’s content lemmas and 50% of the source clause’s occur on both sides in the same order; and the proposal introduces at most one new content lemma.
- New names, acronyms, numbers or other identifiers are forbidden. Existing ones must be verbatim and retain the same role.
- Polarity, subject, object, attribution, tense, modality, quantity and time must remain unchanged.

That lexical envelope admits the intended examples:

- “I’m a historian of science, not an ML person.” → “I am a historian of science and not an ML specialist.”
- “It’s for my journal club next week.” → “Preparing for journal club next week.”

Candidate a is useful as a pre-check, but not as the decision. Requiring every content word to appear blocks both intended examples, while a fixed list containing words such as “I,” “am” or “have” recreates the cancer and French attacks. I would not use a “free linking words” list as a security rule.

Candidate b is essential, with stronger wording:

- About you: one direct, present assertion about the reader—not a question, quotation, hypothetical, conditional, reported claim or statement about somebody connected to them.
- Reason: one direct statement of purpose—not merely a topic they asked about.

Thus these refuse:

- “My patient has cancer.” → “I have cancer.”
- “I research cancer.” → “I have cancer.”
- “The paper claims that I am gullible.” → “I am gullible.”
- “If I were French…” → “I am French.”
- “I used to teach physics.” → “I teach physics.”
- “I might have cancer.” → “I have cancer.”

Candidate c needs more than counts. Equal negation counts can still reverse two claims:

- “I’m not a historian; I’m an ML person.” → “I’m a historian, not an ML person.”

Use deterministic equality of negation count and order as an early refusal, then require the verifier to confirm that each negation still governs the same predicate or attribute. The intended historian example passes because “not” remains attached to “ML person/specialist.”

Candidate d is a meaningful compartment boundary, but not a proof. The verifier does not see the article and cannot write anything itself; nevertheless, the proposal is still article-influenced attacker-controlled text and can attempt to manipulate the verifier.

Harden it as follows:

- Run deterministic checks first; most offers never reach the verifier.
- Give it only the field, numbered sentences from the current typed message, and the proposed addition—not the article, conversation history or existing profile.
- Prefer a different model family from the guide.
- Give it no tools and no write capability.
- Use low temperature and a strict schema: `allow`, exact source-sentence index, and booleans for same subject, relation, polarity, tense/modality, attribution, entities/numbers and no added fact.
- Validate the returned sentence index and accept only when every field is affirmative.
- Timeout, malformed output, refusal, ambiguity or multiple source sentences means press.
- Treat JSON quoting and “this is data” instructions as hygiene, not as an injection boundary.

The safest useful answer is therefore e: deterministic envelope plus an isolated semantic verifier.

2. Which fields

Use it for both fields, but asymmetrically.

The reason is per-article and lower impact. Close rewording may save by itself when the reason is currently empty. A rewording that would replace an existing reason should require the press; the exact-word route can retain its current behaviour.

About you should use every stricter rule above: direct self-assertion, one sentence, short cap, append-only, isolated verification and one reworded self-save per conversation. Supporting the reason only would avoid Greg’s profile-specific request; applying identical rules to both would ignore the profile’s cross-article blast radius.

3. About you shape

Keep it strictly append-only.

The old value should remain byte-for-byte unchanged, followed by a canonical separator and one standalone verified sentence. If the old value does not end cleanly enough for an independent sentence, require the press rather than allowing the addition to complete or modify it.

Any correction, deletion, normalisation, reordering or rewrite goes to the press. For example:

- Old: “I am a postdoc.”
- Typed: “I’m a professor now, not a postdoc.”
- Proposed: “I am a professor.”

That is a correction, not an append, so it requires confirmation.

4. What the reader should see

Use a distinct persistent card:

> Saved, reworded: I am a historian of science and not an ML specialist.  
> From your message: “I’m a historian of science, not an ML person.” · Undo

Store the exact source sentence and whether the route was `exact` or `reworded` with the offer, so that comparison and Undo survive reload.

Three inexpensive restrictions are worthwhile:

- At most one reworded self-save per field per conversation. Later offers show the button.
- Only perform a reworded self-save while the guide panel is mounted and the tab is visible; otherwise fall back to the button.
- Keep the short, single-sentence cap even when the verifier says yes.

A time cooldown has limited security value: one bad profile sentence is already sufficient. A marker on `/profile` would be useful, but only if backed by durable provenance that is cleared on edit or Undo. Do not insert marker text into the profile itself or implement an unreliable client-only marker.

5. What must always require the press

Regardless of apparent closeness:

- Button text, retries, edits, previous turns, non-typed turns or uncertain provenance.
- Questions, requests, imperatives, quotations, reported speech, hypotheticals and conditionals.
- Synthesis from more than one sentence.
- Any changed subject, referent, relationship, attribution, tense, modality, quantity or temporal status.
- Added, removed or moved negation.
- Any About you rewrite rather than a separate append.
- URLs, domains, email addresses, IP addresses and `@handles`, even when reconstructed from typed tokens.
- Code, markup, role labels such as `system:`, control characters or bidirectional text controls.
- Any changed digit, unit, proper noun or acronym. Unchanged numbers and names may pass only in the same semantic role.
- Multiple unrelated claims, excessive expansion, low lexical overlap, or any verifier uncertainty or failure.
- Meta-instructions about prompts, systems, rules, tools or ignoring instructions.

The original four attacks all therefore require the press. So do:

- “I want to understand vaccine hesitancy.” → “I am vaccine hesitant.”
- “I work with French researchers.” → “I am French.”
- “I no longer work in medicine.” → “I work in medicine.”
- “I have read about 10 trials.” → “I ran 10 trials.”

6. Security-note wording

For the `chipFor` row:

> Besides exact runs, one short rewording from one sentence of the current typed turn may save only after deterministic provenance, shape, sensitive-token and polarity checks plus an article-blind, no-tools verifier; About you keeps its old value unchanged and appends one standalone sentence. This is a fallible semantic check, not a provenance guarantee: Greg accepted the remaining article-to-profile risk on 2026-10-12.

For a new risk-register entry:

> R26 — A hostile article may steer the guide towards a false but superficially close About you sentence that the verifier approves, placing attacker-influenced text in every later prompt. Medium; accepted by Greg on 2026-10-12: “Let close rewording save by itself too, accepting that a planted instruction in an article could then save a sentence about you that you never said”; bounded by append-only short writes, deterministic checks, an isolated verifier, visible provenance, a per-conversation limit and Undo, while eliminating it requires exact words or a press.

“Medium” fits the register because exploitation must cross several gates and the individual write is bounded, although its global persistence should be stated prominently.

7. Overall recommendation and residual risk

Preserve the exact path and add a second path requiring the whole conjunction:

1. Current typed turn.
2. One eligible source sentence.
3. Narrow lexical and length envelope.
4. Protected polarity, modality, time, quantities and identifiers.
5. Field-specific semantic rules.
6. Article-blind verifier.
7. Append-only About you.
8. Visible source comparison, persistent Undo and one-per-conversation limit.

The simpler option I would pass over within Greg’s chosen B is “ask an isolated verifier whether it is close and trust its yes.” That makes a probabilistic classifier the only defence against attacker-controlled offer text. The still simpler and safer product remains the current exact-or-press rule, but Greg has explicitly chosen the trade-off it declines.

The honest residual risk is irreducible: an article can influence the proposal, exploit ambiguity in the reader’s words, or cause both the guide and verifier to accept a false restatement. If that reaches About you, it can affect every later prompt until the reader notices and undoes it. No automatic non-verbatim profile save can retain the present word-for-word guarantee.