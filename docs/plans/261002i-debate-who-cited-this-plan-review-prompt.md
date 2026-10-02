# Review request: plan 261002i (Debate leads with who has cited this article)

You are GPT Sol, reviewing a plan read-only. Repo: Spideryarn, an AI-assisted reading app.

Read:
- docs/plans/261002i-debate-leads-with-who-has-cited-this-article.md (the plan, the subject)
- docs/project/debate.md and the header of src/debate.ts (what Debate is today)
- src/bibliographic.ts header (the politeness machinery the plan says it would reuse)
- docs/project/feedback-reports.md § Who sent it (an admin's request is built, simplest version
  first; a new outside service or a new flow of data to one is always Greg's call)
- The raw Semantic Scholar answers the plan's numbers come from: data/s2.json, data/s2-100.json,
  data/s2-200.json, data/s2-300.json (four pages of /citations for DOI 10.1016/j.tics.2018.02.001).

Check, and say plainly where the plan is wrong:
1. The CONCLUSION: that the request cannot be met usefully without a citation index, so the right
   ending is "awaiting Greg" with nothing built. Is there a no-new-service version that would
   actually serve Greg's request and that I passed over or dismissed too quickly? Is ending here
   (not building anything) the right call under feedback-reports.md?
2. The evidence: do the numbers in § Evidence and the table match the JSON files? (334 rows, 138
   with non-empty contexts.)
3. The recommendation (Semantic Scholar over OpenAlex): is the reasoning sound, and are the costs
   (licence attribution, at-will access, rate limits, key as a secret, privacy of a private
   upload's DOI) stated fairly? Anything missing that Greg would need to decide?
4. The v1 design in § The simplest version worth building: anything that would fail silently,
   mislabel a citer, or put the wrong paper's citers under an article? Anything that should be
   simpler?
5. Is the question to Greg answerable as written by someone who has not read the code?

Answer with numbered findings, each with a severity (P0-P3), the line or section, and the fix.
Finish with a one-line verdict on the conclusion in point 1.
