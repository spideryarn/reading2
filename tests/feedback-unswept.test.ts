/**
 * **The sweep's catch-all reads the row, not the copy.**
 *
 * docs/postmortems/261002b-a-pipeline-whose-only-consumer-reads-the-lossy-copy.md: the
 * feedback sweep read only Sentry, and 13 of Greg's reports on 2026-10-01 never
 * reached Sentry, so nothing ever looked at them. scripts/feedback-unswept.ts
 * lists production rows nothing has covered yet. These tests pin the coverage
 * rule, and above all that **being in Sentry is not coverage** — a mirrored row
 * nobody has queued or written up is still unswept.
 */
import { describe, expect, it, vi } from "vitest";

import {
  addendaListSql,
  coveredAddendumIds,
  coveredReportIds,
  type ListedAddendum,
  parseCommand,
  readInReadOnly,
  readListing,
  renderListing,
  renderShown,
  renderUnsweptAddendum,
  unsweptAddenda,
  parseSince,
  queueSources,
  readRowsReadOnly,
  renderUntrustedWords,
  renderUnswept,
  SHOW_END,
  summary,
  type UnsweptRow,
  unswept,
} from "../scripts/feedback-unswept.js";
import { ADDENDA_NOT_DEPLOYED, type AddendumRow, CannotTell } from "../scripts/feedback-reporter.js";
import { EMPTY_VIEW, type IdeaItem, type QueueView } from "../tools/overseer/idea-queue.js";

function row(id: string, over: Partial<UnsweptRow> = {}): UnsweptRow {
  return {
    id,
    ownerId: "11111111-2222-3333-4444-555555555555",
    createdAt: new Date("2026-10-01T18:00:57Z"),
    kind: "suggestion",
    url: "https://www.spideryarn.com/changelog",
    slug: null,
    mirroredAt: null,
    sentryEventId: null,
    idOccurrences: 1,
    ignoredAt: null,
    number: null,
    ...over,
  };
}

const note = (name: string, reports: string) => ({
  name,
  text: `---\nreports: ${reports}\nending: shipped\n---\n# A note\n`,
});

/** A queue item with only the fields coverage reads; the rest is not this test's business. */
function item(source: string | null, text = "a report", id = "qi-aaaaaaaa", dispatchedTo: string | null = null): IdeaItem {
  return { id, text, metadata: { source }, dispatchedTo } as unknown as IdeaItem;
}

function view(items: IdeaItem[], settled: IdeaItem[] = [], problems: unknown[] = []): QueueView {
  return { ...EMPTY_VIEW, items, settled, problems } as unknown as QueueView;
}

describe("coveredReportIds", () => {
  it("counts every id a note's header names, and every id a queue item's source names", () => {
    const { covered, problems } = coveredReportIds(
      [note("261001_1900-a.md", "spya-aaaaaa, spya-bbbbbb"), { name: "261001_1901-no-header.md", text: "# none\n" }],
      ["SPIDERYARN-READING2-9P spya-cccccc", "spya-dddddd"],
    );
    expect([...covered].sort()).toEqual(["spya-aaaaaa", "spya-bbbbbb", "spya-cccccc", "spya-dddddd"]);
    expect(problems).toEqual([]);
  });

  it("does not take an article's spya- id in a note's body as a report id", () => {
    const { covered } = coveredReportIds(
      [{ name: "261001_1900-a.md", text: "---\nreports: none\nending: declined\n---\nat=spya-dddddd\n" }],
      [],
    );
    expect(covered.has("spya-dddddd")).toBe(false);
  });

  it("does not take a report-id prefix inside a longer queue-source token", () => {
    const { covered } = coveredReportIds([], ["spya-aaaaaaa", "xspya-bbbbbb"]);
    expect([...covered]).toEqual([]);
  });

  it("names a note whose header does not parse, rather than quietly covering nothing", () => {
    const { problems } = coveredReportIds([{ name: "bad.md", text: "---\nreports spya-aaaaaa\n---\n" }], []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("bad.md");
  });
});

describe("queueSources", () => {
  it("reads sources from live and settled items, and never their free text", () => {
    const sources = queueSources({
      kind: "queue",
      path: "/q",
      view: view([item("spya-aaaaaa"), item(null, "mentions spya-eeeeee in passing")], [item("spya-bbbbbb")]),
    });
    expect(sources).toEqual(["spya-aaaaaa", "spya-bbbbbb"]);
    const { covered } = coveredReportIds([], sources);
    expect(covered.has("spya-eeeeee")).toBe(false);
  });

  it("treats a queue nobody has written as no coverage", () => {
    expect(queueSources({ kind: "never-written", path: "/q" })).toEqual([]);
  });

  it("refuses an unreadable queue, or one with problems, rather than reading it as empty", () => {
    expect(() => queueSources({ kind: "unreadable", why: "lost", path: "/q" })).toThrow(CannotTell);
    expect(() =>
      queueSources({ kind: "queue", path: "/q", view: view([], [], [{ line: 3, why: "unparseable" }]) }),
    ).toThrow(CannotTell);
  });
});

describe("unswept", () => {
  it("lists a row named nowhere, and leaves out the covered ones", () => {
    const rows = [row("spya-aaaaaa"), row("spya-c77zuq"), row("spya-cccccc")];
    const covered = new Set(["spya-aaaaaa", "spya-cccccc"]);
    expect(unswept(rows, covered).map((r) => r.id)).toEqual(["spya-c77zuq"]);
  });

  it("still lists a row Sentry confirmed, when nothing has covered it", () => {
    const rows = [
      row("spya-gxyhcc", {
        mirroredAt: new Date("2026-10-01T17:34:01Z"),
        sentryEventId: "b9a6486969444f4e8abec85a4aba1b29",
      }),
    ];
    expect(unswept(rows, new Set()).map((r) => r.id)).toEqual(["spya-gxyhcc"]);
  });

  it("lists a covered id when more than one owner has filed under it", () => {
    /* Report ids are unique only per owner. An id-only note or queue source
       cannot say which row it covered, so suppressing both would lose one. */
    const ambiguous = row("spya-aaaaaa", { idOccurrences: 2 });
    expect(unswept([ambiguous], new Set([ambiguous.id])).map((r) => r.id)).toEqual([
      "spya-aaaaaa",
    ]);
  });
});

describe("a report an administrator marked as ignored", () => {
  /* Greg, 2026-10-03 (`spya-g95x4j`): the Ignore button on /admin/feedback
     sets `ignored_at`, and this is the reader of it. docs/plans/261003j-…. */
  const ignoredAt = new Date("2026-10-03T10:00:00Z");

  it("is left out, covered or not, and whoever else shares its id", () => {
    const rows = [
      row("spya-aaaaaa", { ignoredAt }),
      row("spya-bbbbbb"),
      /* The mark is on the row, so it is exact where coverage by id is not:
         one owner's ignored report goes, the other owner's stays listed. */
      row("spya-cccccc", { idOccurrences: 2, ignoredAt }),
      row("spya-cccccc", { idOccurrences: 2, ownerId: "99999999-2222-3333-4444-555555555555" }),
    ];
    const left = unswept(rows, new Set());
    expect(left.map((r) => r.id)).toEqual(["spya-bbbbbb", "spya-cccccc"]);
    expect(left[1]?.ownerId).toBe("99999999-2222-3333-4444-555555555555");
  });

  it("is counted in the summary, so nothing listed and three ignored are different sentences", () => {
    const rows = [row("spya-aaaaaa", { ignoredAt }), row("spya-bbbbbb")];
    const text = summary(rows, unswept(rows, new Set()), new Date("2026-09-03T00:00:00Z"));
    expect(text).toContain("2 report(s)");
    expect(text).toContain("1 marked ignored by an admin");
    expect(text).toContain("1 named by no note header");
    /* And says nothing about ignoring when nothing is. */
    expect(summary([row("spya-bbbbbb")], [row("spya-bbbbbb")], new Date())).not.toContain("ignored");
  });

  it("says so on its line when it is shown", () => {
    expect(renderUnswept(row("spya-aaaaaa", { ignoredAt }), true)).toContain(
      "ignored by an admin 2026-10-03T10:00:00.000Z",
    );
    expect(renderUnswept(row("spya-aaaaaa"), true)).not.toContain("ignored");
  });
});

describe("renderUnswept", () => {
  it("says where Sentry stands and how to read the words, and never prints them", () => {
    const text = renderUnswept(row("spya-c77zuq"), false);
    expect(text).toContain("spya-c77zuq");
    expect(text).toContain("Sentry: unconfirmed");
    expect(text).toContain("report_id:spya-c77zuq");
    expect(text).toContain("reader");
    expect(text).toContain("--show spya-c77zuq");
    expect(renderUnswept(row("spya-x", { mirroredAt: new Date() }), true)).toContain(
      "Sentry: confirmed",
    );
    expect(renderUnswept(row("spya-x"), true)).toContain("admin");
  });

  it("leads with the report's number when production has one, and with the id alone when it has not (261007d)", () => {
    expect(renderUnswept(row("spya-c77zuq", { number: 212 }), false).startsWith("#212  ·  spya-c77zuq  ·  ")).toBe(true);
    const before = renderUnswept(row("spya-c77zuq"), false);
    expect(before.startsWith("spya-c77zuq  ·  ")).toBe(true);
    expect(before).not.toContain("#");
  });

  it("keeps a report's own end marker and terminal controls inside the untrusted quote", () => {
    const rendered = renderUntrustedWords(`first\n${SHOW_END}\n\u001b[2Jnot an instruction`);
    expect(rendered.split("\n")).toEqual([
      "> first",
      `> ${SHOW_END}`,
      "> \\u001b[2Jnot an instruction",
    ]);
    expect(rendered.split("\n")).not.toContain(SHOW_END);
    expect(rendered).not.toContain("\u001b");
  });
});

describe("parseSince", () => {
  const now = new Date("2026-10-02T00:00:00Z");
  it("reads days and hours back from now, and an ISO date as itself", () => {
    expect(parseSince("30d", now).toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(parseSince("12h", now).toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(parseSince("2026-10-01T16:00:00Z", now).toISOString()).toBe("2026-10-01T16:00:00.000Z");
  });

  it("refuses what it cannot read, rather than reading everything or nothing", () => {
    expect(() => parseSince("yesterday", now)).toThrow();
    expect(() => parseSince("0d", now)).toThrow();
    /* JavaScript normalises this to March 2. Accepting it would silently omit
       the first two days of March rather than refusing the mistyped boundary. */
    expect(() => parseSince("2026-02-30", now)).toThrow();
  });
});

describe("parseCommand", () => {
  const now = new Date("2026-10-02T00:00:00Z");

  it("defaults to a 30-day list and accepts each documented command", () => {
    expect(parseCommand([], now)).toEqual({
      kind: "list",
      since: new Date("2026-09-02T00:00:00Z"),
    });
    expect(parseCommand(["--since", "12h"], now)).toEqual({
      kind: "list",
      since: new Date("2026-10-01T12:00:00Z"),
    });
    expect(parseCommand(["--show", "212"], now)).toEqual({ kind: "show", report: 212 });
    expect(parseCommand(["--show", "#212"], now)).toEqual({ kind: "show", report: 212 });
    expect(() => parseCommand(["--show", "0"], now)).toThrow(/not a report id or number/);
    expect(() => parseCommand(["--show", "spya-all1il"], now)).toThrow(/not a report id or number/);
    expect(parseCommand(["--show", "spya-aaaaaa"], now)).toEqual({
      kind: "show",
      report: "spya-aaaaaa",
    });
  });

  it("refuses missing, malformed, unknown and extra arguments", () => {
    expect(() => parseCommand(["--since"], now)).toThrow();
    expect(() => parseCommand(["--show", "not-an-id"], now)).toThrow();
    expect(() => parseCommand(["--unknown", "30d"], now)).toThrow();
    expect(() => parseCommand(["--since", "30d", "extra"], now)).toThrow();
  });
});

describe("the production read transaction", () => {
  const client = (failSelect = false) => {
    const fake = {
      connect: vi.fn(async () => {}),
      query: vi.fn(async (sql: string) => {
        if (failSelect && /^select /i.test(sql.trim())) throw new Error("select failed");
        return { rows: /^select /i.test(sql.trim()) ? [{ id: "spya-aaaaaa" }] : [] };
      }),
      end: vi.fn(async () => {}),
    };
    return { fake, value: fake as unknown as Parameters<typeof readRowsReadOnly>[0] };
  };

  it("performs one select inside BEGIN READ ONLY and ROLLBACK, without SET", async () => {
    const { fake, value } = client();
    await expect(readRowsReadOnly(value, "select id from spideryarn.feedback", [])).resolves.toEqual([
      { id: "spya-aaaaaa" },
    ]);
    const statements = fake.query.mock.calls.map(([sql]) => sql.trim());
    expect(statements).toEqual([
      "begin read only",
      "select id from spideryarn.feedback",
      "rollback",
    ]);
    expect(statements.some((sql) => /^set\b/i.test(sql))).toBe(false);
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("rolls back and closes after a failed select", async () => {
    const { fake, value } = client(true);
    await expect(readRowsReadOnly(value, "select broken", [])).rejects.toThrow("select failed");
    expect(fake.query.mock.calls.map(([sql]) => sql.trim())).toEqual([
      "begin read only",
      "select broken",
      "rollback",
    ]);
    expect(fake.end).toHaveBeenCalledOnce();
  });
});

/**
 * **The addenda nothing covers** — plan 261010o. Coverage is typed and its
 * own: a note's `addenda:` header or a queue source's `addendum:spya-…`. A
 * bare id in a source covers only a report, and an `addendum:` id never does.
 */
describe("addenda nothing covers (261010o)", () => {
  const SINCE = new Date("2026-10-01T00:00:00Z");
  const ADMIN_OWNER = "11111111-2222-3333-4444-555555555555";
  function addendum(id: string, over: Partial<ListedAddendum> = {}): ListedAddendum {
    return {
      id,
      ownerId: ADMIN_OWNER,
      reportId: "spya-saz0yw",
      environment: "production",
      createdAt: new Date("2026-10-10T09:12:00Z"),
      reportNumber: 541,
      reportIgnoredAt: null,
      reportIdOccurrences: 1,
      idOccurrences: 1,
      ...over,
    };
  }
  const addendaNote = (name: string, reports: string, addenda: string) => ({
    name,
    text: `---\nreports: ${reports}\nending: shipped\naddenda: ${addenda}\n---\n# A note\n`,
  });

  it("counts a note's addenda: header and a source's addendum: ids, and nothing else", () => {
    const covered = coveredAddendumIds(
      [addendaNote("a.md", "spya-saz0yw", "spya-bbbbbb"), note("b.md", "spya-cccccc")],
      ["addendum:spya-dddddd", "spya-eeeeee", "SPIDERYARN-READING2-GP addendum:spya-ffffff spya-saz0yw"],
    );
    expect([...covered].sort()).toEqual(["spya-bbbbbb", "spya-dddddd", "spya-ffffff"]);
  });

  it("keeps the two sets apart: an addendum: id never covers a report, a bare id never an addendum", () => {
    const sources = ["addendum:spya-aaaaaa", "spya-bbbbbb"];
    const reports = coveredReportIds([addendaNote("a.md", "spya-cccccc", "spya-dddddd")], sources).covered;
    const addenda = coveredAddendumIds([addendaNote("a.md", "spya-cccccc", "spya-dddddd")], sources);
    expect([...reports].sort()).toEqual(["spya-bbbbbb", "spya-cccccc"]);
    expect([...addenda].sort()).toEqual(["spya-aaaaaa", "spya-dddddd"]);
  });

  it("lists an addendum whose id equals its own parent's, though the parent is covered", () => {
    /* A browser mints both ids, so they can coincide; the report's coverage must not hide the addendum. */
    const same = addendum("spya-saz0yw", { reportId: "spya-saz0yw" });
    const reportsCovered = coveredReportIds([note("a.md", "spya-saz0yw")], ["spya-saz0yw"]).covered;
    expect(reportsCovered.has("spya-saz0yw")).toBe(true);
    const addendaCovered = coveredAddendumIds([note("a.md", "spya-saz0yw")], ["spya-saz0yw"]);
    expect(unsweptAddenda([same], addendaCovered, SINCE).map((one) => one.id)).toEqual(["spya-saz0yw"]);
    /* And named as an addendum, it is covered. */
    const named = coveredAddendumIds([], ["addendum:spya-saz0yw"]);
    expect(unsweptAddenda([same], named, SINCE)).toEqual([]);
  });

  it("lists an addendum id two owners share as ambiguous, even when covered", () => {
    const shared = [
      addendum("spya-bbbbbb", { idOccurrences: 2 }),
      addendum("spya-bbbbbb", { idOccurrences: 2, ownerId: "99999999-2222-3333-4444-555555555555" }),
    ];
    const left = unsweptAddenda(shared, new Set(["spya-bbbbbb"]), SINCE);
    expect(left).toHaveLength(2);
    expect(renderUnsweptAddendum(left[0] as ListedAddendum, [])).toContain("id shared by 2 owners; coverage is ambiguous");
  });

  it("leaves out an addendum from before --since, and a covered one", () => {
    const old = addendum("spya-bbbbbb", { createdAt: new Date("2026-09-01T00:00:00Z") });
    const covered = addendum("spya-cccccc");
    const fresh = addendum("spya-dddddd");
    expect(unsweptAddenda([old, covered, fresh], new Set(["spya-cccccc"]), SINCE).map((one) => one.id)).toEqual([
      "spya-dddddd",
    ]);
  });

  it("names the parent, and the queue item covering the parent with the session it went to (F6)", () => {
    const entries = [
      { id: "qi-7n9nyz3k", source: "SPIDERYARN-READING2-GP spya-saz0yw", dispatchedTo: "fbsaz0yw-addendum" },
      /* Covering the addendum, not the parent: not a place to send it. */
      { id: "qi-other000", source: "addendum:spya-saz0yw", dispatchedTo: "elsewhere" },
    ];
    const line = renderUnsweptAddendum(addendum("spya-bbbbbb"), entries);
    expect(line).toContain("addendum spya-bbbbbb");
    expect(line).toContain("2026-10-10T09:12:00.000Z");
    expect(line).toContain("to #541 spya-saz0yw");
    expect(line).toContain("report queued as qi-7n9nyz3k, dispatched to fbsaz0yw-addendum");
    expect(line).not.toContain("qi-other000");
    expect(renderUnsweptAddendum(addendum("spya-bbbbbb"), [])).toContain("report queued by no item");
    expect(
      renderUnsweptAddendum(addendum("spya-bbbbbb"), [{ id: "qi-q", source: "spya-saz0yw", dispatchedTo: null }]),
    ).toContain("report queued as qi-q, not dispatched");
  });

  it("does not hand an addendum to another owner's session when its parent report id is shared", () => {
    const entries = [
      { id: "qi-other", source: "spya-saz0yw", dispatchedTo: "another-readers-session" },
    ];
    const sharedParent = {
      ...addendum("spya-bbbbbb"),
      reportIdOccurrences: 2,
    } as ListedAddendum;
    const line = renderUnsweptAddendum(sharedParent, entries);
    expect(line).toContain("parent report id shared by 2 owners; queue handoff is ambiguous");
    expect(line).not.toContain("another-readers-session");
  });

  it("puts a row not written in production first on its line, loudly", () => {
    const line = renderUnsweptAddendum(addendum("spya-bbbbbb", { environment: "development" }), []);
    expect(line.startsWith("! NOT WRITTEN IN PRODUCTION (environment: development)")).toBe(true);
    expect(renderUnsweptAddendum(addendum("spya-bbbbbb"), [])).not.toContain("NOT WRITTEN");
  });

  it("lists the reports with +N addenda, then the addenda nothing covers, and never the words", () => {
    const report = row("spya-saz0yw", { number: 541, ownerId: ADMIN_OWNER });
    const lines = renderListing(
      {
        reports: [report],
        addenda: [addendum("spya-bbbbbb"), addendum("spya-cccccc")],
      },
      [addendaNote("n.md", "spya-zzzzzz", "spya-cccccc")],
      [],
      SINCE,
      () => true,
    );
    const text = lines.join("\n");
    expect(text).toContain("#541  ·  spya-saz0yw");
    expect(text).toContain("+2 addenda");
    expect(text).toContain("2 addenda since 2026-10-01T00:00:00.000Z; 1 named by no note's addenda: header");
    expect(lines.filter((line) => line.startsWith("addendum "))).toHaveLength(1);
    expect(text).toContain("addendum spya-bbbbbb");
  });

  it("says addenda are not deployed, and still lists the reports, before the table exists (F4)", () => {
    const lines = renderListing({ reports: [row("spya-aaaaaa")], addenda: null }, [], [], SINCE, () => false);
    expect(lines.at(-2)).toBe(ADDENDA_NOT_DEPLOYED);
    expect(lines.at(-1)).toBe("unswept: 1 report, addenda not deployed (since 2026-10-01T00:00:00.000Z)");
    expect(lines.join("\n")).toContain("spya-aaaaaa");
  });

  /* The Overseer read the listing through `tail`, saw only the addenda, and
     missed 17 reports (Greg, 2026-10-24). The last line carries both counts. */
  it("ends with one line counting the unswept reports and addenda, so a trimmed view still shows them", () => {
    const lines = renderListing(
      {
        reports: [
          row("spya-aaaaaa"),
          row("spya-dddddd"),
          row("spya-eeeeee", { ignoredAt: new Date("2026-10-02") }),
          row("spya-cccccc"),
        ],
        addenda: [addendum("spya-bbbbbb"), addendum("spya-ffffff")],
      },
      [addendaNote("covered.md", "spya-cccccc", "spya-ffffff")],
      [],
      SINCE,
      () => false,
    );
    expect(lines.at(-1)).toBe("unswept: 2 reports, 1 addendum (since 2026-10-01T00:00:00.000Z)");
    expect(lines.filter((line) => line.startsWith("unswept: "))).toHaveLength(1);
    expect(lines.some((line) => line.includes("spya-eeeeee"))).toBe(false);
    expect(lines.some((line) => line.includes("spya-cccccc"))).toBe(false);
    expect(lines.some((line) => line.includes("addendum spya-ffffff"))).toBe(false);
    const none = renderListing({ reports: [], addenda: [] }, [], [], SINCE, () => false);
    expect(none.at(-1)).toBe("unswept: 0 reports, 0 addenda (since 2026-10-01T00:00:00.000Z)");
  });

  it("reads the reports and their addenda in one read-only transaction, the table probed first", async () => {
    const fake = {
      connect: vi.fn(async () => {}),
      query: vi.fn(async (sql: string) => ({
        rows: /to_regclass/.test(sql)
          ? [{ deployed: true }]
          : /feedback_addenda/.test(sql)
            ? [
                {
                  id: "spya-bbbbbb",
                  owner_id: ADMIN_OWNER,
                  report_id: "spya-saz0yw",
                  environment: "production",
                  created_at: new Date("2026-10-10T09:12:00Z"),
                  report_number: 541,
                  report_ignored_at: null,
                  report_id_occurrences: 1,
                  id_occurrences: 1,
                },
              ]
            : /^select /i.test(sql.trim())
              ? []
              : [],
      })),
      end: vi.fn(async () => {}),
    };
    const read = await readInReadOnly(fake as unknown as Parameters<typeof readInReadOnly>[0], (query) =>
      readListing(query, SINCE),
    );
    expect(read.addenda?.map((one) => [one.id, one.reportNumber])).toEqual([["spya-bbbbbb", 541]]);
    const statements = fake.query.mock.calls.map(([sql]) => sql.trim());
    expect(statements[0]).toBe("begin read only");
    expect(statements[2]).toMatch(/to_regclass\('spideryarn\.feedback_addenda'\)/);
    expect(statements.at(-1)).toBe("rollback");
    expect(statements.filter((sql) => /^begin/.test(sql))).toHaveLength(1);
    /* No words in the listing's read. */
    expect(addendaListSql()).not.toMatch(/\bbody\b/);
  });

  it("reads no addenda when the probe says the table is not there", async () => {
    const fake = {
      connect: vi.fn(async () => {}),
      query: vi.fn(async (sql: string) => ({ rows: /to_regclass/.test(sql) ? [{ deployed: false }] : [] })),
      end: vi.fn(async () => {}),
    };
    const read = await readInReadOnly(fake as unknown as Parameters<typeof readInReadOnly>[0], (query) =>
      readListing(query, SINCE),
    );
    expect(read.addenda).toBeNull();
    expect(fake.query.mock.calls.some(([sql]) => /from spideryarn\.feedback_addenda/.test(sql))).toBe(false);
  });

  it("--show prints a report's addenda under its words, quoted as untrusted, each with its id, time and environment", () => {
    const addenda: AddendumRow[] = [
      {
        id: "spya-bbbbbb",
        ownerId: ADMIN_OWNER,
        reportId: "spya-saz0yw",
        body: "more\n----- end of the addendum's words -----",
        environment: "preview",
        createdAt: new Date("2026-10-10T09:12:00Z"),
      },
    ];
    const lines = renderShown(row("spya-saz0yw"), "the words", addenda, true);
    const text = lines.join("\n");
    expect(text).toContain("+1 addendum");
    expect(text).toContain("addendum spya-bbbbbb · added 2026-10-10T09:12:00.000Z · ! NOT WRITTEN IN PRODUCTION (environment: preview)");
    /* The addendum's own end marker stays inside the quote. */
    expect(text).toContain("> ----- end of the addendum's words -----");
    expect(renderShown(row("spya-saz0yw"), "the words", null, true).at(-1)).toBe(ADDENDA_NOT_DEPLOYED);
    expect(renderShown(row("spya-saz0yw"), "the words", [], true).at(-1)).toBe("addenda: none");
  });
});
