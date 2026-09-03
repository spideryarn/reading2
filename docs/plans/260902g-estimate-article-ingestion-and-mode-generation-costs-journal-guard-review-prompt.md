# Review: a conflict-marker guard on the drizzle migration journal

## What happened

In a shared git checkout, `drizzle/meta/_journal.json` was left with unresolved merge-conflict
markers in it. That file is read by every migration command in the repo (`readJournal` in
`scripts/migration-ledger.ts`). The result:

- `npm run db:migrate` died with `SyntaxError: Expected ',' or '}' after property value in JSON at
  position 8151`.
- Earlier, with a partially-broken journal, it reported "three ledger rows belong to no migration"
  and "two migrations can never be applied" — all of which was misleading. Hashing every `.sql`
  across the tree and all worktrees proved all three rows matched real migrations.
- Meanwhile `spideryarn.ai_calls` stayed behind `src/db/schema.ts`, so every paid model call on the
  box was recorded nowhere for hours.

The diagnosis cost about an hour. The fix below is aimed at the diagnosis, not the outage.

## The change

`readJournal` now scans for a conflict marker before `JSON.parse` and throws a message naming the
file, the line, the marker, and the resolution rule (keep BOTH sides' entries — a journal entry
records that a migration exists; it is never a choice between two). Plus tests and a docs section.

The diff is attached below.

## What I want from you

Be adversarial and concrete. Specifically:

1. **Is the regex right?** `/^(<{7}|={7}|>{7})(?: |$)/m`. Can a legitimate `_journal.json` ever
   match it? Can a real conflict ever fail to match it — think about diff3/zdiff3 style
   (`||||||| base`), CRLF line endings, and markers longer than 7 characters.
2. **Is the advice in the message correct and safe?** "Keep both sides, renumber `idx` contiguously
   from 0, leave every `when` untouched." Is there a case where keeping both sides is the wrong
   resolution for this file? Note that elsewhere in this repo, `when` timestamps must be strictly
   increasing in journal order or a migration is silently skipped for ever — does the advice risk
   producing an inversion, and if so should the message say more?
3. **Is this guard in the right place?** It is in `readJournal`, so it fires for every caller
   (db:migrate, db:generate, db-repair-migration-ledger, and several tests). Is there a caller for
   which throwing is worse than parsing? Would a check on the whole `drizzle/` folder (snapshots,
   `.sql` files) be better, or is that scope creep?
4. **Do the tests actually pin the behaviour**, or would they pass against a weaker implementation?
   Is the "leads with the marker rather than a byte offset" assertion meaningful or vacuous?
5. Anything factually wrong in the docs section.

Rank findings P0/P1/P2. Say explicitly if you find nothing at a level.

## The diff

```diff
diff --git a/docs/project/database.md b/docs/project/database.md
index 3cb76a0a..0a56ad97 100644
--- a/docs/project/database.md
+++ b/docs/project/database.md
@@ -570,6 +570,22 @@ branch rather than on whoever migrates next. Predicted as failure row 8 of
 [260828r-worktrees.md](../plans/260828r-worktrees.md), for two worktrees; it happened between two
 sessions in one tree.
 
+### When the journal itself is mid-merge
+
+Every one of those checks reads `drizzle/meta/_journal.json` first, so a journal that will not parse
+takes all of them out together. That is not hypothetical: nearly every change appends to the same
+last entry, so this file conflicts more than any other in the repo, and nothing but tooling ever
+opens it — the markers sit there unseen. On 2026-09-02 a half-finished merge in the shared primary
+left `<<<<<<< HEAD` in it, `db:migrate` died on a `SyntaxError` at a byte offset, and the ledger got
+the blame: it reported three rows belonging to no migration, all three of which turned out to be
+real migrations. `spideryarn.ai_calls` stayed behind the code meanwhile, so **every paid call on the
+box was recorded nowhere** for hours.
+
+`readJournal` now refuses a journal containing a conflict marker and says which line, so the first
+command tells you. **Resolve it by keeping both sides' entries** — an entry records that a migration
+exists, it is never a choice between two of them — then renumber `idx` contiguously from 0 and leave
+every `when` exactly as it was.
+
 ### Rule 4 on a laptop: the draft that ran, and the file that was committed
 
 `db-repair-migration-ledger.ts` does not clear a **rule 4** refusal — it repairs watermark gaps, and
diff --git a/scripts/migration-ledger.ts b/scripts/migration-ledger.ts
index 12d31d29..fe141667 100644
--- a/scripts/migration-ledger.ts
+++ b/scripts/migration-ledger.ts
@@ -636,9 +636,35 @@ export function planToForget(
 /* Reading the folder                                                  */
 /* ------------------------------------------------------------------ */
 
-/** The journal at `<folder>/meta/_journal.json`, in the order drizzle reads it. */
+/**
+ * The journal at `<folder>/meta/_journal.json`, in the order drizzle reads it.
+ *
+ * The conflict-marker check earns its place: nearly every change appends to the
+ * same last entry, so this file conflicts more than any other in the repo, and
+ * nothing but tooling ever opens it — so the markers sit there unseen. On
+ * 2026-09-02 they took out every migration command at once, and the parser said
+ * only `Expected ',' or '}' after property value in JSON at position 8151`. An
+ * hour then went into the ledger, which had been correct throughout. Say what it
+ * is, in the first line, before the offset nobody can act on.
+ */
 export function readJournal(folder: string): JournalEntry[] {
-  const text = readFileSync(path.join(folder, "meta", "_journal.json"), "utf8");
+  const file = path.join(folder, "meta", "_journal.json");
+  const text = readFileSync(file, "utf8");
+
+  const marker = /^(<{7}|={7}|>{7})(?: |$)/m.exec(text);
+  if (marker) {
+    const line = text.slice(0, marker.index).split("\n").length;
+    throw new Error(
+      `${file} has an unresolved merge conflict in it — line ${line} begins ` +
+        `\`${text.slice(marker.index).split("\n")[0]}\`.\n` +
+        "  Every migration command reads this file, so all of them are blind until it is " +
+        "resolved, and a database can quietly fall behind the code meanwhile.\n" +
+        "  Resolve it by keeping BOTH sides' entries: a journal entry is a record that a " +
+        "migration exists, never a choice between two of them. Then renumber `idx` so it " +
+        "counts from 0 with no gaps, leave each `when` exactly as it was, and re-run.",
+    );
+  }
+
   return (JSON.parse(text) as { entries: JournalEntry[] }).entries;
 }
 
diff --git a/tests/migration-journal.test.ts b/tests/migration-journal.test.ts
index 5c770edd..26b7a7dc 100644
--- a/tests/migration-journal.test.ts
+++ b/tests/migration-journal.test.ts
@@ -212,3 +212,85 @@ describe("journalInversions", () => {
     expect(journalInversions(j, GRANDFATHERED)).toHaveLength(1);
   });
 });
+
+/* ------------------------------------------------------------------ */
+
+/**
+ * **A half-finished merge inside the journal.**
+ *
+ * On 2026-09-02 `drizzle/meta/_journal.json` sat in the shared primary checkout
+ * with `<<<<<<< HEAD` still in it, and every migration tool in the repo went
+ * blind at once: `readJournal` threw `SyntaxError: Expected ',' or '}' after
+ * property value in JSON at position 8151`, `npm run db:migrate` died on it, and
+ * `spideryarn.ai_calls` was left short the columns the code already wrote, so
+ * **every paid model call on the box was recorded nowhere** for hours.
+ *
+ * The cost was not the outage, it was the diagnosis. A JSON parse error at a
+ * byte offset says nothing about merges, so the hunt went to the ledger instead
+ * — three rows were read as belonging to no migration, and an hour went into
+ * hashing every `.sql` across every worktree to prove all three were real
+ * migrations and the ledger had been fine the whole time. One sentence naming
+ * the marker would have ended it at the first command.
+ *
+ * The class: **a machine-read file that a human merge can corrupt, whose reader
+ * reports the corruption in its own vocabulary rather than the one the reader
+ * needs.** `_journal.json` is the worst case in this repo — nearly every change
+ * appends to the same last line, so it conflicts constantly, and nothing but the
+ * tools ever reads it, so nobody sees the markers.
+ */
+describe("conflict markers in the journal", () => {
+  const journalSaying = (text: string): string => {
+    const dir = mkdtempSync(path.join(os.tmpdir(), "spya-journal-"));
+    mkdirSync(path.join(dir, "meta"));
+    writeFileSync(path.join(dir, "meta", "_journal.json"), text);
+    return dir;
+  };
+
+  const CONFLICTED = `{
+  "version": "7",
+  "entries": [
+    { "idx": 0, "version": "7", "when": 100, "tag": "0000_first", "breakpoints": true }
+<<<<<<< HEAD
+=======
+    ,{ "idx": 1, "version": "7", "when": 200, "tag": "0001_theirs", "breakpoints": true }
+>>>>>>> origin/dev
+  ]
+}`;
+
+  it("says the word 'merge', and names the file", () => {
+    const dir = journalSaying(CONFLICTED);
+    expect(() => readJournal(dir)).toThrow(/unresolved merge conflict/i);
+    expect(() => readJournal(dir)).toThrow(/_journal\.json/);
+  });
+
+  /* The marker is what a reader can act on; the parser's byte offset is not.
+     Leading with the offset is how the real hour was lost. */
+  it("leads with the marker rather than a byte offset", () => {
+    const dir = journalSaying(CONFLICTED);
+    let message = "";
+    try {
+      readJournal(dir);
+    } catch (err) {
+      message = err instanceof Error ? err.message : String(err);
+    }
+    expect(message).toContain("<<<<<<< HEAD");
+    expect(message.indexOf("<<<<<<<")).toBeLessThan(
+      message.includes("position") ? message.indexOf("position") : message.length,
+    );
+  });
+
+  /* Malformed-but-unmerged JSON is a different fault and must not be dressed up
+     as a merge — a wrong diagnosis is what this whole block exists to stop. */
+  it("does not blame a merge for ordinary broken JSON", () => {
+    const dir = journalSaying(`{ "entries": [ }`);
+    expect(() => readJournal(dir)).toThrow();
+    expect(() => readJournal(dir)).not.toThrow(/merge conflict/i);
+  });
+
+  it("still reads a journal with no markers in it", () => {
+    const dir = journalSaying(
+      JSON.stringify({ entries: [{ idx: 0, tag: "0000_first", when: 100 }] }),
+    );
+    expect(readJournal(dir)).toHaveLength(1);
+  });
+});
```
