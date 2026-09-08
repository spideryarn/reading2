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

import { toRows, worktreeOf } from "../tools/fleet/collect.js";
import { ageLine, esc, page } from "../tools/fleet/page.js";
import type { Session } from "../scripts/gjd-remote-tmux.js";

function session(over: Partial<Session> = {}): Session {
  return {
    id: "$1",
    name: "a-session",
    created: new Date("2026-09-08T00:00:00Z"),
    attached: true,
    windows: 1,
    title: "",
    provisional: false,
    /* Its own id, not the shared `1111…` one. That belongs to `db-schema.test.ts`,
       which inserts a row under it — and vitest runs files in parallel against one
       database, so whichever tore down first would delete the other's fixture.
       Nothing here inserts anything; this is an in-memory `Session` and the value
       is opaque. `tests/fixture-ids.test.ts` is what noticed. */
    claudeId: "00000000-0000-4000-8000-00000000f1ee",
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
    expect(toRows([session({ title: "  Fleet dashboard  " })])[0]?.title).toBe("Fleet dashboard");
  });

  it("gives an untitled session null rather than a placeholder", () => {
    // The page decides how to render "no title yet"; the collector must not,
    // or two callers will disagree about it.
    expect(toRows([session({ title: "   " })])[0]?.title).toBeNull();
  });

  it("admits it cannot know the repo of a legacy session", () => {
    const row = toRows([session({ meta: { version: "legacy" } })])[0];
    expect(row?.repo).toBeNull();
    expect(row?.worktree).toBeNull();
  });

  it("carries tmux's handle through as the id, not the name", () => {
    // The name is what a person reads; the handle is the address, and it
    // survives the rename `gjd-remote ls` performs. Everything later that acts
    // on a session must use this.
    expect(toRows([session({ id: "$1643", name: "renamed-since" })])[0]?.id).toBe("$1643");
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
    const html = page({ rows: [{ id: "$1", name: "n", title: nasty, repo: null, worktree: null, startedAt: "" }], collectedAt: new Date().toISOString(), tookMs: 1 }, null);
    expect(html).not.toContain("<script>fetch");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes the session name and the repo too, not only the title", () => {
    const html = page({ rows: [{ id: "$1", name: `<b>n</b>`, title: "t", repo: `<i>r</i>`, worktree: null, startedAt: "" }], collectedAt: new Date().toISOString(), tookMs: 1 }, null);
    expect(html).not.toContain("<b>n</b>");
    expect(html).not.toContain("<i>r</i>");
  });

  it("says so plainly when there is nothing to show", () => {
    expect(page({ rows: [], collectedAt: new Date().toISOString(), tookMs: 1 }, null)).toContain("Nothing to show");
  });
});
