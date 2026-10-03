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
  coveredReportIds,
  parseCommand,
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
import { CannotTell } from "../scripts/feedback-reporter.js";
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
    ...over,
  };
}

const note = (name: string, reports: string) => ({
  name,
  text: `---\nreports: ${reports}\nending: shipped\n---\n# A note\n`,
});

/** A queue item with only the two fields coverage reads; the rest is not this test's business. */
function item(source: string | null, text = "a report"): IdeaItem {
  return { text, metadata: { source } } as unknown as IdeaItem;
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
    expect(parseCommand(["--show", "spya-aaaaaa"], now)).toEqual({
      kind: "show",
      id: "spya-aaaaaa",
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
