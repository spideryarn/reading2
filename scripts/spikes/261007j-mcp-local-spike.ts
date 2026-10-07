/**
 * Spike for plan 261007j stage 2: the MCP server against a local dev stack.
 * Run: npx tsx scripts/spikes/261007j-mcp-local-spike.ts
 * Needs the local dev server (SITE) and the per-machine local password file.
 * Production is touched only by one unauthenticated read (check 6).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { makeApi } from "../../src/mcp/api.js";
import type { Approver } from "../../src/mcp/approve.js";
import { buildServer } from "../../src/mcp/server.js";
import { Session } from "../../src/mcp/session.js";
import { TOOLS } from "../../src/mcp/tools.js";

const SITE = process.env.SITE ?? "http://localhost:5273";
const PROD = "https://www.spideryarn.com";
const PASSWORD = readFileSync(path.join(homedir(), ".config/spideryarn/local-admin-password"), "utf8").trim();
const rand = () => Math.random().toString(36).slice(2, 8);
const homes: string[] = [];
const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail.replace(/\n/g, "\n      ")}`);
}
const mkHome = () => {
  const h = mkdtempSync(path.join(tmpdir(), "mcp-spike-"));
  homes.push(h);
  return h;
};
const cli = (home: string, args: string[], extraEnv: Record<string, string> = {}) =>
  spawnSync("npx", ["tsx", "scripts/spideryarn-mcp.ts", ...args], {
    encoding: "utf8",
    env: { ...process.env, SPIDERYARN_MCP_HOME: home, SPIDERYARN_PASSWORD: PASSWORD, ...extraEnv },
  });

const yes: Approver = { approve: async () => true };

type Res = { isError: boolean; text: string };
async function callOn(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Res> {
  const r = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text?: string }[];
  };
  return { isError: r.isError === true, text: r.content.map((c) => c.text ?? "").join("\n") };
}
const json = (r: Res) => JSON.parse(r.text);

async function stdioClient(home: string): Promise<Client> {
  const t = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "scripts/spideryarn-mcp.ts", "serve", "--site", SITE],
    env: { ...(process.env as Record<string, string>), SPIDERYARN_MCP_HOME: home },
    stderr: "pipe",
  });
  const c = new Client({ name: "spike", version: "0" });
  await c.connect(t);
  return c;
}

async function stubClient(home: string, approver: Approver): Promise<Client> {
  const session = new Session(SITE, { home });
  await session.bind();
  const api = makeApi({ site: session.site, tokens: session });
  const ctx = {
    identity: async () => {
      await session.bind();
      const d = await session.read();
      return { userId: d.userId, email: d.email };
    },
  };
  const server = buildServer({ api, ctx, approver });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const c = new Client({ name: "spike-mem", version: "0" });
  await c.connect(b);
  return c;
}

async function absenceReport(c: Client, canary: string, slug: string) {
  const [arts, tags, search] = await Promise.all([
    callOn(c, "list_articles", { archive: "all" }),
    callOn(c, "list_tags"),
    callOn(c, "search_library", { query: canary }),
  ]);
  return {
    articles: arts.text.includes(slug) || arts.text.includes(canary),
    tags: tags.text.includes(canary),
    // the answer echoes the query, so look at the hits only
    search: JSON.stringify((JSON.parse(search.text) as { hits?: unknown[] }).hits ?? []).includes(slug),
    searchRaw: search.text.slice(0, 160).replace(/\s+/g, " "),
    errors: [arts, tags, search].filter((r) => r.isError).map((r) => r.text),
  };
}

async function main() {
  const adminHome = mkHome();
  const readerHome = mkHome();

  // 1. login
  for (const [label, home, email] of [
    ["admin", adminHome, "dev-admin@spideryarn.local"],
    ["reader-b", readerHome, "dev-reader-b@spideryarn.local"],
  ] as const) {
    const r = cli(home, ["login", "--site", SITE, "--email", email]);
    check(`1 login ${label}`, r.status === 0, (r.stderr + r.stdout).trim().split("\n")[0] ?? "");
    const w = cli(home, ["whoami", "--site", SITE]);
    check(`1 whoami ${label}`, w.status === 0, (w.stderr + w.stdout).trim().split("\n").slice(0, 2).join("\n"));
  }

  // 2. real stdio servers
  const adminStdio = await stdioClient(adminHome);
  const readerStdio = await stdioClient(readerHome);
  const toolNames = (await adminStdio.listTools()).tools.map((t) => t.name);
  check("2 stdio: tools listed", toolNames.length === TOOLS.length, `${toolNames.length} tools: ${toolNames.join(",")}`);
  const me = await callOn(adminStdio, "whoami");
  check("2 stdio admin whoami", !me.isError && me.text.includes("dev-admin"), me.text.replace(/\s+/g, " ").slice(0, 200));
  const meB = await callOn(readerStdio, "whoami");
  check("2 stdio reader-b whoami", !meB.isError && meB.text.includes("reader-b"), meB.text.replace(/\s+/g, " ").slice(0, 200));

  const refuse = await callOn(adminStdio, "create_gift_voucher", {
    email: `mcp-spike-${rand()}@example.com`,
    articles: 1,
    idempotency_key: `refuse-${rand()}`,
  });
  check(
    "2 real default approver refuses off macOS",
    refuse.isError && /only show on macOS/.test(refuse.text),
    `isError=${refuse.isError} ${refuse.text.slice(0, 160)}`,
  );

  // 3. presence / absence
  const list = json(await callOn(adminStdio, "list_articles"));
  const pick = list.articles[0];
  if (!pick) throw new Error("admin has no articles to canary");
  const slug: string = pick.slug;
  const canary = `mcp-canary-${rand()}`;
  const added = await callOn(adminStdio, "edit_tags", { slug, add: [canary] });
  check("3 admin adds canary tag", !added.isError && added.text.includes(canary), `${slug}: ${added.text.replace(/\s+/g, " ").slice(0, 150)}`);
  try {
    const adminTags = await callOn(adminStdio, "list_tags");
    check("3 positive control: admin list_tags has canary", adminTags.text.includes(canary), `contains=${adminTags.text.includes(canary)}`);
    const adminArts = await callOn(adminStdio, "list_articles");
    check("3 positive control: admin list_articles has slug", adminArts.text.includes(slug), "");

    const absent = await absenceReport(readerStdio, canary, slug);
    check(
      "3 reader-b: canary/slug absent from list_articles, list_tags, search_library",
      !absent.articles && !absent.tags && !absent.search && absent.errors.length === 0,
      JSON.stringify(absent),
    );
    const edit = await callOn(readerStdio, "edit_tags", { slug, add: ["mcp-b-should-not"] });
    check("3 reader-b edit_tags on admin slug refused", edit.isError, `isError=${edit.isError} ${edit.text.slice(0, 200)}`);

    // 5. deliberate break: the "reader-b" absence check, run on the ADMIN session
    const broken = await absenceReport(adminStdio, canary, slug);
    const wentRed = broken.articles || broken.tags;
    check(
      "5 DELIBERATE BREAK: absence assertion on ADMIN session goes red (PASS here = the check can fail)",
      wentRed,
      `absence assertion would have FAILED: ${JSON.stringify({ articles: broken.articles, tags: broken.tags, search: broken.search })}`,
    );
  } finally {
    const rm = await callOn(adminStdio, "edit_tags", { slug, remove: [canary] });
    const after = await callOn(adminStdio, "list_tags");
    check("3 cleanup: canary removed", !rm.isError && !after.text.includes(canary), `still present=${after.text.includes(canary)}`);
  }

  // 4. admin tools
  const readerStub = await stubClient(readerHome, yes); // stub approves, so any refusal is the server's
  const bTools: [string, Record<string, unknown>][] = [
    ["list_gift_vouchers", {}],
    ["create_gift_voucher", { email: `mcp-spike-b-${rand()}@example.com`, articles: 1, idempotency_key: `b-${rand()}` }],
    ["update_gift_voucher", { id: "00000000-0000-4000-8000-000000000000", revoked: true }],
    ["retry_gift_voucher_email", { voucherId: "00000000-0000-4000-8000-000000000000" }],
  ];
  for (const [name, args] of bTools) {
    const r = await callOn(readerStub, name, args);
    check(`4 reader-b ${name} refused`, r.isError, `isError=${r.isError} ${r.text.slice(0, 200)}`);
  }
  const adminStub = await stubClient(adminHome, yes);
  const to = `mcp-spike-${rand()}@example.com`;
  const K = `spike-${rand()}`;
  const base = { email: to, articles: 1, idempotency_key: K };
  const count = async () =>
    json(await callOn(adminStub, "list_gift_vouchers")).vouchers.filter((v: { email: string }) => v.email === to);
  let voucherId: string | undefined;
  try {
    const c1 = await callOn(adminStub, "create_gift_voucher", base);
    voucherId = c1.isError ? undefined : json(c1).id;
    check("4 admin create voucher", !c1.isError && json(c1).email === "queued", c1.text.replace(/\s+/g, " ").slice(0, 200));
    const c2 = await callOn(adminStub, "create_gift_voucher", base);
    check("4 same key+args => replay", !c2.isError && json(c2).email === "replayed", c2.text.replace(/\s+/g, " ").slice(0, 200));
    const n2 = (await count()).length;
    check("4 exactly ONE voucher for address after replay", n2 === 1, `n=${n2}`);
    const c3 = await callOn(adminStub, "create_gift_voucher", { ...base, articles: 2 });
    check("4 same key, different articles => refused (409)", c3.isError && /idempotency_key/.test(c3.text), c3.text.slice(0, 250));
    const n3 = (await count()).length;
    check("4 still ONE voucher after conflict", n3 === 1, `n=${n3}`);
    voucherId ??= (await count())[0]?.id;
  } finally {
    if (voucherId) {
      const rv = await callOn(adminStub, "update_gift_voucher", { id: voucherId, revoked: true });
      check("4 cleanup: voucher revoked", !rv.isError, rv.text.replace(/\s+/g, " ").slice(0, 150));
    }
  }
  const auto = json(await callOn(adminStub, "whoami")).autoModes;
  const am = await callOn(adminStub, "set_auto_modes", { on: Boolean(auto) });
  check("4 set_auto_modes to current value", !am.isError, `current=${auto} -> ${am.text.replace(/\s+/g, " ").slice(0, 150)}`);

  const imp = await callOn(adminStdio, "import_article", { url: "not a url" });
  check("4b import_article 'not a url' refused", imp.isError, imp.text.slice(0, 200));
  const li = await callOn(adminStdio, "list_imports");
  check("4b list_imports works", !li.isError, li.text.replace(/\s+/g, " ").slice(0, 120));

  await adminStdio.close();
  await readerStdio.close();

  // 6. production, read-only, no credentials
  const code = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", `${PROD}/api/library`], { encoding: "utf8" });
  check("6 prod /api/library unauthenticated => 401", code === "401", `http ${code}`);
  const empty = mkHome();
  const w = cli(empty, ["whoami", "--site", PROD]);
  const err = (w.stderr + w.stdout).trim();
  check(
    "6 prod whoami with empty home fails cleanly",
    w.status !== 0 && /sign|login/i.test(err) && !/\n\s+at /.test(err),
    `exit=${w.status}\n${err}`,
  );
}

try {
  await main();
} catch (e) {
  console.log("SPIKE CRASHED", e);
  results.push({ name: "crash", ok: false, detail: String(e) });
} finally {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
  console.log(
    `\n${results.filter((r) => r.ok).length}/${results.length} PASS; failures: ${results.filter((r) => !r.ok).map((r) => r.name).join(" | ") || "none"}`,
  );
  process.exit(0);
}
