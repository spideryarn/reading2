/**
 * No two test files may claim the same fixture row.
 *
 * Vitest runs test files in parallel against one local Postgres, and the
 * database-backed fixtures all follow the same shape: insert an article with a
 * hand-written uuid in `beforeAll`, delete it by that id in `afterAll`. Two
 * files sharing an id means one of them deletes the other's article halfway
 * through, and every test in the loser 404s.
 *
 * **It presents as a flake in somebody else's work**, which is what makes it
 * worth a test rather than a convention. `tests/db-error-scrub.test.ts` took
 * `…e0` on 2026-08-26, which `tests/store-chat-pg.test.ts` already had. All 20
 * of that file's tests failed, it passed when run alone, and two agents
 * independently reported it as an unexplained failure in a file neither had
 * touched — one of them reasoning its way to a wrong cause (two concurrent
 * `npm test` runs) that would have sent the next person hunting a race that
 * was not there.
 *
 * Uniqueness cannot be checked at the type level and nothing crashes when it is
 * violated: the delete succeeds, the insert's `onConflictDoNothing` succeeds,
 * and the only symptom is a 404 in a different file. So it is checked here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * **Every uuid literal in the file**, not the ones declared a particular way.
 *
 * The first version matched `const <SOMETHING>_ID = "…"`, which is how most
 * fixtures spell it — and a GPT Sol review found a live collision it could not
 * see, because `tests/store-export-isolation.test.ts` writes its uuid as an
 * object property (`id: "…"`) instead. Both files insert and tear down that
 * article, and the guard was green.
 *
 * A guard that only sees the shape it was written from is the same
 * written-from-a-list mistake this whole pass kept finding. So: parse them all.
 * Measured before widening — 19 distinct uuids across the suite and exactly one
 * appearing in two files — so this costs no false-positive noise.
 */
const DECLARED = /"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/g;

function claims(): { file: string; name: string; id: string }[] {
  const out: { file: string; name: string; id: string }[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".test.ts"))) {
    const source = readFileSync(path.join(DIR, file), "utf8");
    for (const m of source.matchAll(DECLARED)) {
      /* The name is for the failure message only — the id is the fact. Taken
         from the nearest `const NAME =` before the match where there is one,
         so a property-style id still reports something a reader can find. */
      const before = source.slice(0, m.index ?? 0);
      const name = before.match(/const\s+(\w+)\s*=\s*[^;]*$/)?.[1] ?? "inline";
      out.push({ file, name, id: m[1] as string });
    }
  }
  return out;
}

describe("fixture rows", () => {
  it("are not claimed by two test files at once", () => {
    const byId = new Map<string, { file: string; name: string }[]>();
    for (const c of claims()) {
      const seen = byId.get(c.id) ?? [];
      seen.push({ file: c.file, name: c.name });
      byId.set(c.id, seen);
    }

    /* Two declarations in the SAME file are fine — a file may legitimately hold
       an article and its second article. Only a uuid crossing a file boundary
       is the hazard, because only then can the two run at once. */
    const shared = [...byId.entries()]
      .filter(([, where]) => new Set(where.map((w) => w.file)).size > 1)
      .map(([id, where]) => `${id} — ${where.map((w) => `${w.file}:${w.name}`).join(", ")}`);

    expect(
      shared,
      "These uuids are declared in more than one test file. Vitest runs files in\n" +
        "parallel against one database, so whichever file tears down first deletes\n" +
        "the other's fixture and every test in it 404s — while passing when run\n" +
        "alone. Give each file its own id.",
    ).toEqual([]);
  });

  it("is looking at files that really do declare fixture ids", () => {
    /* The control. The assertion above is satisfied perfectly by a regex that
       matches nothing, which is exactly how a guard like this rots into
       decoration — and this file would then go green on the very collision it
       was written for. */
    const found = claims();
    expect(found.length, "found no fixture id declarations at all").toBeGreaterThan(4);
    expect(new Set(found.map((c) => c.file)).size, "only one file declares one").toBeGreaterThan(2);
  });
});
