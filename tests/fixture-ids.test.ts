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
 *
 * ## What this cannot see: the same file, in two processes
 *
 * This guard is about two *files* sharing an id. **The identical failure happens
 * when one file runs in two processes**, and no static check can see it, because
 * the ids are unique — the file is simply colliding with itself.
 *
 * `tests/export-route.test.ts` hit it on 2026-09-01: a peer's `npm test` while
 * somebody ran that file directly, its `beforeAll`/`afterAll` cleaning by fixed
 * uuid, and each process deleting the other's article mid-run. The symptom was
 * the one described above — `expected 404 to be 200`, the *owner* refused their
 * own article — and checking the ids for collisions was the first thing done and
 * ruled nothing out, because by this guard's rule they were fine.
 *
 * **The remedy is not a wider guard, it is not needing one:** mint the row's ids
 * per run with `crypto.randomUUID()`, as `tests/store-uploads-parity.test.ts` and
 * now `export-route` do, and the collision is impossible across files and
 * processes alike. Mint every *unique* column, not just the primary key —
 * `articles.short_id` is unique table-wide and `slug` unique per owner, so
 * distinct uuids alone still collide on the insert. A fixed id is fine for a
 * fixture nothing inserts, which is what `NOT_A_ROW` below is for.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** This file, excluded from its own scan — see `claims()`. */
const SELF = path.basename(fileURLToPath(import.meta.url));

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

interface Claim {
  file: string;
  name: string;
  id: string;
}

/**
 * Ids more than one file may hold, because **no row is ever inserted under
 * them** — and a teardown can only take away a row that exists.
 *
 * That is the real distinction, and it is narrower than "several files use it".
 * A shared *foreign key* does not belong here: three files pointed rows at
 * Greg's `auth.users` row by writing his uuid out longhand, and the fix for
 * that was to import `ADMIN_USER_ID_LOCAL` from `src/admin.ts`, which is both the
 * single source of truth and, incidentally, no longer a literal for this guard
 * to trip over. Reach for an entry below only when nothing in the suite creates
 * the row at all.
 *
 * **Exact uuids, never a pattern.** Half the suite mints its fixture ids out of
 * the same `00000000-0000-4000-8000-…` block — `tests/store-shelf-reads.test.ts`
 * has twelve — so a rule shaped like "ids that look like nothing" would exempt
 * most of what this guard exists to watch, while still passing its own control.
 */
const NOT_A_ROW: Record<string, string> = {
  "00000000-0000-4000-8000-000000000000":
    "the “no such row” sentinel. `tests/upload-records.test.ts` hands it to `claimUpload` in " +
    "order to be told “unknown”, and `tests/store-artefacts-pg.test.ts` uses it as the job id " +
    "of a fixture that deliberately has no job. Neither one inserts it.",
  "00000000-0000-4000-8000-00000000c0de":
    "the job card's owner, in six component and unit tests — `blocking-job-band`, " +
    "`interrupted-job-card`, `job-card-progress`, `job-progress-band`, `job-state` and " +
    "`step-job-driver-stalled`. Every one of them builds a `Job` object in memory and renders " +
    "it; not one imports a store or a database module, so there is no row to delete. Six " +
    "different owner ids would say that these fixtures differ in a way they do not.",
  "11111111-2222-3333-4444-555555555555":
    "two unrelated things that are both not rows: the signed-in reader in a stubbed Supabase " +
    "session in `feedback-mirror.test.ts`, and a provisioning attempt id inside a status file " +
    "in `gjd-remote-provision.test.ts`. Neither file reaches Postgres at all.",
  "3c67234f-2da6-4208-8473-9b5ee58be82a":
    "a tmux session uuid, shared by `gjd-remote-tmux.test.ts` and its script twin because they " +
    "describe the same `agents.json` fixture. It names a terminal session, not a row.",
  "49348111-df07-44ac-a204-f2e168f46de5": "the second session uuid in that same fixture pair.",
};

function parse(file: string, source: string): Claim[] {
  const out: Claim[] = [];
  for (const m of source.matchAll(DECLARED)) {
    /* The name is for the failure message only — the id is the fact. Taken
       from the nearest `const NAME =` before the match where there is one,
       so a property-style id still reports something a reader can find. */
    const before = source.slice(0, m.index ?? 0);
    const name = before.match(/const\s+(\w+)\s*=\s*[^;]*$/)?.[1] ?? "inline";
    out.push({ file, name, id: m[1] as string });
  }
  return out;
}

function claims(): Claim[] {
  return readdirSync(DIR)
    /* `.tsx` as well as `.ts`: vitest collects both, so a component test can
       hold a fixture id and collide with anything else. Scanning only `.ts`
       was a blind spot rather than a decision. */
    .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"))
    /* Not this file. Every uuid here is written out to be *talked about* — the
       exempt one in NOT_A_ROW, the near-miss in the controls — and counting
       those as claims makes the guard describe itself. It cost the staleness
       check below its meaning: the exempt id is a literal in NOT_A_ROW, so its
       file count could never fall below one no matter how many real users went
       away. Found by GPT Sol, 2026-08-28. */
    .filter((f) => f !== SELF)
    .flatMap((file) => parse(file, readFileSync(path.join(DIR, file), "utf8")));
}

/**
 * Exemptions that no longer have two users, and so are buying nothing.
 *
 * Over claims rather than over the disk, for the same reason `collisions()` is:
 * a rule that can only be run against the real tree can only be watched to
 * pass.
 */
function staleExemptions(found: Claim[]): string[] {
  return Object.keys(NOT_A_ROW)
    .map((id) => ({ id, files: new Set(found.filter((c) => c.id === id).map((c) => c.file)) }))
    .filter(({ files }) => files.size < 2)
    .map(
      ({ id, files }) =>
        `${id} is exempted in NOT_A_ROW, but ${files.size} test file(s) declare it now. ` +
        "One or none is not a collision, so the entry is buying nothing and is a standing " +
        "blind spot. Delete it.",
    );
}

/**
 * The whole judgement, over claims rather than over the disk — so the test
 * below can hand it a collision it made up and watch it fire.
 */
function collisions(found: Claim[]): string[] {
  const byId = new Map<string, { file: string; name: string }[]>();
  for (const c of found) {
    const seen = byId.get(c.id) ?? [];
    seen.push({ file: c.file, name: c.name });
    byId.set(c.id, seen);
  }

  /* Two declarations in the SAME file are fine — a file may legitimately hold
     an article and its second article. Only a uuid crossing a file boundary
     is the hazard, because only then can the two run at once. */
  return [...byId.entries()]
    .filter(([id]) => !Object.hasOwn(NOT_A_ROW, id))
    .filter(([, where]) => new Set(where.map((w) => w.file)).size > 1)
    .map(([id, where]) => `${id} — ${where.map((w) => `${w.file}:${w.name}`).join(", ")}`);
}

/**
 * A uuid for the controls below, **assembled rather than written out** — so
 * that `DECLARED` cannot see it when it scans this very file.
 *
 * The first draft spelled one out, picking `1111…` as obviously invented, and
 * the guard immediately reported it colliding with `READER` in
 * `tests/upload-records.test.ts`. Which is the guard doing its job, on its own
 * author, but a control that trips the assertion it is controlling is no use —
 * and the next made-up constant would only have been luckier, not safer.
 */
const madeUp = (d: string) =>
  `${d.repeat(8)}-${d.repeat(4)}-4${d.repeat(3)}-8${d.repeat(3)}-${d.repeat(12)}`;

describe("fixture rows", () => {
  it("are not claimed by two test files at once", () => {
    expect(
      collisions(claims()),
      "These uuids are declared in more than one test file. Vitest runs files in\n" +
        "parallel against one database, so whichever file tears down first deletes\n" +
        "the other's fixture and every test in it 404s — while passing when run\n" +
        "alone. Give each file its own id — or, if nothing in the suite ever inserts a row\n" +
        "under it, say so in NOT_A_ROW above and say why.",
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

  it("still reports a collision that is not exempt", () => {
    /* The second control, and the one NOT_A_ROW made necessary. An exemption
       list is a blind spot by construction, so the thing worth pinning is its
       width: these four cases differ from each other only in the id, and only
       the exempt one is allowed through. Without this, widening the list by one
       careless character — a prefix match, a `startsWith` — would go green. */
    const a: Claim = { file: "a.test.ts", name: "ARTICLE_ID", id: madeUp("3") };
    const b: Claim = { ...a, file: "b.test.ts" };
    expect(collisions([a, b]), "a plain two-file collision went unreported").toHaveLength(1);

    const exempt = Object.keys(NOT_A_ROW)[0] as string;
    expect(collisions([{ ...a, id: exempt }, { ...b, id: exempt }])).toEqual([]);

    const nearly = `${exempt.slice(0, -1)}1`;
    expect(collisions([{ ...a, id: nearly }, { ...b, id: nearly }]), "the exemption is fuzzy").toHaveLength(1);

    /* Twice in one file is still fine — that is not a collision, and a guard
       that flagged it would train people to stop reading it. */
    expect(collisions([a, { ...a, name: "SECOND_ID" }])).toEqual([]);
  });

  it("has no exemption that has stopped earning its place", () => {
    /* Third control. An entry in NOT_A_ROW whose second user has gone away is
       pure blind spot: it protects nothing (one file alone was never a
       collision) and it silently forgives the next person who reaches for that
       id as a real fixture. So it has to be deleted when it stops being needed,
       which means something has to notice. */
    expect(staleExemptions(claims()), "see the message on each entry").toEqual([]);
  });

  it("would notice an exemption whose second user went away", () => {
    /* The control on the control, and it is the reason `claims()` skips this
       file. While this file scanned itself, every id in NOT_A_ROW was declared
       here by definition, so the count could never fall to zero and the check
       above could never fire on the case it exists for. It passed anyway,
       which is what made it worth testing over made-up claims rather than
       over the disk. */
    /* Two users for **every** exemption, rather than for the first one. Written
       against a single entry, this said `Object.keys(NOT_A_ROW)[0]` and asserted
       one stale entry — so the fifth exemption to be added reddened the control
       instead of the thing it controls, and the honest reading of that failure
       is "the control counts", not "the table is wrong". */
    const ids = Object.keys(NOT_A_ROW);
    const twoUsers: Claim[] = ids.flatMap((id) => [
      { file: "a.test.ts", name: "SENTINEL", id },
      { file: "b.test.ts", name: "SENTINEL", id },
    ]);
    expect(staleExemptions(twoUsers)).toEqual([]);
    /* Take one file's claim away from one exemption: that entry, and only that
       entry, goes stale. */
    expect(staleExemptions(twoUsers.slice(1)), "one user is not a collision").toHaveLength(1);
    expect(staleExemptions([]), "no users at all").toHaveLength(ids.length);
  });
});
