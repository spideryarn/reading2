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
 * sessions is a suite nobody can run twice. Two real sessions have been started
 * by hand, each to prove a thing these fakes cannot, and each killed
 * afterwards: one that a session started this way is a Claude row on the
 * dashboard rather than a bare shell, and one — `f10-probe-dashes`,
 * 2026-09-08 — that a prompt beginning `--nonexistent-flag-f10-probe` arrives
 * at the remote Claude as prose. Its `/proc/<pid>/cmdline` read
 * `claude ⋅ --session-id ⋅ <uuid> ⋅ --name ⋅ f10-probe-dashes ⋅ -- ⋅ <prompt>`,
 * and the pane answered "F10 PROBE OK". Those are in the report, not in here.
 *
 * **A NEGATIVE ASSERTION NEVER STANDS ALONE HERE**, and that is not a
 * generality: Sol found this file asserting that a private word was absent from
 * the log while the word sat in the *sixth* position and the leak took the
 * first five. Every "does not contain" below is paired with something that
 * fails if the mechanism has simply been deleted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

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
  parseStartedDir,
  parseStartedName,
  stripAnsi,
  webProvisionalName,
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
      // The minted placeholder name — see the F11 block below for why there is
      // one at all, and what shape it has.
      expect.stringMatching(/^web-\d{6}-\d{6}-/),
      // NO `-d`: the default is gjd-remote's verified origin resolution, which
      // is what carries the setup lock. See the F13 block below.
      "-p",
      "-",
      "--no-attach",
    ]);
    expect(run.stdinText).toBe(prompt);
    // The CWD is how the directory is communicated in repo mode.
    expect(run.cwd).toBe(DIR);
    // THE POINT OF THE WHOLE FILE: the prompt is in no argument, anywhere.
    expect(run.args.join(" ")).not.toContain("read docs");
    expect(run.bin).not.toMatch(/sh$|bash|-c/);
  });

  it("reports starting, then started with the name it was launched under", async () => {
    const f = fake();
    const accepted = await f.post({ prompt: "hello", name: "wf-new-hello" });
    expect(accepted.json().launch.state).toBe("starting");
    expect(accepted.json().launch.name).toBe("wf-new-hello");

    await f.finish({
      code: 0,
      stdout: "gjd-remote new-claude wf-new-hello → box:/home/greg/code/spideryarn2\n✓ started 'wf-new-hello'\n",
    });

    const state = (await f.get()).json();
    expect(state.busy).toBe(false);
    expect(state.launches[0].state).toBe("started");
    expect(state.launches[0].name).toBe("wf-new-hello");
    expect(state.launches[0].startedDir).toBe("/home/greg/code/spideryarn2");
    expect(state.launches[0].error).toBeNull();
  });

  it("passes a requested name as a positional", async () => {
    const f = fake();
    await f.post({ prompt: "hi", name: "wf-new-probe", dir: "/home/greg/code/gjdutils" });
    expect(f.runs[0]!.args).toEqual([
      expect.stringContaining("tsx"),
      `${ROOT}/scripts/gjd-remote.ts`,
      "new-claude",
      "wf-new-probe",
      "-p",
      "-",
      "--no-attach",
    ]);
    expect(f.runs[0]!.cwd).toBe("/home/greg/code/gjdutils");
  });

  it("newClaudeArgs is the whole argv decision, and it is pure", () => {
    expect(newClaudeArgs("/s/g.ts", { name: null, dir: "/d", unsafeDir: false })).toEqual([
      "/s/g.ts",
      "new-claude",
      "-p",
      "-",
      "--no-attach",
    ]);
    expect(newClaudeArgs("/s/g.ts", { name: "n", dir: "/d", unsafeDir: false })[2]).toBe("n");
    expect(newClaudeArgs("/s/g.ts", { name: null, dir: "/d", unsafeDir: true })).toEqual([
      "/s/g.ts",
      "new-claude",
      "-d",
      "/d",
      "-p",
      "-",
      "--no-attach",
    ]);
  });
});

/* ---------------------------------------------------------------- *
 * F10 — the prompt must be prose all the way to the box, not only as
 * far as OUR argv.
 * ---------------------------------------------------------------- */

describe("a prompt that begins with a dash is text, not a Claude option", () => {
  /**
   * **WHY THIS TEST READS SOURCE, AND WHAT IT CANNOT DO.**
   *
   * The route's own half is easy and is tested above: the prompt goes down
   * stdin and is in no argument we build. The other half is on the box, and it
   * is where the promise was false — gjd-remote's job script runs
   * `claude --session-id UUID "$(cat -- prompt)"`, which makes the prompt one
   * argv word of the real Claude, and with no `--` in front of it a prompt
   * beginning `--dangerously-skip-permissions` is a FLAG (Sol's F10).
   *
   * That command is assembled inline inside `cmdNewClaude`, not behind an
   * exported function, so there is nothing to call. Reading the line is
   * therefore the strongest check available without refactoring a script every
   * agent on this box depends on — and it fails loudly if the separator is ever
   * dropped or a second unguarded call site appears.
   *
   * The claim that `--` actually does the job in Claude's own parser is not
   * source-readable at all, and was measured instead, 2026-09-08, claude
   * 2.1.263:
   *
   *   claude --session-id bad-uuid -p --nonexistent-flag  → "unknown option"
   *   claude --session-id bad-uuid -p -- --nonexistent-flag
   *                                       → "Invalid session ID" (it parsed)
   *
   * and end to end by launching one real session through this route with a
   * prompt beginning `--dangerously-skip-permissions`, which arrived as prose.
   */
  it("gjd-remote puts `--` before the prompt, at its only call site", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "..", "scripts", "gjd-remote.ts"), "utf8");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source text being matched, not a template
    const sites = src.split("\n").filter((l) => l.includes("$(cat -- ${promptPath})"));
    // ONE site, and this count is half the test: a second, unguarded way to
    // build that command would otherwise pass unnoticed.
    expect(sites).toHaveLength(1);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: as above.
    expect(sites[0]).toContain('`-- "$(cat -- ${promptPath})"`');
  });
});

/* ---------------------------------------------------------------- *
 * F11 — the prompt must not become the session's public name.
 * ---------------------------------------------------------------- */

describe("an unnamed launch gets an opaque name, not the first words of the prompt", () => {
  /**
   * The version of this test before 2026-09-08 passed for the wrong reason and
   * Sol said so: its secret word was the SIXTH, and gjd-remote's placeholder is
   * the first FIVE — so the assertion would have held with the leak in place.
   * The secret is now the first word, and every negative below is paired with a
   * positive that fails if the mechanism is simply gone.
   */
  const SECRET = "acquisition";
  const PROMPT = `${SECRET} of northwind by contoso — draft the board memo before friday`;

  it("keeps the prompt's own words out of the name, the argv and the log", async () => {
    const f = fake();
    const out = await f.post({ prompt: PROMPT });
    const rec: LaunchRecord = out.json().launch;

    // POSITIVE: a name was minted, and it is the one the launcher was told to use.
    expect(rec.name).toMatch(/^web-\d{6}-\d{6}-[a-z0-9]{1,6}$/);
    expect(f.runs[0]!.args).toContain(rec.name);
    // POSITIVE: the prompt did travel — on stdin, whole.
    expect(f.runs[0]!.stdinText).toBe(PROMPT);

    await f.finish({ code: 0, stdout: `✓ started '${rec.name}'\n` });
    const logs = f.logs.join("\n");
    // POSITIVE: the log says which launch this was, and how big the prompt was.
    expect(logs).toContain(rec.name);
    expect(logs).toContain("promptBytes=");

    // The negatives, first word included, everywhere the name and the log go.
    for (const word of PROMPT.split(/\s+/).slice(0, 5)) {
      expect(rec.name).not.toContain(word);
      expect(f.runs[0]!.args.join(" ")).not.toContain(word);
      expect(logs).not.toContain(word);
    }
  });

  it("a name the caller chose is used exactly, because that one is theirs", async () => {
    const f = fake();
    const out = await f.post({ prompt: PROMPT, name: "wf-board-memo" });
    expect(out.json().launch.name).toBe("wf-board-memo");
    expect(f.runs[0]!.args).toContain("wf-board-memo");
  });

  it("webProvisionalName is a clock and some entropy, and nothing else", () => {
    // LOCAL components, because the name is in local time — the same clock as
    // gjd-remote's own `timestampName` and as the person reading the list. A
    // `Date.UTC` here would make this test pass in London and fail in Boston.
    const at = new Date(2026, 8, 8, 3, 4, 5).getTime();
    const name = webProvisionalName(at, "abcdef123456");
    expect(name).toBe("web-260908-030405-abcdef");
    // Two in the same second do not collide, which is what tmux insists on.
    expect(webProvisionalName(at, "aaaaaa")).not.toBe(webProvisionalName(at, "bbbbbb"));
    // A slug tmux and gjd-remote will both take: SLUG is /^[a-z0-9][a-z0-9-]{0,40}$/.
    expect(name).toMatch(/^[a-z0-9][a-z0-9-]{0,40}$/);
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
  /**
   * **THE RACE, WHICH THE SERIAL TESTS BELOW CANNOT SEE** (Sol's F9).
   *
   * `f.post()` returns a promise, and the handler runs synchronously only as
   * far as `await readBody`. So starting two without awaiting the first puts
   * both past the cheap up-front check with neither body finished — which is
   * exactly the shape of two fingers on one button, or a client that retried a
   * slow request. Before the claim was moved after the parse, both launched.
   */
  it("two requests in flight together produce one launch, not two", async () => {
    const f = fake();
    const both = Promise.all([f.post({ prompt: "one" }), f.post({ prompt: "two" })]);
    const [a, b] = await both;

    expect([a.status, b.status].sort()).toEqual([202, 429]);
    // The assertion that matters: one Claude, not two, on a box that fell over.
    expect(f.runs).toHaveLength(1);
    // And one record, so the register cannot claim a launch that never ran.
    expect(f.routes.launches()).toHaveLength(1);
    const refused = a.status === 429 ? a : b;
    expect(refused.json().error).toMatch(/already starting/);
  });

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

  /**
   * **`unknown` IS NOT A MILDER `critical`** (Sol's F12). health.ts says
   * `unknown` when load, memory AND swap were all unreadable — a box that could
   * not fork, or whose commands timed out. That is the condition this gate is
   * for, and it used to be admitted. Worse in combination: a known-`critical`
   * disk reading is overwritten by `unknown` in `computeVerdict`, so a box
   * known to be full arrived here wearing the level that got waved through.
   */
  it("refuses when the box cannot say how it is, which is what a box too busy to fork says", async () => {
    const f = fake();
    f.health.level = "unknown";
    const out = await f.post({ prompt: "p" });
    expect(out.status).toBe(503);
    expect(out.json().error).toMatch(/could not read this box's load, memory OR swap/i);
    expect(f.runs).toHaveLength(0);

    // PAIRED: the same request goes through the moment the box can answer, so
    // this is a gate and not a wall.
    f.health.level = "ok";
    expect((await f.post({ prompt: "p" })).status).toBe(202);
    expect(f.runs).toHaveLength(1);
  });

  /**
   * **A LAUNCH WHOSE ANSWER WE LOST IS NOT A FINISHED LAUNCH** (Sol's F20). The
   * deadline kills our process group — tsx and the ssh under it — but a tmux
   * session the box has already created keeps running, and no signal from here
   * reaches it. So the ordinary cooldown would let a second Claude start beside
   * a first one nobody can see.
   */
  it("holds the door shut far longer after a launch that MAY have started something", async () => {
    const f = fake({ cooldownMs: 60_000, uncertainCooldownMs: 900_000 });
    await f.post({ prompt: "one" });
    await f.finish({ code: null, timedOut: true });
    expect(f.routes.launches()[0]!.maybeStarted).toBe(true);

    f.tick(60_001);
    const soon = await f.post({ prompt: "two" });
    expect(soon.status).toBe(429);
    expect(soon.json().error).toMatch(/MAY be running/);
    expect(f.runs).toHaveLength(1);

    // PAIRED with the release: it is a longer wait, not a permanent one.
    f.tick(900_000);
    expect((await f.post({ prompt: "three" })).status).toBe(202);
    expect(f.runs).toHaveLength(2);
  });
});

/* ---------------------------------------------------------------- *
 * F13 — which directory, and whose admission decides it.
 * ---------------------------------------------------------------- */

describe("a repo launch goes through gjd-remote's setup admission, not around it", () => {
  it("passes no -d by default, and says so in the record", async () => {
    const f = fake();
    const out = await f.post({ prompt: "p" });
    expect(f.runs[0]!.args).not.toContain("-d");
    // POSITIVE: the directory is not lost, it moved to the cwd — which is where
    // gjd-remote reads the git origin it resolves the checkout by.
    expect(f.runs[0]!.cwd).toBe(DIR);
    expect(out.json().launch.resolution).toBe("repo");
  });

  it("passes -d only for the explicit unsafe mode, and records that it did", async () => {
    const f = fake();
    const out = await f.post({ prompt: "p", dir: "/home/greg/code/gjdutils", unsafeDir: true });
    expect(f.runs[0]!.args).toContain("-d");
    expect(f.runs[0]!.args).toContain("/home/greg/code/gjdutils");
    expect(out.json().launch.resolution).toBe("dir");
  });

  it("refuses an unsafeDir that is not a boolean rather than reading it as one", () => {
    const parse = (v: unknown) =>
      parseNewSessionBody(JSON.stringify({ prompt: "p", unsafeDir: v }), { defaultDir: DIR, roots: ["/home/greg"] });
    for (const v of ["true", "false", 1, 0, null]) expect(parse(v)).toMatchObject({ ok: false, status: 400 });
    expect(parse(true)).toMatchObject({ ok: true, value: { unsafeDir: true } });
    expect(parse(false)).toMatchObject({ ok: true, value: { unsafeDir: false } });
    // Absent is the safe default, which is the whole point of the flag's name.
    expect(
      parseNewSessionBody(JSON.stringify({ prompt: "p" }), { defaultDir: DIR, roots: ["/home/greg"] }),
    ).toMatchObject({ ok: true, value: { unsafeDir: false } });
  });

  it("says when the box started somewhere other than where we asked", async () => {
    const f = fake();
    await f.post({ prompt: "p", dir: "/home/greg/code/spideryarn2/.claude/worktrees/x" });
    await f.finish({
      code: 0,
      stdout: "gjd-remote new-claude web-1 → greg@1.2.3.4:/home/greg/code/spideryarn2\n✓ started 'web-1'\n",
    });
    const rec = f.routes.launches()[0]!;
    expect(rec.state).toBe("started");
    expect(rec.dir).toBe("/home/greg/code/spideryarn2/.claude/worktrees/x");
    expect(rec.startedDir).toBe("/home/greg/code/spideryarn2");
    expect(rec.note).toMatch(/not \/home\/greg\/code\/spideryarn2\/\.claude\/worktrees\/x/);
  });

  it("stays quiet when the box used the directory we asked for", async () => {
    const f = fake();
    await f.post({ prompt: "p" });
    await f.finish({ code: 0, stdout: `gjd-remote new-claude web-1 → greg@1.2.3.4:${DIR}\n✓ started 'web-1'\n` });
    const rec = f.routes.launches()[0]!;
    expect(rec.startedDir).toBe(DIR);
    expect(rec.note).toBeNull();
  });

  it("parseStartedDir reads the path and refuses a line that is not one", () => {
    // Coloured exactly as gjd-remote writes it: a bold header, a dim tail.
    expect(
      parseStartedDir("\u001b[1mgjd-remote new-claude a\u001b[22m\u001b[2m → greg@1.2.3.4:/home/greg/code/x\u001b[22m\n"),
    ).toBe("/home/greg/code/x");
    expect(parseStartedDir("gjd-remote new-claude a → box:/home/greg")).toBe("/home/greg");
    expect(parseStartedDir("gjd-remote new-claude a → box:relative/path")).toBeNull();
    expect(parseStartedDir("✓ started 'a'")).toBeNull();
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
      DIR,
    );
    expect(out).toMatchObject({ kind: "failed", maybeStarted: true });
    if (out.kind === "failed") expect(out.why).toMatch(/MAY still have been created/i);
  });

  it("a launcher that could not be run at all is a failure that started nothing", () => {
    const out = interpretRun(
      { code: null, stdout: "", stderr: "", timedOut: false, spawnError: "ENOENT: no tsx" },
      null,
      DIR,
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
      DIR,
    );
    expect(out).toMatchObject({ kind: "failed", maybeStarted: true });
  });

  it("a start whose name it could not read is still a start, and says so", () => {
    const out = interpretRun(
      { code: 0, stdout: "something unexpected\n", stderr: "", timedOut: false, spawnError: null },
      null,
      DIR,
    );
    expect(out).toMatchObject({ kind: "started", name: null, dir: null });
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
      [
        "dir",
        "error",
        "finishedAt",
        "id",
        "maybeStarted",
        "name",
        "note",
        "promptBytes",
        "requestedAt",
        "resolution",
        "startedDir",
        "state",
      ].sort(),
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
