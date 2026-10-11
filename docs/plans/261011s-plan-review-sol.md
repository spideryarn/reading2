Verdict: **rethink**. Do not land the proposed closeness check. It checks vocabulary membership, not closeness of meaning, and admits straightforward persistent-profile attacks.

## Findings

### P1 — Harmful false profile claims pass the check

The fixed linking words include `I`, `am`, and `have`, while order, punctuation, and token multiplicity are discarded. An attacker controlling the guide’s tool call can therefore turn a topic the reader mentioned into a personal attribute.

Against the current implementation in [save-closeness.ts](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/save-closeness.ts:32), all of these returned `true`:

- Reader: “What does this paper say about cancer?”  
  Saved About you: “I have cancer.”
- Reader: “What does the French study show?”  
  Saved About you: “I am French.”
- Existing About you: “I am a historian.”  
  Same cancer question  
  Saved: “I am a historian. I have cancer.”
- Reader: “I do not want links to evil.com.”  
  Saved: “I want links to evil.com.”
- Reader: “Can you link this to Open AI?”  
  Saved: “Link to open.ai.”

The last two expose separate failures:

- Prohibiting newly introduced negations does not prevent deleting a negation.
- Splitting away punctuation lets the model manufacture a URL the reader never wrote.

The basis condition is also only set membership, so retaining one copy of each old word does not stop duplicating and rearranging those words into a contradictory instruction. The claim that the check cannot introduce a claim or link the reader did not write is therefore false ([plan lines 54–67](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/docs/plans/261011s-the-guide-saves-your-reason-and-about-you-at-once-when-the-words-are-yours.md:54), [implementation lines 97–117](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/save-closeness.ts:97)).

These cases should become failing security tests before redesigning the rule.

### P1 — Marking edits `typed` launders model-authored button text

The plan says edits count as typed ([lines 83–86](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/docs/plans/261011s-the-guide-saves-your-reason-and-about-you-at-once-when-the-words-are-yours.md:83)). That is unsafe:

1. A planted article causes a model-authored next-step question.
2. The reader presses it, then edits one word.
3. Treating the entire edited message as typed makes all the model’s remaining words eligible for automatic saving.

The in-progress implementation has already made the safer choice: edits and retries cannot carry `typed` ([routes.ts](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/routes.ts:3308)). Keep that change and correct the plan.

Caller audit:

- Composer and dictation: marked typed, appropriately.
- Greeting starts and guide next-step buttons: unmarked, appropriately ([ChatPanel.tsx](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/web/ChatPanel.tsx:2013)).
- Retry: unmarked.
- Edit: currently unmarked and rejected by the route; correct.
- Command-bar “Ask the guide”: its sentence really was typed by the reader, but its direct handoff currently loses that provenance, producing a conservative false negative ([Reader.tsx](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/web/reader/Reader.tsx:1088), [ConversationModes.tsx](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/web/modes/conversation/ConversationModes.tsx:1003)).
- A guide handoff can theoretically prefill the composer with `send: false`; pressing Send would then mark all prefilled words typed. There is no current guide caller using that branch, but the type and implementation permit it.

Provenance should be attached where the words originate, not inferred merely from their eventually passing through `Composer`.

### P2 — “Saw `pending`” is not a sound live-attempt signal

The proposed trigger records that a rendered message once had `status === "pending"` ([GuideSaveOffer.tsx](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/web/GuideSaveOffer.tsx:113)). That does not prove this tab initiated or watched the live stream:

- A pending row loaded after a reload or from another tab is counted as watched. If recovery later finds it finished, it can auto-save despite the plan promising that reloads do not.
- The assistant fragment is keyed by message ID ([ChatPanel.tsx](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/web/ChatPanel.tsx:2026)), while `turn.began` replaces the provisional ID with the server ID ([reduce.ts](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/web/chat/reduce.ts:1056)). That remount discards the first observation. It normally observes the renamed row pending again, but correctness then depends on React rendering between `begin` and `done`.
- Switching away and back produces timing-dependent behavior: returning while pending arms the write; returning after completion does not.

Use a volatile, one-shot signal tied to the client’s stable turn operation or its addressed `turn.done` event. That machinery already survives the begin-frame rename and distinguishes a locally streamed send from a loaded or recovered pending row.

### P2 — The transcript can claim success before any save occurred

`offerToSave` tells the model that the page is saving and asks it to say it has saved the value. The actual client write happens later and may fail because:

- the fresh read fails;
- the basis changed;
- the write fails;
- the component unmounts before or during the effect.

That leaves a stored assistant answer saying something was saved when it was not. The model should never announce success. Only the card, after the verified write, should say “Saved”.

### P2 — The autonomous write is still read-then-write, not compare-and-set

The card reads the current value, compares it with the basis, and then calls an unconditional PATCH ([GuideSaveOffer.tsx](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/web/GuideSaveOffer.tsx:191)). A concurrent profile change between the GET and PATCH is overwritten.

That residual was previously accepted for an explicit reader press. Removing the press makes it a model-initiated overwrite and raises the bar. If automatic saving remains, it should use a server-side compare-and-set against the basis.

Undo is also only present while that card stays mounted. If the reader changes thread while the asynchronous save completes, the write can land without any visible Undo, contradicting “always with an Undo”.

### P3 — Typical paraphrases will often fail

It will pass lexical tidying such as:

- “I work in neuroscience” → “The reader works in neuroscience.”
- “for journal club next week” → “Reading this for journal club next week.”

Ordinary close paraphrases often introduce one synonym and fall back to the button:

- “I don’t know much ML” → “I’m new to ML.”
- “getting ready to lead a seminar” → “preparing for a seminar.”
- “deciding whether to recommend it to students” → “considering using it for teaching.”

The prompt can encourage the model to copy instead of paraphrase, so the feature may still fire frequently, but then the linking and suffix machinery buys little. The current suffix implementation also does not implement the promised general `es` fold and is not a reliable lemmatizer ([save-closeness.ts](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/save-closeness.ts:65)).

## Recommended simpler design

For the first automatic version:

- Keep About you behind the existing press. The model is deciding not only wording but whether a sentence is actually about the reader; lexical checks cannot secure that semantic decision.
- If automatic saving is retained for the article-specific reason, require an exact, order- and punctuation-preserving reader-authored value from a tightly defined app-owned interaction—not a bag of reusable words.
- Carry reader-authored provenance from the originating control.
- Trigger from the local turn operation’s completion, not rendered `pending`.
- Perform the write with server-side compare-and-set.
- Let only the verified card state say “Saved”.

The existing 12 closeness tests pass, but they do not test the attacks above. No files were modified.