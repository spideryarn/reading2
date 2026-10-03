/**
 * The pure half of Debate's threads (src/web/debate-threads.ts, plan 260930j).
 * The panel's behaviour is in tests/debate-panel.test.tsx § threads.
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
} from "../src/web/debate-threads.js";
import { debateThreadParam } from "../src/web/params.js";
import type { DebateSynthesis } from "../src/types.js";

const made: DebateSynthesis = {
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
    expect(debateThreadParam.parse("key")).toBe("key");
    expect(debateThreadParam.parse("spya-k3m9qt")).toBe("spya-k3m9qt");
    expect(debateThreadParam.parse("nonsense")).toBeNull();
    expect(debateThreadParam.parse("")).toBeNull();
  });
});
