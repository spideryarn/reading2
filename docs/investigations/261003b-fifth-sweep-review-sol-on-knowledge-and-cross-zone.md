# GPT Sol's review of the knowledge and cross-zone investigations

Read-only cross-family review, 2026-10-03. Part of the [fifth sweep](../plans/261003f-fifth-codebase-sweep-umbrella.md); the umbrella carries the corrections. Paths and line numbers are as of `59bd41171`.

Both docs contain useful findings, but need corrections before they become an umbrella plan. The four stated T0 defects are reproducible. X3’s headline is too broad; X4 and X11 also describe reachable defects and should be T0. Several proposed guards or fixes do not cover the paths their prose claims.

I reviewed the current tree at `59bd411712e4861e3d03a85d25b9f8d88d9797a5`, without modifying files, invoking deployment, or making paid calls. The referenced `I-*` probe scripts were absent, so I reproduced the important cases independently. For documentation gaps, I inspected the owning docs’ headings and relevant sections, rather than relying on phrase searches.

**The T0 reproductions**

- **X1:** The extracted deploy parser leaves both `DRY_RUN` and `VERIFY_ONLY` false for `--verify-onyl`, `--dryrun`, and `--dry_run`. Local npm argument parsing also consumes `npm run deploy --verify-only`, leaving the script no positional flag. Properly passing `-- --verify-only` preserves it. The reachable continuation is `main` → preflight/gates → migrations → production push. No deployment was invoked.
- **X3:** Using the real storage normalization, decoder, and scanner with local strings, UTF-8 source without a charset declaration produced **zero Unicode-obfuscation findings**; the same source with UTF-8 metadata produced **two**. An ASCII instruction in a hidden paragraph remained detectable without the metadata. Thus the Unicode scan is bypassed, rather than the entire scanner becoming blind.
- **X10:** The dirty-field unmount path reaches the keepalive save without invalidation. Separately, I reproduced an older in-flight summary completing after `forgetSummaries()` and repopulating the cache; the next read reused it without fetching.
- **X12:** With a 20px root font, `scroll-mt-24` places the heading at 120px. The actual contents-selection function still compares against 100px and selects the previous section. This was a geometry reproduction, not a browser run.

**Corrections that materially change the proposed work**

X1’s fix must handle **npm swallowing a misspelled flag**, not merely unknown script arguments and known `npm_config_*` spellings. Checking `npm_config_verify_only` would still miss `npm_config_verify_onyl`, with an empty script argument list defaulting to deployment. Test these two mistakes in combination. A small explicit mode parser is worthwhile; a generic argument library is unnecessary.

X10 is not a two-line fix. Clearing completed entries does not fence old streams, clear their partial results, or establish that the profile write has persisted. A small cache generation/ownership fence is justified by the reproduced race. A broader cache framework is not.

The timeout downgrades in **X13e and X13k are wrong**. Undici’s body timeout is an inactivity timeout refreshed by arriving chunks, so a trickling body can outlive the deploy poll indefinitely. Vercel’s server duration limit does not impose an overall deadline on a browser’s connection or response-body read.

For the proposed abstractions and guards:

| Proposal | Worth its keep? |
|---|---|
| K12: remove the copied interface | Yes. Keep explanatory prose and point to the authoritative type. |
| K13: share migration constants | Yes, by importing existing constants where compatible. A second checker is unnecessary. |
| G1: prohibit synchronous children in long-running processes | Yes, after covering the actual composition roots and injected callbacks. Reuse the existing import walker. |
| F1: structured-output census | Potentially. Count actual imports/calls; a file containing an adapter name is insufficient evidence that every call uses it. |
| D1: exhaustive-dependencies gate | Yes, after addressing or explaining the 13 current diagnostics. Use existing check machinery. |
| E1: blanket `import.meta.url` ban | No demonstrated present need. Restrict any rule to a proven incompatible loader path. |
| E3: tracked-fixture-path checker | Hold. No second current instance justifies its exceptions and parsing complexity. |
| X4/X5: run ownership and marker lifetime | Yes. Reuse Criteria’s attempt fencing and Search’s lifetime pattern; avoid a generic registry framework. |
| X6/X7/X9/X13d | Yes: reuse the existing dispatcher, admission helper, failure helper, and environment parser. |
| X11: regeneration hold | Yes, but preserve each panel’s behavior rather than introducing a generic artifact-hook factory. |
| X13a/b/c | Small local typing improvements are reasonable. The union must survive downstream `Pick` types; `$type` supplies static typing, not database validation. |
| X13i | Strengthen the existing smoke test’s observation sequence; no new test framework is needed. |
| X13m | Hold broader type/translator restructuring until an actual inconsistency is demonstrated. |

I found no clear resurrection of an earlier rejected item **with the narrow scopes above**. Broader versions would repeat previous rejections: generic registry wrappers, a generic artifact factory, noisy whole-tree checks, or wholesale stale-document rewriting. M7’s NUL guard already shipped; this is a signpost task. The heading-anchor problem is already queued. The proposed new postmortem-status inventory duplicates existing deferred-work machinery.

There is also a policy error in the knowledge doc: “not a rule doc” cannot be inferred from a file living outside `docs/reusable/`. M3–M5 change instructions. Conversely, K8’s proposed signpost does not automatically require approval merely because its destination is an entry point.

**What the knowledge doc missed**

1. **Asynchronous work can escape its owner after aggregate rejection.** The distinct [aggregate-rejection postmortem](../../docs/postmortems/261002e-an-aggregate-rejection-does-not-settle-its-descendant-work.md) belongs beside Class G. [quick-search.ts](../../src/quick-search.ts:292) now cancels and drains recursive children, and drains top-level tasks before the collector closes. This expands the class beyond synchronous-child timeout behavior without requiring a task-tree abstraction.
2. **Consolidation can preserve the survivor’s omissions.** The [new consolidation postmortem](../../docs/postmortems/261003a-consolidating-duplicate-controls-keeps-the-survivors-omissions.md) identifies lost stalled/failure behavior. This directly matters to the sweep’s deletion proposals: compare behavior states before choosing the surviving implementation.
3. **The merge instructions contradict each other.** [version-control.md](../../docs/project/version-control.md:234) still describes a Greg round trip for every conflict. The reusable conflict procedure now authorizes agents to resolve conflicts, escalating actual product trade-offs.
4. **Migration-name duplication affects the live deploy path too.** [deploy.ts](../../scripts/deploy.ts:1104) hardcodes the schema/table in two SQL queries. K13 focuses on Drizzle configuration while missing this operational consumer of the same constants.

Its **“one level up” verdict is mostly right**: source owns implementation facts; project docs should supply discovery and intent. The proposed half-day status inventory is not justified. Put concrete accepted defenses into the existing queue with evidence links. Another prose status surface can become the same unchecked inventory the repo warns about.

**What the cross-zone doc missed**

1. **Summary invalidation lacks an in-flight fence**, including on ordinary successful saves. [forgetSummaries()](../../src/web/link-facts.ts:705) clears completed entries; an older stream later writes at line 800. This is broader than the omitted keepalive call.
2. **Claims can fingerprint different input from what the model receives**, even with only one run. [runRefereeClaims()](../../src/routes.ts:4839) loads blocks before `begin`; [begin()](../../src/store/pg-referee-claims.ts:178) independently fingerprints the current revision. Re-extraction between those operations can label an old-input answer with a new-input hash. An attempt token alone does not fix this.
3. **The stronger deploy verifier still accepts a broken JavaScript response.** [verifyPage()](../../scripts/deploy.ts:1507) accepts any asset body returning 200 and containing no detected secret. A SPA fallback returning HTML for a JavaScript URL can satisfy that check. Retiring X2’s weaker script does not close this gap.
4. **Its proposed parser defense omits the combined swallowed-typo case.** Unknown script-argument rejection and a list of known npm configuration flags each miss that case independently.

Its **“one level up” verdict is partly right**: deploy’s mode selection is the immediate dangerous front door. But “every judgement” being a tested pure function overclaims the evidence, particularly for served assets and transport behavior. “A test iterating siblings is always cheapest” also overclaims: X10 requires ownership semantics, and X4 requires snapshot identity. No T3 rewrite is warranted.

The following table covers every numbered finding and the two unnumbered proposals. “Unchanged” retains the doc’s score; “hold” means the evidence does not justify building it now.

| Finding | Verdict | Corrected tier / effort / value | Reason and current evidence |
|---|---|---|---|
| K1 | CONFIRMED | Unchanged | Direction doc says concurrent accounts were untested; `claude-accounts.ts` and account routing exist. The Hetzner session section lacks `--account`; removal is documented separately. |
| K2 | OVERSTATED | Unchanged | Register has **5**, not prose’s **2**. But `run-claude.ts` appears **3 times** in project docs, rather than zero. Point to `UNMETERED_SPEND`, not another list. |
| K3 | CONFIRMED | Unchanged | `dictation-codes.test.ts:51` scans **src and tools**; dictation’s owning section says src only. `[mic-bad-request]` exists in fleet transcription and lacks its table row. |
| K4 | CONFIRMED | Unchanged | `fleet-attention.test.ts` has **10** allowed Overseer modules and a closure-equality assertion; the owner’s import-boundary section documents only tools→src. |
| K5 | CONFIRMED | Unchanged | Commit `a07b9528` records caveat-placement arbitration; the owner’s “Absence” section does not carry that rule. |
| K6 | OVERSTATED | Unchanged | Fleet CSS has a stretched overlay and raised controls. The practical checklist gap is real; `position: relative; z-index: 1` is one sufficient implementation, not the universal prerequisite asserted. |
| K7 | CONFIRMED | Unchanged | Hetzner’s tailnet instructions omit phone microphone HTTPS requirements. Dictation documents secure-context behavior; direction already mentions `tailscale serve`, so add an operational signpost. |
| K8 | CONFIRMED | Unchanged | Queue/Decisions reject writes because the dashboard lacks authentication. The queue owner omits the rationale, but `security-map.md` already explains impersonation risk: link rather than duplicate. |
| K9 | CONFIRMED | Unchanged | Project docs lack pause implementation references and the launch-protocol signpost. Existing source/plans supply the substance. |
| K10 | CONFIRMED | Unchanged | `decisions.ts:1271` describes departure from a queue baseline that `idea-queue.ts:1629` no longer uses. Delete the stale explanation. |
| K11 | CONFIRMED | Unchanged | Feedback’s owner says production deployment stays Greg’s; the Overseer deployment section assigns it to the Overseer. |
| K12 | CONFIRMED | Unchanged | `types.ts` includes `question`; the copied Node shape omits it. No equality gate protects the copy. Delete the duplicated interface rather than synchronize it. |
| K13 | CONFIRMED | Unchanged | Drizzle configuration duplicates canonical migration schema/table constants. No present divergence was found; direct reuse passes the deletion test. |
| M1 | OVERSTATED | T1 / S / medium | Provenance warnings are missing, but the historical survivor is not demonstrated in today’s wrapper: detached process-group termination and unique internal answer files already exist. “Likely upstream” misattribution is conjecture. |
| M2 | CONFIRMED | Unchanged | Delegate’s owning section lacks the three specific brief/fallback/background-completion lessons. Preserve their harness limitations when transferring them. |
| M3 | CONFIRMED | Unchanged | Version-control’s relevant sections lack wake synchronization and the recorded failed-merge recovery case. Historical reproduction does not establish that ordinary dirty merges universally erase work. |
| M4 | CONFIRMED | Unchanged | The tick section does more than omit the newer instruction: it explicitly contains the older seven-day rationing policy. Replace the contradiction rather than append both. |
| M5 | CONFIRMED | Unchanged | Hetzner documents token placement/risk acceptance, but not the memory’s explicit per-action permission restriction. Its rule wording needs the appropriate editing procedure. |
| M6 | OVERSTATED | T1 / S / low | The memory’s later measurement retracts the blanket claim: background waiters died while Monitor survived. Two Cron entries share session failure; they are not independent durable mechanisms. |
| M7 | CONFIRMED | Unchanged | The NUL guard exists; testing’s owning sections omit its name and diagnostic signature. Its current scan includes tracked and nonignored untracked files. |
| M8 | OVERSTATED | T1 / S / low | The owners already teach absent-state checks, independent evidence, and misleading same-shaped samples. These are useful examples, not four demonstrably new classes. |
| Heading-anchor lead | CONFIRMED | T1 / S / low; already queued | Testing’s single-hyphen advice conflicts with the later memory. Explicit stable anchors are already supported; avoid reopening a broad slug-system rewrite. |
| G1 | OVERSTATED | T1 / S–M / medium | Census gives **130 call-shaped matches, 44 timed, 18 tools sites**. The exposed table sums **14**, not 13. Proposed roots miss callbacks injected by `scripts/overseer.ts`; one cited regression lies outside them. |
| G2 | OVERSTATED | T1 / S / low | `work-probe.ts` checks `error` before the timeout-message branch. Reordering improves a returned diagnostic; it cannot free `spawnSync` when a child ignores termination. |
| E1 | OVERSTATED | Hold; T1 / S / low | Six text hits contain **4 executable URL constructions and 2 comments**. No present incompatible jsdom import path was demonstrated. |
| E2 | CONFIRMED | Unchanged | Testing’s mocks section lacks the specific live-checkout-default and gitignored-corpus postmortem links, although it already discusses related general hazards. |
| E3 | UNVERIFIABLE | Hold | No second live fixture-path defect is established. A prospective checker needs generated/temporary-path exceptions and is not yet worth maintaining. |
| F1 | OVERSTATED | T1 / S / medium | `parseJsonAnswer` has **19 actual importers**, not 21: search and repair-log matches are comments. Prompting-guide already names exception categories. A textual adapter-presence check cannot establish call coverage. |
| D1 | CONFIRMED | Unchanged | Focused Biome execution reports **13 diagnostics: 3 missing dependencies, 10 extra dependencies**. Intentional triggers require explanation/suppression before introducing the gate. |
| X1 | CONFIRMED | T0 / S–M / high | Extracted parser and npm parser reproduce real-mode selection from typos/swallowed flags. Main reaches migrations and the production push after its gates. Proposed fix misses swallowed typos. |
| X2 | CONFIRMED | Unchanged | Executing the actual shell script with in-memory fake curl responses passes both a 200 non-app page with no assets and failed asset fetches. No current caller was found. Reuse deploy verification. |
| X3 | OVERSTATED | T0 / S / high | Stored bytes are normalized UTF-8; `source-scan.ts:185` sniffs them again without a header. Unicode attacks disappear without UTF-8 metadata; ASCII hidden-text detection still works. |
| X4 | CONFIRMED | **T0 / M / medium** | Two tabs can call `begin`; `finish` updates by article ID with neither attempt nor pending guard (`pg-referee-claims.ts:265`). An old answer can overwrite the newer run. |
| X5 | CONFIRMED | Unchanged | Criteria/Claims delete live markers before awaited `finish`. Search supplies the existing lifetime pattern. Grace windows limit some consequences; immediate orphan recovery is not universally implied. |
| X6 | CONFIRMED | Unchanged | Recount gives **16** route wrappers splitting capture/response and spend ownership. Existing dispatcher already combines them; this is not double charging. |
| X7 | CONFIRMED | Unchanged | `chargeAndSwitch` duplicates resynchronization/stale handling supplied by `admitOrResync`. Reuse the existing admission helper. |
| X8 | CONFIRMED | Unchanged | `isAllowed` is constant true; its shared-shelf explanation is obsolete. Deletion also requires updating auth/security pointers that currently name it. |
| X9 | CONFIRMED | Unchanged | **14 hooks** display raw error messages rather than using existing failure classification/reporting. Test branded transport failures separately from unbranded `TypeError` programming faults. |
| X10 | CONFIRMED | **T0 / M / medium** | Keepalive saves omit invalidation; old in-flight streams also refill a cleared cache. The proposed two-line patch leaves the reproduced defect. |
| X11 | CONFIRMED | **T0 / M / medium** | Six panels’ regeneration predicates were checked; five lack Quiz’s replacement-read hold. A completed job plus delayed/failed GET re-enables another paid run against the old artifact. |
| X12 | CONFIRMED | Unchanged | Metadata uses `scroll-mt-24`; PageContents uses fixed **100px**. At a 20px root font, the reproduced 120px target leaves the previous section selected. |
| X13a | CONFIRMED | Unchanged | **3** unchecked effort casts exist in models/citations/skim. A small shared closed-value parser is justified; local unset variables do not establish every deployment’s configuration. |
| X13b | CONFIRMED | Unchanged | Invalid combinations are representable, while current producers are correlated. Downstream `Pick<FetchedDocument, …>` also needs adjustment or it erases the proposed union’s correlation. |
| X13c | CONFIRMED | Unchanged | **15 casts across 5 readers**; schema already uses `$type` **43 times**. Reuse it on the three columns, without claiming runtime validation. |
| X13d | OVERSTATED | Unchanged | Parser differences and checkout-fallback differences are confirmed. “Fails closed” is not guaranteed when malformed input is transformed into another usable value. Reuse `parseEnvFile`/`readEnvProd`. |
| X13e | WRONG | **T1 / S / medium** | No fetch signals is confirmed; the downgrade’s total-bound claim is false. Bundled Undici refreshes its body timer on chunks, permitting an indefinitely trickling body. |
| X13f | CONFIRMED | Unchanged | `stage.ts` ignores misspelled flags and extra positional arguments. A local arity/flag check suffices. |
| X13g | CONFIRMED | Unchanged | Fake string `"false"` is treated as enabled; missing GitHub passes the OFF control. This is mechanically reproducible, without evidence that today’s service returns those shapes. |
| X13h | CONFIRMED | Unchanged | Manual query construction truncates a query-bearing redirect URI and introduces stray parameters. Existing curl URL encoding solves it. |
| X13i | CONFIRMED | Unchanged | Extracted smoke logic passes both instances against a shared page when starts are staggered. Both current registrations have `--isolated`; the observation sequence still does not prove isolation. |
| X13j | UNVERIFIABLE | Hold | Direct-child kill is visible. Whether a real provider descendant survives EOF and termination was not established; no real orphan was reproduced. |
| X13k | WRONG | **T1 / S / low–medium** | `useSourceScan.ts:59` has no client deadline. Server `maxDuration: 800` does not bound the browser transport/body read. Reuse finite-read machinery where applicable. |
| X13l | CONFIRMED | Unchanged | `useOrderedRead` says nothing calls `discard`; `useClaims` uses it as effect cleanup. Update the comment. |
| X13m | CONFIRMED | Hold broader changes | Invalid Mark combinations are representable and two translators exist; no actual drift was found. A focused contract test may be useful; speculative restructuring fails YAGNI. |
| PRODUCT: remove `spine=0` | OVERSTATED | PRODUCT / M / low; benefit unverified | The option is read and remembered, with **5 `spineParam` references** and no current UI writer. That proves a retained link capability, not that removing it benefits readers. |
| PRODUCT: verify-only `--host` | CONFIRMED | Fold into X1 | Existing deployment documentation already describes host selection as verification. Treat the misleading mode behavior as part of parser repair, rather than a separate speculative product simplification. |