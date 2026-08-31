/**
 * What is still running in tmux on this box, and which of it is finished.
 *
 * Closing a terminal tab detaches tmux; it does not exit `claude`. Sessions pile up.
 * This reports; it does not decide. `--kill` acts only on sessions classified `done`.
 *
 * Two signals that look right and are not: tmux's own session activity time, and the
 * transcript's mtime. Both keep moving on an idle session — the transcript from
 * `permission-mode` / `atis-latch` bookkeeping records that carry no message. Use the
 * timestamp of the last `assistant` / `user` entry instead.
 *
 *   npm run sessions           # report
 *   npm run sessions -- --kill # kill the ones marked `done`
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

/** Only the handful of transcript fields this script reads. */
type Entry = {
  type?: string;
  timestamp?: string;
  message?: { content?: Array<{ type?: string; text?: string }> | string };
};

const parse = (line: string): Entry | null => {
  try {
    return JSON.parse(line) as Entry;
  } catch {
    return null;
  }
};

const REPO = "/home/greg/code/spideryarn2";
const TRANSCRIPTS = join(homedir(), ".claude/projects/-home-greg-code-spideryarn2");
const IDLE_MINUTES = 30;

const sh = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

/** Every descendant pid, breadth-first, a couple of generations deep. */
function descendants(pid: string, depth = 3): string[] {
  if (depth === 0) return [];
  const kids = sh("pgrep", ["-P", pid]).split("\n").filter(Boolean);
  return kids.flatMap((k) => [k, ...descendants(k, depth - 1)]);
}

const argsOf = (pid: string) => sh("ps", ["-o", "args=", "-p", pid]).trim();

/** Ancestors of this process, so we never suggest killing the session we are in. */
function ancestry(): Set<string> {
  const out = new Set<string>();
  let pid = String(process.pid);
  for (let i = 0; i < 12 && pid && pid !== "1"; i++) {
    out.add(pid);
    pid = sh("ps", ["-o", "ppid=", "-p", pid]).trim();
  }
  return out;
}

/** Last entry that is an actual message, not a bookkeeping record. */
function lastMessage(sid: string): { at: Date; role: string } | null {
  const file = join(TRANSCRIPTS, `${sid}.jsonl`);
  if (!existsSync(file)) return null;
  let found: { at: Date; role: string } | null = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const d = line ? parse(line) : null;
    if (d?.timestamp && (d.type === "assistant" || d.type === "user")) {
      found = { at: new Date(d.timestamp), role: d.type };
    }
  }
  return found;
}

function lastAssistantText(sid: string): string {
  const file = join(TRANSCRIPTS, `${sid}.jsonl`);
  if (!existsSync(file)) return "";
  let text = "";
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line?.includes('"assistant"')) continue;
    const c = parse(line)?.message?.content;
    if (!Array.isArray(c)) continue;
    const t = c.flatMap((x) => (x?.type === "text" && x.text ? [x.text] : [])).join("\n");
    if (t) text = t;
  }
  return text;
}

/** merge-base --is-ancestor signals through its exit code, so a throw is the "no". */
function inHistory(hash: string): boolean {
  if (sh("git", ["-C", REPO, "cat-file", "-t", hash]).trim() !== "commit") return false;
  try {
    execFileSync("git", ["-C", REPO, "merge-base", "--is-ancestor", hash, "HEAD"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function commitsLanded(text: string): { claimed: string[]; landed: string[] } {
  const claimed = [
    ...new Set([...text.matchAll(/`([0-9a-f]{7,12})`/g)].flatMap((m) => (m[1] ? [m[1]] : []))),
  ];
  const landed = claimed.filter((h) => {
    try {
      return inHistory(h);
    } catch {
      return false;
    }
  });
  return { claimed, landed };
}

/** Uncommitted paths in the tree, so we can ask who owns them. */
const dirtyPaths = sh("git", ["-C", REPO, "status", "--porcelain=v1"])
  .split("\n")
  .filter(Boolean)
  .map((l) => l.slice(3).trim())
  .filter((p) => !p.startsWith(".") && p !== "");

function ownsDirtyWork(sid: string): string[] {
  const file = join(TRANSCRIPTS, `${sid}.jsonl`);
  if (!existsSync(file) || statSync(file).size > 40_000_000) return [];
  const body = readFileSync(file, "utf8");
  // A session that merely read a file mentions it once or twice; the author mentions it a lot.
  return dirtyPaths.filter((p) => {
    const base = p.split("/").pop() ?? p;
    if (base.length < 6) return false;
    return body.split(base).length - 1 >= 8;
  });
}

export type Signals = {
  isMe: boolean;
  busy: boolean;
  sleeping: boolean;
  hasSid: boolean;
  hasAgent: boolean;
  idleMin: number;
  owns: string[];
  asksYou: boolean;
  claimed: string[];
  landed: string[];
};

/**
 * The order matters more than any single rule: every test that could keep a session
 * alive is asked before the one that would reap it, so an unsure answer is "keep".
 */
export function classify(s: Signals): { verdict: string; why: string } {
  if (s.isMe) return { verdict: "self", why: "this session" };
  if (s.busy) return { verdict: "busy", why: "generating right now" };
  if (s.sleeping) return { verdict: "asleep", why: "scheduled wake-up pending" };
  // The job wrapper ends with `exec bash -l`, so a finished agent leaves a bare shell
  // behind. That is the usual leftover — but it is indistinguishable from a shell
  // someone is working in, so it gets flagged for a human rather than reaped.
  if (!s.hasAgent) return { verdict: "shell", why: "agent exited, empty shell left over" };
  if (!s.hasSid) return { verdict: "unknown", why: "no --session-id (codex, or restarted)" };
  if (s.idleMin <= IDLE_MINUTES)
    return { verdict: "recent", why: `active ${Math.round(s.idleMin)}m ago` };
  if (s.owns.length)
    return { verdict: "dirty", why: `owns uncommitted ${s.owns.slice(0, 2).join(", ")}` };
  if (s.asksYou) return { verdict: "waiting", why: "ended on a question for you" };
  if (s.claimed.length && s.landed.length === 0)
    return { verdict: "dirty", why: `claims ${s.claimed[0]}, not in HEAD` };
  return {
    verdict: "done",
    why: s.landed.length ? `committed ${s.landed.join(", ")}` : "idle, nothing outstanding",
  };
}

type Row = { name: string; sid: string | null; verdict: string; why: string; idleMin: number };

/** Everything we can learn about one session, from tmux, ps, the transcript and git. */
function inspect(name: string, me: Set<string>): Row | null {
  {
    const panePid = sh("tmux", ["list-panes", "-t", name, "-F", "#{pane_pid}"]).split("\n")[0];
    if (!panePid) return null;

    const kids = descendants(panePid);
    const claudePid = kids.find((k) => /(^|\/)claude( |$)/.test(argsOf(k)));
    const agentPid = claudePid ?? kids.find((k) => /codex/.test(argsOf(k)));
    const sid = claudePid ? (argsOf(claudePid).match(/--session-id (\S+)/)?.[1] ?? null) : null;

    const sleeping = agentPid
      ? descendants(agentPid).some((k) => /\bsleep \d|until \[/.test(argsOf(k)))
      : false;
    const pane = sh("tmux", ["capture-pane", "-p", "-t", name, "-S", "-4"]);
    const busy = /esc to interrupt/.test(pane);
    const isMe = me.has(panePid) || (agentPid ? me.has(agentPid) : false);

    const last = sid ? lastMessage(sid) : null;
    const idleMin = last ? (Date.now() - last.at.getTime()) / 60000 : Number.POSITIVE_INFINITY;
    const text = sid ? lastAssistantText(sid) : "";
    const { claimed, landed } = commitsLanded(text);
    const owns = sid && idleMin > IDLE_MINUTES ? ownsDirtyWork(sid) : [];
    const asksYou = /\b(say which|your call|approve and I|tell me whether|which of these|shall I|let me know)\b/i.test(
      text.slice(-1500),
    );

    const { verdict, why } = classify({
      isMe,
      busy,
      sleeping,
      hasSid: Boolean(sid),
      hasAgent: Boolean(agentPid),
      idleMin,
      owns,
      asksYou,
      claimed,
      landed,
    });

    return { name, sid, verdict, why, idleMin };
  }
}

function main() {
  const me = ancestry();
  const rows = sh("tmux", ["list-sessions", "-F", "#{session_name}"])
    .split("\n")
    .filter(Boolean)
    .flatMap((name) => {
      const row = inspect(name, me);
      return row ? [row] : [];
    });

  const order = ["self", "busy", "asleep", "waiting", "dirty", "recent", "unknown", "shell", "done"];
  rows.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict));

  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  console.log(`\n${pad("session", 38)} ${pad("verdict", 9)} ${pad("idle", 7)} why`);
  console.log("-".repeat(110));
  for (const r of rows) {
    const idle = Number.isFinite(r.idleMin) ? `${Math.round(r.idleMin)}m` : "-";
    console.log(`${pad(r.name, 38)} ${pad(r.verdict, 9)} ${pad(idle, 7)} ${r.why}`);
  }

  const done = rows.filter((r) => r.verdict === "done");
  if (done.length === 0) {
    console.log("\nNothing safe to reap.\n");
  } else if (process.argv.includes("--kill")) {
    console.log();
    for (const r of done) {
      sh("tmux", ["kill-session", "-t", r.name]);
      console.log(`killed ${r.name}  (resume with: claude --resume ${r.sid})`);
    }
    console.log();
  } else {
    console.log(`\n${done.length} safe to reap. Nothing is lost — edits are on disk and the`);
    console.log("transcript survives, so `claude --resume <session-id>` brings one back.\n");
    console.log(`  npm run sessions -- --kill\n`);
  }
}

// Importing this file (the test does) must not drive tmux.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
