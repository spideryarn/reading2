Left fixes uncommitted in four manifest files. No files outside the manifest changed; every mutation was restored.

Validation: **605 tests passed across 15 suites**, including all four new suites. Direct TypeScript checks passed for all four projects. Full `npm test` was blocked by database access; standard typecheck by IPC permissions; two census suites by `spawnSync git EPERM`. Lint reported one complexity advisory.

| Mutation | Suite noticed? |
|---|---|
| Cap retry waits at 30 seconds | Yes |
| Supply a fallback key when unset | Yes |
| Add a request-path env load | Yes |
| Import the loader under an alias | Yes |
| Silently default invalid effort | Yes |
| Rename the loader through a re-export | Initially no; yes after fix |
| Construct the meter before key validation | Runner suite initially missed pending spend; yes after added assertion |
| Ignore refusal usage | Yes, on both seams |

No refusal-metadata defect was established. The additional generic failure logs retain the configuration diagnosis and are acceptable. Changed comments/docs match the behavior; no live pointers to deleted exports remain.

| Finding | Severity / evidence / disposition | Result |
|---|---|---|
| **F5** | **P1 · established · fixed-by-me** | [Retry parser](src/retry-after.ts:26) mistook an unrecognized zone for no zone, corrupting `PST` dates. GMT is now appended only to complete zone-less shapes. Tests cover zones before and after the clock. |
| **F6** | **P2 · established · fixed-by-me** | [Env census](tests/load-env-local-census.test.ts:115) missed renamed re-exports. It now rejects them, with a regression fixture and a confirmed two-file mutation. |
| **F7** | **P2 · established · reported** | [Simple probe](evals/simple/probe.ts:142) advertises `max` arms that the checked effort reader rejects. Outside the manifest; unchanged. Recommend removing `max` from its regex/error. No recorded measurement supports expanding production’s effort contract. |
| **F8** | **P2 · established · fixed-by-me** | [No-key runner tests](tests/no-key-runners.test.ts:154) checked completed spend but missed pending entries. Added the pending assertion; the mutation now fails all seven runner cases. The existing gateway test already caught it. |

VERDICT: land after these fixes