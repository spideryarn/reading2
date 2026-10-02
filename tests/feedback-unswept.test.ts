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
import { describe, expect, it } from "vitest";

import {
  coveredReportIds,
  parseSince,
  queueSources,
  renderUnswept,
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
  });
});
