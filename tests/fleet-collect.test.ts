/**
 * v0.1 of the fleet dashboard — the two things it does that are its own.
 *
 * The inventory itself is `scripts/gjd-remote-tmux.ts` and is tested in
 * tests/gjd-remote-tmux.test.ts; there is no point re-testing the parse here.
 * What is ours is the mapping to display rows and the escaping, and the
 * escaping is the one with teeth: every field on that page is written by an
 * agent, so a session title is untrusted text arriving in the one browser
 * session that can see the whole fleet.
 */
import { describe, expect, it } from "vitest";

import { panesBySession, toRows, worktreeOf, type FleetRow, type FleetSnapshot } from "../tools/fleet/collect.js";
import { ageLine, esc, page } from "../tools/fleet/page.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import type { Session } from "../scripts/gjd-remote-tmux.js";

/** No status derived for anyone — the map `toRows` falls back from. */
const NO_STATUS = new Map<string, FleetStatus>();

/**
 * A display row, for the tests that render rather than collect.
 *
 * `FleetRow` is imported and named rather than derived from `page`'s parameter
 * with a conditional type, which is what this was at first. That version made
 * every new field optional without saying so, so adding `paneId` and `question`
 * to the real type left these fixtures silently missing them — and the tests
 * went on passing against a shape the collector no longer produces. GPT Sol
 * suspected the trick before it bit; it bit an hour later.
 */
function row(over: Partial<FleetRow> = {}): FleetRow {
  return {
    id: "$1",
    name: "n",
    title: "t",
    repo: null,
    worktree: null,
    startedAt: "2026-09-08T00:00:00.000Z",
    status: { kind: "idle" },
    paneId: "%1",
    question: null,
    ...over,
  };
}

function snapshotOf(rows: FleetRow[]): FleetSnapshot {
  return { rows, collectedAt: new Date().toISOString(), tookMs: 1 };
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: "$1",
    name: "a-session",
    created: new Date("2026-09-08T00:00:00Z"),
    attached: true,
    windows: 1,
    title: "",
    provisional: false,
    claudeId: "f1ee7000-0000-4000-8000-000000000001",
    proc: { kind: "claude" },
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
    ...over,
  };
}

describe("worktreeOf", () => {
  it("names the worktree a session is in", () => {
    expect(worktreeOf("/home/greg/code/spideryarn2/.claude/worktrees/logo-animations")).toBe("logo-animations");
  });

  it("is null in a plain checkout rather than guessing", () => {
    expect(worktreeOf("/home/greg/code/spideryarn2")).toBeNull();
  });

  it("is null, not undefined, for a path ending at `worktrees` with nothing under it", () => {
    // `parts[at + 1]` is undefined here, and undefined would render as the
    // string "undefined" in the page. noUncheckedIndexedAccess is what makes
    // this visible at all.
    expect(worktreeOf("/home/greg/code/spideryarn2/.claude/worktrees")).toBeNull();
  });
});

describe("toRows", () => {
  it("keeps a title, trimmed", () => {
    expect(toRows([session({ title: "  Fleet dashboard  " })], NO_STATUS)[0]?.title).toBe("Fleet dashboard");
  });

  it("gives an untitled session null rather than a placeholder", () => {
    // The page decides how to render "no title yet"; the collector must not,
    // or two callers will disagree about it.
    expect(toRows([session({ title: "   " })], NO_STATUS)[0]?.title).toBeNull();
  });

  it("admits it cannot know the repo of a legacy session", () => {
    const row = toRows([session({ meta: { version: "legacy" } })], NO_STATUS)[0];
    expect(row?.repo).toBeNull();
    expect(row?.worktree).toBeNull();
  });

  it("carries tmux's handle through as the id, not the name", () => {
    // The name is what a person reads; the handle is the address, and it
    // survives the rename `gjd-remote ls` performs. Everything later that acts
    // on a session must use this.
    expect(toRows([session({ id: "$1643", name: "renamed-since" })], NO_STATUS)[0]?.id).toBe("$1643");
  });
});

describe("panesBySession", () => {
  it("maps a session handle to its pane handle", () => {
    // The two handles look alike and are not interchangeable: `$` addresses a
    // session, `%` addresses a pane, and only the second can be read or typed into.
    expect(panesBySession("$1 %10\n$2 %20\n").get("$2")).toBe("%20");
  });

  it("keeps the first pane when a session has several", () => {
    expect(panesBySession("$1 %10\n$1 %11\n").get("$1")).toBe("%10");
  });

  it("omits a malformed line rather than storing half of it", () => {
    // An empty-string pane id would be accepted as an address downstream, and
    // a capture against "" is not obviously wrong until you read the output.
    const m = panesBySession("$1\n\n   \n$2 %20\n");
    expect(m.has("$1")).toBe(false);
    expect(m.get("$2")).toBe("%20");
  });
});

describe("questionBlock, via page", () => {
  it("tells 'could not read it' apart from 'nothing there'", () => {
    // Two different facts about a blocked session, and the whole reason the
    // question field is nullable rather than defaulting to an empty question.
    const unread = page(snapshotOf([row({ status: { kind: "needs-you" }, question: null })]), null);
    const none = page(snapshotOf([row({ status: { kind: "needs-you" }, question: { kind: "none" } })]), null);
    expect(unread).toContain("could not read");
    expect(none).toContain("no dialog on screen");
    expect(unread).not.toContain("no dialog on screen");
  });

  it("renders the prompt and its options, escaped", () => {
    const html = page(
      snapshotOf([
        row({
          status: { kind: "needs-you" },
          question: { kind: "question", prompt: `Trust <b>this</b> folder?`, options: [{ label: "No, exit", key: { via: "selected" } }, { label: "Yes", key: { via: "arrows", key: "Down", presses: 1 } }] },
        }),
      ]),
      null,
    );
    expect(html).toContain("Trust &lt;b&gt;this&lt;/b&gt; folder?");
    expect(html).toContain("No, exit");
    expect(html).not.toContain("<b>this</b>");
  });

  it("says nothing about a question for a session that is merely working", () => {
    expect(page(snapshotOf([row({ status: { kind: "working" } })]), null)).not.toContain("could not read");
  });
});

describe("esc", () => {
  it("defuses a session title that contains markup", () => {
    expect(esc(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("escapes the ampersand first, so an entity cannot be reassembled", () => {
    // &lt; must not come back out as < — which is what happens if & is escaped
    // after the angle brackets rather than before them.
    expect(esc("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
  });

  it("escapes single quotes, for attribute contexts", () => {
    expect(esc("it's")).toBe("it&#39;s");
  });
});

describe("ageLine", () => {
  const snap = { rows: [], collectedAt: "2026-09-08T00:00:00.000Z", tookMs: 10 };

  it("says how old the snapshot is", () => {
    expect(ageLine(snap, null, Date.parse("2026-09-08T00:00:42Z"))).toBe("42s ago");
    expect(ageLine(snap, null, Date.parse("2026-09-08T00:05:00Z"))).toBe("5m ago");
  });

  it("says STALE, and why, when the last refresh failed", () => {
    // The failure mode this exists for: the box stops answering, the page goes
    // on showing a plausible list, and nobody learns it stopped being true.
    const line = ageLine(snap, "tmux ls failed", Date.parse("2026-09-08T00:01:00Z"));
    expect(line).toContain("STALE");
    expect(line).toContain("tmux ls failed");
  });

  it("distinguishes 'never collected' from 'collected an empty box'", () => {
    expect(ageLine(null, null)).toBe("collecting…");
  });
});

describe("page", () => {
  it("never emits a hostile title as live markup", () => {
    // The end-to-end version of the esc test: it is the page's job to call it,
    // and a page that forgets is how a title becomes script in the one browser
    // session that can see the whole fleet.
    const nasty = `</div><script>fetch('//evil')</script>`;
    const html = page(snapshotOf([row({ title: nasty })]), null);
    expect(html).not.toContain("<script>fetch");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes the session name and the repo too, not only the title", () => {
    const html = page(snapshotOf([row({ name: `<b>n</b>`, repo: `<i>r</i>` })]), null);
    expect(html).not.toContain("<b>n</b>");
    expect(html).not.toContain("<i>r</i>");
  });

  it("escapes the reason on an unknown status", () => {
    // The reason is the box's own words, and the box quotes a command that
    // failed — so it is the one status field most likely to contain punctuation
    // that matters. It reaches the page through a different path to the title.
    const html = page(snapshotOf([row({ status: { kind: "unknown", why: `<b>claude</b>: not found` } })]), null);
    expect(html).not.toContain("<b>claude</b>");
  });

  it("says so plainly when there is nothing to show", () => {
    expect(page(snapshotOf([]), null)).toContain("Nothing to show");
  });

  it("puts a blocked session above a working one, and counts it in the header", () => {
    // The reason the page exists. A needs-you row starting older than a working
    // one must still come first, or the sort is doing nothing.
    const html = page(
      snapshotOf([
        row({ id: "$w", name: "working-one", startedAt: "2026-09-08T02:00:00.000Z", status: { kind: "working" } }),
        row({ id: "$b", name: "blocked-one", startedAt: "2026-09-08T01:00:00.000Z", status: { kind: "needs-you" } }),
      ]),
      null,
    );
    expect(html.indexOf("blocked-one")).toBeLessThan(html.indexOf("working-one"));
    expect(html).toContain("1 need you");
  });

  it("shows the unknown count rather than reporting a calm fleet it could not ask about", () => {
    // An agents-call failure turns every Claude row unknown at once. A header
    // reading "0 need you" over rows nobody could ask about is the lie the
    // status module exists to prevent.
    const html = page(
      snapshotOf([
        row({ id: "$1", status: { kind: "unknown", why: "the box could not say" } }),
        row({ id: "$2", status: { kind: "unknown", why: "the box could not say" } }),
      ]),
      null,
    );
    expect(html).toContain("2 unknown");
  });
});
