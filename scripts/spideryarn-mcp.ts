/**
 * **Spideryarn's local MCP server, and signing it in** — plan
 * docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md.
 *
 *     npx tsx scripts/spideryarn-mcp.ts login  --site https://www.spideryarn.com --env-file .env.prod
 *     npx tsx scripts/spideryarn-mcp.ts whoami --site https://www.spideryarn.com
 *     npx tsx scripts/spideryarn-mcp.ts serve  --site https://www.spideryarn.com
 *     npx tsx scripts/spideryarn-mcp.ts logout --site https://www.spideryarn.com
 *
 * `serve` is the default command and is what an AI app runs. It speaks MCP on
 * stdin and stdout, so **nothing but protocol may reach stdout**: diagnostics
 * go to stderr, and `console.log` is pointed there as soon as `main` starts.
 * ESM evaluates static imports first, so the spawned stdio test also checks
 * every byte they write during module loading.
 *
 * The site is required (`--site`, or `SPIDERYARN_SITE`): a local dev server's
 * port is not knowable from here, and guessing production would be worse.
 *
 * `login` reads the Supabase address and publishable key — public values, in
 * every page's JavaScript — from an env file (`.env.local` by default,
 * `--env-file .env.prod` for production) and writes them into the session
 * file, so `serve` needs only the site. No secret is read. The password comes
 * from a prompt that does not echo, or `SPIDERYARN_PASSWORD` for a script, and
 * is used once.
 */

import { readFileSync } from "node:fs";
import readline from "node:readline";

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { parseEnvFile } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { makeApi } from "../src/mcp/api.js";
import { defaultApprover } from "../src/mcp/approve.js";
import { buildServer } from "../src/mcp/server.js";
import { login, Session, SessionError, siteOrigin } from "../src/mcp/session.js";

interface Args {
  command: string;
  flags: Map<string, string | true>;
}

const COMMANDS = ["serve", "login", "logout", "whoami"] as const;
const VALUED = new Set(["--site", "--env-file", "--email"]);

/** Parse one `--option`, returning whether it consumed the following argv item. */
function parseOption(arg: string, next: string | undefined, flags: Map<string, string | true>): 0 | 1 {
  const [name = "", inline] = arg.split(/=(.*)/s, 2);
  if (VALUED.has(name)) {
    const value = inline ?? next;
    if (value === undefined || value.startsWith("--")) throw new SessionError(`${name} needs a value.`);
    if (flags.has(name)) throw new SessionError(`${name} was given more than once.`);
    flags.set(name, value);
    return inline === undefined ? 1 : 0;
  }
  if (name === "--help") {
    if (inline !== undefined) throw new SessionError("--help does not take a value.");
    flags.set(name, true);
    return 0;
  }
  throw new SessionError(`Unknown option ${name}.`);
}

export function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string | true>();
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg.startsWith("--")) {
      i += parseOption(arg, argv[i + 1], flags);
    } else if ((COMMANDS as readonly string[]).includes(arg)) {
      if (command !== undefined) throw new SessionError(`Choose one command, not both ${command} and ${arg}.`);
      command = arg;
    } else {
      throw new SessionError(`Unknown command ${arg}. Commands: ${COMMANDS.join(", ")}.`);
    }
  }
  return { command: command ?? "serve", flags };
}

function siteFrom(args: Args): string {
  const site = args.flags.get("--site");
  const chosen = typeof site === "string" ? site : process.env.SPIDERYARN_SITE;
  if (!chosen) {
    throw new SessionError(
      "Which Spideryarn? Pass --site (e.g. https://www.spideryarn.com, or your local dev server's address) or set SPIDERYARN_SITE.",
    );
  }
  return siteOrigin(chosen);
}

/** The two public Supabase values, from the env file, else the environment. Never a secret. */
function supabaseFrom(args: Args): { supabaseUrl: string; supabaseKey: string } {
  const named = args.flags.get("--env-file");
  const file = typeof named === "string" ? named : ".env.local";
  let values: Record<string, string> = {};
  try {
    values = parseEnvFile(readFileSync(file, "utf8"));
  } catch {
    if (typeof named === "string") throw new SessionError(`Could not read ${file}.`);
  }
  const pick = (name: string) => values[name] || process.env[name] || "";
  const supabaseUrl = pick("SUPABASE_URL");
  const supabaseKey = pick("SUPABASE_PUBLISHABLE_KEY") || pick("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseKey) {
    throw new SessionError(
      `No SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) in ${file} or the environment. ` +
        "For production, pass --env-file .env.prod.",
    );
  }
  return { supabaseUrl, supabaseKey };
}

function askLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

/** A password prompt that does not echo. Raw mode, so it needs a terminal. */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    throw new SessionError("No terminal to ask for a password on. Set SPIDERYARN_PASSWORD instead.");
  }
  process.stderr.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let typed = "";
    const finish = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish(() => resolve(typed));
        if (ch === "\u0003") return finish(() => reject(new SessionError("Cancelled.")));
        if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
        else typed += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function runLogin(args: Args, out: (line: string) => void): Promise<number> {
  const site = siteFrom(args);
  const supabase = supabaseFrom(args);
  const emailFlag = args.flags.get("--email");
  const email = typeof emailFlag === "string" ? emailFlag : await askLine("Email: ");
  const password = process.env.SPIDERYARN_PASSWORD || (await askHidden("Password (not shown, not stored): "));
  const { file, data } = await login({ site, ...supabase, email, password });
  /* Whether this account is an admin is not knowable here: the server decides
     it on each admin-only call, so this does not claim it either way. */
  out(`✓ signed in to ${site} as ${data.email || email} — session saved to ${file} (0600)`);
  out("  Admin tools will work only if this account is a Spideryarn admin; the server decides on each call.");
  return 0;
}

async function runWhoami(args: Args, out: (line: string) => void): Promise<number> {
  const session = new Session(siteFrom(args));
  const data = await session.read();
  const api = makeApi({ site: session.site, tokens: session });
  /* One real, read-only call, so "signed in" means the server agrees. */
  const reader = await api.call<{ autoModes?: boolean }>("GET", "/api/reader");
  out(`signed in to ${session.site} as ${data.email} (${data.userId})`);
  out(`  the session works: /api/reader answered (auto-modes ${reader.autoModes ? "on" : "off"})`);
  out(`  session file: ${session.file}`);
  return 0;
}

async function runLogout(args: Args, out: (line: string) => void): Promise<number> {
  const session = new Session(siteFrom(args));
  const { revoked } = await session.logout();
  out(
    revoked
      ? `signed out of ${session.site}: the session is revoked and ${session.file} is deleted`
      : `${session.file} is deleted, but Spideryarn's sign-in service did not confirm the session was revoked`,
  );
  return 0;
}

async function runServe(args: Args): Promise<number> {
  const site = siteFrom(args);
  const session = new Session(site);
  /* Bound now to whoever is signed in as it starts (Sol F14): a later `login`
     as somebody else, or a `logout`, stops this process acting rather than
     changing who it acts as. Not signed in yet is not fatal — the first call
     binds, and until then each tool answers "run login". */
  try {
    const bound = await session.bind();
    process.stderr.write(`spideryarn-mcp: serving ${session.site} over stdio as user ${bound.userId}\n`);
  } catch (err) {
    process.stderr.write(`spideryarn-mcp: serving ${session.site} over stdio, not yet signed in: ${(err as Error).message}\n`);
  }
  const api = makeApi({ site: session.site, tokens: session });
  const ctx = {
    identity: async () => {
      await session.bind();
      const d = await session.read();
      return { userId: d.userId, email: d.email };
    },
  };
  const approver = defaultApprover();
  serveStdio(() => buildServer({ api, ctx, approver }), {
    onerror: (err) => process.stderr.write(`spideryarn-mcp: ${err.message}\n`),
  });
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  /* From the entrypoint onward stdout belongs to the protocol in `serve`.
     Static imports have already run; the spawned stdio test checks them too. */
  console.log = console.error;
  console.info = console.error;
  const out = (line: string) => process.stderr.write(`${line}\n`);
  try {
    const args = parseArgs(argv);
    if (args.flags.has("--help")) {
      out("usage: spideryarn-mcp [serve|login|whoami|logout] --site URL [--env-file PATH] [--email E]");
      return 0;
    }
    switch (args.command) {
      case "login":
        return await runLogin(args, out);
      case "whoami":
        return await runWhoami(args, out);
      case "logout":
        return await runLogout(args, out);
      default:
        return await runServe(args);
    }
  } catch (err) {
    out(`spideryarn-mcp: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
