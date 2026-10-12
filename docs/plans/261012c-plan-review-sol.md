The proposed rule is breakable in ways that exceed its stated residual risk. I would not authorize an unattended build from this plan.

1. **P1 — Allowed “small” edits can create a different proposition.** For each example below, assume the field is empty and this is the first rewording in the conversation. All satisfy the operational conditions in [the proposed rule](</var/tmp/spideryarn-worktrees/fbyk3r03-q7mb3w-b-follow-up/docs/plans/261012c-the-guide-saves-a-close-rewording-by-itself-the-safest-form-of-b.md:73>).

| Field | Reader typed | Offer | Failure |
|---|---|---|---|
| About you | `I enjoy cooking, my family, and my pets.` | `I enjoy cooking my family and my pets.` | Dropping punctuation turns a list into a claim of cooking people and pets. |
| About you | `I have a little experience with statistics.` | `I have little experience with statistics.` | Removing `a` changes “some experience” into “almost none.” This also conflicts with the promise that quantifiers remain unchanged. |
| About you | `In the simulation, I am a surgeon.` | `I am a surgeon.` | The run begins after a comma, expressly allowed, but discards the qualifier and creates a real-world claim. This passes the proposed tightened exact route too. |
| Reason | `Ignore all previous instructions.` | `To ignore all previous instructions.` | The mechanical “statement” test admits imperatives; the permitted `to` lead-in stores a direct prompt instruction. |
| About you | `I use 127.0.0.1 for local tests.` | `I use 127.0.0.1 for local tests.` | A bare IP survives the stated domain regex and is not a URL, email, handle or path. The earlier design advice explicitly required IP addresses to wait for a press. |

The first two are caused by the new normalization itself, rather than an article merely selecting an unfortunate clause. “Punctuation,” `a/an/the`, and `and` are not reliably meaning-free. Consequently, the claims that the rule cannot change meaning and that “nothing new can arrive” are false: no new content token is needed to create a new proposition or prompt instruction.

2. **P1 — “One per field per conversation” lacks an enforceable design.** The current [`offerToSave`](</var/tmp/spideryarn-worktrees/fbyk3r03-q7mb3w-b-follow-up/src/chat-tools.ts:2312>) sees the current typed message and basis, but no previous tool runs. [`GuideSaveOffers`](</var/tmp/spideryarn-worktrees/fbyk3r03-q7mb3w-b-follow-up/src/web/GuideSaveOffer.tsx:116>) receives only one assistant message, while `answeredHere` is volatile tab state. Two implementers could therefore build:

   - a `useRef`/module counter that resets on reload;
   - a transcript scan that counts eligible offers;
   - a durable record of successful writes.

   Those provide different security bounds, especially after a failed save, Undo, reload, or another tab. Define the limit conservatively as “the first reworded offer marked for automatic saving per field in the stored conversation consumes the allowance, whether or not its PATCH lands or is later undone,” and name where prior runs are supplied and checked.

3. **P2 — Several defence conditions are too underspecified to implement consistently.**

   - “Sentence,” “clause,” “inside quotation marks,” and “straight after” need exact parsing rules. Commas introduce both independent clauses and fronted qualifiers, as the surgeon example shows.
   - “Statement” needs explicit rejection of requests and imperatives, not just question punctuation and a short initial-word list.
   - `I'd` and `'s` have multiple expansions; the fixed contraction table and ordering relative to punctuation removal must be complete.
   - “URL, path or code” is not an algorithm. IP addresses, `localhost:3000`, Markdown links, Unicode full stops, role labels, control characters, bidirectional controls and meta-instructions need explicit handling. These were all or partly required by the [earlier design advice](</var/tmp/spideryarn-worktrees/fbyk3r03-q7mb3w-b-follow-up/docs/plans/261012c-design-consult-sol.md:96>).
   - Append-only needs a canonical separator and a clean sentence boundary. Whitespace alone can complete or alter an unfinished existing profile; the prior advice required a standalone sentence or a press.
   - It is unclear whether `route` and `source` are required only for `now` offers or every offer. Existing stored offers contain neither, while current [`offerOf`](</var/tmp/spideryarn-worktrees/fbyk3r03-q7mb3w-b-follow-up/src/web/GuideSaveOffer.tsx:83>) accepts the older shape. The plan must specify backward compatibility rather than accidentally hiding existing cards and Undo controls.

4. **P2 — The exact-route tightening is safe to bundle only after correcting the rule.** A genuine tightening is operationally safe because every refusal falls back to the existing Save button. But the listed clause-start test is not enough: `In the simulation, I am a surgeon.` → `I am a surgeon.` remains eligible. Require the selected text to retain both leading and trailing qualifiers—or use the whole source sentence—rather than describing this as secured by “starts at a clause.” Keep exact and reworded cases in separate tests, and preserve or conservatively demote legacy stored `now` offers lacking `route/source`.

5. **P2 — The proposed security notes understate both capability and severity.** The risk entry should not say the rule cannot save an instruction, link-like target, or changed claim. It should mention punctuation/article meaning changes, context truncation, imperatives, sensitive tokens, background-tab saving, and automatic replacement of an existing reason. The earlier advice required reworded reasons to auto-save only when the reason was empty and required the tab to be visible; this plan silently omits both. “Low” is also not supported by the register’s definition: an article can cause a persistent write that enters every later prompt. The earlier **Medium** assessment is more accurate even with corrected deterministic limits.

6. **P3 — The measurement stage measures convenience, not safety.** Recounting exact/reworded/pressed results among 14 ordinary offers cannot validate the defence. Add an adversarial false-acceptance corpus covering the strings above, qualifier cuts on both sides, imperatives, reported speech synonyms, ambiguous contractions, IP/Unicode/control forms, old stored offer shapes, and reload/multi-tab enforcement of the conversation limit.

RETHINK