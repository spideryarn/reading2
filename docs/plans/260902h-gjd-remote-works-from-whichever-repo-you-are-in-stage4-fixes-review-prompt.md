# Review: the fixes made after your landing review, before hellozenno's first real run

Read-only, short. Your landing review (`…-stage4-review-sol.md`) found one blocker (the policy
forgot rejected keys) and four smaller things. They were fixed in commit `a7cd14e` and the branch
has landed on `dev`. Before the first real use for hellozenno, check the fixes.

Read: the diff at
`/private/tmp/claude-501/-Users-greg-dev-spideryarn-reading2/eaf11bc0-8303-409a-abea-7789226536e6/scratchpad/landing-fixes.diff`;
then `scripts/gjd-remote-envpolicy.ts` (`Policy` with `reviewed`, `readPolicy`'s migration and the
`approved ⊆ reviewed` rule, `planChecklist`, the new `pushEnvPlan`) and its tests (the five-sentinel
leak test through a real `withLedger` and stubbed transport); and in `scripts/gjd-remote.ts`
`pushEnvByChecklist` (now glue), `sendEnvPayload` (`try/finally` removing the staged dir).

Live: run 1 unticked `LOG_LEVEL` → policy has it in `reviewed` not `approved`; run 2 "no keys you
have not decided on — skipping the model", row unticked with the date; `--none --save` on a fresh
policy → empty `approved`, six `reviewed`, and the next run asked no model; temp dir listing before
and after a real push identical.

Questions: (1) is the `reviewed`/`approved` contract now right, including migration of an old
file and a key removed then re-added to `.env.local`? (2) can a reviewed-but-rejected key be
pre-ticked by any path (`--all`? a model reply? a saved file edited by hand)? (3) does the sentinel
test now actually put values into the inputs, and is any sink still uncovered? (4) `pushEnvPlan`'s
callbacks: any way the CLI glue can send something the plan did not return? (5) anything you would
stop the hellozenno run for.

Numbered findings with severity, file:function, the concrete change; then "go" or "stop". No
files or remote state may be changed.
