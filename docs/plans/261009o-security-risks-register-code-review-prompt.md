Review a finished documentation change. You may edit ONLY these files to fix what you find:
docs/project/security-risks.md, docs/plans/261009o-security-risks-register-and-a-security-review.md,
docs/user-feedback/261009_1119-security-risks-register-and-a-security-review.md. Do not edit anything
else, do not contact any remote service, and never print a secret's value (env var names and key
prefixes only).

The change: a new security-risks register (docs/project/security-risks.md), signposted from
docs/project/security-map.md and AGENTS.md; the plan
docs/plans/261009o-security-risks-register-and-a-security-review.md; the review evidence
docs/plans/261009o-security-review-app-sol.md (yours, earlier) and
docs/plans/261009o-security-review-ops-opus.md; the question file
docs/user-feedback/questions/q-rstqvz.md (Greg's reply appended); a feedback note. The diff against
origin/dev shows the rest.

Check:
1. Every factual claim in security-risks.md against the repo (file paths, function names, settings,
   doc quotes and dates, what Greg accepted when). Flag anything overstated or wrong; fix it.
2. Levels: consistent with the doc's own definitions? Any entry mis-levelled?
3. Does any entry restate at length what another doc already owns, instead of linking?
4. Is anything a reviewer reported missing from the register, or merged wrongly?
5. Is it plain enough for Greg to work through: could he answer "R6 yes, R8 not now" from it?
6. Does any line propose or imply a defence was changed? None was.
Then run `npx vitest run tests/doc-links.test.ts tests/feedback-endings.test.ts` and report the result.
Answer: verdict, then numbered findings with what you changed (or why not).
