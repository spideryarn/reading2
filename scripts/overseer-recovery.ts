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
import { recoveryOrder } from "../tools/overseer/recovery-view.js";
import { RECOVERY_UNRESOLVED_CAPACITY, type RecoveryRecord } from "../tools/overseer/recovery.js";
import { readRecoveryIndexFile, RECOVERY_FILE, storeRoot } from "../tools/overseer/store.js";

const USAGE = [
  "usage:",
  "  npx tsx scripts/overseer-recovery.ts list",
  '  npx tsx scripts/overseer-recovery.ts dismiss <id> --why "<sentence>"',
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
  return 0;
}

/** A view item as the CLI reads it: loosely, for display only. The fleet boundary has its own strict validator. */
type LooseItem = { classification?: { kind?: unknown; why?: unknown } | null; evidence?: Record<string, unknown> | null };

function viewItems(view: unknown): { items: Map<string, LooseItem>; header: string } {
  const items = new Map<string, LooseItem>();
  if (typeof view !== "object" || view === null) return { items, header: "view        none yet: the daemon has not run a view pass since it started" };
  const v = view as Record<string, unknown>;
  const page = Array.isArray(v["page"]) ? (v["page"] as unknown[]) : [];
  for (const raw of page) {
    if (typeof raw === "object" && raw !== null && typeof (raw as { id?: unknown }).id === "string") {
      items.set((raw as { id: string }).id, raw as LooseItem);
    }
  }
  const inventory = v["inventory"] as { kind?: unknown; why?: unknown; collectedAt?: unknown } | undefined;
  const against =
    inventory?.kind === "trusted"
      ? `the inventory collected at ${String(inventory.collectedAt)}`
      : `NO TRUSTED INVENTORY — every record is unknown: ${String(inventory?.why)}`;
  return { items, header: `view        checked at ${String(v["checkedAt"])} against ${against}` };
}

function describeEvidence(evidence: Record<string, unknown> | null | undefined): string[] {
  if (evidence === null || evidence === undefined) return [];
  if (evidence["kind"] !== "checked") return [`    evidence   ${String(evidence["why"])}`];
  const dir = evidence["dir"] as { kind: string; path?: string; why?: string };
  const transcript = evidence["transcript"] as { kind: string; path?: string; why?: string };
  const resume = evidence["resume"] as { kind: string; host?: string; dir?: string | null; why?: string };
  const activity = evidence["lastActivity"] as { at: string; source: string };
  const lines = [
    `    dir        ${dir.kind}${dir.path === undefined ? "" : ` ${dir.path}`}${dir.why === undefined ? "" : ` (${dir.why})`}`,
    `    transcript ${transcript.kind}${transcript.path === undefined ? "" : ` ${transcript.path}`}${transcript.why === undefined ? "" : ` (${transcript.why})`}`,
    `    activity   ${activity.source === "register-floor" ? `at least as recent as ${activity.at} (the register's floor)` : `${activity.at} (the transcript)`}`,
  ];
  if (resume.kind === "manual") lines.push(`    manual     on ${String(resume.host)}, in ${resume.dir ?? "an unrecorded directory"}`);
  else lines.push(`    resume     ${resume.kind}${resume.why === undefined ? "" : ` (${resume.why})`}`);
  return lines;
}

function stateOf(record: RecoveryRecord, item: LooseItem | undefined): string {
  if (record.resolution.disposition !== "unresolved") return `${record.resolution.disposition.toUpperCase()} at ${record.resolution.at}`;
  const classification = item?.classification;
  if (classification === null || classification === undefined) return "unresolved, not on the view's first page";
  return `${String(classification.kind)}: ${String(classification.why)}`;
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
