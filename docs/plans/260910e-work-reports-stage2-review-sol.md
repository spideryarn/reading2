Fixed three in-stage defects. No commit was made.

### Findings

- **WR-S2-1 — P0 — [decisions.ts:1039](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tools/overseer/decisions.ts:1039)**  
  Hand-written schema-2 events could mismatch recorder and author—for example, `by: "overseer"` with `author: {kind: "greg"}`—and that false attribution flowed through the fold, route, CLI, and panel. The browser parser repeated the gap.  
  Red tests: [overseer-decisions-schema2.test.ts:366](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tests/overseer-decisions-schema2.test.ts:366) and [fleet-decisions-client.test.ts:427](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tests/fleet-decisions-client.test.ts:427); five assertions failed before the fix.  
  Fix: both parsers now enforce the only valid schema-2 matrix: Overseer→Overseer, Greg→Greg, daemon→session. Schema-1 legacy records remain unchanged.

- **WR-S2-2 — P1 — [decisions.ts:1279](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tools/overseer/decisions.ts:1279)**  
  `appendEvents` rejected Stage 3’s exact prepared-event replay as `duplicate-event` before command-id idempotency ran.  
  Red test: [overseer-decisions-schema2.test.ts:227](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tests/overseer-decisions-schema2.test.ts:227).  
  Fix: an already-persisted, command-keyed event with identical event ID, timestamp, and complete semantic payload is removed before candidate folding. Changed same-ID events and commandless duplicates still fail.

- **WR-S2-3 — P1 — [decisions.ts:822](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tools/overseer/decisions.ts:822)**  
  The schema-2 “every text field is bounded and clean” guarantee omitted execution tokens/reasons, `chose.option`, command IDs, and unbounded fractional ISO timestamps. Invalid execution tokens could also produce a route payload the browser refused.  
  Red tests: [overseer-decisions-schema2.test.ts:271](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tests/overseer-decisions-schema2.test.ts:271) and [overseer-decisions-schema2.test.ts:315](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tests/overseer-decisions-schema2.test.ts:315).  
  Fix: schema-2-only bounds/control checks now cover those fields, and verified execution tokens must use the canonical token format. Schema 1 retains its original permissive parsing.

### Other review conclusions

- The frozen V1 parser was deliberately changed to accept schema 2. Its test failed for the intended reason: `1 failed, 32 skipped`, with the valid schema-2 event being parsed. The fixture was then restored with no diff.
- Both frozen copies are faithful to the Stage 2 parent. The cited older source and the parent are identical for both parsers (`git diff f9d4b584..980bb148^` was empty).
- Schema-1 folding retains its records, problems, transitions, and review state; only the specified legacy author and not-recorded assessment fields are added.
- Historical `seed`, fresh-event CLI retries, exact prepared-event retries, and conflicting retries are covered and pass.
- Ranking matches the plan: high, not-recorded, medium, low; then one-way, not-recorded, costly, easy. Confidence does not rank.
- CLI and browser search use the same fields and agree in their shared test.
- `gregAsked: asked-answered` remains an italic author claim, separate from the review pill, and never changes folding.
- New panel text uses React text interpolation. Evidence links are created only through `artefactHref`.
- One existing assertion changed: [overseer-decisions.test.ts:568](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tests/overseer-decisions.test.ts:568) now changes the timestamp while reusing the event ID, preserving duplicate-event coverage without contradicting exact replay.

Files changed:

- `tools/overseer/decisions.ts`
- `tools/fleet/web/src/decisions-client.ts`
- `tests/overseer-decisions.test.ts`
- `tests/overseer-decisions-schema2.test.ts`
- `tests/fleet-decisions-client.test.ts`

Wider, not fixed: identity remains a documented governance boundary, not an OS boundary. A process running as the same Unix user can still fabricate a fully consistent `by: "greg", author: {kind:"greg"}` line. Preventing that requires authenticated/device-scoped writes beyond Stage 2.

### Gates

`npm run build:fleet` — exit 0:

```text
✓ 1894 modules transformed.
✓ built in 2.83s
```

Requested Stage 2 suite — exit 0:

```text
Test Files  10 passed (10)
Tests  287 passed (287)
Duration  10.50s
```

The sandbox prevents the `tsx` CLI from opening its IPC socket, so literal `npm run typecheck` exits 1 with `listen EPERM /tmp/tsx-1000/*.pipe`. Running the identical script through the non-IPC loader, `node --import tsx scripts/typecheck.ts`, exited 0:

```text
✓ src/web/tsconfig.json  (344 files)
✓ tests/tsconfig.json  (1893 files)
✓ tools/fleet/web/tsconfig.json  (86 files)
✓ tsconfig.json  (593 files)
✓ all 1973 source files are covered by some project
```

Biome lint exited 0 with only the existing advisory infos.

Verdict: **Stage 2 is ready to land after these fixes.** WR-P1, WR-P2, and WR-P8 are now met in code, including the preventable attribution paths and exact replay contract. The only remaining Gate 1 limitation is the explicitly documented same-Unix-user impersonation boundary, which this filesystem design cannot authenticate.