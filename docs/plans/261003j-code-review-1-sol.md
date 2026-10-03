**F8 blocks approval: a rewrite can discard the inherited timestamp and invent a new one.** No repository files changed.

**F8 — P1, established: inheritance happens before a merge that can discard it.**

In [glossary.ts:847](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/src/glossary.ts:847), `inheritIds` runs before `dedupe`. An earlier fresh entry can therefore absorb a later entry carrying the old ID and timestamp. `merge` keeps the earlier fresh entry’s ID and Tuesday’s timestamp.

Reproduction using the helpers in `tests/glossary-added-at.test.ts`:

```ts
const before = stored([
  entry({ id: "spya-oldold", name: "Seth", addedAt: MONDAY }),
]);

const g = buildGlossary(
  {
    entries: [
      { name: "Anil Seth", background: "Full name." },
      {
        name: "Seth",
        aliases: ["Anil Seth"],
        background: "Same person.",
      },
    ],
  },
  { ...opts, inherit: idsByTerm(before), now: TUESDAY },
);

expect(g.entries).toHaveLength(1);
expect(g.entries[0]?.id).toBe("spya-oldold");
expect(g.entries[0]?.addedAt).toBe(MONDAY);
```

Both final assertions fail: the result has a newly minted ID and Tuesday’s timestamp. Removing `addedAt` from `before` also produces Tuesday’s timestamp, violating preservation of absence. The ordering predates this candidate; the new timestamp feature inherits its defect.

The smallest repair is to merge before assigning inherited identity:

```ts
const fresh = toEntries(
  raw,
  taken,
  opts.scores ?? noGlossaryScoreDrops(),
).map((entry): GlossaryEntry => ({
  ...entry,
  addedAt: completedAt,
}));

// Keep the existing empty-result check.

const merged = inheritIds(
  dedupe([...previous, ...fresh]),
  opts.inherit ?? null,
);
```

I verified this ordering in an offline probe using the existing `inheritIds`: both the timed and untimed cases preserve the old ID and its timestamp or absence. Add both cases as regressions.

**F9 — P2, established: the migration guard misses ordinary SQL formatting.**

[inventedTimes:251](/home/greg/code/spideryarn2/.claude/worktrees/store-when-it-happened/tests/action-tables-have-created-at.test.ts:251) returns `[]` for both:

```sql
ALTER TABLE "spideryarn"."citation_finds"
ADD COLUMN "created_at" timestamp with time zone
DEFAULT now();

ALTER TABLE "spideryarn"."citation_finds"
ADD COLUMN "created_at" timestamp with time zone DEFAULT (now());
```

Both perform the backfill the guard intends to prohibit. The committed migration uses neither form and is correct; this is a weakness in future detection.

The smallest adjustment covering these demonstrated bypasses is:

```diff
-    .split("\n")
-    .filter((line) => !line.trimStart().startsWith("--"))
-    .filter((line) => /ADD COLUMN\s+"[^"]+"\s+timestamp[^;]*DEFAULT\s+(now\(\)|CURRENT_TIMESTAMP)/i.test(line))
+    .replace(/^\s*--.*$/gm, "")
+    .split(";")
+    .filter((line) => /ADD COLUMN\s+"[^"]+"\s+timestamp[^;]*DEFAULT\s*\(*\s*(now\s*\(\s*\)|CURRENT_TIMESTAMP)/i.test(line))
```

I verified that adjustment catches both examples and accepts the committed migration. Add both examples to the helper’s tests. This remains a formatting guard, not a complete SQL parser. `NOT NULL` alone does not make a match false: adding such a default still assigns a time to existing rows.

The remaining checks held up:

- The migration and snapshot agree on exactly five nullable, defaulted columns. The two-statement SQL leaves existing rows null.
- I found no production upsert naming or overwriting those five `created_at` columns.
- The schema guard accepts all 44 committed tables and rejects an injected untimed action table. The drift guard detects a lost nullable default.
- `Omit<…, "createdAt">` does not strip anything at runtime; the read mapping intentionally constructs the existing domain response.
- The owner’s glossary response carries `addedAt`; nothing renders it. The public DTO drops it. I found no prompt, hash or draft-copy problem.

`tests/glossary-added-at.test.ts`: **18 passed**. Postgres results remain those you supplied; I did not independently exercise migration over populated tables.

**REFUSE**