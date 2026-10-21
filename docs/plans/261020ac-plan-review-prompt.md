You are reviewing a plan before it is built, in the repo you are running in (read-only). Read:

- docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md (the plan)
- docs/user-feedback/questions/q-rwkq2e.md (the question Greg answered; his answer is quoted in the plan)
- docs/plans/261020d-principles-every-chat-shares.md (the stage this follows, and its review's findings F3-F7, F12)
- src/chat-principles.ts, src/converse.ts (`buildConverseMessages`, `ConverseRequest`, `converse`), src/routes.ts around the `converse({` call (~line 4020) and `wantsProfile`
- src/web/read-filter.ts, src/web/reading-time.ts, src/block-policy.ts (`countsTowardReadingTime`), src/web/reader/Reader.tsx (`bodyWords`, `readSoFar`)
- src/store/pg-reading-time.ts, src/web/PrivacyPage.tsx (reading-time bullet, models paragraph), docs/project/privacy.md § Reading time
- docs/project/prompting-guide.md § Measuring a prompt change, evals/chat-principles/run.ts

Look for: places the line would leak into or be dropped from (retries, edits, help turns, tool rounds, candidates), anything that makes "read" disagree with the quiz's, privacy wording that would be untrue, cache-prefix changes, prompt-injection exposure, whether the leak screen and judge design can actually detect what they claim, and anything simpler. Number findings F1.., each with severity, evidence (file:line), and a concrete fix. End with a verdict: build as is / build with changes / revise first.
