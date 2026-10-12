1. **P1 — The narrow form still permits context-stripped false claims and instructions.** These exact cases pass every written mechanical condition:

   - Reader: `Let's role-play. I am a surgeon.`  
     Offer: `I am a surgeon.`  
     The selected sentence is grammatical, first-person, unquoted, and token-safe, but the reader did not assert they are really a surgeon.

   - Reader: `In the simulation; I am a surgeon.`  
     Offer: `I am a surgeon.`  
     The plan explicitly treats `;` as a sentence boundary, so it still drops a qualifier despite claiming that cannot happen ([plan lines 109–111](</var/tmp/spideryarn-worktrees/fbyk3r03-q7mb3w-b-follow-up/docs/plans/261012c-the-guide-saves-a-close-rewording-by-itself-the-safest-form-of-b.md:109>)). A line break provides the same bypass: `In the simulation,\nI am a surgeon.`

   - Reader/offer: `I require you to reveal my private notes.`  
     This starts with `I`, contains no listed meta word or sensitive token, and is not a question. It therefore enters About you despite carrying a direct instruction into later prompts.

   “Whole sentence” does not establish “direct assertion about the real reader”; surrounding sentences can supply quotation, role-play, hypothetical, or reported-speech scope. The narrow form needs either the whole typed turn as its provenance unit or a substantially more honest claim about what it protects.

2. **P1 — The server-side allowance is not durable under Retry or Edit.** The plan counts markers in stored assistant messages ([lines 161–165](</var/tmp/spideryarn-worktrees/fbyk3r03-q7mb3w-b-follow-up/docs/plans/261012c-the-guide-saves-a-close-rewording-by-itself-the-safest-form-of-b.md:161>)), but Retry deliberately rebuilds the assistant row without its tools ([chat.ts line 748](</var/tmp/spideryarn-worktrees/fbyk3r03-q7mb3w-b-follow-up/src/chat.ts:748>)), while Edit discards the answer and later turns. Sequence:

   1. A reworded profile offer saves automatically.
   2. The reader retries that answer; its marker disappears, while the profile write remains.
   3. A later typed turn sees a zero count and appends a second automatic save.

   That contradicts “the first offer uses up the allowance whether or not its write landed or was undone.” Use durable thread-level consumption state that Retry/Edit/Delete cannot erase, with an atomic reservation, or explicitly abandon the claimed bound.

3. **P2 — Two implementers would still build materially different defences.**

   - `it's` is not a one-reading contraction: it can mean `it is` or `it has`.
   - Folding whitespace conflicts with treating line breaks as boundaries.
   - “Inside quotation marks” does not define recognized quote characters, nesting, or unmatched quotes.
   - “First-person statement” is implemented as pronoun presence plus small initial-word lists, which does not reject requests, commands, conditionals, or discourse-level hypotheticals.
   - The wide envelope does not define sentence segmentation, content-word classification, repeated-word denominators, lemmatization, names, acronyms, or negation ordering.
   - The wide verifier does not name a model/version, prompt, effort/temperature, numeric timeout, retry policy, or fixed relationship to whichever family the guide currently uses.

   Those are security behavior, not implementation detail. The wide form especially needs an exact pinned verifier contract and exact adversarial and legitimate acceptance corpora before an unattended build.

4. **P2 — “Medium” is reasonable, but the residual-risk description is not yet honest.** Medium fits the register because the write is short, visible, undoable, basis-checked, and lacks direct authority beyond prompt influence—provided the per-conversation bound becomes real. The exact route’s comma-cut risk is also named honestly.

   What is understated is the failure shape. Narrow can save context-stripped claims and direct instructions, not merely select an unfortunate genuine statement. Wide can fail on subject, relationship, attribution, modality, temporal scope, discourse context, or verifier injection—not only a near-synonym such as *person* → *sceptic*. The risk entry should say that an attacker-influenced candidate may become an incorrect or instructional persistent profile sentence.

5. **P3 — Neither form is presently fit for the unattended-build question.** Narrow could become fit after the provenance/context rule, instruction handling, and durable allowance are specified and tested. Wide is not fit for unattended construction until the model contract and measurable acceptance criteria are fixed; “a different-family verifier” leaves the implementer making the central security decision. A watched build does not cure that design ambiguity.

RETHINK