Review the plan docs/plans/261020d-principles-every-chat-shares.md in this repo (Spideryarn). Read-only review: do not edit any file.

Read the plan, then check it against the code it names: src/converse.ts (SYSTEM ~line 619, LEARN_SYSTEM, TUTORIAL_SYSTEM, EXPLORE_SYSTEM, GUIDE_SYSTEM, systemFor, CLAIM_ORIGINS, COMMAND_CHIPS, helpSection, ConverseOptions and buildConverseMessages for where per-turn lines go), src/live.ts LIVE_SYSTEM, src/live-gpt.ts GPT_LIVE_VOICE_SYSTEM, src/plain-words.ts, src/wider-world.ts, src/profile.ts PROFILE_RULES and profileSection, src/store/pg-reading-time.ts, src/reading-time.ts, src/routes.ts streamChat (~line 3960), tests/plain-words-coverage.test.ts, tests/help-prompt.test.ts, tests/article-prompt.test.ts, docs/project/prompting-guide.md, docs/project/reading-time.md, docs/project/security-map.md.

Look for:
1. Places where the proposed shared text would contradict or double an existing rule in a prompt it goes into (Learn's no-giving-answers, Tutorial, Explore's "the thought is theirs", Guide's brevity and question limits, PROFILE_RULES "never address them", Live's SPOKEN_RULES terseness).
2. Whether the wording is concise and principle-framed as Greg asked, and any line likely to make answers longer, preachier or more hedged.
3. Stage 2 correctness: cache breakpoint / byte-identical article message, owner-only data (visitors, public articles, failed reads), threshold logic, provisional tree, help turns, retries/edits, privacy (never said back, never in tool args, nothing logged), and any defence in security-map.md this touches.
4. Whether the eval design can actually detect the effects claimed (control arm, blind judge, side balance) and whether the cases are sound.
5. Anything simpler that would do as well.

Do not try to write any file (the sandbox is read-only). Give your findings as your final message: numbered, each with severity (high/medium/low), the evidence (file:line), and the fix you recommend. End with a one-line verdict.
