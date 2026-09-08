/**
 * Starting a session from the dashboard — tools/fleet/routes-new.ts.
 *
 * **NOTHING HERE STARTS A CLAUDE.** Every test drives an injected `run` seam,
 * and the assertions are about the *argv* it was handed and the *bytes* that
 * went down its stdin — because the two things that could actually hurt are the
 * prompt reaching a command line and a request reaching this route from a page
 * that is not ours. A fake that took a ready-made `{name, dir, prompt}` would
 * have tested everything except the part where user text meets a process.
 *
 * The box already had ~37 live agent sessions and a load average of 27 while
 * this was written, which is the other reason: a suite that starts real
 * sessions is a suite nobody can run twice. One real session WAS started, once,
 * by hand, to prove the thing these fakes cannot — that a session started this
 * way is a Claude row on the dashboard rather than a bare shell. That is in the
 * report, not in here.
 */
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  checkDir,
  checkRequest,
  createNewSessionRoutes,
  interpretRun,
  lastWords,
  MAX_PROMPT_BYTES,
  newClaudeArgs,
  parseNewSessionBody,
  parseStartedName,
  stripAnsi,
  type LaunchRecord,
  type NewSessionIo,
  type RunRequest,
  type RunResult,
} from "../tools/fleet/routes-new.js";

/* ---------------------------------------------------------------- *
 * A server, faked at the two seams that matter: HTTP and the box.
 * ---------------------------------------------------------------- */

const ROOT = "/home/greg/code/spideryarn2";
const DIR = "/home/greg/code/spideryarn2";

type FakeRes = {
  status: number | null;
  headers: Record<string, string>;
  body: string;
  json: () => any;
};

function makeRes(): { res: any; out: FakeRes } {
  const out: FakeRes = { status: null, headers: {}, body: "", json: () => JSON.parse(out.body) };
  const res = {
    headersSent: false,
    setHeader(k: string, v: string) {
      out.headers[k.toLowerCase()] = v;
    },
    writeHead(status: number, headers: Record<string, string> = {}) {
      out.status = status;
      for (const [k, v] of Object.entries(headers)) out.headers[k.toLowerCase()] = v;
      this.headersSent = true;
      return this;
    },
    end(chunk?: string) {
      if (chunk !== undefined) out.body += chunk;
    },
  };
  return { res, out };
}

const GOOD_HEADERS = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  "content-type": "application/json",
};

function makeReq(opts: { method?: string; url?: string; headers?: Record<string, string>; body?: string }): any {
  const req: any = Readable.from([Buffer.from(opts.body ?? "")]);
  req.method = opts.method ?? "POST";
  req.url = opts.url ?? "/api/sessions/new";
  req.headers = opts.headers ?? GOOD_HEADERS;
  return req;
}

type Fake = {
  routes: ReturnType<typeof createNewSessionRoutes>;
  runs: RunRequest[];
  logs: string[];
  /** Finish the pending run with this result. */
  finish: (r: Partial<RunResult>) => Promise<void>;
  /** Move the injected clock. */
  tick: (ms: number) => void;
  health: { level: "ok" | "strained" | "critical" | "unknown" };
  post: (body: unknown, headers?: Record<string, string>) => Promise<FakeRes>;
  get: () => Promise<FakeRes>;
};

function fake(overrides: Parameters<typeof createNewSessionRoutes>[0] = {}): Fake {
  const runs: RunRequest[] = [];
  const logs: string[] = [];
  const health = { level: "ok" as "ok" | "strained" | "critical" | "unknown" };
  let clock = 1_700_000_000_000;
  let settle: ((r: RunResult) => void) | null = null;

  const io: NewSessionIo = {
    run: (req) => {
      runs.push(req);
      return new Promise<RunResult>((resolve) => {
        settle = resolve;
      });
    },
    dirExists: () => true,
    healthLevel: () => health.level,
    now: () => clock,
    log: (line) => logs.push(line),
  };

  const routes = createNewSessionRoutes({
    io,
    root: ROOT,
    defaultDir: DIR,
    roots: ["/home/greg"],
    timeoutMs: 240_000,
    cooldownMs: 60_000,
    ...overrides,
  });

  return {
    routes,
    runs,
    logs,
    health,
    tick: (ms) => {
      clock += ms;
    },
    finish: async (r) => {
      const f = settle;
      if (!f) throw new Error("nothing is running");
      settle = null;
      f({ code: 0, stdout: "", stderr: "", timedOut: false, spawnError: null, ...r });
      // Two turns: the launch awaits the run, then writes the record.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    post: async (body, headers) => {
      const { res, out } = makeRes();
      await routes.handle(
        makeReq({ headers: headers ?? GOOD_HEADERS, body: typeof body === "string" ? body : JSON.stringify(body) }),
        res,
      );
      return out;
    },
    get: async () => {
      const { res, out } = makeRes();
      await routes.handle(makeReq({ method: "GET", body: "" }), res);
      return out;
    },
  };
}

/* ---------------------------------------------------------------- *
 * The happy path, which is entirely about what the seam was handed.
 * ---------------------------------------------------------------- */

describe("a valid request runs gjd-remote new-claude, with the prompt on stdin", () => {
  it("hands the seam the expected argv, and the prompt only through stdin", async () => {
    const f = fake();
    const prompt = "read docs/project/vision.md and tell me what it says";
    const out = await f.post({ prompt });

    expect(out.status).toBe(202);
    expect(f.runs).toHaveLength(1);
    const run = f.runs[0]!;
    expect(run.args).toEqual([
      expect.stringContaining("tsx"),
      `${ROOT}/scripts/gjd-remote.ts`,
      "new-claude",
      "-d",
      DIR,
      "-p",
      "-",
      "--no-attach",
    ]);
    expect(run.stdinText).toBe(prompt);
    expect(run.cwd).toBe(ROOT);
    // THE POINT OF THE WHOLE FILE: the prompt is in no argument, anywhere.
    expect(run.args.join(" ")).not.toContain("read docs");
    expect(run.bin).not.toMatch(/sh$|bash|-c/);
  });

  it("reports starting, then started with the name gjd-remote printed", async () => {
    const f = fake();
    const accepted = await f.post({ prompt: "hello" });
    expect(accepted.json().launch.state).toBe("starting");
    expect(accepted.json().launch.name).toBeNull();

    await f.finish({ code: 0, stdout: "gjd-remote new-claude s-260908-0304 → box:/x\n✓ started 's-260908-0304'\n" });

    const state = (await f.get()).json();
    expect(state.busy).toBe(false);
    expect(state.launches[0].state).toBe("started");
    expect(state.launches[0].name).toBe("s-260908-0304");
    expect(state.launches[0].error).toBeNull();
  });

  it("passes a requested name as a positional, and a requested dir with -d", async () => {
    const f = fake();
    await f.post({ prompt: "hi", name: "wf-new-probe", dir: "/home/greg/code/gjdutils" });
    expect(f.runs[0]!.args).toEqual([
      expect.stringContaining("tsx"),
      `${ROOT}/scripts/gjd-remote.ts`,
      "new-claude",
      "wf-new-probe",
      "-d",
      "/home/greg/code/gjdutils",
      "-p",
      "-",
      "--no-attach",
    ]);
  });

  it("never writes the prompt to the log", async () => {
    const f = fake();
    await f.post({ prompt: "my private instruction about the acquisition" });
    await f.finish({ code: 0, stdout: "✓ started 'x'\n" });
    expect(f.logs.join("\n")).not.toContain("acquisition");
    expect(f.logs.join("\n")).toContain("promptBytes=");
  });

  it("newClaudeArgs is the whole argv decision, and it is pure", () => {
    expect(newClaudeArgs("/s/g.ts", { name: null, dir: "/d" })).toEqual([
      "/s/g.ts",
      "new-claude",
      "-d",
      "/d",
      "-p",
      "-",
      "--no-attach",
    ]);
    expect(newClaudeArgs("/s/g.ts", { name: "n", dir: "/d" })[2]).toBe("n");
  });
});

/* ---------------------------------------------------------------- *
 * Untrusted input.
 * ---------------------------------------------------------------- */

describe("the body is checked before anything is run", () => {
  const parse = (raw: string) => parseNewSessionBody(raw, { defaultDir: DIR, roots: ["/home/greg"] });

  it("refuses an empty or whitespace-only prompt", async () => {
    const f = fake();
    for (const prompt of ["", "   ", "\n\t "]) {
      const out = await f.post({ prompt });
      expect(out.status).toBe(400);
      expect(out.json().error).toMatch(/empty/);
    }
    expect(f.runs).toHaveLength(0);
  });

  it("refuses a prompt over the cap, in kilobytes a person can read", async () => {
    const f = fake();
    const out = await f.post({ prompt: "x".repeat(MAX_PROMPT_BYTES + 1) });
    expect(out.status).toBe(413);
    expect(out.json().error).toMatch(/32KB/);
    expect(f.runs).toHaveLength(0);
  });

  it("refuses a body that is not JSON, not an object, or has no prompt", async () => {
    const f = fake();
    expect((await f.post("not json at all")).status).toBe(400);
    expect((await f.post([1, 2, 3])).status).toBe(400);
    expect((await f.post({ dir: DIR })).status).toBe(400);
    expect((await f.post({ prompt: 42 })).status).toBe(400);
    expect(f.runs).toHaveLength(0);
  });

  it("refuses a prompt or a dir carrying bytes that would be lost on the way", () => {
    expect(parse(JSON.stringify({ prompt: "a\u0000b" }))).toMatchObject({ ok: false, status: 400 });
    expect(parse(JSON.stringify({ prompt: "ok", dir: "/home/greg/a\nb" }))).toMatchObject({ ok: false });
  });

  it("keeps a multi-line prompt, which is the ordinary case", () => {
    const r = parse(JSON.stringify({ prompt: "line one\nline two\n" }));
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.value.prompt).toBe("line one\nline two\n");
  });

  it("refuses a name tmux would not take", () => {
    for (const name of ["Has Capitals", "with space", "x".repeat(42), "-", "../etc"]) {
      expect(parse(JSON.stringify({ prompt: "p", name }))).toMatchObject({ ok: false, status: 400 });
    }
    expect(parse(JSON.stringify({ prompt: "p", name: "wf-new-1" }))).toMatchObject({ ok: true });
  });

  it("defaults the directory rather than making the client know one", () => {
    const r = parse(JSON.stringify({ prompt: "p" }));
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.value.dir).toBe(DIR);
  });
});

describe("the directory is a path this box may start an agent in", () => {
  const roots = ["/home/greg"];
  it("takes an absolute, normalised path under an allowed root", () => {
    expect(checkDir("/home/greg/code/x", roots)).toEqual({ ok: true, value: "/home/greg/code/x" });
  });
  it("refuses a relative path, a traversal, or a trailing slash — anything not already its own resolution", () => {
    for (const dir of ["code/x", "/home/greg/../etc", "/home/greg/code/", "/home/greg/./code", ""]) {
      expect(checkDir(dir, roots)).toMatchObject({ ok: false, status: 400 });
    }
  });
  it("refuses a path outside the allowed roots, however well formed", () => {
    for (const dir of ["/etc", "/tmp/x", "/home/other/code"]) {
      expect(checkDir(dir, roots)).toMatchObject({ ok: false, status: 400 });
    }
  });
  it("refuses a directory that is not on the box, without running anything", async () => {
    const runs: RunRequest[] = [];
    const routes = createNewSessionRoutes({
      root: ROOT,
      defaultDir: DIR,
      roots,
      io: {
        run: (r) => {
          runs.push(r);
          return Promise.resolve({ code: 0, stdout: "", stderr: "", timedOut: false, spawnError: null });
        },
        dirExists: () => false,
        healthLevel: () => "ok",
        now: () => 1,
        log: () => {},
      },
    });
    const { res, out } = makeRes();
    await routes.handle(makeReq({ body: JSON.stringify({ prompt: "p" }) }), res);
    expect(out.status).toBe(400);
    expect(out.json().error).toMatch(/not a directory/);
    expect(runs).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------- *
 * CSRF. There is no authentication, so this is the whole lock.
 * ---------------------------------------------------------------- */

describe("a mutation must come from this page, in this browser", () => {
  it("refuses a missing Origin rather than waving it through", async () => {
    const f = fake();
    const { origin, ...noOrigin } = GOOD_HEADERS;
    const out = await f.post({ prompt: "p" }, noOrigin);
    expect(out.status).toBe(403);
    // The REASON, not just the number: a missing header must be refused by the
    // check that is about missing headers, and not fall through to the URL
    // parse below it, which refuses `undefined` for an unrelated reason and
    // would keep this test green if the guard were deleted.
    expect(out.json().error).toMatch(/needs a same-origin Origin header/);
    expect(f.runs).toHaveLength(0);
  });

  it("refuses the literal 'null' Origin a sandboxed frame sends", async () => {
    const f = fake();
    const out = await f.post({ prompt: "p" }, { ...GOOD_HEADERS, origin: "null" });
    expect(out.status).toBe(403);
    expect(out.json().error).toMatch(/needs a same-origin Origin header/);
    expect(f.runs).toHaveLength(0);
  });

  it("refuses a foreign Origin, including one that merely looks like ours", async () => {
    const f = fake();
    for (const origin of ["http://evil.example", "http://127.0.0.1:8787.evil.example", "http://127.0.0.1:9999"]) {
      const out = await f.post({ prompt: "p" }, { ...GOOD_HEADERS, origin });
      expect(out.status).toBe(403);
    }
    expect(f.runs).toHaveLength(0);
  });

  it("refuses a cross-site request the browser itself has labelled", () => {
    expect(checkRequest({ ...GOOD_HEADERS, "sec-fetch-site": "cross-site" })).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...GOOD_HEADERS, "sec-fetch-site": "same-origin" })).toMatchObject({ ok: true });
  });

  it("refuses anything but application/json — which is what stops a plain HTML form", async () => {
    const f = fake();
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", undefined]) {
      const headers: Record<string, string> = { ...GOOD_HEADERS };
      if (type === undefined) delete headers["content-type"];
      else headers["content-type"] = type;
      const out = await f.post({ prompt: "p" }, headers);
      expect(out.status).toBe(415);
    }
    expect(f.runs).toHaveLength(0);
  });

  it("accepts the charset browsers add", () => {
    expect(checkRequest({ ...GOOD_HEADERS, "content-type": "application/json; charset=utf-8" })).toMatchObject({
      ok: true,
    });
  });

  it("refuses a request with no Host, because same-origin then means nothing", () => {
    const { host, ...noHost } = GOOD_HEADERS;
    expect(checkRequest(noHost)).toMatchObject({ ok: false, status: 400 });
  });

  it("does not answer GET, PUT or DELETE as if they were a launch", async () => {
    const f = fake();
    const { res, out } = makeRes();
    await f.routes.handle(makeReq({ method: "DELETE", body: "" }), res);
    expect(out.status).toBe(405);
    expect(f.runs).toHaveLength(0);
  });

  it("404s a path that is not this route, so a mount by prefix cannot widen it", async () => {
    const f = fake();
    const { res, out } = makeRes();
    await f.routes.handle(makeReq({ url: "/api/sessions/new/../../etc", body: "" }), res);
    expect(out.status).toBe(404);
  });
});

/* ---------------------------------------------------------------- *
 * The limiter. This route can consume the box.
 * ---------------------------------------------------------------- */

describe("one at a time, then a cooldown", () => {
  it("refuses a second request while the first is still starting, and runs nothing", async () => {
    const f = fake();
    const first = await f.post({ prompt: "one" });
    expect(first.status).toBe(202);

    const second = await f.post({ prompt: "two" });
    expect(second.status).toBe(429);
    expect(second.json().error).toMatch(/already starting/);
    expect(second.json().busy).toBe(true);
    expect(second.headers["retry-after"]).toBeDefined();
    expect(f.runs).toHaveLength(1);
  });

  it("still refuses immediately after the first finishes, until the cooldown is up", async () => {
    const f = fake();
    await f.post({ prompt: "one" });
    await f.finish({ code: 0, stdout: "✓ started 'a'\n" });

    const tooSoon = await f.post({ prompt: "two" });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.json().retryAfterMs).toBeGreaterThan(0);
    expect(f.runs).toHaveLength(1);

    f.tick(60_001);
    const later = await f.post({ prompt: "three" });
    expect(later.status).toBe(202);
    expect(f.runs).toHaveLength(2);
  });

  it("releases the slot only after the record says what happened", async () => {
    const f = fake();
    await f.post({ prompt: "one" });
    expect((await f.get()).json().busy).toBe(true);
    await f.finish({ code: 1, stderr: "boom\n" });
    const state = (await f.get()).json();
    expect(state.busy).toBe(false);
    expect(state.launches[0].state).toBe("failed");
  });

  it("refuses outright when the box says it is critical, and runs nothing", async () => {
    const f = fake();
    f.health.level = "critical";
    const out = await f.post({ prompt: "p" });
    expect(out.status).toBe(503);
    expect(out.json().error).toMatch(/critical/);
    expect(f.runs).toHaveLength(0);

    // Strained is this box's ordinary weekday; a gate that is always shut is a
    // gate somebody removes.
    f.health.level = "strained";
    expect((await f.post({ prompt: "p" })).status).toBe(202);
  });
});

/* ---------------------------------------------------------------- *
 * Failure is a state, and it carries its reason.
 * ---------------------------------------------------------------- */

describe("a launch that failed says so, and says whether something may still exist", () => {
  it("carries gjd-remote's own words rather than a cheerful success", async () => {
    const f = fake();
    const accepted = await f.post({ prompt: "p" });
    // 202 ACCEPTED, never 200 OK: nothing has succeeded yet at this point.
    expect(accepted.status).toBe(202);
    await f.finish({ code: 1, stderr: "✗ session 'x' already exists — 'gjd-remote resume x'\n" });

    const rec: LaunchRecord = (await f.get()).json().launches[0];
    expect(rec.state).toBe("failed");
    expect(rec.error).toContain("already exists");
    expect(rec.finishedAt).not.toBeNull();
  });

  it("a timeout is a failure that MAY have started something", () => {
    const out = interpretRun(
      { code: null, stdout: "", stderr: "", timedOut: true, spawnError: null },
      null,
    );
    expect(out).toMatchObject({ kind: "failed", maybeStarted: true });
    if (out.kind === "failed") expect(out.why).toMatch(/MAY still have been created/i);
  });

  it("a launcher that could not be run at all is a failure that started nothing", () => {
    const out = interpretRun(
      { code: null, stdout: "", stderr: "", timedOut: false, spawnError: "ENOENT: no tsx" },
      null,
    );
    expect(out).toMatchObject({ kind: "failed", maybeStarted: false });
    if (out.kind === "failed") expect(out.why).toMatch(/ENOENT/);
  });

  it("believes gjd-remote when it says the session MAY exist", () => {
    const out = interpretRun(
      {
        code: 1,
        stdout: "the box's answer was not one I can read\n  The session MAY exist — gjd-remote ls\n",
        stderr: "",
        timedOut: false,
        spawnError: null,
      },
      null,
    );
    expect(out).toMatchObject({ kind: "failed", maybeStarted: true });
  });

  it("a start whose name it could not read is still a start, and says so", () => {
    const out = interpretRun({ code: 0, stdout: "something unexpected\n", stderr: "", timedOut: false, spawnError: null }, null);
    expect(out).toMatchObject({ kind: "started", name: null });
    if (out.kind === "started") expect(out.note).toMatch(/could not read/);
  });

  it("a seam that throws leaves no launch stuck on starting", async () => {
    const runs: RunRequest[] = [];
    const routes = createNewSessionRoutes({
      root: ROOT,
      defaultDir: DIR,
      roots: ["/home/greg"],
      io: {
        run: (r) => {
          runs.push(r);
          return Promise.reject(new Error("the pipe broke"));
        },
        dirExists: () => true,
        healthLevel: () => "ok",
        now: () => 1,
        log: () => {},
      },
    });
    const { res, out } = makeRes();
    await routes.handle(makeReq({ body: JSON.stringify({ prompt: "p" }) }), res);
    expect(out.status).toBe(202);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const rec = routes.launches()[0]!;
    expect(rec.state).toBe("failed");
    expect(rec.error).toMatch(/the pipe broke/);
    expect(runs).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- *
 * Reading gjd-remote's output.
 * ---------------------------------------------------------------- */

describe("reading the name back out of a coloured terminal stream", () => {
  it("finds it in the ✓ line, colour codes and all", () => {
    const stdout = "\u001b[32m✓ started 's-260908-0304'\u001b[39m\u001b[2m with a prompt\u001b[22m\n";
    expect(parseStartedName(stdout)).toBe("s-260908-0304");
  });
  it("falls back to the header line when the ✓ line is not there", () => {
    expect(parseStartedName("\u001b[1mgjd-remote new-claude fleet-x\u001b[22m → box:/home/greg\n")).toBe("fleet-x");
  });
  it("returns null rather than a guess", () => {
    expect(parseStartedName("nothing here")).toBeNull();
  });
  it("strips only the colour, not the words", () => {
    expect(stripAnsi("\u001b[31mno\u001b[39m")).toBe("no");
  });
  it("lastWords is bounded, so a failing ssh cannot fill the page", () => {
    const long = Array.from({ length: 50 }, (_, i) => `line ${i} ${"x".repeat(100)}`).join("\n");
    expect(lastWords(long).length).toBeLessThanOrEqual(601);
    expect(lastWords("a\n\nb\n")).toBe("a · b");
  });
});

/* ---------------------------------------------------------------- *
 * The wire shape the client renders.
 * ---------------------------------------------------------------- */

describe("the launch record survives JSON, which is how the client sees it", () => {
  it("has every field the three states need, and no prompt in it", async () => {
    const f = fake();
    const out = await f.post({ prompt: "a secret plan", name: "wf-new-x" });
    const rec = out.json().launch;
    expect(Object.keys(rec).sort()).toEqual(
      ["dir", "error", "finishedAt", "id", "maybeStarted", "name", "note", "promptBytes", "requestedAt", "state"].sort(),
    );
    expect(JSON.stringify(rec)).not.toContain("secret");
    expect(rec.promptBytes).toBe(13);
  });

  it("GET reports busy, the wait, and the newest launch first", async () => {
    const f = fake();
    await f.post({ prompt: "one", name: "one" });
    await f.finish({ code: 0, stdout: "✓ started 'one'\n" });
    f.tick(60_001);
    await f.post({ prompt: "two", name: "two" });
    const state = (await f.get()).json();
    expect(state.launches.map((l: LaunchRecord) => l.name)).toEqual(["two", "one"]);
    expect(state.busy).toBe(true);
  });
});

/* ---------------------------------------------------------------- *
 * Importing this module must not touch the box.
 * ---------------------------------------------------------------- */

describe("no import side effects", () => {
  it("constructing the routes touches nothing — no command, no clock, no health reading", () => {
    const forbidden = (what: string) => (): never => {
      throw new Error(`construction called ${what}`);
    };
    expect(() =>
      createNewSessionRoutes({
        root: ROOT,
        defaultDir: DIR,
        roots: ["/home/greg"],
        io: {
          run: forbidden("run"),
          dirExists: forbidden("dirExists"),
          healthLevel: forbidden("healthLevel"),
          now: forbidden("now"),
          log: forbidden("log"),
        },
      }),
    ).not.toThrow();
  });
});
