F1. **High — the fold migration can fail on valid `chat_mentions` rows.**

Evidence: The plan moves `chat_messages.thread_id` (`docs/plans/261020m-recall-and-tutorial-become-one-recall.md:126-130`), but `chat_mentions.thread_id` participates in both its primary key and its foreign key to the message (`src/db/schema.ts:4992-5013`). That foreign key uses `ON UPDATE NO ACTION` (`drizzle/20261012131532_chat_mentions.sql:18`). A Tutorial message with a mention therefore prevents the parent update. The application currently restricts mentions to ordinary chat (`src/routes.ts:3491-3493`), making such rows unlikely, but the database permits them and the migration claims to handle stored threads generally.

Concrete fix: change this relationship to `ON UPDATE CASCADE` before folding, update the schema declaration, and add a migration test containing a mentioned Tutorial message. Alternatively, explicitly migrate child and parent rows while the constraint is temporarily replaced.

F2. **High — the merged prompt would misrepresent model inference as article-backed fact.**

Evidence: The proposed contract gives application questions an article answer id and hint (`docs/plans/261020m-recall-and-tutorial-become-one-recall.md:88-94`). Tutorial explicitly permits novel predictions such as what the author would say about a case they never mention (`src/converse.ts:1234-1246`). Recall currently draws the correct boundary: article-backed questions need textual support, while questions requiring the model’s own inference carry no answer id (`src/converse.ts:1001-1008`, `src/converse.ts:1071-1077`).

Concrete fix: define two separate classes:

- Textual recall, explanation, and connection questions: article-backed, with id and hint.
- Novel application or prediction questions: explicitly framed as inference, with neither answer id nor hint.

Add an eval that rejects attaching a passage id as though it contains the answer to a novel hypothetical.

F3. **Medium — several central prompt conflicts remain unresolved.**

Evidence:

- The plan retains Recall’s tone rules (`docs/plans/261020m-recall-and-tutorial-become-one-recall.md:106-109`), including “not a teacher” (`src/converse.ts:919-925`), while importing Tutorial’s role as a “reading tutor” and “good one-to-one tutor” (`src/converse.ts:1181-1185`, `src/converse.ts:1309-1316`).
- Recall says a cue names the topic but never supplies what the article said (`src/converse.ts:994-999`), whereas Tutorial’s “questions teach” example puts substantive explanation inside the question (`src/converse.ts:1258-1265`).
- After a failed recall attempt, Recall says not to ask immediately for the answer just supplied (`src/converse.ts:1041-1050`). Tutorial permits “say it back” (`src/converse.ts:1234-1247`) while also saying not to place the answer in the preceding sentence (`src/converse.ts:1267-1272`).

Concrete fix: give the merged prompt explicit precedence rules. It may teach without adopting a marking or superior role; retrieval cues must contain only location/topic cues; after filling a failed gap, ask for transformation, application, or a different point—not verbatim restatement. Define when deliberate paraphrase is the exception to “no gimmes,” and add positive examples for every branch.

F4. **Medium — old exported or rollback `chat.json` files containing both kinds are not safely recoverable.**

Evidence: The plan adds `tutorial` to the retired-kind mapping (`docs/plans/261020m-recall-and-tutorial-become-one-recall.md:151-157`). That mapping exists because database migrations do not rewrite filesystem state (`src/types.ts:4395-4408`), and unknown file kinds are otherwise refused (`src/chat.ts:63-95`). Existing exports can contain both `learn` and `tutorial` threads (`src/store/export.ts:670-681`, `tests/store-export-thread-kind.test.ts:65-71`, `tests/store-export-thread-kind.test.ts:110-140`). Mapping both to `learn` without folding them can violate the one-thread-per-kind invariant or cause one transcript to hide the other; the restore helper currently inserts threads unchanged (`tests/helpers/seed-reader-state.ts:256-305`).

Concrete fix: implement deterministic file-side normalization mirroring the SQL fold: retain the Recall thread id, append Tutorial messages after its maximum ordinal, repoint comments, and discard the duplicate thread. Test a pre-change bundle containing both kinds, not merely a Tutorial-only bundle.

F5. **Medium — persistent offline responses can reintroduce the removed runtime value.**

Evidence: `/api/chat/` responses are stored for offline use (`src/web/lib/api.ts:1063-1109`) and returned unchanged after network failure (`src/web/lib/api.ts:842-863`). The IndexedDB schema remains persistent at version 2 (`src/web/lib/offline-store.ts:119-121`). Removing `"tutorial"` from TypeScript does not transform already-cached JSON, so exhaustive client code can still receive that value after deployment.

Concrete fix: either bump the offline database version and clear affected cached responses, or normalize old `/api/chat` bodies on read, including the dual-thread case. Test launching the new client offline with an old cached response.

F6. **Medium — the promised URL rewrite needs a broader implementation footprint.**

Evidence: The plan promises that `?learn=tutorial` will open Recall and rewrite to the canonical URL (`docs/plans/261020m-recall-and-tutorial-become-one-recall.md:34-37`), but its code list focuses on `src/web/params.ts`. The last Learn view is persisted in localStorage (`src/web/last-view.ts:98-112`), restoration passes through `liftedLegacySearch` (`src/web/last-view.ts:514-522`), and canonical legacy lifting also happens during router boot, navigation, and history restoration (`src/web/router.ts:1108-1121`, `src/web/router.ts:1542-1564`). Parsing `"tutorial"` as Recall alone will not necessarily rewrite the address or stored value.

Concrete fix: add one exact legacy lift in the canonical address-settling path and reuse it for remembered searches. Test initial load, client navigation, Back/Forward, and localStorage restoration while preserving unrelated query parameters and thread ids.

F7. **Medium — old stored command tokens need an exact compatibility alias at the security boundary.**

Evidence: The plan says stored `[cmd:mode:submode%3Alearn%3Atutorial]` tokens will continue working (`docs/plans/261020m-recall-and-tutorial-become-one-recall.md:162`). Token parsing validates syntax but does not translate targets (`src/web/command-proposal.ts:108-136`, `src/web/command-proposal.ts:208-227`). Execution only accepts a target present in the current live command door (`src/web/chat-commands.ts:61-87`, `src/web/command-runners.ts:234-257`). Once the Tutorial row disappears, the old target no longer resolves. This live-door recheck is an explicit security defence (`docs/project/security-map.md:121`) and should not be weakened with a phantom command.

Concrete fix: normalize only the exact retired target `submode:learn:tutorial` to `submode:learn:recall` before live-door lookup, then retain all current availability and reader-confirmation checks. Also keep “tutorial” as a typed-command alias for Recall (`src/web/sub-modes.ts:60-71`, `src/web/command-match.ts:297-324`). Test that the old token works only when Recall is currently offered, while malformed or unavailable targets remain inert.

F8. **Medium — the migration omits keeper metadata and needs a stronger invariant test matrix.**

Evidence: The plan covers messages, pointers, deletion, and constraints (`docs/plans/261020m-recall-and-tutorial-become-one-recall.md:126-139`) but not metadata. `updated_at` determines thread recency and is advanced as messages arrive (`src/db/schema.ts:4433-4437`). `gist` and `gist_at` summarize a particular transcript (`src/db/schema.ts:4447-4458`) and normal message mutations invalidate them (`src/store/pg-chat.ts:404-413`). The earlier fold migration explicitly preserved latest activity and handled ordering carefully (`drizzle/20261001143901_remember_one_thread.sql:70-114`).

Concrete fix: for a dual-thread fold, set the keeper’s `updated_at` to the greatest relevant timestamp and clear `gist`/`gist_at`; for a Tutorial-only rename, preserve its metadata. Expand migration tests to cover Tutorial-only rename, ordinal gaps, comments, realtime sessions, Live attempts, pending answers, mentions, duplicate-message-id failure, and post-migration CHECK/unique/index invariants.

F9. **Medium — the deploy-window analysis understates the failure and overlooks a safer phased alternative.**

Evidence: The plan accepts old code failing during the migration window and says reloading fixes it (`docs/plans/261020m-recall-and-tutorial-become-one-recall.md:145-147`). After the CHECK constraint is narrowed, an old server can still attempt to create `"tutorial"` and fail. If a Tutorial-only thread has already been renamed to `"learn"`, old code can also collide with it. Reloading before all old instances and bundles have drained does not guarantee new behavior.

Concrete fix: use expand-and-contract:

1. Deploy compatibility code that accepts old wire/URL/command values but canonicalizes new work to Recall.
2. Let old instances drain.
3. Run the fold and narrow the database constraint.
4. Remove the obsolete internal kind in a later cleanup.

At minimum, retain a permanent wire alias and describe the old-instance failure window accurately.

F10. **Medium — the proposed tests and evals do not cover the behavioral and generated-artifact footprint.**

Evidence: The plan’s eval criteria emphasize ids, hints, length, questions, praise, and cold starts (`docs/plans/261020m-recall-and-tutorial-become-one-recall.md:164-180`). They omit Tutorial’s primary anti-summary safeguard—guided reading rather than supplying a substitute summary (`src/converse.ts:1192-1195`, `docs/project/learn-mode.md:74-89`, `docs/project/learn-mode.md:256-260`). The current checker also labels every closing question without a hint as bad, despite pure clarification being a valid exception (`evals/learn-recall-checks.ts:42-45`, `evals/learn-recall-checks.ts:75-106`; `src/converse.ts:1034-1055`). Tutorial references also occur in wider-world, principles, web-reach, Explore, and command-pick evals (`evals/wider-world.ts:359-397`, `evals/chat-principles/run.ts:173-181`, `evals/chat-web-reach.ts:131-143`, `evals/learn-explore.ts:380-405`, `evals/command-pick/phrases.ts:146-150`). Four-card assumptions remain in UI tests and CSS (`tests/learn-header-cards.test.tsx:328-362`, `tests/command-bar-sub-modes.test.tsx:263-271`, `src/web/styles/quiz.css:32-55`), and generated help copy will need regeneration.

Concrete fix: enumerate and run those suites; make id/hint expectations question-type-specific; add scoring for branch selection, guided-reading versus summary replacement, expert-reader behavior, reachback, teaching after failed recall, and novel inference. Preserve the current “aim below 100 words, 120 ceiling” distinction rather than treating 120 as the target (`src/converse.ts:1082-1089`).

F11. **Low — keeping “Recall” is defensible, but part of the stated rationale is internally inconsistent.**

Evidence: Recall fits the product’s emphasis on effortful retrieval and the default learning loop (`docs/project/learning-vision.md:13-30`, `docs/project/learning-vision.md:52-55`), so the conclusion is reasonable. But the plan first argues that choosing “Tutorial” would require a deep rename (`docs/plans/261020m-recall-and-tutorial-become-one-recall.md:51-54`), then says the visible label is independent of stored identifiers and could be changed later (`docs/plans/261020m-recall-and-tutorial-become-one-recall.md:58-59`). Implementation churn is therefore not a sound reason to prefer the label.

Concrete fix: base the decision on product meaning: Recall describes the default retrieval activity, while the supporting copy should make its teaching behavior discoverable. Treat stored ids and visible naming separately, retain “tutorial” as a search/command alias, and test the unopened chip/card copy with readers rather than relying on copy visible only after selection.

Verdict: Revise before build; the migration is unsafe for some valid stored rows, and the merged prompt still has unresolved attribution and behavior conflicts.