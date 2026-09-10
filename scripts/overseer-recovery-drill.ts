/**
 * THE RECOVERY DRILL — a disposable Overseer store in which a simulated reboot
 * has interrupted four sessions, built by the real daemon.
 *
 *   npx tsx scripts/overseer-recovery-drill.ts <empty-or-new-directory>
 *
 * docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md
 * § Stage 3. This is the acceptance artefact: serve the printed store with
 * `OVERSEER_STORE_DIR=<store>` on a fleet server of its own, open `#overseer`,
 * and "Interrupted work" shows the recoverable work and the missing evidence —
 * and nothing is started, because nothing on that page can start anything.
 *
 * ## What it drives, and why the real daemon
 *
 * `runOverseer` with a scripted source and an injected boot id — the harness
 * tests/overseer-daemon-recovery.test.ts uses — so every line of the store comes
 * from the real parser, gate, differ, fold, view pass and checkpoint. A store
 * written by hand would test the page against a shape nothing produces.
 *
 *  1. Boot B1, generation G1: four sessions — a Claude that was working (with a
 *     transcript under the drill's own `projects/`), one whose Claude had
 *     exited, a shell running a job, and one whose directory is then deleted.
 *  2. The box "reboots": a new daemon, boot B2, a new dashboard run, and its
 *     first accepted collection is empty with no tmux server (`rows: []`, null
 *     generation) — the snapshot that used to erase the register.
 *  3. Generation G2 arrives with the working Claude back under a new execution
 *     token: the same verified conversation in a different run.
 *
 * ## It never touches a live store
 *
 * It refuses a target that is, is inside, or contains a live store —
 * `~/.overseer`, and `OVERSEER_STORE_DIR` when that is set to an absolute path —
 * and a target that is not empty. Both sides are compared **as the file system
 * will resolve them** (`canonicalPath`), so a symlinked ancestor is caught even
 * when the leaf does not exist yet, and the check is repeated on the canonical
 * path immediately before anything is created there (Sol's F28). Everything it
 * writes is under the target: `store/` (the Overseer's root), `projects/` (a
 * stand-in for `~/.claude/projects`) and `work/` (the sessions' directories).
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { slugifyDir } from "../tools/fleet/transcript.js";
import { runOverseer } from "../tools/overseer/daemon.js";
import type { JsonValue } from "../tools/overseer/observation.js";
import type { SourceMessage } from "../tools/overseer/source.js";

/** The four sessions, by the name the page shows. */
export const DRILL_SESSIONS = {
  working: "drill-claude-working",
  exited: "drill-claude-exited",
  shell: "drill-shell-job",
  deleted: "drill-dir-deleted",
} as const;

/** Conversation uuids minted for the drill. */
export const DRILL_CONVERSATIONS = {
  working: "5f3c9a2e-8b41-4d6f-a0c7-2e91b4d8f613",
  exited: "c81e4b07-3d9a-4f25-b6e0-94a7d2c5f18b",
  deleted: "0a6d2f94-e7b3-4c18-9f52-b3e8a1d7c640",
} as const;

const BOOT_ONE = "drill-boot-one";
const BOOT_TWO = "drill-boot-two";
const RUN_BEFORE = "d7a1c3e9";
const RUN_AFTER = "b2f4e6a8";
const G1 = 424201;
const G2 = 424277;
const REPO = "spideryarn/reading2";

export type DrillResult = {
  /** The Overseer root: what `OVERSEER_STORE_DIR` is set to. */
  store: string;
  projects: string;
  work: string;
  dirs: Record<keyof typeof DRILL_SESSIONS, string>;
};

/**
 * Where the guard looks for live stores. Production passes nothing and gets
 * this process's home and environment; the tests pass a fake home, so proving
 * the guard never involves the real `~/.overseer`.
 */
export type StoreGuard = { home?: string | undefined; env?: NodeJS.ProcessEnv | undefined };

function errnoCode(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * A path as the file system will resolve it when something is created there:
 * the nearest ancestor that exists, canonicalised, with the part that does not
 * exist yet appended.
 *
 * `realpathSync` of the whole path fails whenever the leaf is new — which is
 * the drill's ordinary case — and the fallback to the lexical path there is
 * what let `/tmp/live/new-drill` through when `/tmp/live -> ~/.overseer`
 * (Sol's F28). **Throws on a dangling link on the way**: creating through one
 * lands wherever it points, which cannot be checked before it exists.
 */
export function canonicalPath(path: string): string {
  const missing: string[] = [];
  let probe = resolve(path);
  for (;;) {
    let real: string | null = null;
    try {
      real = realpathSync(probe);
    } catch (cause) {
      if (errnoCode(cause) !== "ENOENT") throw cause;
    }
    if (real !== null) return missing.length === 0 ? real : join(real, ...missing.reverse());
    let dangling = false;
    try {
      dangling = lstatSync(probe).isSymbolicLink();
    } catch {
      /* absent: keep walking up */
    }
    if (dangling) throw new Error(`${probe} is a symbolic link to somewhere that does not exist`);
    const parent = dirname(probe);
    if (parent === probe) return resolve(path);
    missing.push(basename(probe));
    probe = parent;
  }
}

/** `~/.overseer`, and `OVERSEER_STORE_DIR` when it is absolute — the only form the daemon accepts (attention.ts § storeRoot). */
function liveStores(guard: StoreGuard): string[] {
  const stores = [join(guard.home ?? homedir(), ".overseer")];
  const override = (guard.env ?? process.env)["OVERSEER_STORE_DIR"]?.trim();
  if (override !== undefined && override !== "" && isAbsolute(override)) stores.push(override);
  return stores;
}

function within(inner: string, outer: string): boolean {
  return inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : `${outer}${sep}`);
}

/**
 * Refuse a target that is, is inside, or contains a live store, and one with
 * anything in it. Both directions of containment, because the drill writes
 * `store/` beneath its target.
 */
export function refuseUnsafeTarget(target: string, guard: StoreGuard = {}): string | null {
  let resolved: string;
  try {
    resolved = canonicalPath(target);
  } catch (cause) {
    return `refusing: ${target} cannot be resolved safely: ${message(cause)}`;
  }
  for (const store of liveStores(guard)) {
    let canonical: string;
    try {
      canonical = canonicalPath(store);
    } catch (cause) {
      return `refusing: the live Overseer store ${store} cannot be resolved, so ${target} cannot be shown to be outside it: ${message(cause)}`;
    }
    if (within(resolved, canonical) || within(canonical, resolved)) {
      return `refusing: ${target} resolves to ${resolved}, which is or overlaps the live Overseer store (${canonical}). The drill only ever builds a disposable one.`;
    }
  }
  if (existsSync(resolved)) {
    if (!statSync(resolved).isDirectory()) return `refusing: ${target} is not a directory.`;
    if (readdirSync(resolved).length > 0) return `refusing: ${target} is not empty. Give the drill a new or empty directory.`;
  }
  return null;
}

function payload(json: JsonValue): SourceMessage {
  return { kind: "payload", via: "sse", atMs: 0, json };
}

function snapshot(
  rows: JsonValue[],
  s: { instance: string; inventory: number; tmuxServerPid: number | null; collectedAt: string },
): JsonValue {
  return {
    schema: 1,
    rows,
    tmuxServerPid: s.tmuxServerPid,
    collectedAt: s.collectedAt,
    tookMs: 1200,
    error: null,
    refreshMs: 60_000,
    health: null,
    producer: { instance: s.instance, publication: s.inventory, inventory: s.inventory },
  };
}

function row(spec: {
  handle: number;
  name: string;
  title: string | null;
  kind: "claude" | "shell";
  dir: string;
  claim: string | null;
  status: JsonValue;
  startedAt: string;
  execution?: JsonValue;
}): JsonValue {
  return {
    id: `$${spec.handle}`,
    name: spec.name,
    title: spec.title,
    repo: REPO,
    worktree: null,
    meta: { version: 1, kind: spec.kind, repo: REPO, dir: spec.dir },
    startedAt: spec.startedAt,
    paneId: `%${spec.handle}`,
    panePid: spec.handle * 10,
    claudeSessionId: spec.claim,
    question: null,
    status: spec.status,
    ...(spec.execution === undefined ? {} : { execution: spec.execution }),
  };
}

function verified(conversation: string, pid: number, startTicks: number): JsonValue {
  return {
    kind: "verified",
    token: { boot: "drill-exec-boot", pid, startTicks },
    harness: "claude-code",
    conversation: { kind: "verified", id: conversation },
  };
}

/**
 * Build the store. Returns where everything is. Throws on a refused target, and
 * if any daemon run does not stop cleanly — a drill that half-ran must not look
 * like one that finished.
 */
export async function buildRecoveryDrill(
  target: string,
  options: { now?: () => Date; log?: (line: string) => void; hostname?: () => string } & StoreGuard = {},
): Promise<DrillResult> {
  const guard: StoreGuard = { home: options.home, env: options.env };
  const refusal = refuseUnsafeTarget(target, guard);
  if (refusal !== null) throw new Error(refusal);
  const root = canonicalPath(target);
  const store = join(root, "store");
  const projects = join(root, "projects");
  const work = join(root, "work");
  const dirs = {
    working: join(work, DRILL_SESSIONS.working),
    exited: join(work, DRILL_SESSIONS.exited),
    shell: join(work, DRILL_SESSIONS.shell),
    deleted: join(work, DRILL_SESSIONS.deleted),
  };
  // RECHECKED ON THE CANONICAL PATH IMMEDIATELY BEFORE ANYTHING IS CREATED, and
  // the root is then created by that path and confirmed to still be it, so a
  // link swapped in after the first check cannot redirect the writes (F28).
  const again = refuseUnsafeTarget(root, guard);
  if (again !== null) throw new Error(again);
  mkdirSync(root, { recursive: true });
  const landed = realpathSync(root);
  if (landed !== root) throw new Error(`refusing: ${root} resolved to ${landed} once created; nothing more is written`);
  for (const dir of [store, projects, ...Object.values(dirs)]) mkdirSync(dir, { recursive: true });

  // The working Claude's transcript, where `findTranscript` would look first.
  const transcriptDir = join(projects, slugifyDir(dirs.working));
  mkdirSync(transcriptDir, { recursive: true });
  writeFileSync(
    join(transcriptDir, `${DRILL_CONVERSATIONS.working}.jsonl`),
    `${JSON.stringify({ type: "user", message: { role: "user", content: "a drill transcript: the conversation that was working" } })}\n`,
  );

  const now = options.now ?? (() => new Date());
  const base = now().getTime();
  const at = (minutesAgo: number): string => new Date(base - minutesAgo * 60_000).toISOString();
  const startedAt = at(180);

  const beforeRows: JsonValue[] = [
    row({
      handle: 9101,
      name: DRILL_SESSIONS.working,
      title: "Drill: a Claude mid-task when the box rebooted",
      kind: "claude",
      dir: dirs.working,
      claim: DRILL_CONVERSATIONS.working,
      status: { kind: "working" },
      startedAt,
      execution: verified(DRILL_CONVERSATIONS.working, 91011, 5001),
    }),
    row({
      handle: 9102,
      name: DRILL_SESSIONS.exited,
      title: null,
      kind: "claude",
      dir: dirs.exited,
      claim: DRILL_CONVERSATIONS.exited,
      status: { kind: "no-claude" },
      startedAt,
    }),
    row({
      handle: 9103,
      name: DRILL_SESSIONS.shell,
      title: null,
      kind: "shell",
      dir: dirs.shell,
      claim: null,
      status: { kind: "shell", busy: true },
      startedAt,
    }),
    row({
      handle: 9104,
      name: DRILL_SESSIONS.deleted,
      title: null,
      kind: "claude",
      dir: dirs.deleted,
      claim: DRILL_CONVERSATIONS.deleted,
      status: { kind: "working" },
      startedAt,
    }),
  ];
  const resumedRow = row({
    handle: 1,
    name: DRILL_SESSIONS.working,
    title: "Drill: a Claude mid-task when the box rebooted",
    kind: "claude",
    dir: dirs.working,
    claim: DRILL_CONVERSATIONS.working,
    status: { kind: "working" },
    startedAt: at(4),
    execution: verified(DRILL_CONVERSATIONS.working, 2301, 77),
  });

  const log = options.log ?? (() => {});
  const run = async (bootId: string, messages: JsonValue[]): Promise<void> => {
    const outcome = await runOverseer({
      root: store,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      now,
      tickMs: 5,
      log,
      source: () =>
        (async function* () {
          for (const message of messages) yield payload(message);
        })(),
      bootId: () => bootId,
      recovery: { projectsDir: projects, ...(options.hostname === undefined ? {} : { hostname: options.hostname }) },
    });
    if (outcome.kind !== "stopped") throw new Error(`the drill's daemon run ended ${JSON.stringify(outcome)}`);
  };

  // 1. Before: boot B1, generation G1, four sessions.
  await run(BOOT_ONE, [snapshot(beforeRows, { instance: RUN_BEFORE, inventory: 1, tmuxServerPid: G1, collectedAt: at(30) })]);
  // The fourth session's directory goes away while the box is down.
  rmSync(dirs.deleted, { recursive: true, force: true });
  // 2 and 3. After: a new daemon under boot B2 — the empty first collection,
  // then G2 with the working Claude back under a new token.
  await run(BOOT_TWO, [
    snapshot([], { instance: RUN_AFTER, inventory: 1, tmuxServerPid: null, collectedAt: at(10) }),
    snapshot([resumedRow], { instance: RUN_AFTER, inventory: 2, tmuxServerPid: G2, collectedAt: at(5) }),
  ]);

  const written = JSON.parse(readFileSync(join(store, "recovery.json"), "utf8")) as { records?: unknown[]; view?: unknown };
  if (!Array.isArray(written.records) || written.records.length !== 4) {
    throw new Error(`the drill expected four recovery records and the daemon wrote ${Array.isArray(written.records) ? written.records.length : "none"}`);
  }
  if (written.view === null || written.view === undefined) throw new Error("the drill's daemon wrote no view");
  return { store, projects, work, dirs };
}

function invokedDirectly(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && invoked === fileURLToPath(import.meta.url);
}

if (invokedDirectly()) {
  const target = process.argv[2];
  if (target === undefined || process.argv.length > 3) {
    console.error("usage: npx tsx scripts/overseer-recovery-drill.ts <empty-or-new-directory>");
    process.exit(2);
  }
  buildRecoveryDrill(target)
    .then((result) => {
      console.log(result.store);
    })
    .catch((cause: unknown) => {
      console.error(`✗ ${cause instanceof Error ? cause.message : String(cause)}`);
      process.exit(1);
    });
}
