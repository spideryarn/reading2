# GPT Sol's breadth nominations, zone by zone

The wide, cheap pass, 2026-10-03; every item was then verified in the deploy-scripts-and-cross-zone doc or one of the area docs. Part of the [fifth sweep](../plans/261003f-fifth-codebase-sweep-umbrella.md); the umbrella carries the corrections. Paths and line numbers are as of `59bd41171`.

The highest-value nominations are silent failures: stored HTML being decoded incorrectly, stale Referee results being accepted, deployment flags failing open, checks passing without checking their target, and eval comparisons losing their controls.

This was read-only. Reproductions used local strings, extracted functions, or fake transports; no deployment, production write, or paid model call was performed.

**Evidence:** **R** = reproduced locally; **C** = proved from code with the call path; **H** = hypothesis requiring measurement. Ratings are **effort / value / risk**. Findings are ranked within each zone.

**Prior decisions checked**

I searched `docs/plans/*sweep*.md` and `docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md` before retaining proposals, using identifiers and broader descriptions, for example:

```sh
rg -n -i 'refereeing|attempt|sourceHash|resyncAndRetry|isAllowed' \
  docs/plans/*sweep*.md \
  docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md

rg -n -i 'describeFetchFailure|forgetSummaries|rewriting|REACHED_PX|spine' \
  docs/plans/*sweep*.md \
  docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md

rg -n -i 'verify.only|check-production-gate|envFile|remote-smoke|frozen|sourceSha|assembleTree' \
  docs/plans/*sweep*.md \
  docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md
```

Skipped prior rejected or completed proposals: wholesale component/style splitting; a generic mode registry or artefact-hook factory; blanket hook deduplication without drift; generic timer extraction; generic wrappers around the mutable route registries; `httpError` deduplication; blanket abort-on-unmount; indiscriminate unused-export pruning; glossary-occurrence tab stops; and the already implemented Stripe Portal feature guard. The targeted Referee lifetime finding below is narrower than the rejected registry-wrapper proposal.

**Zone 1 — server pipeline and store**

1. **Stored HTML is decoded using its obsolete charset declaration.**  
   [src/source-scan.ts:185](../../src/source-scan.ts:185), `src/fetch.ts:273`, `src/store/pg.ts:2687`. Fetch stores decoded HTML as UTF-8, retaining the original `<meta charset>`. `loadSource → scanArticleSource → decodeHtml(bytes, null)` then obeys that old declaration. A UTF-8 stored document declaring Windows-1252 changed `Résumé “café”` into `RÃ©sumÃ© â€œcafÃ©â€`. **Evidence: R**, with the route-to-store path proved. **Cheapest fix:** decode stored HTML as UTF-8 at this boundary; preserve charset sniffing for network responses. Add a storage round-trip regression. **S / high / low.**

2. **The effort environment override lies to the type system.**  
   [src/models.ts:1941](../../src/models.ts:1941), `src/citations.ts:1830`, `src/skim.ts:1090`. Casting the environment string to `Effort` accepts arbitrary values. Setting it to `not-an-effort` made `effortFor("quiz")` return that value; callers place it in the model request. **Evidence: R** for acceptance; provider consequences were not tested. **Cheapest fix:** one narrow parser in the existing model configuration home, reused by the direct consumers, rejecting invalid values before a paid request. **S / med / low.**

3. **`FetchedDocument` permits HTML without decoded text.**  
   [src/fetch.ts:56](../../src/fetch.ts:56), `src/fetch.ts:281`. `kind`, nullable `text`, and nullable encoding are independent fields. A type-valid HTML document with `text: null` reaches `storedDocumentBytes`, whose fallback silently stores empty content. Current fetch producers appear consistent. **Evidence: C** for the permitted state and storage path; a malformed producer is **H**. **Cheapest fix:** a discriminated union requiring text for HTML, and preserve that correlation in the storage argument type. Remove the empty-string fallback. **S / med / low.**

4. **Closed block values become unrestricted strings at the database boundary.**  
   [src/db/schema.ts:1276](../../src/db/schema.ts:1276), also `:1296–1297`. SQL CHECK constraints close `kind`, `role`, and `treatment`, but Drizzle exposes strings. Readers recover `kind` through assertions, allowing invalid writes to compile and fail later. **Evidence: C** from schema, constraints, and reader mappings. **Cheapest fix:** apply the existing `$type<…>()` mechanism using the domain unions; retain SQL constraints. **S / med / low.**

5. **A step’s declared outputs and returned artefacts are independent types.**  
   [src/pipeline.ts:806](../../src/pipeline.ts:806), `:810`, `src/store/session.ts:382`. `produces` lists artefact kinds, while `ConvertedProduct.parts` permits an unrelated partial set. A stage can compile while omitting its promised output; `checkProduct` catches it only after execution. **Evidence: C** for the declaration-to-validation path; no current malformed stage found. **Cheapest fix:** tie the existing step type’s return shape to its declared kinds, without introducing another registry. Keep runtime validation for unchecked inputs. **M / med / med.**

Counts supporting this zone:

```sh
rg -n 'SPIDERYARN_PIPELINE_EFFORT as Effort' src
# 3 sites

rg -n 'kind: row.kind as (Block|PublicBlock)' src/store
# 5 sites: artifacts-pg, pg-revisions, pg, export, public-reader
```

**Zone 2 — HTTP routes, auth, billing, security boundaries**

1. **Referee live markers expire before persistence, unlike the repaired Search path.**  
   [src/routes.ts:4708](../../src/routes.ts:4708), `:4737`, `:4844`, `:4879`; `src/store/pg-referee-criteria.ts:387`. Criteria and Claims add their marker before SSE setup, then delete it before `finish`. A GET sweep during that gap can invalidate a still-finishing criterion; an SSE setup exception bypasses cleanup. Search’s holder-aware outer `finally`, repaired in `1714d1aa3`, covers both setup and persistence. **Evidence: C**, including the sweep interleaving and demonstrated sibling drift. **Cheapest fix:** extend the existing lifetime through persistence and use holder identity where runs overlap; test setup failure and delayed finish. **S / high / med.**

2. **A stale Claims answer can acquire a newer article fingerprint.**  
   [src/store/pg-referee-claims.ts:232](../../src/store/pg-referee-claims.ts:232), `src/routes.ts:4835`. `begin` replaces `sourceHash`; `finish` updates by article ID without an attempt fence. Schedule: A starts on old source, B begins on new source, A finishes and writes its old claims into B’s row while preserving B’s hash. The justification cites parity with the deleted filesystem store. **Evidence: C** from the update predicates and reachable overlapping requests. **Cheapest fix:** adopt Criteria’s attempt token and reject stale finishes. **M / high / med.**

3. **Mandatory attempt tokens remain optional in store interfaces.**  
   [src/store/contracts.ts:1182](../../src/store/contracts.ts:1182), `:1267`; `pg-searches.ts:354`, `pg-referee-criteria.ts:275`. Postgres rejects missing tokens, while types let callers omit them. The optionality preserves an obsolete store distinction. **Evidence: C**; current route callers supply tokens. **Cheapest fix:** require tokens in the existing begin/finish contracts; keep runtime guards for unchecked callers. **S / med / low.**

4. **Finish arguments permit pending states and fields they cannot update.**  
   [src/store/contracts.ts:1181](../../src/store/contracts.ts:1181), `:1266`. `Partial<SearchRun>` and `Partial<SavedCriterion>` permit missing or pending status and identity/configuration fields. Implementations reject some combinations and ignore unrelated fields. **Evidence: C** from the contracts and finish implementations. **Cheapest fix:** explicit terminal-result unions containing only writable fields, requiring `done` or `error`. **S / med / low.**

5. **Invalid-slug refusals copy arbitrary caller text into logs.**  
   [src/public/routes.ts:351](../../src/public/routes.ts:351), `src/routes.ts:5062`, `:7103`. The exception interpolates the decoded value. Dispatch passes it to `logRequest`, which records the message under `reason`; Pino’s path-based redaction does not redact that field. This contradicts the logger’s explicit “only words we chose” invariant. **Evidence: C**, through public dispatch, error classification, and stdout logging. **Cheapest fix:** fixed refusal wording and a regression containing a private marker in the rejected value. **S / med / low.**

6. **Route attribution and handler attribution duplicate the same job.**  
   [src/routes.ts:8619](../../src/routes.ts:8619), dispatcher `:10443`. Routes declaring `article: "first-capture"` already receive attribution, yet their handlers wrap it again. Collector overlay prevents double charging; the problem is competing edit locations. **Evidence: C** for redundant mechanisms; future drift is **H**, not an observed billing defect. **Cheapest fix:** delete redundant handler wrappers while retaining body/query-derived attribution. **S / med / low.**

7. **High-power admission reimplements the existing resynchronisation policy.**  
   [src/billing/admission.ts:505](../../src/billing/admission.ts:505), helper `:217`. High-power admission calls `resyncAndRetry` directly and repeats policy already expressed by `admitOrResync`. **Evidence: C** for overlapping mechanisms; no behavioural drift proved. **Cheapest fix:** route it through the existing helper if its current semantics match, rather than adding a broader admission framework. **S / med / low.**

8. **The beta gate is dead and its explanation describes obsolete ownership.**  
   [src/auth.ts:303](../../src/auth.ts:303), `:314`, `:377`. `isAllowed` always returns true, leaving the private-beta refusal unreachable. Its comment says ownership is process-wide and readers share a shelf, contrary to the current owner-filtered architecture. **Evidence: C** from the constant gate and live ownership path. **Cheapest fix:** delete the speculative gate and unreachable refusal; remove the obsolete explanation. **S / low / low.**

Counts:

```sh
rg -c 'attempt\?: string' \
  src/store/pg-searches.ts src/store/pg-referee-criteria.ts
# 1 in each implementation

rg -n 'patch: Partial<SearchRun>|patch: Partial<SavedCriterion>' \
  src/store/contracts.ts
# 2 finish contracts

rg -n 'Not a slug:.*JSON.stringify' src/routes.ts src/public/routes.ts
# 2 sites
```

For attribution, the grep finds candidates; the structural filter excludes comments and routes whose handler legitimately owns attribution:

```sh
rg -n 'article: "first-capture"|withSpendAttribution\(' src/routes.ts
python3 - <<'PY'
import re
from pathlib import Path
text = Path("src/routes.ts").read_text()
start = text.index("const AUTH_ROUTES:")
end = text.index("assertDispatchableRoutes(AUTH_ROUTES)", start)
table = text[start:end]
rows = list(re.finditer(r"\n  \{\n    kind:", table))
count = 0
for i, match in enumerate(rows):
    stop = rows[i + 1].start() if i + 1 < len(rows) else len(table)
    row = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", table[match.start():stop])
    count += bool(re.search(r'\barticle:\s*"first-capture"', row)
                  and re.search(r"\bwithSpendAttribution\s*\(", row))
print(count)
PY
# 16 redundant route/handler pairs
```

**Zone 3 — web client**

1. **Load hooks bypass the established failure boundary.**  
   [src/web/useIdeas.ts:184](../../src/web/useIdeas.ts:184), `IdeasPanel.tsx:245`, `lib/describe-failure.ts:35`. Raw `(err as Error).message` goes into reader-facing state. In Ideas, a malformed successful payload can throw during profile-hash handling and expose a programming exception. The repaired boundary reports programming faults and supplies a reader-safe failure. **Evidence: C**, with a concrete parse/use/catch/render path; occurrence in production is **H**. **Cheapest fix:** reuse `describeFetchFailure`, with representative transport and malformed-success tests. **S / high / low.**

2. **Last-chance profile and purpose saves omit cache invalidation.**  
   [src/web/useProfile.ts:63](../../src/web/useProfile.ts:63), `purpose.ts:52`, `useAutosavedText.ts:259`. Ordinary saves call `forgetSummaries`; keepalive saves do not. Component unmount can trigger this path while the SPA remains open, leaving old link summaries in the in-memory cache despite a successful save. **Evidence: C**, including the cache-hit-before-fingerprint path in `link-facts.ts:746`; clear sibling drift. **Cheapest fix:** invalidate when issuing either save path; test dirty-field unmount followed by cache access. **S / high / low.**

3. **Summary and Ideas lack Quiz’s pending-replacement protection.**  
   [src/web/useQuiz.ts:438](../../src/web/useQuiz.ts:438), `SummaryMode.tsx:113`, `IdeasPanel.tsx:207`. Quiz retains a rewriting/held state until replacement data arrives. The other panels consider only the job/start state. Once the job disappears, a delayed or failed reload can expose the stale artefact’s regenerate control again. **Evidence: C** from job completion, reload, and button conditions; no mounted reproduction. **Cheapest fix:** retain an explicit replacement-pending state using Quiz’s demonstrated failure schedule; avoid a generic hook factory. **M / high / med.**

4. **Metadata’s rem-based landing position disagrees with its pixel threshold.**  
   [src/web/Metadata.tsx:3519](../../src/web/Metadata.tsx:3519), `PageContents.tsx:209`, `:342`. Scroll margin is `6rem`; “reached” means at most 100px. At a 20px root size, a clicked section lands at 120px and can leave the previous contents entry selected. The comments explicitly require these values to agree. **Evidence: C** from CSS units and threshold arithmetic; browser rendering not exercised. **Cheapest fix:** derive the threshold from the actual scroll margin plus slack, or enforce one unit-consistent token. **S / med / low.**

5. **Mark types permit appearance combinations their comments prohibit.**  
   [src/web/annotate.ts:199](../../src/web/annotate.ts:199). `MarkBase` exposes hit-only strength and quote-specific stroke fields independently of kind. The renderer can therefore receive contradictory wash/stroke states, despite an existing discriminated `MarkValence`. **Evidence: C** for representable invalid states; no current constructor violation found. **Cheapest fix:** extend the existing union with kind-specific fields and `?: never` exclusions. **S / med / low.**

6. **Source scanning can remain “Checking document” indefinitely.**  
   [src/web/useSourceScan.ts:53](../../src/web/useSourceScan.ts:53), `:59`; `SourceScanNotice.tsx:177`. The initial read has success, failure, and unmount handling but no finite deadline. A request that never settles leaves the notice pending. Other opening reads already have deadline machinery. **Evidence: C** for the missing bound and rendered state; frequency is **H**. **Cheapest fix:** use the existing finite-read mechanism and transition to the failure arm on timeout. **S / med / low.**

7. **Legacy Marginalia URLs have competing translation implementations.**  
   [src/web/Reader.tsx:354](../../src/web/Reader.tsx:354), `last-view.ts:269`. Live URL rewriting and saved-view migration separately decide removal, precedence, and conversion; sharing vocabulary does not enforce identical decisions. A comment says they must match. **Evidence: C** for two mechanisms; no drift proved. **Cheapest fix:** first add a paired contract test; if extracting the pure decision simplifies both callers, place it beside the existing parameter vocabulary. **S / low / low.**

8. **`discard()` has a false dead-code/YAGNI explanation.**  
   [src/web/useOrderedRead.ts:104](../../src/web/useOrderedRead.ts:104), `useClaims.ts:160`, `:176`. The comment says nothing calls it and defends keeping speculative functionality. Claims already uses it as effect cleanup to fence superseded generations. **Evidence: C** from the actual caller. **Cheapest fix:** replace the false explanation with the current lifetime contract. Keep the method. **S / low / low.**

9. **PRODUCT — consider removing the hidden spine-off setting.**  
   [src/web/params.ts:110](../../src/web/params.ts:110), `Reader.tsx:322`, `layout.ts:487`, `last-view.ts`. The visible control is gone, but `?spine=0` remains persisted and changes layout decisions. Removing it would reduce layout states and restoration behaviour. Hand-authored spine-hidden links would lose that preference. **Evidence: C** for retained behaviour; product value and usage are **H**, with no telemetry checked. **Cheapest fix:** decide whether the spine is always present, then handle legacy links explicitly. **M / med / med.**

Counts:

```sh
rg -l 'setError\(\(err as Error\)\.message\)' \
  src/web --glob '*.{ts,tsx}' | wc -l
# 14 files; this counts the exact raw-error idiom, not every failure path

rg -n '^export function leave(Profile|Purpose)|^export async function save(Profile|Purpose)|forgetSummaries\(' \
  src/web/useProfile.ts src/web/purpose.ts
# 2 ordinary saves invalidate; 2 last-chance saves do not
```

**Zone 4 — scripts and operational tooling**

1. **Mistyped inspection flags select deployment mode.**  
   [scripts/deploy.ts:177](../../scripts/deploy.ts:177), `:186`, `:1670`, `:1729`. Flags use `argv.includes` without rejecting unknown arguments. Extracting the actual parser showed that `--verify-onyl` and `--dryrun` leave both inspection modes false and select the production deployment path, subject to its subsequent gates. **Evidence: R** for parsing; deployment path **C**. **Cheapest fix:** strict argument parsing and an explicit operation union; reject typos before migration or push work. **S / high / low.**

2. **The standalone production gate can pass without finding an application.**  
   [scripts/check-production-gate.sh:53](../../scripts/check-production-gate.sh:53), `:87`, `:97`. A maintenance page with no JavaScript produces an empty asset loop and a clean verdict; failed asset fetches can become empty bodies. Fake `curl` responses made the actual script exit zero with “All checks passed.” Deploy’s verifier rejects missing roots, absent JavaScript, and bad asset responses—a fix reaching only that mechanism, visible in `3b22e5b7d`. **Evidence: R**, with proved drift. **Cheapest fix:** retire the competing verifier in favour of `deploy --verify-only`, retaining a compatibility wrapper if needed. **S / high / low.**

3. **The auth checker treats malformed JSON values as valid configuration.**  
   [scripts/check-remote-auth.sh:62](../../scripts/check-remote-auth.sh:62), `:68`, `:91`. It checks object existence and jq truthiness rather than boolean schema. Fake responses containing `"google": "false"` and no GitHub field passed with Google reported ON and GitHub OFF. **Evidence: R** using the actual script with fake transport. **Cheapest fix:** require the expected boolean fields and compare explicitly with `true`/`false`. **S / high / low.**

4. **The browser-MCP isolation check never observes isolation.**  
   [scripts/remote-smoke-mcp-browser.mjs:147](../../scripts/remote-smoke-mcp-browser.mjs:147), `:164`, `:226`. Each client checks its own navigation response and exits. A fake provider sharing one page passed both checks: A navigated, then B overwrote the shared page, but A was never read again. **Evidence: R** for the verifier’s false pass; real-provider sharing is **H**. **Cheapest fix:** keep both clients alive, navigate both, then reread each page. Preserve the shared-page fake as a negative control. **M / med / low.**

5. **Deployment and shell tools retain incompatible environment readers.**  
   [scripts/deploy.ts:250](../../scripts/deploy.ts:250), `check-remote-auth.sh:39`, `check-google-redirect.sh:28`; shared `src/env.ts:443`. The shared parser accepts exported, spaced, and single-quoted assignments; the alternatives do not. The actual parsers disagreed on `export DATABASE_URL='postgres://…'`. Shared parsing was improved in `75c2d1e35`, leaving these alternatives behind. **Evidence: R**, with proved drift. **Cheapest fix:** reuse existing parsing and production-file location rules while preserving documented precedence. **M / med / low.**

6. **A deployment HTTP request can outlive the enclosing polling deadline.**  
   [scripts/deploy.ts:291](../../scripts/deploy.ts:291), `:1288`, `:1367`. Polling checks elapsed time outside awaited fetch/body operations. Neither fetch has an abort deadline, so a stalled request can hold the deployment lock beyond the nominal limit. **Evidence: C** for the await/deadline path; actual stalls are **H**. **Cheapest fix:** bounded signals covering headers and body, respecting remaining polling time. **S / med / low.**

7. **The stage CLI silently discards unknown options and extra positionals.**  
   [scripts/stage.ts:510](../../scripts/stage.ts:510). It detects known flags, filters option-looking arguments, and consumes only selected positionals. `--froce` becomes an ordinary unforced run; extra ingest inputs are ignored. **Evidence: C** from parsing into stage dispatch. **Cheapest fix:** strict parsing and stage-specific positional arity before loading or invoking the pipeline. **S / med / low.**

8. **The OAuth diagnostic does not encode its callback query parameter.**  
   [scripts/check-google-redirect.sh:60](../../scripts/check-google-redirect.sh:60). Appending a callback containing `?next=a&x=b` to the outer query truncates `redirect_uri` and creates a separate outer `x` parameter. **Evidence: R** through offline URL parsing; no Google request sent. **Cheapest fix:** construct the query with `curl --get --data-urlencode`; test delimiter-bearing callbacks. **S / med / low.**

9. **MCP smoke cleanup targets the wrapper rather than its process tree.**  
   [scripts/remote-smoke-mcp-browser.mjs:114](../../scripts/remote-smoke-mcp-browser.mjs:114), `:118`, `:123`; caller `scripts/gjd-remote.ts:5266`. Cleanup calls `child.kill` without waiting or escalating. With an `npx` wrapper, descendants can survive. Subagent/readiness tooling already contains bounded process-tree cleanup. **Evidence: C** for incomplete cleanup; an actual orphan is **H**. **Cheapest fix:** use an owned process group and bounded TERM/close/KILL handling; test an uncooperative descendant. **S / med / med.**

Counts:

```sh
rg -n 'fetch\(' scripts/deploy.ts
# 2 sites, neither with an abort signal

rg -l 'function envFile|env_from_prod|grep.*\.env' \
  scripts/deploy.ts scripts/*.sh | wc -l
# 3 matching files in this explicitly scoped alternative-reader search
```

**Zone 5 — evals**

1. **The toc/10 “frozen” control imports a changing production prompt.**  
   [evals/structure-whole-document/toc10-frozen.ts:1](../../evals/structure-whole-document/toc10-frozen.ts:1), `:28`; `src/structure.ts:98`, `:222–224`; caller `model-arms.ts:1041`. It imports `TOC10_SYSTEM`, which interpolates live `plainWords()` and `paperwork("structure")`. Changes to either silently alter the historical control. The named investigation already records this caveat. **Evidence: C** through prompt construction and frozen-arm dispatch. **Cheapest fix:** pin the complete historical rendered prompt from the appropriate commit, with a fixed digest; pin other request components too where “exact historical request” is promised. **S / high / low.**

   **Census result: one affected frozen-prompt definition; zero additional definitions found.** Multiple runners using that definition are not separate frozen controls.

   ```sh
   rg --files evals -g '*.ts' -g '*.mts' -g '*.mjs' | wc -l
   # 163 executable source files

   rg -l -i 'frozen|baseline|old.?prompt|\bv1\b|freeze' evals \
     --glob '*.ts' --glob '*.mts' --glob '*.mjs' | wc -l
   # 66 vocabulary candidates, including unrelated API/version/corpus references

   rg -l 'TOC10_SYSTEM' evals \
     --glob '*.ts' --glob '*.mts' --glob '*.mjs' | wc -l
   # 1 importing definition

   rg -n '^import.*src/|await import\(.*src/' evals \
     --glob '*.ts' --glob '*.mts' --glob '*.mjs'
   # Used to trace candidate controls into live prompt construction.
   ```

   Checked exclusions: summaries’ shipped question/gist blocks are literal pinned text; its incumbent is explicitly live. Shelf-topic baseline explicitly means today’s implementation. PDF’s historical ladder is literal code. Dig-deeper’s “frozen” promise concerns research evidence, not an old system prompt. Plain-words, paperwork, and quiz before/after runs use temporal captures rather than claiming an immutable prompt definition. Their provenance weaknesses are separate findings below.

2. **Prompt provenance hashes omit imported prompt rules.**  
   [evals/plain-words/run.ts:342](../../evals/plain-words/run.ts:342), `answers.ts:120`, `evals/paperwork/run.ts:58`, `modes.ts:62`, `evals/quiz-reading-goal/run.ts:80`. Source lists hash selected generator files but omit shared rules their prompts consume. Editing an omitted rule changes requests without changing the recorded source fingerprint. **Evidence: C** from hash inputs and prompt imports. **Cheapest fix:** hash the actual rendered request at its assembly boundary, using existing digest utilities; avoid maintaining another transitive-source list. **M / high / low.**

3. **Comparison generation can silently select only successful matching cases.**  
   [evals/paperwork/run.ts:327](../../evals/paperwork/run.ts:327), `:347`; `modes.ts:213`. Missing counterparts and null results are skipped, while failures can be printed and omitted from totals. A polished comparison can therefore hide a changed denominator. Plain-words comparison code already rejects missing or lopsided inputs. **Evidence: C** from failure/skip/export paths and sibling guard drift. **Cheapest fix:** enforce requested case-set equality before export and report failures in the denominator; allow partial exploratory output only explicitly. **S / high / low.**

4. **Before/after comparisons do not consistently fence article inputs.**  
   [evals/paperwork/run.ts:84](../../evals/paperwork/run.ts:84), `:314`; `evals/quiz-build-up/run.ts:167`. Paperwork pairs by slug without a consumed-content hash; Quiz build-up loads current article evidence when judging older generated outputs. Re-extraction can change text while retaining identifiers. Plain-words Answers already rejects changed block hashes. **Evidence: C** for the unfenced comparison path; actual mismatched runs are **H**. **Cheapest fix:** record consumed article/tree/meta digests and reject mismatches; retain the generation-time judge evidence. **M / high / med.**

5. **Some source fingerprints are captured after generation.**  
   [evals/plain-words/artefacts.ts:266](../../evals/plain-words/artefacts.ts:266), `:357`. The generator is already loaded and the model call completed before `sourceShaFor` rereads disk. A concurrent edit can label an old loaded prompt with a newer source hash. Quiz reading-goal already snapshots before work and rejects subsequent movement. **Evidence: C** for the schedule; no concurrent-edit reproduction. **Cheapest fix:** record the rendered request digest when sending it; the cheaper interim repair is before/after source checking using the existing pattern. **S / med / low.**

6. **Prompt arm types permit mutually exclusive selections.**  
   [evals/summaries/arms.ts:92](../../evals/summaries/arms.ts:92), `:125`, `:398`. `variant` and `shippedQuestions` can coexist despite an explicit exclusivity contract; rejection happens at runtime. `newGists` can also conflict with `shippedGists`, whose precedence hides the contradiction. **Evidence: C** from the type and selection function; current arms appear valid. **Cheapest fix:** encode the existing question/gist alternatives as unions with mutually excluded fields. **S / med / low.**

7. **Some Structure measurements bypass production tree acceptance and repair.**  
   [evals/paperwork/run.ts:166](../../evals/paperwork/run.ts:166), `evals/plain-words/run.ts:380`. They parse and flatten the raw model tree. Production subsequently builds, repairs, appends supplements, and validates the tree. Thus raw proposal measurements can differ from reader-visible output. `structure-whole-document/model-arms.ts:817` already exposes the assembled response path. **Evidence: C** for divergent measurement paths; impact on existing conclusions is **H**. **Cheapest fix:** use that existing assembly path for claims about reader-visible quality, retaining raw proposals separately for prompt diagnostics. **S / med / low.**

8. **Direct Structure eval calls omit production termination checks.**  
   [evals/plain-words/run.ts:377](../../evals/plain-words/run.ts:377), `evals/paperwork/run.ts:158`; production `src/structure.ts:2773`, `:2782`. They extract text and parse without rejecting refusal or `max_tokens` termination. Valid-looking JSON from a truncated response can be accepted by the eval but refused by production. Model-arms already handles these terminal states. **Evidence: C** for the omitted admission checks; that response scenario is **H**. **Cheapest fix:** reuse existing terminal-result checks and record termination in outcomes; verify with a fake truncated response containing valid JSON. **S / med / low.**

**Overall approach and scope**

| Zone | Overall approach | Looked at | Skipped |
|---|---|---|---|
| Server/store | Sound: explicit stages, artefacts, and database constraints. Improve boundary types and stored-source interpretation. | Fetch/storage/source scan, pipeline product contracts, model configuration, block schema and readers. | Exhaustive extraction algorithms, live database execution, paid calls. |
| Routes/security | Sound: owner checks, public projections, central admission and dispatch. Referee lifetimes need to catch up with Search. | SSE jobs, begin/finish/sweep paths, auth, billing resync, attribution, refusal logging. | Live Stripe/Supabase requests, penetration testing, exhaustive route execution. |
| Web client | Sound: URL state, capabilities, ordered reads, and job tracking. Some sibling hooks have missed established protections. | Reader/mode hooks, autosave, link cache, marks, contents navigation, source scanning, legacy URL handling. | Browser/visual testing, audio paths, usage telemetry. |
| Scripts | Sound: explicit operational commands. Older standalone verifiers compete with stronger deployment checks. | Deploy/stage parsers, auth/OAuth checks, environment readers, MCP smoke and cleanup, relevant fleet callers. | Real deployment, provider/browser sessions, full fleet/systemd execution. |
| Evals | Sound experimental structure, but historical-control and provenance contracts are uneven. | Executable prompt candidates, frozen-control imports, arm selection, input/output hashes, pairing and Structure acceptance. | Paid reruns, result-quality adjudication, exhaustive archived-output inspection. |

No full test, lint, typecheck, knip, or madge run was performed; these are breadth nominations supported by scoped source inspection and the local reproductions identified above.