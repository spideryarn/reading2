# GPT Sol on its own working conditions

> Dispatched read-only 2026-09-04 for [260904e-give-the-cross-family-reviewer-the-right-freedoms.md](260904e-give-the-cross-family-reviewer-the-right-freedoms.md).
> The prompt asked Sol about its own sandbox, and about [engineering-manager.md](../reusable/engineering-manager.md).
> gpt-5.6-sol, high effort, `review` profile. Note the two-writes anomaly recorded in the plan.

The present reviewer is well equipped for static analysis and focused pure tests, but under-equipped exactly where independent evidence matters most: database concurrency, real integration paths, current external API facts, and browser behavior. I would not solve that by giving the reviewer write access to the working tree. I would solve it with better-isolated network access, keep the repository read-only, and make follow-up turns possible.

I changed no files.

## 1. Are reviews under-equipped today?

Yes, selectively.

The current scratch-enabled `review` profile was a major improvement. It lets me turn many suspicions into executable findings. For example, the pricing review created a temporary Vitest reproduction of the signed-in dead anchor while leaving the source tree untouched. The storage review reproduced three mutations and ran 179 tests. That is enough for pure logic, component tests, scripts, and temporary harnesses.

The remaining holes are consequential:

- The private-test-database review could not run the real contention spike. I established the environment-ordering bug, but could only trace the `NOWAIT` contention branch statically. The missing finding shape was: “I held the singleton in one connection, issued the real competing claim in another, and observed this exact `busy.why` value.”
- The glossary deletion review loaded its test file but skipped all nine Postgres cases. I could not independently establish that deletion followed by the real claim/session path publishes a replacement, or that a concurrent draft cannot resurrect the glossary.
- Recent pricing/public-showcase reviews ran dozens of tests while skipping the real-Postgres security cases. The missing finding shape was an actual ownerless enumeration or cross-owner query result, not an inspection of generated SQL.
- The cost review reported that route and Postgres integration checks were blocked. It found accounting-window defects statically, but could not demonstrate a concrete persisted row being included in one cohort and excluded from the other.
- UI reviews can use jsdom, but cannot establish rendered layout, clipping, focus behavior, touch behavior, browser scheduling, or whether a screenshot supports the completion claim. The pricing Stage 2 review explicitly found that the promised final screenshots had not been supplied.
- External-fact findings have sometimes included plausible links—OpenRouter fees, OpenAI pricing, Gemini implicit caching, Supabase architecture—but under the measured review profile those pages were not fetched. Such claims may be correct, but they are model-memory claims wearing citations, not contemporaneous verification.

Before the scratch profile, the limitation was broader: the governing doc records fifteen consecutive reviews in which every Vitest attempt died on `EROFS`. The present repo contains 278 `*review-sol.md` outputs, so the historical evidence is now much larger than “fifteen-plus,” though I sampled rather than audited all 278.

## 2. Network

A network-capable review would be useful in this order:

1. **Targeted loopback reproduction.** Run the one Postgres, Supabase, Storage, or HTTP path on which a finding turns. This changes review quality most because it converts a plausible code trace into an observed failure.
2. **Repository typechecking.** Greg’s measurement establishes that enabling network makes `npm run typecheck` work by permitting the Unix socket. This is cheap and deterministic.
3. **A narrow integration slice against a disposable database.** Examples: apply a migration to a per-run database, inspect its schema, or reproduce a locking interleaving. Prefer a disposable database over the shared `postgres`.
4. **The full suite only for broad changes.** The current suite has private-Postgres, shared-services, and unit lanes. I believe network would make most or all of it runnable, but I did not establish that under the profile. More importantly, the suite still shares the Storage bucket and can collide with another run. A routine review does not need to spend its time re-running the implementer’s entire green suite.
5. **Official external documentation.** Useful when a finding depends on a current provider or library contract. Lower value than executing the changed code, and usually the orchestrator can supply the relevant primary-source page.
6. **General web research.** Rarely a review need. This belongs in a separate research/spike run.

I would not enable an all-network `review-net` profile on this host as the normal review mode. I ran non-content checks confirming that `.env.local` and `~/.codex/auth.json` are readable, and that `.env.local` contains a `DATABASE_URL`. I did not read their contents. Once outbound traffic is allowed, the reviewer’s “read every file” authority becomes potential exfiltration authority. It need not be malicious: a debugging command, dependency script, prompt injection in fetched material, or accidental request to the production URL is enough.

Environment-variable sanitising does not solve this; the files remain readable. Network access also permits writes to local services despite the filesystem being read-only, and a production credential read from disk could reach production.

No usable narrower profile has been demonstrated. Greg’s direct measurement shows that `allowed_domains` does not enforce narrowing. I attempted to test additional loopback-shaped settings with `codex sandbox`, but this already-sandboxed invocation could not start nested bubblewrap because its synthetic mount lock was read-only. Therefore that attempt establishes nothing about the syntax.

My recommendation is two isolated capabilities, not one `review-net`:

- A **loopback review environment** containing the repo and a disposable test database, with only the required local ports reachable and no production secrets or developer home mounted.
- A **web research environment** containing a clean repo snapshot and no local/production credentials.

Until those exist, have the orchestrator run a requested loopback mutation and return the raw result. Do not treat an unproven `allowed_domains` setting as a boundary.

## 3. Write access during review

The document’s conclusion is right, though its psychological explanation is only part of the reason. The stronger problem is that editing changes the subject while it is being examined.

- **Scratch directory only: best default.** This already buys temporary tests, generated fixtures, tiny programs, SQL scripts, alternate configs, and reproduction harnesses. It produced the pricing dead-anchor reproduction. The cost is occasional friction importing the repository or making Vitest discover an external file. That can be improved with a conventional per-run scratch directory and instructions for running scratch tests.

- **Write to the caller’s tree, no commit: poor review mode.** It makes suggested fixes executable, but does little to improve discovery. It contaminates the scoped diff, can mingle with peers’ work, and encourages the reviewer to validate the modified implementation rather than continue attacking the original. Having the caller inspect `git diff` does not restore the lost observational boundary.

- **A separate reviewer worktree: useful for a different task.** This is the right place for a Sol implementation spike or an explicitly requested executable patch proposal. It prevents contamination of the caller’s tree. It still creates ownership and anchoring: the author of the patch is a weaker judge of the patch. If used, the resulting diff should be reviewed in a fresh session as code written by somebody else.

- **No write anywhere: worse than today.** It takes away the most useful recent improvement and returns many findings to static reasoning.

So keep source read-only and scratch writable. Ask me for the mutation and smallest proposed change. If an executable patch is genuinely useful, make that a separate worktree-backed task after the review, not an ambient reviewer freedom.

## 4. Multi-turn

A second turn would be valuable for disagreement and clarification:

> “I ran your mutation and it did not fail because X. Reassess finding 3.”

That is high-value evidence, and a resumed session already knows why the finding was made. Today a fresh one-shot either spends heavily rereading the tree or receives a leading summary written by the orchestrator.

But resumed review should have a narrow role:

- Preserve the first verdict unchanged.
- Record the follow-up as an addendum.
- Ask the reviewer to reassess, not defend.
- Use it for factual disagreement, missing evidence, or clarification.
- Use a fresh session after code changes. A resumed session should not approve a patch made in response to its own finding.

I ran `codex exec resume --help`; resume by session ID is present. I also inspected the wrapper: it neither captures a thread ID nor exposes resume. Adding this means capturing the `thread.started` event, preserving per-turn answer and activity files, and dealing carefully with credential fallback. That machinery is worthwhile, but only after the prompt and evidence problems below are fixed; a fresh one-shot follow-up works as an interim mechanism.

## 5. Spikes

Some spikes should go to Sol.

Good Sol spikes are those where cross-family priors matter and the result is executable: a concurrency interleaving, an API-shape experiment, a parser counterexample, a migration restored into a disposable database, or a test asserted to be mutation-sensitive.

Requirements depend on the spike:

- Pure spike: current scratch access is sufficient.
- Repo-native experimental edit: caller-created isolated worktree with `workspace-write`.
- Postgres/Supabase spike: constrained loopback plus a disposable database.
- External API spike: sanitised outbound environment and explicit permission to incur any cost.
- Visual/browser spike: keep with Fable/Sonnet, whose browser tooling is materially better suited.

Fable already has enough freedom. For design arbitration and idea generation, editing can help only when the question is best settled by a prototype. For review, I would still tell Fable not to edit the subject under review. Its full tool set is an advantage for spikes and browser evidence, not a reason to combine authorship and judgment.

## 6. `engineering-manager.md`

What it gets right is the two genuinely different review moments: design while it is cheap to change, and built code where implementation defects exist. The sampled reviews justify both. The background-upload plan review found architectural failures before construction; the pricing Stage 2 review found a P1 that did not exist in the plan.

What is missing:

- A capability table: static review, scratch tests, loopback integration, web research, browser work, and write-capable spikes require different environments.
- A required verification ledger: command, exit status, what ran or skipped, and what that result proves.
- A review-input contract: exact base/current revision, scoped diff or hash, previous findings verbatim, disposition of each finding, known baseline failures with raw output, and durable evidence paths.
- A distinction between plan review and executable review. “Tell it to run one test” is ritualistic when nothing relevant has been built.
- Instructions for challenged findings and a follow-up turn.
- A warning that network-enabled tests can mutate services even when the tree is read-only.
- A rule that browser evidence comes as screenshots/traces, not “browser verification succeeded.”

The fixed cadence is too rigid. “End of every stage, obligatory, however small” prevents convenient skipping, but also makes stage boundaries determine review spend. A 20–40 minute high-effort review of a mechanical stage has low marginal value and creates pressure to manufacture findings.

I would require:

- Plan review for every substantive plan.
- Code review of the first risky vertical slice.
- Code review at the final pre-merge state.
- Intermediate review when a stage changes auth, ownership, billing, migrations, concurrency, security, external calls, shared contracts, or when an earlier review requests it.
- Mechanical intermediate stages may be batched into the next review, using objective criteria rather than “felt small.”

The sample does not show that intermediate reviews are inherently rubber stamps: the storage Stage 1 review found three reproducible issues, while its Stages 2–3 review still found two smaller bugs. It does show diminishing returns, which argues for risk-triggered cadence rather than universal cadence.

## 7. What the orchestrator is wasting

The largest waste is prompt construction.

I scanned 236 review-prompt files:

- 41 are at least 20 KB.
- 22 are at least 50 KB.
- 7 exceed 100 KB.
- The largest is about 217 KB.
- 32 embed a fenced diff directly.
- At least 46 explicitly lead with the orchestrator’s suspicions or attack checklist.

Large inline diffs consume the same context needed to investigate outside the expected path. They also helped produce the documented 279,000-token run that compacted and then exhausted its credential. Give the reviewer an exact diff path or base/head pair and a digest; do not paste 200 KB into the prompt when the tree is readable.

Other waste:

- **Leading with ten suspicions.** The background-upload prompt was excellent requirements material, but much of the review budget converted the orchestrator’s own doubts into findings. Fix known doubts first, then ask me to break the repaired design.
- **Too many prescribed files and questions.** They focus me on the orchestrator’s field of view—the exact place a second family is least valuable. Reserve part of the prompt for invariants and evidence, then explicitly ask for an independent pass outside the checklist.
- **Conclusions instead of artifacts.** “Browser verification succeeded,” green counts, and attributed baseline failures are not substitutes for screenshots, traces, or captured output. The pricing review caught that final screenshot evidence was absent.
- **No per-finding disposition.** “All six findings fixed” forces rediscovery. Supply the prior findings verbatim with `fixed / disagreed / not attempted`, the exact change, and the mutation result.
- **Ephemeral evidence.** Several prompts point to temporary scratch diffs while the durable review contains only conclusions. Preserve a compact evidence manifest even if the large activity log remains temporary.
- **Over-broad final reviews.** Reviewing four stages at once can find cross-stage bugs, but it should not replace focused reviews at the risky seams.
- **Unverified external citations.** If current provider behavior matters, supply the fetched official page or grant a safe web-only run. Do not infer that a plausible URL means I visited it.

## Ranked recommendations

1. **Adopt a compact review-input contract.**  
   Change: exact revisions/diff, invariants, raw evidence paths, prior findings with dispositions, and independent-review budget; stop embedding huge diffs.  
   Cost: a small prompt template and some orchestrator discipline.  
   Risk: an over-terse prompt can omit product intent, so keep the governing intent and exclusions.

2. **Keep the tree read-only and formalise scratch reproductions.**  
   Change: standard per-run scratch directory, documented temporary Vitest/script recipes, and artifact paths in the verdict.  
   Cost: minor wrapper/docs work.  
   Risk: scratch harnesses can diverge from production wiring; findings must state what boundary was mocked.

3. **Replace universal stage review with objective risk-triggered cadence.**  
   Change: always plan, first risky slice, final code; intermediate reviews for named risk classes or requested follow-ups.  
   Cost: choosing and documenting the criteria.  
   Risk: permissive criteria become an excuse to skip; make them mechanical and auditable.

4. **Build a secret-free, loopback-constrained review environment.**  
   Change: allow targeted DB/service tests and typechecking without outbound internet or production credentials.  
   Cost: container/network-namespace and disposable-service work.  
   Risk: an alleged restriction that is not positively tested is worse than none; add both loopback-success and external-denial controls.

5. **Add one-turn review follow-up support.**  
   Change: capture session IDs and allow a recorded disagreement/reassessment turn; use fresh sessions after code changes.  
   Cost: wrapper complexity around JSON events, output files, and credential fallback.  
   Risk: anchoring and self-defence if resume is used for acceptance rather than clarification.

6. **Use Sol for executable technical spikes in isolated worktrees.**  
   Change: dispatch cross-family spikes where a concrete experiment can settle a design claim; keep browser spikes with Fable/Sonnet.  
   Cost: worktree provisioning and explicit capability selection.  
   Risk: a spike can quietly become an implementation; label its result as evidence or proposal, never landed code.

7. **Do not add unrestricted `review-net` on the current host.**  
   Change: external research happens in a clean environment, or the orchestrator supplies primary-source material.  
   Cost: less convenient than one permissive switch.  
   Risk: slower verification of current APIs, but substantially lower credential and production-data exposure.