You are reviewing a plan before it is built, in the Spideryarn repo (this checkout). Read-only.

Plan: docs/plans/261009i-skim-profile-notice-can-be-dismissed.md

Read it, then read the code it touches: src/web/SkimPanel.tsx (bannerReason, the foot gate, PurposeLine use), src/web/useSkim.ts, src/web/SkimPurpose.tsx, the GET /api/skim/:slug route in src/routes.ts (search `/api/skim/`), src/skim.ts routeProfileIsStale, src/profile.ts hashProfile/resolveProfile, and the precedent table glossary_hidden_entries in src/db/schema.ts with src/store/pg-glossary-hidden.ts, and AGENTS.md.

Questions: Is the design right and as simple as it should be? Is the hash-pair rule correct in every sequence (profile cleared, profile set for the first time, route re-planned, profile changed back)? Is anything about security/ownership wrong (docs/project/security-map.md)? Are there registries or tests a new per-article table must be added to that the plan misses? Should the 409 exist? Anything about other modes the plan has wrong?

Answer with numbered findings, each with severity (P1/P2/P3), the evidence (file:line), and the fix. End with a one-line verdict: BUILD AS IS, BUILD WITH CHANGES, or RETHINK.
