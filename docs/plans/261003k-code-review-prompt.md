# Code review: 261003k Stage 2 (the command bar asks a fast model what a sentence meant)

You are reviewing CODE, and you may fix what you find. Candidate: this worktree at commit
75f6927f4 (Stage 2). Stage 1, the eval, is a914523da. See both with

    git show --stat a914523da
    git show --stat 75f6927f4

Changed paths in Stage 2 (start here; it does not limit scope): src/command-pick.ts,
src/command-pick-call.ts, src/command-pick-catalogue.generated.json, src/web/command-pick-client.ts,
src/web/CommandBar.tsx, src/web/command-match.ts, src/web/article-commands.ts,
src/web/rerun-commands.ts, src/ai-call.ts, src/models.ts, src/cost-categories.ts, src/routes.ts,
evals/command-pick/, tests/command-pick.test.ts, tests/command-bar-pick.test.tsx,
tests/command-pick-catalogue.test.ts, tests/ai-call.test.ts,
tests/authenticated-api-route-contract.test.ts, tests/command-bar*.test.tsx, tests/command-match*.test.ts.

Read first: the plan, docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md
(the design, the ledger of your plan-review findings F1–F7, and § Progress, which lists every
divergence the builder made); docs/investigations/261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md
(the measurement the 0.95 cut and the model choice rest on);
docs/project/chat-llm-help-commands-vision.md § The line and § Decided; docs/project/security-map.md;
docs/project/ai-gateway.md; docs/project/logging.md.

**Independent pass first.** Would this, as built: run a command the accepted line says must be
proposed (anything that writes, spends or generates; any argument answer); run the wrong row or a
stale one; make a paid call the reader did not ask for, or more than one per Enter; let a signed-in
caller use the route as a general model proxy or get client-supplied words into a prompt; log or
leak the sentence; mis-record spend (job, wire, attribution); break quick search (`noul`) by the
`choice` addition to `openRouterDecisions`; break the bar's existing behaviour (ranking, argument
rows, dictation guards, the pending / `inFlight` / `opening` machinery, the held-Enter guard now
applied everywhere); or ship a generated catalogue that can go stale unnoticed? Does production ask
the models exactly as the eval's winning arms did? Are the tests able to fail — pick three and
mutate the code they claim to cover.

You have no network and no Postgres. Run these yourself (they need neither):

    npx vitest run tests/command-pick.test.ts tests/command-bar-pick.test.tsx tests/command-pick-catalogue.test.ts tests/command-match-arguments.test.ts

**Fix what is inside this stage, narrowly and red-first** (a failing test, then the fix). Do not
touch docs other than the plan's ledger, and do not widen scope: anything wider you notice, report
and leave. Do not commit.

Severity: P0 data loss / exploitable security / incorrect charging / service unusable; P1
user-visible wrong behaviour or a contract violated; P2 design or maintainability risk with no wrong
behaviour today; P3 prose. Every finding gets an ID continuing the plan's (F8, F9, …), a severity,
evidence (file:line), and either "fixed: <what>" or "reported". End with a verdict: land / land
after these / do not land.

## My own suspicions (worth less; spend most of the run elsewhere)

1. `knownOptions` dedupes by id alone — if a caller sends both `action:archive|Archive` and
   `action:archive|Put back`, the first wins. Harmless?
2. The first JSON import in src/ (`with { type: "json" }`): does `npm run build` and the Vercel API
   bundle carry it? (You cannot run the build; reason from the build scripts.)
3. Suggested rows are re-resolved at render by id and label, but the row-list signature is checked
   only when the answer lands.
4. A 499 for an abandoned request, and whether `httpError` with a provider's `err.message` can
   carry anything it should not.
5. The no-match hint is shown only when signed in — what tells the bar that, on pages with no Dock?
