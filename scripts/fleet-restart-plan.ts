/**
 * **The judgment half of `scripts/fleet-restart.ts`** — every rule about what
 * counts as a pass, and no I/O at all.
 *
 * It is a separate file for the reason `scripts/readiness-run.ts` gives about
 * `tmux-job.ts`: the executor's whole correctness argument is that it runs
 * commands and hands back their bytes, and a parser living inside it would be
 * one more thing that can be wrong in the file that must not be. Everything
 * here takes recorded output and returns a verdict, so the tests never need a
 * systemd, a network or a running dashboard.
 *
 * ## The four verdicts, and why there are four
 *
 * A restart tool exists to tell you the truth about a service you cannot see,
 * so *"I could not tell"* has to be a different answer from *"it is fine"* —
 * docs/reusable/silent-success.md. `unknown` is therefore blocking: a check
 * that could not run exits non-zero and names itself, rather than being folded
 * into the pass column and disappearing.
 *
 * `skipped` is the fourth and it is not a weaker `unknown`: it is for a check
 * that has no subject. The steering queue of a service that is already dead is
 * already gone, so "is it empty" has no answer to be uncertain about, and
 * refusing to restart a dead service because its lost queue is unreadable would
 * be the tool refusing to do the one job that is unambiguously safe.
 */

import type { QueueView } from "../tools/fleet/wire.js";

/**
 * The unit, fixed, and **there is deliberately no `--unit` flag.**
 *
 * A flag here is `sudo -n systemctl restart $ANYTHING` behind a friendly name,
 * on a box where the caller is an agent in auto mode. It also costs the thing
 * this script was written to test: the classifier judges the command text it is
 * shown, and a fixed unit name is a narrower and more honest sentence than one
 * with a hole in it.
 *
 * Kept in sync with infra/hetzner/systemd/fleet-dashboard.service by
 * tests/a-restart-that-could-not-check-itself.test.ts, which fails if that file
 * is renamed.
 */
export const UNIT = "fleet-dashboard.service";

/** Where the unit's `WorkingDirectory` keeps the built client, relative to it. */
export const DIST_INDEX = "tools/fleet/web/dist/index.html";

/**
 * What `tools/fleet/server.ts` compiles in when `FLEET_PORT` is unset. A copy
 * of a fact that lives somewhere else, so the same test greps that file and
 * fails if the two ever disagree — the alternative is importing server.ts,
 * which reaches the network and a listening socket on import.
 */
export const DEFAULT_PORT = 8787;

/** The properties we ask `systemctl show` for, in one place so the test can assert the argv. */
export const SHOW_PROPERTIES = [
  "LoadState",
  "ActiveState",
  "SubState",
  "FragmentPath",
  "WorkingDirectory",
  "ControlGroup",
  "MainPID",
  "NRestarts",
  "Environment",
  // Not judged, only reported. Without them a failed start says "HTTP never
  // answered", which does not tell a failed ExecStartPre build apart from a
  // port collision or a bind that could not be taken.
  "Result",
  "ExecMainStatus",
] as const;

/* ------------------------------------------------------------------ *
 * Verdicts
 * ------------------------------------------------------------------ */

export type Verdict = "pass" | "fail" | "unknown" | "skipped" | "overridden";

export type Check = {
  /** Short enough to sit in a column. */
  name: string;
  verdict: Verdict;
  /** One line, and it must say *why* — a bare "fail" is a check that wasted its own run. */
  detail: string;
};

/** `fail` and `unknown` both stop the run; the other three do not. */
export function blocks(check: Check): boolean {
  return check.verdict === "fail" || check.verdict === "unknown";
}

export const EXIT_OK = 0;
export const EXIT_UNEXPECTED = 1;
/** A precondition said no. Nothing was restarted. */
export const EXIT_REFUSED = 2;
/** `sudo -n systemctl restart` itself failed. The service may or may not be up. */
export const EXIT_RESTART_FAILED = 3;
/** It restarted, and something afterwards failed or could not be established. */
export const EXIT_UNVERIFIED = 4;

/* ------------------------------------------------------------------ *
 * systemctl show
 * ------------------------------------------------------------------ */

/** `Key=Value` lines, split on the FIRST `=` — values contain them. */
export function parseShow(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}

export type UnitFacts = {
  loadState: string;
  activeState: string;
  subState: string;
  fragmentPath: string;
  workDir: string;
  controlGroup: string;
  /** 0 when the unit is not running — systemd's own way of saying "no process". */
  mainPid: number;
  /** How many times systemd has restarted it *on its own*, i.e. after it died. */
  restarts: number;
  environment: Record<string, string>;
  /** systemd's word for how the last run ended. Reported, never judged. */
  result: string;
  /** The exit status of the last `ExecStart`. Reported, never judged. */
  execMainStatus: string;
};

export type UnitRead = { ok: true; facts: UnitFacts } | { ok: false; why: string };

/**
 * Turn `systemctl show`'s output into facts, or a refusal.
 *
 * **Every field it refuses on is one this script would otherwise guess at.**
 * `WorkingDirectory` decides which checkout's `git` and which `dist/index.html`
 * we compare against; an absent one and a hard-coded `/home/greg/code/spideryarn2`
 * would produce a confident BUNDLE MATCH about a directory the unit does not
 * serve. That is the whole reason this returns a refusal rather than defaults.
 */
export function readUnit(show: Record<string, string>): UnitRead {
  const load = show.LoadState ?? "";
  if (load === "") return { ok: false, why: `systemctl show printed no LoadState for ${UNIT} — cannot confirm the unit exists` };
  if (load !== "loaded") return { ok: false, why: `${UNIT} is ${load}, not loaded — refusing to restart a unit systemd has not read` };

  const fragmentPath = show.FragmentPath ?? "";
  if (fragmentPath === "") return { ok: false, why: `${UNIT} is loaded but has no FragmentPath — cannot confirm which unit file it is` };

  const workDir = show.WorkingDirectory ?? "";
  if (workDir === "") return { ok: false, why: `${UNIT} has no WorkingDirectory — cannot tell which checkout it builds and serves` };
  if (!workDir.startsWith("/")) return { ok: false, why: `${UNIT}'s WorkingDirectory is ${workDir}, which is not an absolute path` };

  // NOT a refusal. The cgroup is only needed to prove the listener is ours, and
  // that check reports `unknown` for itself; refusing here would be one check's
  // uncertainty stopping the other four from ever running.
  const controlGroup = show.ControlGroup ?? "";

  const mainPid = Number(show.MainPID ?? "0");
  if (!Number.isInteger(mainPid) || mainPid < 0) return { ok: false, why: `systemctl show printed MainPID=${show.MainPID} for ${UNIT}, which is not a pid` };

  // Absent on some systemd versions, and its absence must not read as zero
  // restarts — that would turn "we cannot see the crash loop" into "there is no
  // crash loop". NaN here becomes an `unknown` in the flapping check below.
  const restarts = show.NRestarts === undefined ? Number.NaN : Number(show.NRestarts);

  return {
    ok: true,
    facts: {
      loadState: load,
      activeState: show.ActiveState ?? "",
      subState: show.SubState ?? "",
      fragmentPath,
      workDir,
      controlGroup,
      mainPid,
      restarts,
      environment: parseEnvironment(show.Environment ?? ""),
      result: show.Result ?? "",
      execMainStatus: show.ExecMainStatus ?? "",
    },
  };
}

/**
 * systemd renders `Environment=` as one space-separated line, quoting any value
 * that needs it. We only ever read `FLEET_PORT`, so this is deliberately a small
 * tokeniser rather than a shell parser.
 */
export function parseEnvironment(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tokens = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  for (const token of tokens) {
    const at = token.indexOf("=");
    if (at <= 0) continue;
    const raw = token.slice(at + 1);
    const unquoted = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")) ? raw.slice(1, -1) : raw;
    out[token.slice(0, at)] = unquoted;
  }
  return out;
}

export type PortRead = { ok: true; port: number; source: string } | { ok: false; why: string };

/**
 * The port the unit serves on: what it declares, else what server.ts compiles in.
 *
 * A declared-but-unusable `FLEET_PORT` is a refusal rather than a fall back to
 * 8787 — falling back would check a port the service is not on and then
 * cheerfully report whatever else is listening there.
 */
export function resolvePort(env: Record<string, string>): PortRead {
  const declared = env.FLEET_PORT;
  if (declared !== undefined) {
    const port = Number(declared);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, why: `${UNIT} declares FLEET_PORT=${declared}, which is not a port` };
    return { ok: true, port, source: `the unit's own FLEET_PORT` };
  }
  return { ok: true, port: DEFAULT_PORT, source: `the default in tools/fleet/server.ts (the unit sets no FLEET_PORT)` };
}

/* ------------------------------------------------------------------ *
 * The bundle
 * ------------------------------------------------------------------ */

/**
 * The `index-*.js` an HTML page loads, or null.
 *
 * **The built `dist/index.html` is one side of the comparison and the served
 * `/` is the other**, rather than the newest file in `assets/` by mtime, which
 * is what the shell prototype used. `ls -t | head -1` is a guess about which
 * file the build meant; `index.html` is the build's own answer, so a stale
 * bundle is caught by comparing two statements rather than a statement and a
 * heuristic.
 */
export function bundleRef(html: string): string | null {
  return html.match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null;
}

export function judgeBundle(built: string | null, served: string | null): Check {
  const name = "bundle";
  if (built === null) return { name, verdict: "unknown", detail: `${DIST_INDEX} names no index-*.js — cannot tell what the build produced` };
  if (served === null) return { name, verdict: "unknown", detail: "the served page names no index-*.js — cannot tell what is being served" };
  if (built !== served) return { name, verdict: "fail", detail: `serving ${served}, but the build produced ${built} — the page is stale` };
  return { name, verdict: "pass", detail: `${served}, which is what ${DIST_INDEX} names` };
}

/* ------------------------------------------------------------------ *
 * The listener
 * ------------------------------------------------------------------ */

export type Listener = { port: number; address: string; pids: number[] };

/** Parse `ss -ltnpH`. The local address is the fourth column; the port is after its last colon. */
export function parseListeners(ss: string): Listener[] {
  const out: Listener[] = [];
  for (const line of ss.split("\n")) {
    const columns = line.trim().split(/\s+/);
    const address = columns[3];
    if (address === undefined) continue;
    const colon = address.lastIndexOf(":");
    if (colon < 0) continue;
    const port = Number(address.slice(colon + 1));
    if (!Number.isInteger(port)) continue;
    const pids = [...line.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
    out.push({ port, address: address.slice(0, colon), pids });
  }
  return out;
}

/**
 * Is the thing on our port *this unit*?
 *
 * **A 200 on a port is no evidence about whose server it is.** On 2026-09-08 a
 * peer's dev server answered on a port another agent believed was its own and
 * sixteen screenshots were taken of the wrong build (`EADDRINUSE`, then a 200).
 * The unit's cgroup is what turns "something is up" into "this unit is up", so
 * when the cgroup cannot be read the answer is `unknown` and not a pass — the
 * HTTP check alone would happily confirm a stranger.
 */
export function judgeListener(listeners: Listener[], port: number, cgroupPids: number[] | null, name = "listener"): Check {
  // **THE LOOPBACK SOCKET SPECIFICALLY, because that is the one the HTTP check
  // asks.** The unit binds 127.0.0.1 *and* a tailnet address, so "some socket on
  // this port belongs to the cgroup" can be true of the tailnet one while a
  // stray process owns loopback — and then the ownership check and the HTTP
  // check are describing two different servers, both passing. GPT Sol, 2026-09-09.
  const loopback = listeners.filter((l) => l.port === port && (l.address === "127.0.0.1" || l.address === "[::1]"));
  if (loopback.length === 0) {
    const elsewhere = listeners.filter((l) => l.port === port);
    if (elsewhere.length === 0) return { name, verdict: "fail", detail: `nothing is listening on ${port}` };
    return { name, verdict: "fail", detail: `nothing is listening on 127.0.0.1:${port}, though something holds ${elsewhere.map((l) => l.address).join(", ")}:${port}` };
  }

  if (cgroupPids === null) return { name, verdict: "unknown", detail: `127.0.0.1:${port} is held, but the unit's cgroup could not be read, so it cannot be shown to be ours` };

  const inCgroup = new Set(cgroupPids);
  const ours = loopback.filter((l) => l.pids.some((p) => inCgroup.has(p)));
  if (ours.length > 0) return { name, verdict: "pass", detail: `127.0.0.1:${port} is held by pid ${ours[0]?.pids.join(",")}, which is in ${UNIT}'s cgroup` };

  const seen = loopback.flatMap((l) => l.pids);
  if (seen.length === 0) return { name, verdict: "unknown", detail: `127.0.0.1:${port} is held but ss showed no pid for it — cannot show it is ours` };
  return { name, verdict: "fail", detail: `127.0.0.1:${port} is held by pid ${seen.join(",")}, which is NOT in ${UNIT}'s cgroup — a different server has the port` };
}

/**
 * The same question asked *before* a restart, where the answer means something
 * different: a stranger on the port has to stop this from starting a second
 * supervisor for it. The unit's own file warns about exactly that — *"two
 * supervisors on one port is a fight where the loser's failure looks like a
 * crash"*. When our own unit holds it, that is simply the service we are about
 * to restart.
 */
export function judgePortIsFree(listeners: Listener[], port: number, cgroupPids: number[] | null, serviceUp: boolean): Check {
  const name = "port not a stranger's";
  const check = judgeListener(listeners, port, cgroupPids, name);
  if (check.verdict === "pass") return serviceUp ? check : { name, verdict: "fail", detail: `${UNIT} is not running, yet 127.0.0.1:${port} is held by something in its cgroup — a leftover process would fight the restart` };
  if (check.detail.includes("nothing is listening on")) return { name, verdict: "pass", detail: `nothing else holds ${port}` };
  return check;
}

/** `cgroup.procs`, one pid per line. */
export function parseCgroupProcs(text: string): number[] {
  return text
    .split("\n")
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/* ------------------------------------------------------------------ *
 * The steering queue
 * ------------------------------------------------------------------ */

/**
 * A compile-time tie to the dashboard's own wire type. If `items[]` stops
 * carrying what `summariseQueues` prints, this stops compiling — rather than
 * the script printing `undefined` beside an instruction it is about to discard.
 */
export const WIRE_STILL_CARRIES_WHAT_WE_PRINT: QueueView extends {
  quarantine: unknown;
  items: { id: string; sessionId: string; enqueuedAt: number; payload: unknown }[];
}
  ? true
  : never = true;

export type QueuedSummary = { id: string; sessionId: string; enqueuedAt: number; what: string };

/**
 * A steering hold, which is the half of the queue that is easy to miss.
 *
 * **A queue is on the wire when it has items *or* a quarantine hold**, and
 * `wire.ts` says the commonest hold has no items behind it: one message queued,
 * the send came back `partial`, the item settled `uncertain` and left. So a
 * check that counted `items` would read "nothing queued" over a session that
 * nothing may be sent to — and a restart erases the hold, silently re-opening
 * delivery to a pane somebody deliberately stopped sending to. Found by GPT
 * Sol, 2026-09-09.
 */
export type HoldSummary = { id: string; sessionId: string; why: string };

export type QueueRead = { ok: true; items: QueuedSummary[]; holds: HoldSummary[] } | { ok: false; why: string };

/**
 * What is in the steering queue, read defensively.
 *
 * Defensively because this is the check standing between a restart and somebody
 * losing an instruction they queued: a shape it does not recognise has to become
 * *"I cannot tell you what you are about to throw away"*, never an empty list.
 */
export function summariseQueues(body: unknown): QueueRead {
  if (typeof body !== "object" || body === null) return { ok: false, why: "GET /api/actions did not return an object" };
  const queues = (body as { queues?: unknown }).queues;
  if (!Array.isArray(queues)) return { ok: false, why: "GET /api/actions returned no `queues` array — the dashboard's shape has changed and this cannot say what would be discarded" };

  const items: QueuedSummary[] = [];
  const holds: HoldSummary[] = [];
  for (const queue of queues) {
    const q = queue as { items?: unknown; quarantine?: unknown; sessionId?: unknown };
    if (!Array.isArray(q?.items)) return { ok: false, why: "a queue in GET /api/actions has no `items` array — cannot say what would be discarded" };
    if (!("quarantine" in (q ?? {}))) return { ok: false, why: "a queue in GET /api/actions has no `quarantine` field — this build cannot see steering holds, and a restart erases them" };
    for (const item of q.items) items.push(summariseItem(item));
    const hold = q.quarantine;
    if (hold !== null && typeof hold === "object") holds.push(summariseHold(hold, q.sessionId));
  }
  return { ok: true, items, holds };
}

function summariseItem(item: unknown): QueuedSummary {
  const it = item as { id?: unknown; sessionId?: unknown; enqueuedAt?: unknown; payload?: unknown };
  return {
    id: str(it.id, "(no id)"),
    sessionId: str(it.sessionId, "(no session)"),
    enqueuedAt: typeof it.enqueuedAt === "number" ? it.enqueuedAt : Number.NaN,
    what: describePayload(it.payload),
  };
}

function summariseHold(hold: object, queueSession: unknown): HoldSummary {
  const h = hold as { id?: unknown; sessionId?: unknown; why?: unknown };
  return {
    id: str(h.id, "(no id)"),
    sessionId: str(h.sessionId, str(queueSession, "(no session)")),
    why: typeof h.why === "string" ? oneLine(h.why, 90) : "a hold this build cannot describe",
  };
}

/** A string field read off the wire, or a stated absence — never `undefined` printed beside an item about to be discarded. */
function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function describePayload(payload: unknown): string {
  const p = payload as { kind?: unknown; text?: unknown; action?: unknown };
  if (p?.kind === "message" && typeof p.text === "string") return `message: ${oneLine(p.text, 90)}`;
  if (p?.kind === "action") {
    const id = (p.action as { id?: unknown })?.id;
    return `action: ${typeof id === "string" ? id : "(unnamed)"}`;
  }
  return `payload of an unrecognised shape: ${oneLine(JSON.stringify(payload ?? null), 90)}`;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * The queue precondition.
 *
 * `serviceUp` is the argument that makes `skipped` right rather than lax: the
 * queue lives in the process, so a service that is not running has no queue to
 * discard, and `docs/project/overseer.md` calls restarting a dead service the
 * safe case. Refusing it because its already-lost queue is unreadable would be
 * the tool at its least useful in the hour it is most needed.
 */
export function judgeQueue(serviceUp: boolean, read: QueueRead, discard: boolean): Check {
  const name = "steering queue";
  if (!serviceUp) return { name, verdict: "skipped", detail: `${UNIT} is not running, so its in-memory queue is already gone — there is nothing a restart could discard` };

  // **`--discard-queue` DOES NOT COVER THIS, and that is a reversal.** The
  // authority the Overseer is acting under is "once you have read the steering
  // queue" (docs/project/overseer.md § Steering), so an override that fires
  // when the queue could NOT be read is an override of a condition that was
  // never met — and it cannot even print what it is throwing away. Known
  // contents may be discarded on purpose; unknown contents stay blocking. GPT
  // Sol, 2026-09-09.
  if (!read.ok) return { name, verdict: "unknown", detail: `${read.why}. A restart discards the queue and records nothing, and --discard-queue deliberately does not cover a queue nobody has read.` };

  const parts: string[] = [];
  if (read.items.length > 0) parts.push(`${read.items.length} ${read.items.length === 1 ? "item" : "items"}`);
  if (read.holds.length > 0) parts.push(`${read.holds.length} steering ${read.holds.length === 1 ? "hold" : "holds"}`);
  if (parts.length === 0) return { name, verdict: "pass", detail: "empty, and no steering holds — nothing would be discarded" };

  const what = parts.join(" and ");
  if (discard) return { name, verdict: "overridden", detail: `${what} will be DISCARDED and not recorded anywhere (listed above)` };
  return { name, verdict: "fail", detail: `${what} (listed above). A restart discards them and records nothing. Re-run with --discard-queue to accept that.` };
}

/* ------------------------------------------------------------------ *
 * git: the primary is at origin/dev
 * ------------------------------------------------------------------ */

export type GitRead =
  | { ok: true; head: string; fetchedDev: string; behind: number; ahead: number; branch: string; dirtyFleetFiles: string[] }
  | { ok: false; why: string };

/**
 * **Named for what it actually asserts, which is not "at origin/dev".**
 *
 * The first version of this check was called *primary at origin/dev* and passed
 * whenever `HEAD..origin/dev` was zero. GPT Sol, 2026-09-09: on a feature branch
 * that contains dev, and on a local dev two commits ahead, that count is zero
 * too — so a green line saying "at origin/dev" was compatible with building a
 * feature branch. The branch is a check of its own below; this one only claims
 * what it measures.
 *
 * **Behind refuses; ahead only gets reported.** Behind means the restart would
 * rebuild something older than `dev`, which is a deploy backwards. Ahead is the
 * ordinary state of a shared primary in the minute between a commit and a push,
 * and refusing on it would make the script unusable on the box it is for.
 */
export function judgeBehind(read: GitRead): Check {
  const name = "not behind dev";
  if (!read.ok) return { name, verdict: "unknown", detail: read.why };
  if (read.behind > 0) {
    const plural = read.behind === 1 ? "commit" : "commits";
    return { name, verdict: "fail", detail: `the primary is ${read.behind} ${plural} behind the dev just fetched (${short(read.head)} vs ${short(read.fetchedDev)}) — restarting would rebuild something older. Merge origin/dev in the primary first.` };
  }
  const aheadNote = read.ahead > 0 ? `, ${read.ahead} ahead (unpushed work will go live)` : "";
  return { name, verdict: "pass", detail: `${short(read.head)} is not behind the fetched dev (${short(read.fetchedDev)})${aheadNote}` };
}

/** A feature branch checked out in the primary is what `not behind` cannot see. */
export function judgeBranch(read: GitRead): Check {
  const name = "on dev";
  if (!read.ok) return { name, verdict: "unknown", detail: read.why };
  if (read.branch === "dev") return { name, verdict: "pass", detail: "the primary is on dev" };
  return { name, verdict: "fail", detail: `the primary is on ${read.branch || "a detached HEAD"}, not dev — a restart would build and serve that` };
}

/**
 * Uncommitted changes **to the files this unit builds**, and only those.
 *
 * A blanket clean-tree rule was the reviewer's suggestion and would be right on
 * a machine with one owner. This one is shared by a dozen agents and is never
 * clean — the working tree carries other people's half-finished work all night.
 * So the line is drawn at blast radius instead: `ExecStartPre` runs
 * `build:fleet`, so a modified file under `tools/fleet/` is what would actually
 * go live half-written. Everything else is reported and does not block.
 */
export function judgeDirty(read: GitRead): Check {
  const name = "fleet files clean";
  if (!read.ok) return { name, verdict: "unknown", detail: read.why };
  if (read.dirtyFleetFiles.length === 0) return { name, verdict: "pass", detail: "no uncommitted changes under tools/fleet/" };
  return { name, verdict: "fail", detail: `uncommitted changes under tools/fleet/ would be built and served half-written: ${read.dirtyFleetFiles.slice(0, 6).join(", ")}${read.dirtyFleetFiles.length > 6 ? ` and ${read.dirtyFleetFiles.length - 6} more` : ""}` };
}

function short(sha: string): string {
  return sha.slice(0, 8);
}

/* ------------------------------------------------------------------ *
 * After the restart
 * ------------------------------------------------------------------ */

/**
 * Did the restart actually happen?
 *
 * The one check that catches this script lying about its own central act: a
 * `systemctl restart` that exits 0 while the same process keeps running would
 * otherwise be reported as a successful restart by every other check on the
 * page, all of which describe a service that was never touched.
 */
export function judgeReplaced(before: number, after: number): Check {
  const name = "process replaced";
  if (after === 0) return { name, verdict: "fail", detail: "the unit has no MainPID after the restart — nothing is running" };
  if (before === after) return { name, verdict: "fail", detail: `MainPID is still ${after} — the restart did not replace the process` };
  return { name, verdict: "pass", detail: before === 0 ? `now pid ${after} (it was not running before)` : `pid ${before} → ${after}` };
}

/**
 * `Restart=always` plus `RestartSec=10` means a service that cannot stay up
 * comes back looking healthy every ten seconds. A single `is-active` a moment
 * after the restart cannot tell that apart from a service that is fine, so the
 * count systemd keeps of its *own* restarts is asked instead. `systemctl
 * restart` does not increment it — only a death does.
 */
export function judgeFlapping(before: number, after: number): Check {
  const name = "not crash-looping";
  if (Number.isNaN(before) || Number.isNaN(after)) return { name, verdict: "unknown", detail: "systemd did not report NRestarts, so a crash loop cannot be ruled out" };
  if (after > before) return { name, verdict: "fail", detail: `systemd has restarted it ${after - before} more time(s) on its own since — it is crash-looping (NRestarts ${before} → ${after})` };
  return { name, verdict: "pass", detail: `NRestarts is still ${after} — it has not died and been restarted since` };
}

/**
 * **One healthy instant is not a healthy service.**
 *
 * `Type=simple` reaches `active` when `ExecStart` forks, before Node has
 * finished its asynchronous binds — and `tools/fleet/server.ts` treats a bind it
 * cannot take as fatal. So the process can bind loopback, answer 200 with the
 * right bundle, then fail the tailnet bind and exit; ten seconds later
 * `Restart=always` starts another one, and every check above passed in that
 * window. GPT Sol, 2026-09-09.
 *
 * The baseline is taken **after** the restart rather than reusing the
 * pre-restart `NRestarts`: systemd's counter can be reset by manual activation,
 * so comparing across the restart cannot distinguish "it has not died" from
 * "the counter went back to zero".
 */
export function judgeStable(pidAtStart: number, restartsAtStart: number, pidNow: number, restartsNow: number, windowMs: number): Check {
  const name = "stable";
  const seconds = Math.round(windowMs / 1000);
  if (pidNow === 0) return { name, verdict: "fail", detail: `it had pid ${pidAtStart} and has none ${seconds}s later — it came up and died` };
  if (pidNow !== pidAtStart) return { name, verdict: "fail", detail: `pid ${pidAtStart} → ${pidNow} over ${seconds}s with no restart asked for — it came up and was replaced` };
  if (Number.isNaN(restartsAtStart) || Number.isNaN(restartsNow)) return { name, verdict: "unknown", detail: `pid ${pidNow} held for ${seconds}s, but systemd reported no NRestarts to confirm nothing restarted in between` };
  if (restartsNow !== restartsAtStart) return { name, verdict: "fail", detail: `NRestarts ${restartsAtStart} → ${restartsNow} over ${seconds}s — systemd restarted it behind us` };
  return { name, verdict: "pass", detail: `pid ${pidNow} held for ${seconds}s, past RestartSec, with no restart behind us` };
}

export function judgeActive(facts: UnitFacts): Check {
  const name = "active";
  if (facts.activeState === "active") return { name, verdict: "pass", detail: `active (${facts.subState})` };
  if (facts.activeState === "activating") return { name, verdict: "unknown", detail: `still activating (${facts.subState}) after the wait — it may yet come up, but this run cannot say it did` };
  return { name, verdict: "fail", detail: `${facts.activeState || "(no ActiveState)"} (${facts.subState})` };
}

export function judgeHttp(status: number | null, why: string, port: number): Check {
  const name = "http";
  if (status === null) return { name, verdict: "fail", detail: `GET http://127.0.0.1:${port}/ never answered: ${why}` };
  if (status !== 200) return { name, verdict: "fail", detail: `GET http://127.0.0.1:${port}/ returned ${status}` };
  return { name, verdict: "pass", detail: `GET http://127.0.0.1:${port}/ returned 200` };
}

/**
 * The four things the `overseer` line of `overseer status` can be saying, which
 * are `describeClaim`'s four cases in tools/fleet/overseer-claim.ts.
 */
export type ClaimState = "holder" | "none" | "cannot-tell" | "unreadable";

export function claimState(line: string | null): ClaimState {
  if (line === null) return "unreadable";
  if (line.includes("Overseer: ")) return "holder";
  if (line.includes("no Overseer session")) return "none";
  return "cannot-tell";
}

/**
 * The Overseer daemon reads the dashboard, so a restart's blast radius reaches
 * it. This is the only check here about something other than the target.
 *
 * **Before and after, never after alone.** There is legitimately no Overseer
 * session at four in the morning, and a check that failed for that would cry
 * wolf every night.
 *
 * **And `cannot-tell` is neither answer.** This was found the expensive way on
 * 2026-09-09: the first real run of this script reported *"the Overseer held a
 * claim before and does not now"* seconds after a restart, and it was false. The
 * claim is the daemon's own view, folded from its polls of the dashboard, so for
 * one tick after a restart it honestly reads `Overseer unknown — the dashboard
 * has never completed a collection`. Reading that transient as a loss made the
 * check's loudest output its least trustworthy one. The caller therefore waits
 * for the daemon's next collection, and a `cannot-tell` that never settles is
 * `unknown` — which still blocks, because a daemon permanently unable to see the
 * dashboard is exactly what a bad restart looks like.
 */
export function judgeOverseerClaim(before: string | null, after: string | null, waitedMs: number): Check {
  const name = "overseer claim";
  const was = claimState(before);
  if (was === "unreadable") return { name, verdict: "unknown", detail: "`overseer status` could not be read before the restart, so its effect on the Overseer's claim is unknown" };
  if (was !== "holder") return { name, verdict: "skipped", detail: `no claim to lose before the restart — ${oneLine(before ?? "", 80)}` };

  switch (claimState(after)) {
    case "holder":
      // THE SAME HOLDER, not merely a holder: `Overseer: Alice` before and
      // `Overseer: Bob` after is a change of hands, and a check that read both
      // as "somebody holds it" would pass through the one event here that would
      // actually matter. GPT Sol, 2026-09-09.
      if (before !== after) return { name, verdict: "fail", detail: `the claim changed hands across the restart: ${oneLine(before ?? "", 45)} → ${oneLine(after ?? "", 45)}` };
      return { name, verdict: "pass", detail: oneLine(after ?? "", 90) };
    case "none":
      return { name, verdict: "fail", detail: `the Overseer held a claim before (${oneLine(before ?? "", 60)}) and does not now (${oneLine(after ?? "", 60)})` };
    case "unreadable":
      return { name, verdict: "unknown", detail: "`overseer status` could not be read after the restart" };
    default:
      return { name, verdict: "unknown", detail: `the Overseer daemon had not re-collected from the dashboard ${Math.round(waitedMs / 1000)}s after the restart — ${oneLine(after ?? "", 70)}` };
  }
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

const MARK: Record<Verdict, string> = {
  pass: "ok  ",
  fail: "FAIL",
  unknown: "?   ",
  skipped: "n/a ",
  overridden: "!!  ",
};

/** One screenful: a marked line per check, then the verdict and what to do about it. */
export function renderReport(title: string, checks: Check[]): string[] {
  const width = Math.max(0, ...checks.map((c) => c.name.length));
  const lines = [title, ""];
  for (const check of checks) lines.push(`  ${MARK[check.verdict]}  ${check.name.padEnd(width)}  ${check.detail}`);
  const bad = checks.filter(blocks);
  lines.push("");
  if (bad.length === 0) lines.push("  all clear");
  else for (const check of bad) lines.push(`  ${check.verdict === "fail" ? "FAILED" : "UNKNOWN"}: ${check.name} — ${check.detail}`);
  return lines;
}

/** The queued items and holds, printed before they are discarded, because after is too late. */
export function renderQueueItems(read: QueueRead, now: number): string[] {
  if (!read.ok) return [];
  const lines: string[] = [];
  if (read.items.length > 0) {
    lines.push(`  ${read.items.length} item(s) in the steering queue:`);
    for (const item of read.items) {
      const age = Number.isNaN(item.enqueuedAt) ? "unknown age" : `${Math.round((now - item.enqueuedAt) / 1000)}s old`;
      lines.push(`    ${item.sessionId} ${item.id} (${age})  ${item.what}`);
    }
  }
  if (read.holds.length > 0) {
    lines.push(`  ${read.holds.length} steering hold(s), which a restart erases:`);
    for (const hold of read.holds) lines.push(`    ${hold.sessionId} ${hold.id}  ${hold.why}`);
  }
  return lines;
}
