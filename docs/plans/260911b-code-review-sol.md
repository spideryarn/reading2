## Findings

- P3 — [authenticated-api-route-contract.test.ts:25](/home/greg/code/spideryarn2/.claude/worktrees/comments-route-slice/tests/authenticated-api-route-contract.test.ts:25): current-tense documentation still described 81 guards, only the earlier moved domains, and “twenty-one” chain guards. I updated it to 82 total, 43 table rows, the complete domain list, and removed the stale chain count.
- P3 — [260911b-verify-move.mjs.txt:217](/home/greg/code/spideryarn2/.claude/worktrees/comments-route-slice/docs/plans/260911b-verify-move.mjs.txt:217): inherited prose said “these twelve” bodies. Changed to “these six.”
- No P0–P2 findings.

## Review answers

1. The move is pure. Fresh captures matched the recorded JSON byte-for-byte, and all six bodies compared identical. Their order and position are preserved. The external comments are accurate; “the `PATCH` below” correctly points to the one-comment PATCH row now below the mark row.
2. Both verifier tightenings are sound for these bodies. The targeted normalisation covers every matcher use while preserving `{ comments: … }`; the raw/blanked length comparison correctly checks the selected closing brace. Neither weakens the parent verifier here.
3. The oracle is sound. After lease ageing, `sweepPending` has no protection besides `answering`. The second stream reaching its gate proves `beginAnswer` reclaimed the expired pending row rather than returning 409. Sequential gate creation/consumption and awaited completion prevent a wrong gate in an unmutated run. M1’s handshake failure is adequate—and more immediate than the later assertion—because it directly proves the request settled before the stream began; reshaping it would weaken failure diagnosis.
4. Both pair lists, `moved`, and the `/api/projection` control are correct. Projection is the final remaining chain guard and the bottom of the next contiguous slice.
5. The recount is correct: the contract independently reports 82 guards, and the table contains 43 rows, leaving 39.
6. The registry entries are acceptable: `private-postgres` is necessary for the fixed slug, direct SQL ageing, and sweeping; `static-only` plus `fixture-loader` matches the live import graph.
7. Nothing else should block the slice.

Checks: verifier passed; contract 323/323; typecheck passed via the non-IPC runner; targeted lint passed; `git diff --check` passed. The database-backed lifetime suite could not be rerun because this sandbox denies the local PostgreSQL connection. The registry suite passed 12/13; its subprocess-only check hit the same sandbox restriction, so I ran its scanner directly and found 50 candidates with zero holes.

Verdict: Approve—pure move, sound oracle, only corrected P3 documentation drift.