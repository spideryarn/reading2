/**
 * Renaming a session, and the second half of it that is easy to forget.
 *
 * The failure this file exists to prevent is not a bad name reaching tmux. It
 * is a rename that works and then quietly comes undone: `gjd-remote ls` renames
 * any still-*provisional* session to Claude's own title, so a rename that does
 * not clear `GJD_PROVISIONAL` is right on the page until somebody lists the
 * fleet, and then wrong with nothing to explain it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  NAME_RULE,
  RENAME_STATUS,
  checkName,
  checkRequest,
  makeRenameRoute,
  parseSessionNames,
  type RenameIo,
} from "../tools/fleet/routes-rename.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Three sessions, the way tmux lists them. */
const LISTING = "$1643 fleet-dashboard-v01\n$1207 arch-a10-style-ownership\n$2211 minimal-update\n";

function fakeIo(over: Partial<RenameIo> = {}): { io: RenameIo; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    io: {
      listSessions: over.listSessions ?? (() => LISTING),
      rename:
        over.rename ??
        ((sessionId, name) => {
          calls.push([sessionId, name]);
        }),
    },
  };
}

function fakeReq(opts: { body?: string; method?: string; headers?: Record<string, string> } = {}) {
  const stream = new PassThrough();
  stream.end(opts.body ?? "");
  return Object.assign(stream, {
    url: "/api/sessions/rename",
    method: opts.method ?? "POST",
    headers: {
      host: "127.0.0.1:8787",
      origin: "http://127.0.0.1:8787",
      "content-type": "application/json",
      ...opts.headers,
    },
  }) as unknown as import("node:http").IncomingMessage;
}

function fakeRes() {
  let status = 0;
  let body = "";
  let done: () => void;
  const finished = new Promise<void>((r) => (done = r));
  const res = {
    writeHead(s: number) {
      status = s;
      return res;
    },
    end(chunk?: string) {
      body = chunk ?? "";
      done();
    },
  };
  return { res: res as unknown as import("node:http").ServerResponse, finished, read: () => ({ status, body }) };
}

async function post(io: RenameIo, body: unknown, headers?: Record<string, string>) {
  const routes = makeRenameRoute({ io, log: () => {} });
  const { res, finished, read } = fakeRes();
  const handled = routes.handle(fakeReq({ body: JSON.stringify(body), ...(headers ? { headers } : {}) }), res);
  expect(handled).toBe(true);
  await finished;
  const { status, body: text } = read();
  return { status, json: JSON.parse(text) as Record<string, unknown> };
}

describe("the name rule", () => {
  it("is the same text as gjd-remote's own SLUG", () => {
    // Restated rather than imported, because the original lives in a CLI with a
    // `main()`. That is a copy, and a copy drifts — so read the source and
    // compare, which is the only version of this that keeps working.
    const cli = readFileSync(path.join(HERE, "..", "scripts", "gjd-remote.ts"), "utf8");
    const found = /^const SLUG = (\/.*\/);$/m.exec(cli);
    expect(found, "gjd-remote.ts no longer declares SLUG the way this test expects").not.toBeNull();
    expect(found?.[1]).toBe(NAME_RULE.toString());
  });

  it("accepts the names on this box and refuses the shapes tmux would mangle", () => {
    for (const good of ["fleet-dashboard-v01", "a", "arch-a10-style-ownership", "s-260908-042704"]) {
      expect(NAME_RULE.test(good), good).toBe(true);
    }
    for (const bad of ["-leading-hyphen", "Capitals", "has space", "has_underscore", "$1643", "a".repeat(42)]) {
      expect(NAME_RULE.test(bad), bad).toBe(false);
    }
  });
});

describe("parseSessionNames", () => {
  it("maps handles to names, including names with spaces in them", () => {
    // tmux allows a space in a session name even though our rule does not, and
    // the listing is space-separated — so splitting on the FIRST space is the
    // difference between reading an existing name and truncating it.
    const m = parseSessionNames("$1 one\n$2 two words here\n");
    expect(m.get("$1")).toBe("one");
    expect(m.get("$2")).toBe("two words here");
  });

  it("skips a line whose id is not a handle rather than storing it", () => {
    const m = parseSessionNames("not-a-handle thing\n$3 real\n");
    expect(m.has("not-a-handle")).toBe(false);
    expect(m.get("$3")).toBe("real");
  });
});

describe("checkName", () => {
  const names = parseSessionNames(LISTING);

  it("refuses a name another session already has, naming which", () => {
    const bad = checkName("arch-a10-style-ownership", "$1643", names);
    expect(bad?.code).toBe("name-taken");
    expect(bad?.why).toContain("$1207");
  });

  it("ALLOWS renaming a session to the name it already has", () => {
    // Not a no-op, and this is the case a naive "is it taken?" check gets
    // wrong. The rename also clears GJD_PROVISIONAL, so this is how somebody
    // pins a name Claude chose and which they now want kept — refusing it as
    // "taken by yourself" would refuse the one case where the second half of
    // the operation is the entire point.
    expect(checkName("fleet-dashboard-v01", "$1643", names)).toBeNull();
  });

  it("refuses a session that is no longer on the box", () => {
    expect(checkName("anything", "$9999", names)?.code).toBe("no-such-session");
  });

  it("refuses an empty or malformed name with a sentence a person can act on", () => {
    expect(checkName("", "$1643", names)?.code).toBe("bad-name");
    expect(checkName("Has Capitals", "$1643", names)?.why).toContain("lower-case letters");
    expect(checkName(42, "$1643", names)?.code).toBe("bad-name");
    // The positive half, so this cannot pass by checkName refusing everything.
    expect(checkName("a-fine-name", "$1643", names)).toBeNull();
  });
});

describe("the route", () => {
  it("renames AND clears the provisional flag, in one invocation", async () => {
    // The whole point of the file. `gjd-remote ls` renames any still-provisional
    // session to Claude's own title, so a rename that skips the second half is
    // one that silently comes undone the next time anybody lists the fleet.
    const { io, calls } = fakeIo();
    const r = await post(io, { sessionId: "$1643", name: "greg-picked-this" });
    expect(r.status).toBe(200);
    expect(r.json["name"]).toBe("greg-picked-this");
    expect(r.json["was"]).toBe("fleet-dashboard-v01");
    expect(calls).toEqual([["$1643", "greg-picked-this"]]);
  });

  it("really does pass the set-environment half to tmux", async () => {
    // The test above proves the route calls `rename`; this proves what `rename`
    // actually runs, which is where the flag could go missing. Asserted against
    // the source, because the real io is the one thing a fake cannot check.
    const src = readFileSync(path.join(HERE, "..", "tools", "fleet", "routes-rename.ts"), "utf8");
    expect(src).toContain('"rename-session"');
    expect(src).toContain('"GJD_PROVISIONAL"');
    // One invocation, not two: a gap between them is a window in which the
    // session is renamed and still provisional.
    expect(src).toContain('";"');
  });

  it("addresses by handle and refuses a name as an address", async () => {
    // `-t` will happily resolve a session NAME, and a name is exactly what is
    // about to change. A rename addressed by name can hit the wrong session.
    const { io, calls } = fakeIo();
    const r = await post(io, { sessionId: "fleet-dashboard-v01", name: "new-name" });
    expect(r.status).toBe(400);
    expect(String(r.json["why"])).toContain("a name is not an address");
    expect(calls).toEqual([]);
  });

  it("refuses a cross-origin caller, and a rebound one", async () => {
    for (const headers of [
      { origin: "http://evil.example" },
      { host: "evil.example", origin: "http://evil.example" },
    ]) {
      const { io, calls } = fakeIo();
      const r = await post(io, { sessionId: "$1643", name: "new-name" }, headers);
      expect(r.status).toBe(403);
      expect(calls).toEqual([]);
    }
    // And the positive half: a real same-origin request still works.
    const { io, calls } = fakeIo();
    expect((await post(io, { sessionId: "$1643", name: "new-name" })).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("does not rename when tmux cannot be listed", async () => {
    // "I could not ask" must not become "that name is free".
    const { io, calls } = fakeIo({
      listSessions: () => {
        throw new Error("no server running on /tmp/tmux-1000/default");
      },
    });
    const r = await post(io, { sessionId: "$1643", name: "new-name" });
    expect(r.status).toBe(409);
    expect(r.json["code"]).toBe("rename-failed");
    expect(calls).toEqual([]);
  });

  it("reports a tmux refusal without echoing the thrown error", async () => {
    const { io } = fakeIo({
      rename: () => {
        throw new Error("Command failed: tmux rename-session -t $1643 …\ncan't find session: $1643");
      },
    });
    const r = await post(io, { sessionId: "$1643", name: "new-name" });
    expect(r.status).toBe(409);
    expect(String(r.json["why"])).toContain("that session is gone");
    // The argv is not in the answer. Not secret here, but the habit is: the
    // steering route had exactly this as a real privacy hole.
    expect(String(r.json["why"])).not.toContain("rename-session -t");
    expect(String(r.json["why"])).toContain("tmux refused");
  });

  it("maps every code to a 4xx or the one 5xx, and never to a 200", () => {
    for (const [code, status] of Object.entries(RENAME_STATUS)) {
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
    expect(RENAME_STATUS.internal).toBe(500);
  });

  it("leaves a path that is not ours alone", () => {
    const routes = makeRenameRoute({ io: fakeIo().io, log: () => {} });
    const { res } = fakeRes();
    const req = fakeReq();
    (req as { url: string }).url = "/api/state";
    expect(routes.handle(req, res)).toBe(false);
  });
});

describe("checkRequest", () => {
  it("needs a JSON content type", () => {
    expect(checkRequest({ host: "x", origin: "http://x", "content-type": "text/plain" })?.code).toBe(
      "unsupported-media-type",
    );
    // Positive half.
    expect(
      checkRequest({ host: "127.0.0.1:8787", origin: "http://127.0.0.1:8787", "content-type": "application/json" }),
    ).toBeNull();
  });
});
