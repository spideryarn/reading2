/**
 * The recovery index, for a person at a terminal —
 * docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md
 * § 5.
 *
 *     npx tsx scripts/overseer-recovery.ts list
 *     npx tsx scripts/overseer-recovery.ts dismiss <id> --why "<sentence>"
 *
 * **`list` reads `recovery.json` read-only** and prints every record the index
 * retains — the page shows the first hundred, this shows all of them. When the
 * index has overflowed it gives the exact count and says those records survive
 * only in `events.jsonl`: it does not claim to list them (Sol's F10).
 *
 * **`dismiss` writes one request file** into `~/.overseer/recovery-inbox/` and
 * nothing else. The daemon applies or refuses it on its next tick, and stays
 * the only writer of `events.jsonl` and `recovery.json`. There is no dismiss
 * button in v1: that would be an action route.
 *
 * Nothing here starts, resumes or offers to resume anything, and nothing prints
 * a command to paste: `manual` records get a host and a directory.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { RECOVERY_INBOX_DIR, REFUSED_DIR, writeDismissRequest } from "../tools/overseer/recovery-inbox.js";
import { writeResumeRequest } from "../tools/overseer/recovery-resume-request.js";
import { recoveryOrder } from "../tools/overseer/recovery-view.js";
import { RECOVERY_UNRESOLVED_CAPACITY, type RecoveryRecord } from "../tools/overseer/recovery.js";
import { readRecoveryIndexFile, RECOVERY_FILE, storeRoot } from "../tools/overseer/store.js";

const USAGE = [
  "usage:",
  "  npx tsx scripts/overseer-recovery.ts list",
  '  npx tsx scripts/overseer-recovery.ts dismiss <id> --why "<sentence>"',
  "  npx tsx scripts/overseer-recovery.ts resume <id>",
].join("\n");

export type CliIo = { root?: string; out?: (line: string) => void };

export async function main(argv: readonly string[], io: CliIo = {}): Promise<number> {
  const out = io.out ?? ((line: string) => console.log(line));
  const root = io.root ?? storeRoot();
  const [command, ...rest] = argv;
  switch (command) {
    case "list":
      return list(root, out);
    case "dismiss":
      return dismiss(root, rest, out);
    case "resume":
      return resume(root, rest, out);
    default:
      out(USAGE);
      return 2;
  }
}

function dismiss(root: string, args: readonly string[], out: (line: string) => void): number {
  let id: string | null = null;
  let why: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === "--why") {
      why = args[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith("--why=")) {
      why = arg.slice("--why=".length);
    } else if (id === null) {
      id = arg;
    } else {
      out(`unexpected argument ${JSON.stringify(arg)}\n${USAGE}`);
      return 2;
    }
  }
  if (id === null || why === null) {
    out(`dismiss needs an id and --why "<sentence>"\n${USAGE}`);
    return 2;
  }
  const written = writeDismissRequest(root, { id, why });
  if (!written.ok) {
    out(`not written: ${written.why}`);
    return 2;
  }
  out(`wrote request ${written.requestId} to ${written.path}`);
  out(
    `the daemon applies or refuses it on its next tick; a refusal lands in ${join(root, RECOVERY_INBOX_DIR, REFUSED_DIR)} with its reason`,
  );
  // THE HOLD, SAID TO THE PERSON WHO JUST ASKED (the Opus check's O2). While the
  // index is `not-run` the daemon applies nothing, and that lasts across every
  // restart until the log can be read whole — so "on its next tick" above would
  // be a promise the daemon cannot keep. The same arm and sentence `list` reads.
  const read = readRecoveryIndexFile(root);
  if (read.kind === "file" && read.index.replay.kind === "not-run") {
    out(`HELD: the recovery index is incomplete (${read.index.replay.why}); this request stays pending until a daemon start can read the whole log`);
  }
  return 0;
}

/**
 * `resume <id>` — the CLI twin of the dashboard's Resume button (plan
 * 260910f § 1). It writes ONE request file through the same leaf the route
 * uses, with `actor: "cli"`, and nothing else: the daemon decides, gates,
 * revalidates and launches, one at a time.
 *
 * `seen` is what the current `recovery.json` view says about the record — the
 * thing a person at a terminal is looking at. **Refused here, before anything
 * is written**: a record not on the view's first page, one the view does not
 * classify `interrupted`, or one with no `supported` resume evidence — the
 * same records the page offers no button for. The daemon checks all of it
 * again against the state at launch.
 */
function resume(root: string, args: readonly string[], out: (line: string) => void): number {
  const [id, ...extra] = args;
  if (id === undefined || extra.length > 0) {
    out(`resume needs exactly one id\n${USAGE}`);
    return 2;
  }
  const read = readRecoveryIndexFile(root);
  if (read.kind !== "file") {
    out(read.kind === "absent" ? `no ${RECOVERY_FILE} in ${root}: nothing to resume` : `${join(root, RECOVERY_FILE)} is unusable: ${read.why}`);
    return 1;
  }
  const view = read.view;
  const page = isObject(view) && Array.isArray(view["page"]) ? (view["page"] as unknown[]) : [];
  const item = page.find((raw): raw is Record<string, unknown> => isObject(raw) && raw["id"] === id);
  if (item === undefined || !isObject(view)) {
    out(`not resumable: ${id} is not on the recovery view's first page (the daemon has not checked it, or it is not a record)`);
    return 2;
  }
  const classification = item["classification"];
  if (!isObject(classification) || classification["kind"] !== "interrupted") {
    const kind = isObject(classification) ? textOf(classification["kind"]) : undefined;
    const why = isObject(classification) ? textOf(classification["why"]) : undefined;
    out(`not resumable: the record is ${kind ?? "not classified"}${why === undefined ? "" : ` (${why})`}, and only an interrupted record can be resumed`);
    return 2;
  }
  const evidence = item["evidence"];
  const resumeEvidence = isObject(evidence) ? evidence["resume"] : undefined;
  if (!isObject(evidence) || evidence["kind"] !== "checked" || !isObject(resumeEvidence) || resumeEvidence["kind"] !== "supported") {
    const why = isObject(resumeEvidence) ? textOf(resumeEvidence["why"]) : undefined;
    out(`not resumable: its resume evidence is not supported${why === undefined ? "" : ` (${why})`}`);
    return 2;
  }
  const dir = isObject(evidence["dir"]) ? textOf(evidence["dir"]["path"]) : undefined;
  const conversationId = textOf(resumeEvidence["conversationId"]);
  const checkedAt = textOf(view["checkedAt"]);
  if (dir === undefined || conversationId === undefined || checkedAt === undefined) {
    out("not resumable: the view does not carry the directory, conversation and check time a request needs");
    return 2;
  }
  const written = writeResumeRequest(root, { candidateId: id, actor: "cli", seen: { checkedAt, conversationId, dir } });
  if (written.kind === "refused") {
    out(`not written: ${written.why}`);
    return 2;
  }
  out(`wrote resume request ${written.path}`);
  out("the daemon looks at it on its next tick: one resume starts at a time, after the box, the quota and the session's evidence are checked");
  if (read.index.replay.kind === "not-run") {
    out(`HELD: the recovery index is incomplete (${read.index.replay.why}); this request stays pending until a daemon start can read the whole log`);
  }
  return 0;
}

/** Each candidate's resume state, from the optional `resume` field (plan 260910f, G9). Display only, checked field by field. */
function resumeLines(resume: unknown): { header: string | null; byId: Map<string, string> } {
  const byId = new Map<string, string>();
  if (!isObject(resume)) return { header: null, byId };
  const launcher = isObject(resume["launcher"]) ? resume["launcher"] : {};
  const header =
    launcher["kind"] === "wired"
      ? "resume      the launcher is wired"
      : `resume      NOT WIRED: ${textOf(launcher["why"]) ?? "the daemon did not say why"}`;
  for (const raw of Array.isArray(resume["requests"]) ? (resume["requests"] as unknown[]) : []) {
    if (!isObject(raw) || !isObject(raw["state"])) continue;
    const id = textOf(raw["candidateId"]);
    const state = raw["state"];
    const kind = textOf(state["kind"]);
    if (id === undefined || kind === undefined) continue;
    const why = textOf(state["why"]) ?? textOf(state["waitingFor"]) ?? textOf(state["how"]);
    const position = typeof state["position"] === "number" ? ` #${state["position"]}` : "";
    byId.set(id, `    resume     ${kind}${position}${why === undefined ? "" : `: ${why}`}`);
  }
  return { header, byId };
}

/**
 * A view item as the CLI draws it: its state line and its evidence lines,
 * each already checked.
 *
 * `readRecoveryIndexFile` hands the view over UNVALIDATED — it is derived, and
 * the index must stay readable when it is wrong — so everything here is checked
 * at runtime, field by field, and never dereferenced through a cast (Sol's
 * F25). A malformed item costs its own lines, never the listing. The fleet
 * boundary has its own strict validator; this is display only.
 */
type ViewItemLines = { state: string | null; evidence: string[] };

const EVIDENCE_UNREADABLE = "    view evidence unreadable";

function isObject(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

function textOf(u: unknown): string | undefined {
  return typeof u === "string" ? u : undefined;
}

function viewItems(view: unknown): { items: Map<string, ViewItemLines>; header: string } {
  const items = new Map<string, ViewItemLines>();
  if (!isObject(view)) return { items, header: "view        none yet: the daemon has not run a view pass since it started" };
  const page = Array.isArray(view["page"]) ? (view["page"] as unknown[]) : [];
  for (const raw of page) {
    if (!isObject(raw)) continue;
    const id = textOf(raw["id"]);
    if (id === undefined) continue;
    items.set(id, { state: stateOfItem(raw["classification"]), evidence: describeEvidence(raw["evidence"]) });
  }
  const inventory = isObject(view["inventory"]) ? view["inventory"] : {};
  const against =
    inventory["kind"] === "trusted"
      ? `the inventory collected at ${String(inventory["collectedAt"])}`
      : `NO TRUSTED INVENTORY — every record is unknown: ${String(inventory["why"])}`;
  return { items, header: `view        checked at ${String(view["checkedAt"])} against ${against}` };
}

function stateOfItem(classification: unknown): string | null {
  if (classification === null || classification === undefined) return null;
  if (!isObject(classification)) return "view classification unreadable";
  const kind = textOf(classification["kind"]);
  if (kind === undefined) return "view classification unreadable";
  return `${kind}: ${textOf(classification["why"]) ?? "(no reason recorded)"}`;
}

function describeEvidence(evidence: unknown): string[] {
  if (evidence === null || evidence === undefined) return [];
  if (!isObject(evidence)) return [EVIDENCE_UNREADABLE];
  if (evidence["kind"] === "unavailable") {
    const why = textOf(evidence["why"]);
    return why === undefined ? [EVIDENCE_UNREADABLE] : [`    evidence   ${why}`];
  }
  if (evidence["kind"] !== "checked") return [EVIDENCE_UNREADABLE];
  const { dir, transcript, resume, lastActivity: activity } = evidence;
  if (!isObject(dir) || !isObject(transcript) || !isObject(resume) || !isObject(activity)) return [EVIDENCE_UNREADABLE];
  const dirKind = textOf(dir["kind"]);
  const transcriptKind = textOf(transcript["kind"]);
  const resumeKind = textOf(resume["kind"]);
  const at = textOf(activity["at"]);
  if (dirKind === undefined || transcriptKind === undefined || resumeKind === undefined || at === undefined) return [EVIDENCE_UNREADABLE];
  const suffix = (facts: Record<string, unknown>): string => {
    const path = textOf(facts["path"]);
    const why = textOf(facts["why"]);
    return `${path === undefined ? "" : ` ${path}`}${why === undefined ? "" : ` (${why})`}`;
  };
  const lines = [
    `    dir        ${dirKind}${suffix(dir)}`,
    `    transcript ${transcriptKind}${suffix(transcript)}`,
    `    activity   ${activity["source"] === "register-floor" ? `at least as recent as ${at} (the register's floor)` : `${at} (the transcript)`}`,
  ];
  if (resumeKind === "manual") {
    lines.push(`    manual     on ${textOf(resume["host"]) ?? "an unrecorded host"}, in ${textOf(resume["dir"]) ?? "an unrecorded directory"}`);
  } else {
    const why = textOf(resume["why"]);
    lines.push(`    resume     ${resumeKind}${why === undefined ? "" : ` (${why})`}`);
  }
  return lines;
}

function stateOf(record: RecoveryRecord, item: ViewItemLines | undefined): string {
  if (record.resolution.disposition !== "unresolved") return `${record.resolution.disposition.toUpperCase()} at ${record.resolution.at}`;
  const state = item?.state;
  if (state === null || state === undefined) return "unresolved, not on the view's first page";
  return state;
}

function list(root: string, out: (line: string) => void): number {
  const read = readRecoveryIndexFile(root);
  if (read.kind === "absent") {
    out(`no ${RECOVERY_FILE} in ${root}: the daemon has not written a recovery index here yet (or this is the wrong store)`);
    return 1;
  }
  if (read.kind === "unusable") {
    out(`${join(root, RECOVERY_FILE)} is unusable: ${read.why}`);
    return 1;
  }
  const { index } = read;
  if (index.replay.kind === "not-run") {
    out(`THE RECOVERY INDEX CANNOT SAY WHAT THE LOG HOLDS: ${index.replay.why}`);
  }
  if (index.overflow > 0) {
    out(
      `${index.overflow} candidates are past the index's capacity of ${RECOVERY_UNRESOLVED_CAPACITY} unresolved records: ` +
        "they are not listed here, and survive only in events.jsonl",
    );
  }
  const { items, header } = viewItems(read.view);
  out(header);
  const resumed = resumeLines(read.resume);
  if (resumed.header !== null) out(resumed.header);
  const records = [...index.records.values()].sort(recoveryOrder);
  if (records.length === 0) {
    out("records     none: nothing has been recorded as interrupted");
    return 0;
  }
  out(`records     ${records.length}`);
  for (const record of records) {
    const item = items.get(record.id);
    out(`${record.id}  ${record.at}  ${record.name}`);
    out(`    ${stateOf(record, item)}`);
    if (record.oversize) out("    the full candidate was too large for the index and is in events.jsonl");
    for (const line of describeEvidence(item?.evidence)) out(line);
    const resumeLine = resumed.byId.get(record.id);
    if (resumeLine !== undefined) out(resumeLine);
  }
  return 0;
}

function isMain(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && invoked === fileURLToPath(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause: unknown) => {
      console.error(cause);
      process.exitCode = 1;
    });
}
