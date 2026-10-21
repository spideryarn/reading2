F1 — High — The new context contradicts the prompts that receive it.

The plan leaves the shared rule as “unless they say so,” even though `READING SO FAR` is telemetry, not something the reader said ([plan:70](</var/tmp/spideryarn-worktrees/chat-reading-progress/docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md:70>), [chat-principles.ts:51](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/chat-principles.ts:51>)). Learn is stricter: until readers say they have read it, the model must not ask what they remember, and it must not infer progress elsewhere ([converse.ts:964](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/converse.ts:964>), [converse.ts:1354](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/converse.ts:1354>)). The guide likewise treats them as about to read unless they explicitly say otherwise ([converse.ts:1731](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/converse.ts:1731>)). Because specific rules win, `read-most` is either ignored or creates contradictory behavior.

Fix: amend the shared principle and Learn/Guide’s specific rules to say that `READING SO FAR` is rough evidence, never proof that a particular passage was read. Alternatively, omit the line from Learn and Guide initially.

F2 — High — The server calculation does not use the same reading snapshot as the quiz.

The plan claims it is “exactly what `Reader.tsx` hands the quiz” and treats a successful empty database read as little or no reading ([plan:40](</var/tmp/spideryarn-worktrees/chat-reading-progress/docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md:40>), [plan:63](</var/tmp/spideryarn-worktrees/chat-reading-progress/docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md:63>)). But the quiz uses server totals plus live, browser-local seconds ([useReadingTime.ts:239](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/web/useReadingTime.ts:239>), [useReadingTime.ts:296](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/web/useReadingTime.ts:296>), [QuizPanel.tsx:1558](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/web/QuizPanel.tsx:1558>)). Those seconds are flushed only every 60 seconds ([useReadingTime.ts:80](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/web/useReadingTime.ts:80>)); `pgReadingTimeStore.read` sees only committed rows ([pg-reading-time.ts:27](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/store/pg-reading-time.ts:27>)). A reader can therefore see “about a quarter” in Quiz while chat is told “little or none,” especially on a short article or while a POST is in flight.

Fix: either synchronize pending reading-time writes before starting chat, or use the simpler rejected option: send an allowlisted six-value bucket computed from the browser’s current `ReadSoFar`. This value grants no authority and can only alter that reader’s answer, so “trusting the client” is not a security boundary; the server should validate the enum and construct the fixed prompt text itself.

F3 — High — The confidentiality rule is in the wrong prompt layer, and its wording breaks help turns.

The plan puts “never mention/search/tool” beside the data in the final user message ([plan:49](</var/tmp/spideryarn-worktrees/chat-reading-progress/docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md:49>)). The established profile design explicitly keeps the binding rule in the constant system prompt so the data it constrains cannot override it ([profile.ts:91](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/profile.ts:91>), [profile.ts:110](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/profile.ts:110>), [profile.ts:176](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/profile.ts:176>)). That matters because the article may itself address the model with hostile instructions ([security-map.md:19](</var/tmp/spideryarn-worktrees/chat-reading-progress/docs/project/security-map.md:19>)).

The cache objection is not persuasive: this stage already changes `CHAT_PRINCIPLES`, so every affected system/article prefix changes once on deployment anyway. A constant rule does not make it vary per turn. The proposed tail also contains the literal words `search` and `tool`, violating help’s existing rule that the final help message says nothing about either because the system prompt owns that policy ([help-prompt.test.ts:166](</var/tmp/spideryarn-worktrees/chat-reading-progress/tests/help-prompt.test.ts:166>)).

Fix: add one shared constant system rule to Chat, Learn, Explore and Guide. Keep only a short recency reminder beside the value, such as “Use this silently only to pitch the answer.” Keep the value below the breakpoint.

F4 — High — The leak gate cannot detect the leaks it claims to block.

The proposed regex inspects replies only and covers a narrow set of phrases ([plan:99](</var/tmp/spideryarn-worktrees/chat-reading-progress/docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md:99>)). It misses paraphrases such as “you are still early in the piece” or “with most of the article behind you.” More importantly, it cannot see tool arguments even though preventing those is an explicit requirement. `converse` passes parsed arguments directly to `runToolWith` ([converse.ts:3835](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/converse.ts:3835>)), while the eval stub currently discards those arguments ([run.ts:291](</var/tmp/spideryarn-worktrees/chat-reading-progress/evals/chat-principles/run.ts:291>)). OpenRouter’s server-side web search remains active even when first-party tools are disabled ([converse.ts:2195](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/converse.ts:2195>)), so its query is not covered either. The blind-judge rubric also does not ask whether either reply reveals or implies observed reading activity ([run.ts:348](</var/tmp/spideryarn-worktrees/chat-reading-progress/evals/chat-principles/run.ts:348>)).

Fix:

- Record and inspect every first-party tool name and argument.
- Add hostile article text and a reader explicitly asking what telemetry the model can see.
- Ask the blind judge whether either answer reveals or implies observed reading behavior.
- Capture provider-search queries if the API exposes them; otherwise state that route is unmeasured rather than claiming zero leakage.

F5 — Medium — The reading-effect judge can reward an inference the feature explicitly cannot support.

One new case is deliberately about a term in the second half ([plan:90](</var/tmp/spideryarn-worktrees/chat-reading-progress/docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md:90>)). But a whole-article share says nothing about which part was read. Even “most” does not establish that this passage was among it. A judge preferring an answer that assumes the later passage was seen would reward overclaiming. Including `outside` also imports the live-web-search confound already acknowledged in the preceding stage. Finally, the current pairs format contains profile, history and question but no reading state ([run.ts:371](</var/tmp/spideryarn-worktrees/chat-reading-progress/evals/chat-principles/run.ts:371>)); the plan needs to make that state a persisted field, not infer it informally from an arm label.

Fix: use cases where broad familiarity changes how much setup or terminology an answer needs without implying a specific passage was read. Persist the reading state in each result and print it in each blind pair. Tell the judge that it is rough, whole-piece evidence and penalize passage-specific assumptions. Remove `outside` from this comparison or replay identical search evidence.

F6 — Medium — `wantsProfile` is the wrong gate and makes the privacy claim false.

The plan says reading context has no off switch, yet reads it only when `wantsProfile` ([plan:63](</var/tmp/spideryarn-worktrees/chat-reading-progress/docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md:63>), [plan:125](</var/tmp/spideryarn-worktrees/chat-reading-progress/docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md:125>)). `useProfile` controls a different kind of data; its current `false` caller happens to be Candidates, but the route contract remains independent ([routes.ts:3436](</var/tmp/spideryarn-worktrees/chat-reading-progress/src/routes.ts:3436>)). Candidates are already safely dropped by `buildConverseMessages`, so this coupling is unnecessary. A non-Candidates request with `useProfile:false` would silently lose reading context.

The proposed privacy doc is stronger still: it says every chat turn carries the phrase ([privacy.md:510](</var/tmp/spideryarn-worktrees/chat-reading-progress/docs/project/privacy.md:510>)), despite Candidates being exempt, `useProfile:false` omitting it, and failed reads deliberately sending none.

Fix: gate the read directly on the stored thread kind (`thread.kind !== "candidates"`), independently of `wantsProfile`. Make the privacy wording name Chat, Learn, Explore and the guide, and avoid “every” if transient read failures intentionally omit it.

F7 — Medium — The plan lacks deterministic coverage for the transport paths it relies on.

The paid eval tests model behavior, not whether production plumbing reliably supplies the line. The plan needs route-level tests proving:

- ordinary send, retry and edit each recompute it once;
- a help turn carries it without weakening help’s prompt contract;
- Candidates neither receives it nor causes an unnecessary reading-time read;
- a failed store read omits it while a successful empty read produces the lowest bucket;
- every tool round retains the same line without rereading the store;
- adding or changing it leaves the cached system/article prefix byte-identical within the deployed prompt version.

These are the exact silent drop/leak paths the feature depends on; the common route and `base` message design make them straightforward to test.

Verdict: **revise first**.