# Review: main app architecture, mode catalog and command bar

Repo: /Users/greg/dev/spideryarn/reading2, branch dev. Documentation-only architecture proposal for
the existing React/TypeScript/Vite reading app. Do not change any file, commit or push.

## Candidate

Live pre-commit candidate. Audit source base: fd370cfe050fc9ad0bdfd107668b857abaab5219.
HEAD when prompt prepared: 4e1175da71b19f6970e7daeaba50f71e571b419f; peers are working here.
Complete scoped and untracked candidate file list:

- docs/plans/260905e-main-app-architecture-review.md
- docs/plans/260905e-mode-catalog-and-command-bar.md
- docs/plans/260905e-main-app-architecture-evidence.md
- docs/plans/260905e-main-app-architecture-review-prompt.md

Read those files directly: untracked additions do not appear in git diff. No application change is
part of this candidate. Existing unrelated dirty files belong to peers. The resulting candidate
commit SHA will be recorded in a follow-up review closure after landing.

## Contract

Greg requested detailed architecture observations and implementation-ready suggestions, committed
and pushed as docs. During the task he explicitly said to revisit previous decisions, distinguish
his product instructions from agents' engineering judgements, consider a universal mode registry
for long-term benefits, and explore a text/voice command bar. His examples: locate an article
passage, generate Quotes plus Illustrated, explain access versus phenomenal consciousness. Future
user-generated modes/marketplace are possibilities; current app quality comes first. This is a plan,
not permission to implement the app changes now.

Check whether the proposals preserve stable block IDs, one hierarchy/zoom tree, real feature
semantics, account/public capability boundaries, paid activation intent, offline behaviour and
the existing tab/article/feature operation lifetimes. Do not treat historical agent rejections of
registries as vetoes: review the actual new design and its tradeoffs. The companion proposes a
catalog plus distinct typed actions, while allowing more expressive generated UI as future work.

## Evidence and runnable checks

The source is readable. See 260905e-main-app-architecture-evidence.md for actual client build,
typecheck, full-check and doc-link outcomes. The full check has two existing fixture-publication
suite failures; this proposal did not modify their source or fixtures. Do not claim all tests pass.
You may run the one service-free check:

`npx vitest run --project unit tests/doc-links.test.ts --reporter=dot`

The review environment has no network or local database. Do not run database/provider tests or
inspect .env files, credentials, personal article data or production services. Use source fixtures
and defining symbols for verification. Prefer source/behaviour evidence over stale doc descriptions.

## Independent attack

Read and challenge the proposal before considering the author's concerns. Find designs that would
cause a future implementing agent to ship wrong behaviour, misstate user authority, overbuild the
wrong interface, or lack enough detail to implement safely. Check especially whether the proposed
steps actually follow from inspected code, and whether a claim of already-built/missing is true.
Suggest useful simpler alternatives and stronger long-term designs when warranted.

Return an explicit READY / READY WITH CHANGES / NOT READY verdict. Give every finding a stable
F1/F2/... ID, severity, established vs reasoned evidence state, exact candidate section and source
evidence, the concrete failing scenario/contradicted contract, and smallest replacement wording.
Severity by consequence: P0 data loss/security/incorrect charging/service broadly unusable; P1
reachable user-visible wrong behaviour or authoritative contract violation; P2 design/maintenance
risk with no wrong behaviour established; P3 prose/comment defect. Refuse only for established P0/P1
with no unresolved load-bearing inference. For prose, judge the consequence of implementing it.

## Author's concerns, lower priority than independent findings

Check the new cache-order ticket/epoch proposal for atomicity, availability on metadata failures,
cross-tab behaviour and unjustified scope. Check that mode.open vs mode.activate and explicit
multi-output generation preserve current deliberate-click rules without an unnecessary confirmation
flow. The second proposal should explore rather than simply repeat the prior agents' conservatism.
These concerns are already known; spend most of the review finding what was not considered.

Do not change any file. Return the verdict and findings in your final answer.
