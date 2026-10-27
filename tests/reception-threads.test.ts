/**
 * The pure half of Reception's threads (src/web/reception-threads.ts, plan 260930j).
 * The panel's behaviour is in tests/reception-and-claims-panel.test.tsx § threads.
 */
import { describe, expect, it } from "vitest";

import {
  inThread,
  KEY_THREAD,
  keyByRow,
  selectedThread,
  shownInThread,
  threadsOf,
  threadsWithin,
} from "../src/web/reception-threads.js";
import { receptionThreadParam } from "../src/web/params.js";
import type { Reception, ReceptionSynthesis } from "../src/types.js";
import { receptionSelection, receptionThreads, sourcesCounts } from "../src/web/sources-counts.js";

const made: ReceptionSynthesis = {
  kind: "made",
  themes: [{ id: "spya-thm002", label: "L", gist: "G", rowIds: ["spya-r00001", "spya-r00002"] }],
  key: [{ rowId: "spya-r00003", role: "origin", why: "W" }],
};

describe("threadsOf", () => {
  it("is empty for anything but a made synthesis", () => {
    expect(threadsOf(null)).toEqual([]);
    expect(threadsOf({ kind: "failed" })).toEqual([]);
    expect(threadsOf({ kind: "too-few", rows: 2 })).toEqual([]);
  });

  it("puts the key sources first, and leaves them out when there are none", () => {
    expect(threadsOf(made).map((t) => t.id)).toEqual([KEY_THREAD, "spya-thm002"]);
    expect(threadsOf({ ...made, key: [] }).map((t) => t.id)).toEqual(["spya-thm002"]);
  });
});

describe("selecting and filtering", () => {
  const threads = threadsOf(made);
  const rows = [{ id: "spya-r00001" }, { id: "spya-r00002" }, { id: "spya-r00003" }];

  it("names a thread by id, and nothing for an id that is not here", () => {
    expect(selectedThread(threads, "spya-thm002")?.label).toBe("L");
    expect(selectedThread(threads, "spya-gone00")).toBeNull();
    expect(selectedThread(threads, null)).toBeNull();
  });

  it("keeps a thread's rows in their own order, and every row for no thread", () => {
    const theme = selectedThread(threads, "spya-thm002");
    expect(inThread(rows, theme).map((r) => r.id)).toEqual(["spya-r00001", "spya-r00002"]);
    expect(inThread(rows, null)).toEqual(rows);
  });

  it("counts only the rows still on screen", () => {
    const theme = selectedThread(threads, "spya-thm002");
    if (theme === null) throw new Error("no theme");
    expect(shownInThread(theme, rows)).toBe(2);
    expect(shownInThread(theme, [{ id: "spya-r00002" }])).toBe(1);
  });

  it("maps each key row to its reason", () => {
    expect(keyByRow(made).get("spya-r00003")?.role).toBe("origin");
    expect(keyByRow({ kind: "failed" }).size).toBe(0);
  });
});

/* Plan 261003o, step 6: Reception and Claims each draw their own rows, so a
   thread is offered in a sub-mode only when it has a **stored** row there.
   One whose rows there are merely hidden by the bar is still offered (the
   panel disables it and says why). */
describe("scoped to a sub-mode's stored rows", () => {
  const threads = threadsOf(made);
  const reception = [{ id: "spya-r00003" }];
  const claims = [{ id: "spya-r00001" }, { id: "spya-r00002" }];

  it("offers a thread only where it has a stored row", () => {
    expect(threadsWithin(threads, reception).map((t) => t.id)).toEqual([KEY_THREAD]);
    expect(threadsWithin(threads, claims).map((t) => t.id)).toEqual(["spya-thm002"]);
    expect(threadsWithin(threads, [])).toEqual([]);
  });

  it("does not select a thread the address names when it has no stored row here", () => {
    /* An old `debatethread=key` link whose key sources are all in the other
       sub-mode must not empty this one, and must not be drawn as selected. */
    const here = threadsWithin(threads, claims);
    expect(selectedThread(here, KEY_THREAD)).toBeNull();
    expect(inThread(claims, selectedThread(here, KEY_THREAD))).toEqual(claims);
    /* The positive control: where it has a row, it is selected. */
    expect(selectedThread(threadsWithin(threads, reception), KEY_THREAD)?.id).toBe(KEY_THREAD);
  });
});

describe("?debatethread=", () => {
  it("takes `key` or an id, and nothing else", () => {
    expect(receptionThreadParam.parse("key")).toBe("key");
    expect(receptionThreadParam.parse("spya-k3m9qt")).toBe("spya-k3m9qt");
    expect(receptionThreadParam.parse("nonsense")).toBeNull();
    expect(receptionThreadParam.parse("")).toBeNull();
  });
});

/* Plan 261020n: in Reception a thread is a section, not a filter. The chip,
   each section's count and the (i) come out of `receptionSelection` and
   `sourcesCounts` together (sources-counts.ts), so they cannot disagree. */
describe("Reception's sections and its chip", () => {
  const row = (id: string, url: string) => ({ id, url, relation: "disputes", lean: "neither" });
  const direct = [row("spya-r00001", "https://a.example/1"), row("spya-r00002", "https://b.example/2")];
  const claims = [
    row("spya-r00003", "https://c.example/3"),
    row("spya-r00004", "https://d.example/4"),
    row("spya-r00005", "https://e.example/5"),
  ];
  const reception = {
    direct: { rows: direct },
    claims: { rows: claims },
    synthesis: {
      kind: "made",
      themes: [
        { id: "spya-thm002", label: "Both", gist: "G", rowIds: ["spya-r00001", "spya-r00002"] },
        { id: "spya-thm003", label: "Claims only", gist: "G", rowIds: ["spya-r00003", "spya-r00004"] },
      ],
      key: [{ rowId: "spya-r00002", role: "origin", why: "W" }],
    },
  } as unknown as Reception;

  it("holds every stored row, and a section for each thread with a stored row here", () => {
    const selection = receptionSelection(reception, receptionThreads(reception));
    expect(selection.rows.map((r) => r.id)).toEqual(["spya-r00001", "spya-r00002"]);
    expect(selection.sections.map((s) => [s.thread.id, s.rows.map((r) => r.id)])).toEqual([
      [KEY_THREAD, ["spya-r00002"]],
      ["spya-thm002", ["spya-r00001", "spya-r00002"]],
    ]);
  });

  it("counts every stored row on the chip, whatever thread the address names", () => {
    for (const thread of [null, KEY_THREAD, "spya-thm002", "spya-gone00"]) {
      const counts = sourcesCounts({
        works: null,
        links: [],
        reception,
        listed: null,
        checked: 0,
        relevance: null,
        thread,
      });
      expect(counts.reception, String(thread)).toBe(2);
    }
    /* The positive control: the same address still narrows Claims' count. */
    const narrowed = sourcesCounts({
      works: null,
      links: [],
      reception,
      listed: null,
      checked: 0,
      relevance: null,
      thread: "spya-thm003",
    });
    expect(narrowed.claims).toEqual({ n: 2, unit: "source" });
    const unnarrowed = { works: null, links: [], reception, listed: null, checked: 0, relevance: null, thread: KEY_THREAD };
    expect(sourcesCounts(unnarrowed).claims).toEqual({ n: 3, unit: "source" });
  });
});
