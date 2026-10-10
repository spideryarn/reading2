/**
 * **What Debate's Claims draws from the reader's checks** — pure, so the
 * panel's decisions can be tested without painting it. Plan
 * docs/plans/261008i-debate-claims-picked-by-the-reader.md § 3 and § 5.
 *
 * A claim can be checked more than once (Dig further, or ticked again), and
 * its rows are **every finished check's rows for it, an address drawn once**:
 * the first check to find a page keeps it.
 *
 * ## Drawn from what each check stored, not only from the list's ids
 *
 * A list made again mints new claim ids even when the article has not
 * changed, and a changed article makes a new list altogether. Matching a check
 * to the screen by the current list's ids alone hid every paid result in both
 * cases (GPT Sol's E5). So each check's **stored targets** decide where it is
 * drawn (`drawChecks`):
 *
 *  - under the current list's article: under the listed claim with the same
 *    id, or else the same block and quote; failing both, as a group of its
 *    own headed by the target's stored quote and statement, which can still be
 *    dug into;
 *  - under an earlier version of the article: in one read-only group at the
 *    end, grouped by target the same way, with no Dig further and no box;
 *  - a typed claim, by its id, as *Your claim*.
 */
import type { BlockId, SourcesClaimCheckRow, SourcesClaimCheck, SourcesClaimList, SourcesClaimCheckTarget } from "../types.js";

/** What is under one claim. */
export interface ClaimFindings {
  /** Every finished check's rows for this claim, oldest first, one per address. */
  rows: SourcesClaimCheckRow[];
  /** Its latest check is still out. */
  pending: boolean;
  /** Its latest check failed: the reader's sentence for why. */
  error: string | null;
  /**
   * The sentence its latest **finished** check earns when it adds nothing to
   * read: `found-nothing` only when that check answered this claim with no
   * rows and nothing earlier found any either; `not-answered` when the model
   * left the claim out — never drawn as *found nothing* (plan § 3, F5).
   */
  line: "found-nothing" | "not-answered" | null;
  /** A finished check has looked at it, so Dig further has something to build on. */
  canDig: boolean;
}

/** What heads a group that is not a claim on the current list. */
export type CheckGroupHead =
  | { kind: "listed"; blockId: BlockId; quote: string; statement: string }
  | { kind: "own"; text: string };

/** One checked claim drawn as its own group. */
export interface CheckGroup {
  /** Stable across repaints: what the group is grouped by. */
  key: string;
  head: CheckGroupHead;
  /** The claim id Dig further sends: the newest of the group's targets. */
  claimId: string;
  findings: ClaimFindings;
}

/** Everything the checks put on screen, and where. */
export interface DrawnChecks {
  /** Under each claim on the current list, by its id. */
  listed: ReadonlyMap<string, ClaimFindings>;
  /** Checked claims under the current list's article that the list no longer names. */
  unlisted: CheckGroup[];
  /** The claims the reader typed, under the current list's article, in the order first checked. */
  own: CheckGroup[];
  /** Checks made against an earlier version of the article: read-only. */
  earlier: CheckGroup[];
}

/** Is any check out on the article — under this list or not? The server holds one at a time. */
export function anyPending(checks: readonly SourcesClaimCheck[]): boolean {
  return checks.some((c) => c.status === "pending");
}

/** One check's part in a group: the check, and the id it gave this claim. */
interface Entry {
  check: SourcesClaimCheck;
  claimId: string;
}

/** A listed target's block and quote, as one key. */
function quoteKey(blockId: string, quote: string): string {
  return `${blockId}\u0000${quote}`;
}

/** What a group's checks found, oldest first, an address once. */
function findingsOf(entries: readonly Entry[]): ClaimFindings {
  const rows: SourcesClaimCheckRow[] = [];
  const seen = new Set<string>();
  let latest: "answered" | "not-answered" | null = null;
  for (const { check, claimId } of entries) {
    if (check.status !== "done") continue;
    const result = check.results.find((r) => r.claimId === claimId);
    if (result === undefined) continue;
    latest = result.outcome;
    if (result.outcome !== "answered") continue;
    for (const row of result.rows) {
      if (seen.has(row.url)) continue;
      seen.add(row.url);
      rows.push(row);
    }
  }
  const last = entries[entries.length - 1]?.check;
  return {
    rows,
    pending: last?.status === "pending",
    error: last?.status === "error" ? (last.error ?? null) : null,
    line: latest === "not-answered" ? "not-answered" : latest === "answered" && rows.length === 0 ? "found-nothing" : null,
    canDig: latest !== null,
  };
}

/** Groups in the order first met, each with its entries. */
class Grouping {
  private readonly groups = new Map<string, { head: CheckGroupHead; entries: Entry[] }>();

  add(key: string, head: CheckGroupHead, entry: Entry): void {
    const group = this.groups.get(key);
    if (group) group.entries.push(entry);
    else this.groups.set(key, { head, entries: [entry] });
  }

  entriesOf(key: string): Entry[] {
    return this.groups.get(key)?.entries ?? [];
  }

  drawn(prefix: string): CheckGroup[] {
    return [...this.groups]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, { head, entries }]) => ({
        key,
        head,
        claimId: entries[entries.length - 1]!.claimId,
        findings: findingsOf(entries),
      }));
  }
}

function headOf(target: SourcesClaimCheckTarget): CheckGroupHead {
  return target.kind === "listed"
    ? { kind: "listed", blockId: target.blockId, quote: target.quote, statement: target.statement }
    : { kind: "own", text: target.text };
}

/**
 * **Where every check is drawn** — the module's docstring has the rules. With
 * no list, nothing is drawn: there is no list's article to call current.
 */
export function drawChecks(
  checks: readonly SourcesClaimCheck[],
  list: Pick<SourcesClaimList, "sourceHash" | "claims"> | null,
): DrawnChecks {
  const current = new Grouping();
  const earlier = new Grouping();
  if (list === null) return { listed: new Map(), unlisted: [], own: [], earlier: [] };

  const byId = new Set(list.claims.map((c) => c.id));
  const byQuote = new Map(list.claims.map((c) => [quoteKey(c.blockId, c.quote), c.id]));

  for (const check of checks) {
    const now = check.listSourceHash === list.sourceHash;
    for (const target of check.targets) {
      const entry = { check, claimId: target.claimId };
      const head = headOf(target);
      if (target.kind === "own") {
        (now ? current : earlier).add(`own:${target.claimId}`, head, entry);
        continue;
      }
      const quoted = quoteKey(target.blockId, target.quote);
      if (!now) {
        earlier.add(`quote:${quoted}`, head, entry);
        continue;
      }
      const onList = byId.has(target.claimId) ? target.claimId : byQuote.get(quoted);
      if (onList !== undefined) current.add(`claim:${onList}`, head, entry);
      else current.add(`quote:${quoted}`, head, entry);
    }
  }

  const listed = new Map<string, ClaimFindings>();
  for (const claim of list.claims) {
    const entries = current.entriesOf(`claim:${claim.id}`);
    if (entries.length > 0) listed.set(claim.id, findingsOf(entries));
  }
  return {
    listed,
    unlisted: current.drawn("quote:"),
    own: current.drawn("own:"),
    /* Listed and typed together, in the order first checked. */
    earlier: earlier.drawn(""),
  };
}

/**
 * **The rows the checks put on screen**, counted the way they are drawn: per
 * group, an address once. The same page under two claims is two rows, because
 * it is drawn twice.
 */
export function checkedRowCount(drawn: DrawnChecks): number {
  let n = 0;
  for (const findings of drawn.listed.values()) n += findings.rows.length;
  for (const group of [...drawn.unlisted, ...drawn.own, ...drawn.earlier]) n += group.findings.rows.length;
  return n;
}
