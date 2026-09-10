/**
 * The join: the real daemon writes a store, and the composition `server.ts`
 * calls serves it — the drill, end to end.
 *
 * `makeRecoveryRoute()` is called with NO readers, exactly as `server.ts` calls
 * it, and finds the store through `OVERSEER_STORE_DIR` the way production does.
 * There is no second construction to get wrong. The store is built by
 * `buildRecoveryDrill`, which drives `runOverseer` through a simulated reboot
 * (scripts/overseer-recovery-drill.ts), so the file under test is one the real
 * parser, differ, fold and view pass wrote.
 *
 * The two lines no import can reach — the route's dispatch in `server.ts`, and
 * the panel's mount in `App.tsx` — are pinned by source checks at the bottom,
 * the kind tests/fleet-health-wiring.test.ts uses, because a missing mount is
 * invisible to every other test (the Overseer's condition on this stage).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as babelParse } from "@babel/parser";
import type { FunctionDeclaration, Node, Statement } from "@babel/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DRILL_CONVERSATIONS, DRILL_SESSIONS, buildRecoveryDrill, refuseUnsafeTarget } from "../scripts/overseer-recovery-drill.js";
import { RECOVERY_PATH, makeRecoveryRoute } from "../tools/fleet/routes-recovery.js";
import { parseRecoveryFeed } from "../tools/fleet/web/src/recovery-client";
import type { RecoveryFeed, RecoveryWireRecord } from "../tools/fleet/wire.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-recovery-wiring-"));
  dirs.push(dir);
  return dir;
}

async function getThroughTheProductionComposition(): Promise<{ status: number; feed: RecoveryFeed }> {
  let status = 0;
  let raw = "";
  let done!: () => void;
  const ended = new Promise<void>((resolve) => (done = resolve));
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(chunk?: string) {
      raw = chunk ?? "";
      done();
      return res;
    },
  };
  const handled = makeRecoveryRoute().handle({ method: "GET", url: "/api/recovery", headers: {} } as IncomingMessage, res as unknown as ServerResponse);
  expect(handled).toBe(true);
  await ended;
  return { status, feed: JSON.parse(raw) as RecoveryFeed };
}

describe("the drill, served by the composition server.ts calls", () => {
  it("after a simulated reboot the page gets all four sessions, each with its evidence, and nothing is started", async () => {
    const target = tempDir();
    const drill = await buildRecoveryDrill(target, { hostname: () => "drill-host" });
    vi.stubEnv("OVERSEER_STORE_DIR", drill.store);

    const { status, feed } = await getThroughTheProductionComposition();
    expect(status).toBe(200);
    if (feed.kind !== "published") throw new Error(`expected a published feed, got ${JSON.stringify(feed)}`);
    expect(feed.view.kind).toBe("checked");
    if (feed.view.kind === "checked") expect(feed.view.inventory.kind).toBe("trusted");
    expect(feed.total).toBe(4);
    expect(feed.replay.kind).toBe("ran");

    const byName = new Map<string, RecoveryWireRecord>(feed.records.map((r) => [r.name, r]));
    const working = byName.get(DRILL_SESSIONS.working);
    const exited = byName.get(DRILL_SESSIONS.exited);
    const shell = byName.get(DRILL_SESSIONS.shell);
    const deleted = byName.get(DRILL_SESSIONS.deleted);

    // The working Claude came back in G2 under a new token: the daemon itself
    // disposed it as resumed. Nothing on the page did.
    expect(working?.state).toMatchObject({ kind: "resolved", resolution: { disposition: "resumed", evidence: { conversationId: DRILL_CONVERSATIONS.working } } });

    expect(exited?.state).toMatchObject({ kind: "classified", classification: { kind: "ended-before-reboot", statusKey: "no-claude" } });

    expect(shell?.state).toMatchObject({
      kind: "classified",
      classification: { kind: "interrupted" },
      evidence: { kind: "checked", dir: { kind: "exists", path: drill.dirs.shell }, resume: { kind: "manual", host: "drill-host", dir: drill.dirs.shell } },
    });

    expect(deleted?.state).toMatchObject({
      kind: "classified",
      classification: { kind: "interrupted" },
      evidence: {
        kind: "checked",
        dir: { kind: "missing", path: drill.dirs.deleted },
        transcript: { kind: "not-found", under: "claim", conversationId: DRILL_CONVERSATIONS.deleted },
        resume: { kind: "not-supported" },
      },
    });

    // Grouped: interrupted first, resolved last.
    expect(feed.records.at(-1)?.name).toBe(DRILL_SESSIONS.working);
    expect(feed.records[0]?.state).toMatchObject({ classification: { kind: "interrupted" } });

    // The browser's whole-payload contract (Sol's F30) holds on the answer the
    // real daemon's file produces: the client refuses nothing the server serves.
    expect(parseRecoveryFeed(JSON.parse(JSON.stringify(feed)))).toEqual(feed);
  }, 60_000);

  it("refuses the live store, anything inside it, and a directory that is not empty", () => {
    const live = join(homedir(), ".overseer");
    expect(refuseUnsafeTarget(live)).toMatch(/live Overseer store/);
    expect(refuseUnsafeTarget(join(live, "drill"))).toMatch(/live Overseer store/);
    const full = tempDir();
    writeFileSync(join(full, "something"), "x");
    expect(refuseUnsafeTarget(full)).toMatch(/not empty/);
    expect(refuseUnsafeTarget(join(tempDir(), "new"))).toBeNull();
  });

  it("refuses a target reached through a symlinked ancestor of the store, and one inside an absolute OVERSEER_STORE_DIR (F28)", () => {
    // A fake home, so the real ~/.overseer is never involved.
    const home = tempDir();
    const store = join(home, ".overseer");
    mkdirSync(store);
    const links = tempDir();
    symlinkSync(store, join(links, "live"));
    const quiet = { home, env: {} };
    // Sol's input: the leaf does not exist, so a realpath of the whole target fails.
    expect(refuseUnsafeTarget(join(links, "live", "new-drill"), quiet)).toMatch(/live Overseer store/);
    expect(refuseUnsafeTarget(join(links, "live", "a", "b"), quiet)).toMatch(/live Overseer store/);
    expect(refuseUnsafeTarget(join(links, "live"), quiet)).toMatch(/live Overseer store/);

    const elsewhere = tempDir();
    const env = { OVERSEER_STORE_DIR: elsewhere };
    expect(refuseUnsafeTarget(join(elsewhere, "new-drill"), { home, env })).toMatch(/live Overseer store/);
    symlinkSync(elsewhere, join(links, "other"));
    expect(refuseUnsafeTarget(join(links, "other", "new-drill"), { home, env })).toMatch(/live Overseer store/);
    // A sibling of both stores is still a fine place for a drill.
    expect(refuseUnsafeTarget(join(links, "fresh"), { home, env })).toBeNull();
  });

  it("refuses a dangling link on the way rather than following it (F28)", () => {
    const links = tempDir();
    symlinkSync(join(tempDir(), "not-there-yet"), join(links, "dangling"));
    expect(refuseUnsafeTarget(join(links, "dangling", "new-drill"), { home: tempDir(), env: {} })).toMatch(/refusing/);
  });

  it("builds nothing when the target resolves into a store (F28)", async () => {
    const home = tempDir();
    const store = join(home, ".overseer");
    mkdirSync(store);
    const links = tempDir();
    symlinkSync(store, join(links, "live"));
    await expect(buildRecoveryDrill(join(links, "live", "new-drill"), { home, env: {} })).rejects.toThrow(/live Overseer store/);
    expect(readdirSync(store)).toEqual([]);
  }, 60_000);
});

/**
 * **The server's dispatch, as a statement of the function `createServer` is
 * given — parsed, not searched for.** (Sol's F35.)
 *
 * `server.ts` binds port 8787 at import, so it cannot be imported and its
 * handler cannot be called; that is why this stays a source check, as
 * tests/fleet-health-wiring.test.ts's does. A substring check passed Sol's
 * `if (false) { … }` mutation. This one parses the file with Babel (the parser
 * tests/fleet-imports.test.ts uses, and for its reason: TypeScript 7 exposes no
 * AST) and requires, exactly:
 *
 *  1. one module-level `const recoveryApiRoute = makeRecoveryRoute()`, with no
 *     readers, and `recoveryApiRoute` named nowhere else but the dispatch;
 *  2. a module-level `function handler(req, res)` that `createServer` is called
 *     with;
 *  3. `if (recoveryApiRoute.handle(req, res)) return;` as a **direct**
 *     statement of that function's body, no `else`;
 *  4. no unconditional `return` or `throw` before it at that level, and no
 *     earlier top-level branch on a `url.startsWith("…")` / `url === "…"`
 *     literal that would take `/api/recovery` first.
 *
 * **How strong that is.** It proves the dispatch is reached for every request
 * that no earlier top-level branch consumes. It does not prove what the other
 * routes' own `handle` methods claim (their prefixes are in other modules), nor
 * that a branch on a computed string does not match, nor that the server runs.
 * The route's behaviour is proved by the drill test above, through the same
 * `makeRecoveryRoute()` composition.
 */
function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const n = node as Node & Record<string, unknown>;
  if (typeof n.type === "string") visit(n);
  for (const [key, value] of Object.entries(n)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments" || key === "extra") continue;
    walk(value, visit);
  }
}

function isIdentifier(n: Node | null | undefined, name: string): boolean {
  return n?.type === "Identifier" && n.name === name;
}

function isDispatch(s: Statement): boolean {
  if (s.type !== "IfStatement" || s.alternate !== null && s.alternate !== undefined) return false;
  const test = s.test;
  if (test.type !== "CallExpression" || test.callee.type !== "MemberExpression") return false;
  if (!isIdentifier(test.callee.object, "recoveryApiRoute") || !isIdentifier(test.callee.property, "handle")) return false;
  if (test.arguments.length !== 2 || !isIdentifier(test.arguments[0] as Node, "req") || !isIdentifier(test.arguments[1] as Node, "res")) return false;
  const then = s.consequent;
  return then.type === "ReturnStatement" || (then.type === "BlockStatement" && then.body.length === 1 && then.body[0]?.type === "ReturnStatement");
}

/** Every `url.startsWith("…")` and `url === "…"` literal a branch condition tests. */
function urlLiterals(test: Node): { kind: "prefix" | "exact"; value: string }[] {
  const out: { kind: "prefix" | "exact"; value: string }[] = [];
  walk(test, (n) => {
    if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && isIdentifier(n.callee.object, "url") && isIdentifier(n.callee.property, "startsWith")) {
      const arg = n.arguments[0];
      if (arg?.type === "StringLiteral") out.push({ kind: "prefix", value: arg.value });
    }
    if (n.type === "BinaryExpression" && (n.operator === "===" || n.operator === "==")) {
      const [l, r] = [n.left, n.right];
      if (isIdentifier(l as Node, "url") && r.type === "StringLiteral") out.push({ kind: "exact", value: r.value });
      if (isIdentifier(r, "url") && l.type === "StringLiteral") out.push({ kind: "exact", value: l.value });
    }
  });
  return out;
}

function dispatchProblems(source: string): string[] {
  const problems: string[] = [];
  const ast = babelParse(source, { sourceType: "module", plugins: ["typescript"] });
  const top = ast.program.body;

  const builds = top.filter(
    (s) =>
      s.type === "VariableDeclaration" &&
      s.declarations.some(
        (d) =>
          isIdentifier(d.id, "recoveryApiRoute") &&
          d.init?.type === "CallExpression" &&
          isIdentifier(d.init.callee, "makeRecoveryRoute") &&
          d.init.arguments.length === 0,
      ),
  );
  if (builds.length !== 1) problems.push(`expected one module-level \`const recoveryApiRoute = makeRecoveryRoute()\`, found ${builds.length}`);
  let mentions = 0;
  let builtAnywhere = 0;
  walk(ast.program, (n) => {
    if (isIdentifier(n, "recoveryApiRoute")) mentions += 1;
    if (n.type === "CallExpression" && isIdentifier(n.callee, "makeRecoveryRoute")) builtAnywhere += 1;
  });
  if (mentions !== 2) problems.push(`recoveryApiRoute is named ${mentions} times; expected exactly two, its build and its dispatch`);
  if (builtAnywhere !== 1) problems.push(`makeRecoveryRoute is called ${builtAnywhere} times; expected once`);

  const handler = top.find((s): s is FunctionDeclaration => s.type === "FunctionDeclaration" && isIdentifier(s.id, "handler"));
  if (handler === undefined) return [...problems, "no module-level `function handler`"];
  if (!isIdentifier(handler.params[0] as Node, "req") || !isIdentifier(handler.params[1] as Node, "res")) problems.push("handler's parameters are not (req, res)");
  let served = false;
  walk(ast.program, (n) => {
    if (n.type === "CallExpression" && isIdentifier(n.callee, "createServer") && isIdentifier(n.arguments[0] as Node, "handler")) served = true;
  });
  if (!served) problems.push("createServer is never called with handler");

  const body = handler.body.body;
  const at = body.findIndex(isDispatch);
  if (at === -1) return [...problems, "handler has no top-level `if (recoveryApiRoute.handle(req, res)) return;`"];
  for (const s of body.slice(0, at)) {
    const line = s.loc?.start.line ?? "?";
    if (s.type === "ReturnStatement" || s.type === "ThrowStatement") problems.push(`an unconditional ${s.type} at line ${line} comes before the dispatch`);
    if (s.type === "IfStatement") {
      for (const lit of urlLiterals(s.test)) {
        const claims = lit.kind === "prefix" ? RECOVERY_PATH.startsWith(lit.value) : lit.value === RECOVERY_PATH;
        if (claims) problems.push(`an earlier branch on ${JSON.stringify(lit.value)} at line ${line} takes ${RECOVERY_PATH} first`);
      }
    }
  }
  return problems;
}

describe("server.ts (F35: parsed, not searched)", () => {
  const source = readFileSync(join(REPO, "tools", "fleet", "server.ts"), "utf8");
  const line = "  if (recoveryApiRoute.handle(req, res)) return;";

  it("imports the route module", () => {
    expect(source).toContain('import { makeRecoveryRoute } from "./routes-recovery.js";');
  });

  it("builds the route once and dispatches to it as a direct statement of the handler createServer is given", () => {
    expect(dispatchProblems(source)).toEqual([]);
  });

  it("refuses each mutation Sol named, and the three next to them", () => {
    expect(source).toContain(line);
    const mutants: [string, string][] = [
      ["a dead branch", source.replace(line, `  if (false) {\n  ${line}\n  }`)],
      ["moved into a function nobody calls", source.replace(line, `  const never = () => {\n  ${line}\n  };`)],
      ["taken first by an earlier prefix branch", source.replace("  if (retention.route.handle(req, res)) return;", '  if (url.startsWith("/api/rec")) {\n    res.end();\n    return;\n  }\n  if (retention.route.handle(req, res)) return;')],
      ["after an unconditional return", source.replace(line, `  return;\n${line}`)],
      ["a dispatch that no longer returns", source.replace(line, "  recoveryApiRoute.handle(req, res);")],
    ];
    for (const [name, mutant] of mutants) {
      expect(mutant, name).not.toBe(source);
      expect(dispatchProblems(mutant), name).not.toEqual([]);
    }
  });
});

// The page's mount is not a source check any more: tests/fleet-recovery-panel.test.tsx
// renders the real `App` on #overseer and finds the section (Sol's F35).
